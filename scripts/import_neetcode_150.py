#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_PATH = ROOT_DIR / "data/neetcode_150.json"

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
class StudyCoreReviewInputAdapter:
    """Thin adapter seam for WI-STUDY-CORE.

    This intentionally avoids importing backend schema code at module import time. Once
    study-core lands, expose either app.services.study_core_service.upsert_review_inputs
    or upsert_review_input and this script can apply the same stable payloads.
    """

    module_name: str = "app.services.study_core_service"

    def upsert_review_inputs(self, collection_id: str, review_inputs: list[dict[str, Any]]) -> dict[str, Any]:
        try:
            module = importlib.import_module(self.module_name)
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                f"Study-core adapter unavailable: could not import {self.module_name}. "
                "Run with --dry-run until WI-STUDY-CORE provides the review input API."
            ) from exc

        bulk_upsert = getattr(module, "upsert_review_inputs", None)
        if callable(bulk_upsert):
            return _coerce_adapter_summary(bulk_upsert(collection_id, review_inputs), len(review_inputs))

        single_upsert = getattr(module, "upsert_review_input", None)
        if callable(single_upsert):
            for review_input in review_inputs:
                single_upsert(collection_id, review_input)
            return {"adapter": self.module_name, "collection_id": collection_id, "upserted": len(review_inputs)}

        raise RuntimeError(
            f"Study-core adapter unavailable: {self.module_name} exposes neither "
            "upsert_review_inputs nor upsert_review_input."
        )


def _coerce_adapter_summary(raw: Any, count: int) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    return {"upserted": count, "result": raw}


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
        adapter = StudyCoreReviewInputAdapter()

    summary = import_neetcode_source(args.source, adapter)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
