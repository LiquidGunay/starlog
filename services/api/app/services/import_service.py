import json
from base64 import b64decode
from pathlib import Path
from sqlite3 import Connection

from app.core.config import get_settings
from app.core.time import utc_now
from app.services import events_service
from app.services.common import new_id
from app.services.export_service import TABLES as EXPORT_TABLES


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


def _sqlite_value(column: str, value: object) -> object:
    if column.endswith("_json") and value is not None and not isinstance(value, str):
        return json.dumps(value, sort_keys=True)
    return value


def restore_export(conn: Connection, export_payload: dict, replace_existing: bool = True) -> dict:
    entities = export_payload.get("entities")
    if not isinstance(entities, dict):
        raise ValueError("Export payload missing entities map")
    media_blobs = export_payload.get("media_blobs", {})
    if not isinstance(media_blobs, dict):
        raise ValueError("Export payload media_blobs must be an object")

    original_foreign_keys = int(conn.execute("PRAGMA foreign_keys").fetchone()[0])

    try:
        if replace_existing:
            conn.execute("PRAGMA foreign_keys = OFF")
            for table in reversed(EXPORT_TABLES):
                conn.execute(f"DELETE FROM {table}")
            conn.execute("DELETE FROM sqlite_sequence WHERE name IN (?, ?)", ("sync_events", "domain_events"))

        restored_tables: dict[str, int] = {}
        for table in EXPORT_TABLES:
            rows = entities.get(table, [])
            if not isinstance(rows, list):
                raise ValueError(f"Export payload table '{table}' is not a list")

            columns = [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            if not columns:
                raise ValueError(f"Unknown table in export restore: {table}")

            restored_tables[table] = len(rows)
            if not rows:
                continue

            placeholders = ", ".join(["?"] * len(columns))
            column_sql = ", ".join(columns)
            insert_sql = f"INSERT INTO {table} ({column_sql}) VALUES ({placeholders})"

            for row in rows:
                if not isinstance(row, dict):
                    raise ValueError(f"Export payload row for '{table}' is not an object")
                values = [_sqlite_value(column, row.get(column)) for column in columns]
                conn.execute(insert_sql, values)

        media_dir = Path(get_settings().media_dir)
        media_dir.mkdir(parents=True, exist_ok=True)
        for media in entities.get("media_assets", []):
            if not isinstance(media, dict):
                continue
            media_id = str(media.get("id") or "")
            relpath = str(media.get("storage_relpath") or "").strip()
            if not media_id or not relpath:
                continue
            payload = media_blobs.get(media_id)
            if not isinstance(payload, dict) or not isinstance(payload.get("base64"), str):
                continue
            target = media_dir / relpath
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b64decode(payload["base64"]))

        conn.commit()
        return {
            "restored_tables": restored_tables,
            "restored_at": utc_now().isoformat(),
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute(f"PRAGMA foreign_keys = {'ON' if original_foreign_keys else 'OFF'}")
