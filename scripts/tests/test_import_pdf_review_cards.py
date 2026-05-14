from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
SERVICES_API_DIR = REPO_ROOT / "services/api"
for path in (SCRIPTS_DIR, SERVICES_API_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import import_pdf_review_cards as importer  # noqa: E402


def _card(
    index: int,
    section: str = "Chapter 0: Inference",
    *,
    chunk_index: int | None = None,
    pdf_sha: str = "pdf-sha",
    source_path: str = "/tmp/Inference Engineering.pdf",
    source_url: str = "file:///tmp/Inference Engineering.pdf",
) -> dict:
    chunk_index = index if chunk_index is None else chunk_index
    return {
        "answer": "Inference serving needs runtime, infrastructure, and tooling to work together.",
        "card_type": "qa",
        "difficulty": "M",
        "metadata": {
            "answer_source": "trusted_local_pdf_extraction",
            "chunk_content_sha256": f"chunk-{index:04d}",
            "chunk_index": chunk_index,
            "evidence_run_id": "test-run",
            "mode": "liteparse",
            "pdf_sha256": pdf_sha,
            "provider": "liteparse_server",
            "source_path": source_path,
            "word_end": 180 + index,
            "word_start": 20 + index,
        },
        "prompt": f"What is the source-backed takeaway from {section} chunk {index + 1:04d}?",
        "question": f"What is the source-backed takeaway from {section} chunk {index + 1:04d}?",
        "question_index": f"{index + 1:04d}",
        "section": section,
        "source_url": source_url,
    }


def _write_cards(path: Path, cards: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(card, sort_keys=True) for card in cards) + "\n", encoding="utf-8")


def test_import_pdf_review_cards_creates_gated_srs_cards(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "starlog.db"
    media_dir = tmp_path / "media"
    cards_path = tmp_path / "review_cards.jsonl"
    _write_cards(cards_path, [_card(0), _card(1)])
    monkeypatch.setenv("STARLOG_DB_PATH", str(db_path))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(media_dir))

    from app.core.config import get_settings  # noqa: E402
    from app.core.time import utc_now  # noqa: E402
    from app.db.storage import get_connection  # noqa: E402
    from app.services import srs_service, study_service  # noqa: E402

    get_settings.cache_clear()
    try:
        summary = importer.import_cards(cards_path)
        second_summary = importer.import_cards(cards_path)

        assert summary["card_count"] == 2
        assert summary["deck_name"] == "Inference Engineering"
        assert summary["card_ids"] == second_summary["card_ids"]
        assert summary["topic_ids"] == second_summary["topic_ids"]

        with get_connection() as conn:
            assert conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 2
            assert conn.execute("SELECT COUNT(*) FROM card_topic_links WHERE gate_required = 1").fetchone()[0] == 2
            assert conn.execute("SELECT COUNT(*) FROM source_chunks").fetchone()[0] == 2
            assert conn.execute("SELECT COUNT(*) FROM study_sources").fetchone()[0] == 1
            assert conn.execute("SELECT COUNT(*) FROM study_topics").fetchone()[0] == 1
            conn.execute(
                "UPDATE cards SET due_at = ?",
                ((utc_now()).isoformat(),),
            )
            conn.commit()

            assert [card["id"] for card in srs_service.due_cards(conn, 10)] == []
            topic_id = next(iter(summary["topic_ids"].values()))
            study_service.mark_topic_read(conn, topic_id)
            due_ids = [card["id"] for card in srs_service.due_cards(conn, 10)]

        assert due_ids == summary["card_ids"]
    finally:
        get_settings.cache_clear()


def test_import_pdf_review_cards_rejects_untrusted_provider(tmp_path: Path) -> None:
    cards_path = tmp_path / "review_cards.jsonl"
    card = _card(0)
    card["metadata"]["provider"] = "strings"
    _write_cards(cards_path, [card])

    try:
        importer.load_cards(cards_path)
    except ValueError as exc:
        assert "untrusted provider" in str(exc)
    else:
        raise AssertionError("Expected untrusted PDF provider to be rejected")


