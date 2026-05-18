from __future__ import annotations

import copy
import json
import re
import sys
from datetime import timedelta
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


CODEBLOCK_PATTERN = re.compile(r"`{3,}")
CODE_LINE_START_PATTERN = re.compile(
    r"(?m)^\s*(?:def|class|if|for|while|elif|else|try|except|with|return|raise|from|import)\b"
)


def _expected_practice_prompt(item: dict[str, Any]) -> str:
    return (
        f"Solve {item['title']} as a {item['difficulty']} {item['pattern']} practice problem. "
        "After attempting it, record approach, edge cases, complexity, mistakes, and next review notes."
    )


def _assert_no_solution_looking_text(value: str) -> None:
    assert value == value.strip()
    assert CODEBLOCK_PATTERN.search(value) is None
    assert CODE_LINE_START_PATTERN.search(value) is None


def test_checked_in_source_validates_against_neetcode_taxonomy() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")

    assert len(source["items"]) == 150
    assert [item["sequence"] for item in source["items"]] == list(range(1, 151))
    assert source["items"][0]["title"] == "Contains Duplicate"
    assert source["items"][-1]["title"] == "Reverse Integer"
    assert source["items"][0]["notes"] == ""


def test_neetcode_source_items_capture_user_annotation_fields() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")

    for item in source["items"]:
        assert isinstance(item["title"], str)
        assert item["title"].strip()
        assert item["url"].startswith("https://leetcode.com/problems/")
        assert item["difficulty"] in {"Easy", "Medium", "Hard"}
        assert isinstance(item["prerequisites"], list)
        assert isinstance(item["notes"], str)


def test_build_review_inputs_are_practice_oriented_and_solution_free() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")

    review_inputs = neetcode.build_review_inputs(source)

    assert len(review_inputs) == 150
    assert review_inputs[0]["source_url"] == "https://leetcode.com/problems/contains-duplicate/"
    for position, review_input in enumerate(review_inputs, start=1):
        assert review_input["external_id"] == f"neetcode-150-{position:03}"
        assert review_input["kind"] == "coding_problem_practice"
        assert review_input["provenance"]["contains_solution_text"] is False
        assert "solution" not in review_input
        assert review_input["practice_prompt"] == _expected_practice_prompt(review_input)
        assert "record approach, edge cases, complexity" in review_input["practice_prompt"]
        _assert_no_solution_looking_text(review_input["practice_prompt"])


def test_review_card_spec_is_practice_only() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")
    review_inputs = neetcode.build_review_inputs(source)

    assert len(review_inputs) == 150
    for review_input in review_inputs:
        specs = neetcode._review_card_specs(review_input)

        assert [spec["axis_id"] for spec in specs] == [
            "pattern_recognition",
            "edge_cases",
            "complexity",
            "implementation_traps",
        ]
        assert len({spec["card_id"] for spec in specs}) == 4
        for spec in specs:
            assert spec["prompt"].strip()
            assert spec["answer"].strip()
            assert review_input["source_url"] in spec["answer"]
            assert "This card contains no copied problem statement or solution text." in spec["answer"]
            _assert_no_solution_looking_text(spec["prompt"])
            _assert_no_solution_looking_text(spec["answer"])


def test_review_card_specs_cover_interview_prep_axes_without_solution_text() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")
    review_input = neetcode.build_review_inputs(source)[9]

    specs = neetcode._review_card_specs(review_input)

    assert [spec["axis_id"] for spec in specs] == [
        "pattern_recognition",
        "edge_cases",
        "complexity",
        "implementation_traps",
    ]
    assert len({spec["card_id"] for spec in specs}) == 4
    assert all("https://leetcode.com/problems/valid-palindrome/" in spec["answer"] for spec in specs)
    assert any("observable cues" in spec["prompt"] for spec in specs)
    assert any("boundary cases" in spec["prompt"] for spec in specs)
    assert any("time and space complexity" in spec["prompt"] for spec in specs)
    assert any("off-by-one risks" in spec["prompt"] for spec in specs)
    assert all("copied problem statement or solution text" in spec["answer"] for spec in specs)


