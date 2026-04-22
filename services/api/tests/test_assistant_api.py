import json
import asyncio
from datetime import timedelta

from fastapi.testclient import TestClient

from app.api.routes import assistant as assistant_routes
from app.core.security import create_session_token, hash_passphrase
from app.core.time import utc_now
from app.db.storage import get_connection
from app.services import ai_service, assistant_projection_service, assistant_thread_service, google_calendar_service
from app.services.common import new_id


def _message_texts(payload: dict) -> list[str]:
    return [
        part["text"]
        for message in payload["messages"]
        for part in message["parts"]
        if part["type"] == "text"
    ]


def _parse_sse_events(raw_stream: str, *, stop_event: str = "cursor", limit: int = 32) -> list[dict]:
    events: list[dict] = []
    current_event = "message"
    current_id: str | None = None
    data_lines: list[str] = []

    def flush() -> bool:
        nonlocal current_event, current_id, data_lines
        if not data_lines and current_event == "message" and current_id is None:
            return False
        raw_data = "\n".join(data_lines).strip()
        parsed = json.loads(raw_data) if raw_data else None
        events.append({"event": current_event, "id": current_id, "data": parsed})
        stop = current_event == stop_event
        current_event = "message"
        current_id = None
        data_lines = []
        return stop

    for index, line in enumerate(raw_stream.splitlines()):
        if index >= limit:
            break
        normalized = line
        if not normalized:
            if flush():
                break
            continue
        if normalized.startswith(":"):
            continue
        if normalized.startswith("event:"):
            current_event = normalized.partition(":")[2].strip() or "message"
            continue
        if normalized.startswith("id:"):
            current_id = normalized.partition(":")[2].strip() or None
            continue
        if normalized.startswith("data:"):
            data_lines.append(normalized.partition(":")[2].lstrip())
            continue

    return events


async def _collect_stream_output(stream) -> str:
    chunks: list[str] = []
    cursor_started = False
    async for chunk in stream:
        chunks.append(chunk)
        if chunk.startswith("event: cursor"):
            cursor_started = True
            continue
        if cursor_started and chunk.startswith("data:"):
            break
    await stream.aclose()
    return "".join(chunks)


def _secondary_auth_headers() -> dict[str, str]:
    token = create_session_token()
    now = utc_now()
    with get_connection() as conn:
        user_id = new_id("usr")
        conn.execute(
            "INSERT INTO users (id, passphrase_hash, created_at) VALUES (?, ?, ?)",
            (user_id, hash_passphrase("secondary user"), now.isoformat()),
        )
        conn.execute(
            "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                new_id("ses"),
                user_id,
                token.hashed,
                (now + timedelta(days=7)).isoformat(),
                now.isoformat(),
            ),
        )
        conn.commit()
    return {"Authorization": f"Bearer {token.plain}"}


def test_assistant_primary_thread_snapshot_bootstraps(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.get("/v1/assistant/threads/primary", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["slug"] == "primary"
    assert payload["messages"] == []
    assert payload["runs"] == []
    assert payload["interrupts"] == []
    assert payload["next_cursor"] is not None


def test_assistant_message_can_open_due_date_interrupt_and_resume(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    create = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "create task Review the diffusion notes",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "America/Los_Angeles"},
        },
        headers=auth_headers,
    )

    assert create.status_code == 201
    payload = create.json()
    assert payload["run"]["status"] == "interrupted"
    assert payload["assistant_message"]["status"] == "requires_action"
    interrupt = payload["run"]["current_interrupt"]
    assert interrupt is not None
    assert interrupt["tool_name"] == "request_due_date"

    submit = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"due_date": "2026-04-22", "priority": "4", "create_time_block": False, "client_timezone": "America/Los_Angeles"}},
        headers=auth_headers,
    )
    assert submit.status_code == 200
    snapshot = submit.json()
    completed_run = next(run for run in snapshot["runs"] if run["id"] == payload["run"]["id"])
    assert completed_run["status"] == "completed"
    assert any(message["role"] == "assistant" and message["status"] == "complete" for message in snapshot["messages"])
    tasks = client.get("/v1/tasks", headers=auth_headers)
    assert tasks.status_code == 200
    created_task = next(task for task in tasks.json() if task["title"] == "Review the diffusion notes")
    assert created_task["due_at"] == "2026-04-22T07:00:00Z"

    legacy = client.get("/v1/conversations/primary", headers=auth_headers)
    assert legacy.status_code == 200
    legacy_payload = legacy.json()
    assert any(message["content"] == "create task Review the diffusion notes" for message in legacy_payload["messages"])


