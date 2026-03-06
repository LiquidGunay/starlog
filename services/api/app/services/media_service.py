import hashlib
import mimetypes
from pathlib import Path
from sqlite3 import Connection

from app.core.config import get_settings
from app.core.time import utc_now
from app.services.common import execute_fetchone, new_id


def _media_dir() -> Path:
    path = Path(get_settings().media_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _suffix(filename: str | None, content_type: str | None) -> str:
    if filename:
        suffix = Path(filename).suffix.strip()
        if suffix:
            return suffix
    guessed = mimetypes.guess_extension(content_type or "")
    return guessed or ".bin"


def _asset_payload(row: dict) -> dict:
    return {
        "id": row["id"],
        "blob_ref": f"media://{row['id']}",
        "source_filename": row.get("source_filename"),
        "content_type": row.get("content_type"),
        "bytes_size": row["bytes_size"],
        "checksum_sha256": row["checksum_sha256"],
        "storage_relpath": row["storage_relpath"],
        "content_url": f"/v1/media/{row['id']}/content",
        "created_at": row["created_at"],
    }


def create_media_asset(
    conn: Connection,
    *,
    source_filename: str | None,
    content_type: str | None,
    payload: bytes,
) -> dict:
    media_id = new_id("med")
    checksum = hashlib.sha256(payload).hexdigest()
    relpath = f"{media_id}{_suffix(source_filename, content_type)}"
    target = _media_dir() / relpath
    target.write_bytes(payload)

    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO media_assets (
          id, source_filename, content_type, bytes_size, checksum_sha256, storage_relpath, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (media_id, source_filename, content_type, len(payload), checksum, relpath, now),
    )
    conn.commit()
    created = get_media_asset(conn, media_id)
    if created is None:
        raise RuntimeError("Media asset creation failed")
    return created


def get_media_asset(conn: Connection, media_id: str) -> dict | None:
    row = execute_fetchone(conn, "SELECT * FROM media_assets WHERE id = ?", (media_id,))
    return _asset_payload(row) if row is not None else None


def media_asset_path(asset: dict) -> Path:
    return _media_dir() / str(asset["storage_relpath"])
