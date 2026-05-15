from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import bootstrap_ml_interview_srs as bootstrap  # noqa: E402
import build_ml_interview_srs_deck as build  # noqa: E402


def _ml_card(question_index: str, section: str, prompt: str | None = None) -> dict[str, object]:
    prompt = prompt or f"What is concept {question_index}?"
    source_slug = section.lower().replace(" ", "-")
    return {
        "card_type": "qa",
        "prompt": prompt,
        "answer": f"Answer for {question_index}.",
        "source_url": f"https://example.test/{source_slug}",
        "section": section,
        "question_index": question_index,
        "question": prompt,
        "difficulty": "E",
        "metadata": {
            "answer_source": "heuristic",
            "source_path": f"contents/{source_slug}.md",
            "source_url": f"https://example.test/{source_slug}",
            "section": section,
            "question_index": question_index,
            "difficulty": "E",
        },
    }


def _write_deck(path: Path, cards: list[dict[str, object]]) -> None:
    path.write_text("\n".join(json.dumps(card) for card in cards), encoding="utf-8")


def test_parse_list_items_keeps_multiline_continuations() -> None:
    markdown = """- [E] Given the following matrix:
    \\begin{align*}
    \\begin{bmatrix}
    1 & 0 \\\\
    0 & 1
    \\end{bmatrix}
    \\end{align*}
  What is its determinant?
"""
    items = build.parse_list_items(markdown)
    questions = build.question_from_items(items)

    assert len(questions) == 1
    assert "determinant" in questions[0].question.lower()
    assert "begin{bmatrix}" in questions[0].question
    assert questions[0].difficulty == "E"


def test_build_deck_uses_answer_repo_when_available(monkeypatch) -> None:
    def fake_fetch_from_repo(path: str) -> str:
        if path == "SUMMARY.md":
            return "## Part II: Questions\n- [1.1](contents/test.md)\n## Appendix"
        if path == "contents/test.md":
            return "# Sample Section\n\n- What is X?\n"
        raise AssertionError(f"unexpected path: {path}")

    def fake_fetch_answer_source() -> str:
        return r"\begin{QandA}\item What is X? \begin{answer} X is the first quantity. \end{answer}\end{QandA}"

    monkeypatch.setattr(build, "fetch_from_repo", fake_fetch_from_repo)
    monkeypatch.setattr(build, "fetch_answer_source", fake_fetch_answer_source)

    deck = build.build_deck()

    assert len(deck) == 1
    card = deck[0]
    assert card["answer"] == "X is the first quantity."
    assert card["metadata"]["answer_source"] == "zafstojano/ml-interview-questions-and-answers"
    assert card["metadata"]["source_url"] == "https://huyenchip.com/ml-interviews-book/contents/test.html"


def test_build_deck_raises_on_chapter_fetch_failure(monkeypatch) -> None:
    def fake_fetch_from_repo(path: str) -> str:
        if path == "SUMMARY.md":
            return "## Part II: Questions\n- [1.1](contents/test.md)\n## Appendix"
        raise RuntimeError("boom")

    monkeypatch.setattr(build, "fetch_from_repo", fake_fetch_from_repo)
    monkeypatch.setattr(build, "fetch_answer_source", lambda: "")

    with pytest.raises(RuntimeError, match="Failed to fetch chapter source contents/test.md"):
        build.build_deck()


def test_build_deck_falls_back_to_extensionless_summary_targets(monkeypatch) -> None:
    def fake_fetch_from_repo(path: str) -> str:
        if path == "SUMMARY.md":
            return "## Part II: Questions\n- [1.1](contents/test.md)\n## Appendix"
        if path == "contents/test":
            return "# Empty Overview\n\n"
        raise RuntimeError("boom")

    monkeypatch.setattr(build, "fetch_from_repo", fake_fetch_from_repo)
    monkeypatch.setattr(build, "fetch_answer_source", lambda: "")

    deck = build.build_deck()

    assert deck == []


