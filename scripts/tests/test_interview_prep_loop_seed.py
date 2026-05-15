from __future__ import annotations

from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import interview_prep_loop_seed as seed  # noqa: E402


def test_neetcode_topic_read_gates_due_cards(tmp_path: Path) -> None:
    db_path = tmp_path / "starlog.db"
    media_dir = tmp_path / "media"

    summary = seed.seed_interview_topic_gate_harness(
        db_path=db_path,
        media_dir=media_dir,
        topic_title="Sliding Window",
    )

    assert summary["neetcode"]["problem_count"] == 150
    assert summary["topic"]["title"] == "Sliding Window"
    assert summary["topic"]["id"]
    assert [topic["title"] for topic in summary["topic"]["prerequisites_marked_read"]] == [
        "Arrays & Hashing",
        "Two Pointers",
    ]
    assert summary["card_id"]
    assert len(summary["card_ids"]) == 2
    assert len(summary["problem_keys"]) == 2
    assert len(set(summary["problem_keys"])) == 2
    assert all(card_id.startswith(problem_key) for card_id, problem_key in zip(summary["card_ids"], summary["problem_keys"]))
    assert summary["due"]["before_mark_read"]["card_in_due_queue"] is False
    assert summary["due"]["after_mark_read_before_request"]["card_in_due_queue"] is False
    assert summary["due"]["after_mark_read"]["card_in_due_queue"] is True
    assert summary["due"]["after_mark_read"]["due_seed_card_count"] == 2
    assert summary["topic_read"]["status"] == "read"
    assert summary["topic_read"]["read_at"] is not None
