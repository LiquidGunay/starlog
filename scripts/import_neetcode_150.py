#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

ROOT_DIR = Path(__file__).resolve().parents[1]
API_DIR = ROOT_DIR / "services/api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

DEFAULT_SOURCE_PATH = ROOT_DIR / "data/neetcode_150.json"
IMPORT_KEY_PREFIX = "neetcode-150"
DECK_NAME = "NeetCode 150"
DECK_DESCRIPTION = "Coding interview practice cards generated from the local NeetCode 150 source list."
ARTIFACT_TITLE = "NeetCode 150 Study Core import"
NOTE_TITLE = "NeetCode 150 Study Core import"

EXPECTED_PATTERN_COUNTS = {
    "Arrays & Hashing": 9,
    "Two Pointers": 5,
    "Sliding Window": 6,
    "Stack": 6,
    "Binary Search": 7,
    "Linked List": 11,
    "Trees": 15,
    "Heap / Priority Queue": 7,
    "Backtracking": 10,
    "Tries": 3,
    "Graphs": 13,
    "Advanced Graphs": 6,
    "1-D Dynamic Programming": 12,
    "2-D Dynamic Programming": 11,
    "Greedy": 8,
    "Intervals": 6,
    "Math & Geometry": 8,
    "Bit Manipulation": 7,
}
EXPECTED_DIFFICULTY_COUNTS = {"Easy": 28, "Medium": 101, "Hard": 21}
REQUIRED_ITEM_FIELDS = {
    "id",
    "sequence",
    "title",
    "url",
    "difficulty",
    "pattern",
    "prerequisites",
    "notes",
}
REVIEW_CARD_AXES = (
    {
        "id": "pattern_recognition",
        "label": "Pattern recognition",
        "card_type": "scenario",
        "tag": "pattern-recognition",
        "prompt": (
            "Before opening {title}, identify the observable cues that should make you reach for "
            "{pattern}. What input shape, constraint, or operation hints would you look for?"
        ),
        "answer": (
            "Use this as a self-check for recognizing the pattern, not for recalling a solution. "
            "Name the cues you observed, compare them with the listed pattern, then record any "
            "competing patterns you considered."
        ),
    },
    {
        "id": "edge_cases",
        "label": "Edge cases",
        "card_type": "judgment",
        "tag": "edge-cases",
        "prompt": (
            "For {title}, list the boundary cases you would test before submitting. Include empty, "
            "minimal, duplicate, ordering, and constraint-boundary cases when they apply."
        ),
        "answer": (
            "After attempting the problem, compare your tests against the failure modes you actually "
            "hit. Keep concrete examples in your editable notes; no source solution text is imported."
        ),
    },
    {
        "id": "complexity",
        "label": "Complexity",
        "card_type": "understanding",
        "tag": "complexity",
        "prompt": (
            "State the expected time and space complexity for your {pattern} approach to {title}. "
            "Which operation dominates, and what data structure choice controls the bound?"
        ),
        "answer": (
            "Self-grade by explaining the dominant loop, recursion, heap, map, graph traversal, or DP "
            "state count in your own words. Update the note after solving if your first estimate was wrong."
        ),
    },
    {
        "id": "implementation_traps",
        "label": "Implementation traps",
        "card_type": "critique",
        "tag": "implementation-traps",
        "prompt": (
            "Name the implementation traps for {title}: off-by-one risks, state invariants, mutation "
            "hazards, duplicate handling, and language-specific pitfalls."
        ),
        "answer": (
            "Check the traps against your submitted code or scratch solution. Record the bugs you found, "
            "the invariant that prevents them, and what you will watch for next time."
        ),
    },
)


class ReviewInputAdapter(Protocol):
    def upsert_review_inputs(self, collection_id: str, review_inputs: list[dict[str, Any]]) -> dict[str, Any]:
        """Create or update review inputs by stable external_id."""


@dataclass
class DryRunReviewInputAdapter:
    def upsert_review_inputs(self, collection_id: str, review_inputs: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "adapter": "dry_run",
            "collection_id": collection_id,
            "created": 0,
            "updated": 0,
            "unchanged": len(review_inputs),
        }


