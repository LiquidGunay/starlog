#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
API_DIR = ROOT_DIR / "services/api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))
SCRIPTS_DIR = ROOT_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import interview_prep_quality  # noqa: E402

DECK_NAME = "ML Interviews Part II"
DECK_DESCRIPTION = "Machine learning interview study cards from ML Interviews Book Part II."
SOURCE_URL = "https://huyenchip.com/ml-interviews-book/contents/part-ii.-questions.html"
ARTIFACT_TITLE = "ML Interviews Part II SRS bootstrap"
NOTE_TITLE = "ML Interviews Part II SRS deck"
IMPORT_KEY_PREFIX = "ml-interviews-part-ii"
QUALITY_SPEC = interview_prep_quality.load_quality_spec()


def load_cards(path: Path) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    seen_indexes: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                record = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON on line {line_number}") from exc
            if not isinstance(record, dict):
                raise ValueError(f"Line {line_number} must be a JSON object")
            for key in ("prompt", "answer", "source_url", "section", "question_index", "question"):
                if not isinstance(record.get(key), str) or not record[key].strip():
                    raise ValueError(f"Line {line_number} missing required string field: {key}")
            metadata = record.get("metadata")
            if metadata is not None and not isinstance(metadata, dict):
                raise ValueError(f"Line {line_number} metadata must be an object when present")
            question_index = record["question_index"].strip()
            if question_index in seen_indexes:
                raise ValueError(f"Line {line_number} duplicates question_index: {question_index}")
            seen_indexes.add(question_index)
            cards.append(record)
    if not cards:
        raise ValueError("Deck file contained no cards")
    return cards


