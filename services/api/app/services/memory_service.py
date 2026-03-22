from __future__ import annotations

import json
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services import conversation_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _memory_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "entry_type": row["entry_type"],
        "content": row["content"],
        "metadata": row["metadata_json"],
        "created_at": row["created_at"],
    }


def _recommendation_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "surface": row["surface"],
        "signal_type": row["signal_type"],
        "entity_type": row["entity_type"],
        "entity_id": row["entity_id"],
        "weight": float(row["weight"]),
        "metadata": row["metadata_json"],
        "created_at": row["created_at"],
    }


def create_memory_entry(
    conn: Connection,
    *,
    entry_type: str,
    content: str,
    metadata: dict[str, Any] | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    thread = conversation_service.ensure_primary_thread(conn)
    entry_id = new_id("mem")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO conversation_memory_entries (id, thread_id, entry_type, content, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (entry_id, thread["id"], entry_type, content, json.dumps(metadata or {}, sort_keys=True), now),
    )
    if commit:
        conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM conversation_memory_entries WHERE id = ?", (entry_id,))
    if row is None:
        raise RuntimeError("Memory entry creation failed")
    return _memory_payload(row)


def list_memory_entries(
    conn: Connection,
    *,
    limit: int = 5,
    entry_type: str | None = None,
) -> list[dict[str, Any]]:
    thread = conversation_service.ensure_primary_thread(conn)
    if entry_type:
        rows = execute_fetchall(
            conn,
            """
            SELECT * FROM conversation_memory_entries
            WHERE thread_id = ? AND entry_type = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (thread["id"], entry_type, limit),
        )
    else:
        rows = execute_fetchall(
            conn,
            """
            SELECT * FROM conversation_memory_entries
            WHERE thread_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (thread["id"], limit),
        )
    return [_memory_payload(row) for row in rows]


def record_recommendation_event(
    conn: Connection,
    *,
    surface: str,
    signal_type: str,
    entity_type: str,
    entity_id: str,
    weight: float = 1.0,
    metadata: dict[str, Any] | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    event_id = new_id("rec")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO recommendation_events (
          id, surface, signal_type, entity_type, entity_id, weight, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            surface,
            signal_type,
            entity_type,
            entity_id,
            float(weight),
            json.dumps(metadata or {}, sort_keys=True),
            now,
        ),
    )
    if commit:
        conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM recommendation_events WHERE id = ?", (event_id,))
    if row is None:
        raise RuntimeError("Recommendation event creation failed")
    return _recommendation_payload(row)


def list_recommendation_hints(
    conn: Connection,
    *,
    surface: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    rows = execute_fetchall(
        conn,
        """
        SELECT * FROM recommendation_events
        WHERE surface = ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (surface, limit),
    )
    return [_recommendation_payload(row) for row in rows]
