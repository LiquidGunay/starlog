from __future__ import annotations

import json
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services.common import execute_fetchall, execute_fetchone, new_id
from app.services import conversation_card_service

PRIMARY_THREAD_SLUG = "primary"
PRIMARY_THREAD_TITLE = "Primary Starlog Thread"
PRIMARY_THREAD_MODE = "voice_native"
PROJECTION_THREAD_CONTEXT = "thread_context"


def _message_cursor_clause(created_at: str, message_id: str) -> tuple[str, tuple[str, str]]:
    return "AND (created_at < ? OR (created_at = ? AND id < ?))", (created_at, created_at, message_id)


def _ensure_card_list(raw_cards: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_cards, list):
        return []
    return [item for item in raw_cards if isinstance(item, dict)]


def _thread_context_payload(session_state: dict[str, Any], traces: list[dict[str, Any]]) -> tuple[str, str, dict[str, Any]]:
    last_intent = str(session_state.get("last_matched_intent") or "").strip()
    latest_trace = traces[0] if traces else {}
    latest_tool = str(latest_trace.get("tool_name") or "").strip()
    latest_status = str(latest_trace.get("status") or "").strip()
    if last_intent:
        body = f"Last intent: {last_intent.replace('_', ' ')}"
    elif latest_tool:
        body = f"Latest trace: {latest_tool.replace('_', ' ')}"
    else:
        body = "Thread context is still empty."
    metadata = {
        "last_matched_intent": last_intent,
        "latest_tool_name": latest_tool,
        "latest_tool_status": latest_status,
    }
    return "Thread context", body, metadata


