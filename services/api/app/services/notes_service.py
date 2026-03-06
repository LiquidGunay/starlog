from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
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

    merged = dict(current)
    merged.update({key: value for key, value in changes.items() if value is not None})
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
