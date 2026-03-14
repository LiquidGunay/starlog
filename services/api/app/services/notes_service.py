from sqlite3 import Connection

from app.core.time import utc_now
from app.services import conflict_service, events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def create_note(conn: Connection, title: str, body_md: str) -> dict:
    now = utc_now().isoformat()
    note_id = new_id("nte")
    conn.execute(
        "INSERT INTO notes (id, title, body_md, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (note_id, title, body_md, 1, now, now),
    )
    events_service.emit(conn, "note.created", {"note_id": note_id, "title": title})
    conn.commit()
    created = get_note(conn, note_id)
    if created is None:
        raise RuntimeError("Note creation failed")
    return created


def list_notes(conn: Connection) -> list[dict]:
    return execute_fetchall(
        conn,
        "SELECT id, title, body_md, version, created_at, updated_at FROM notes ORDER BY updated_at DESC",
    )


def get_note(conn: Connection, note_id: str) -> dict | None:
    return execute_fetchone(
        conn,
        "SELECT id, title, body_md, version, created_at, updated_at FROM notes WHERE id = ?",
        (note_id,),
    )


def update_note(conn: Connection, note_id: str, changes: dict) -> dict | None:
    current = get_note(conn, note_id)
    if current is None:
        return None

    local_payload = {
        key: value
        for key, value in changes.items()
        if key in {"title", "body_md"} and value is not None
    }
    base_revision = changes.get("base_revision")
    current_revision = int(current["version"])
    if base_revision is not None and int(base_revision) != current_revision:
        conflict = conflict_service.create_conflict(
            conn,
            entity_type="note",
            entity_id=note_id,
            operation="update",
            base_revision=int(base_revision),
            current_revision=current_revision,
            local_payload=local_payload,
            server_payload={
                "id": current["id"],
                "title": current["title"],
                "body_md": current["body_md"],
                "version": current_revision,
                "updated_at": current["updated_at"],
            },
        )
        raise conflict_service.RevisionConflictError(conflict)

    merged = dict(current)
    merged.update(local_payload)
    merged["version"] = int(current["version"]) + 1
    merged["updated_at"] = utc_now().isoformat()

    conn.execute(
        """
        UPDATE notes
        SET title = ?, body_md = ?, version = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            merged["title"],
            merged["body_md"],
            merged["version"],
            merged["updated_at"],
            note_id,
        ),
    )
    events_service.emit(
        conn,
        "note.updated",
        {"note_id": note_id, "version": merged["version"], "title": merged["title"]},
    )
    conn.commit()
    return get_note(conn, note_id)
