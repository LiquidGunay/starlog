from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import bootstrap_ml_interview_srs as bootstrap
import build_ml_interview_srs_deck as build


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

    assert "Source URL: https://example.test/source" in content
    assert "Section: Sample Section" in content
    assert "Question Index: 0001" in content
    assert "Answer Source: heuristic" in content
    assert "X is the first quantity." in content


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
