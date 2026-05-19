from __future__ import annotations

from pathlib import Path
import os
import subprocess
import sys
from typing import Any
import urllib.parse

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import interview_prep_api_seed as seed  # noqa: E402


class FakeStarlogApiClient:
    def __init__(self, config: seed.SeedConfig):
        self.config = config
        self.sources: list[dict[str, Any]] = []
        self.topics: list[dict[str, Any]] = []
        self.decks: list[dict[str, Any]] = []
        self.cards: list[dict[str, Any]] = []
        self.links: list[dict[str, Any]] = []
        self.review_counts: dict[str, int] = {}
        self.patch_count = 0

    def get(self, path: str) -> Any:
        if path == "/v1/study/sources?limit=500":
            return self.sources
        if path.startswith("/v1/study/topics?"):
            source_id = path.split("source_id=", 1)[1].split("&", 1)[0]
            return [topic for topic in self.topics if topic["source_id"] == source_id]
        if path == "/v1/cards/decks":
            return self.decks
        if path.startswith("/v1/cards?tag="):
            tag = urllib.parse.unquote(path.split("tag=", 1)[1].split("&", 1)[0])
            return [card for card in self.cards if tag in card.get("tags", [])]
        if path.startswith("/v1/cards/due?limit="):
            limit = int(path.split("limit=", 1)[1])
            read_topic_ids = {topic["id"] for topic in self.topics if topic.get("read_at")}
            due: list[dict[str, Any]] = []
            for card in self.cards:
                linked_topic_ids = {link["topic_id"] for link in self.links if link["card_id"] == card["id"]}
                if card.get("suspended"):
                    continue
                if linked_topic_ids and not linked_topic_ids <= read_topic_ids:
                    continue
                due.append(card)
            return sorted(
                due,
                key=lambda card: (
                    -self.review_counts.get(str(card["id"]), 0) * 40,
                    str(card.get("due_at") or ""),
                    str(card["id"]),
                ),
            )[:limit]
        raise AssertionError(f"Unexpected GET {path}")

    def post(self, path: str, payload: dict[str, Any] | None = None) -> Any:
        payload = payload or {}
        if path == "/v1/study/sources":
            item = {
                "id": f"source-{len(self.sources) + 1}",
                "title": payload["title"],
                "source_type": payload["source_type"],
                "metadata": payload["metadata"],
            }
            self.sources.append(item)
            return item
        if path == "/v1/study/topics":
            item = {
                "id": f"topic-{len(self.topics) + 1}",
                "source_id": payload["source_id"],
                "title": payload["title"],
                "status": "locked",
                "read_at": None,
            }
            self.topics.append(item)
            return item
        if path == "/v1/cards/decks":
            item = {
                "id": f"deck-{len(self.decks) + 1}",
                "name": payload["name"],
            }
            self.decks.append(item)
            return item
        if path == "/v1/cards":
            item = {
                "id": f"card-{len(self.cards) + 1}",
                **payload,
            }
            self.cards.append(item)
            return item
        if path == "/v1/study/card-topic-links":
            for link in self.links:
                if link["card_id"] == payload["card_id"] and link["topic_id"] == payload["topic_id"]:
                    link["gate_required"] = payload["gate_required"]
                    return link
            item = {
                "id": f"link-{len(self.links) + 1}",
                "card_id": payload["card_id"],
                "topic_id": payload["topic_id"],
                "gate_required": payload["gate_required"],
            }
            self.links.append(item)
            return item
        if path.startswith("/v1/study/topics/") and path.endswith("/read"):
            topic_id = path.split("/")[4]
            for topic in self.topics:
                if topic["id"] == topic_id:
                    topic["status"] = "read"
                    topic["read_at"] = "2026-05-19T00:00:00Z"
                    return topic
        if path == "/v1/reviews":
            card_id = str(payload["card_id"])
            self.review_counts[card_id] = self.review_counts.get(card_id, 0) + 1
            return {
                "card_id": card_id,
                "next_due_at": "2026-05-20T00:00:00Z",
                "interval_days": 1,
                "repetitions": self.review_counts[card_id],
                "ease_factor": 2.5,
            }
        raise AssertionError(f"Unexpected POST {path}")

    def patch(self, path: str, payload: dict[str, Any]) -> Any:
        if path.startswith("/v1/cards/"):
            card_id = path.rsplit("/", 1)[1]
            self.patch_count += 1
            for card in self.cards:
                if card["id"] == card_id:
                    card.update(payload)
                    return card
        raise AssertionError(f"Unexpected PATCH {path}")


