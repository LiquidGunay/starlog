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

IMPORT_KEY_PREFIX = "inference-engineering-pdf"
DECK_NAME = "Inference Engineering"
DECK_DESCRIPTION = "Interview-prep review cards generated from trusted local PDF extraction."
ARTIFACT_TITLE = "Inference Engineering PDF review cards"
NOTE_TITLE = "Inference Engineering PDF review cards"
SOURCE_EVIDENCE_ARTIFACT_TITLE = "Inference Engineering PDF source evidence"
SOURCE_EVIDENCE_TOPIC_TITLE = "Unproven extraction evidence"
TRUSTED_PROVIDERS = {"liteparse_server", "ocr_server", "pypdf"}
TRUSTED_ANSWER_SOURCE = "trusted_local_pdf_extraction"
REPORT_EVIDENCE_CHUNK_INDEX_OFFSET = 1_000_000


def _json(payload: Any, *, pretty: bool = False) -> str:
    return json.dumps(payload, indent=2 if pretty else None, sort_keys=True)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-") or "unknown"


def _stable_id(prefix: str, *parts: object) -> str:
    digest = hashlib.sha256(_json([str(part) for part in parts]).encode("utf-8")).hexdigest()[:24]
    return f"{prefix}_{digest}"


def _decode_json(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback


def _metadata_str(metadata: dict[str, Any], key: str, line_number: int) -> str:
    value = str(metadata.get(key) or "").strip()
    if not value:
        raise ValueError(f"Line {line_number} missing metadata.{key}")
    return value


def _metadata_int(metadata: dict[str, Any], key: str, line_number: int) -> int:
    raw = metadata.get(key)
    if raw is None:
        raise ValueError(f"Line {line_number} missing metadata.{key}")
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Line {line_number} metadata.{key} must be an integer") from exc
    if value < 0:
        raise ValueError(f"Line {line_number} metadata.{key} must be non-negative")
    return value


def _source_identity(card: dict[str, Any], line_number: int) -> tuple[str, str, str]:
    metadata = card["metadata"]
    pdf_sha = _metadata_str(metadata, "pdf_sha256", line_number)
    source_path = _metadata_str(metadata, "source_path", line_number)
    source_url = str(card["source_url"]).strip()
    if not source_path.startswith("/"):
        raise ValueError(f"Line {line_number} metadata.source_path must be an absolute local path")
    if not source_url.startswith("file://"):
        raise ValueError(f"Line {line_number} source_url must be a local file:// URL")
    return pdf_sha, source_path, source_url


def _chunk_index(card: dict[str, Any], line_number: int = 0) -> int:
    metadata = card["metadata"]
    raw_chunk_index = metadata.get("chunk_index")
    if raw_chunk_index is None:
        return int(card["question_index"])
    try:
        chunk_index = int(raw_chunk_index)
    except (TypeError, ValueError) as exc:
        prefix = f"Line {line_number} " if line_number else ""
        raise ValueError(f"{prefix}metadata.chunk_index must be an integer") from exc
    if chunk_index < 0:
        prefix = f"Line {line_number} " if line_number else ""
        raise ValueError(f"{prefix}metadata.chunk_index must be non-negative")
    return chunk_index


def load_cards(path: Path) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    seen_chunk_indices: dict[int, str] = {}
    expected_source_identity: tuple[str, str, str] | None = None
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                card = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON on line {line_number}") from exc
            if not isinstance(card, dict):
                raise ValueError(f"Line {line_number} must be a JSON object")
            for key in ("prompt", "answer", "question", "question_index", "section", "source_url"):
                if not isinstance(card.get(key), str) or not card[key].strip():
                    raise ValueError(f"Line {line_number} missing required string field: {key}")
            metadata = card.get("metadata")
            if not isinstance(metadata, dict):
                raise ValueError(f"Line {line_number} missing metadata object")
            provider = str(metadata.get("provider") or "")
            if provider not in TRUSTED_PROVIDERS:
                raise ValueError(f"Line {line_number} has untrusted provider: {provider or 'none'}")
            answer_source = str(metadata.get("answer_source") or "")
            if answer_source != TRUSTED_ANSWER_SOURCE:
                raise ValueError(f"Line {line_number} has untrusted answer_source: {answer_source or 'none'}")
            source_identity = _source_identity(card, line_number)
            if expected_source_identity is None:
                expected_source_identity = source_identity
            elif source_identity != expected_source_identity:
                raise ValueError(f"Line {line_number} mixes multiple PDF sources in one import")
            word_start = _metadata_int(metadata, "word_start", line_number)
            word_end = _metadata_int(metadata, "word_end", line_number)
            if word_end < word_start:
                raise ValueError(f"Line {line_number} metadata.word_end must be >= metadata.word_start")
            chunk_index = _chunk_index(card, line_number)
            chunk_hash = str(metadata.get("chunk_content_sha256") or "").strip()
            if not chunk_hash:
                raise ValueError(f"Line {line_number} missing chunk_content_sha256")
            key = _card_import_key(card)
            if key in seen_keys:
                raise ValueError(f"Duplicate PDF review-card key: {key}")
            existing_chunk_key = seen_chunk_indices.get(chunk_index)
            if existing_chunk_key is not None and existing_chunk_key != key:
                raise ValueError(f"Duplicate PDF chunk_index with different content hash: {chunk_index}")
            seen_chunk_indices[chunk_index] = key
            seen_keys.add(key)
            cards.append(card)
    if not cards:
        raise ValueError("PDF review-card file contained no cards")
    return cards


def _card_import_key(card: dict[str, Any]) -> str:
    metadata = card["metadata"]
    return f"{_source_key([card])}:{metadata['chunk_content_sha256']}"


def _source_key(cards: list[dict[str, Any]]) -> str:
    pdf_sha = str(cards[0]["metadata"]["pdf_sha256"]).strip()
    return f"{IMPORT_KEY_PREFIX}:{pdf_sha}"


def _source_key_from_pdf_sha(pdf_sha: str) -> str:
    pdf_sha = str(pdf_sha or "").strip()
    if not pdf_sha:
        raise ValueError("PDF source evidence report is missing pdf_sha256")
    return f"{IMPORT_KEY_PREFIX}:{pdf_sha}"


def _card_tags(card: dict[str, Any]) -> list[str]:
    metadata = card["metadata"]
    section = str(card.get("section") or "Inference Engineering")
    provider = str(metadata.get("provider") or "unknown")
    return [
        IMPORT_KEY_PREFIX,
        f"section-{_slug(section)}",
        f"provider-{_slug(provider)}",
        "pdf-review",
        "interview-prep",
    ]


def _note_block_content(card: dict[str, Any]) -> str:
    metadata = card["metadata"]
    return "\n".join(
        [
            f"Import Key: {_card_import_key(card)}",
            f"Source URL: {card['source_url']}",
            f"Section: {card['section']}",
            f"Question Index: {card['question_index']}",
            f"Provider: {metadata.get('provider')}",
            f"Mode: {metadata.get('mode')}",
            f"PDF SHA256: {metadata.get('pdf_sha256')}",
            f"Chunk SHA256: {metadata.get('chunk_content_sha256')}",
            f"Words: {metadata.get('word_start')}..{metadata.get('word_end')}",
            "",
            "Question:",
            str(card["question"]),
            "",
            "Answer:",
            str(card["answer"]),
            "",
            "Metadata:",
            _json(metadata, pretty=True),
        ]
    ).strip()


def _ensure_deck(conn: Any, default_schedule: dict[str, Any], now_iso: str) -> tuple[str, dict[str, Any]]:
    row = conn.execute("SELECT id, schedule_json FROM card_decks WHERE name = ?", (DECK_NAME,)).fetchone()
    if row is not None:
        return str(row["id"]), _decode_json(row["schedule_json"], default_schedule)
    deck_id = _stable_id("cdk", IMPORT_KEY_PREFIX)
    conn.execute(
        """
        INSERT INTO card_decks (id, name, description, schedule_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (deck_id, DECK_NAME, DECK_DESCRIPTION, _json(default_schedule), now_iso, now_iso),
    )
    return deck_id, default_schedule


def _ensure_artifact(conn: Any, cards_path: Path, cards: list[dict[str, Any]], now_iso: str) -> str:
    source_key = _source_key(cards)
    artifact_id = _stable_id("art", source_key)
    metadata = {
        "import_key": source_key,
        "deck_name": DECK_NAME,
        "cards_path": str(cards_path),
        "card_count": len(cards),
        "providers": sorted({str(card["metadata"].get("provider")) for card in cards}),
        "pdf_sha256": cards[0]["metadata"].get("pdf_sha256"),
        "source_path": cards[0]["metadata"].get("source_path"),
        "source_url": cards[0]["source_url"],
    }
    expected = {
        "source_type": "pdf_review_cards",
        "title": ARTIFACT_TITLE,
        "raw_content": f"{DECK_NAME}\nSource: {cards[0]['source_url']}",
        "normalized_content": "Trusted local PDF review-card import.",
        "extracted_content": _json(cards, pretty=True),
        "metadata_json": _json(metadata),
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
    elif any(row[key] != value for key, value in expected.items()):
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
    return artifact_id


def _ensure_card_set_version(conn: Any, artifact_id: str, now_iso: str) -> str:
    card_set_version_id = _stable_id("csv", artifact_id, "v1")
    conn.execute(
        "INSERT INTO card_set_versions (id, artifact_id, version, created_at) VALUES (?, ?, 1, ?) ON CONFLICT(id) DO NOTHING",
        (card_set_version_id, artifact_id, now_iso),
    )
    return card_set_version_id


def _ensure_note(conn: Any, artifact_id: str, card_count: int, now_iso: str) -> str:
    note_id = _stable_id("nte", artifact_id)
    body = (
        "# Inference Engineering PDF review cards\n\n"
        f"Import Key: {IMPORT_KEY_PREFIX}\n\n"
        f"Cards: {card_count}\n\n"
        "Generated from trusted local PDF extraction and linked to Study Core topics for manual read-gating."
    )
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO notes (id, title, body_md, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
            (note_id, NOTE_TITLE, body, now_iso, now_iso),
        )
    elif row["title"] != NOTE_TITLE or row["body_md"] != body:
        conn.execute(
            "UPDATE notes SET title = ?, body_md = ?, version = ?, updated_at = ? WHERE id = ?",
            (NOTE_TITLE, body, int(row["version"]) + 1, now_iso, note_id),
        )
    return note_id


def _ensure_relation(conn: Any, artifact_id: str, relation_type: str, target_type: str, target_id: str, now_iso: str) -> None:
    relation_id = _stable_id("rel", artifact_id, relation_type, target_type, target_id)
    conn.execute(
        """
        INSERT INTO artifact_relations (id, artifact_id, relation_type, target_type, target_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
        """,
        (relation_id, artifact_id, relation_type, target_type, target_id, now_iso),
    )


def _sha256_path(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _report_pdf_sha(report: dict[str, Any]) -> str:
    pdf_sha = str(report.get("pdf_sha256") or "").strip()
    if pdf_sha:
        return pdf_sha
    pdf_path = Path(str(report.get("pdf_path") or "")).expanduser()
    if pdf_path.is_file():
        return _sha256_path(pdf_path)
    raise ValueError("PDF source evidence report is missing pdf_sha256 and pdf_path is unavailable")


def _report_source_url(report: dict[str, Any]) -> str:
    pdf_path = str(report.get("pdf_path") or "").strip()
    return f"file://{pdf_path}" if pdf_path.startswith("/") else ""


def _validate_cards_match_report(cards_path: Path, *, source_key: str, pdf_sha: str) -> None:
    cards = load_cards(cards_path)
    cards_source_key = _source_key(cards)
    cards_pdf_sha = str(cards[0]["metadata"].get("pdf_sha256") or "").strip()
    if cards_source_key != source_key or cards_pdf_sha != pdf_sha:
        raise ValueError(
            "Ready PDF card import source mismatch: cards file does not match report pdf_sha256/source_key"
        )


def _report_json_summary(report: dict[str, Any], *, pdf_sha: str, cards_path: str) -> str:
    extraction = report.get("extraction") if isinstance(report.get("extraction"), dict) else {}
    summary = {
        "cards_generated": report.get("cards_generated") or 0,
        "cards_path": cards_path,
        "deck_generation": report.get("deck_generation") or "",
        "evidence_status": report.get("evidence_status") or "unproven",
        "final_card_status": report.get("final_card_status") or "",
        "pdf_path": report.get("pdf_path") or "",
        "pdf_sha256": pdf_sha,
        "provider": extraction.get("provider") or "none",
        "mode": extraction.get("mode") or "unavailable",
        "readable": bool(extraction.get("readable")),
        "usable": bool(extraction.get("usable")),
        "rejected_as_noise": bool(extraction.get("rejected_as_noise")),
    }
    return _json(summary, pretty=True)


def _ensure_source_evidence_artifact(
    conn: Any,
    report_path: Path,
    report: dict[str, Any],
    *,
    pdf_sha: str,
    cards_path: str,
    now_iso: str,
) -> str:
    source_key = _source_key_from_pdf_sha(pdf_sha)
    artifact_id = _stable_id("art", source_key, "source-evidence")
    metadata = {
        "import_key": source_key,
        "report_path": str(report_path),
        "cards_path": cards_path,
        "pdf_sha256": pdf_sha,
        "pdf_path": report.get("pdf_path") or "",
        "cloud_ocr_policy": report.get("cloud_ocr_policy") or "",
    }
    expected = {
        "source_type": "pdf_source_evidence",
        "title": SOURCE_EVIDENCE_ARTIFACT_TITLE,
        "raw_content": f"{DECK_NAME}\nSource: {_report_source_url(report)}",
        "normalized_content": _report_json_summary(report, pdf_sha=pdf_sha, cards_path=cards_path),
        "extracted_content": "",
        "metadata_json": _json(metadata),
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
    elif any(row[key] != value for key, value in expected.items()):
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
    return artifact_id


def _ensure_study_source(conn: Any, artifact_id: str, cards: list[dict[str, Any]], now_iso: str) -> str:
    source_key = _source_key(cards)
    source_id = _stable_id("study_src", source_key)
    metadata = {
        "import_key": source_key,
        "pdf_sha256": cards[0]["metadata"].get("pdf_sha256"),
        "source_path": cards[0]["metadata"].get("source_path"),
    }
    expected = {
        "title": DECK_NAME,
        "source_type": "pdf_book",
        "artifact_id": artifact_id,
        "url": cards[0]["source_url"],
        "metadata_json": _json(metadata),
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
    elif any(row[key] != value for key, value in expected.items()):
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
    return source_id


def _ensure_report_study_source(
    conn: Any,
    *,
    source_key: str,
    artifact_id: str,
    report: dict[str, Any],
    pdf_sha: str,
    now_iso: str,
) -> str:
    source_id = _stable_id("study_src", source_key)
    extraction = report.get("extraction") if isinstance(report.get("extraction"), dict) else {}
    metadata = {
        "import_key": source_key,
        "pdf_sha256": pdf_sha,
        "source_path": report.get("pdf_path") or "",
        "evidence_status": report.get("evidence_status") or "unproven",
        "deck_generation": report.get("deck_generation") or "",
        "provider": extraction.get("provider") or "none",
        "mode": extraction.get("mode") or "unavailable",
    }
    expected = {
        "title": DECK_NAME,
        "source_type": "pdf_book",
        "url": _report_source_url(report),
        "metadata_json": _json(metadata),
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
                artifact_id,
                expected["url"],
                expected["metadata_json"],
                now_iso,
                now_iso,
            ),
        )
    else:
        existing_artifact_id = row["artifact_id"] or artifact_id
        if (
            row["title"] != expected["title"]
            or row["source_type"] != expected["source_type"]
            or row["artifact_id"] != existing_artifact_id
            or row["url"] != expected["url"]
            or row["metadata_json"] != expected["metadata_json"]
        ):
            conn.execute(
                """
                UPDATE study_sources
                SET title = ?, source_type = ?, artifact_id = ?, url = ?, metadata_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    expected["title"],
                    expected["source_type"],
                    existing_artifact_id,
                    expected["url"],
                    expected["metadata_json"],
                    now_iso,
                    source_id,
                ),
            )
    return source_id


def _ensure_topics(conn: Any, source_id: str, cards: list[dict[str, Any]], now_iso: str) -> dict[str, str]:
    topic_ids: dict[str, str] = {}
    sections = list(dict.fromkeys(str(card["section"]).strip() for card in cards))
    for display_order, section in enumerate(sections, start=1):
        topic_id = _stable_id("study_topic", source_id, section)
        topic_ids[section] = topic_id
        summary = "Trusted local PDF review-card topic. Mark this topic read to release its cards."
        row = conn.execute("SELECT * FROM study_topics WHERE id = ?", (topic_id,)).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO study_topics (
                  id, source_id, parent_topic_id, title, summary, display_order, created_at, updated_at
                ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
                """,
                (topic_id, source_id, section, summary, display_order, now_iso, now_iso),
            )
        elif (
            row["source_id"] != source_id
            or row["title"] != section
            or row["summary"] != summary
            or int(row["display_order"]) != display_order
        ):
            conn.execute(
                """
                UPDATE study_topics
                SET source_id = ?, parent_topic_id = NULL, title = ?, summary = ?, display_order = ?, updated_at = ?
                WHERE id = ?
                """,
                (source_id, section, summary, display_order, now_iso, topic_id),
            )
    return topic_ids


def _ensure_report_topic(conn: Any, source_id: str, now_iso: str) -> str:
    topic_id = _stable_id("study_topic", source_id, SOURCE_EVIDENCE_TOPIC_TITLE)
    summary = "Local PDF extraction evidence that is not trusted enough to generate review cards."
    row = conn.execute("SELECT * FROM study_topics WHERE id = ?", (topic_id,)).fetchone()
    if row is None:
        conn.execute(
            """
            INSERT INTO study_topics (
              id, source_id, parent_topic_id, title, summary, display_order, created_at, updated_at
            ) VALUES (?, ?, NULL, ?, ?, 0, ?, ?)
            """,
            (topic_id, source_id, SOURCE_EVIDENCE_TOPIC_TITLE, summary, now_iso, now_iso),
        )
    elif row["source_id"] != source_id or row["title"] != SOURCE_EVIDENCE_TOPIC_TITLE or row["summary"] != summary:
        conn.execute(
            """
            UPDATE study_topics
            SET source_id = ?, parent_topic_id = NULL, title = ?, summary = ?, display_order = 0, updated_at = ?
            WHERE id = ?
            """,
            (source_id, SOURCE_EVIDENCE_TOPIC_TITLE, summary, now_iso, topic_id),
        )
    return topic_id


def _upsert_chunk(conn: Any, source_id: str, topic_id: str, artifact_id: str, card: dict[str, Any], now_iso: str) -> None:
    metadata = dict(card["metadata"])
    chunk_index = _chunk_index(card)
    chunk_id = _stable_id("study_chunk", source_id, chunk_index)
    content = str(card["answer"]).strip()
    metadata_json = _json(
        {
            "import_key": _card_import_key(card),
            "card_question_index": card["question_index"],
            "content_kind": "card_answer_excerpt",
            **metadata,
        }
    )
    row = conn.execute("SELECT * FROM source_chunks WHERE source_id = ? AND chunk_index = ?", (source_id, chunk_index)).fetchone()
    if row is None:
        conn.execute(
            """
            INSERT INTO source_chunks (id, source_id, topic_id, artifact_id, chunk_index, content, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (chunk_id, source_id, topic_id, artifact_id, chunk_index, content, metadata_json, now_iso),
        )
    elif (
        row["topic_id"] != topic_id
        or row["artifact_id"] != artifact_id
        or row["content"] != content
        or row["metadata_json"] != metadata_json
    ):
        conn.execute(
            "UPDATE source_chunks SET topic_id = ?, artifact_id = ?, content = ?, metadata_json = ? WHERE id = ?",
            (topic_id, artifact_id, content, metadata_json, row["id"]),
        )


def _segment_int(segment: dict[str, Any], key: str, default: int = 0) -> int:
    try:
        value = int(segment.get(key, default))
    except (TypeError, ValueError):
        return default
    return max(0, value)


def _report_chunk_index(segment: dict[str, Any]) -> tuple[int, int]:
    source_chunk_index = _segment_int(segment, "chunk_index", len(str(segment.get("segment_id") or "")))
    return source_chunk_index, REPORT_EVIDENCE_CHUNK_INDEX_OFFSET + source_chunk_index


def _report_segments(report: dict[str, Any]) -> list[dict[str, Any]]:
    blocked = report.get("blocked_segments")
    if not isinstance(blocked, list):
        blocked = report.get("blocked_chunks")
    segments: list[dict[str, Any]] = []
    if isinstance(blocked, list):
        for segment in blocked:
            if isinstance(segment, dict):
                item = dict(segment)
                item.setdefault("status", "blocked")
                item.setdefault("page_status", "unproven")
                item.setdefault("ocr_needed", False)
                segments.append(item)
    candidate_cards_path = str(report.get("candidate_cards_path") or "").strip()
    if candidate_cards_path:
        path = Path(candidate_cards_path)
        if path.is_file():
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                candidate = json.loads(line)
                provenance = candidate.get("provenance") if isinstance(candidate, dict) else {}
                chunk = provenance.get("chunk") if isinstance(provenance, dict) else {}
                if not isinstance(chunk, dict):
                    continue
                segments.append(
                    {
                        "status": str(candidate.get("status") or "candidate"),
                        "chunk_index": chunk.get("index"),
                        "word_start": chunk.get("word_start"),
                        "word_end": chunk.get("word_end"),
                        "word_count": chunk.get("word_count"),
                        "content_sha256": chunk.get("content_sha256"),
                        "page_status": "ready",
                        "ocr_needed": False,
                        "page_label": "scan-unknown",
                        "page_start": None,
                        "page_end": None,
                        "reason": "Trusted local extraction candidate; cards require explicit final import.",
                    }
                )
    if not segments and str(report.get("evidence_status") or "") != "proven_local_text":
        segments.append(
            {
                "chunk_index": 0,
                "content_sha256": "",
                "page_status": "unproven",
                "ocr_needed": False,
                "reason": report.get("deck_generation") or "Local PDF extraction was unavailable or unproven.",
                "status": "blocked",
                "word_count": 0,
                "word_end": 0,
                "word_start": 0,
            }
        )
    return segments


def _upsert_report_chunk(
    conn: Any,
    *,
    source_id: str,
    topic_id: str,
    artifact_id: str,
    report: dict[str, Any],
    report_path: Path,
    pdf_sha: str,
    segment: dict[str, Any],
    now_iso: str,
) -> str:
    source_chunk_index, chunk_index = _report_chunk_index(segment)
    content_hash = str(segment.get("content_sha256") or "").strip()
    chunk_id = _stable_id("study_chunk", source_id, chunk_index)
    status = str(segment.get("status") or "blocked")
    reason = str(segment.get("reason") or report.get("deck_generation") or "unproven extraction")
    content = (
        f"{status.title()} PDF source page/segment. "
        f"Reason: {reason} "
        f"Content SHA256: {content_hash or 'unavailable'}."
    )
    metadata = {
        "content_sha256": content_hash,
        "deck_generation": report.get("deck_generation") or "",
        "evidence_status": report.get("evidence_status") or "unproven",
        "page_end": segment.get("page_end"),
        "page_label": segment.get("page_label"),
        "page_start": segment.get("page_start"),
        "page_status": segment.get("page_status") or "unproven",
        "ocr_needed": bool(segment.get("ocr_needed")),
        "pdf_sha256": pdf_sha,
        "reason": reason,
        "report_path": str(report_path),
        "source_chunk_index": source_chunk_index,
        "source_chunk_import": "inference_pdf_report",
        "status": status,
        "word_count": _segment_int(segment, "word_count"),
        "word_end": _segment_int(segment, "word_end"),
        "word_start": _segment_int(segment, "word_start"),
    }
    row = conn.execute("SELECT * FROM source_chunks WHERE source_id = ? AND chunk_index = ?", (source_id, chunk_index)).fetchone()
    if row is None:
        conn.execute(
            """
            INSERT INTO source_chunks (id, source_id, topic_id, artifact_id, chunk_index, content, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (chunk_id, source_id, topic_id, artifact_id, chunk_index, content, _json(metadata), now_iso),
        )
        return chunk_id
    existing_metadata = _decode_json(row["metadata_json"], {})
    if existing_metadata.get("source_chunk_import") != "inference_pdf_report":
        return str(row["id"])
    if (
        row["topic_id"] != topic_id
        or row["artifact_id"] != artifact_id
        or row["content"] != content
        or row["metadata_json"] != _json(metadata)
    ):
        conn.execute(
            "UPDATE source_chunks SET topic_id = ?, artifact_id = ?, content = ?, metadata_json = ? WHERE id = ?",
            (topic_id, artifact_id, content, _json(metadata), row["id"]),
        )
    return str(row["id"])


def _upsert_card(
    conn: Any,
    *,
    card: dict[str, Any],
    deck_id: str,
    schedule: dict[str, Any],
    artifact_id: str,
    note_id: str,
    card_set_version_id: str,
    topic_id: str,
    source_id: str,
    now_iso: str,
) -> str:
    import_key = _card_import_key(card)
    card_id = _stable_id("crd", import_key)
    note_block_id = _stable_id("blk", import_key)
    note_content = _note_block_content(card)
    conn.execute(
        """
        INSERT INTO note_blocks (id, note_id, artifact_id, block_type, content, created_at)
        VALUES (?, ?, ?, 'pdf_review_card', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          note_id = excluded.note_id,
          artifact_id = excluded.artifact_id,
          block_type = excluded.block_type,
          content = excluded.content
        """,
        (note_block_id, note_id, artifact_id, note_content, now_iso),
    )
    expected = {
        "card_set_version_id": card_set_version_id,
        "artifact_id": artifact_id,
        "note_block_id": note_block_id,
        "deck_id": deck_id,
        "card_type": str(card.get("card_type") or "qa"),
        "prompt": str(card["prompt"]),
        "answer": str(card["answer"]),
        "tags_json": _json(_card_tags(card)),
    }
    row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
    if row is None:
        due_at = (datetime.fromisoformat(now_iso) + timedelta(hours=int(schedule["new_cards_due_offset_hours"]))).isoformat()
        conn.execute(
            """
            INSERT INTO cards (
              id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type, prompt, answer,
              tags_json, suspended, due_at, interval_days, repetitions, ease_factor, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?)
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
                due_at,
                int(schedule["initial_interval_days"]),
                float(schedule["initial_ease_factor"]),
                now_iso,
                now_iso,
            ),
        )
    elif any(row[key] != value for key, value in expected.items()):
        conn.execute(
            """
            UPDATE cards
            SET card_set_version_id = ?, artifact_id = ?, note_block_id = ?, deck_id = ?,
                card_type = ?, prompt = ?, answer = ?, tags_json = ?, updated_at = ?
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
    conn.execute(
        """
        DELETE FROM card_topic_links
        WHERE card_id = ?
          AND topic_id != ?
          AND topic_id IN (SELECT id FROM study_topics WHERE source_id = ?)
        """,
        (card_id, topic_id, source_id),
    )
    link_id = _stable_id("card_topic", card_id, topic_id)
    conn.execute(
        """
        INSERT INTO card_topic_links (id, card_id, topic_id, gate_required, created_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(card_id, topic_id) DO UPDATE SET gate_required = 1
        """,
        (link_id, card_id, topic_id, now_iso),
    )
    return card_id


def load_source_report(path: Path) -> dict[str, Any]:
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid PDF source evidence report JSON: {path}") from exc
    if not isinstance(report, dict):
        raise ValueError("PDF source evidence report must be a JSON object")
    return report


def import_source_report(
    report_path: Path,
    *,
    cards_path: Path | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    report = load_source_report(report_path)
    pdf_sha = _report_pdf_sha(report)
    source_key = _source_key_from_pdf_sha(pdf_sha)
    report_cards_path = cards_path
    if report_cards_path is None:
        raw_cards_path = str(report.get("cards_path") or "").strip()
        if raw_cards_path:
            report_cards_path = Path(raw_cards_path)
    ready_cards_path = (
        report_cards_path
        if report_cards_path and report_cards_path.is_file() and str(report.get("final_card_status") or "") == "ready"
        else None
    )
    if ready_cards_path is not None:
        _validate_cards_match_report(ready_cards_path, source_key=source_key, pdf_sha=pdf_sha)

    segments = _report_segments(report)
    summary: dict[str, Any] = {
        "cards_path": str(report_cards_path) if report_cards_path else "",
        "deck_generation": report.get("deck_generation") or "",
        "dry_run": dry_run,
        "evidence_status": report.get("evidence_status") or "unproven",
        "pdf_sha256": pdf_sha,
        "report_path": str(report_path),
        "segment_count": len(segments),
        "source_key": source_key,
    }
    if dry_run:
        return summary

    from app.core.time import utc_now  # noqa: E402
    from app.db.storage import get_connection, init_storage  # noqa: E402

    init_storage()
    now_iso = utc_now().isoformat()
    with get_connection() as conn:
        evidence_artifact_id = _ensure_source_evidence_artifact(
            conn,
            report_path,
            report,
            pdf_sha=pdf_sha,
            cards_path=summary["cards_path"],
            now_iso=now_iso,
        )
        source_id = _ensure_report_study_source(
            conn,
            source_key=source_key,
            artifact_id=evidence_artifact_id,
            report=report,
            pdf_sha=pdf_sha,
            now_iso=now_iso,
        )
        topic_id = _ensure_report_topic(conn, source_id, now_iso)
        chunk_ids = [
            _upsert_report_chunk(
                conn,
                source_id=source_id,
                topic_id=topic_id,
                artifact_id=evidence_artifact_id,
                report=report,
                report_path=report_path,
                pdf_sha=pdf_sha,
                segment=segment,
                now_iso=now_iso,
            )
            for segment in segments
        ]
        conn.commit()

    summary.update(
        {
            "artifact_id": evidence_artifact_id,
            "chunk_ids": chunk_ids,
            "source_id": source_id,
            "topic_id": topic_id,
        }
    )
    if ready_cards_path is not None:
        summary["card_import"] = import_cards(ready_cards_path)
    return summary


def import_cards(cards_path: Path, *, dry_run: bool = False) -> dict[str, Any]:
    cards = load_cards(cards_path)
    summary: dict[str, Any] = {
        "cards_path": str(cards_path),
        "deck_name": DECK_NAME,
        "card_count": len(cards),
        "sections": list(dict.fromkeys(str(card["section"]) for card in cards)),
        "providers": sorted({str(card["metadata"].get("provider")) for card in cards}),
        "source_key": _source_key(cards),
        "source_url": cards[0]["source_url"],
    }
    if dry_run:
        summary["dry_run"] = True
        return summary

    from app.core.time import utc_now  # noqa: E402
    from app.db.storage import get_connection, init_storage  # noqa: E402
    from app.services import srs_service  # noqa: E402

    init_storage()
    now_iso = utc_now().isoformat()
    with get_connection() as conn:
        default_schedule = srs_service.ensure_default_deck(conn)["schedule"]
        deck_id, schedule = _ensure_deck(conn, default_schedule, now_iso)
        artifact_id = _ensure_artifact(conn, cards_path, cards, now_iso)
        card_set_version_id = _ensure_card_set_version(conn, artifact_id, now_iso)
        note_id = _ensure_note(conn, artifact_id, len(cards), now_iso)
        source_id = _ensure_study_source(conn, artifact_id, cards, now_iso)
        topic_ids = _ensure_topics(conn, source_id, cards, now_iso)
        _ensure_relation(conn, artifact_id, "artifact.card_set_version", "card_set_version", card_set_version_id, now_iso)
        _ensure_relation(conn, artifact_id, "artifact.note", "note", note_id, now_iso)

        card_ids: list[str] = []
        for card in cards:
            topic_id = topic_ids[str(card["section"])]
            _upsert_chunk(conn, source_id, topic_id, artifact_id, card, now_iso)
            card_ids.append(
                _upsert_card(
                    conn,
                    card=card,
                    deck_id=deck_id,
                    schedule=schedule,
                    artifact_id=artifact_id,
                    note_id=note_id,
                    card_set_version_id=card_set_version_id,
                    topic_id=topic_id,
                    source_id=source_id,
                    now_iso=now_iso,
                )
            )
        conn.commit()

    summary.update(
        {
            "artifact_id": artifact_id,
            "card_ids": card_ids,
            "card_set_version_id": card_set_version_id,
            "deck_id": deck_id,
            "note_id": note_id,
            "source_id": source_id,
            "topic_ids": topic_ids,
        }
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import trusted local PDF review cards and/or source evidence into SRS and Study Core."
    )
    parser.add_argument("cards", type=Path, nargs="?", help="Path to review_cards.jsonl from build_pdf_review_cards.py.")
    parser.add_argument(
        "--source-report",
        type=Path,
        help="Path to report.json from build_pdf_review_cards.py or pdf_deck_preflight.py.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate the cards without mutating the DB.")
    args = parser.parse_args()
    if args.source_report:
        print(
            json.dumps(
                import_source_report(
                    args.source_report.expanduser().resolve(),
                    cards_path=args.cards.expanduser().resolve() if args.cards else None,
                    dry_run=args.dry_run,
                ),
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    if args.cards is None:
        parser.error("cards path or --source-report is required")
    print(json.dumps(import_cards(args.cards.expanduser().resolve(), dry_run=args.dry_run), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
