import base64
from pathlib import Path
from sqlite3 import Connection

from app.core.config import get_settings
from app.core.time import utc_now_iso
from app.services.common import execute_fetchall

TABLES = [
    "artifacts",
    "media_assets",
    "action_runs",
    "ai_jobs",
    "artifact_relations",
    "summary_versions",
    "notes",
    "note_blocks",
    "card_set_versions",
    "card_decks",
    "cards",
    "review_events",
    "tasks",
    "calendar_events",
    "time_blocks",
    "briefing_packages",
    "alarm_plans",
    "sync_events",
    "sync_activity",
    "domain_events",
    "webhook_subscriptions",
    "provider_configs",
    "app_settings",
    "google_remote_events",
    "calendar_sync_meta",
    "calendar_sync_conflicts",
    "plugins",
    "conversation_threads",
    "conversation_messages",
    "conversation_session_state",
    "conversation_tool_traces",
    "conversation_memory_entries",
    "recommendation_events",
    "memory_pages",
    "memory_page_versions",
    "memory_edges",
    "memory_chunks",
    "memory_profile_proposals",
    "memory_activation_events",
    "memory_suggestions",
    "research_sources",
    "research_items",
    "research_digests",
]


def build_export(conn: Connection) -> dict:
    entities: dict[str, list[dict]] = {}
    for table in TABLES:
        entities[table] = execute_fetchall(conn, f"SELECT * FROM {table}")

    media_dir = Path(get_settings().media_dir)
    media_blobs: dict[str, dict[str, str]] = {}
    for media in entities["media_assets"]:
        relpath = str(media.get("storage_relpath") or "").strip()
        if not relpath:
            continue
        path = media_dir / relpath
        if not path.exists():
            continue
        media_blobs[str(media["id"])] = {
            "base64": base64.b64encode(path.read_bytes()).decode("ascii"),
        }

    notes_markdown = {
        note["id"]: f"# {note['title']}\n\n{note['body_md']}"
        for note in entities["notes"]
    }
    memory_markdown = {
        version["page_id"]: version["markdown_source"]
        for version in entities["memory_page_versions"]
        if isinstance(version.get("page_id"), str)
    }

    manifest = {
        "table_counts": {table: len(rows) for table, rows in entities.items()},
        "format_version": "v1",
    }

    return {
        "exported_at": utc_now_iso(),
        "manifest": manifest,
        "notes_markdown": notes_markdown,
        "memory_markdown": memory_markdown,
        "media_blobs": media_blobs,
        "entities": entities,
    }
