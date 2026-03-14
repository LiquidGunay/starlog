from sqlite3 import Connection

from app.core.time import utc_now
from app.services import conflict_service, events_service
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
        INSERT INTO calendar_events (
          id, title, starts_at, ends_at, source, remote_id, etag, deleted, deleted_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (event_id, title, iso(starts_at), iso(ends_at), source, remote_id, etag, 0, None, now, now),
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
    return execute_fetchall(conn, "SELECT * FROM calendar_events WHERE deleted = 0 ORDER BY starts_at ASC")


def get_event(conn: Connection, event_id: str, include_deleted: bool = False) -> dict | None:
    if include_deleted:
        return execute_fetchone(conn, "SELECT * FROM calendar_events WHERE id = ?", (event_id,))
    return execute_fetchone(conn, "SELECT * FROM calendar_events WHERE id = ? AND deleted = 0", (event_id,))


def update_event(conn: Connection, event_id: str, changes: dict) -> dict | None:
    event = get_event(conn, event_id, include_deleted=True)
    if event is None:
        return None
    if bool(event.get("deleted")):
        return None

    local_payload: dict = {}
    for key in ("title", "starts_at", "ends_at", "source", "remote_id", "etag"):
        if key not in changes or changes[key] is None:
            continue
        value = changes[key]
        if key in {"starts_at", "ends_at"}:
            value = iso(value)
        local_payload[key] = value

    base_revision = changes.get("base_revision")
    current_revision = int(event["revision"])
    if base_revision is not None and int(base_revision) != current_revision:
        conflict = conflict_service.create_conflict(
            conn,
            entity_type="calendar_event",
            entity_id=event_id,
            operation="update",
            base_revision=int(base_revision),
            current_revision=current_revision,
            local_payload=local_payload,
            server_payload={
                "id": event["id"],
                "title": event["title"],
                "starts_at": event["starts_at"],
                "ends_at": event["ends_at"],
                "source": event["source"],
                "remote_id": event["remote_id"],
                "etag": event["etag"],
                "revision": current_revision,
                "updated_at": event["updated_at"],
            },
        )
        raise conflict_service.RevisionConflictError(conflict)

    merged = dict(event)
    merged.update(local_payload)
    merged["revision"] = current_revision + 1
    merged["updated_at"] = utc_now().isoformat()

    conn.execute(
        """
        UPDATE calendar_events
        SET title = ?, starts_at = ?, ends_at = ?, source = ?, remote_id = ?, etag = ?, revision = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            merged["title"],
            iso(merged["starts_at"]),
            iso(merged["ends_at"]),
            merged["source"],
            merged["remote_id"],
            merged["etag"],
            merged["revision"],
            merged["updated_at"],
            event_id,
        ),
    )
    events_service.emit(
        conn,
        "calendar_event.updated",
        {
            "event_id": event_id,
            "title": merged["title"],
            "source": merged["source"],
            "revision": merged["revision"],
        },
    )
    conn.commit()
    return get_event(conn, event_id)


def delete_event(conn: Connection, event_id: str) -> bool:
    existing = get_event(conn, event_id, include_deleted=True)
    if existing is None:
        return False
    if bool(existing.get("deleted")):
        return True

    now = utc_now().isoformat()
    conn.execute(
        "UPDATE calendar_events SET deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?",
        (now, now, event_id),
    )
    events_service.emit(conn, "calendar_event.deleted", {"event_id": event_id, "source": existing["source"]})
    conn.commit()
    return True
