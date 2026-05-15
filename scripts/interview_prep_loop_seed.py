#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import timedelta
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
API_DIR = ROOT_DIR / "services/api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))
SCRIPTS_DIR = ROOT_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import import_neetcode_150 as neetcode  # noqa: E402

DEFAULT_NEETCODE_SOURCE_PATH = ROOT_DIR / "data" / "neetcode_150.json"


def _problem_key_from_card_id(card_id: str) -> str | None:
    for axis in neetcode.REVIEW_CARD_AXES:
        suffix = f"_{axis['id']}"
        if card_id.endswith(suffix):
            return card_id[: -len(suffix)]
    return None


def _set_runtime_paths(*, db_path: Path, media_dir: Path) -> dict[str, str | None]:
    previous_db_path = os.environ.get("STARLOG_DB_PATH")
    previous_media_dir = os.environ.get("STARLOG_MEDIA_DIR")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)
    os.environ["STARLOG_DB_PATH"] = str(db_path)
    os.environ["STARLOG_MEDIA_DIR"] = str(media_dir)
    return {"STARLOG_DB_PATH": previous_db_path, "STARLOG_MEDIA_DIR": previous_media_dir}


def _restore_runtime_paths(previous: dict[str, str | None]) -> None:
    for key, value in previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def seed_interview_topic_gate_harness(
    *,
    db_path: Path,
    media_dir: Path,
    neetcode_source_path: Path = DEFAULT_NEETCODE_SOURCE_PATH,
    topic_title: str = "Sliding Window",
) -> dict[str, Any]:
    previous_env = _set_runtime_paths(db_path=db_path, media_dir=media_dir)

    from app.core.config import get_settings  # noqa: E402
    from app.core.time import utc_now  # noqa: E402
    from app.db.storage import get_connection  # noqa: E402
    from app.services import srs_service, study_service  # noqa: E402

    # Ensure app/settings resolve from the per-run database path.
    get_settings.cache_clear()

    try:
        neetcode_summary = neetcode.import_neetcode_source(
            neetcode_source_path,
            neetcode.StudyCoreLocalAdapter(),
        )

        with get_connection() as conn:
            topic_row = conn.execute(
                "SELECT id, source_id FROM study_topics WHERE title = ? LIMIT 1",
                (topic_title,),
            ).fetchone()
            if topic_row is None:
                raise RuntimeError(f"Topic '{topic_title}' missing after import")

            topic_id = str(topic_row["id"])
            source_id = str(topic_row["source_id"])
            card_rows = conn.execute(
                """
                SELECT c.id
                FROM cards c
                JOIN card_topic_links ctl ON ctl.card_id = c.id
                WHERE ctl.topic_id = ? AND ctl.gate_required = 1
                  AND ctl.id GLOB ?
                ORDER BY c.id
                """,
                (topic_id, f"*_primary_{neetcode._slug(topic_title)}"),
            ).fetchall()
            card_ids: list[str] = []
            problem_keys: list[str] = []
            seen_problem_keys: set[str] = set()
            for row in card_rows:
                card_id = str(row["id"])
                problem_key = _problem_key_from_card_id(card_id)
                if problem_key is None or problem_key in seen_problem_keys:
                    continue
                seen_problem_keys.add(problem_key)
                problem_keys.append(problem_key)
                card_ids.append(card_id)
                if len(card_ids) == 2:
                    break
            if len(card_ids) < 2:
                raise RuntimeError(f"Expected at least two gated cards linked to topic '{topic_title}'")
            primary_card_id = card_ids[0]

            def due_seed_card_ids() -> set[str]:
                placeholders = ",".join("?" for _ in card_ids)
                rows = conn.execute(
                    f"""
                    SELECT c.id
                    FROM cards c
                    WHERE c.id IN ({placeholders})
                      AND c.suspended = 0
                      AND c.due_at <= ?
                      AND {srs_service.available_card_condition("c")}
                    """,
                    (*card_ids, utc_now().isoformat()),
                ).fetchall()
                return {str(row["id"]) for row in rows}

            prerequisite_rows = conn.execute(
                """
                SELECT t.id, t.title
                FROM card_topic_links ctl
                JOIN study_topics t ON t.id = ctl.topic_id
                WHERE ctl.card_id = ?
                  AND ctl.gate_required = 1
                  AND ctl.topic_id != ?
                ORDER BY t.display_order
                """,
                (primary_card_id, topic_id),
            ).fetchall()
            prerequisite_topics = [
                {"id": str(row["id"]), "title": str(row["title"])}
                for row in prerequisite_rows
            ]
            for prerequisite in prerequisite_topics:
                study_service.mark_topic_read(conn, prerequisite["id"])

            due_card_payload = (utc_now() - timedelta(minutes=5)).isoformat()
            before_force_due_ids = due_seed_card_ids()
            pre_auth_status = {"card_in_due_queue": primary_card_id in before_force_due_ids}

            conn.executemany(
                "UPDATE cards SET due_at = ?, updated_at = ? WHERE id = ?",
                [(due_card_payload, due_card_payload, card_id) for card_id in card_ids],
            )
            conn.commit()
            pre_read_due_ids = due_seed_card_ids()
            pre_read_status = {"card_in_due_queue": primary_card_id in pre_read_due_ids}

            topic_read = study_service.mark_topic_read(conn, topic_id)
            post_read_due_ids = due_seed_card_ids()
            post_read_status = {
                "card_in_due_queue": primary_card_id in post_read_due_ids,
                "due_seed_card_count": len(set(card_ids) & post_read_due_ids),
            }

        return {
            "neetcode": neetcode_summary,
            "topic": {
                "id": topic_id,
                "source_id": source_id,
                "title": topic_title,
                "prerequisites_marked_read": prerequisite_topics,
            },
            "card_id": primary_card_id,
            "card_ids": card_ids,
            "problem_keys": problem_keys,
            "due": {
                "before_mark_read": pre_auth_status,
                "after_mark_read_before_request": pre_read_status,
                "after_mark_read": post_read_status,
            },
            "topic_read": {
                "status": topic_read["status"],
                "read_at": topic_read["read_at"],
            },
        }
    finally:
        _restore_runtime_paths(previous_env)
        get_settings.cache_clear()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed NeetCode data and verify topic-read gating for due cards.")
    parser.add_argument("--db-path", type=Path, default=Path("./starlog-neetcode-loop.db"))
    parser.add_argument("--media-dir", type=Path, default=Path("./media"))
    parser.add_argument("--neetcode-source", type=Path, default=DEFAULT_NEETCODE_SOURCE_PATH)
    parser.add_argument("--topic-title", default="Sliding Window")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    payload = seed_interview_topic_gate_harness(
        db_path=args.db_path,
        media_dir=args.media_dir,
        neetcode_source_path=args.neetcode_source,
        topic_title=args.topic_title,
    )
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
