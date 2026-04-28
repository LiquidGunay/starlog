import json
from datetime import datetime, timedelta, timezone

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

    with get_connection() as conn:
        after_threads = conn.execute("SELECT COUNT(*) FROM conversation_threads").fetchone()[0]
        after_state = conn.execute("SELECT COUNT(*) FROM conversation_session_state").fetchone()[0]

    assert after_threads == before_threads
    assert after_state == before_state


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