def slug_tag(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "unknown"


def db_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return slug or "unknown"


def db_id(prefix: str, *parts: object) -> str:
    return f"{prefix}_{'_'.join(db_slug(str(part)) for part in parts if str(part).strip())}"


def json_compact(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def stable_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def record_changed(row: Any, expected: dict[str, Any]) -> bool:
    return any(row[key] != value for key, value in expected.items())


def upsert_status(existed: bool, changed: bool) -> dict[str, int]:
    return {
        "created": 0 if existed else 1,
        "updated": 1 if existed and changed else 0,
        "unchanged": 1 if existed and not changed else 0,
    }


def merge_status(target: dict[str, int], status: dict[str, int]) -> None:
    for key in ("created", "updated", "unchanged"):
        target[key] = target.get(key, 0) + int(status.get(key, 0))


def stable_card_key(card: dict[str, Any]) -> str:
    question_index = str(card.get("question_index") or "").strip()
    if question_index:
        return f"{IMPORT_KEY_PREFIX}:{question_index}"
    prompt = str(card.get("prompt") or "").strip()
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]
    return f"{IMPORT_KEY_PREFIX}:prompt:{digest}"


def stable_card_tags(card: dict[str, Any]) -> list[str]:
    metadata = card.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    section = str(card.get("section") or metadata.get("section") or "unknown-section")
    difficulty = str(card.get("difficulty") or metadata.get("difficulty") or "unspecified")
    source = str(metadata.get("answer_source") or metadata.get("source_url") or card.get("source_url") or "unknown-source")
    quality = card_quality_metadata(card)
    return [
        "ml-interviews-part-ii",
        "interview-prep",
        "topic-gated",
        f"style-{slug_tag(str(quality['question_style_id']))}",
        f"section-{slug_tag(section)}",
        f"difficulty-{slug_tag(difficulty)}",
        f"source-{slug_tag(source)}",
    ]


def _quality_style(style_id: str) -> dict[str, Any]:
    for style in interview_prep_quality.question_styles(QUALITY_SPEC):
        if style["id"] == style_id:
            return style
    raise ValueError(f"Unknown interview prep question style: {style_id}")


def card_quality_metadata(card: dict[str, Any]) -> dict[str, Any]:
    metadata = card.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    provided = metadata.get("question_quality")
    if isinstance(provided, dict) and isinstance(provided.get("question_style_id"), str):
        style = _quality_style(provided["question_style_id"])
        quality = interview_prep_quality.style_metadata(style)
        quality.update({key: value for key, value in provided.items() if key not in quality})
        return quality
    return interview_prep_quality.style_metadata(_quality_style("conceptual_recall"))


def build_note_block_content(card: dict[str, Any]) -> str:
    metadata = card.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    answer_source = str(metadata.get("answer_source") or "unknown").strip()
    source_url = str(card.get("source_url") or metadata.get("source_url") or "").strip()
    source_path = str(metadata.get("source_path") or "").strip()
    section = str(card.get("section") or metadata.get("section") or "").strip()
    question_index = str(card.get("question_index") or metadata.get("question_index") or "").strip()
    difficulty = str(card.get("difficulty") or metadata.get("difficulty") or "").strip()
    question = str(card.get("question") or card.get("prompt") or "").strip()
    answer = str(card.get("answer") or "").strip()
    quality = card_quality_metadata(card)
    metadata_json = json.dumps(metadata, indent=2, sort_keys=True)

    lines = [
        f"Import Key: {stable_card_key(card)}",
        f"Question Style: {quality['question_style_id']}",
        f"Progression Stage: {quality['progression_stage']}",
        f"Progression Gate: {QUALITY_SPEC['progression_gating']['gate_kind']}",
        f"Source URL: {source_url}",
        f"Source Path: {source_path or 'unspecified'}",
        f"Section: {section}",
        f"Question Index: {question_index}",
        f"Difficulty: {difficulty or 'unspecified'}",
        f"Answer Source: {answer_source}",
        f"Tags: {', '.join(stable_card_tags(card))}",
        "",
        "Question:",
        question,
        "",
        "Answer:",
        answer,
        "",
        "Metadata:",
        metadata_json,
        "",
        "Quality Spec:",
        json.dumps(interview_prep_quality.quality_spec_summary(QUALITY_SPEC), indent=2, sort_keys=True),
    ]
    return "\n".join(lines).strip()


def build_deck_note_body(card_count: int) -> str:
    return (
        "# ML Interviews Part II SRS deck\n\n"
        f"Source: {SOURCE_URL}\n\n"
        f"Deck: {DECK_NAME}\n\n"
        f"Cards: {card_count}\n\n"
        "Each card stores source URL, source path, section, difficulty, answer source, stable import key, "
        "question-style metadata, progression-gating metadata, and full source metadata in its linked note block."
    )


def extract_import_key(content: str | None) -> str | None:
    if not content:
        return None
    match = re.search(r"^Import Key:\s*(.+?)\s*$", content, flags=re.MULTILINE)
    if match:
        return match.group(1).strip()
    match = re.search(r"^Question Index:\s*(.+?)\s*$", content, flags=re.MULTILINE)
    if match:
        return f"{IMPORT_KEY_PREFIX}:{match.group(1).strip()}"
    return None


def _relative_deck_path(deck_path: Path) -> str:
    try:
        return str(deck_path.resolve().relative_to(ROOT_DIR))
    except ValueError:
        return str(deck_path)


def _artifact_payload(deck_path: Path, cards: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "source_type": "srs_bootstrap",
        "title": ARTIFACT_TITLE,
        "raw_content": f"ML Interviews Part II questions\nSource: {SOURCE_URL}",
        "normalized_content": "Bootstrap SRS deck for ML Interviews Book Part II.",
        "extracted_content": json.dumps(cards, indent=2, sort_keys=True),
        "metadata": {
            "bootstrap": True,
            "import_key": IMPORT_KEY_PREFIX,
            "deck_name": DECK_NAME,
            "quality_spec": interview_prep_quality.quality_spec_summary(QUALITY_SPEC),
            "deck_path": _relative_deck_path(deck_path),
            "source_url": SOURCE_URL,
            "card_count": len(cards),
        },
    }


def _source_id() -> str:
    return db_id("study_src", IMPORT_KEY_PREFIX)


def _section_title(card: dict[str, Any]) -> str:
    metadata = card.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    return str(card.get("section") or metadata.get("section") or "Unsectioned").strip() or "Unsectioned"


def _section_titles(cards: list[dict[str, Any]]) -> list[str]:
    titles: list[str] = []
    seen: set[str] = set()
    for card in cards:
        title = _section_title(card)
        if title in seen:
            continue
        seen.add(title)
        titles.append(title)
    return titles


def _section_topic_id(source_id: str, section: str) -> str:
    return db_id("study_topic", source_id, section)


def _source_metadata(deck_path: Path, cards: list[dict[str, Any]]) -> dict[str, Any]:
    sections = [_section_title(card) for card in cards]
    difficulties = [
        str(card.get("difficulty") or (card.get("metadata") or {}).get("difficulty") or "unspecified")
        for card in cards
    ]
    return {
        "import_key": IMPORT_KEY_PREFIX,
        "deck_name": DECK_NAME,
        "deck_path": _relative_deck_path(deck_path),
        "source_url": SOURCE_URL,
        "card_count": len(cards),
        "section_count": len(set(sections)),
        "section_counts": dict(Counter(sections)),
        "difficulty_counts": dict(Counter(difficulties)),
        "quality_spec": interview_prep_quality.quality_spec_summary(QUALITY_SPEC),
        "question_style_counts": dict(Counter(str(card_quality_metadata(card)["question_style_id"]) for card in cards)),
        "progression_gating": QUALITY_SPEC["progression_gating"],
        "content_hash": stable_hash(cards),
    }


def _upsert_study_source(conn: Any, deck_path: Path, cards: list[dict[str, Any]], artifact_id: str, now_iso: str) -> tuple[str, dict[str, int]]:
    source_id = _source_id()
    expected = {
        "title": DECK_NAME,
        "source_type": "interview_prep",
        "artifact_id": artifact_id,
        "url": SOURCE_URL,
        "metadata_json": json_compact(_source_metadata(deck_path, cards)),
    }
    row = conn.execute("SELECT * FROM study_sources WHERE id = ?", (source_id,)).fetchone()
    if row is None:
        conn.execute(
            """
            INSERT INTO study_sources (id, title, source_type, artifact_id, url, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_id,
                expected["title"],
                expected["source_type"],
                expected["artifact_id"],
                expected["url"],
                expected["metadata_json"],
                now_iso,
                now_iso,
            ),
        )
        return source_id, upsert_status(False, True)

    changed = record_changed(row, expected)
    if changed:
        conn.execute(
            """
            UPDATE study_sources
            SET title = ?, source_type = ?, artifact_id = ?, url = ?, metadata_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                expected["title"],
                expected["source_type"],
                expected["artifact_id"],
                expected["url"],
                expected["metadata_json"],
                now_iso,
                source_id,
            ),
        )
    return source_id, upsert_status(True, changed)


