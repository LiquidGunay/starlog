from __future__ import annotations

import json
from collections import defaultdict
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services import assistant_projection_service, conversation_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def ensure_primary_thread(conn: Connection) -> dict[str, Any]:
    payload = conversation_service.ensure_primary_thread(conn, message_limit=1, trace_limit=0)
    row = execute_fetchone(conn, "SELECT * FROM conversation_threads WHERE id = ?", (payload["id"],))
    if row is None:
        raise RuntimeError("Primary assistant thread missing")
    return row


def get_thread(conn: Connection, thread_id: str) -> dict[str, Any]:
    row = execute_fetchone(
        conn,
        "SELECT * FROM conversation_threads WHERE id = ? OR slug = ?",
        (thread_id, thread_id),
    )
    if row is None:
        if thread_id == "primary":
            return ensure_primary_thread(conn)
        raise LookupError(f"Assistant thread not found: {thread_id}")
    return row


def list_threads(conn: Connection) -> list[dict[str, Any]]:
    rows = execute_fetchall(
        conn,
        """
        SELECT t.*, m.created_at AS last_message_at, m.content AS last_preview_text
        FROM conversation_threads t
        LEFT JOIN conversation_messages m
          ON m.id = (
            SELECT id
            FROM conversation_messages
            WHERE thread_id = t.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          )
        ORDER BY t.updated_at DESC, t.id DESC
        """,
    )
    return [
        {
            "id": row["id"],
            "slug": row["slug"],
            "title": row["title"],
            "mode": row["mode"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "last_message_at": row.get("last_message_at"),
            "last_preview_text": row.get("last_preview_text"),
        }
        for row in rows
    ]


def create_thread(conn: Connection, *, title: str, slug: str | None = None, mode: str = "assistant") -> dict[str, Any]:
    now = utc_now().isoformat()
    thread_id = new_id("thr")
    normalized_slug = slug or thread_id
    conn.execute(
        """
        INSERT INTO conversation_threads (id, slug, title, mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (thread_id, normalized_slug, title, mode, now, now),
    )
    conn.execute(
        """
        INSERT INTO conversation_session_state (thread_id, state_json, updated_at)
        VALUES (?, ?, ?)
        """,
        (thread_id, json.dumps({}, sort_keys=True), now),
    )
    conn.commit()
    return get_thread(conn, thread_id)


def _load_message_parts(conn: Connection, message_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not message_ids:
        return {}
    placeholders = ", ".join("?" for _ in message_ids)
    rows = execute_fetchall(
        conn,
        f"""
        SELECT id, message_id, part_index, part_type, payload_json, created_at
        FROM conversation_message_parts
        WHERE message_id IN ({placeholders})
        ORDER BY message_id ASC, part_index ASC, id ASC
        """,
        tuple(message_ids),
    )
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        payload = row.get("payload_json")
        if isinstance(payload, dict):
            grouped[str(row["message_id"])].append(payload)
    return grouped


def _message_payload(row: dict[str, Any], parts_by_message: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    parts = parts_by_message.get(str(row["id"])) or assistant_projection_service.synthesize_parts_from_legacy(
        content=str(row.get("content") or ""),
        cards=row.get("cards_json") if isinstance(row.get("cards_json"), list) else [],
    )
    return {
        "id": row["id"],
        "thread_id": row["thread_id"],
        "run_id": row.get("run_id"),
        "role": row["role"],
        "status": row.get("status") or "complete",
        "parts": parts,
        "metadata": row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {},
        "created_at": row["created_at"],
        "updated_at": row.get("updated_at") or row["created_at"],
    }


def _interrupt_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "thread_id": row["thread_id"],
        "run_id": row["run_id"],
        "status": row["status"],
        "interrupt_type": row["interrupt_type"],
        "tool_name": row["tool_name"],
        "title": row["title"],
        "body": row.get("body"),
        "entity_ref": row.get("entity_ref_json") if isinstance(row.get("entity_ref_json"), dict) else None,
        "fields": row.get("fields_json") if isinstance(row.get("fields_json"), list) else [],
        "primary_label": row["primary_label"],
        "secondary_label": row.get("secondary_label"),
        "metadata": row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {},
        "created_at": row["created_at"],
        "resolved_at": row.get("resolved_at"),
        "resolution": row.get("resolution_json") if isinstance(row.get("resolution_json"), dict) else {},
    }


def _run_step_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "run_id": row["run_id"],
        "step_index": row["step_index"],
        "title": row["title"],
        "tool_name": row.get("tool_name"),
        "tool_kind": row.get("tool_kind"),
        "status": row["status"],
        "arguments": row.get("arguments_json") if isinstance(row.get("arguments_json"), dict) else {},
        "result": row.get("result_json") if isinstance(row.get("result_json"), dict) else {},
        "error_text": row.get("error_text"),
        "interrupt_id": row.get("interrupt_id"),
        "metadata": row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {},
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _surface_event_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "thread_id": row["thread_id"],
        "source_surface": row["source_surface"],
        "kind": row["kind"],
        "entity_ref": row.get("entity_ref_json") if isinstance(row.get("entity_ref_json"), dict) else None,
        "payload": row.get("payload_json") if isinstance(row.get("payload_json"), dict) else {},
        "visibility": row["visibility"],
        "projected_message": bool(row.get("projected_message")),
        "created_at": row["created_at"],
    }


def _max_timestamp(*values: object) -> str | None:
    filtered = [str(value) for value in values if isinstance(value, str) and value]
    return max(filtered) if filtered else None


def _thread_watermark(conn: Connection, thread_id: str) -> str:
    thread = get_thread(conn, thread_id)
    message_row = execute_fetchone(
        conn,
        "SELECT MAX(COALESCE(updated_at, created_at)) AS ts FROM conversation_messages WHERE thread_id = ?",
        (thread["id"],),
    )
    run_row = execute_fetchone(
        conn,
        "SELECT MAX(updated_at) AS ts FROM conversation_runs WHERE thread_id = ?",
        (thread["id"],),
    )
    step_row = execute_fetchone(
        conn,
        "SELECT MAX(updated_at) AS ts FROM conversation_run_steps WHERE thread_id = ?",
        (thread["id"],),
    )
    interrupt_row = execute_fetchone(
        conn,
        """
        SELECT MAX(CASE WHEN resolved_at IS NOT NULL AND resolved_at > created_at THEN resolved_at ELSE created_at END) AS ts
        FROM conversation_interrupts
        WHERE thread_id = ?
        """,
        (thread["id"],),
    )
    event_row = execute_fetchone(
        conn,
        "SELECT MAX(created_at) AS ts FROM conversation_surface_events WHERE thread_id = ?",
        (thread["id"],),
    )
    return (
        _max_timestamp(
            thread.get("updated_at"),
            (message_row or {}).get("ts"),
            (run_row or {}).get("ts"),
            (step_row or {}).get("ts"),
            (interrupt_row or {}).get("ts"),
            (event_row or {}).get("ts"),
        )
        or thread["updated_at"]
    )


def _load_run_payloads(conn: Connection, run_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not run_ids:
        return {}
    normalized_run_ids = sorted({run_id for run_id in run_ids if run_id})
    placeholders = ", ".join("?" for _ in normalized_run_ids)
    run_rows = execute_fetchall(
        conn,
        f"""
        SELECT *
        FROM conversation_runs
        WHERE id IN ({placeholders})
        ORDER BY created_at DESC, id DESC
        """,
        tuple(normalized_run_ids),
    )
    step_rows = execute_fetchall(
        conn,
        f"""
        SELECT *
        FROM conversation_run_steps
        WHERE run_id IN ({placeholders})
        ORDER BY run_id ASC, step_index ASC, id ASC
        """,
        tuple(normalized_run_ids),
    )
    interrupt_rows = execute_fetchall(
        conn,
        f"""
        SELECT *
        FROM conversation_interrupts
        WHERE run_id IN ({placeholders})
        ORDER BY created_at DESC, id DESC
        """,
        tuple(normalized_run_ids),
    )

    grouped_steps: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in step_rows:
        grouped_steps[str(row["run_id"])].append(_run_step_payload(row))

    interrupts_by_run: dict[str, dict[str, Any]] = {}
    for row in interrupt_rows:
        payload = _interrupt_payload(row)
        if payload["status"] == "pending" and payload["run_id"] not in interrupts_by_run:
            interrupts_by_run[payload["run_id"]] = payload

    return {
        str(row["id"]): {
            "id": row["id"],
            "thread_id": row["thread_id"],
            "origin_message_id": row.get("origin_message_id"),
            "orchestrator": row["orchestrator"],
            "status": row["status"],
            "summary": row.get("summary"),
            "metadata": row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {},
            "steps": grouped_steps.get(str(row["id"]), []),
            "current_interrupt": interrupts_by_run.get(str(row["id"])),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in run_rows
    }


def get_thread_snapshot(conn: Connection, thread_id: str, *, message_limit: int = 120) -> dict[str, Any]:
    thread = get_thread(conn, thread_id)
    session = execute_fetchone(
        conn,
        "SELECT state_json FROM conversation_session_state WHERE thread_id = ?",
        (thread["id"],),
    )
    message_rows = execute_fetchall(
        conn,
        """
        SELECT id, thread_id, run_id, role, content, cards_json, status, metadata_json, created_at, updated_at
        FROM conversation_messages
        WHERE thread_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT ?
        """,
        (thread["id"], message_limit),
    )
    parts_by_message = _load_message_parts(conn, [str(row["id"]) for row in message_rows])
    interrupt_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_interrupts
        WHERE thread_id = ?
        ORDER BY created_at DESC, id DESC
        """,
        (thread["id"],),
    )
    step_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_run_steps
        WHERE thread_id = ?
        ORDER BY run_id ASC, step_index ASC, id ASC
        """,
        (thread["id"],),
    )
    grouped_steps: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in step_rows:
        grouped_steps[str(row["run_id"])].append(_run_step_payload(row))

    interrupts_by_run: dict[str, dict[str, Any]] = {}
    interrupt_payloads: list[dict[str, Any]] = []
    for row in interrupt_rows:
        payload = _interrupt_payload(row)
        interrupt_payloads.append(payload)
        if payload["status"] == "pending" and payload["run_id"] not in interrupts_by_run:
            interrupts_by_run[payload["run_id"]] = payload

    run_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_runs
        WHERE thread_id = ?
        ORDER BY created_at DESC, id DESC
        """,
        (thread["id"],),
    )
    runs = [
        {
            "id": row["id"],
            "thread_id": row["thread_id"],
            "origin_message_id": row.get("origin_message_id"),
            "orchestrator": row["orchestrator"],
            "status": row["status"],
            "summary": row.get("summary"),
            "metadata": row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {},
            "steps": grouped_steps.get(str(row["id"]), []),
            "current_interrupt": interrupts_by_run.get(str(row["id"])),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in run_rows
    ]

    return {
        "id": thread["id"],
        "slug": thread["slug"],
        "title": thread["title"],
        "mode": thread["mode"],
        "created_at": thread["created_at"],
        "updated_at": thread["updated_at"],
        "last_message_at": message_rows[-1]["created_at"] if message_rows else None,
        "last_preview_text": message_rows[-1]["content"] if message_rows else None,
        "messages": [_message_payload(row, parts_by_message) for row in message_rows],
        "runs": runs,
        "interrupts": interrupt_payloads,
        "session_state": session["state_json"] if session else {},
        "next_cursor": _thread_watermark(conn, thread["id"]),
    }


def append_message(
    conn: Connection,
    *,
    thread_id: str,
    role: str,
    status: str,
    parts: list[dict[str, Any]],
    metadata: dict[str, Any] | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    thread = get_thread(conn, thread_id)
    now = utc_now().isoformat()
    content, cards = assistant_projection_service.legacy_projection_from_parts(parts)
    message_id = new_id("msg")
    conn.execute(
        """
        INSERT INTO conversation_messages (
          id, thread_id, run_id, role, content, cards_json, status, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            message_id,
            thread["id"],
            run_id,
            role,
            content,
            json.dumps(cards, sort_keys=True),
            status,
            json.dumps(metadata or {}, sort_keys=True),
            now,
            now,
        ),
    )
    for index, part in enumerate(parts):
        conn.execute(
            """
            INSERT INTO conversation_message_parts (id, message_id, thread_id, run_id, part_index, part_type, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("msgpart"),
                message_id,
                thread["id"],
                run_id,
                index,
                str(part.get("type") or "unknown"),
                json.dumps(part, sort_keys=True),
                now,
            ),
        )
    conn.execute(
        "UPDATE conversation_threads SET updated_at = ? WHERE id = ?",
        (now, thread["id"]),
    )
    conn.commit()
    row = execute_fetchone(
        conn,
        """
        SELECT id, thread_id, run_id, role, content, cards_json, status, metadata_json, created_at, updated_at
        FROM conversation_messages
        WHERE id = ?
        """,
        (message_id,),
    )
    if row is None:
        raise RuntimeError("Failed to append assistant thread message")
    return _message_payload(row, {message_id: parts})


def list_deltas(conn: Connection, thread_id: str, *, cursor: str | None = None) -> dict[str, Any]:
    thread = get_thread(conn, thread_id)
    if cursor is None:
        snapshot = get_thread_snapshot(conn, thread["id"])
        return {
            "thread_id": snapshot["id"],
            "cursor": snapshot.get("next_cursor"),
            "deltas": [
                {
                    "id": new_id("delta"),
                    "thread_id": snapshot["id"],
                    "event_type": "thread.snapshot",
                    "payload": snapshot,
                    "created_at": snapshot.get("next_cursor") or utc_now().isoformat(),
                }
            ],
        }

    message_rows = execute_fetchall(
        conn,
        """
        SELECT id, thread_id, run_id, role, content, cards_json, status, metadata_json, created_at, updated_at
        FROM conversation_messages
        WHERE thread_id = ? AND COALESCE(updated_at, created_at) > ?
        ORDER BY COALESCE(updated_at, created_at) ASC, id ASC
        """,
        (thread["id"], cursor),
    )
    parts_by_message = _load_message_parts(conn, [str(row["id"]) for row in message_rows])

    run_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_runs
        WHERE thread_id = ? AND updated_at > ?
        ORDER BY updated_at ASC, id ASC
        """,
        (thread["id"], cursor),
    )
    step_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_run_steps
        WHERE thread_id = ? AND updated_at > ?
        ORDER BY updated_at ASC, id ASC
        """,
        (thread["id"], cursor),
    )
    interrupt_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_interrupts
        WHERE thread_id = ? AND (created_at > ? OR (resolved_at IS NOT NULL AND resolved_at > ?))
        ORDER BY created_at ASC, id ASC
        """,
        (thread["id"], cursor, cursor),
    )
    event_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_surface_events
        WHERE thread_id = ? AND created_at > ?
        ORDER BY created_at ASC, id ASC
        """,
        (thread["id"], cursor),
    )

    run_payloads = _load_run_payloads(
        conn,
        [str(row["id"]) for row in run_rows] + [str(row["run_id"]) for row in step_rows],
    )

    deltas: list[dict[str, Any]] = []

    for row in message_rows:
        created_at = row["created_at"]
        updated_at = row.get("updated_at") or created_at
        deltas.append(
            {
                "id": new_id("delta"),
                "thread_id": thread["id"],
                "event_type": "message.updated" if updated_at > created_at else "message.created",
                "payload": _message_payload(row, parts_by_message),
                "created_at": updated_at,
            }
        )

    for row in run_rows:
        run_payload = run_payloads.get(str(row["id"]))
        if run_payload is None:
            continue
        deltas.append(
            {
                "id": new_id("delta"),
                "thread_id": thread["id"],
                "event_type": "run.updated",
                "payload": run_payload,
                "created_at": row["updated_at"],
            }
        )

    for row in step_rows:
        run_payload = run_payloads.get(str(row["run_id"]))
        if run_payload is None:
            continue
        deltas.append(
            {
                "id": new_id("delta"),
                "thread_id": thread["id"],
                "event_type": "run.step.updated",
                "payload": run_payload,
                "created_at": row["updated_at"],
            }
        )

    for row in interrupt_rows:
        interrupt_payload = _interrupt_payload(row)
        if row["created_at"] > cursor:
            deltas.append(
                {
                    "id": new_id("delta"),
                    "thread_id": thread["id"],
                    "event_type": "interrupt.opened",
                    "payload": interrupt_payload,
                    "created_at": row["created_at"],
                }
            )
        resolved_at = row.get("resolved_at")
        if isinstance(resolved_at, str) and resolved_at > cursor:
            deltas.append(
                {
                    "id": new_id("delta"),
                    "thread_id": thread["id"],
                    "event_type": "interrupt.resolved",
                    "payload": interrupt_payload,
                    "created_at": resolved_at,
                }
            )

    for row in event_rows:
        deltas.append(
            {
                "id": new_id("delta"),
                "thread_id": thread["id"],
                "event_type": "surface_event.created",
                "payload": _surface_event_payload(row),
                "created_at": row["created_at"],
            }
        )

    deltas.sort(key=lambda item: (str(item["created_at"]), str(item["id"])))

    return {
        "thread_id": thread["id"],
        "cursor": _thread_watermark(conn, thread["id"]),
        "deltas": deltas,
    }
