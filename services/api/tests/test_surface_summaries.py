import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.time import utc_now
from app.db.storage import get_connection
from app.services.common import new_id


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _bucket(payload: dict, group: str, key: str) -> int:
    return next(item["count"] for item in payload[group] if item["key"] == key)


def _open_loop(payload: dict, key: str) -> int:
    return next(item["count"] for item in payload["open_loops"] if item["key"] == key)


def _at_a_glance(payload: dict, key: str) -> int:
    return next(item["count"] for item in payload["at_a_glance"] if item["key"] == key)


def _quick_action(payload: dict, key: str) -> dict:
    return next(item for item in payload["quick_actions"] if item["key"] == key)


def _today_week_start() -> str:
    return utc_now().date().isoformat()


def _insight(payload: dict, key: str) -> dict:
    return next(item for item in payload["learning_insights"] if item["key"] == key)


def _seed_surface_summary_fixture(user_id: str) -> dict[str, str]:
    now = utc_now()
    today = now.date()
    start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    yesterday = start - timedelta(days=1)
    tomorrow = start + timedelta(days=1)

    ids = {
        "artifact_inbox": new_id("art"),
        "artifact_processed": new_id("art"),
        "summary": new_id("sum"),
        "note": new_id("not"),
        "note_block": new_id("nb"),
        "task_todo": new_id("tsk"),
        "task_overdue": new_id("tsk"),
        "task_done": new_id("tsk"),
        "task_cancelled_due": new_id("tsk"),
        "task_canceled_overdue": new_id("tsk"),
        "block_locked": new_id("blk"),
        "block_focus": new_id("blk"),
        "block_buffer": new_id("blk"),
        "calendar_event": new_id("evt"),
        "entity_conflict": new_id("conf"),
        "calendar_conflict": new_id("gconf"),
        "deck": new_id("cdk"),
        "card_due_recall": new_id("crd"),
        "card_due_application": new_id("crd"),
        "card_future_synthesis": new_id("crd"),
        "card_suspended": new_id("crd"),
        "review_event": new_id("rev"),
        "thread": new_id("thr"),
        "run": new_id("run"),
        "interrupt": new_id("int"),
        "surface_event": new_id("sevt"),
        "commitment": new_id("com"),
        "commitment_dropped": new_id("com"),
        "commitment_archived": new_id("com"),
    }

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO artifacts (id, source_type, title, raw_content, normalized_content, extracted_content, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ids["artifact_inbox"],
                "clip_browser",
                "Inbox clip",
                "raw",
                "normalized",
                None,
                "{}",
                _iso(yesterday),
                _iso(yesterday),
            ),
        )
        conn.execute(
            """
            INSERT INTO artifacts (id, source_type, title, raw_content, normalized_content, extracted_content, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ids["artifact_processed"],
                "pdf",
                "Processed source",
                "raw",
                "normalized",
                None,
                "{}",
                _iso(now),
                _iso(now),
            ),
        )
        conn.execute(
            """
            INSERT INTO summary_versions (id, artifact_id, version, content, provider, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (ids["summary"], ids["artifact_processed"], 1, "Summary", "test", _iso(now)),
        )
        conn.execute(
            """
            INSERT INTO notes (id, title, body_md, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (ids["note"], "Processed note", "Body", 1, _iso(now), _iso(now)),
        )
        conn.execute(
            """
            INSERT INTO note_blocks (id, note_id, artifact_id, block_type, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (ids["note_block"], ids["note"], ids["artifact_processed"], "paragraph", "Body", _iso(now)),
        )

        for task_id, title, status, due_at, artifact_id in [
            (ids["task_todo"], "Due today", "todo", start + timedelta(hours=12), ids["artifact_processed"]),
            (ids["task_overdue"], "Overdue", "in_progress", yesterday, None),
            (ids["task_done"], "Done", "done", start + timedelta(hours=8), None),
            (ids["task_cancelled_due"], "Cancelled due today", "cancelled", start + timedelta(hours=12), None),
            (ids["task_canceled_overdue"], "Canceled overdue", "canceled", yesterday, None),
        ]:
            conn.execute(
                """
                INSERT INTO tasks (id, title, status, estimate_min, priority, due_at, linked_note_id, source_artifact_id, revision, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    title,
                    status,
                    30,
                    2,
                    _iso(due_at),
                    None,
                    artifact_id,
                    1,
                    _iso(now),
                    _iso(now),
                ),
            )

        for block_id, task_id, title, starts_at, ends_at, locked in [
            (
                ids["block_locked"],
                None,
                "Doctor",
                start + timedelta(hours=9),
                start + timedelta(hours=10),
                1,
            ),
            (
                ids["block_focus"],
                ids["task_todo"],
                "Focus: Due today",
                start + timedelta(hours=10),
                start + timedelta(hours=11),
                0,
            ),
            (
                ids["block_buffer"],
                None,
                "Buffer",
                start + timedelta(hours=11),
                start + timedelta(hours=11, minutes=30),
                0,
            ),
        ]:
            conn.execute(
                """
                INSERT INTO time_blocks (id, task_id, title, starts_at, ends_at, locked, revision, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (block_id, task_id, title, _iso(starts_at), _iso(ends_at), locked, 1, _iso(now)),
            )

        conn.execute(
            """
            INSERT INTO calendar_events (id, title, starts_at, ends_at, source, remote_id, etag, deleted, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ids["calendar_event"],
                "Calendar event",
                _iso(start + timedelta(hours=13)),
                _iso(start + timedelta(hours=14)),
                "local",
                None,
                None,
                0,
                1,
                _iso(now),
                _iso(now),
            ),
        )
        conn.execute(
            """
            INSERT INTO entity_conflicts (id, entity_type, entity_id, operation, base_revision, current_revision, local_payload_json, server_payload_json, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ids["entity_conflict"],
                "task",
                ids["task_todo"],
                "update",
                1,
                2,
                "{}",
                "{}",
                "open",
                _iso(now),
            ),
        )
        conn.execute(
            """
            INSERT INTO calendar_sync_conflicts (id, local_event_id, remote_id, strategy, detail_json, resolved, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (ids["calendar_conflict"], ids["calendar_event"], "remote-1", "manual", "{}", 0, _iso(now)),
        )

        conn.execute(
            """
            INSERT INTO card_decks (id, name, description, schedule_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                ids["deck"],
                "Concepts",
                None,
                json.dumps({"new_cards_due_offset_hours": 0, "initial_interval_days": 1, "initial_ease_factor": 2.5}),
                _iso(now),
                _iso(now),
            ),
        )
        for card_id, card_type, due_at, repetitions, suspended, artifact_id in [
            (ids["card_due_recall"], "qa", yesterday, 1, 0, ids["artifact_processed"]),
            (ids["card_due_application"], "scenario", now - timedelta(minutes=1), 0, 0, None),
            (ids["card_future_synthesis"], "connect", tomorrow, 2, 0, None),
            (ids["card_suspended"], "qa", yesterday, 1, 1, None),
        ]:
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
                    artifact_id,
                    None,
                    ids["deck"],
                    card_type,
                    f"Prompt {card_type}",
                    "Answer",
                    "[]",
                    suspended,
                    _iso(due_at),
                    1,
                    repetitions,
                    2.5,
                    _iso(now),
                    _iso(now),
                ),
            )
        conn.execute(
            "INSERT INTO review_events (id, card_id, rating, latency_ms, reviewed_at) VALUES (?, ?, ?, ?, ?)",
            (ids["review_event"], ids["card_due_recall"], 4, 1200, _iso(now)),
        )

        conn.execute(
            """
            INSERT INTO conversation_threads (id, owner_user_id, slug, title, mode, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (ids["thread"], user_id, "primary", "Assistant thread", "assistant", _iso(now), _iso(now)),
        )
        conn.execute(
            """
            INSERT INTO conversation_runs (id, thread_id, origin_message_id, orchestrator, status, summary, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (ids["run"], ids["thread"], None, "test", "running", None, "{}", _iso(now), _iso(now)),
        )
        conn.execute(
            """
            INSERT INTO conversation_interrupts (
              id, run_id, thread_id, status, interrupt_type, tool_name, title, body, entity_ref_json,
              fields_json, primary_label, secondary_label, metadata_json, resolution_json, created_at, resolved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ids["interrupt"],
                ids["run"],
                ids["thread"],
                "open",
                "confirmation",
                "task.create",
                "Confirm task",
                None,
                None,
                "[]",
                "Create",
                None,
                "{}",
                "{}",
                _iso(now),
                None,
            ),
        )
        conn.execute(
            """
            INSERT INTO conversation_surface_events (id, thread_id, source_surface, kind, entity_ref_json, payload_json, visibility, projected_message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ids["surface_event"],
                ids["thread"],
                "library",
                "artifact.created",
                None,
                "{}",
                "ambient",
                0,
                _iso(now),
            ),
        )
        for commitment_id, title, status in [
            (ids["commitment"], "Open commitment", "open"),
            (ids["commitment_dropped"], "Dropped commitment", "dropped"),
            (ids["commitment_archived"], "Archived commitment", "archived"),
        ]:
            conn.execute(
                """
                INSERT INTO commitments (id, source_type, source_id, title, promised_to, due_at, status, recovery_plan, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    commitment_id,
                    "assistant",
                    None,
                    title,
                    None,
                    None,
                    status,
                    None,
                    _iso(now),
                    _iso(now),
                ),
            )
        conn.commit()

    ids["date"] = today.isoformat()
    return ids


def _demote_pending_interrupts(conn) -> None:
    conn.execute("UPDATE conversation_interrupts SET status = 'resolved', resolved_at = ? WHERE status IN ('open', 'pending')", (_iso(utc_now()),))


def _demote_overdue_task(conn, seeded: dict[str, str]) -> None:
    tomorrow = utc_now() + timedelta(days=1)
    conn.execute("UPDATE tasks SET due_at = ?, updated_at = ? WHERE id = ?", (_iso(tomorrow), _iso(utc_now()), seeded["task_overdue"]))


def _mark_library_inbox_processed(conn, seeded: dict[str, str]) -> None:
    conn.execute(
        """
        INSERT INTO summary_versions (id, artifact_id, version, content, provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (new_id("sum"), seeded["artifact_inbox"], 1, "Summary", "test", _iso(utc_now())),
    )


def _defer_due_reviews(conn) -> None:
    later = utc_now() + timedelta(days=2)
    conn.execute("UPDATE cards SET due_at = ?, updated_at = ? WHERE suspended = 0", (_iso(later), _iso(utc_now())))


def _insert_review_card(
    conn,
    *,
    card_type: str = "qa",
    due_at: datetime | None = None,
    prompt: str | None = None,
) -> str:
    now = utc_now()
    card_id = new_id("crd")
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
            None,
            card_type,
            prompt or f"Prompt {card_type}",
            "Answer",
            "[]",
            0,
            _iso(due_at or now),
            1,
            0,
            2.5,
            _iso(now),
            _iso(now),
        ),
    )
    return card_id


def _insert_review_event(
    conn,
    *,
    card_id: str,
    rating: int,
    reviewed_at: datetime | None = None,
) -> str:
    event_id = new_id("rev")
    conn.execute(
        "INSERT INTO review_events (id, card_id, rating, latency_ms, reviewed_at) VALUES (?, ?, ?, ?, ?)",
        (event_id, card_id, rating, 900, _iso(reviewed_at or utc_now())),
    )
    return event_id


def _insert_active_goal(conn, *, title: str = "Keep strategy visible", reviewed_days_ago: int = 0) -> str:
    now = utc_now()
    reviewed_at = now - timedelta(days=reviewed_days_ago)
    goal_id = new_id("goal")
    conn.execute(
        """
        INSERT INTO goals (
          id, title, horizon, why, success_criteria, status, review_cadence,
          created_at, updated_at, last_reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            goal_id,
            title,
            "quarter",
            None,
            "Visible progress",
            "active",
            "weekly",
            _iso(reviewed_at),
            _iso(reviewed_at),
            _iso(reviewed_at),
        ),
    )
    return goal_id


def _insert_active_project(
    conn,
    *,
    goal_id: str | None = None,
    title: str = "Assistant strategic context",
    next_action_id: str | None = None,
    reviewed_days_ago: int = 0,
) -> str:
    now = utc_now()
    reviewed_at = now - timedelta(days=reviewed_days_ago)
    project_id = new_id("proj")
    conn.execute(
        """
        INSERT INTO projects (
          id, goal_id, title, desired_outcome, current_state, next_action_id,
          open_questions_json, risks_json, status, created_at, updated_at, last_reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            project_id,
            goal_id,
            title,
            "Assistant Today can see grounded strategic context.",
            "Wiring read model",
            next_action_id,
            "[]",
            "[]",
            "active",
            _iso(reviewed_at),
            _iso(reviewed_at),
            _iso(reviewed_at),
        ),
    )
    return project_id


def test_surface_summary_endpoints_expose_representative_counts(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users LIMIT 1").fetchone()["id"])
    seeded = _seed_surface_summary_fixture(user_id)

    library = client.get("/v1/surfaces/library/summary", headers=auth_headers)
    assert library.status_code == 200
    library_payload = library.json()
    assert _bucket(library_payload, "status_buckets", "total_artifacts") == 2
    assert _bucket(library_payload, "status_buckets", "unprocessed_artifacts") == 1
    assert _bucket(library_payload, "source_breakdown", "clip_browser") == 1
    assert library_payload["notes"]["total"] == 1
    assert {item["action"]: item["count"] for item in library_payload["suggested_actions"]} == {
        "summarize": 1,
        "cards": 1,
        "tasks": 1,
        "append_note": 1,
    }
    assert library_payload["recent_artifacts"][0]["id"] == seeded["artifact_processed"]

    planner = client.get(f"/v1/surfaces/planner/summary?date={seeded['date']}", headers=auth_headers)
    assert planner.status_code == 200
    planner_payload = planner.json()
    assert _bucket(planner_payload, "task_buckets", "open_tasks") == 2
    assert _bucket(planner_payload, "task_buckets", "due_today_tasks") == 1
    assert _bucket(planner_payload, "task_buckets", "overdue_tasks") == 1
    assert _bucket(planner_payload, "block_buckets", "fixed_blocks") == 2
    assert _bucket(planner_payload, "block_buckets", "flexible_blocks") == 2
    assert _bucket(planner_payload, "block_buckets", "focus_blocks") == 1
    assert _bucket(planner_payload, "block_buckets", "buffer_blocks") == 1
    assert planner_payload["calendar_event_count"] == 1
    assert planner_payload["conflict_count"] == 2
    assert planner_payload["focus_minutes"] == 60
    assert planner_payload["buffer_minutes"] == 30

    review = client.get("/v1/surfaces/review/summary", headers=auth_headers)
    assert review.status_code == 200
    review_payload = review.json()
    assert _bucket(review_payload, "ladder_counts", "recall") == 1
    assert _bucket(review_payload, "ladder_counts", "application") == 1
    assert _bucket(review_payload, "total_ladder_counts", "synthesis") == 1
    assert _bucket(review_payload, "deck_buckets", "Concepts") == 3
    assert review_payload["queue_health"]["due_count"] == 2
    assert review_payload["queue_health"]["overdue_count"] == 1
    assert review_payload["queue_health"]["suspended_count"] == 1
    assert review_payload["queue_health"]["reviewed_today_count"] == 1
    assert review_payload["queue_health"]["average_latency_ms"] == 1200


def test_review_summary_recommends_application_drill_for_repeated_low_ratings(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    now = utc_now()
    with get_connection() as conn:
        first = _insert_review_card(conn, card_type="scenario", due_at=now + timedelta(days=3))
        second = _insert_review_card(conn, card_type="scenario", due_at=now + timedelta(days=3))
        _insert_review_event(conn, card_id=first, rating=1, reviewed_at=now - timedelta(days=1))
        _insert_review_event(conn, card_id=second, rating=2, reviewed_at=now - timedelta(hours=2))
        conn.commit()

    response = client.get("/v1/surfaces/review/summary", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["recommended_drill"] == {
        "mode": "application",
        "title": "Application drill",
        "body": "Practice cards with 2 recent low ratings before returning to the full queue.",
        "prompt": "Start an application drill from cards I recently rated low.",
        "reason": "2 recent low ratings on application cards.",
        "enabled": True,
    }
    insight = _insight(payload, "recent_low_rating_application")
    assert insight["mode"] == "application"
    assert insight["ladder_stage"] == "application"
    assert insight["count"] == 2
    assert insight["severity"] == "medium"


def test_review_summary_recommends_synthesis_drill_for_repeated_low_ratings(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    now = utc_now()
    with get_connection() as conn:
        first = _insert_review_card(conn, card_type="connect", due_at=now + timedelta(days=3))
        second = _insert_review_card(conn, card_type="compare", due_at=now + timedelta(days=3))
        _insert_review_event(conn, card_id=first, rating=2, reviewed_at=now - timedelta(days=1))
        _insert_review_event(conn, card_id=second, rating=1, reviewed_at=now - timedelta(hours=2))
        conn.commit()

    response = client.get("/v1/surfaces/review/summary", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["recommended_drill"] == {
        "mode": "synthesis",
        "title": "Synthesis drill",
        "body": "Practice cards with 2 recent low ratings before returning to the full queue.",
        "prompt": "Start a synthesis drill from cards I recently rated low.",
        "reason": "2 recent low ratings on synthesis cards.",
        "enabled": True,
    }
    insight = _insight(payload, "recent_low_rating_synthesis")
    assert insight["mode"] == "synthesis"
    assert insight["ladder_stage"] == "synthesis"
    assert insight["count"] == 2
    assert insight["severity"] == "medium"


def test_review_summary_surfaces_due_higher_ladder_cards_as_deeper_review_insight(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    now = utc_now()
    with get_connection() as conn:
        _insert_review_card(conn, card_type="scenario", due_at=now - timedelta(minutes=5))
        _insert_review_card(conn, card_type="connect", due_at=now - timedelta(minutes=5))
        _insert_review_card(conn, card_type="tradeoff", due_at=now - timedelta(minutes=5))
        conn.commit()

    response = client.get("/v1/surfaces/review/summary", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert _bucket(payload, "ladder_counts", "application") == 1
    assert _bucket(payload, "ladder_counts", "synthesis") == 1
    assert _bucket(payload, "ladder_counts", "judgment") == 1
    insight = _insight(payload, "deeper_review_due")
    assert insight["count"] == 3
    assert insight["mode"] == "application"
    assert insight["ladder_stage"] == "application"
    assert insight["severity"] == "medium"
    assert "application, synthesis, judgment" in insight["body"]
    assert payload["recommended_drill"] == {
        "mode": "application",
        "title": "Short application pass",
        "body": "Start with 3 due cards and calibrate from fresh ratings.",
        "prompt": "Start a short application pass for my due cards.",
        "reason": "3 cards due, led by application cards, and no review events in the last 14 days.",
        "enabled": True,
    }


def test_review_summary_is_neutral_when_no_learning_data_exists(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.get("/v1/surfaces/review/summary", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["queue_health"]["due_count"] == 0
    assert payload["learning_insights"] == []
    assert payload["recommended_drill"] == {
        "mode": "recall",
        "title": "No drill recommended",
        "body": "No due cards or repeated low-rating patterns are visible right now.",
        "prompt": None,
        "reason": "No due cards or recent low ratings found.",
        "enabled": False,
    }


def test_assistant_today_summary_is_read_only_and_composes_open_loops(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users LIMIT 1").fetchone()["id"])
    seeded = _seed_surface_summary_fixture(user_id)

    with get_connection() as conn:
        before_threads = conn.execute("SELECT COUNT(*) FROM conversation_threads").fetchone()[0]
        before_state = conn.execute("SELECT COUNT(*) FROM conversation_session_state").fetchone()[0]
        before_interrupts = conn.execute("SELECT COUNT(*) FROM conversation_interrupts").fetchone()[0]

    response = client.get(f"/v1/surfaces/assistant/today?date={seeded['date']}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["thread_id"] == seeded["thread"]
    assert payload["active_run_count"] == 1
    assert payload["open_interrupt_count"] == 1
    assert payload["recent_surface_event_count"] == 1
    assert _open_loop(payload, "open_tasks") == 2
    assert _open_loop(payload, "overdue_tasks") == 1
    assert _open_loop(payload, "due_reviews") == 2
    assert _open_loop(payload, "unprocessed_library") == 1
    assert _open_loop(payload, "open_commitments") == 1
    assert [item["key"] for item in payload["open_loops"]] == [
        "open_tasks",
        "overdue_tasks",
        "due_reviews",
        "unprocessed_library",
        "open_commitments",
    ]
    assert payload["strategic_context"]["open_commitment_count"] == 1
    assert payload["recommended_next_move"] == {
        "key": "resolve_interrupt",
        "title": "Resolve pending assistant decision",
        "body": "1 assistant decision waiting before the current run can continue.",
        "surface": "assistant",
        "href": "/assistant",
        "action_label": "Review decision",
        "prompt": "Show my pending assistant decisions.",
        "priority": 100,
        "urgency": "high",
    }
    assert payload["reason_stack"] == [
        "1 assistant decision pending",
        "1 task overdue",
        "1 library capture unprocessed",
        "2 review cards due",
    ]
    assert _at_a_glance(payload, "planner") == 2
    assert _at_a_glance(payload, "library") == 1
    assert _at_a_glance(payload, "review") == 2
    assert _at_a_glance(payload, "commitments") == 1
    assert [item["key"] for item in payload["quick_actions"]] == [
        "plan_today",
        "process_captures",
        "start_review",
        "create_task",
    ]
    assert all(item["href"] or item["prompt"] for item in payload["quick_actions"])
    process_captures = _quick_action(payload, "process_captures")
    assert process_captures["enabled"] is True
    assert process_captures["count"] == 1
    assert process_captures["reason"] is None
    assert process_captures["prompt"] == "Help me process 1 unprocessed capture."
    start_review = _quick_action(payload, "start_review")
    assert start_review["enabled"] is True
    assert start_review["count"] == 2
    assert start_review["reason"] is None
    assert start_review["prompt"] == "Start my 2 due review cards."

    with get_connection() as conn:
        after_threads = conn.execute("SELECT COUNT(*) FROM conversation_threads").fetchone()[0]
        after_state = conn.execute("SELECT COUNT(*) FROM conversation_session_state").fetchone()[0]
        after_interrupts = conn.execute("SELECT COUNT(*) FROM conversation_interrupts").fetchone()[0]

    assert after_threads == before_threads
    assert after_state == before_state
    assert after_interrupts == before_interrupts


def test_assistant_today_summary_defaults_to_plan_today_without_open_loops(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.get("/v1/surfaces/assistant/today", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()

    assert payload["thread_id"] is None
    assert payload["active_run_count"] == 0
    assert payload["open_interrupt_count"] == 0
    assert payload["recent_surface_event_count"] == 0
    assert {item["key"]: item["count"] for item in payload["open_loops"]} == {
        "open_tasks": 0,
        "overdue_tasks": 0,
        "due_reviews": 0,
        "unprocessed_library": 0,
        "open_commitments": 0,
    }
    assert payload["recommended_next_move"]["key"] == "plan_today"
    assert payload["recommended_next_move"]["priority"] == 10
    assert payload["recommended_next_move"]["urgency"] == "low"
    assert payload["recommended_next_move"]["prompt"] == "Help me plan today."
    assert payload["strategic_context"] == {
        "active_goal_count": 0,
        "active_project_count": 0,
        "open_commitment_count": 0,
        "overdue_commitment_count": 0,
        "project_missing_next_action_count": 0,
        "attention_count": 0,
        "active_goals": [],
        "active_projects": [],
        "open_commitments": [],
        "attention_items": [],
    }
    assert payload["reason_stack"] == [
        "No pending interrupts, overdue tasks, unprocessed captures, or due reviews are visible."
    ]
    assert {item["key"]: item["count"] for item in payload["at_a_glance"]} == {
        "planner": 0,
        "library": 0,
        "review": 0,
        "commitments": 0,
    }
    process_captures = _quick_action(payload, "process_captures")
    assert process_captures["enabled"] is False
    assert process_captures["count"] == 0
    assert process_captures["prompt"] is None
    assert process_captures["reason"] == "No unprocessed captures."
    start_review = _quick_action(payload, "start_review")
    assert start_review["enabled"] is False
    assert start_review["count"] == 0
    assert start_review["prompt"] is None
    assert start_review["reason"] == "No review cards due."
    assert _quick_action(payload, "plan_today")["enabled"] is True
    assert _quick_action(payload, "create_task")["enabled"] is True


@pytest.mark.parametrize(
    ("scenario", "expected_key"),
    [
        ("pending_interrupt", "resolve_interrupt"),
        ("overdue_task", "clear_overdue_tasks"),
        ("unprocessed_library", "process_library_inbox"),
        ("due_review", "start_due_review"),
        ("open_loops", "plan_open_loops"),
    ],
)
def test_assistant_today_recommended_next_move_priority_order(
    client: TestClient,
    auth_headers: dict[str, str],
    scenario: str,
    expected_key: str,
) -> None:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users LIMIT 1").fetchone()["id"])
    seeded = _seed_surface_summary_fixture(user_id)

    with get_connection() as conn:
        if scenario != "pending_interrupt":
            _demote_pending_interrupts(conn)
        if scenario in {"unprocessed_library", "due_review"}:
            _demote_overdue_task(conn, seeded)
        if scenario in {"due_review", "open_loops"}:
            _mark_library_inbox_processed(conn, seeded)
        if scenario == "open_loops":
            _demote_overdue_task(conn, seeded)
            _defer_due_reviews(conn)
        conn.commit()

    response = client.get(f"/v1/surfaces/assistant/today?date={seeded['date']}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["recommended_next_move"]["key"] == expected_key


def test_assistant_today_summary_includes_strategic_context_shape(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users LIMIT 1").fetchone()["id"])
    seeded = _seed_surface_summary_fixture(user_id)

    with get_connection() as conn:
        goal_id = _insert_active_goal(conn)
        project_id = _insert_active_project(conn, goal_id=goal_id)
        conn.commit()

    response = client.get(f"/v1/surfaces/assistant/today?date={seeded['date']}", headers=auth_headers)

    assert response.status_code == 200
    strategic_context = response.json()["strategic_context"]
    assert strategic_context["active_goal_count"] == 1
    assert strategic_context["active_project_count"] == 1
    assert strategic_context["open_commitment_count"] == 1
    assert strategic_context["overdue_commitment_count"] == 0
    assert strategic_context["project_missing_next_action_count"] == 1
    assert strategic_context["attention_count"] == 1
    assert strategic_context["active_goals"][0]["id"] == goal_id
    assert strategic_context["active_projects"][0]["id"] == project_id
    assert strategic_context["active_projects"][0]["next_action_id"] is None
    assert strategic_context["open_commitments"][0]["id"] == seeded["commitment"]
    assert strategic_context["attention_items"][0]["kind"] == "project_missing_next_action"
    assert strategic_context["attention_items"][0]["entity_id"] == project_id


def test_assistant_today_recommends_project_without_next_action_before_open_loops(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users LIMIT 1").fetchone()["id"])
    seeded = _seed_surface_summary_fixture(user_id)

    with get_connection() as conn:
        _demote_pending_interrupts(conn)
        _demote_overdue_task(conn, seeded)
        _mark_library_inbox_processed(conn, seeded)
        _defer_due_reviews(conn)
        _insert_active_project(conn)
        conn.commit()

    response = client.get(f"/v1/surfaces/assistant/today?date={seeded['date']}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["recommended_next_move"]["key"] == "define_project_next_action"
    assert payload["recommended_next_move"]["body"] == "1 active project missing a next action."
    assert "1 active project missing a next action" in payload["reason_stack"]


def test_assistant_today_recommends_overdue_commitment_after_overdue_tasks(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users LIMIT 1").fetchone()["id"])
    seeded = _seed_surface_summary_fixture(user_id)

    with get_connection() as conn:
        _demote_pending_interrupts(conn)
        yesterday = utc_now() - timedelta(days=1)
        conn.execute(
            "UPDATE commitments SET due_at = ?, updated_at = ? WHERE id = ?",
            (_iso(yesterday), _iso(utc_now()), seeded["commitment"]),
        )
        conn.commit()

    task_response = client.get(f"/v1/surfaces/assistant/today?date={seeded['date']}", headers=auth_headers)
    assert task_response.status_code == 200
    assert task_response.json()["recommended_next_move"]["key"] == "clear_overdue_tasks"

    with get_connection() as conn:
        _demote_overdue_task(conn, seeded)
        _mark_library_inbox_processed(conn, seeded)
        _defer_due_reviews(conn)
        conn.commit()

    commitment_response = client.get(f"/v1/surfaces/assistant/today?date={seeded['date']}", headers=auth_headers)

    assert commitment_response.status_code == 200
    payload = commitment_response.json()
    assert payload["recommended_next_move"]["key"] == "clear_overdue_commitments"
    assert payload["recommended_next_move"]["body"] == "1 open commitment overdue and needs a decision today."
    assert payload["strategic_context"]["overdue_commitment_count"] == 1
    assert payload["strategic_context"]["attention_items"][0]["kind"] == "commitment_overdue"


def test_assistant_today_strategic_context_flags_stale_goals_and_projects(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users LIMIT 1").fetchone()["id"])
    seeded = _seed_surface_summary_fixture(user_id)

    with get_connection() as conn:
        goal_id = _insert_active_goal(conn, title="Review learning direction", reviewed_days_ago=8)
        project_id = _insert_active_project(
            conn,
            goal_id=goal_id,
            title="Refresh project plan",
            next_action_id=seeded["task_todo"],
            reviewed_days_ago=15,
        )
        conn.commit()

    response = client.get(f"/v1/surfaces/assistant/today?date={seeded['date']}", headers=auth_headers)

    assert response.status_code == 200
    attention_items = response.json()["strategic_context"]["attention_items"]
    attention_by_kind = {item["kind"]: item for item in attention_items}
    assert attention_by_kind["project_stale"]["entity_id"] == project_id
    assert attention_by_kind["project_stale"]["body"] == "Active project has not been reviewed in 14 days."
    assert attention_by_kind["goal_review_due"]["entity_id"] == goal_id
    assert attention_by_kind["goal_review_due"]["body"] == "Active goal has not been reviewed within its weekly cadence."


def test_assistant_weekly_summary_reports_progress_and_slippage(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users LIMIT 1").fetchone()["id"])
    seeded = _seed_surface_summary_fixture(user_id)
    week_start = _today_week_start()

    with get_connection() as conn:
        yesterday = utc_now() - timedelta(days=1)
        conn.execute(
            "UPDATE commitments SET due_at = ?, updated_at = ? WHERE id = ?",
            (_iso(yesterday), _iso(utc_now()), seeded["commitment"]),
        )
        goal_id = _insert_active_goal(conn, title="Review learning direction", reviewed_days_ago=8)
        _insert_active_project(conn, goal_id=goal_id, title="Refresh project plan", reviewed_days_ago=15)
        conn.commit()

    response = client.get(f"/v1/surfaces/assistant/weekly?week_start={week_start}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    today = utc_now().date()
    assert payload["week_start"] == week_start
    assert payload["week_end"] == (today + timedelta(days=6)).isoformat()
    assert payload["progress"]["tasks_completed"] == 1
    assert payload["progress"]["review_session_count"] == 1
    assert payload["progress"]["review_item_count"] == 1
    assert payload["progress"]["captures_created"] == 1
    assert payload["progress"]["captures_processed"] == 1
    assert payload["progress"]["captures_summarized"] == 1
    assert payload["progress"]["cards_created"] == 4
    assert payload["progress"]["artifact_tasks_created"] == 1
    assert payload["slippage"]["overdue_tasks"] == 2
    assert payload["slippage"]["overdue_commitments"] == 1
    assert payload["slippage"]["unprocessed_captures"] == 1
    assert payload["slippage"]["due_review_cards"] == 3
    assert payload["slippage"]["stale_active_projects"] == 1
    assert payload["slippage"]["stale_active_goals"] == 1
    assert payload["slippage"]["projects_missing_next_action"] == 1

    option_keys = [option["key"] for option in payload["adaptation_options"]]
    assert option_keys == [
        "triage_overdue_tasks",
        "triage_overdue_commitments",
        "start_review",
        "process_captures",
        "review_strategy",
    ]
    assert all(option["enabled"] is True for option in payload["adaptation_options"])
    assert all(option["href"] or option["prompt"] for option in payload["adaptation_options"])
    assert {item["key"]: item["count"] for item in payload["attention_items"]} == {
        "overdue_tasks": 2,
        "overdue_commitments": 1,
        "due_review_cards": 3,
        "unprocessed_captures": 1,
        "projects_missing_next_action": 1,
        "stale_active_projects": 1,
        "stale_active_goals": 1,
    }
    assert payload["system_health"]["progress_signal_count"] > 0
    assert payload["system_health"]["slippage_signal_count"] == 7


def test_assistant_weekly_summary_quiet_week_defaults_to_empty_signals(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    week_start = _today_week_start()

    response = client.get(f"/v1/surfaces/assistant/weekly?week_start={week_start}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["week_start"] == week_start
    assert all(value == 0 for value in payload["progress"].values())
    assert all(value == 0 for value in payload["slippage"].values())
    assert payload["adaptation_options"] == []
    assert payload["attention_items"] == []
    assert payload["system_health"] == {"progress_signal_count": 0, "slippage_signal_count": 0}


def test_assistant_weekly_summary_uses_inclusive_start_and_exclusive_end_bounds(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    week_start = utc_now().date()
    start = datetime(week_start.year, week_start.month, week_start.day, tzinfo=timezone.utc)
    end = start + timedelta(days=7)

    with get_connection() as conn:
        for task_id, updated_at in [
            (new_id("tsk"), start - timedelta(seconds=1)),
            (new_id("tsk"), start),
            (new_id("tsk"), end),
        ]:
            conn.execute(
                """
                INSERT INTO tasks (id, title, status, estimate_min, priority, due_at, linked_note_id, source_artifact_id, revision, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, "Completed task", "done", None, 1, None, None, None, 1, _iso(updated_at), _iso(updated_at)),
            )
        for artifact_id, created_at in [
            (new_id("art"), start - timedelta(seconds=1)),
            (new_id("art"), start),
            (new_id("art"), end),
        ]:
            conn.execute(
                """
                INSERT INTO artifacts (id, source_type, title, raw_content, normalized_content, extracted_content, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (artifact_id, "clip_browser", "Bounded clip", "raw", "normalized", None, "{}", _iso(created_at), _iso(created_at)),
            )
            conn.execute(
                """
                INSERT INTO summary_versions (id, artifact_id, version, content, provider, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (new_id("sum"), artifact_id, 1, "Summary", "test", _iso(created_at)),
            )
        conn.commit()

    response = client.get(f"/v1/surfaces/assistant/weekly?week_start={week_start.isoformat()}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["progress"]["tasks_completed"] == 1
    assert payload["progress"]["captures_created"] == 1
    assert payload["progress"]["captures_processed"] == 1
    assert payload["progress"]["captures_summarized"] == 1


def test_assistant_weekly_summary_only_enables_grounded_adaptation_options(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    week_start = utc_now().date()
    now = utc_now()

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO tasks (id, title, status, estimate_min, priority, due_at, linked_note_id, source_artifact_id, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (new_id("tsk"), "Completed task", "done", None, 1, None, None, None, 1, _iso(now), _iso(now)),
        )
        conn.commit()

    response = client.get(f"/v1/surfaces/assistant/weekly?week_start={week_start.isoformat()}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["progress"]["tasks_completed"] == 1
    assert all(value == 0 for value in payload["slippage"].values())
    assert payload["adaptation_options"] == []
    assert not any(
        option["enabled"] and option["key"] in {"process_captures", "start_review", "triage_overdue_tasks"}
        for option in payload["adaptation_options"]
    )


def test_closed_tasks_and_commitments_do_not_count_as_open_loops(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users LIMIT 1").fetchone()["id"])
    seeded = _seed_surface_summary_fixture(user_id)

    planner = client.get(f"/v1/surfaces/planner/summary?date={seeded['date']}", headers=auth_headers)
    assert planner.status_code == 200
    planner_payload = planner.json()

    assert _bucket(planner_payload, "task_buckets", "due_today_tasks") == 1
    assert _bucket(planner_payload, "task_buckets", "overdue_tasks") == 1

    assistant = client.get(f"/v1/surfaces/assistant/today?date={seeded['date']}", headers=auth_headers)
    assert assistant.status_code == 200
    assistant_payload = assistant.json()

    assert _open_loop(assistant_payload, "overdue_tasks") == 1
    assert _open_loop(assistant_payload, "open_commitments") == 1