def test_build_config_uses_starlog_env_without_printing_token(monkeypatch) -> None:
    monkeypatch.setenv("STARLOG_API_BASE", "http://127.0.0.1:8000")
    monkeypatch.setenv("STARLOG_ACCESS_TOKEN", "secret-token")
    monkeypatch.setenv("STARLOG_TEST_USER", "phone-test")

    args = seed.parse_args([])
    config = seed.build_config(args)
    summary = seed.seed_interview_prep_api(seed.SeedConfig(**{**config.__dict__, "dry_run": True}))

    assert config.api_base == "http://127.0.0.1:8000"
    assert config.access_token == "secret-token"
    assert config.test_user == "phone-test"
    assert summary["access_token"] == "provided-redacted"
    assert "secret-token" not in str(summary)


def test_missing_credentials_skip_with_planned_requests() -> None:
    config = seed.SeedConfig(
        api_base="",
        access_token="",
        test_user="",
        seed_id="test-seed",
        topic_title="Seed Topic",
        deck_name="Seed Deck",
        card_prompt="Prompt",
        card_answer="Answer",
        mark_read=True,
        dry_run=False,
    )

    summary = seed.seed_interview_prep_api(config)

    assert summary["status"] == "skipped"
    assert summary["reason"] == "missing STARLOG_API_BASE"
    assert summary["planned_requests"]
    assert summary["evidence"]["seeded_via_api"] is False


def test_api_seed_is_idempotent_and_refreshes_due_card(monkeypatch) -> None:
    config = seed.SeedConfig(
        api_base="http://127.0.0.1:8000",
        access_token="token",
        test_user="phone-test",
        seed_id="test-seed",
        topic_title="Seed Topic",
        deck_name="Seed Deck",
        card_prompt="Prompt",
        card_answer="Answer",
        mark_read=True,
        dry_run=False,
    )
    fake = FakeStarlogApiClient(config)
    monkeypatch.setattr(seed, "StarlogApiClient", lambda _config: fake)

    first = seed.seed_interview_prep_api(config)
    second = seed.seed_interview_prep_api(config)

    assert first["status"] == "seeded"
    assert first["source"]["created"] is True
    assert first["topic"]["created"] is True
    assert first["deck"]["created"] is True
    assert first["card"]["created"] is True
    assert first["evidence"]["due_card_present"] is True
    assert second["source"]["created"] is False
    assert second["topic"]["created"] is False
    assert second["deck"]["created"] is False
    assert second["card"]["created"] is False
    assert second["evidence"]["due_card_present"] is True
    assert len(fake.sources) == 1
    assert len(fake.topics) == 1
    assert len(fake.decks) == 1
    assert len(fake.cards) == 1
    assert len(fake.links) == 1
    assert fake.patch_count == 1


def test_seed_verifies_seeded_card_in_phone_due_page_with_existing_due_cards(monkeypatch) -> None:
    config = seed.SeedConfig(
        api_base="http://127.0.0.1:8000",
        access_token="token",
        test_user="phone-test",
        seed_id="test-seed",
        topic_title="Seed Topic",
        deck_name="Seed Deck",
        card_prompt="Prompt",
        card_answer="Answer",
        mark_read=True,
        dry_run=False,
    )
    fake = FakeStarlogApiClient(config)
    fake.decks.append({"id": "deck-existing", "name": config.deck_name})
    for index in range(25):
        fake.cards.append(
            {
                "id": f"existing-{index:02d}",
                "prompt": f"Existing {index}",
                "answer": "Existing answer",
                "deck_id": "deck-existing",
                "tags": [],
                "due_at": "1999-01-01T00:00:00Z",
                "suspended": False,
            }
        )
    monkeypatch.setattr(seed, "StarlogApiClient", lambda _config: fake)

    summary = seed.seed_interview_prep_api(config)

    assert summary["status"] == "seeded"
    assert summary["evidence"]["phone_due_page_limit"] == 20
    assert summary["evidence"]["phone_due_card_present"] is True
    assert summary["evidence"]["phone_due_page_position"] == 1
    assert summary["evidence"]["priority_reviews_added"] == seed.PRIORITY_REVIEW_COUNT
    assert len(fake.get("/v1/cards/due?limit=20")) == 20
    assert fake.get("/v1/cards/due?limit=20")[0]["id"] == summary["card"]["id"]


def test_android_harness_no_device_does_not_call_seed_with_credentials(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_python = fake_bin / "python3"
    marker = tmp_path / "seed-invoked"
    fake_python.write_text(
        f"#!/usr/bin/env bash\nprintf invoked > {marker}\nexit 23\n",
        encoding="utf-8",
    )
    fake_python.chmod(0o755)
    run_dir = tmp_path / "run"
    env = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "RUN_DIR": str(run_dir),
        "STARLOG_API_BASE": "http://127.0.0.1:8000",
        "STARLOG_ACCESS_TOKEN": "secret-token",
    }

    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts/android_interview_functional_capture.sh"), "--no-device"],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()
    assert (run_dir / "run.env").exists()
    assert (run_dir / "manual-checkpoints.md").exists()
    assert not (run_dir / "api" / "interview-prep-seed.json").exists()
