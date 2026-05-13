from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import import_neetcode_150 as neetcode  # noqa: E402


class MemoryReviewInputAdapter:
    def __init__(self) -> None:
        self.records: dict[str, dict[str, Any]] = {}

    def upsert_review_inputs(self, collection_id: str, review_inputs: list[dict[str, Any]]) -> dict[str, Any]:
        created = 0
        updated = 0
        unchanged = 0
        for review_input in review_inputs:
            external_id = str(review_input["external_id"])
            previous = self.records.get(external_id)
            if previous is None:
                self.records[external_id] = dict(review_input)
                created += 1
            elif previous["content_hash"] == review_input["content_hash"]:
                unchanged += 1
            else:
                self.records[external_id] = dict(review_input)
                updated += 1
        return {
            "adapter": "memory",
            "collection_id": collection_id,
            "created": created,
            "updated": updated,
            "unchanged": unchanged,
        }


def test_checked_in_source_validates_against_neetcode_taxonomy() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")

    assert len(source["items"]) == 150
    assert [item["sequence"] for item in source["items"]] == list(range(1, 151))
    assert source["items"][0]["title"] == "Contains Duplicate"
    assert source["items"][-1]["title"] == "Reverse Integer"
    assert source["items"][0]["notes"] == ""


def test_build_review_inputs_are_practice_oriented_and_solution_free() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")

    review_inputs = neetcode.build_review_inputs(source)

    assert len(review_inputs) == 150
    first = review_inputs[0]
    assert first["external_id"] == "neetcode-150-001"
    assert first["kind"] == "coding_problem_practice"
    assert first["source_url"] == "https://leetcode.com/problems/contains-duplicate/"
    assert "record approach, edge cases, complexity" in first["practice_prompt"]
    assert first["provenance"]["contains_solution_text"] is False
    assert "solution" not in first


def test_import_source_dry_run_reports_counts() -> None:
    summary = neetcode.import_neetcode_source(
        REPO_ROOT / "data/neetcode_150.json",
        neetcode.DryRunReviewInputAdapter(),
    )

    assert summary["problem_count"] == 150
    assert summary["review_input_count"] == 150
    assert summary["pattern_counts"] == neetcode.EXPECTED_PATTERN_COUNTS
    assert summary["difficulty_counts"] == neetcode.EXPECTED_DIFFICULTY_COUNTS
    assert summary["adapter"]["adapter"] == "dry_run"
    assert summary["adapter"]["unchanged"] == 150


def test_adapter_payloads_are_idempotent_by_external_id() -> None:
    source_path = REPO_ROOT / "data/neetcode_150.json"
    adapter = MemoryReviewInputAdapter()

    first = neetcode.import_neetcode_source(source_path, adapter)
    second = neetcode.import_neetcode_source(source_path, adapter)

    assert first["adapter"]["created"] == 150
    assert first["adapter"]["updated"] == 0
    assert second["adapter"]["created"] == 0
    assert second["adapter"]["updated"] == 0
    assert second["adapter"]["unchanged"] == 150
    assert len(adapter.records) == 150