def _section_summary(section: str, cards: list[dict[str, Any]]) -> str:
    section_cards = [card for card in cards if _section_title(card) == section]
    difficulty_counts = Counter(
        str(card.get("difficulty") or (card.get("metadata") or {}).get("difficulty") or "unspecified")
        for card in section_cards
    )
    mix = ", ".join(f"{key}: {difficulty_counts[key]}" for key in sorted(difficulty_counts))
    return f"ML Interviews Part II section with {len(section_cards)} review cards. Difficulty mix: {mix}."


def _upsert_section_topics(conn: Any, source_id: str, cards: list[dict[str, Any]], now_iso: str) -> dict[str, int]:
    status = {"created": 0, "updated": 0, "unchanged": 0, "deleted": 0}
    for display_order, section in enumerate(_section_titles(cards), start=1):
        topic_id = _section_topic_id(source_id, section)
        expected = {
            "source_id": source_id,
            "parent_topic_id": None,
            "title": section,
            "summary": _section_summary(section, cards),
            "display_order": display_order,
        }
        row = conn.execute("SELECT * FROM study_topics WHERE id = ?", (topic_id,)).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO study_topics (
                  id, source_id, parent_topic_id, title, summary, display_order, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    topic_id,
                    expected["source_id"],
                    expected["parent_topic_id"],
                    expected["title"],
                    expected["summary"],
                    expected["display_order"],
                    now_iso,
                    now_iso,
                ),
            )
            merge_status(status, upsert_status(False, True))
            continue

        changed = record_changed(row, expected)
        if changed:
            conn.execute(
                """
                UPDATE study_topics
                SET source_id = ?, parent_topic_id = ?, title = ?, summary = ?, display_order = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    expected["source_id"],
                    expected["parent_topic_id"],
                    expected["title"],
                    expected["summary"],
                    expected["display_order"],
                    now_iso,
                    topic_id,
                ),
            )
        merge_status(status, upsert_status(True, changed))
    return status


def _delete_stale_section_topics(conn: Any, source_id: str, cards: list[dict[str, Any]]) -> int:
    current_topic_ids = {_section_topic_id(source_id, section) for section in _section_titles(cards)}
    topic_id_prefix = f"{db_id('study_topic', source_id)}_%"
    if not current_topic_ids:
        return 0
    placeholders = ",".join("?" for _ in current_topic_ids)
    stale_rows = conn.execute(
        f"""
        SELECT id
        FROM study_topics
        WHERE source_id = ?
          AND id LIKE ?
          AND id NOT IN ({placeholders})
        """,
        (source_id, topic_id_prefix, *sorted(current_topic_ids)),
    ).fetchall()
    stale_topic_ids = [str(row["id"]) for row in stale_rows]
    if not stale_topic_ids:
        return 0

    stale_placeholders = ",".join("?" for _ in stale_topic_ids)
    conn.execute(
        f"DELETE FROM study_topic_progress WHERE topic_id IN ({stale_placeholders})",
        tuple(stale_topic_ids),
    )
    cursor = conn.execute(
        f"""
        DELETE FROM study_topics
        WHERE source_id = ?
          AND id LIKE ?
          AND id IN ({stale_placeholders})
        """,
        (source_id, topic_id_prefix, *stale_topic_ids),
    )
    return max(cursor.rowcount, 0)


def _section_chunk_content(section: str, cards: list[dict[str, Any]]) -> str:
    section_cards = [card for card in cards if _section_title(card) == section]
    prompts = "\n".join(
        f"- {card['question_index']}: {str(card.get('question') or card.get('prompt') or '').strip()}"
        for card in section_cards
    )
    source_urls = sorted({str(card.get("source_url") or "").strip() for card in section_cards if card.get("source_url")})
    return "\n".join(
        [
            f"# {section}",
            "",
            f"Source URLs: {', '.join(source_urls) or SOURCE_URL}",
            f"Cards: {len(section_cards)}",
            "",
            "Questions:",
            prompts,
        ]
    ).strip()


def _upsert_source_chunks(
    conn: Any,
    source_id: str,
    artifact_id: str,
    cards: list[dict[str, Any]],
    now_iso: str,
) -> dict[str, int]:
    status = {"created": 0, "updated": 0, "unchanged": 0, "deleted": 0}
    current_topic_ids = {_section_topic_id(source_id, section) for section in _section_titles(cards)}
    current_chunk_indexes = set(range(1, len(current_topic_ids) + 1))
    for chunk_index, section in enumerate(_section_titles(cards), start=1):
        topic_id = _section_topic_id(source_id, section)
        section_cards = [card for card in cards if _section_title(card) == section]
        expected = {
            "source_id": source_id,
            "topic_id": topic_id,
            "artifact_id": artifact_id,
            "chunk_index": chunk_index,
            "content": _section_chunk_content(section, cards),
            "metadata_json": json_compact(
                {
                    "import_key": IMPORT_KEY_PREFIX,
                    "section": section,
                    "card_count": len(section_cards),
                    "question_indexes": [card["question_index"] for card in section_cards],
                    "content_hash": stable_hash(section_cards),
                }
            ),
        }
        row = conn.execute(
            "SELECT * FROM source_chunks WHERE source_id = ? AND chunk_index = ?",
            (source_id, chunk_index),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO source_chunks (
                  id, source_id, topic_id, artifact_id, chunk_index, content, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    db_id("study_chunk", source_id, chunk_index),
                    expected["source_id"],
                    expected["topic_id"],
                    expected["artifact_id"],
                    expected["chunk_index"],
                    expected["content"],
                    expected["metadata_json"],
                    now_iso,
                ),
            )
            merge_status(status, upsert_status(False, True))
            continue

        changed = record_changed(row, expected)
        if changed:
            conn.execute(
                """
                UPDATE source_chunks
                SET source_id = ?, topic_id = ?, artifact_id = ?, chunk_index = ?, content = ?, metadata_json = ?
                WHERE id = ?
                """,
                (
                    expected["source_id"],
                    expected["topic_id"],
                    expected["artifact_id"],
                    expected["chunk_index"],
                    expected["content"],
                    expected["metadata_json"],
                    row["id"],
                ),
            )
        merge_status(status, upsert_status(True, changed))
    if current_topic_ids and current_chunk_indexes:
        topic_placeholders = ",".join("?" for _ in current_topic_ids)
        chunk_placeholders = ",".join("?" for _ in current_chunk_indexes)
        cursor = conn.execute(
            f"""
            DELETE FROM source_chunks
            WHERE source_id = ?
              AND id LIKE ?
              AND (
                topic_id NOT IN ({topic_placeholders})
                OR chunk_index NOT IN ({chunk_placeholders})
              )
            """,
            (
                source_id,
                f"{db_id('study_chunk', source_id)}_%",
                *sorted(current_topic_ids),
                *sorted(current_chunk_indexes),
            ),
        )
        status["deleted"] += max(cursor.rowcount, 0)
    return status


def _decoded_schedule(value: Any, fallback: dict[str, Any]) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return fallback
        if isinstance(decoded, dict):
            return decoded
    return fallback


def _ensure_deck(
    conn: Any, new_id: Any, default_schedule: dict[str, Any], now_iso: str
) -> tuple[str, dict[str, Any]]:
    deck = conn.execute(
        "SELECT id, schedule_json FROM card_decks WHERE name = ?",
        (DECK_NAME,),
    ).fetchone()
    if deck is not None:
        return str(deck["id"]), _decoded_schedule(deck["schedule_json"], default_schedule)

    deck_id = new_id("cdk")
    conn.execute(
        """
        INSERT INTO card_decks (id, name, description, schedule_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            deck_id,
            DECK_NAME,
            DECK_DESCRIPTION,
            json.dumps(default_schedule, sort_keys=True),
            now_iso,
            now_iso,
        ),
    )
    return deck_id, default_schedule