def test_import_pdf_review_cards_rejects_spoofed_or_mixed_sources(tmp_path: Path) -> None:
    cards_path = tmp_path / "review_cards.jsonl"
    spoofed = _card(0)
    spoofed["metadata"]["answer_source"] = "manual"
    _write_cards(cards_path, [spoofed])
    try:
        importer.load_cards(cards_path)
    except ValueError as exc:
        assert "untrusted answer_source" in str(exc)
    else:
        raise AssertionError("Expected spoofed answer_source to be rejected")

    mixed_path = tmp_path / "mixed_review_cards.jsonl"
    _write_cards(
        mixed_path,
        [
            _card(0),
            _card(
                1,
                pdf_sha="different-pdf-sha",
                source_path="/tmp/Other Inference Engineering.pdf",
                source_url="file:///tmp/Other%20Inference%20Engineering.pdf",
            ),
        ],
    )
    try:
        importer.load_cards(mixed_path)
    except ValueError as exc:
        assert "mixes multiple PDF sources" in str(exc)
    else:
        raise AssertionError("Expected mixed PDF sources to be rejected")


def test_import_pdf_review_cards_replaces_stale_section_links(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "starlog.db"
    media_dir = tmp_path / "media"
    first_cards = tmp_path / "review_cards_first.jsonl"
    corrected_cards = tmp_path / "review_cards_corrected.jsonl"
    _write_cards(first_cards, [_card(0, section="Inference Engineering")])
    _write_cards(corrected_cards, [_card(0, section="Chapter 0: Inference")])
    monkeypatch.setenv("STARLOG_DB_PATH", str(db_path))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(media_dir))

    from app.core.config import get_settings  # noqa: E402
    from app.db.storage import get_connection  # noqa: E402

    get_settings.cache_clear()
    try:
        first_summary = importer.import_cards(first_cards)
        corrected_summary = importer.import_cards(corrected_cards)

        assert first_summary["card_ids"] == corrected_summary["card_ids"]
        card_id = corrected_summary["card_ids"][0]
        corrected_topic_id = corrected_summary["topic_ids"]["Chapter 0: Inference"]
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT topic_id FROM card_topic_links WHERE card_id = ? AND gate_required = 1",
                (card_id,),
            ).fetchall()

        assert [row["topic_id"] for row in rows] == [corrected_topic_id]
    finally:
        get_settings.cache_clear()


def test_import_pdf_review_cards_scopes_sources_by_pdf_sha(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "starlog.db"
    media_dir = tmp_path / "media"
    first_cards = tmp_path / "first.jsonl"
    second_cards = tmp_path / "second.jsonl"
    _write_cards(first_cards, [_card(0, pdf_sha="pdf-sha-one")])
    _write_cards(
        second_cards,
        [
            _card(
                0,
                pdf_sha="pdf-sha-two",
                source_path="/tmp/Inference Engineering second.pdf",
                source_url="file:///tmp/Inference%20Engineering%20second.pdf",
            )
        ],
    )
    monkeypatch.setenv("STARLOG_DB_PATH", str(db_path))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(media_dir))

    from app.core.config import get_settings  # noqa: E402
    from app.db.storage import get_connection  # noqa: E402

    get_settings.cache_clear()
    try:
        first_summary = importer.import_cards(first_cards)
        second_summary = importer.import_cards(second_cards)

        assert first_summary["source_id"] != second_summary["source_id"]
        assert first_summary["artifact_id"] != second_summary["artifact_id"]
        with get_connection() as conn:
            assert conn.execute("SELECT COUNT(*) FROM study_sources").fetchone()[0] == 2
            assert conn.execute("SELECT COUNT(*) FROM source_chunks").fetchone()[0] == 2
    finally:
        get_settings.cache_clear()