def test_build_note_block_content_contains_provenance() -> None:
    card = {
        "prompt": "What is X?",
        "answer": "X is the first quantity.",
        "source_url": "https://example.test/source",
        "section": "Sample Section",
        "question_index": "0001",
        "difficulty": "E",
        "metadata": {"answer_source": "heuristic"},
    }

    content = bootstrap.build_note_block_content(card)

    assert "Import Key: ml-interviews-part-ii:0001" in content
    assert "Source URL: https://example.test/source" in content
    assert "Source Path: unspecified" in content
    assert "Section: Sample Section" in content
    assert "Question Index: 0001" in content
    assert "Answer Source: heuristic" in content
    assert "Tags: ml-interviews-part-ii, section-sample-section, difficulty-e, source-heuristic" in content
    assert "X is the first quantity." in content


def test_stable_card_tags_use_section_difficulty_and_source() -> None:
    card = {
        "prompt": "What is X?",
        "answer": "X is the first quantity.",
        "source_url": "https://example.test/source",
        "section": "5.2.2 Stats",
        "question_index": "0001",
        "question": "What is X?",
        "difficulty": "H",
        "metadata": {"answer_source": "zafstojano/ml-interview-questions-and-answers"},
    }

    assert bootstrap.stable_card_tags(card) == [
        "ml-interviews-part-ii",
        "section-5-2-2-stats",
        "difficulty-h",
        "source-zafstojano-ml-interview-questions-and-answers",
    ]


def test_load_cards_accepts_metadata(tmp_path: Path) -> None:
    deck_path = tmp_path / "deck.jsonl"
    deck_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "card_type": "qa",
                        "prompt": "What is X?",
                        "answer": "X is the first quantity.",
                        "source_url": "https://example.test/source",
                        "section": "Sample Section",
                        "question_index": "0001",
                        "question": "What is X?",
                        "metadata": {"answer_source": "heuristic"},
                    }
                )
            ]
        ),
        encoding="utf-8",
    )

    cards = bootstrap.load_cards(deck_path)

    assert len(cards) == 1
    assert cards[0]["metadata"]["answer_source"] == "heuristic"


def test_load_cards_rejects_duplicate_question_index(tmp_path: Path) -> None:
    deck_path = tmp_path / "deck.jsonl"
    record = {
        "card_type": "qa",
        "prompt": "What is X?",
        "answer": "X is the first quantity.",
        "source_url": "https://example.test/source",
        "section": "Sample Section",
        "question_index": "0001",
        "question": "What is X?",
        "metadata": {"answer_source": "heuristic"},
    }
    deck_path.write_text("\n".join([json.dumps(record), json.dumps(record)]), encoding="utf-8")

    with pytest.raises(ValueError, match="duplicates question_index: 0001"):
        bootstrap.load_cards(deck_path)