@dataclass
class StudyCoreLocalAdapter:
    """Local Study Core/SRS adapter for deterministic NeetCode imports."""

    def upsert_review_inputs(self, collection_id: str, review_inputs: list[dict[str, Any]]) -> dict[str, Any]:
        if not review_inputs:
            return {
                "adapter": "study_core_local",
                "collection_id": collection_id,
                "created": 0,
                "updated": 0,
                "unchanged": 0,
            }

        from app.core.time import utc_now  # noqa: E402
        from app.db.storage import get_connection, init_storage  # noqa: E402
        from app.services import srs_service  # noqa: E402

        init_storage()
        now_iso = utc_now().isoformat()
        with get_connection() as conn:
            default_schedule = srs_service.ensure_default_deck(conn)["schedule"]
            deck_id, schedule = _ensure_deck(conn, default_schedule, now_iso)
            artifact_id, artifact_status = _upsert_artifact(conn, collection_id, review_inputs, now_iso)
            source_id, source_status = _upsert_study_source(
                conn,
                collection_id,
                review_inputs,
                artifact_id=artifact_id,
                now_iso=now_iso,
            )
            topic_status = _upsert_pattern_topics(conn, source_id, review_inputs, now_iso)
            card_set_version_id = _ensure_card_set_version(conn, artifact_id, now_iso)
            note_id, note_status = _upsert_note(conn, artifact_id, len(review_inputs), now_iso)
            _ensure_relation(
                conn,
                artifact_id,
                "artifact.card_set_version",
                "card_set_version",
                card_set_version_id,
                now_iso,
            )
            _ensure_relation(conn, artifact_id, "artifact.note", "note", note_id, now_iso)
            item_status = _upsert_practice_items(conn, source_id, review_inputs, now_iso)
            card_status = _upsert_cards(
                conn,
                deck_id=deck_id,
                schedule=schedule,
                artifact_id=artifact_id,
                note_id=note_id,
                card_set_version_id=card_set_version_id,
                review_inputs=review_inputs,
                now_iso=now_iso,
            )
            link_status = _upsert_card_topic_links(conn, source_id, review_inputs, now_iso)
            conn.commit()

        return {
            "adapter": "study_core_local",
            "collection_id": collection_id,
            "source_id": source_id,
            "deck_id": deck_id,
            "artifact_id": artifact_id,
            "card_set_version_id": card_set_version_id,
            "note_id": note_id,
            "source": source_status,
            "topics": topic_status,
            "practice_items": item_status,
            "cards": card_status,
            "card_topic_links": link_status,
            "artifact": artifact_status,
            "note": note_status,
        }


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_") or "unknown"


def _db_id(prefix: str, *parts: object) -> str:
    return f"{prefix}_{'_'.join(_slug(str(part)) for part in parts if str(part).strip())}"


