from fastapi.testclient import TestClient


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
            "metadata": {"surface": "assistant_web"},
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
        json={"values": {"due_date": "2026-04-22", "priority": "4", "create_time_block": False}},
        headers=auth_headers,
    )
    assert submit.status_code == 200
    snapshot = submit.json()
    completed_run = next(run for run in snapshot["runs"] if run["id"] == payload["run"]["id"])
    assert completed_run["status"] == "completed"
    assert any(message["role"] == "assistant" and message["status"] == "complete" for message in snapshot["messages"])

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
