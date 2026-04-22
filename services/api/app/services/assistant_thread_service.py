from __future__ import annotations

import base64
import json
from collections import defaultdict
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services import assistant_projection_service, conversation_service
from app.services.common import execute_fetchall, execute_fetchone, new_id

_CURSOR_PREFIX = "assistant_cursor_v1."


def _assistant_owner_user_id(conn: Connection) -> str:
    row = execute_fetchone(
        conn,
        """
        SELECT owner_user_id
        FROM conversation_threads
        WHERE slug = ? AND owner_user_id IS NOT NULL AND owner_user_id != ''
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        """,
        (conversation_service.PRIMARY_THREAD_SLUG,),
    )
    if row is None:
        row = execute_fetchone(conn, "SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1")
    if row is None:
        raise LookupError("Starlog has not been bootstrapped yet")
    return str(row.get("owner_user_id") or row.get("id"))


def _require_assistant_user(conn: Connection, user_id: str | None) -> str | None:
    if user_id is None:
        return None
    owner_user_id = _assistant_owner_user_id(conn)
    if user_id != owner_user_id:
        raise PermissionError("Assistant access is restricted to the primary Starlog user")
    return owner_user_id


def ensure_primary_thread(conn: Connection, *, user_id: str | None = None) -> dict[str, Any]:
    owner_user_id = _require_assistant_user(conn, user_id)
    payload = conversation_service.ensure_primary_thread(
        conn,
        user_id=owner_user_id,
        message_limit=1,
        trace_limit=0,
    )
    row = execute_fetchone(conn, "SELECT * FROM conversation_threads WHERE id = ?", (payload["id"],))
    if row is None:
        raise RuntimeError("Primary assistant thread missing")
    return row


def get_thread(conn: Connection, thread_id: str, *, user_id: str | None = None) -> dict[str, Any]:
    owner_user_id = _require_assistant_user(conn, user_id)
    sql = "SELECT * FROM conversation_threads WHERE (id = ? OR slug = ?)"
    params: tuple[Any, ...] = (thread_id, thread_id)
    if owner_user_id is not None:
        sql += " AND owner_user_id = ?"
        params += (owner_user_id,)
    row = execute_fetchone(conn, sql, params)
    if row is None:
        if thread_id == "primary":
            return ensure_primary_thread(conn, user_id=owner_user_id)
        raise LookupError(f"Assistant thread not found: {thread_id}")
    return row