def _ensure_artifact(conn: Any, new_id: Any, deck_path: Path, cards: list[dict[str, Any]], now_iso: str) -> str:
    payload = _artifact_payload(deck_path, cards)
    artifact_row = conn.execute(
        """
        SELECT id
        FROM artifacts
        WHERE source_type = ? AND title = ?
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (payload["source_type"], payload["title"]),
    ).fetchone()
    metadata_json = json.dumps(payload["metadata"], sort_keys=True)
    if artifact_row is None:
        artifact_id = new_id("art")
        conn.execute(
            """
            INSERT INTO artifacts (
              id, source_type, title, raw_content, normalized_content, extracted_content,
              metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_id,
                payload["source_type"],
                payload["title"],
                payload["raw_content"],
                payload["normalized_content"],
                payload["extracted_content"],
                metadata_json,
                now_iso,
                now_iso,
            ),
        )
        return artifact_id

    artifact_id = str(artifact_row["id"])
    conn.execute(
        """
        UPDATE artifacts
        SET raw_content = ?, normalized_content = ?, extracted_content = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            payload["raw_content"],
            payload["normalized_content"],
            payload["extracted_content"],
            metadata_json,
            now_iso,
            artifact_id,
        ),
    )
    return artifact_id


def _ensure_card_set_version(conn: Any, new_id: Any, artifact_id: str, now_iso: str) -> str:
    version_row = conn.execute(
        "SELECT id FROM card_set_versions WHERE artifact_id = ? AND version = 1",
        (artifact_id,),
    ).fetchone()
    if version_row is not None:
        return str(version_row["id"])

    card_set_version_id = new_id("csv")
    conn.execute(
        "INSERT INTO card_set_versions (id, artifact_id, version, created_at) VALUES (?, ?, ?, ?)",
        (card_set_version_id, artifact_id, 1, now_iso),
    )
    return card_set_version_id


def _ensure_note(conn: Any, new_id: Any, artifact_id: str, card_count: int, now_iso: str) -> str:
    relation = conn.execute(
        """
        SELECT target_id
        FROM artifact_relations
        WHERE artifact_id = ? AND relation_type = ? AND target_type = ?
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (artifact_id, "artifact.note", "note"),
    ).fetchone()
    body = build_deck_note_body(card_count)
    if relation is None:
        note_id = new_id("nte")
        conn.execute(
            "INSERT INTO notes (id, title, body_md, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (note_id, NOTE_TITLE, body, 1, now_iso, now_iso),
        )
        _ensure_relation(conn, new_id, artifact_id, "artifact.note", "note", note_id, now_iso)
        return note_id

    note_id = str(relation["target_id"])
    existing_note = conn.execute("SELECT title, body_md, version FROM notes WHERE id = ?", (note_id,)).fetchone()
    if existing_note is None:
        conn.execute(
            "INSERT INTO notes (id, title, body_md, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (note_id, NOTE_TITLE, body, 1, now_iso, now_iso),
        )
    elif existing_note["title"] != NOTE_TITLE or existing_note["body_md"] != body:
        conn.execute(
            "UPDATE notes SET title = ?, body_md = ?, version = ?, updated_at = ? WHERE id = ?",
            (NOTE_TITLE, body, int(existing_note["version"]) + 1, now_iso, note_id),
        )
    return note_id