def _json(payload: Any, *, pretty: bool = False) -> str:
    if pretty:
        return json.dumps(payload, indent=2, sort_keys=True)
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _decode_json(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback


def _record_changed(row: Any, expected: dict[str, Any]) -> bool:
    for key, value in expected.items():
        current = row[key]
        if current != value:
            return True
    return False


def _upsert_status(existed: bool, changed: bool) -> dict[str, int]:
    return {
        "created": 0 if existed else 1,
        "updated": 1 if existed and changed else 0,
        "unchanged": 1 if existed and not changed else 0,
    }


def _merge_status(target: dict[str, int], status: dict[str, int]) -> None:
    for key in ("created", "updated", "unchanged"):
        target[key] = target.get(key, 0) + int(status.get(key, 0))


def _collection_title(review_inputs: list[dict[str, Any]]) -> str:
    return str(review_inputs[0].get("source_collection_title") or "NeetCode 150 Practice Prep")


def _source_list_url(review_inputs: list[dict[str, Any]]) -> str | None:
    provenance = review_inputs[0].get("provenance")
    if isinstance(provenance, dict):
        return provenance.get("source_list_url")
    return None


def _source_metadata(collection_id: str, review_inputs: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "import_key": collection_id,
        "external_id": collection_id,
        "source_checked_at": review_inputs[0].get("provenance", {}).get("source_checked_at")
        if isinstance(review_inputs[0].get("provenance"), dict)
        else None,
        "problem_count": len(review_inputs),
        "review_card_axes": [str(axis["id"]) for axis in REVIEW_CARD_AXES],
        "review_card_count": len(review_inputs) * len(REVIEW_CARD_AXES),
        "pattern_counts": dict(Counter(str(item["pattern"]) for item in review_inputs)),
        "difficulty_counts": dict(Counter(str(item["difficulty"]) for item in review_inputs)),
        "content_hash": _stable_hash({"review_inputs": review_inputs}),
    }


def _upsert_study_source(
    conn: Any,
    collection_id: str,
    review_inputs: list[dict[str, Any]],
    *,
    artifact_id: str,
    now_iso: str,
) -> tuple[str, dict[str, int]]:
    source_id = _db_id("study_src", collection_id)
    metadata_json = _json(_source_metadata(collection_id, review_inputs))
    expected = {
        "title": _collection_title(review_inputs),
        "source_type": "interview_prep",
        "artifact_id": artifact_id,
        "url": _source_list_url(review_inputs),
        "metadata_json": metadata_json,
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
        return source_id, _upsert_status(False, True)

    changed = _record_changed(row, expected)
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
    return source_id, _upsert_status(True, changed)


def _topic_summary(pattern: str, review_inputs: list[dict[str, Any]]) -> str:
    count = sum(1 for item in review_inputs if item["pattern"] == pattern)
    prerequisite_for = sorted(
        {
            str(item["pattern"])
            for item in review_inputs
            if pattern in item.get("prerequisites", []) and item["pattern"] != pattern
        }
    )
    suffix = f" Prerequisite for: {', '.join(prerequisite_for)}." if prerequisite_for else ""
    return f"NeetCode 150 pattern topic with {count} practice problems.{suffix}"


def _upsert_pattern_topics(
    conn: Any,
    source_id: str,
    review_inputs: list[dict[str, Any]],
    now_iso: str,
) -> dict[str, int]:
    status = {"created": 0, "updated": 0, "unchanged": 0}
    for display_order, pattern in enumerate(EXPECTED_PATTERN_COUNTS, start=1):
        topic_id = _topic_id(source_id, pattern)
        expected = {
            "source_id": source_id,
            "parent_topic_id": None,
            "title": pattern,
            "summary": _topic_summary(pattern, review_inputs),
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
            _merge_status(status, _upsert_status(False, True))
            continue

        changed = _record_changed(row, expected)
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
        _merge_status(status, _upsert_status(True, changed))
    return status


def _artifact_payload(collection_id: str, review_inputs: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "source_type": "study_core_import",
        "title": ARTIFACT_TITLE,
        "raw_content": f"{_collection_title(review_inputs)}\nSource: {_source_list_url(review_inputs) or 'local JSON'}",
        "normalized_content": "Deterministic Study Core import payloads for NeetCode 150 coding practice.",
        "extracted_content": _json(review_inputs, pretty=True),
        "metadata": {
            "import_key": collection_id,
            "deck_name": DECK_NAME,
            "source_url": _source_list_url(review_inputs),
            "review_input_count": len(review_inputs),
            "review_card_axes": [str(axis["id"]) for axis in REVIEW_CARD_AXES],
            "review_card_count": len(review_inputs) * len(REVIEW_CARD_AXES),
            "content_hash": _stable_hash({"review_inputs": review_inputs}),
        },
    }


def _upsert_artifact(
    conn: Any,
    collection_id: str,
    review_inputs: list[dict[str, Any]],
    now_iso: str,
) -> tuple[str, dict[str, int]]:
    artifact_id = _db_id("art", collection_id)
    payload = _artifact_payload(collection_id, review_inputs)
    expected = {
        "source_type": payload["source_type"],
        "title": payload["title"],
        "raw_content": payload["raw_content"],
        "normalized_content": payload["normalized_content"],
        "extracted_content": payload["extracted_content"],
        "metadata_json": _json(payload["metadata"]),
    }
    row = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()
    if row is None:
        conn.execute(
            """
            INSERT INTO artifacts (
              id, source_type, title, raw_content, normalized_content, extracted_content,
              metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_id,
                expected["source_type"],
                expected["title"],
                expected["raw_content"],
                expected["normalized_content"],
                expected["extracted_content"],
                expected["metadata_json"],
                now_iso,
                now_iso,
            ),
        )
        return artifact_id, _upsert_status(False, True)

    changed = _record_changed(row, expected)
    if changed:
        conn.execute(
            """
            UPDATE artifacts
            SET source_type = ?, title = ?, raw_content = ?, normalized_content = ?,
                extracted_content = ?, metadata_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                expected["source_type"],
                expected["title"],
                expected["raw_content"],
                expected["normalized_content"],
                expected["extracted_content"],
                expected["metadata_json"],
                now_iso,
                artifact_id,
            ),
        )
    return artifact_id, _upsert_status(True, changed)


def _ensure_card_set_version(conn: Any, artifact_id: str, now_iso: str) -> str:
    row = conn.execute(
        "SELECT id FROM card_set_versions WHERE artifact_id = ? AND version = 1",
        (artifact_id,),
    ).fetchone()
    if row is not None:
        return str(row["id"])
    card_set_version_id = _db_id("csv", artifact_id, "v1")
    conn.execute(
        "INSERT INTO card_set_versions (id, artifact_id, version, created_at) VALUES (?, ?, ?, ?)",
        (card_set_version_id, artifact_id, 1, now_iso),
    )
    return card_set_version_id


def _upsert_note(conn: Any, artifact_id: str, review_input_count: int, now_iso: str) -> tuple[str, dict[str, int]]:
    note_id = _db_id("nte", artifact_id)
    body = (
        "# NeetCode 150 Study Core import\n\n"
        f"Import Key: {IMPORT_KEY_PREFIX}\n\n"
        f"Review Inputs: {review_input_count}\n\n"
        f"Generated Review Cards: {review_input_count * len(REVIEW_CARD_AXES)}\n\n"
        "Generated records preserve local source metadata and avoid solution text."
    )
    expected = {"title": NOTE_TITLE, "body_md": body}
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO notes (id, title, body_md, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (note_id, expected["title"], expected["body_md"], 1, now_iso, now_iso),
        )
        return note_id, _upsert_status(False, True)

    changed = row["title"] != expected["title"] or row["body_md"] != expected["body_md"]
    if changed:
        conn.execute(
            "UPDATE notes SET title = ?, body_md = ?, version = ?, updated_at = ? WHERE id = ?",
            (expected["title"], expected["body_md"], int(row["version"]) + 1, now_iso, note_id),
        )
    return note_id, _upsert_status(True, changed)


def _ensure_relation(
    conn: Any,
    artifact_id: str,
    relation_type: str,
    target_type: str,
    target_id: str,
    now_iso: str,
) -> None:
    relation_id = _db_id("rel", artifact_id, relation_type, target_type, target_id)
    conn.execute(
        """
        INSERT INTO artifact_relations (id, artifact_id, relation_type, target_type, target_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
        """,
        (relation_id, artifact_id, relation_type, target_type, target_id, now_iso),
    )


def _ensure_deck(conn: Any, default_schedule: dict[str, Any], now_iso: str) -> tuple[str, dict[str, Any]]:
    row = conn.execute("SELECT id, schedule_json FROM card_decks WHERE name = ?", (DECK_NAME,)).fetchone()
    if row is not None:
        return str(row["id"]), _decode_json(row["schedule_json"], default_schedule)

    deck_id = _db_id("cdk", IMPORT_KEY_PREFIX)
    conn.execute(
        """
        INSERT INTO card_decks (id, name, description, schedule_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (deck_id, DECK_NAME, DECK_DESCRIPTION, _json(default_schedule), now_iso, now_iso),
    )
    return deck_id, default_schedule


def _topic_id(source_id: str, pattern: str) -> str:
    return _db_id("study_topic", source_id, pattern)


def _practice_item_prompt(review_input: dict[str, Any]) -> str:
    return str(review_input["practice_prompt"])


def _practice_item_metadata(review_input: dict[str, Any]) -> dict[str, Any]:
    return {
        "import_key": review_input["external_id"],
        "external_id": review_input["external_id"],
        "source_sequence": review_input["source_sequence"],
        "difficulty": review_input["difficulty"],
        "pattern": review_input["pattern"],
        "prerequisites": review_input["prerequisites"],
        "source_url": review_input["source_url"],
        "content_hash": review_input["content_hash"],
        "review_input": review_input,
    }


def _review_card_specs(review_input: dict[str, Any]) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for axis in REVIEW_CARD_AXES:
        axis_id = str(axis["id"])
        title = str(review_input["title"])
        pattern = str(review_input["pattern"])
        prompt = str(axis["prompt"]).format(title=title, pattern=pattern, difficulty=review_input["difficulty"])
        answer = (
            f"Open: {review_input['source_url']}\n\n"
            f"{axis['label']} review. {axis['answer']} "
            "This card contains no copied problem statement or solution text."
        )
        specs.append(
            {
                "axis_id": axis_id,
                "axis_label": axis["label"],
                "card_id": _db_id("crd", review_input["external_id"], axis_id),
                "note_block_id": _db_id("blk", review_input["external_id"], axis_id),
                "card_type": axis["card_type"],
                "prompt": prompt,
                "answer": answer,
                "tags": _card_tags(review_input, str(axis["tag"])),
                "content_hash": _stable_hash(
                    {
                        "external_id": review_input["external_id"],
                        "axis_id": axis_id,
                        "prompt": prompt,
                        "answer": answer,
                        "tags": _card_tags(review_input, str(axis["tag"])),
                    }
                ),
            }
        )
    return specs


def _upsert_practice_items(
    conn: Any,
    source_id: str,
    review_inputs: list[dict[str, Any]],
    now_iso: str,
) -> dict[str, int]:
    status = {"created": 0, "updated": 0, "unchanged": 0}
    for review_input in review_inputs:
        item_id = _db_id("practice", review_input["external_id"])
        expected = {
            "source_id": source_id,
            "topic_id": _topic_id(source_id, str(review_input["pattern"])),
            "item_type": "coding_problem_practice",
            "prompt": _practice_item_prompt(review_input),
            "answer": None,
            "metadata_json": _json(_practice_item_metadata(review_input)),
        }
        row = conn.execute("SELECT * FROM practice_items WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO practice_items (
                  id, source_id, topic_id, item_type, prompt, answer, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    expected["source_id"],
                    expected["topic_id"],
                    expected["item_type"],
                    expected["prompt"],
                    expected["answer"],
                    expected["metadata_json"],
                    now_iso,
                    now_iso,
                ),
            )
            _merge_status(status, _upsert_status(False, True))
            continue

        changed = _record_changed(row, expected)
        if changed:
            conn.execute(
                """
                UPDATE practice_items
                SET source_id = ?, topic_id = ?, item_type = ?, prompt = ?, answer = ?,
                    metadata_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    expected["source_id"],
                    expected["topic_id"],
                    expected["item_type"],
                    expected["prompt"],
                    expected["answer"],
                    expected["metadata_json"],
                    now_iso,
                    item_id,
                ),
            )
        _merge_status(status, _upsert_status(True, changed))
    return status


def _card_tags(review_input: dict[str, Any], axis_tag: str | None = None) -> list[str]:
    tags = [
        IMPORT_KEY_PREFIX,
        f"pattern-{_slug(str(review_input['pattern'])).replace('_', '-')}",
        f"difficulty-{_slug(str(review_input['difficulty'])).replace('_', '-')}",
        "coding-practice",
    ]
    if axis_tag:
        tags.append(axis_tag)
    return tags


def _note_block_content(review_input: dict[str, Any], card_spec: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"Import Key: {review_input['external_id']}",
            f"Review Axis: {card_spec['axis_label']}",
            f"Source URL: {review_input['source_url']}",
            f"Pattern: {review_input['pattern']}",
            f"Difficulty: {review_input['difficulty']}",
            f"Prerequisites: {', '.join(review_input['prerequisites']) or 'none'}",
            f"Content Hash: {review_input['content_hash']}",
            f"Card Hash: {card_spec['content_hash']}",
            "",
            "Card Prompt:",
            str(card_spec["prompt"]),
            "",
            "Card Answer Guidance:",
            str(card_spec["answer"]),
            "",
            "Review Input Payload:",
            _json(review_input, pretty=True),
        ]
    ).strip()