def test_local_study_core_import_is_idempotent_and_links_prerequisites(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog.db"))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(tmp_path / "media"))

    from app.core.config import get_settings
    from app.db.storage import get_connection

    get_settings.cache_clear()
    try:
        source_path = REPO_ROOT / "data/neetcode_150.json"
        adapter = neetcode.StudyCoreLocalAdapter()

        first = neetcode.import_neetcode_source(source_path, adapter)
        second = neetcode.import_neetcode_source(source_path, adapter)

        assert first["adapter"]["adapter"] == "study_core_local"
        assert first["adapter"]["source"]["created"] == 1
        assert first["adapter"]["topics"]["created"] == len(neetcode.EXPECTED_PATTERN_COUNTS)
        assert first["adapter"]["practice_items"]["created"] == 150
        assert first["adapter"]["cards"]["created"] == 150
        assert first["adapter"]["card_topic_links"]["primary_links"] == 150
        assert first["adapter"]["card_topic_links"]["prerequisite_links"] == 166

        assert second["adapter"]["source_id"] == first["adapter"]["source_id"]
        assert second["adapter"]["artifact_id"] == first["adapter"]["artifact_id"]
        assert second["adapter"]["card_set_version_id"] == first["adapter"]["card_set_version_id"]
        assert second["adapter"]["practice_items"]["created"] == 0
        assert second["adapter"]["practice_items"]["unchanged"] == 150
        assert second["adapter"]["cards"]["created"] == 0
        assert second["adapter"]["cards"]["unchanged"] == 150
        assert second["adapter"]["card_topic_links"]["created"] == 0

        with get_connection() as conn:
            counts = {
                table: conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()["count"]
                for table in (
                    "study_sources",
                    "study_topics",
                    "practice_items",
                    "artifacts",
                    "card_set_versions",
                    "notes",
                    "note_blocks",
                    "cards",
                    "card_topic_links",
                )
            }
            assert counts == {
                "study_sources": 1,
                "study_topics": 18,
                "practice_items": 150,
                "artifacts": 1,
                "card_set_versions": 1,
                "notes": 1,
                "note_blocks": 150,
                "cards": 150,
                "card_topic_links": 316,
            }

            source = conn.execute("SELECT artifact_id, metadata_json FROM study_sources").fetchone()
            assert source["artifact_id"] == first["adapter"]["artifact_id"]
            source_metadata = json.loads(source["metadata_json"])
            assert source_metadata["import_key"] == "neetcode_150"
            assert source_metadata["problem_count"] == 150

            practice = conn.execute(
                "SELECT source_id, topic_id, metadata_json FROM practice_items WHERE id = ?",
                (neetcode._db_id("practice", "neetcode-150-010"),),
            ).fetchone()
            assert practice["source_id"] == first["adapter"]["source_id"]
            practice_metadata = json.loads(practice["metadata_json"])
            assert practice_metadata["external_id"] == "neetcode-150-010"
            assert practice_metadata["prerequisites"] == ["Arrays & Hashing"]
            assert practice_metadata["review_input"]["source_url"] == "https://leetcode.com/problems/valid-palindrome/"

            card = conn.execute(
                "SELECT id, due_at, interval_days, repetitions, ease_factor, tags_json, answer FROM cards WHERE id = ?",
                (neetcode._db_id("crd", "neetcode-150-010"),),
            ).fetchone()
            assert json.loads(card["tags_json"]) == [
                "neetcode-150",
                "pattern-two-pointers",
                "difficulty-easy",
                "coding-practice",
            ]
            assert card["interval_days"] == 1
            assert card["repetitions"] == 0
            assert card["ease_factor"] == 2.5
            assert "No solution text was imported." in card["answer"]

            first_due_at = card["due_at"]
            conn.execute(
                "UPDATE cards SET due_at = ?, interval_days = ?, repetitions = ?, ease_factor = ? WHERE id = ?",
                ("2030-01-01T00:00:00+00:00", 21, 4, 1.9, card["id"]),
            )
            conn.commit()

        third = neetcode.import_neetcode_source(source_path, adapter)
        assert third["adapter"]["cards"]["unchanged"] == 150

        with get_connection() as conn:
            preserved = conn.execute(
                "SELECT due_at, interval_days, repetitions, ease_factor FROM cards WHERE id = ?",
                (neetcode._db_id("crd", "neetcode-150-010"),),
            ).fetchone()
            assert preserved["due_at"] == "2030-01-01T00:00:00+00:00"
            assert preserved["interval_days"] == 21
            assert preserved["repetitions"] == 4
            assert preserved["ease_factor"] == 1.9
            assert first_due_at != preserved["due_at"]

            primary_topic = neetcode._topic_id(first["adapter"]["source_id"], "Two Pointers")
            prereq_topic = neetcode._topic_id(first["adapter"]["source_id"], "Arrays & Hashing")
            links = conn.execute(
                """
                SELECT topic_id, gate_required
                FROM card_topic_links
                WHERE card_id = ?
                ORDER BY gate_required ASC, topic_id ASC
                """,
                (neetcode._db_id("crd", "neetcode-150-010"),),
            ).fetchall()
            assert {row["topic_id"]: row["gate_required"] for row in links} == {
                primary_topic: 0,
                prereq_topic: 1,
            }
    finally:
        get_settings.cache_clear()


def test_validate_source_rejects_missing_user_notes_placeholder() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")
    broken = copy.deepcopy(source)
    del broken["items"][0]["notes"]

    with pytest.raises(ValueError, match="missing required fields: notes"):
        neetcode.validate_source(broken)
