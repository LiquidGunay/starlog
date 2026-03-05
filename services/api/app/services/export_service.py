from sqlite3 import Connection

from app.core.time import utc_now_iso
from app.services.common import execute_fetchall

TABLES = [
    "artifacts",
    "summary_versions",
    "notes",
    "note_blocks",
    "card_set_versions",
    "cards",
    "review_events",
    "tasks",
    "calendar_events",
    "time_blocks",
    "briefing_packages",
    "alarm_plans",
    "domain_events",
    "webhook_subscriptions",
    "provider_configs",
    "google_remote_events",
    "calendar_sync_meta",
    "calendar_sync_conflicts",
    "plugins",
]


def build_export(conn: Connection) -> dict:
    entities: dict[str, list[dict]] = {}
    for table in TABLES:
        entities[table] = execute_fetchall(conn, f"SELECT * FROM {table}")

    notes_markdown = {
        note["id"]: f"# {note['title']}\n\n{note['body_md']}"
        for note in entities["notes"]
    }

    manifest = {
        "table_counts": {table: len(rows) for table, rows in entities.items()},
        "format_version": "v1",
    }

    return {
        "exported_at": utc_now_iso(),
        "manifest": manifest,
        "notes_markdown": notes_markdown,
        "entities": entities,
    }
