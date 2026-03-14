import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.core.config import get_settings

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  passphrase_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  op TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  server_received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_activity (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  label TEXT NOT NULL,
  entity TEXT NOT NULL,
  op TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  created_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  title TEXT,
  raw_content TEXT,
  normalized_content TEXT,
  extracted_content TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  source_filename TEXT,
  content_type TEXT,
  bytes_size INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  storage_relpath TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_runs (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  output_ref TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
);

CREATE TABLE IF NOT EXISTS artifact_relations (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
);

CREATE TABLE IF NOT EXISTS summary_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id),
  UNIQUE(artifact_id, version)
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_blocks (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  artifact_id TEXT,
  block_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
);

CREATE TABLE IF NOT EXISTS card_set_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id),
  UNIQUE(artifact_id, version)
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  card_set_version_id TEXT,
  artifact_id TEXT,
  note_block_id TEXT,
  card_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  due_at TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  repetitions INTEGER NOT NULL,
  ease_factor REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (card_set_version_id) REFERENCES card_set_versions(id),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id),
  FOREIGN KEY (note_block_id) REFERENCES note_blocks(id)
);

CREATE TABLE IF NOT EXISTS review_events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  latency_ms INTEGER,
  reviewed_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  estimate_min INTEGER,
  priority INTEGER NOT NULL,
  due_at TEXT,
  linked_note_id TEXT,
  source_artifact_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (linked_note_id) REFERENCES notes(id),
  FOREIGN KEY (source_artifact_id) REFERENCES artifacts(id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  source TEXT NOT NULL,
  remote_id TEXT,
  etag TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_blocks (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS briefing_packages (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  audio_ref TEXT,
  generated_by_provider TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alarm_plans (
  id TEXT PRIMARY KEY,
  trigger_at TEXT NOT NULL,
  briefing_package_id TEXT NOT NULL,
  device_target TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (briefing_package_id) REFERENCES briefing_packages(id)
);

CREATE TABLE IF NOT EXISTS domain_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  event_type TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_hint TEXT,
  provider_used TEXT,
  artifact_id TEXT,
  action TEXT,
  requested_targets_json TEXT,
  selected_target TEXT,
  claimed_worker_class TEXT,
  payload_json TEXT NOT NULL,
  output_json TEXT,
  error_text TEXT,
  worker_id TEXT,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
);

CREATE TABLE IF NOT EXISTS google_remote_events (
  remote_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  etag TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_sync_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_sync_conflicts (
  id TEXT PRIMARY KEY,
  local_event_id TEXT,
  remote_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  resolution_strategy TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (local_event_id) REFERENCES calendar_events(id)
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_pairings (
  id TEXT PRIMARY KEY,
  pairing_token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  worker_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_sessions (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL UNIQUE,
  worker_label TEXT NOT NULL,
  worker_class TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_conflicts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  current_revision INTEGER NOT NULL,
  local_payload_json TEXT NOT NULL,
  server_payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_strategy TEXT,
  resolution_payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_events_id ON sync_events(id);
CREATE INDEX IF NOT EXISTS idx_sync_activity_recorded ON sync_activity(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_activity_client ON sync_activity(client_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at);
CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets(created_at);
CREATE INDEX IF NOT EXISTS idx_artifact_relations_artifact ON artifact_relations(artifact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_due_at ON cards(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_starts ON calendar_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_deleted ON calendar_events(deleted, starts_at);
CREATE INDEX IF NOT EXISTS idx_time_blocks_start ON time_blocks(starts_at);
CREATE INDEX IF NOT EXISTS idx_briefing_date ON briefing_packages(date);
CREATE INDEX IF NOT EXISTS idx_domain_events_id ON domain_events(id);
CREATE INDEX IF NOT EXISTS idx_provider_name ON provider_configs(provider_name);
CREATE INDEX IF NOT EXISTS idx_app_settings_updated ON app_settings(updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status_created ON ai_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_provider_status ON ai_jobs(provider_hint, status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_selected_target ON ai_jobs(selected_target, status, created_at);
CREATE INDEX IF NOT EXISTS idx_google_remote_updated ON google_remote_events(updated_at);
CREATE INDEX IF NOT EXISTS idx_calendar_conflicts_created ON calendar_sync_conflicts(created_at);
CREATE INDEX IF NOT EXISTS idx_calendar_conflicts_resolved ON calendar_sync_conflicts(resolved, created_at);
CREATE INDEX IF NOT EXISTS idx_plugins_name ON plugins(name);
CREATE INDEX IF NOT EXISTS idx_worker_pairings_expires ON worker_pairings(expires_at);
CREATE INDEX IF NOT EXISTS idx_worker_sessions_class_seen ON worker_sessions(worker_class, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_entity_conflicts_open ON entity_conflicts(status, created_at DESC);
"""


def _ensure_db_parent() -> None:
    settings = get_settings()
    db_path = Path(settings.db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    Path(settings.media_dir).mkdir(parents=True, exist_ok=True)


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    _ensure_db_parent()
    settings = get_settings()
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_storage() -> None:
    with get_connection() as conn:
        conn.executescript(SCHEMA_SQL)
        _ensure_runtime_columns(conn)
        conn.commit()


def _ensure_runtime_columns(conn: sqlite3.Connection) -> None:
    # Keep local dev DBs forward-compatible when columns are added after initial bootstrap.
    _ensure_column(conn, "calendar_events", "deleted", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "calendar_events", "deleted_at", "TEXT")
    _ensure_column(conn, "calendar_events", "revision", "INTEGER NOT NULL DEFAULT 1")
    _ensure_column(conn, "google_remote_events", "deleted", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "google_remote_events", "deleted_at", "TEXT")
    _ensure_column(conn, "calendar_sync_conflicts", "resolved", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "calendar_sync_conflicts", "resolved_at", "TEXT")
    _ensure_column(conn, "calendar_sync_conflicts", "resolution_strategy", "TEXT")
    _ensure_column(conn, "tasks", "revision", "INTEGER NOT NULL DEFAULT 1")
    _ensure_column(conn, "time_blocks", "revision", "INTEGER NOT NULL DEFAULT 1")
    _ensure_column(conn, "ai_jobs", "requested_targets_json", "TEXT")
    _ensure_column(conn, "ai_jobs", "selected_target", "TEXT")
    _ensure_column(conn, "ai_jobs", "claimed_worker_class", "TEXT")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS worker_pairings (
          id TEXT PRIMARY KEY,
          pairing_token_hash TEXT NOT NULL UNIQUE,
          created_by_user_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          worker_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS worker_sessions (
          id TEXT PRIMARY KEY,
          worker_id TEXT NOT NULL UNIQUE,
          worker_label TEXT NOT NULL,
          worker_class TEXT NOT NULL,
          capabilities_json TEXT NOT NULL,
          access_token_hash TEXT NOT NULL UNIQUE,
          refresh_token_hash TEXT NOT NULL UNIQUE,
          access_expires_at TEXT NOT NULL,
          refresh_expires_at TEXT NOT NULL,
          revoked_at TEXT,
          revocation_reason TEXT,
          last_seen_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS entity_conflicts (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          base_revision INTEGER NOT NULL,
          current_revision INTEGER NOT NULL,
          local_payload_json TEXT NOT NULL,
          server_payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolution_strategy TEXT,
          resolution_payload_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ai_jobs_selected_target ON ai_jobs(selected_target, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_worker_pairings_expires ON worker_pairings(expires_at);
        CREATE INDEX IF NOT EXISTS idx_worker_sessions_class_seen ON worker_sessions(worker_class, last_seen_at);
        CREATE INDEX IF NOT EXISTS idx_entity_conflicts_open ON entity_conflicts(status, created_at DESC);
        """
    )


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, declaration: str) -> None:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    if any(row["name"] == column for row in rows):
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")


def row_to_dict(row: sqlite3.Row) -> dict:
    result: dict[str, object] = {}
    for key in row.keys():
        value = row[key]
        if isinstance(value, str) and key.endswith("_json"):
            result[key] = json.loads(value)
        else:
            result[key] = value
    return result