def test_import_cards_is_idempotent_and_preserves_review_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    deck_path = tmp_path / "deck.jsonl"
    deck_path.write_text(
        json.dumps(
            {
                "card_type": "qa",
                "prompt": "What is X?",
                "answer": "X is the first quantity.",
                "source_url": "https://example.test/source",
                "section": "Sample Section",
                "question_index": "0001",
                "question": "What is X?",
                "difficulty": "E",
                "metadata": {
                    "answer_source": "heuristic",
                    "source_path": "contents/sample.md",
                    "source_url": "https://example.test/source",
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog.db"))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(tmp_path / "media"))

    from app.core.config import get_settings
    from app.db.storage import get_connection
    from app.services import srs_service, study_service

    get_settings.cache_clear()
    try:
        first = bootstrap.import_cards(deck_path, dry_run=False)

        assert first["deck_name"] == "ML Interviews Part II"
        assert first["inserted_cards"] == 1
        assert first["updated_cards"] == 0
        assert first["source"]["created"] == 1
        assert first["topics"]["created"] == 1
        assert first["source_chunks"]["created"] == 1
        assert first["card_topic_links"]["created"] == 1
        assert first["card_topic_links"]["section_links"] == 1

        with get_connection() as conn:
            card = conn.execute("SELECT id FROM cards").fetchone()
            assert card is not None
            conn.execute(
                """
                UPDATE cards
                SET due_at = ?, interval_days = ?, repetitions = ?, ease_factor = ?
                WHERE id = ?
                """,
                ("2030-01-01T00:00:00+00:00", 42, 7, 1.8, card["id"]),
            )
            conn.commit()

        second = bootstrap.import_cards(deck_path, dry_run=False)

        assert second["artifact_id"] == first["artifact_id"]
        assert second["card_set_version_id"] == first["card_set_version_id"]
        assert second["deck_id"] == first["deck_id"]
        assert second["note_id"] == first["note_id"]
        assert second["inserted_cards"] == 0
        assert second["updated_cards"] == 0
        assert second["unchanged_cards"] == 1
        assert second["source_id"] == first["source_id"]
        assert second["source"]["unchanged"] == 1
        assert second["topics"]["unchanged"] == 1
        assert second["source_chunks"]["unchanged"] == 1
        assert second["card_topic_links"]["created"] == 0
        assert second["card_topic_links"]["unchanged"] == 1
        assert second["card_topic_links"]["deleted"] == 0

        with get_connection() as conn:
            counts = {
                table: conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()["count"]
                for table in (
                    "study_sources",
                    "study_topics",
                    "source_chunks",
                    "artifacts",
                    "card_set_versions",
                    "notes",
                    "cards",
                    "note_blocks",
                    "card_topic_links",
                )
            }
            assert counts == {
                "study_sources": 1,
                "study_topics": 1,
                "source_chunks": 1,
                "artifacts": 1,
                "card_set_versions": 1,
                "notes": 1,
                "cards": 1,
                "note_blocks": 1,
                "card_topic_links": 1,
            }
            deck = conn.execute("SELECT name FROM card_decks WHERE id = ?", (first["deck_id"],)).fetchone()
            assert deck["name"] == "ML Interviews Part II"
            card = conn.execute(
                "SELECT id, deck_id, tags_json, due_at, interval_days, repetitions, ease_factor FROM cards"
            ).fetchone()
            assert card["deck_id"] == first["deck_id"]
            assert json.loads(card["tags_json"]) == [
                "ml-interviews-part-ii",
                "section-sample-section",
                "difficulty-e",
                "source-heuristic",
            ]
            assert card["due_at"] == "2030-01-01T00:00:00+00:00"
            assert card["interval_days"] == 42
            assert card["repetitions"] == 7
            assert card["ease_factor"] == 1.8
            note_block = conn.execute("SELECT content FROM note_blocks").fetchone()
            assert "Source Path: contents/sample.md" in note_block["content"]
            assert '"answer_source": "heuristic"' in note_block["content"]
            source = conn.execute("SELECT title, source_type, artifact_id, metadata_json FROM study_sources").fetchone()
            assert source["title"] == "ML Interviews Part II"
            assert source["source_type"] == "interview_prep"
            assert source["artifact_id"] == first["artifact_id"]
            source_metadata = json.loads(source["metadata_json"])
            assert source_metadata["import_key"] == "ml-interviews-part-ii"
            assert source_metadata["section_counts"] == {"Sample Section": 1}
            topic = study_service.resolve_topic_reference(conn, "ML Interviews Part II Sample Section")
            assert topic["source_id"] == first["source_id"]
            assert topic["title"] == "Sample Section"
            chunk = conn.execute(
                "SELECT topic_id, artifact_id, content, metadata_json FROM source_chunks"
            ).fetchone()
            assert chunk["topic_id"] == topic["id"]
            assert chunk["artifact_id"] == first["artifact_id"]
            assert "0001: What is X?" in chunk["content"]
            assert json.loads(chunk["metadata_json"])["question_indexes"] == ["0001"]
            link = conn.execute(
                "SELECT topic_id, gate_required FROM card_topic_links WHERE card_id = ?",
                (card["id"],),
            ).fetchone()
            assert link["topic_id"] == topic["id"]
            assert link["gate_required"] == 1

            conn.execute("UPDATE cards SET due_at = ? WHERE id = ?", ("2026-01-01T00:00:00+00:00", card["id"]))
            conn.commit()
            assert card["id"] not in {row["id"] for row in srs_service.due_cards(conn, 50)}

            unlocked = study_service.unlock_topic(conn, topic["id"])
            assert unlocked["manually_unlocked"] is True
            assert unlocked["read_at"] is None
            assert card["id"] not in {row["id"] for row in srs_service.due_cards(conn, 50)}

            read = study_service.mark_topic_read(conn, topic["id"])
            assert read["status"] == "read"
            assert read["read_at"] is not None
            assert card["id"] in {row["id"] for row in srs_service.due_cards(conn, 50)}
    finally:
        get_settings.cache_clear()


def test_import_cards_removes_stale_section_link_after_rename_and_releases_due_card(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    deck_path = tmp_path / "deck.jsonl"
    _write_deck(deck_path, [_ml_card("0001", "Old Section")])
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog.db"))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(tmp_path / "media"))

    from app.core.config import get_settings
    from app.db.storage import get_connection
    from app.services import srs_service, study_service

    get_settings.cache_clear()
    try:
        first = bootstrap.import_cards(deck_path, dry_run=False)
        old_topic_id = bootstrap._section_topic_id(first["source_id"], "Old Section")

        with get_connection() as conn:
            card = conn.execute("SELECT id FROM cards").fetchone()
            assert card is not None
            conn.execute("UPDATE cards SET due_at = ? WHERE id = ?", ("2026-01-01T00:00:00+00:00", card["id"]))
            conn.commit()

        _write_deck(deck_path, [_ml_card("0001", "New Section")])
        second = bootstrap.import_cards(deck_path, dry_run=False)

        assert second["topics"]["deleted"] == 1
        assert second["card_topic_links"]["deleted"] == 1
        with get_connection() as conn:
            new_topic = study_service.resolve_topic_reference(conn, "ML Interviews Part II New Section")
            links = conn.execute(
                """
                SELECT topic_id, gate_required
                FROM card_topic_links
                WHERE card_id = ?
                ORDER BY topic_id
                """,
                (card["id"],),
            ).fetchall()
            assert [(row["topic_id"], row["gate_required"]) for row in links] == [(new_topic["id"], 1)]
            assert conn.execute("SELECT id FROM study_topics WHERE id = ?", (old_topic_id,)).fetchone() is None
            assert card["id"] not in {row["id"] for row in srs_service.due_cards(conn, 50)}

            read = study_service.mark_topic_read(conn, new_topic["id"])
            assert read["status"] == "read"
            assert card["id"] in {row["id"] for row in srs_service.due_cards(conn, 50)}
    finally:
        get_settings.cache_clear()


def test_import_cards_removes_stale_section_topic_chunk_and_links_after_section_removal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    deck_path = tmp_path / "deck.jsonl"
    _write_deck(deck_path, [_ml_card("0001", "Kept Section"), _ml_card("0002", "Removed Section")])
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog.db"))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(tmp_path / "media"))

    from app.core.config import get_settings
    from app.db.storage import get_connection

    get_settings.cache_clear()
    try:
        first = bootstrap.import_cards(deck_path, dry_run=False)
        removed_topic_id = bootstrap._section_topic_id(first["source_id"], "Removed Section")

        _write_deck(deck_path, [_ml_card("0001", "Kept Section")])
        second = bootstrap.import_cards(deck_path, dry_run=False)

        assert second["topics"]["deleted"] == 1
        assert second["source_chunks"]["deleted"] == 1
        assert second["card_topic_links"]["deleted"] == 1

        with get_connection() as conn:
            topics = conn.execute("SELECT title FROM study_topics ORDER BY title").fetchall()
            assert [row["title"] for row in topics] == ["Kept Section"]
            chunks = conn.execute("SELECT chunk_index, topic_id, content FROM source_chunks").fetchall()
            assert len(chunks) == 1
            assert chunks[0]["chunk_index"] == 1
            assert "Kept Section" in chunks[0]["content"]
            assert "Removed Section" not in chunks[0]["content"]
            assert conn.execute("SELECT id FROM study_topics WHERE id = ?", (removed_topic_id,)).fetchone() is None
            stale_links = conn.execute(
                "SELECT id FROM card_topic_links WHERE topic_id = ?",
                (removed_topic_id,),
            ).fetchall()
            assert stale_links == []
    finally:
        get_settings.cache_clear()