def _latest_trace_for_projection(conn: Connection, thread_id: str) -> dict[str, Any] | None:
    return execute_fetchone(
        conn,
        """
        SELECT id, thread_id, message_id, tool_name, arguments_json, status, result_json, metadata_json, created_at
        FROM conversation_tool_traces
        WHERE thread_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (thread_id,),
    )


def _projection_key(
    session_state: dict[str, Any],
    latest_trace: dict[str, Any] | None,
    session_updated_at: str | None,
) -> str:
    last_intent = str(session_state.get("last_matched_intent") or "").strip()
    latest_trace = latest_trace or {}
    latest_tool = str(latest_trace.get("tool_name") or "").strip()
    latest_status = str(latest_trace.get("status") or "").strip()
    return "|".join(
        [
            session_updated_at or "",
            last_intent,
            latest_tool,
            latest_status,
        ]
    )


def _project_cards(
    cards: list[dict[str, Any]],
    *,
    session_state: dict[str, Any],
    latest_trace: dict[str, Any] | None,
    session_updated_at: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None]:
    if not cards:
        return [], None
    projection_key = _projection_key(session_state, latest_trace, session_updated_at)
    projected: list[dict[str, Any]] = []
    stored_cards: list[dict[str, Any]] = []
    needs_persist = False
    for card in cards:
        original_card = card
        kind = str(card.get("kind") or "").strip()
        metadata = card.get("metadata")
        metadata = metadata if isinstance(metadata, dict) else {}
        projection = str(metadata.get("projection") or "").strip()
        if kind == PROJECTION_THREAD_CONTEXT or projection == PROJECTION_THREAD_CONTEXT:
            title, body, projection_metadata = _thread_context_payload(session_state, [latest_trace] if latest_trace else [])
            previous_key = str(metadata.get("projection_key") or "")
            base_version = card.get("version")
            stored_version = metadata.get("projection_version")
            version = base_version if isinstance(base_version, int) and base_version > 0 else 0
            if version <= 0 and isinstance(stored_version, int) and stored_version > 0:
                version = stored_version
            if version <= 0:
                version = 1
            if previous_key and projection_key != previous_key:
                version = version + 1 if version >= 1 else 1
            next_metadata = {
                **metadata,
                **projection_metadata,
                "projection": PROJECTION_THREAD_CONTEXT,
                "projection_source": "session_state",
                "projection_key": projection_key,
                "projection_version": version,
                "projection_updated_at": session_updated_at,
            }
            projected_card = conversation_card_service.normalize_card(
                {
                **card,
                "title": card.get("title") or title,
                "body": body,
                "metadata": next_metadata,
                "version": version,
                }
            )
            projected.append(projected_card)
            normalized_stored = conversation_card_service.normalize_card(
                {**card, "metadata": next_metadata, "version": version}
            )
            stored_cards.append(normalized_stored)
            if (
                previous_key != projection_key
                or stored_version != version
                or base_version != version
                or normalized_stored != original_card
            ):
                needs_persist = True
        else:
            normalized_card = conversation_card_service.normalize_card(card)
            projected.append(normalized_card)
            stored_cards.append(normalized_card)
            if normalized_card != original_card:
                needs_persist = True
    return projected, stored_cards if needs_persist else None


def _normalize_cards_for_storage(cards: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized = _ensure_card_list(cards)
    output: list[dict[str, Any]] = []
    for card in normalized:
        kind = str(card.get("kind") or "").strip()
        metadata = card.get("metadata")
        metadata = metadata if isinstance(metadata, dict) else {}
        if kind == PROJECTION_THREAD_CONTEXT:
            metadata = {**metadata, "projection": PROJECTION_THREAD_CONTEXT, "projection_source": "session_state"}
        output.append(conversation_card_service.normalize_card({**card, "metadata": metadata}))
    return output


def _thread_payload(
    conn: Connection,
    row: dict,
    *,
    message_limit: int = 200,
    trace_limit: int = 100,
    before_message_id: str | None = None,
) -> dict[str, Any]:
    message_limit = max(1, min(message_limit, 200))
    trace_limit = max(0, min(trace_limit, 100))
    session_row = execute_fetchone(
        conn,
        "SELECT state_json, updated_at FROM conversation_session_state WHERE thread_id = ?",
        (row["id"],),
    )
    session_state = session_row["state_json"] if session_row else {}
    session_updated_at = session_row["updated_at"] if session_row else None
    projection_trace = _latest_trace_for_projection(conn, row["id"])
    before_row = None
    cursor_sql = ""
    cursor_params: tuple[str, ...] = ()
    if before_message_id:
        before_row = execute_fetchone(
            conn,
            "SELECT id, created_at FROM conversation_messages WHERE thread_id = ? AND id = ?",
            (row["id"], before_message_id),
        )
        if before_row is None:
            raise ValueError(f"Conversation message not found for cursor: {before_message_id}")
        cursor_sql, cursor_params = _message_cursor_clause(str(before_row["created_at"]), str(before_row["id"]))

    messages_desc = execute_fetchall(
        conn,
        f"""
        SELECT id, thread_id, role, content, cards_json, metadata_json, created_at
        FROM conversation_messages
        WHERE thread_id = ?
        {cursor_sql}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        """,
        (row["id"], *cursor_params, message_limit),
    )
    messages = list(reversed(messages_desc))
    traces = execute_fetchall(
        conn,
        """
        SELECT id, thread_id, message_id, tool_name, arguments_json, status, result_json, metadata_json, created_at
        FROM conversation_tool_traces
        WHERE thread_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (row["id"], trace_limit),
    )
    has_more_messages = False
    next_before_message_id = None
    if messages:
        earliest_message = messages[0]
        older_message = execute_fetchone(
            conn,
            """
            SELECT id
            FROM conversation_messages
            WHERE thread_id = ?
              AND (created_at < ? OR (created_at = ? AND id < ?))
            LIMIT 1
            """,
            (
                row["id"],
                earliest_message["created_at"],
                earliest_message["created_at"],
                earliest_message["id"],
            ),
        )
        has_more_messages = older_message is not None
        next_before_message_id = str(earliest_message["id"]) if has_more_messages else None
    payload_messages: list[dict[str, Any]] = []
    pending_card_updates: list[tuple[str, str]] = []
    for item in messages:
        projected_cards, stored_cards = _project_cards(
            _ensure_card_list(item["cards_json"]),
            session_state=session_state,
            latest_trace=projection_trace,
            session_updated_at=session_updated_at,
        )
        payload_messages.append(
            {
                "id": item["id"],
                "thread_id": item["thread_id"],
                "role": item["role"],
                "content": item["content"],
                "cards": projected_cards,
                "metadata": item["metadata_json"],
                "created_at": item["created_at"],
            }
        )
        if stored_cards is not None:
            pending_card_updates.append((json.dumps(stored_cards, sort_keys=True), item["id"]))

    if pending_card_updates:
        for cards_json, message_id in pending_card_updates:
            conn.execute(
                "UPDATE conversation_messages SET cards_json = ? WHERE id = ?",
                (cards_json, message_id),
            )
        conn.commit()

    return {
        "id": row["id"],
        "slug": row["slug"],
        "title": row["title"],
        "mode": row["mode"],
        "message_limit": message_limit,
        "trace_limit": trace_limit,
        "has_more_messages": has_more_messages,
        "next_before_message_id": next_before_message_id,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "session_state": session_row["state_json"] if session_row else {},
        "messages": payload_messages,
        "tool_traces": [
            {
                "id": item["id"],
                "thread_id": item["thread_id"],
                "message_id": item.get("message_id"),
                "tool_name": item["tool_name"],
                "arguments": item["arguments_json"],
                "status": item["status"],
                "result": item["result_json"],
                "metadata": item.get("metadata_json", {}),
                "created_at": item["created_at"],
            }
            for item in traces
        ],
    }