def _ensure_relation(
    conn: Any,
    new_id: Any,
    artifact_id: str,
    relation_type: str,
    target_type: str,
    target_id: str,
    now_iso: str,
) -> None:
    existing = conn.execute(
        """
        SELECT id
        FROM artifact_relations
        WHERE artifact_id = ? AND relation_type = ? AND target_type = ? AND target_id = ?
        LIMIT 1
        """,
        (artifact_id, relation_type, target_type, target_id),
    ).fetchone()
    if existing is not None:
        return
    conn.execute(
        """
        INSERT INTO artifact_relations (
          id, artifact_id, relation_type, target_type, target_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (new_id("rel"), artifact_id, relation_type, target_type, target_id, now_iso),
    )


def _existing_cards_by_key(conn: Any, card_set_version_id: str) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT
          c.id,
          c.artifact_id,
          c.note_block_id,
          c.deck_id,
          c.card_type,
          c.prompt,
          c.answer,
          c.tags_json,
          nb.content AS note_content
        FROM cards c
        LEFT JOIN note_blocks nb ON nb.id = c.note_block_id
        WHERE c.card_set_version_id = ?
        """,
        (card_set_version_id,),
    ).fetchall()
    existing_by_key: dict[str, Any] = {}
    for row in rows:
        key = extract_import_key(row["note_content"])
        if key:
            existing_by_key[key] = row
    return existing_by_key


