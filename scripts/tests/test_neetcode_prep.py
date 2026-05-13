from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import import_neetcode_150 as neetcode


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


def test_validate_source_rejects_missing_user_notes_placeholder() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")
    broken = copy.deepcopy(source)
    del broken["items"][0]["notes"]

    with pytest.raises(ValueError, match="missing required fields: notes"):
        neetcode.validate_source(broken)
