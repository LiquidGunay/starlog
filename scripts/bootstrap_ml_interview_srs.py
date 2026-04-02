#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import timedelta
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
API_DIR = ROOT_DIR / "services/api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))


def load_cards(path: Path) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                record = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON on line {line_number}") from exc
            if not isinstance(record, dict):
                raise ValueError(f"Line {line_number} must be a JSON object")
            for key in ("prompt", "answer", "source_url", "section", "question_index", "question"):
                if not isinstance(record.get(key), str) or not record[key].strip():
                    raise ValueError(f"Line {line_number} missing required string field: {key}")
            cards.append(record)
    if not cards:
        raise ValueError("Deck file contained no cards")
    return cards


def import_cards(deck_path: Path, dry_run: bool) -> dict[str, Any]:
    cards = load_cards(deck_path)
    summary = {
        "deck_path": str(deck_path),
        "card_count": len(cards),
        "source_url": "https://huyenchip.com/ml-interviews-book/contents/part-ii.-questions.html",
    }
    if dry_run:
        return summary

    from app.core.time import utc_now  # noqa: E402
    from app.db.storage import get_connection, init_storage  # noqa: E402
    from app.services import artifacts_service  # noqa: E402
    from app.services.common import new_id  # noqa: E402

    init_storage()
    now = utc_now()
    now_iso = now.isoformat()
    with get_connection() as conn:
        artifact = artifacts_service.create_artifact(
            conn,
            source_type="srs_bootstrap",
            title="ML Interviews Book Part II (study draft)",
            raw_content=f"ML Interviews Book Part II questions\\nSource: {summary['source_url']}",
            normalized_content="Bootstrap SRS deck for Part II interview questions (study draft).",
            extracted_content=json.dumps(cards, indent=2, sort_keys=True),
            metadata={
                "bootstrap": True,
                "deck_path": str(deck_path),
                "source_url": summary["source_url"],
                "card_count": len(cards),
            },
        )
        card_set_version_id = new_id("csv")
        conn.execute(
            "INSERT INTO card_set_versions (id, artifact_id, version, created_at) VALUES (?, ?, ?, ?)",
            (card_set_version_id, artifact["id"], 1, now_iso),
        )
        for card in cards:
            conn.execute(
                """
                INSERT INTO cards (
                  id, card_set_version_id, artifact_id, note_block_id, card_type, prompt, answer,
                  due_at, interval_days, repetitions, ease_factor, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id("crd"),
                    card_set_version_id,
                    artifact["id"],
                    None,
                    str(card.get("card_type") or "qa"),
                    card["prompt"],
                    card["answer"],
                    now_iso,
                    1,
                    0,
                    2.5,
                    now_iso,
                ),
            )
        conn.execute(
            """
            INSERT INTO artifact_relations (
              id, artifact_id, relation_type, target_type, target_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("rel"),
                artifact["id"],
                "artifact.card_set_version",
                "card_set_version",
                card_set_version_id,
                now_iso,
            ),
        )
        conn.commit()
    summary["artifact_id"] = artifact["id"]
    summary["card_set_version_id"] = card_set_version_id
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Import the ML Interviews Part II SRS deck.")
    parser.add_argument(
        "--deck",
        type=Path,
        default=ROOT_DIR / "data/ml_interviews_part_ii_qa_cards.jsonl",
        help="Path to the JSONL deck file.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the deck without mutating the DB.",
    )
    args = parser.parse_args()

    summary = import_cards(args.deck, args.dry_run)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