def test_import_source_dry_run_reports_counts() -> None:
    summary = neetcode.import_neetcode_source(
        REPO_ROOT / "data/neetcode_150.json",
        neetcode.DryRunReviewInputAdapter(),
    )

    assert summary["problem_count"] == 150
    assert summary["review_input_count"] == 150
    assert summary["review_card_count"] == 600
    assert summary["review_card_axes"] == [
        "pattern_recognition",
        "edge_cases",
        "complexity",
        "implementation_traps",
    ]
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
        assert first["adapter"]["cards"]["created"] == 600
        assert first["adapter"]["cards"]["note_blocks_created"] == 600
        assert first["adapter"]["card_topic_links"]["primary_links"] == 600
        assert first["adapter"]["card_topic_links"]["prerequisite_links"] == 664

        assert second["adapter"]["source_id"] == first["adapter"]["source_id"]
        assert second["adapter"]["artifact_id"] == first["adapter"]["artifact_id"]
        assert second["adapter"]["card_set_version_id"] == first["adapter"]["card_set_version_id"]
        assert second["adapter"]["practice_items"]["created"] == 0
        assert second["adapter"]["practice_items"]["unchanged"] == 150
        assert second["adapter"]["cards"]["created"] == 0
        assert second["adapter"]["cards"]["unchanged"] == 600
        assert second["adapter"]["card_topic_links"]["created"] == 0
        assert second["adapter"]["card_topic_links"]["deleted"] == 0

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
                "note_blocks": 600,
                "cards": 600,
                "card_topic_links": 1264,
            }

            source = conn.execute("SELECT artifact_id, metadata_json FROM study_sources").fetchone()
            assert source["artifact_id"] == first["adapter"]["artifact_id"]
            source_metadata = json.loads(source["metadata_json"])
            assert source_metadata["import_key"] == "neetcode_150"
            assert source_metadata["problem_count"] == 150
            assert source_metadata["review_card_count"] == 600

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
                """
                SELECT id, due_at, interval_days, repetitions, ease_factor, tags_json, prompt, answer
                FROM cards
                WHERE id = ?
                """,
                (neetcode._db_id("crd", "neetcode-150-010", "implementation_traps"),),
            ).fetchone()
            assert json.loads(card["tags_json"]) == [
                "neetcode-150",
                "pattern-two-pointers",
                "difficulty-easy",
                "coding-practice",
                "implementation-traps",
            ]
            assert card["interval_days"] == 1
            assert card["repetitions"] == 0
            assert card["ease_factor"] == 2.5
            assert "implementation traps" in card["prompt"]
            assert "copied problem statement or solution text" in card["answer"]

            first_due_at = card["due_at"]
            primary_topic = neetcode._topic_id(first["adapter"]["source_id"], "Two Pointers")
            stale_topic = neetcode._topic_id(first["adapter"]["source_id"], "Stack")
            manual_topic = neetcode._topic_id(first["adapter"]["source_id"], "Binary Search")
            conn.execute(
                "UPDATE cards SET due_at = ?, interval_days = ?, repetitions = ?, ease_factor = ? WHERE id = ?",
                ("2030-01-01T00:00:00+00:00", 21, 4, 1.9, card["id"]),
            )
            conn.execute(
                """
                UPDATE card_topic_links
                SET id = ?
                WHERE card_id = ? AND topic_id = ?
                """,
                (
                    neetcode._db_id(
                        "card_topic",
                        "neetcode-150-010",
                        "implementation_traps",
                        "prerequisite",
                        "Two Pointers",
                    ),
                    card["id"],
                    primary_topic,
                ),
            )
            conn.execute(
                """
                INSERT INTO card_topic_links (id, card_id, topic_id, gate_required, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    neetcode._db_id(
                        "card_topic",
                        "neetcode-150-010",
                        "implementation_traps",
                        "prerequisite",
                        "Stack",
                    ),
                    card["id"],
                    stale_topic,
                    1,
                    "2026-04-01T00:00:00+00:00",
                ),
            )
            conn.execute(
                """
                INSERT INTO card_topic_links (id, card_id, topic_id, gate_required, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    "manual_card_topic_neetcode_150_010_binary_search",
                    card["id"],
                    manual_topic,
                    0,
                    "2026-04-01T00:00:00+00:00",
                ),
            )
            conn.commit()

        third = neetcode.import_neetcode_source(source_path, adapter)
        assert third["adapter"]["cards"]["unchanged"] == 600
        assert third["adapter"]["card_topic_links"]["updated"] == 1
        assert third["adapter"]["card_topic_links"]["deleted"] == 1

        with get_connection() as conn:
            preserved = conn.execute(
                "SELECT due_at, interval_days, repetitions, ease_factor FROM cards WHERE id = ?",
                (neetcode._db_id("crd", "neetcode-150-010", "implementation_traps"),),
            ).fetchone()
            assert preserved["due_at"] == "2030-01-01T00:00:00+00:00"
            assert preserved["interval_days"] == 21
            assert preserved["repetitions"] == 4
            assert preserved["ease_factor"] == 1.9
            assert first_due_at != preserved["due_at"]

            prereq_topic = neetcode._topic_id(first["adapter"]["source_id"], "Arrays & Hashing")
            links = conn.execute(
                """
                SELECT id, topic_id, gate_required
                FROM card_topic_links
                WHERE card_id = ?
                ORDER BY gate_required ASC, topic_id ASC
                """,
                (neetcode._db_id("crd", "neetcode-150-010", "implementation_traps"),),
            ).fetchall()
            assert {row["topic_id"]: row["gate_required"] for row in links} == {
                primary_topic: 1,
                prereq_topic: 1,
                manual_topic: 0,
            }
            remaining_stale = conn.execute(
                "SELECT id FROM card_topic_links WHERE card_id = ? AND topic_id = ?",
                (neetcode._db_id("crd", "neetcode-150-010", "implementation_traps"), stale_topic),
            ).fetchone()
            assert remaining_stale is None
            primary_link = conn.execute(
                "SELECT id FROM card_topic_links WHERE card_id = ? AND topic_id = ?",
                (neetcode._db_id("crd", "neetcode-150-010", "implementation_traps"), primary_topic),
            ).fetchone()
            assert primary_link["id"] == neetcode._db_id(
                "card_topic",
                "neetcode-150-010",
                "implementation_traps",
                "primary",
                "Two Pointers",
            )
    finally:
        get_settings.cache_clear()


