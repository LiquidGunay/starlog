from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, iso, new_id


def create_event(
    conn: Connection,
    title: str,
    starts_at,
    ends_at,
    source: str,
    remote_id: str | None,
    etag: str | None,
) -> dict:
    now = utc_now().isoformat()
    event_id = new_id("cal")
    conn.execute(
        """
        INSERT INTO calendar_events (id, title, starts_at, ends_at, source, remote_id, etag, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (event_id, title, iso(starts_at), iso(ends_at), source, remote_id, etag, now, now),
    )
    events_service.emit(
        conn,
        "calendar_event.created",
        {"event_id": event_id, "title": title, "source": source},
    )
    conn.commit()
    created = get_event(conn, event_id)
    if created is None:
        raise RuntimeError("Calendar event creation failed")
    return created


def list_events(conn: Connection) -> list[dict]:
    return execute_fetchall(conn, "SELECT * FROM calendar_events ORDER BY starts_at ASC")


def get_event(conn: Connection, event_id: str) -> dict | None:
    return execute_fetchone(conn, "SELECT * FROM calendar_events WHERE id = ?", (event_id,))


def update_event(conn: Connection, event_id: str, changes: dict) -> dict | None:
    event = get_event(conn, event_id)
    if event is None:
        return None

    merged = dict(event)
    merged.update({k: v for k, v in changes.items() if v is not None})
    merged["updated_at"] = utc_now().isoformat()

    conn.execute(
        """
        UPDATE calendar_events
        SET title = ?, starts_at = ?, ends_at = ?, source = ?, remote_id = ?, etag = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            merged["title"],
            iso(merged["starts_at"]),
            iso(merged["ends_at"]),
            merged["source"],
            merged["remote_id"],
            merged["etag"],
            merged["updated_at"],
            event_id,
        ),
    )
    events_service.emit(
        conn,
        "calendar_event.updated",
        {"event_id": event_id, "title": merged["title"], "source": merged["source"]},
    )
    conn.commit()
    return get_event(conn, event_id)
