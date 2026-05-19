#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_SEED_ID = "android-interview-functional-v1"
DEFAULT_TOPIC_TITLE = "Android Functional Interview Seed"
DEFAULT_DECK_NAME = "Interview Prep Functional Seed"
DEFAULT_CARD_PROMPT = "Explain the deterministic Starlog interview-prep review loop."
DEFAULT_CARD_ANSWER = (
    "A topic-read event unlocks linked interview-prep review cards; the Review surface can then "
    "load, reveal, and grade the due card."
)
PHONE_DUE_LIMIT = 20
PRIORITY_REVIEW_COUNT = 25
PRIORITY_REVIEW_RATING = 1
PRIORITY_REVIEW_LATENCY_MS = 1
PRIORITY_DUE_AT = "2000-01-01T00:00:00Z"


def _env(name: str, fallback: str | None = None) -> str:
    value = os.environ.get(name)
    if value is not None and value.strip():
        return value.strip()
    if fallback:
        return _env(fallback)
    return ""


def _redact(value: str) -> str:
    return "provided-redacted" if value else "unset"


@dataclass(frozen=True)
class SeedConfig:
    api_base: str
    access_token: str
    test_user: str
    seed_id: str
    topic_title: str
    deck_name: str
    card_prompt: str
    card_answer: str
    mark_read: bool
    dry_run: bool

    @property
    def seed_tag(self) -> str:
        return f"seed:{self.seed_id}"

    @property
    def normalized_api_base(self) -> str:
        return self.api_base.rstrip("/")


class StarlogApiClient:
    def __init__(self, config: SeedConfig):
        self.config = config

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        url = f"{self.config.normalized_api_base}{path}"
        body = None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.config.access_token}",
        }
        if payload is not None:
            body = json.dumps(payload, sort_keys=True).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            error_body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} failed with HTTP {error.code}: {error_body}") from error
        if not response_body:
            return None
        return json.loads(response_body)

    def get(self, path: str) -> Any:
        return self.request("GET", path)

    def post(self, path: str, payload: dict[str, Any] | None = None) -> Any:
        return self.request("POST", path, payload or {})

    def patch(self, path: str, payload: dict[str, Any]) -> Any:
        return self.request("PATCH", path, payload)


def _metadata(config: SeedConfig) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "seed_id": config.seed_id,
        "seed_purpose": "android_interview_functional_capture",
    }
    if config.test_user:
        metadata["test_user"] = config.test_user
    return metadata


def _planned_summary(config: SeedConfig, *, status: str, reason: str | None = None) -> dict[str, Any]:
    commands = [
        "GET /v1/study/sources?limit=500",
        "POST /v1/study/sources",
        "GET /v1/study/topics?source_id=<source_id>&limit=500",
        "POST /v1/study/topics",
        "GET /v1/cards/decks",
        "POST /v1/cards/decks",
        f"GET /v1/cards?tag={config.seed_tag}&limit=500",
        "POST /v1/cards or PATCH /v1/cards/<card_id>",
        "POST /v1/study/card-topic-links",
    ]
    if config.mark_read:
        commands.append("POST /v1/study/topics/<topic_id>/read")
    commands.append(f"GET /v1/cards/due?limit={PHONE_DUE_LIMIT}")
    return {
        "status": status,
        "reason": reason,
        "api_base": config.api_base or "unset",
        "access_token": _redact(config.access_token),
        "test_user": config.test_user or None,
        "seed_id": config.seed_id,
        "seed_tag": config.seed_tag,
        "topic_title": config.topic_title,
        "deck_name": config.deck_name,
        "mark_read": config.mark_read,
        "planned_requests": commands,
        "evidence": {
            "due_card_present": False,
            "phone_due_card_present": False,
            "phone_due_page_limit": PHONE_DUE_LIMIT,
            "phone_due_page_position": None,
            "seeded_via_api": False,
        },
    }


def _find_by_metadata(items: list[dict[str, Any]], *, seed_id: str) -> dict[str, Any] | None:
    for item in items:
        metadata = item.get("metadata")
        if isinstance(metadata, dict) and metadata.get("seed_id") == seed_id:
            return item
    return None


