import sqlite3

from app.core.config import get_settings
from app.db.storage import get_connection, init_storage


LEGACY_SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

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

CREATE TABLE IF NOT EXISTS note_blocks (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  artifact_id TEXT,
  block_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_set_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL
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
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_due_at ON cards(due_at);
"""


def test_init_storage_migrates_legacy_cards_without_deck_columns(
    tmp_path,
    monkeypatch,
) -> None:
    db_path = tmp_path / "legacy.db"
    media_dir = tmp_path / "media"
    monkeypatch.setenv("STARLOG_DB_PATH", str(db_path))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(media_dir))
    get_settings.cache_clear()

    conn = sqlite3.connect(db_path)
    conn.executescript(LEGACY_SCHEMA_SQL)
    conn.execute(
        """
        INSERT INTO cards (
          id, card_set_version_id, artifact_id, note_block_id, card_type, prompt, answer,
          due_at, interval_days, repetitions, ease_factor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "crd_legacy",
            None,
            None,
            None,
            "qa",
            "legacy prompt",
            "legacy answer",
            "2026-04-01T00:00:00+00:00",
            1,
            0,
            2.5,
            "2026-04-01T00:00:00+00:00",
        ),
    )
    conn.commit()
    conn.close()

    init_storage()

    with get_connection() as migrated:
        columns = [row["name"] for row in migrated.execute("PRAGMA table_info(cards)").fetchall()]
        assert "deck_id" in columns
        assert "tags_json" in columns
        assert "suspended" in columns
        assert "updated_at" in columns

        deck_index = migrated.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_cards_deck_due_at'"
        ).fetchone()
        assert deck_index is not None

        row = migrated.execute(
            "SELECT deck_id, tags_json, suspended, updated_at FROM cards WHERE id = 'crd_legacy'"
        ).fetchone()
        assert row is not None
        assert row["tags_json"] == "[]"
        assert row["suspended"] == 0
        assert row["updated_at"] == "2026-04-01T00:00:00+00:00"

    get_settings.cache_clear()