def test_local_study_core_import_retires_legacy_generic_problem_card(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog.db"))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(tmp_path / "media"))

    from app.core.config import get_settings
    from app.core.time import utc_now
    from app.db.storage import get_connection
    from app.services import srs_service, study_service

    get_settings.cache_clear()
    try:
        source_path = REPO_ROOT / "data/neetcode_150.json"
        adapter = neetcode.StudyCoreLocalAdapter()
        first = neetcode.import_neetcode_source(source_path, adapter)

        legacy_external_id = "neetcode-150-001"
        legacy_card_id = neetcode._db_id("crd", legacy_external_id)
        legacy_note_block_id = neetcode._db_id("blk", legacy_external_id)
        due_at = (utc_now() - timedelta(minutes=5)).isoformat()
        with get_connection() as conn:
            topic = conn.execute(
                "SELECT id FROM study_topics WHERE title = ?",
                ("Arrays & Hashing",),
            ).fetchone()
            assert topic is not None
            study_service.mark_topic_read(conn, topic["id"])
            conn.execute(
                """
                INSERT INTO note_blocks (id, note_id, artifact_id, block_type, content, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    legacy_note_block_id,
                    first["adapter"]["note_id"],
                    first["adapter"]["artifact_id"],
                    "coding_problem_review_card",
                    "Legacy NeetCode generic card",
                    due_at,
                ),
            )
            conn.execute(
                """
                INSERT INTO cards (
                  id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type, prompt, answer,
                  tags_json, suspended, due_at, interval_days, repetitions, ease_factor, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    legacy_card_id,
                    first["adapter"]["card_set_version_id"],
                    first["adapter"]["artifact_id"],
                    legacy_note_block_id,
                    first["adapter"]["deck_id"],
                    "understanding",
                    "Legacy generic Contains Duplicate prompt",
                    "Legacy generic answer",
                    json.dumps(["neetcode-150", "coding-practice"]),
                    0,
                    due_at,
                    9,
                    3,
                    2.1,
                    due_at,
                    due_at,
                ),
            )
            conn.execute(
                """
                INSERT INTO card_topic_links (id, card_id, topic_id, gate_required, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    neetcode._db_id("card_topic", legacy_external_id, "primary", "Arrays & Hashing"),
                    legacy_card_id,
                    topic["id"],
                    1,
                    due_at,
                ),
            )
            conn.commit()

            due_before = {row["id"] for row in srs_service.due_cards(conn, 800)}
            assert legacy_card_id in due_before

        second = neetcode.import_neetcode_source(source_path, adapter)
        assert second["adapter"]["legacy_cards"]["cards_deleted"] == 1
        assert second["adapter"]["legacy_cards"]["links_deleted"] == 1
        assert second["adapter"]["legacy_cards"]["note_blocks_deleted"] == 1
        assert second["adapter"]["legacy_cards"]["state_migrated"] == 4

        with get_connection() as conn:
            due_after = {row["id"] for row in srs_service.due_cards(conn, 800)}
            assert legacy_card_id not in due_after
            assert conn.execute("SELECT id FROM cards WHERE id = ?", (legacy_card_id,)).fetchone() is None
            assert (
                conn.execute("SELECT id FROM card_topic_links WHERE card_id = ?", (legacy_card_id,)).fetchone()
                is None
            )
            assert conn.execute("SELECT id FROM note_blocks WHERE id = ?", (legacy_note_block_id,)).fetchone() is None

            migrated_axis_card = conn.execute(
                "SELECT due_at, interval_days, repetitions, ease_factor FROM cards WHERE id = ?",
                (neetcode._db_id("crd", legacy_external_id, "pattern_recognition"),),
            ).fetchone()
            assert migrated_axis_card["due_at"] == due_at
            assert migrated_axis_card["interval_days"] == 9
            assert migrated_axis_card["repetitions"] == 3
            assert migrated_axis_card["ease_factor"] == 2.1
    finally:
        get_settings.cache_clear()


def test_local_study_core_import_preserves_non_owned_deterministic_card_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog.db"))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(tmp_path / "media"))

    from app.core.config import get_settings
    from app.core.time import utc_now
    from app.db.storage import get_connection

    get_settings.cache_clear()
    try:
        source_path = REPO_ROOT / "data/neetcode_150.json"
        adapter = neetcode.StudyCoreLocalAdapter()
        first = neetcode.import_neetcode_source(source_path, adapter)

        external_id = "neetcode-150-002"
        card_id = neetcode._db_id("crd", external_id)
        link_id = neetcode._db_id("card_topic", external_id, "primary", "Arrays & Hashing")
        now = utc_now().isoformat()
        with get_connection() as conn:
            topic = conn.execute(
                "SELECT id FROM study_topics WHERE title = ?",
                ("Arrays & Hashing",),
            ).fetchone()
            assert topic is not None
            conn.execute(
                """
                INSERT INTO cards (
                  id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type, prompt, answer,
                  tags_json, suspended, due_at, interval_days, repetitions, ease_factor, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    card_id,
                    None,
                    None,
                    None,
                    first["adapter"]["deck_id"],
                    "understanding",
                    "Personal card that happens to use an old deterministic id",
                    "Personal answer",
                    json.dumps(["personal"]),
                    0,
                    now,
                    1,
                    0,
                    2.5,
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO card_topic_links (id, card_id, topic_id, gate_required, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (link_id, card_id, topic["id"], 1, now),
            )
            conn.commit()

        second = neetcode.import_neetcode_source(source_path, adapter)
        assert second["adapter"]["legacy_cards"]["cards_deleted"] == 0

        with get_connection() as conn:
            card = conn.execute("SELECT tags_json FROM cards WHERE id = ?", (card_id,)).fetchone()
            assert json.loads(card["tags_json"]) == ["personal"]
            link = conn.execute(
                "SELECT id FROM card_topic_links WHERE id = ? AND card_id = ?",
                (link_id, card_id),
            ).fetchone()
            assert link is not None
    finally:
        get_settings.cache_clear()


def test_local_study_core_sliding_window_read_releases_gated_due_card(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STARLOG_DB_PATH", str(tmp_path / "starlog.db"))
    monkeypatch.setenv("STARLOG_MEDIA_DIR", str(tmp_path / "media"))

    from app.core.config import get_settings
    from app.core.time import utc_now
    from app.db.storage import get_connection
    from app.services import srs_service, study_service

    get_settings.cache_clear()
    try:
        summary = neetcode.import_neetcode_source(
            REPO_ROOT / "data/neetcode_150.json",
            neetcode.StudyCoreLocalAdapter(),
        )

        with get_connection() as conn:
            sliding_window_topic = conn.execute(
                "SELECT id FROM study_topics WHERE title = ?",
                ("Sliding Window",),
            ).fetchone()
            assert sliding_window_topic is not None

            card = conn.execute(
                """
                SELECT c.id, c.answer
                FROM cards c
                JOIN card_topic_links ctl ON ctl.card_id = c.id
                WHERE ctl.topic_id = ? AND ctl.gate_required = 1
                ORDER BY c.id
                LIMIT 1
                """,
                (sliding_window_topic["id"],),
            ).fetchone()
            assert card is not None
            assert "copied problem statement or solution text" in card["answer"]

            linked_topics = conn.execute(
                """
                SELECT t.id, t.title
                FROM card_topic_links ctl
                JOIN study_topics t ON t.id = ctl.topic_id
                WHERE ctl.card_id = ? AND ctl.gate_required = 1
                ORDER BY t.display_order
                """,
                (card["id"],),
            ).fetchall()
            linked_topic_titles = [row["title"] for row in linked_topics]
            assert linked_topic_titles == ["Arrays & Hashing", "Two Pointers", "Sliding Window"]

            due_at = (utc_now() - timedelta(minutes=5)).isoformat()
            conn.execute("UPDATE cards SET due_at = ? WHERE id = ?", (due_at, card["id"]))
            conn.commit()

            for topic in linked_topics:
                if topic["title"] != "Sliding Window":
                    study_service.mark_topic_read(conn, topic["id"])

            due_before = {row["id"] for row in srs_service.due_cards(conn, 200)}
            assert card["id"] not in due_before

            unlocked_topic = study_service.unlock_topic(conn, sliding_window_topic["id"])
            assert unlocked_topic["status"] == "unlocked"
            assert unlocked_topic["manually_unlocked"] is True

            due_after_unlock = {row["id"] for row in srs_service.due_cards(conn, 200)}
            assert card["id"] not in due_after_unlock

            topic_read = study_service.mark_topic_read(conn, sliding_window_topic["id"])
            assert topic_read["status"] == "read"
            assert topic_read["read_at"] is not None

            due_after = {row["id"] for row in srs_service.due_cards(conn, 200)}
            assert card["id"] in due_after
            assert summary["adapter"]["card_topic_links"]["primary_links"] == 600
            assert summary["adapter"]["card_topic_links"]["prerequisite_links"] == 664
    finally:
        get_settings.cache_clear()


def test_validate_source_rejects_missing_user_notes_placeholder() -> None:
    source = neetcode.load_source(REPO_ROOT / "data/neetcode_150.json")
    broken = copy.deepcopy(source)
    del broken["items"][0]["notes"]

    with pytest.raises(ValueError, match="missing required fields: notes"):
        neetcode.validate_source(broken)