def _find_by_name(items: list[dict[str, Any]], *, name: str) -> dict[str, Any] | None:
    for item in items:
        if item.get("name") == name or item.get("title") == name:
            return item
    return None


def _find_seed_card(cards: list[dict[str, Any]], config: SeedConfig) -> dict[str, Any] | None:
    for card in cards:
        tags = card.get("tags")
        if isinstance(tags, list) and config.seed_tag in tags:
            return card
    return None


def _seed_tags(config: SeedConfig) -> list[str]:
    tags = ["interview_prep", "android_functional_seed", config.seed_tag]
    if config.test_user:
        tags.append(f"test_user:{config.test_user}")
    return tags


def _card_payload(config: SeedConfig, *, deck_id: str, due_at: str) -> dict[str, Any]:
    return {
        "prompt": config.card_prompt,
        "answer": config.card_answer,
        "deck_id": deck_id,
        "tags": _seed_tags(config),
        "due_at": due_at,
        "interval_days": 1,
        "repetitions": 0,
        "ease_factor": 2.5,
        "suspended": False,
    }


def _phone_page_position(due_cards: list[dict[str, Any]], card_id: str) -> int | None:
    for index, due_card in enumerate(due_cards, start=1):
        if str(due_card.get("id")) == card_id:
            return index
    return None


def seed_interview_prep_api(config: SeedConfig) -> dict[str, Any]:
    if config.dry_run:
        return _planned_summary(config, status="dry_run")
    if not config.api_base:
        return _planned_summary(config, status="skipped", reason="missing STARLOG_API_BASE")
    if not config.access_token:
        return _planned_summary(config, status="skipped", reason="missing STARLOG_ACCESS_TOKEN")

    client = StarlogApiClient(config)
    metadata = _metadata(config)

    sources = client.get("/v1/study/sources?limit=500")
    source = _find_by_metadata(sources, seed_id=config.seed_id)
    source_created = False
    if source is None:
        source = client.post(
            "/v1/study/sources",
            {
                "title": f"{config.topic_title} Source",
                "source_type": "interview_prep",
                "metadata": metadata,
            },
        )
        source_created = True

    source_id = str(source["id"])
    topics = client.get(f"/v1/study/topics?source_id={source_id}&limit=500")
    topic = _find_by_name(topics, name=config.topic_title)
    topic_created = False
    if topic is None:
        topic = client.post(
            "/v1/study/topics",
            {
                "source_id": source_id,
                "title": config.topic_title,
                "summary": "Deterministic Android harness topic for interview-prep review validation.",
                "display_order": 0,
            },
        )
        topic_created = True

    topic_id = str(topic["id"])
    decks = client.get("/v1/cards/decks")
    deck = _find_by_name(decks, name=config.deck_name)
    deck_created = False
    if deck is None:
        deck = client.post(
            "/v1/cards/decks",
            {
                "name": config.deck_name,
                "description": "Deterministic seed deck for native Android interview-prep functional capture.",
                "schedule": {
                    "new_cards_due_offset_hours": 0,
                    "initial_interval_days": 1,
                    "initial_ease_factor": 2.5,
                },
            },
        )
        deck_created = True

    deck_id = str(deck["id"])
    seed_tag_query = urllib.parse.quote(config.seed_tag, safe="")
    cards = client.get(f"/v1/cards?tag={seed_tag_query}&limit=500")
    card = _find_seed_card(cards, config)
    card_created = False
    if card is None:
        card = client.post(
            "/v1/cards",
            {
                "prompt": config.card_prompt,
                "answer": config.card_answer,
                "card_type": "qa",
                **_card_payload(config, deck_id=deck_id, due_at=PRIORITY_DUE_AT),
            },
        )
        card_created = True
    else:
        card = client.patch(
            f"/v1/cards/{card['id']}",
            _card_payload(config, deck_id=deck_id, due_at=PRIORITY_DUE_AT),
        )

    card_id = str(card["id"])
    link = client.post(
        "/v1/study/card-topic-links",
        {
            "card_id": card_id,
            "topic_id": topic_id,
            "gate_required": True,
        },
    )
    if config.mark_read:
        topic = client.post(f"/v1/study/topics/{topic_id}/read")

    priority_reviews_added = 0
    phone_due_cards = client.get(f"/v1/cards/due?limit={PHONE_DUE_LIMIT}")
    phone_position = _phone_page_position(phone_due_cards, card_id)
    if config.mark_read and phone_position is None:
        for _index in range(PRIORITY_REVIEW_COUNT):
            client.post(
                "/v1/reviews",
                {
                    "card_id": card_id,
                    "rating": PRIORITY_REVIEW_RATING,
                    "latency_ms": PRIORITY_REVIEW_LATENCY_MS,
                },
            )
            priority_reviews_added += 1
        card = client.patch(
            f"/v1/cards/{card_id}",
            _card_payload(config, deck_id=deck_id, due_at=PRIORITY_DUE_AT),
        )
        phone_due_cards = client.get(f"/v1/cards/due?limit={PHONE_DUE_LIMIT}")
        phone_position = _phone_page_position(phone_due_cards, card_id)

    phone_due_card_present = phone_position is not None
    return {
        "status": "seeded",
        "api_base": config.api_base,
        "access_token": _redact(config.access_token),
        "test_user": config.test_user or None,
        "seed_id": config.seed_id,
        "seed_tag": config.seed_tag,
        "topic": {
            "id": topic_id,
            "title": topic.get("title", config.topic_title),
            "status": topic.get("status"),
            "read_at": topic.get("read_at"),
            "created": topic_created,
        },
        "source": {
            "id": source_id,
            "created": source_created,
        },
        "deck": {
            "id": deck_id,
            "name": deck.get("name", config.deck_name),
            "created": deck_created,
        },
        "card": {
            "id": card_id,
            "prompt": card.get("prompt", config.card_prompt),
            "due_at": card.get("due_at", PRIORITY_DUE_AT),
            "created": card_created,
        },
        "link": {
            "id": link.get("id"),
            "gate_required": link.get("gate_required"),
        },
        "evidence": {
            "due_card_present": phone_due_card_present,
            "due_card_count": len(phone_due_cards),
            "phone_due_card_present": phone_due_card_present,
            "phone_due_page_limit": PHONE_DUE_LIMIT,
            "phone_due_page_position": phone_position,
            "priority_reviews_added": priority_reviews_added,
            "seeded_via_api": True,
        },
    }


