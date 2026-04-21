from __future__ import annotations

from sqlite3 import Connection
from typing import Any

from app.services import assistant_projection_service
from app.services.common import execute_fetchone


def message_to_legacy(message: dict[str, Any]) -> dict[str, Any]:
    content, cards = assistant_projection_service.legacy_projection_from_parts(
        message["parts"] if isinstance(message.get("parts"), list) else []
    )
    return {
        "id": message["id"],
        "thread_id": message["thread_id"],
        "role": message["role"],
        "content": content,
        "cards": cards,
        "metadata": message.get("metadata", {}),
        "created_at": message["created_at"],
    }


def snapshot_to_legacy_turn(conn: Connection, result: dict[str, Any]) -> dict[str, Any]:
    user_message = message_to_legacy(result["user_message"])
    assistant_message = message_to_legacy(result["assistant_message"])
    trace_row = execute_fetchone(
        conn,
        """
        SELECT id, thread_id, message_id, tool_name, arguments_json, status, result_json, metadata_json, created_at
        FROM conversation_tool_traces
        WHERE thread_id = ? AND message_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (result["thread_id"], result["assistant_message"]["id"]),
    )
    if trace_row is None:
        trace = {
            "id": f"trace_missing_{assistant_message['id']}",
            "thread_id": result["thread_id"],
            "message_id": assistant_message["id"],
            "tool_name": "assistant_run",
            "arguments": {"content": user_message["content"]},
            "status": result["run"]["status"],
            "result": {"summary": assistant_message["content"]},
            "metadata": {"source": "assistant_legacy_adapter"},
            "created_at": assistant_message["created_at"],
        }
    else:
        trace = {
            "id": trace_row["id"],
            "thread_id": trace_row["thread_id"],
            "message_id": trace_row.get("message_id"),
            "tool_name": trace_row["tool_name"],
            "arguments": trace_row.get("arguments_json") if isinstance(trace_row.get("arguments_json"), dict) else {},
            "status": trace_row["status"],
            "result": trace_row.get("result_json") if isinstance(trace_row.get("result_json"), dict) else {},
            "metadata": trace_row.get("metadata_json") if isinstance(trace_row.get("metadata_json"), dict) else {},
            "created_at": trace_row["created_at"],
        }
    return {
        "thread_id": result["thread_id"],
        "user_message": user_message,
        "assistant_message": assistant_message,
        "trace": trace,
        "session_state": result["snapshot"].get("session_state", {}),
    }