def ensure_primary_thread(
    conn: Connection,
    *,
    message_limit: int = 200,
    trace_limit: int = 100,
    before_message_id: str | None = None,
) -> dict[str, Any]:
    row = execute_fetchone(conn, "SELECT * FROM conversation_threads WHERE slug = ?", (PRIMARY_THREAD_SLUG,))
    if row is not None:
        return _thread_payload(
            conn,
            row,
            message_limit=message_limit,
            trace_limit=trace_limit,
            before_message_id=before_message_id,
        )

    now = utc_now().isoformat()
    thread_id = new_id("thr")
    conn.execute(
        """
        INSERT INTO conversation_threads (id, slug, title, mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (thread_id, PRIMARY_THREAD_SLUG, PRIMARY_THREAD_TITLE, PRIMARY_THREAD_MODE, now, now),
    )
    conn.execute(
        "INSERT INTO conversation_session_state (thread_id, state_json, updated_at) VALUES (?, ?, ?)",
        (thread_id, json.dumps({}, sort_keys=True), now),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM conversation_threads WHERE id = ?", (thread_id,))
    if row is None:
        raise RuntimeError("Failed to create primary conversation thread")
    return _thread_payload(
        conn,
        row,
        message_limit=message_limit,
        trace_limit=trace_limit,
        before_message_id=before_message_id,
    )


def get_primary_thread(
    conn: Connection,
    *,
    message_limit: int = 200,
    trace_limit: int = 100,
    before_message_id: str | None = None,
) -> dict[str, Any]:
    return ensure_primary_thread(
        conn,
        message_limit=message_limit,
        trace_limit=trace_limit,
        before_message_id=before_message_id,
    )


def get_session_state(conn: Connection) -> dict[str, Any]:
    thread = ensure_primary_thread(conn)
    row = execute_fetchone(
        conn,
        "SELECT state_json FROM conversation_session_state WHERE thread_id = ?",
        (thread["id"],),
    )
    return row["state_json"] if row else {}


def append_message(
    conn: Connection,
    *,
    role: str,
    content: str,
    cards: list[dict[str, Any]] | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    thread = ensure_primary_thread(conn)
    now = utc_now().isoformat()
    message_id = new_id("msg")
    normalized_cards = _normalize_cards_for_storage(cards)
    conn.execute(
        """
        INSERT INTO conversation_messages (id, thread_id, role, content, cards_json, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            message_id,
            thread["id"],
            role,
            content,
            json.dumps(normalized_cards, sort_keys=True),
            json.dumps(metadata or {}, sort_keys=True),
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
        SELECT id, thread_id, role, content, cards_json, metadata_json, created_at
        FROM conversation_messages
        WHERE id = ?
        """,
        (message_id,),
    )
    if row is None:
        raise RuntimeError("Failed to append conversation message")
    return {
        "id": row["id"],
        "thread_id": row["thread_id"],
        "role": row["role"],
        "content": row["content"],
        "cards": row["cards_json"],
        "metadata": row["metadata_json"],
        "created_at": row["created_at"],
    }


def record_tool_trace(
    conn: Connection,
    *,
    message_id: str | None,
    tool_name: str,
    arguments: dict[str, Any],
    status: str,
    result: dict[str, Any] | list[dict[str, Any]],
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    thread = ensure_primary_thread(conn)
    trace_id = new_id("trace")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO conversation_tool_traces (
          id, thread_id, message_id, tool_name, arguments_json, status, result_json, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            trace_id,
            thread["id"],
            message_id,
            tool_name,
            json.dumps(arguments, sort_keys=True),
            status,
            json.dumps(result, sort_keys=True),
            json.dumps(metadata or {}, sort_keys=True),
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
        SELECT id, thread_id, message_id, tool_name, arguments_json, status, result_json, metadata_json, created_at
        FROM conversation_tool_traces
        WHERE id = ?
        """,
        (trace_id,),
    )
    if row is None:
        raise RuntimeError("Failed to record tool trace")
    return {
        "id": row["id"],
        "thread_id": row["thread_id"],
        "message_id": row.get("message_id"),
        "tool_name": row["tool_name"],
        "arguments": row["arguments_json"],
        "status": row["status"],
        "result": row["result_json"],
        "metadata": row.get("metadata_json", {}),
        "created_at": row["created_at"],
    }


def update_session_state(conn: Connection, state: dict[str, Any]) -> dict[str, Any]:
    thread = ensure_primary_thread(conn)
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO conversation_session_state (thread_id, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
        """,
        (thread["id"], json.dumps(state, sort_keys=True), now),
    )
    conn.execute(
        "UPDATE conversation_threads SET updated_at = ? WHERE id = ?",
        (now, thread["id"]),
    )
    conn.commit()
    return {"thread_id": thread["id"], "session_state": state, "updated_at": now}


def merge_session_state(conn: Connection, state_patch: dict[str, Any]) -> dict[str, Any]:
    next_state = dict(get_session_state(conn))
    next_state.update(state_patch)
    return update_session_state(conn, next_state)


def reset_session_state(conn: Connection) -> dict[str, Any]:
    thread = ensure_primary_thread(conn)
    previous_state = get_session_state(conn)
    message_count_row = execute_fetchone(
        conn,
        "SELECT COUNT(*) AS count FROM conversation_messages WHERE thread_id = ?",
        (thread["id"],),
    )
    trace_count_row = execute_fetchone(
        conn,
        "SELECT COUNT(*) AS count FROM conversation_tool_traces WHERE thread_id = ?",
        (thread["id"],),
    )
    reset_payload = update_session_state(conn, {})
    return {
        **reset_payload,
        "cleared_keys": sorted(previous_state.keys()),
        "preserved_message_count": int(message_count_row["count"]) if message_count_row else 0,
        "preserved_tool_trace_count": int(trace_count_row["count"]) if trace_count_row else 0,
    }


def record_chat_turn(
    conn: Connection,
    *,
    content: str,
    assistant_content: str,
    cards: list[dict[str, Any]] | None = None,
    request_metadata: dict[str, Any] | None = None,
    assistant_metadata: dict[str, Any] | None = None,
    session_state_patch: dict[str, Any] | None = None,
    runtime_trace_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user_message = append_message(
        conn,
        role="user",
        content=content,
        metadata=request_metadata or {},
    )
    assistant_message = append_message(
        conn,
        role="assistant",
        content=assistant_content,
        cards=cards or [],
        metadata=assistant_metadata or {},
    )
    trace = record_tool_trace(
        conn,
        message_id=str(assistant_message["id"]),
        tool_name="chat_turn_runtime",
        arguments={"content": content},
        status="completed",
        result={
            "response_text": assistant_content,
            "cards": cards or [],
        },
        metadata=runtime_trace_metadata or {},
    )
    session_state = merge_session_state(conn, session_state_patch or {})
    return {
        "thread_id": assistant_message["thread_id"],
        "user_message": user_message,
        "assistant_message": assistant_message,
        "trace": trace,
        "session_state": session_state["session_state"],
    }


def record_assistant_tool_turn(
    conn: Connection,
    *,
    content: str,
    assistant_content: str,
    cards: list[dict[str, Any]] | None = None,
    tool_traces: list[dict[str, Any]] | None = None,
    request_metadata: dict[str, Any] | None = None,
    assistant_metadata: dict[str, Any] | None = None,
    session_state_patch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user_message = append_message(
        conn,
        role="user",
        content=content,
        metadata=request_metadata or {},
    )
    assistant_message = append_message(
        conn,
        role="assistant",
        content=assistant_content,
        cards=cards or [],
        metadata=assistant_metadata or {},
    )
    recorded_traces: list[dict[str, Any]] = []
    for trace in tool_traces or []:
        recorded_traces.append(
            record_tool_trace(
                conn,
                message_id=str(assistant_message["id"]),
                tool_name=str(trace.get("tool_name") or "assistant_tool"),
                arguments=trace.get("arguments") if isinstance(trace.get("arguments"), dict) else {},
                status=str(trace.get("status") or "completed"),
                result=trace.get("result") if isinstance(trace.get("result"), (dict, list)) else {},
                metadata=trace.get("metadata") if isinstance(trace.get("metadata"), dict) else {},
            )
        )
    primary_trace = recorded_traces[-1] if recorded_traces else record_tool_trace(
        conn,
        message_id=str(assistant_message["id"]),
        tool_name="assistant_turn",
        arguments={"content": content},
        status="completed",
        result={"response_text": assistant_content, "cards": cards or []},
        metadata={"source": "assistant_tool_turn"},
    )
    session_state = merge_session_state(conn, session_state_patch or {})
    return {
        "thread_id": assistant_message["thread_id"],
        "user_message": user_message,
        "assistant_message": assistant_message,
        "trace": primary_trace,
        "session_state": session_state["session_state"],
    }


def build_chat_preview_request(
    conn: Connection,
    *,
    content: str,
    title: str | None = None,
    message_limit: int = 12,
    trace_limit: int = 10,
    metadata: dict[str, Any] | None = None,
    context_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    thread = get_primary_thread(conn, message_limit=message_limit, trace_limit=trace_limit)
    context: dict[str, Any] = {
        "thread": {
            "id": thread["id"],
            "slug": thread["slug"],
            "mode": thread["mode"],
        },
        "session_state": thread["session_state"],
        "recent_messages": [
            {
                "id": message["id"],
                "role": message["role"],
                "content": message["content"],
                "cards": message["cards"],
                "metadata": message.get("metadata", {}),
                "created_at": message["created_at"],
            }
            for message in thread["messages"]
        ],
        "recent_tool_traces": [
            {
                "id": trace["id"],
                "message_id": trace["message_id"],
                "tool_name": trace["tool_name"],
                "status": trace["status"],
                "result": trace["result"],
                "metadata": trace.get("metadata", {}),
                "created_at": trace["created_at"],
            }
            for trace in thread["tool_traces"]
        ],
        "request_metadata": metadata or {},
    }
    if context_overrides:
        context.update(context_overrides)
    return {
        "thread_id": thread["id"],
        "title": title or thread["title"],
        "text": content,
        "context": context,
    }