def build_config(args: argparse.Namespace) -> SeedConfig:
    return SeedConfig(
        api_base=args.api_base or _env("STARLOG_API_BASE", "API_BASE"),
        access_token=args.access_token or _env("STARLOG_ACCESS_TOKEN", "STARLOG_TOKEN"),
        test_user=args.test_user or _env("STARLOG_TEST_USER"),
        seed_id=args.seed_id,
        topic_title=args.topic_title,
        deck_name=args.deck_name,
        card_prompt=args.card_prompt,
        card_answer=args.card_answer,
        mark_read=not args.no_mark_read,
        dry_run=args.dry_run,
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed one deterministic interview-prep due review card through the Starlog API."
    )
    parser.add_argument("--api-base", default="")
    parser.add_argument("--access-token", default="")
    parser.add_argument("--test-user", default="")
    parser.add_argument("--seed-id", default=DEFAULT_SEED_ID)
    parser.add_argument("--topic-title", default=DEFAULT_TOPIC_TITLE)
    parser.add_argument("--deck-name", default=DEFAULT_DECK_NAME)
    parser.add_argument("--card-prompt", default=DEFAULT_CARD_PROMPT)
    parser.add_argument("--card-answer", default=DEFAULT_CARD_ANSWER)
    parser.add_argument("--no-mark-read", action="store_true", help="Leave the seeded topic locked/read-unset.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned API requests without network access.")
    parser.add_argument("--summary-path", type=Path, default=None, help="Optional path to write the JSON summary.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    config = build_config(args)
    summary = seed_interview_prep_api(config)
    output = json.dumps(summary, sort_keys=True, separators=(",", ":"))
    if args.summary_path is not None:
        args.summary_path.parent.mkdir(parents=True, exist_ok=True)
        args.summary_path.write_text(output + "\n", encoding="utf-8")
    print(output)
    if (
        config.mark_read
        and summary.get("status") == "seeded"
        and not summary.get("evidence", {}).get("due_card_present")
    ):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
