#!/usr/bin/env python3
from __future__ import annotations

import argparse
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

DECK_NAME = "ML Interviews Part II"
DECK_DESCRIPTION = "Machine learning interview study cards from ML Interviews Book Part II."
SOURCE_URL = "https://huyenchip.com/ml-interviews-book/contents/part-ii.-questions.html"
ARTIFACT_TITLE = "ML Interviews Part II SRS bootstrap"
NOTE_TITLE = "ML Interviews Part II SRS deck"
IMPORT_KEY_PREFIX = "ml-interviews-part-ii"


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
    return [
        "ml-interviews-part-ii",
        f"section-{slug_tag(section)}",
        f"difficulty-{slug_tag(difficulty)}",
        f"source-{slug_tag(source)}",
    ]


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
    metadata_json = json.dumps(metadata, indent=2, sort_keys=True)

    lines = [
        f"Import Key: {stable_card_key(card)}",
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
    ]
    return "\n".join(lines).strip()


def build_deck_note_body(card_count: int) -> str:
    return (
        "# ML Interviews Part II SRS deck\n\n"
        f"Source: {SOURCE_URL}\n\n"
        f"Deck: {DECK_NAME}\n\n"
        f"Cards: {card_count}\n\n"
        "Each card stores source URL, source path, section, difficulty, answer source, stable import key, "
        "and full source metadata in its linked note block."
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
            "deck_path": _relative_deck_path(deck_path),
            "source_url": SOURCE_URL,
            "card_count": len(cards),
        },
    }


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
        conn.commit()

    summary.update(
        {
            "artifact_id": artifact_id,
            "card_set_version_id": card_set_version_id,
            "deck_id": deck_id,
            "note_id": note_id,
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