def list_threads(conn: Connection, *, user_id: str | None = None) -> list[dict[str, Any]]:
    owner_user_id = _require_assistant_user(conn, user_id)
    where_sql = "WHERE t.owner_user_id = ?" if owner_user_id is not None else ""
    params: tuple[Any, ...] = (owner_user_id,) if owner_user_id is not None else ()
    rows = execute_fetchall(
        conn,
        f"""
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
        {where_sql}
        ORDER BY t.updated_at DESC, t.id DESC
        """,
        params,
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

def create_thread(conn: Connection, *, title: str, user_id: str, slug: str | None = None, mode: str = "assistant") -> dict[str, Any]:
    owner_user_id = _require_assistant_user(conn, user_id)
    if owner_user_id is None:
        raise PermissionError("Assistant thread owner is required")
    now = utc_now().isoformat()
    thread_id = new_id("thr")
    normalized_slug = slug or thread_id
    conn.execute(
        """
        INSERT INTO conversation_threads (id, owner_user_id, slug, title, mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (thread_id, owner_user_id, normalized_slug, title, mode, now, now),
    )
    conn.execute(
        """
        INSERT INTO conversation_session_state (thread_id, state_json, updated_at)
        VALUES (?, ?, ?)
        """,
        (thread_id, json.dumps({}, sort_keys=True), now),
    )
    conn.commit()
    return get_thread(conn, thread_id, user_id=owner_user_id)


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


def _encode_cursor(timestamp: str | None, seen_keys: set[str] | list[str] | None = None) -> str | None:
    if not timestamp:
        return None
    payload: dict[str, Any] = {"ts": timestamp}
    normalized_seen = sorted({str(item) for item in (seen_keys or []) if item})
    if normalized_seen:
        payload["seen"] = normalized_seen
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return f"{_CURSOR_PREFIX}{encoded.rstrip('=')}"


def _decode_cursor(cursor: str | None) -> tuple[str | None, set[str]]:
    if not cursor:
        return None, set()
    if not cursor.startswith(_CURSOR_PREFIX):
        return cursor, set()

    encoded = cursor.removeprefix(_CURSOR_PREFIX)
    padding = "=" * ((4 - (len(encoded) % 4)) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(f"{encoded}{padding}").decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return cursor, set()

    timestamp = payload.get("ts")
    raw_seen = payload.get("seen") if isinstance(payload, dict) else None
    seen = {str(item) for item in raw_seen} if isinstance(raw_seen, list) else set()
    return (str(timestamp), seen) if isinstance(timestamp, str) and timestamp else (None, set())


def _message_delta_metadata(row: dict[str, Any]) -> tuple[str, str]:
    created_at = str(row["created_at"])
    updated_at = str(row.get("updated_at") or created_at)
    event_type = "message.updated" if updated_at > created_at else "message.created"
    return event_type, f"message:{row['id']}:{event_type}"


def _run_delta_metadata(row: dict[str, Any]) -> tuple[str, str]:
    return "run.updated", f"run:{row['id']}:updated"


def _run_step_delta_metadata(row: dict[str, Any]) -> tuple[str, str]:
    return "run.step.updated", f"run_step:{row['id']}:updated"


def _interrupt_delta_metadata(interrupt_id: str, phase: str) -> tuple[str, str]:
    event_type = "interrupt.opened" if phase == "opened" else "interrupt.resolved"
    return event_type, f"interrupt:{interrupt_id}:{phase}"


def _surface_event_delta_metadata(event_id: str) -> tuple[str, str]:
    return "surface_event.created", f"surface_event:{event_id}:created"


def _thread_watermark_timestamp(conn: Connection, thread_id: str) -> str:
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


def _cursor_keys_at_timestamp(conn: Connection, thread_id: str, timestamp: str) -> set[str]:
    keys: set[str] = set()

    message_rows = execute_fetchall(
        conn,
        """
        SELECT id, created_at, updated_at
        FROM conversation_messages
        WHERE thread_id = ? AND COALESCE(updated_at, created_at) = ?
        """,
        (thread_id, timestamp),
    )
    for row in message_rows:
        _, key = _message_delta_metadata(row)
        keys.add(key)

    run_rows = execute_fetchall(
        conn,
        "SELECT id FROM conversation_runs WHERE thread_id = ? AND updated_at = ?",
        (thread_id, timestamp),
    )
    for row in run_rows:
        _, key = _run_delta_metadata(row)
        keys.add(key)

    step_rows = execute_fetchall(
        conn,
        "SELECT id FROM conversation_run_steps WHERE thread_id = ? AND updated_at = ?",
        (thread_id, timestamp),
    )
    for row in step_rows:
        _, key = _run_step_delta_metadata(row)
        keys.add(key)

    interrupt_rows = execute_fetchall(
        conn,
        """
        SELECT id, created_at, resolved_at
        FROM conversation_interrupts
        WHERE thread_id = ? AND (created_at = ? OR resolved_at = ?)
        """,
        (thread_id, timestamp, timestamp),
    )
    for row in interrupt_rows:
        if row["created_at"] == timestamp:
            _, key = _interrupt_delta_metadata(str(row["id"]), "opened")
            keys.add(key)
        if row.get("resolved_at") == timestamp:
            _, key = _interrupt_delta_metadata(str(row["id"]), "resolved")
            keys.add(key)

    surface_event_rows = execute_fetchall(
        conn,
        "SELECT id FROM conversation_surface_events WHERE thread_id = ? AND created_at = ?",
        (thread_id, timestamp),
    )
    for row in surface_event_rows:
        _, key = _surface_event_delta_metadata(str(row["id"]))
        keys.add(key)

    return keys


def _thread_cursor(conn: Connection, thread_id: str) -> str:
    watermark = _thread_watermark_timestamp(conn, thread_id)
    return _encode_cursor(watermark, _cursor_keys_at_timestamp(conn, thread_id, watermark)) or watermark


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


def get_thread_snapshot(conn: Connection, thread_id: str, *, message_limit: int = 120, user_id: str | None = None) -> dict[str, Any]:
    thread = get_thread(conn, thread_id, user_id=user_id)
    session = execute_fetchone(
        conn,
        "SELECT state_json FROM conversation_session_state WHERE thread_id = ?",
        (thread["id"],),
    )
    recent_message_rows = execute_fetchall(
        conn,
        """
        SELECT id, thread_id, run_id, role, content, cards_json, status, metadata_json, created_at, updated_at
        FROM conversation_messages
        WHERE thread_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        """,
        (thread["id"], message_limit),
    )
    message_rows = list(reversed(recent_message_rows))
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
        "next_cursor": _thread_cursor(conn, thread["id"]),
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
    user_id: str | None = None,
) -> dict[str, Any]:
    thread = get_thread(conn, thread_id, user_id=user_id)
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


def list_deltas(conn: Connection, thread_id: str, *, cursor: str | None = None, user_id: str | None = None) -> dict[str, Any]:
    thread = get_thread(conn, thread_id, user_id=user_id)
    if cursor is None:
        snapshot = get_thread_snapshot(conn, thread["id"], user_id=user_id)
        snapshot_cursor_timestamp, _ = _decode_cursor(snapshot.get("next_cursor"))
        return {
            "thread_id": snapshot["id"],
            "cursor": snapshot.get("next_cursor"),
            "deltas": [
                {
                    "id": new_id("delta"),
                    "thread_id": snapshot["id"],
                    "event_type": "thread.snapshot",
                    "payload": snapshot,
                    "created_at": snapshot_cursor_timestamp or snapshot.get("updated_at") or utc_now().isoformat(),
                }
            ],
        }

    cursor_timestamp, seen_keys = _decode_cursor(cursor)
    if cursor_timestamp is None:
        snapshot = get_thread_snapshot(conn, thread["id"], user_id=user_id)
        return {
            "thread_id": snapshot["id"],
            "cursor": snapshot.get("next_cursor"),
            "deltas": [],
        }

    message_rows = execute_fetchall(
        conn,
        """
        SELECT id, thread_id, run_id, role, content, cards_json, status, metadata_json, created_at, updated_at
        FROM conversation_messages
        WHERE thread_id = ? AND COALESCE(updated_at, created_at) >= ?
        ORDER BY COALESCE(updated_at, created_at) ASC, id ASC
        """,
        (thread["id"], cursor_timestamp),
    )
    parts_by_message = _load_message_parts(conn, [str(row["id"]) for row in message_rows])

    run_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_runs
        WHERE thread_id = ? AND updated_at >= ?
        ORDER BY updated_at ASC, id ASC
        """,
        (thread["id"], cursor_timestamp),
    )
    step_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_run_steps
        WHERE thread_id = ? AND updated_at >= ?
        ORDER BY updated_at ASC, id ASC
        """,
        (thread["id"], cursor_timestamp),
    )
    interrupt_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_interrupts
        WHERE thread_id = ? AND (created_at >= ? OR (resolved_at IS NOT NULL AND resolved_at >= ?))
        ORDER BY created_at ASC, id ASC
        """,
        (thread["id"], cursor_timestamp, cursor_timestamp),
    )
    event_rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_surface_events
        WHERE thread_id = ? AND created_at >= ?
        ORDER BY created_at ASC, id ASC
        """,
        (thread["id"], cursor_timestamp),
    )

    run_payloads = _load_run_payloads(
        conn,
        [str(row["id"]) for row in run_rows] + [str(row["run_id"]) for row in step_rows],
    )

    deltas: list[dict[str, Any]] = []

    for row in message_rows:
        created_at = str(row["created_at"])
        updated_at = str(row.get("updated_at") or created_at)
        event_type, cursor_key = _message_delta_metadata(row)
        deltas.append(
            {
                "id": new_id("delta"),
                "thread_id": thread["id"],
                "event_type": event_type,
                "payload": _message_payload(row, parts_by_message),
                "created_at": updated_at,
                "_cursor_key": cursor_key,
            }
        )

    for row in run_rows:
        run_payload = run_payloads.get(str(row["id"]))
        if run_payload is None:
            continue
        event_type, cursor_key = _run_delta_metadata(row)
        deltas.append(
            {
                "id": new_id("delta"),
                "thread_id": thread["id"],
                "event_type": event_type,
                "payload": run_payload,
                "created_at": row["updated_at"],
                "_cursor_key": cursor_key,
            }
        )

    for row in step_rows:
        run_payload = run_payloads.get(str(row["run_id"]))
        if run_payload is None:
            continue
        event_type, cursor_key = _run_step_delta_metadata(row)
        deltas.append(
            {
                "id": new_id("delta"),
                "thread_id": thread["id"],
                "event_type": event_type,
                "payload": run_payload,
                "created_at": row["updated_at"],
                "_cursor_key": cursor_key,
            }
        )

    for row in interrupt_rows:
        interrupt_payload = _interrupt_payload(row)
        if row["created_at"] >= cursor_timestamp:
            event_type, cursor_key = _interrupt_delta_metadata(str(row["id"]), "opened")
            deltas.append(
                {
                    "id": new_id("delta"),
                    "thread_id": thread["id"],
                    "event_type": event_type,
                    "payload": interrupt_payload,
                    "created_at": row["created_at"],
                    "_cursor_key": cursor_key,
                }
            )
        resolved_at = row.get("resolved_at")
        if isinstance(resolved_at, str) and resolved_at >= cursor_timestamp:
            event_type, cursor_key = _interrupt_delta_metadata(str(row["id"]), "resolved")
            deltas.append(
                {
                    "id": new_id("delta"),
                    "thread_id": thread["id"],
                    "event_type": event_type,
                    "payload": interrupt_payload,
                    "created_at": resolved_at,
                    "_cursor_key": cursor_key,
                }
            )

    for row in event_rows:
        event_type, cursor_key = _surface_event_delta_metadata(str(row["id"]))
        deltas.append(
            {
                "id": new_id("delta"),
                "thread_id": thread["id"],
                "event_type": event_type,
                "payload": _surface_event_payload(row),
                "created_at": row["created_at"],
                "_cursor_key": cursor_key,
            }
        )

    deltas.sort(key=lambda item: (str(item["created_at"]), str(item["_cursor_key"])))

    visible_deltas = [
        item
        for item in deltas
        if str(item["created_at"]) > cursor_timestamp
        or (str(item["created_at"]) == cursor_timestamp and str(item["_cursor_key"]) not in seen_keys)
    ]

    next_cursor_timestamp = cursor_timestamp
    next_seen_keys = set(seen_keys)
    if visible_deltas:
        next_cursor_timestamp = str(visible_deltas[-1]["created_at"])
        next_seen_keys = {
            str(item["_cursor_key"])
            for item in visible_deltas
            if str(item["created_at"]) == next_cursor_timestamp
        }
        if next_cursor_timestamp == cursor_timestamp:
            next_seen_keys |= seen_keys

    return {
        "thread_id": thread["id"],
        "cursor": _encode_cursor(next_cursor_timestamp, next_seen_keys),
        "deltas": [
            {key: value for key, value in item.items() if key != "_cursor_key"}
            for item in visible_deltas
        ],
    }