def test_assistant_surface_event_can_project_planner_conflict_interrupt(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/v1/assistant/threads/primary/events",
        json={
            "source_surface": "planner",
            "kind": "planner.conflict.detected",
            "entity_ref": {"entity_type": "time_block", "entity_id": "tb_1"},
            "payload": {
                "assistant_text": "Deep Work overlaps with Team Sync.",
                "options": [
                    {"label": "Move Deep Work to 10:30–11:30", "value": "move_later"},
                    {"label": "Open Planner", "value": "open_planner"},
                ],
            },
            "visibility": "assistant_message",
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    payload = response.json()
    assert any(interrupt["tool_name"] == "resolve_planner_conflict" for interrupt in payload["interrupts"])


def test_assistant_review_reveal_event_can_open_grade_interrupt_and_submit_review(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    created = client.post(
        "/v1/cards",
        json={
            "prompt": "What is spaced repetition?",
            "answer": "A review scheduling approach that spaces recall over time.",
            "card_type": "qa",
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    card = created.json()

    response = client.post(
        "/v1/assistant/threads/primary/events",
        json={
            "source_surface": "review",
            "kind": "review.answer.revealed",
            "entity_ref": {
                "entity_type": "card",
                "entity_id": card["id"],
                "href": "/review",
                "title": card["prompt"],
            },
            "payload": {
                "card_id": card["id"],
                "prompt": card["prompt"],
                "card_type": card["card_type"],
            },
            "visibility": "assistant_message",
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    payload = response.json()
    interrupt = next(item for item in payload["interrupts"] if item["tool_name"] == "grade_review_recall")
    assert interrupt["title"] == "Grade recall"

    submit = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"rating": "4"}},
        headers=auth_headers,
    )

    assert submit.status_code == 200
    snapshot = submit.json()
    run = next(item for item in snapshot["runs"] if item["id"] == interrupt["run_id"])
    assert run["status"] == "completed"
    assert any(
        part["type"] == "text" and "Recorded Good" in part["text"]
        for message in snapshot["messages"]
        for part in message["parts"]
        if part["type"] == "text"
    )

    cards = client.get("/v1/cards", headers=auth_headers)
    assert cards.status_code == 200
    updated = next(item for item in cards.json() if item["id"] == card["id"])
    assert updated["repetitions"] == 1
    assert updated["interval_days"] == 1


def test_direct_review_submission_emits_assistant_ambient_update(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    created = client.post(
        "/v1/cards",
        json={
            "prompt": "What does retrieval practice improve?",
            "answer": "Long-term recall and transfer.",
            "card_type": "qa",
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    card = created.json()

    review = client.post(
        "/v1/reviews",
        json={"card_id": card["id"], "rating": 5},
        headers=auth_headers,
    )
    assert review.status_code == 201

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    assert any(
        part["type"] == "ambient_update" and part["update"]["label"] == "Review graded: Easy"
        for message in payload["messages"]
        for part in message["parts"]
    )


def test_capture_creation_reflects_into_assistant_triage_interrupt(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    captured = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_manual",
            "capture_source": "test-suite",
            "title": "Research clip",
            "raw": {"text": "Capture the transformer note for later.", "mime_type": "text/plain"},
            "normalized": {"text": "Capture the transformer note for later.", "mime_type": "text/plain"},
            "extracted": {"text": "Capture the transformer note for later.", "mime_type": "text/plain"},
        },
        headers=auth_headers,
    )
    assert captured.status_code == 201
    artifact_id = captured.json()["artifact"]["id"]

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    interrupt = next(item for item in payload["interrupts"] if item["tool_name"] == "triage_capture")
    assert interrupt["entity_ref"]["entity_id"] == artifact_id
    assert any("One quick choice" in text for text in _message_texts(payload))


def test_briefing_generation_reflects_into_choose_morning_focus_interrupt(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    generated = client.post(
        "/v1/briefings/generate",
        json={"date": "2026-04-22", "provider": "test-suite"},
        headers=auth_headers,
    )
    assert generated.status_code == 201
    briefing_id = generated.json()["id"]

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    interrupt = next(item for item in payload["interrupts"] if item["tool_name"] == "choose_morning_focus")
    assert interrupt["entity_ref"]["entity_id"] == briefing_id
    assert any("morning briefing" in text.lower() for text in _message_texts(payload))


def test_google_sync_conflict_reflection_dedupes_pending_planner_interrupts(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    conflict = {
        "id": "cnf_1",
        "local_event_id": "evt_local_1",
        "remote_id": "remote_evt_1",
        "strategy": "prefer_local",
        "detail": {"title": "Team Sync"},
        "resolved": False,
        "resolved_at": None,
        "resolution_strategy": None,
        "created_at": "2026-04-21T09:00:00+00:00",
    }
    run_counter = {"value": 0}

    def fake_run_two_way_sync(_conn):
        run_counter["value"] += 1
        return {
            "run_id": f"sync_{run_counter['value']}",
            "pushed": 0,
            "pulled": 1,
            "conflicts": 1,
            "last_synced_at": "2026-04-21T09:00:00+00:00",
        }

    monkeypatch.setattr(google_calendar_service, "run_two_way_sync", fake_run_two_way_sync)
    monkeypatch.setattr(google_calendar_service, "list_conflicts", lambda _conn, include_resolved=False: [conflict])

    first = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert first.status_code == 200

    snapshot_after_first = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot_after_first.status_code == 200
    first_payload = snapshot_after_first.json()
    first_interrupts = [
        item
        for item in first_payload["interrupts"]
        if item["tool_name"] == "resolve_planner_conflict" and item["entity_ref"]["entity_id"] == conflict["id"]
    ]
    assert len(first_interrupts) == 1

    second = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert second.status_code == 200

    snapshot_after_second = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot_after_second.status_code == 200
    second_payload = snapshot_after_second.json()
    second_interrupts = [
        item
        for item in second_payload["interrupts"]
        if item["tool_name"] == "resolve_planner_conflict" and item["entity_ref"]["entity_id"] == conflict["id"]
    ]
    assert len(second_interrupts) == 1


def test_direct_planner_conflict_resolution_closes_pending_interrupt_and_emits_ambient_update(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    conflict = {
        "id": "cnf_resolve_1",
        "local_event_id": "evt_local_1",
        "remote_id": "remote_evt_1",
        "strategy": "prefer_local",
        "detail": {"title": "Team Sync"},
        "resolved": False,
        "resolved_at": None,
        "resolution_strategy": None,
        "created_at": "2026-04-21T09:00:00+00:00",
    }

    monkeypatch.setattr(
        google_calendar_service,
        "run_two_way_sync",
        lambda _conn: {
            "run_id": "sync_open_1",
            "pushed": 0,
            "pulled": 1,
            "conflicts": 1,
            "last_synced_at": "2026-04-21T09:00:00+00:00",
        },
    )
    monkeypatch.setattr(google_calendar_service, "list_conflicts", lambda _conn, include_resolved=False: [conflict])
    monkeypatch.setattr(
        google_calendar_service,
        "resolve_conflict",
        lambda _conn, _conflict_id, resolution_strategy: {
            **conflict,
            "resolved": True,
            "resolved_at": "2026-04-21T09:05:00+00:00",
            "resolution_strategy": resolution_strategy,
        },
    )

    opened = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert opened.status_code == 200

    resolved = client.post(
        f"/v1/calendar/sync/google/conflicts/{conflict['id']}/resolve",
        json={"resolution_strategy": "local_wins"},
        headers=auth_headers,
    )
    assert resolved.status_code == 200

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    interrupt = next(
        item
        for item in payload["interrupts"]
        if item["tool_name"] == "resolve_planner_conflict" and item["entity_ref"]["entity_id"] == conflict["id"]
    )
    assert interrupt["status"] == "submitted"
    assert interrupt["resolution"]["values"]["resolution"] == "local_wins"
    run = next(item for item in payload["runs"] if item["id"] == interrupt["run_id"])
    assert run["current_interrupt"] is None
    assert any(
        part["type"] == "ambient_update"
        and part["update"]["label"] == "Planner conflict resolved"
        and "local wins" in (part["update"].get("body") or "")
        for message in payload["messages"]
        for part in message["parts"]
    )


def test_dismissed_planner_conflict_does_not_reopen_on_identical_sync(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    conflict = {
        "id": "cnf_dismiss_1",
        "local_event_id": "evt_local_d1",
        "remote_id": "remote_evt_d1",
        "strategy": "prefer_local",
        "detail": {"title": "Deep work overlap"},
        "resolved": False,
        "resolved_at": None,
        "resolution_strategy": None,
        "created_at": "2026-04-21T09:00:00+00:00",
    }

    monkeypatch.setattr(
        google_calendar_service,
        "run_two_way_sync",
        lambda _conn: {
            "run_id": "sync_dismiss_1",
            "pushed": 0,
            "pulled": 1,
            "conflicts": 1,
            "last_synced_at": "2026-04-21T09:00:00+00:00",
        },
    )
    monkeypatch.setattr(google_calendar_service, "list_conflicts", lambda _conn, include_resolved=False: [conflict])

    opened = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert opened.status_code == 200

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    interrupt = next(
        item
        for item in snapshot.json()["interrupts"]
        if item["tool_name"] == "resolve_planner_conflict" and item["entity_ref"]["entity_id"] == conflict["id"]
    )

    dismissed = client.post(f"/v1/assistant/interrupts/{interrupt['id']}/dismiss", headers=auth_headers)
    assert dismissed.status_code == 200

    rerun = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert rerun.status_code == 200

    final_snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert final_snapshot.status_code == 200
    matching_interrupts = [
        item
        for item in final_snapshot.json()["interrupts"]
        if item["tool_name"] == "resolve_planner_conflict" and item["entity_ref"]["entity_id"] == conflict["id"]
    ]
    assert len(matching_interrupts) == 1
    assert matching_interrupts[0]["status"] == "dismissed"


def test_submitted_planner_conflict_does_not_reopen_on_identical_sync(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    conflict = {
        "id": "cnf_submit_1",
        "local_event_id": "evt_local_s1",
        "remote_id": "remote_evt_s1",
        "strategy": "prefer_local",
        "detail": {"title": "Team sync overlap"},
        "resolved": False,
        "resolved_at": None,
        "resolution_strategy": None,
        "created_at": "2026-04-21T09:00:00+00:00",
    }

    monkeypatch.setattr(
        google_calendar_service,
        "run_two_way_sync",
        lambda _conn: {
            "run_id": "sync_submit_1",
            "pushed": 0,
            "pulled": 1,
            "conflicts": 1,
            "last_synced_at": "2026-04-21T09:00:00+00:00",
        },
    )
    monkeypatch.setattr(google_calendar_service, "list_conflicts", lambda _conn, include_resolved=False: [conflict])

    opened = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert opened.status_code == 200

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    interrupt = next(
        item
        for item in snapshot.json()["interrupts"]
        if item["tool_name"] == "resolve_planner_conflict" and item["entity_ref"]["entity_id"] == conflict["id"]
    )

    submitted = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"resolution": "local_wins"}},
        headers=auth_headers,
    )
    assert submitted.status_code == 200

    rerun = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert rerun.status_code == 200

    final_snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert final_snapshot.status_code == 200
    matching_interrupts = [
        item
        for item in final_snapshot.json()["interrupts"]
        if item["tool_name"] == "resolve_planner_conflict" and item["entity_ref"]["entity_id"] == conflict["id"]
    ]
    assert len(matching_interrupts) == 1
    assert matching_interrupts[0]["status"] == "submitted"


def test_planner_conflict_replay_clear_dismisses_pending_interrupt_and_emits_ambient_update(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    conflict = {
        "id": "cnf_replay_1",
        "local_event_id": "evt_local_2",
        "remote_id": "remote_evt_2",
        "strategy": "prefer_local",
        "detail": {"title": "Review sync"},
        "resolved": False,
        "resolved_at": None,
        "resolution_strategy": None,
        "created_at": "2026-04-21T09:00:00+00:00",
    }

    monkeypatch.setattr(
        google_calendar_service,
        "run_two_way_sync",
        lambda _conn: {
            "run_id": "sync_open_2",
            "pushed": 0,
            "pulled": 1,
            "conflicts": 1,
            "last_synced_at": "2026-04-21T09:00:00+00:00",
        },
    )
    monkeypatch.setattr(google_calendar_service, "list_conflicts", lambda _conn, include_resolved=False: [conflict])
    monkeypatch.setattr(
        google_calendar_service,
        "replay_conflict",
        lambda _conn, _conflict_id: {
            "sync_run": {
                "run_id": "sync_replay_1",
                "pushed": 1,
                "pulled": 0,
                "conflicts": 0,
                "last_synced_at": "2026-04-21T09:07:00+00:00",
            },
            "conflict": None,
        },
    )

    opened = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert opened.status_code == 200

    replayed = client.post(
        f"/v1/calendar/sync/google/conflicts/{conflict['id']}/replay",
        headers=auth_headers,
    )
    assert replayed.status_code == 200

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    interrupt = next(
        item
        for item in payload["interrupts"]
        if item["tool_name"] == "resolve_planner_conflict" and item["entity_ref"]["entity_id"] == conflict["id"]
    )
    assert interrupt["status"] == "dismissed"
    assert interrupt["resolution"]["values"]["reason"] == "replayed_cleanly"
    run = next(item for item in payload["runs"] if item["id"] == interrupt["run_id"])
    assert run["current_interrupt"] is None
    assert any(
        part["type"] == "ambient_update"
        and part["update"]["label"] == "Planner conflict cleared"
        for message in payload["messages"]
        for part in message["parts"]
    )


def test_artifact_action_reflects_immediate_library_ambient_update(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    def fake_run(_conn, capability: str, payload: dict, prefer_local: bool):
        assert capability == "llm_summary"
        return "codex_bridge", "ok", {"summary": f"Summary for {payload['title']}"}

    monkeypatch.setattr(ai_service, "run", fake_run)

    captured = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_manual",
            "capture_source": "test-suite",
            "title": "Library capture",
            "raw": {"text": "Immediate summary please.", "mime_type": "text/plain"},
        },
        headers=auth_headers,
    )
    assert captured.status_code == 201
    artifact_id = captured.json()["artifact"]["id"]

    response = client.post(
        f"/v1/artifacts/{artifact_id}/actions",
        json={"action": "summarize"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "completed"

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    assert any(
        part["type"] == "ambient_update"
        and part["update"]["label"] == "Summary ready"
        and "fresh summary draft" in (part["update"].get("body") or "")
        for message in payload["messages"]
        for part in message["parts"]
    )


def test_deferred_artifact_action_completion_reflects_library_ambient_update(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    captured = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_manual",
            "capture_source": "test-suite",
            "title": "Deferred capture",
            "raw": {"text": "Turn this into tasks later.", "mime_type": "text/plain"},
        },
        headers=auth_headers,
    )
    assert captured.status_code == 201
    artifact_id = captured.json()["artifact"]["id"]

    queued = client.post(
        f"/v1/artifacts/{artifact_id}/actions",
        json={"action": "tasks", "defer": True, "provider_hint": "desktop_bridge_codex"},
        headers=auth_headers,
    )
    assert queued.status_code == 200
    job_id = queued.json()["output_ref"]
    assert queued.json()["status"] == "queued"
    assert job_id

    claim = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "test-worker"},
        headers=auth_headers,
    )
    assert claim.status_code == 200

    complete = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "test-worker",
            "provider_used": "desktop_bridge_codex",
            "output": {
                "tasks": [
                    {
                        "title": "Review deferred capture",
                        "estimate_min": 20,
                        "priority": 4,
                    }
                ]
            },
        },
        headers=auth_headers,
    )
    assert complete.status_code == 200

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    assert any(
        part["type"] == "ambient_update"
        and part["update"]["label"] == "Task suggestions queued"
        for message in payload["messages"]
        for part in message["parts"]
    )
    assert any(
        part["type"] == "ambient_update"
        and part["update"]["label"] == "Task suggestions ready"
        and "suggested next actions" in (part["update"].get("body") or "")
        for message in payload["messages"]
        for part in message["parts"]
    )


def test_deferred_artifact_action_completion_does_not_reflect_to_primary_thread_for_secondary_user(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    bootstrap = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert bootstrap.status_code == 200
    assert bootstrap.json()["messages"] == []

    secondary_headers = _secondary_auth_headers()
    captured = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_manual",
            "capture_source": "test-suite",
            "title": "Secondary deferred capture",
            "raw": {"text": "Keep this away from the owner thread.", "mime_type": "text/plain"},
        },
        headers=secondary_headers,
    )
    assert captured.status_code == 201
    artifact_id = captured.json()["artifact"]["id"]

    queued = client.post(
        f"/v1/artifacts/{artifact_id}/actions",
        json={"action": "tasks", "defer": True, "provider_hint": "desktop_bridge_codex"},
        headers=secondary_headers,
    )
    assert queued.status_code == 200
    job_id = queued.json()["output_ref"]
    assert job_id

    claim = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "secondary-worker"},
        headers=secondary_headers,
    )
    assert claim.status_code == 200

    complete = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "secondary-worker",
            "provider_used": "desktop_bridge_codex",
            "output": {"tasks": [{"title": "Secondary-only task", "estimate_min": 10, "priority": 2}]},
        },
        headers=secondary_headers,
    )
    assert complete.status_code == 200

    owner_snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert owner_snapshot.status_code == 200
    assert owner_snapshot.json()["messages"] == []