def _insert_card(
    conn: Any,
    new_id: Any,
    card: dict[str, Any],
    *,
    artifact_id: str,
    note_id: str,
    card_set_version_id: str,
    deck_id: str,
    schedule: dict[str, Any],
    now_iso: str,
) -> None:
    note_block_id = new_id("blk")
    conn.execute(
        """
        INSERT INTO note_blocks (id, note_id, artifact_id, block_type, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (note_block_id, note_id, artifact_id, "srs_card", build_note_block_content(card), now_iso),
    )
    conn.execute(
        """
        INSERT INTO cards (
          id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type, prompt, answer,
          tags_json, suspended, due_at, interval_days, repetitions, ease_factor, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("crd"),
            card_set_version_id,
            artifact_id,
            note_block_id,
            deck_id,
            str(card.get("card_type") or "qa"),
            card["prompt"],
            card["answer"],
            json.dumps(stable_card_tags(card), sort_keys=True),
            0,
            (datetime.fromisoformat(now_iso) + timedelta(hours=int(schedule["new_cards_due_offset_hours"]))).isoformat(),
            int(schedule["initial_interval_days"]),
            0,
            float(schedule["initial_ease_factor"]),
            now_iso,
            now_iso,
        ),
    )

def _update_card_if_needed(
    conn: Any,
    new_id: Any,
    existing_card: Any,
    card: dict[str, Any],
    *,
    artifact_id: str,
    note_id: str,
    deck_id: str,
    now_iso: str,
) -> bool:
    note_content = build_note_block_content(card)
    note_block_id = existing_card["note_block_id"]
    note_changed = existing_card["note_content"] != note_content
    if note_block_id is None:
        note_block_id = new_id("blk")
        conn.execute(
            """
            INSERT INTO note_blocks (id, note_id, artifact_id, block_type, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (note_block_id, note_id, artifact_id, "srs_card", note_content, now_iso),
        )
        note_changed = True
    elif note_changed:
        conn.execute(
            "UPDATE note_blocks SET note_id = ?, artifact_id = ?, content = ? WHERE id = ?",
            (note_id, artifact_id, note_content, note_block_id),
        )

    tags_json = json.dumps(stable_card_tags(card), sort_keys=True)
    current_tags_json = existing_card["tags_json"]
    if not isinstance(current_tags_json, str):
        current_tags_json = json.dumps(current_tags_json, sort_keys=True)
    changed = (
        note_changed
        or existing_card["artifact_id"] != artifact_id
        or existing_card["note_block_id"] != note_block_id
        or existing_card["deck_id"] != deck_id
        or existing_card["card_type"] != str(card.get("card_type") or "qa")
        or existing_card["prompt"] != card["prompt"]
        or existing_card["answer"] != card["answer"]
        or current_tags_json != tags_json
    )
    if not changed:
        return False

    conn.execute(
        """
        UPDATE cards
        SET artifact_id = ?, note_block_id = ?, deck_id = ?, card_type = ?, prompt = ?,
            answer = ?, tags_json = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            artifact_id,
            note_block_id,
            deck_id,
            str(card.get("card_type") or "qa"),
            card["prompt"],
            card["answer"],
            tags_json,
            now_iso,
            existing_card["id"],
        ),
    )
    return True


