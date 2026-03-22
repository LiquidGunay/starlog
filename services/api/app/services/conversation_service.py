from __future__ import annotations

import json
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services.common import execute_fetchall, execute_fetchone, new_id

PRIMARY_THREAD_SLUG = "primary"
PRIMARY_THREAD_TITLE = "Primary Starlog Thread"
PRIMARY_THREAD_MODE = "voice_native"


def _message_cursor_clause(created_at: str, message_id: str) -> tuple[str, tuple[str, str]]:
    return "AND (created_at < ? OR (created_at = ? AND id < ?))", (created_at, created_at, message_id)


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
        SELECT id, thread_id, message_id, tool_name, arguments_json, status, result_json, created_at
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
        "messages": [
            {
                "id": item["id"],
                "thread_id": item["thread_id"],
                "role": item["role"],
                "content": item["content"],
                "cards": item["cards_json"],
                "metadata": item["metadata_json"],
                "created_at": item["created_at"],
            }
            for item in messages
        ],
        "tool_traces": [
            {
                "id": item["id"],
                "thread_id": item["thread_id"],
                "message_id": item.get("message_id"),
                "tool_name": item["tool_name"],
                "arguments": item["arguments_json"],
                "status": item["status"],
                "result": item["result_json"],
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
            json.dumps(cards or [], sort_keys=True),
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
) -> dict[str, Any]:
    thread = ensure_primary_thread(conn)
    trace_id = new_id("trace")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO conversation_tool_traces (id, thread_id, message_id, tool_name, arguments_json, status, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            trace_id,
            thread["id"],
            message_id,
            tool_name,
            json.dumps(arguments, sort_keys=True),
            status,
            json.dumps(result, sort_keys=True),
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
        SELECT id, thread_id, message_id, tool_name, arguments_json, status, result_json, created_at
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


def reset_session_state(conn: Connection) -> dict[str, Any]:
    return update_session_state(conn, {})


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
