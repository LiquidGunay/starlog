import json
import asyncio
from datetime import timedelta

from fastapi.testclient import TestClient

from app.api.routes import assistant as assistant_routes
from app.core.security import create_session_token, hash_passphrase
from app.core.time import utc_now
from app.db.storage import get_connection
from app.services import ai_service, assistant_projection_service, assistant_thread_service
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
) -> None:
    bootstrap = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert bootstrap.status_code == 200
    initial_cursor = bootstrap.json()["next_cursor"]
    assert initial_cursor is not None

    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1").fetchone()["id"])

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