def _upsert_card_topic_links(
    conn: Any,
    *,
    source_id: str,
    card_set_version_id: str,
    cards: list[dict[str, Any]],
    now_iso: str,
) -> dict[str, int]:
    status = {"created": 0, "updated": 0, "unchanged": 0, "deleted": 0, "section_links": 0}
    cards_by_key = _existing_cards_by_key(conn, card_set_version_id)
    source_topic_ids = {
        _section_topic_id(source_id, section)
        for section in _section_titles(cards)
    }
    link_id_prefix = f"{db_id('card_topic', IMPORT_KEY_PREFIX)}%"
    for card in cards:
        card_key = stable_card_key(card)
        card_row = cards_by_key.get(card_key)
        if card_row is None:
            raise RuntimeError(f"Imported card missing after upsert: {card_key}")
        card_id = str(card_row["id"])
        section = _section_title(card)
        topic_id = _section_topic_id(source_id, section)
        link_id = db_id("card_topic", card_key, "section", section)
        row = conn.execute(
            "SELECT * FROM card_topic_links WHERE card_id = ? AND topic_id = ?",
            (card_id, topic_id),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO card_topic_links (id, card_id, topic_id, gate_required, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (link_id, card_id, topic_id, 1, now_iso),
            )
            merge_status(status, upsert_status(False, True))
        else:
            row_id = str(row["id"])
            id_changed = row_id != link_id and row_id.startswith(db_id("card_topic", card_key))
            gate_changed = int(row["gate_required"]) != 1
            changed = id_changed or gate_changed
            if changed:
                conn.execute(
                    "UPDATE card_topic_links SET id = ?, gate_required = ? WHERE card_id = ? AND topic_id = ?",
                    (link_id if id_changed else row_id, 1, card_id, topic_id),
                )
            merge_status(status, upsert_status(True, changed))
        status["section_links"] += 1

        stale_cursor = conn.execute(
            """
            DELETE FROM card_topic_links
            WHERE card_id = ?
              AND id LIKE ?
              AND topic_id != ?
            """,
            (
                card_id,
                f"{db_id('card_topic', card_key)}%",
                topic_id,
            ),
        )
        status["deleted"] += max(stale_cursor.rowcount, 0)
    if source_topic_ids:
        placeholders = ",".join("?" for _ in source_topic_ids)
        stale_source_cursor = conn.execute(
            f"""
            DELETE FROM card_topic_links
            WHERE id LIKE ?
              AND topic_id IN (
                SELECT id
                FROM study_topics
                WHERE source_id = ?
              )
              AND topic_id NOT IN ({placeholders})
            """,
            (link_id_prefix, source_id, *sorted(source_topic_ids)),
        )
        status["deleted"] += max(stale_source_cursor.rowcount, 0)
    return status


def import_cards(deck_path: Path, dry_run: bool) -> dict[str, Any]:
    cards = load_cards(deck_path)
    summary = {
        "deck_path": str(deck_path),
        "deck_name": DECK_NAME,
        "card_count": len(cards),
        "source_url": SOURCE_URL,
        "unique_tag_count": len({tag for card in cards for tag in stable_card_tags(card)}),
    }
    if dry_run:
        summary["dry_run"] = True
        return summary

    from app.core.time import utc_now  # noqa: E402
    from app.db.storage import get_connection, init_storage  # noqa: E402
    from app.services import srs_service  # noqa: E402
    from app.services.common import new_id  # noqa: E402

    init_storage()
    now_iso = utc_now().isoformat()
    with get_connection() as conn:
        default_schedule = srs_service.ensure_default_deck(conn)["schedule"]
        deck_id, schedule = _ensure_deck(conn, new_id, default_schedule, now_iso)
        artifact_id = _ensure_artifact(conn, new_id, deck_path, cards, now_iso)
        source_id, source_status = _upsert_study_source(conn, deck_path, cards, artifact_id, now_iso)
        topic_status = _upsert_section_topics(conn, source_id, cards, now_iso)
        chunk_status = _upsert_source_chunks(conn, source_id, artifact_id, cards, now_iso)
        card_set_version_id = _ensure_card_set_version(conn, new_id, artifact_id, now_iso)
        note_id = _ensure_note(conn, new_id, artifact_id, len(cards), now_iso)
        _ensure_relation(
            conn,
            new_id,
            artifact_id,
            "artifact.card_set_version",
            "card_set_version",
            card_set_version_id,
            now_iso,
        )

        existing_by_key = _existing_cards_by_key(conn, card_set_version_id)
        inserted_cards = 0
        updated_cards = 0
        unchanged_cards = 0
        for card in cards:
            existing_card = existing_by_key.get(stable_card_key(card))
            if existing_card is None:
                _insert_card(
                    conn,
                    new_id,
                    card,
                    artifact_id=artifact_id,
                    note_id=note_id,
                    card_set_version_id=card_set_version_id,
                    deck_id=deck_id,
                    schedule=schedule,
                    now_iso=now_iso,
                )
                inserted_cards += 1
            elif _update_card_if_needed(
                conn,
                new_id,
                existing_card,
                card,
                artifact_id=artifact_id,
                note_id=note_id,
                deck_id=deck_id,
                now_iso=now_iso,
            ):
                updated_cards += 1
            else:
                unchanged_cards += 1
        link_status = _upsert_card_topic_links(
            conn,
            source_id=source_id,
            card_set_version_id=card_set_version_id,
            cards=cards,
            now_iso=now_iso,
        )
        topic_status["deleted"] += _delete_stale_section_topics(conn, source_id, cards)
        conn.commit()

    summary.update(
        {
            "artifact_id": artifact_id,
            "card_set_version_id": card_set_version_id,
            "deck_id": deck_id,
            "note_id": note_id,
            "source_id": source_id,
            "source": source_status,
            "topics": topic_status,
            "source_chunks": chunk_status,
            "card_topic_links": link_status,
            "inserted_cards": inserted_cards,
            "updated_cards": updated_cards,
            "unchanged_cards": unchanged_cards,
        }
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Import the ML Interviews Part II SRS deck.")
    parser.add_argument(
        "--deck",
        type=Path,
        default=ROOT_DIR / "data/ml_interviews_part_ii_qa_cards.jsonl",
        help="Path to the JSONL deck file.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the deck without mutating the DB.",
    )
    args = parser.parse_args()

    summary = import_cards(args.deck, args.dry_run)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
