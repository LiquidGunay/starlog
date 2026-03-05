from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
from app.services.common import new_id


def import_markdown_note(conn: Connection, title: str, markdown: str) -> dict:
    now = utc_now().isoformat()
    note_id = new_id("nte")

    conn.execute(
        "INSERT INTO notes (id, title, body_md, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (note_id, title, markdown, 1, now, now),
    )
    conn.execute(
        "INSERT INTO note_blocks (id, note_id, artifact_id, block_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (new_id("blk"), note_id, None, "markdown_import", markdown[:1000], now),
    )
    events_service.emit(conn, "markdown.imported", {"note_id": note_id, "title": title})
    conn.commit()

    return {
        "note_id": note_id,
        "created_at": now,
    }
