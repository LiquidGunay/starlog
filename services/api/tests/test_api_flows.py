from fastapi.testclient import TestClient


def test_health_and_auth_bootstrap(client: TestClient) -> None:
    health = client.get("/v1/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    bootstrap = client.post("/v1/auth/bootstrap", json={"passphrase": "correct horse battery staple"})
    assert bootstrap.status_code == 201

    duplicate = client.post("/v1/auth/bootstrap", json={"passphrase": "correct horse battery staple"})
    assert duplicate.status_code == 409

    login = client.post("/v1/auth/login", json={"passphrase": "correct horse battery staple"})
    assert login.status_code == 200
    assert login.json()["token_type"] == "bearer"


def test_artifact_graph_actions(client: TestClient, auth_headers: dict[str, str]) -> None:
    artifact = client.post(
        "/v1/artifacts",
        json={
            "source_type": "clip_browser",
            "title": "Nebula Notes",
            "raw_content": "A long clip about stars and recall systems.",
            "normalized_content": "Stars form in nebulas and memory forms in review loops.",
            "metadata": {"url": "https://example.com"},
        },
        headers=auth_headers,
    )
    assert artifact.status_code == 201
    artifact_id = artifact.json()["id"]

    for action in ["summarize", "cards", "tasks", "append_note"]:
        response = client.post(
            f"/v1/artifacts/{artifact_id}/actions",
            json={"action": action},
            headers=auth_headers,
        )
        assert response.status_code == 200

    graph = client.get(f"/v1/artifacts/{artifact_id}/graph", headers=auth_headers)
    assert graph.status_code == 200
    payload = graph.json()
    assert len(payload["summaries"]) >= 1
    assert len(payload["cards"]) >= 1
    assert len(payload["tasks"]) >= 1
    assert len(payload["notes"]) >= 1

    events = client.get("/v1/events?cursor=0", headers=auth_headers)
    assert events.status_code == 200
    event_types = {item["event_type"] for item in events.json()}
    assert "artifact.created" in event_types
    assert "artifact.action_suggested" in event_types


def test_review_calendar_briefing_export(client: TestClient, auth_headers: dict[str, str]) -> None:
    artifact = client.post(
        "/v1/artifacts",
        json={"source_type": "text", "raw_content": "Review cadence matters."},
        headers=auth_headers,
    )
    artifact_id = artifact.json()["id"]
    client.post(f"/v1/artifacts/{artifact_id}/actions", json={"action": "cards"}, headers=auth_headers)

    graph = client.get(f"/v1/artifacts/{artifact_id}/graph", headers=auth_headers).json()
    card_id = graph["cards"][0]["id"]

    review = client.post(
        "/v1/reviews",
        json={"card_id": card_id, "rating": 4, "latency_ms": 1200},
        headers=auth_headers,
    )
    assert review.status_code == 201
    assert review.json()["repetitions"] >= 1

    task = client.post(
        "/v1/tasks",
        json={"title": "Plan deep-work block", "estimate_min": 45, "priority": 3},
        headers=auth_headers,
    )
    assert task.status_code == 201

    event = client.post(
        "/v1/calendar/events",
        json={
            "title": "Deep Work",
            "starts_at": "2026-03-06T08:00:00+00:00",
            "ends_at": "2026-03-06T09:00:00+00:00",
            "source": "internal",
        },
        headers=auth_headers,
    )
    assert event.status_code == 201

    briefing = client.post(
        "/v1/briefings/generate",
        json={"date": "2026-03-06", "provider": "template"},
        headers=auth_headers,
    )
    assert briefing.status_code == 201

    export_payload = client.get("/v1/export", headers=auth_headers)
    assert export_payload.status_code == 200
    manifest = export_payload.json()["manifest"]["table_counts"]
    assert manifest["artifacts"] >= 1
    assert manifest["cards"] >= 1
    assert manifest["tasks"] >= 1


def test_ai_run_fallback_policy(client: TestClient, auth_headers: dict[str, str]) -> None:
    llm = client.post(
        "/v1/ai/run",
        json={
            "capability": "llm_summary",
            "input": {"text": "Spaced repetition increases long-term retention."},
            "prefer_local": True,
        },
        headers=auth_headers,
    )
    assert llm.status_code == 200
    assert llm.json()["provider_used"] == "local"

    ocr = client.post(
        "/v1/ai/run",
        json={
            "capability": "ocr",
            "input": {"text_hint": "sample"},
            "prefer_local": False,
        },
        headers=auth_headers,
    )
    assert ocr.status_code == 200
    assert ocr.json()["status"] == "failed"


def test_generate_time_blocks(client: TestClient, auth_headers: dict[str, str]) -> None:
    client.post(
        "/v1/tasks",
        json={"title": "Write spaced repetition notes", "estimate_min": 40, "priority": 4},
        headers=auth_headers,
    )
    client.post(
        "/v1/tasks",
        json={"title": "Review calendar and refine plan", "estimate_min": 30, "priority": 3},
        headers=auth_headers,
    )

    generated = client.post(
        "/v1/planning/blocks/generate",
        json={"date": "2026-03-06", "day_start_hour": 8, "day_end_hour": 12},
        headers=auth_headers,
    )
    assert generated.status_code == 200
    assert generated.json()["generated"] >= 1

    listed = client.get("/v1/planning/blocks/2026-03-06", headers=auth_headers)
    assert listed.status_code == 200
    assert len(listed.json()) >= 1


def test_provider_config_and_webhooks(client: TestClient, auth_headers: dict[str, str]) -> None:
    configured = client.post(
        "/v1/integrations/providers/local_llm",
        json={"enabled": True, "mode": "local_first", "config": {"model": "qwen2.5"}},
        headers=auth_headers,
    )
    assert configured.status_code == 200
    assert configured.json()["provider_name"] == "local_llm"

    health = client.get("/v1/integrations/providers/local_llm/health", headers=auth_headers)
    assert health.status_code == 200
    assert health.json()["healthy"] is True

    webhook = client.post(
        "/v1/webhooks",
        json={"url": "https://example.com/webhook", "event_type": "artifact.created"},
        headers=auth_headers,
    )
    assert webhook.status_code == 201

    webhooks = client.get("/v1/webhooks", headers=auth_headers)
    assert webhooks.status_code == 200
    assert len(webhooks.json()) >= 1


def test_google_sync_oauth_and_delta_flow(client: TestClient, auth_headers: dict[str, str]) -> None:
    start = client.post("/v1/calendar/sync/google/oauth/start", json={}, headers=auth_headers)
    assert start.status_code == 200
    state = start.json()["state"]
    assert "accounts.google.com" in start.json()["auth_url"]

    callback = client.post(
        "/v1/calendar/sync/google/oauth/callback",
        json={"code": "demo-code-1234", "state": state},
        headers=auth_headers,
    )
    assert callback.status_code == 200
    assert callback.json()["connected"] is True

    local_event = client.post(
        "/v1/calendar/events",
        json={
            "title": "Local Deep Work",
            "starts_at": "2026-03-07T09:00:00+00:00",
            "ends_at": "2026-03-07T10:00:00+00:00",
            "source": "internal",
        },
        headers=auth_headers,
    )
    assert local_event.status_code == 201

    remote_event = client.post(
        "/v1/calendar/sync/google/remote/events",
        json={
            "remote_id": "remote_meeting_1",
            "title": "Remote Planning",
            "starts_at": "2026-03-07T11:00:00+00:00",
            "ends_at": "2026-03-07T11:30:00+00:00",
        },
        headers=auth_headers,
    )
    assert remote_event.status_code == 201

    sync = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert sync.status_code == 200
    payload = sync.json()
    assert payload["pushed"] >= 1
    assert payload["pulled"] >= 1

    remote_list = client.get("/v1/calendar/sync/google/remote/events", headers=auth_headers)
    assert remote_list.status_code == 200
    assert len(remote_list.json()) >= 1

    conflicts = client.get("/v1/calendar/sync/google/conflicts", headers=auth_headers)
    assert conflicts.status_code == 200