def test_resolving_an_already_resolved_conflict_does_not_emit_duplicate_ambient_update(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with get_connection() as conn:
        now = utc_now().isoformat()
        conn.execute(
            """
            INSERT INTO calendar_sync_conflicts (
              id, local_event_id, remote_id, strategy, detail_json, resolved, resolved_at, resolution_strategy, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("cnf_resolved_once", None, "remote_evt_resolved_once", "prefer_local", json.dumps({}, sort_keys=True), 0, None, None, now),
        )
        conn.commit()

    first = client.post(
        "/v1/calendar/sync/google/conflicts/cnf_resolved_once/resolve",
        json={"resolution_strategy": "dismiss"},
        headers=auth_headers,
    )
    assert first.status_code == 200

    second = client.post(
        "/v1/calendar/sync/google/conflicts/cnf_resolved_once/resolve",
        json={"resolution_strategy": "dismiss"},
        headers=auth_headers,
    )
    assert second.status_code == 200

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    resolved_updates = [
        part
        for message in snapshot.json()["messages"]
        for part in message["parts"]
        if part["type"] == "ambient_update" and part["update"]["label"] == "Planner conflict resolved"
    ]
    assert len(resolved_updates) == 1


def test_assistant_updates_endpoint_returns_real_deltas_after_cursor(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    bootstrap = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert bootstrap.status_code == 200
    cursor = bootstrap.json()["next_cursor"]
    assert cursor is not None

    create = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "create task Schedule review block",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web"},
        },
        headers=auth_headers,
    )
    assert create.status_code == 201

    updates = client.get(f"/v1/assistant/threads/primary/updates?cursor={cursor}", headers=auth_headers)
    assert updates.status_code == 200
    payload = updates.json()
    event_types = {delta["event_type"] for delta in payload["deltas"]}
    assert "message.created" in event_types
    assert "run.updated" in event_types
    assert "interrupt.opened" in event_types
    follow_up = client.get(
        f"/v1/assistant/threads/primary/updates?cursor={payload['cursor']}",
        headers=auth_headers,
    )
    assert follow_up.status_code == 200
    assert follow_up.json()["deltas"] == []


def test_assistant_snapshot_message_limit_returns_latest_messages(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    client.get("/v1/assistant/threads/primary", headers=auth_headers)
    with get_connection() as conn:
        user_id = conn.execute("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1").fetchone()["id"]
        assistant_thread_service.ensure_primary_thread(conn, user_id=str(user_id))
        for index in range(5):
            assistant_thread_service.append_message(
                conn,
                thread_id="primary",
                role="assistant",
                status="complete",
                parts=[assistant_projection_service.text_part(f"assistant message {index}")],
                user_id=str(user_id),
            )

    response = client.get("/v1/assistant/threads/primary?message_limit=2", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    assert _message_texts(payload) == ["assistant message 3", "assistant message 4"]


def test_assistant_run_failure_marks_run_failed_and_persists_error_message(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    def boom(_request):
        raise RuntimeError("runtime exploded")

    monkeypatch.setattr(ai_service, "execute_chat_turn", boom)

    response = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "talk through this idea with me",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web"},
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["run"]["status"] == "failed"
    assert payload["assistant_message"]["status"] == "error"
    assert any("marked failed" in text for text in _message_texts(payload["snapshot"]))


def test_assistant_routes_enforce_primary_user_invariant(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    bootstrap = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert bootstrap.status_code == 200

    secondary_headers = _secondary_auth_headers()
    response = client.get("/v1/assistant/threads/primary", headers=secondary_headers)

    assert response.status_code == 403
    assert "primary Starlog user" in response.json()["detail"]


def test_assistant_stream_supports_resume_cursor(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    bootstrap = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert bootstrap.status_code == 200
    initial_cursor = bootstrap.json()["next_cursor"]
    assert initial_cursor is not None

    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1").fetchone()["id"])

    fixed_time = utc_now()
    monkeypatch.setattr(assistant_thread_service, "utc_now", lambda: fixed_time)

    with get_connection() as conn:
        assistant_thread_service.append_message(
            conn,
            thread_id="primary",
            role="assistant",
            status="complete",
            parts=[assistant_projection_service.text_part("stream message alpha")],
            user_id=user_id,
        )

    class _FakeRequest:
        def __init__(self, headers: dict[str, str] | None = None) -> None:
            self.headers = headers or {}

        async def is_disconnected(self) -> bool:
            return False

    first_stream = assistant_routes._stream_delta_events(
        thread_id="primary",
        user_id=user_id,
        request=_FakeRequest(),
        cursor=initial_cursor,
        poll_interval_seconds=0,
    )
    first_batch = _parse_sse_events(asyncio.run(_collect_stream_output(first_stream)))

    first_delta_events = [event for event in first_batch if event["event"] != "cursor"]
    assert {event["event"] for event in first_delta_events} == {"message.created"}
    assert any(
        part["type"] == "text" and part["text"] == "stream message alpha"
        for event in first_delta_events
        for part in event["data"]["payload"]["parts"]
    )
    resume_cursor = next(event["data"]["cursor"] for event in first_batch if event["event"] == "cursor")

    with get_connection() as conn:
        assistant_thread_service.append_message(
            conn,
            thread_id="primary",
            role="assistant",
            status="complete",
            parts=[assistant_projection_service.text_part("stream message beta")],
            user_id=user_id,
        )

    second_stream = assistant_routes._stream_delta_events(
        thread_id="primary",
        user_id=user_id,
        request=_FakeRequest(headers={"last-event-id": resume_cursor}),
        cursor=None,
        poll_interval_seconds=0,
    )
    second_batch = _parse_sse_events(asyncio.run(_collect_stream_output(second_stream)))

    second_delta_events = [event for event in second_batch if event["event"] != "cursor"]
    assert {event["event"] for event in second_delta_events} == {"message.created"}
    texts = [
        part["text"]
        for event in second_delta_events
        for part in event["data"]["payload"]["parts"]
        if part["type"] == "text"
    ]
    assert texts == ["stream message beta"]
    assert all(text != "stream message alpha" for text in texts)
