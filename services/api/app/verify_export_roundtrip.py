"""Verify that Starlog export payloads can be restored into a fresh database."""

from __future__ import annotations

import argparse
import sqlite3
import sys
import tempfile
from pathlib import Path

from app.core.config import get_settings
from app.db.storage import SCHEMA_SQL
from app.services import export_service, import_service


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _table_ids(payload: dict, table: str) -> set[str]:
    rows = payload["entities"].get(table, [])
    ids: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        if isinstance(row.get("id"), str):
            ids.add(str(row["id"]))
        elif isinstance(row.get("remote_id"), str):
            ids.add(str(row["remote_id"]))
    return ids


def verify_roundtrip(source_db: Path) -> tuple[bool, list[str]]:
    issues: list[str] = []

    with _connect(source_db) as source_conn:
        exported = export_service.build_export(source_conn)

    with tempfile.TemporaryDirectory(prefix="starlog-roundtrip-") as temp_dir:
        restore_db = Path(temp_dir) / "restore.db"
        with _connect(restore_db) as restore_conn:
            restore_conn.executescript(SCHEMA_SQL)
            restore_conn.commit()
            import_service.restore_export(restore_conn, exported, replace_existing=True)
            reexported = export_service.build_export(restore_conn)

    for table in export_service.TABLES:
        original_count = int(exported["manifest"]["table_counts"].get(table, 0))
        restored_count = int(reexported["manifest"]["table_counts"].get(table, 0))
        if original_count != restored_count:
            issues.append(f"{table}: expected {original_count}, restored {restored_count}")

    for table in ["artifacts", "action_runs", "artifact_relations", "notes", "tasks", "cards", "plugins"]:
        if _table_ids(exported, table) != _table_ids(reexported, table):
            issues.append(f"{table}: id set mismatch after roundtrip")

    if set(exported.get("media_blobs", {})) != set(reexported.get("media_blobs", {})):
        issues.append("media_blobs: id set mismatch after roundtrip")

    return len(issues) == 0, issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db-path",
        default=get_settings().db_path,
        help="Path to the source SQLite database (defaults to STARLOG_DB_PATH).",
    )
    args = parser.parse_args()

    source_db = Path(args.db_path)
    if not source_db.exists():
        print(f"Source database does not exist: {source_db}", file=sys.stderr)
        return 1

    ok, issues = verify_roundtrip(source_db)
    if ok:
        print(f"Roundtrip verified for {source_db}")
        return 0

    print("Roundtrip verification failed:", file=sys.stderr)
    for issue in issues:
        print(f"- {issue}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
