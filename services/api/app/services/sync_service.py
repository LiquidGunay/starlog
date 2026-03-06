import json
from sqlite3 import Connection

from app.core.config import get_settings
from app.core.time import utc_now
from app.schemas.sync import SyncActivityWrite, SyncMutation
from app.services.common import execute_fetchall


def push(conn: Connection, client_id: str, mutations: list[SyncMutation]) -> tuple[int, int, int]:
    now = utc_now().isoformat()
    accepted = 0

    for mutation in mutations:
        conn.execute(
            """
            INSERT INTO sync_events (client_id, mutation_id, entity, op, payload_json, occurred_at, server_received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                client_id,
                mutation.id,
                mutation.entity,
                mutation.op,
                json.dumps(mutation.payload, sort_keys=True),
                mutation.occurred_at.isoformat(),
                now,
            ),
        )
        accepted += 1

    conn.commit()
    cursor = conn.execute("SELECT COALESCE(MAX(id), 0) FROM sync_events").fetchone()[0]
    return accepted, 0, int(cursor)


def pull(conn: Connection, cursor: int) -> tuple[int, list[dict]]:
    limit = get_settings().sync_pull_limit
    rows = execute_fetchall(
        conn,
        """
        SELECT id, client_id, mutation_id, entity, op, payload_json, occurred_at, server_received_at
        FROM sync_events
        WHERE id > ?
        ORDER BY id ASC
        LIMIT ?
        """,
        (cursor, limit),
    )

    events: list[dict] = []
    next_cursor = cursor
    for row in rows:
        event_cursor = int(row["id"])
        next_cursor = max(next_cursor, event_cursor)
        events.append(
            {
                "cursor": event_cursor,
                "client_id": row["client_id"],
                "mutation_id": row["mutation_id"],
                "entity": row["entity"],
                "op": row["op"],
                "payload": row["payload_json"],
                "occurred_at": row["occurred_at"],
                "server_received_at": row["server_received_at"],
            }
        )
    return next_cursor, events


def push_activity(conn: Connection, client_id: str, entries: list[SyncActivityWrite]) -> int:
    accepted = 0

    for entry in entries:
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO sync_activity (
              id, client_id, mutation_id, label, entity, op, method, path, status,
              attempts, detail, created_at, recorded_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry.id,
                client_id,
                entry.mutation_id,
                entry.label,
                entry.entity,
                entry.op,
                entry.method,
                entry.path,
                entry.status,
                entry.attempts,
                entry.detail,
                entry.created_at.isoformat(),
                entry.recorded_at.isoformat(),
            ),
        )
        accepted += int(cursor.rowcount > 0)

    conn.commit()
    return accepted


def list_activity(conn: Connection, limit: int, client_id: str | None = None) -> list[dict]:
    if client_id:
        return execute_fetchall(
            conn,
            """
            SELECT id, client_id, mutation_id, label, entity, op, method, path, status,
                   attempts, detail, created_at, recorded_at
            FROM sync_activity
            WHERE client_id = ?
            ORDER BY recorded_at DESC
            LIMIT ?
            """,
            (client_id, limit),
        )

    return execute_fetchall(
        conn,
        """
        SELECT id, client_id, mutation_id, label, entity, op, method, path, status,
               attempts, detail, created_at, recorded_at
        FROM sync_activity
        ORDER BY recorded_at DESC
        LIMIT ?
        """,
        (limit,),
    )