def _upsert_note_block(
    conn: Any,
    *,
    note_id: str,
    artifact_id: str,
    review_input: dict[str, Any],
    card_spec: dict[str, Any],
    now_iso: str,
) -> tuple[str, dict[str, int]]:
    note_block_id = str(card_spec["note_block_id"])
    expected = {
        "note_id": note_id,
        "artifact_id": artifact_id,
        "block_type": "coding_problem_review_card",
        "content": _note_block_content(review_input, card_spec),
    }
    row = conn.execute("SELECT * FROM note_blocks WHERE id = ?", (note_block_id,)).fetchone()
    if row is None:
        conn.execute(
            """
            INSERT INTO note_blocks (id, note_id, artifact_id, block_type, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                note_block_id,
                expected["note_id"],
                expected["artifact_id"],
                expected["block_type"],
                expected["content"],
                now_iso,
            ),
        )
        return note_block_id, _upsert_status(False, True)
    changed = _record_changed(row, expected)
    if changed:
        conn.execute(
            "UPDATE note_blocks SET note_id = ?, artifact_id = ?, block_type = ?, content = ? WHERE id = ?",
            (
                expected["note_id"],
                expected["artifact_id"],
                expected["block_type"],
                expected["content"],
                note_block_id,
            ),
        )
    return note_block_id, _upsert_status(True, changed)


def _upsert_cards(
    conn: Any,
    *,
    deck_id: str,
    schedule: dict[str, Any],
    artifact_id: str,
    note_id: str,
    card_set_version_id: str,
    review_inputs: list[dict[str, Any]],
    now_iso: str,
) -> dict[str, int]:
    status = {"created": 0, "updated": 0, "unchanged": 0}
    note_blocks = {"created": 0, "updated": 0, "unchanged": 0}
    due_at = (
        datetime.fromisoformat(now_iso) + timedelta(hours=int(schedule.get("new_cards_due_offset_hours", 24)))
    ).isoformat()
    for review_input in review_inputs:
        for card_spec in _review_card_specs(review_input):
            card_id = str(card_spec["card_id"])
            note_block_id, note_block_status = _upsert_note_block(
                conn,
                note_id=note_id,
                artifact_id=artifact_id,
                review_input=review_input,
                card_spec=card_spec,
                now_iso=now_iso,
            )
            _merge_status(note_blocks, note_block_status)
            expected = {
                "card_set_version_id": card_set_version_id,
                "artifact_id": artifact_id,
                "note_block_id": note_block_id,
                "deck_id": deck_id,
                "card_type": card_spec["card_type"],
                "prompt": card_spec["prompt"],
                "answer": card_spec["answer"],
                "tags_json": _json(card_spec["tags"]),
            }
            row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
            if row is None:
                conn.execute(
                    """
                    INSERT INTO cards (
                      id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type, prompt, answer,
                      tags_json, suspended, due_at, interval_days, repetitions, ease_factor, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        card_id,
                        expected["card_set_version_id"],
                        expected["artifact_id"],
                        expected["note_block_id"],
                        expected["deck_id"],
                        expected["card_type"],
                        expected["prompt"],
                        expected["answer"],
                        expected["tags_json"],
                        0,
                        due_at,
                        int(schedule.get("initial_interval_days", 1)),
                        0,
                        float(schedule.get("initial_ease_factor", 2.5)),
                        now_iso,
                        now_iso,
                    ),
                )
                _merge_status(status, _upsert_status(False, True))
                continue

            changed = _record_changed(row, expected)
            if changed:
                conn.execute(
                    """
                    UPDATE cards
                    SET card_set_version_id = ?, artifact_id = ?, note_block_id = ?, deck_id = ?, card_type = ?,
                        prompt = ?, answer = ?, tags_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        expected["card_set_version_id"],
                        expected["artifact_id"],
                        expected["note_block_id"],
                        expected["deck_id"],
                        expected["card_type"],
                        expected["prompt"],
                        expected["answer"],
                        expected["tags_json"],
                        now_iso,
                        card_id,
                    ),
                )
            _merge_status(status, _upsert_status(True, changed))
    status["note_blocks_created"] = note_blocks["created"]
    status["note_blocks_updated"] = note_blocks["updated"]
    status["note_blocks_unchanged"] = note_blocks["unchanged"]
    return status


def _upsert_card_topic_links(
    conn: Any,
    source_id: str,
    review_inputs: list[dict[str, Any]],
    now_iso: str,
) -> dict[str, int]:
    status = {
        "created": 0,
        "updated": 0,
        "unchanged": 0,
        "deleted": 0,
        "primary_links": 0,
        "prerequisite_links": 0,
    }
    for review_input in review_inputs:
        for card_spec in _review_card_specs(review_input):
            card_id = str(card_spec["card_id"])
            links = [(str(review_input["pattern"]), True, "primary")]
            links.extend((str(prerequisite), True, "prerequisite") for prerequisite in review_input["prerequisites"])
            desired_topic_ids: set[str] = set()
            import_link_prefix = f"{_db_id('card_topic', review_input['external_id'], card_spec['axis_id'])}_%"
            for pattern, gate_required, link_kind in links:
                topic_id = _topic_id(source_id, pattern)
                link_id = _db_id("card_topic", review_input["external_id"], card_spec["axis_id"], link_kind, pattern)
                desired_topic_ids.add(topic_id)
                row = conn.execute(
                    "SELECT * FROM card_topic_links WHERE card_id = ? AND topic_id = ?",
                    (card_id, topic_id),
                ).fetchone()
                expected_gate = 1 if gate_required else 0
                if row is None:
                    conn.execute(
                        """
                        INSERT INTO card_topic_links (id, card_id, topic_id, gate_required, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (link_id, card_id, topic_id, expected_gate, now_iso),
                    )
                    _merge_status(status, _upsert_status(False, True))
                else:
                    row_id = str(row["id"])
                    id_changed = row_id != link_id and row_id.startswith(import_link_prefix[:-1])
                    gate_changed = int(row["gate_required"]) != expected_gate
                    changed = id_changed or gate_changed
                    if changed:
                        conn.execute(
                            "UPDATE card_topic_links SET id = ?, gate_required = ? WHERE card_id = ? AND topic_id = ?",
                            (link_id if id_changed else row_id, expected_gate, card_id, topic_id),
                        )
                    _merge_status(status, _upsert_status(True, changed))
                if link_kind == "primary":
                    status["primary_links"] += 1
                else:
                    status["prerequisite_links"] += 1
            placeholders = ",".join("?" for _ in desired_topic_ids)
            cursor = conn.execute(
                f"""
                DELETE FROM card_topic_links
                WHERE card_id = ?
                  AND id LIKE ?
                  AND topic_id NOT IN ({placeholders})
                """,
                (card_id, import_link_prefix, *sorted(desired_topic_ids)),
            )
            status["deleted"] += max(cursor.rowcount, 0)
    return status


def load_source(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Neetcode source must be a JSON object")
    validate_source(payload)
    return payload


def validate_source(payload: dict[str, Any]) -> None:
    for field in ("deck_id", "title", "source_url", "items"):
        if field not in payload:
            raise ValueError(f"Source missing required field: {field}")
    if not isinstance(payload["items"], list):
        raise ValueError("Source field items must be a list")

    ids: set[str] = set()
    sequences: list[int] = []
    pattern_counts: Counter[str] = Counter()
    difficulty_counts: Counter[str] = Counter()

    for index, item in enumerate(payload["items"], start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Item {index} must be an object")
        missing = sorted(REQUIRED_ITEM_FIELDS - set(item))
        if missing:
            raise ValueError(f"Item {index} missing required fields: {', '.join(missing)}")

        item_id = _required_str(item, "id", index)
        if item_id in ids:
            raise ValueError(f"Duplicate item id: {item_id}")
        ids.add(item_id)

        sequence = item.get("sequence")
        if not isinstance(sequence, int):
            raise ValueError(f"Item {index} sequence must be an integer")
        sequences.append(sequence)

        _required_str(item, "title", index)
        url = _required_str(item, "url", index)
        if not url.startswith("https://leetcode.com/problems/"):
            raise ValueError(f"Item {index} url must be a LeetCode problem URL")

        difficulty = _required_str(item, "difficulty", index)
        if difficulty not in EXPECTED_DIFFICULTY_COUNTS:
            raise ValueError(f"Item {index} has unsupported difficulty: {difficulty}")
        difficulty_counts[difficulty] += 1

        pattern = _required_str(item, "pattern", index)
        if pattern not in EXPECTED_PATTERN_COUNTS:
            raise ValueError(f"Item {index} has unsupported pattern: {pattern}")
        pattern_counts[pattern] += 1

        prerequisites = item.get("prerequisites")
        if not isinstance(prerequisites, list) or not all(isinstance(value, str) for value in prerequisites):
            raise ValueError(f"Item {index} prerequisites must be a list of strings")
        unknown_prerequisites = sorted(set(prerequisites) - set(EXPECTED_PATTERN_COUNTS))
        if unknown_prerequisites:
            raise ValueError(f"Item {index} has unknown prerequisites: {', '.join(unknown_prerequisites)}")

        notes = item.get("notes")
        if not isinstance(notes, str):
            raise ValueError(f"Item {index} notes must be a string placeholder")

    expected_sequences = list(range(1, len(payload["items"]) + 1))
    if sequences != expected_sequences:
        raise ValueError("Item sequences must be contiguous and match source order")
    if len(payload["items"]) != sum(EXPECTED_PATTERN_COUNTS.values()):
        raise ValueError(f"Expected 150 Neetcode items, found {len(payload['items'])}")
    if dict(pattern_counts) != EXPECTED_PATTERN_COUNTS:
        raise ValueError(f"Unexpected pattern counts: {dict(pattern_counts)}")
    if dict(difficulty_counts) != EXPECTED_DIFFICULTY_COUNTS:
        raise ValueError(f"Unexpected difficulty counts: {dict(difficulty_counts)}")


def _required_str(item: dict[str, Any], field: str, index: int) -> str:
    value = item.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Item {index} field {field} must be a non-empty string")
    return value.strip()


def build_review_inputs(source: dict[str, Any]) -> list[dict[str, Any]]:
    deck_id = str(source["deck_id"])
    source_url = str(source["source_url"])
    review_inputs: list[dict[str, Any]] = []
    for item in source["items"]:
        review_input = {
            "external_id": item["id"],
            "source_collection_id": deck_id,
            "source_collection_title": source["title"],
            "source_sequence": item["sequence"],
            "kind": "coding_problem_practice",
            "title": item["title"],
            "source_url": item["url"],
            "difficulty": item["difficulty"],
            "pattern": item["pattern"],
            "prerequisites": item["prerequisites"],
            "notes": item["notes"],
            "practice_prompt": (
                f"Solve {item['title']} as a {item['difficulty']} {item['pattern']} practice problem. "
                "After attempting it, record approach, edge cases, complexity, mistakes, and next review notes."
            ),
            "provenance": {
                "source_list_url": source_url,
                "source_checked_at": source.get("source_checked_at"),
                "contains_solution_text": False,
            },
        }
        review_input["content_hash"] = _stable_hash(review_input)
        review_inputs.append(review_input)
    return review_inputs


def _stable_hash(payload: dict[str, Any]) -> str:
    hashable = {key: value for key, value in payload.items() if key != "content_hash"}
    raw = json.dumps(hashable, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def summarize(source_path: Path, source: dict[str, Any], review_inputs: list[dict[str, Any]], adapter_summary: dict[str, Any]) -> dict[str, Any]:
    items = source["items"]
    return {
        "source_path": str(source_path),
        "deck_id": source["deck_id"],
        "title": source["title"],
        "source_url": source["source_url"],
        "problem_count": len(items),
        "review_input_count": len(review_inputs),
        "review_card_axes": [str(axis["id"]) for axis in REVIEW_CARD_AXES],
        "review_card_count": len(review_inputs) * len(REVIEW_CARD_AXES),
        "pattern_counts": dict(Counter(item["pattern"] for item in items)),
        "difficulty_counts": dict(Counter(item["difficulty"] for item in items)),
        "adapter": adapter_summary,
    }


def import_neetcode_source(source_path: Path, adapter: ReviewInputAdapter) -> dict[str, Any]:
    source = load_source(source_path)
    review_inputs = build_review_inputs(source)
    adapter_summary = adapter.upsert_review_inputs(str(source["deck_id"]), review_inputs)
    return summarize(source_path, source, review_inputs, adapter_summary)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate or import the NeetCode 150 practice source list.")
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE_PATH,
        help="Path to the checked-in Neetcode source JSON.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and build review inputs without mutating storage.",
    )
    args = parser.parse_args()

    adapter: ReviewInputAdapter
    if args.dry_run:
        adapter = DryRunReviewInputAdapter()
    else:
        adapter = StudyCoreLocalAdapter()

    summary = import_neetcode_source(args.source, adapter)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
