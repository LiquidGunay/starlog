import json
from sqlite3 import Connection

from app.core.time import utc_now
from app.services.common import execute_fetchall, new_id


def emit(conn: Connection, event_type: str, payload: dict) -> int:
    cursor = conn.execute(
        "INSERT INTO domain_events (event_type, payload_json, created_at) VALUES (?, ?, ?)",
        (event_type, json.dumps(payload, sort_keys=True), utc_now().isoformat()),
    )
    row_id = cursor.lastrowid
    if row_id is None:
        raise RuntimeError("Domain event emit failed")
    return int(row_id)


def list_events(conn: Connection, cursor: int, limit: int = 100) -> list[dict]:
    rows = execute_fetchall(
        conn,
        "SELECT id, event_type, payload_json, created_at FROM domain_events WHERE id > ? ORDER BY id ASC LIMIT ?",
        (cursor, limit),
    )
    events: list[dict] = []
    for row in rows:
        events.append(
            {
                "id": row["id"],
                "event_type": row["event_type"],
                "payload": row["payload_json"],
                "created_at": row["created_at"],
            }
        )
    return events


def create_webhook(conn: Connection, url: str, event_type: str) -> dict:
    webhook_id = new_id("whk")
    now = utc_now().isoformat()
    conn.execute(
        "INSERT INTO webhook_subscriptions (id, url, event_type, active, created_at) VALUES (?, ?, ?, ?, ?)",
        (webhook_id, url, event_type, 1, now),
    )
    conn.commit()
    row = execute_fetchall(
        conn,
        "SELECT id, url, event_type, active, created_at FROM webhook_subscriptions WHERE id = ?",
        (webhook_id,),
    )
    return row[0]


def list_webhooks(conn: Connection) -> list[dict]:
    return execute_fetchall(
        conn,
        "SELECT id, url, event_type, active, created_at FROM webhook_subscriptions ORDER BY created_at DESC",
    )
