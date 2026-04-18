import json
from sqlite3 import IntegrityError

import pytest
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
        "/v1/capture",
        json={
            "source_type": "clip_browser",
            "capture_source": "browser_ext",
            "title": "Nebula Notes",
            "source_url": "https://example.com/nebula",
            "raw": {"text": "<html>raw clip</html>", "mime_type": "text/html"},
            "normalized": {"text": "Stars form in nebulas and memory forms in review loops.", "mime_type": "text/plain"},
            "extracted": {"text": "Extracted: stars and recall systems."},
            "metadata": {
                "url": "https://example.com",
                "capture": {
                    "clip": {"page_title": "Nebula Notes", "site_name": "Example"},
                    "selection": {"text": "Extracted: stars and recall systems."},
                    "highlights": [{"quote": "stars and recall systems"}],
                },
            },
        },
        headers=auth_headers,
    )
    assert artifact.status_code == 201
    artifact_payload = artifact.json()["artifact"]
    artifact_id = artifact_payload["id"]
    assert artifact_payload["metadata"]["capture"]["clip"]["page_title"] == "Nebula Notes"
    assert artifact_payload["metadata"]["capture"]["selection"]["text"] == "Extracted: stars and recall systems."
    assert artifact_payload["metadata"]["capture"]["highlights"][0]["quote"] == "stars and recall systems"
    assert artifact_payload["metadata"]["capture"]["layers"]["normalized"]["text"] == "Stars form in nebulas and memory forms in review loops."

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
    assert len(payload["relations"]) >= 4

    memory_tree = client.get("/v1/memory/tree", headers=auth_headers)
    assert memory_tree.status_code == 200
    assert artifact_id in str(memory_tree.json()) or "wiki/sources" in str(memory_tree.json())

    versions = client.get(f"/v1/artifacts/{artifact_id}/versions", headers=auth_headers)
    assert versions.status_code == 200
    version_payload = versions.json()
    assert len(version_payload["summaries"]) >= 1
    assert len(version_payload["card_sets"]) >= 1
    assert len(version_payload["actions"]) >= 4

    events = client.get("/v1/events?cursor=0", headers=auth_headers)
    assert events.status_code == 200
    event_types = {item["event_type"] for item in events.json()}
    assert "capture.ingested" in event_types
    assert "artifact.created" in event_types
    assert "artifact.action_suggested" in event_types


def test_card_deck_browser_api_flow(client: TestClient, auth_headers: dict[str, str]) -> None:
    decks = client.get("/v1/cards/decks", headers=auth_headers)
    assert decks.status_code == 200
    inbox = decks.json()[0]
    assert inbox["name"] == "Inbox"

    created_deck = client.post(
        "/v1/cards/decks",
        json={
            "name": "ML Interviews",
            "description": "Bootstrap deck",
            "schedule": {
                "new_cards_due_offset_hours": 0,
                "initial_interval_days": 2,
                "initial_ease_factor": 2.7,
            },
        },
        headers=auth_headers,
    )
    assert created_deck.status_code == 201
    deck_id = created_deck.json()["id"]

    created_card = client.post(
        "/v1/cards",
        json={
            "deck_id": deck_id,
            "prompt": "What is overfitting?",
            "answer": "It is memorization that hurts generalization.",
            "tags": ["ml", "interviews", "generalization"],
        },
        headers=auth_headers,
    )
    assert created_card.status_code == 201
    card_payload = created_card.json()
    assert card_payload["deck_id"] == deck_id
    assert sorted(card_payload["tags"]) == ["generalization", "interviews", "ml"]

    listed_cards = client.get(f"/v1/cards?deck_id={deck_id}", headers=auth_headers)
    assert listed_cards.status_code == 200
    assert len(listed_cards.json()) == 1

    tagged_cards = client.get("/v1/cards?tag=ml", headers=auth_headers)
    assert tagged_cards.status_code == 200
    assert tagged_cards.json()[0]["id"] == card_payload["id"]

    updated_card = client.patch(
        f"/v1/cards/{card_payload['id']}",
        json={
            "tags": ["ml", "statistics"],
            "suspended": True,
            "due_at": "2026-04-02T00:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert updated_card.status_code == 200
    assert sorted(updated_card.json()["tags"]) == ["ml", "statistics"]
    assert updated_card.json()["suspended"] is True

    rejected_null_due = client.patch(
        f"/v1/cards/{card_payload['id']}",
        json={"due_at": None},
        headers=auth_headers,
    )
    assert rejected_null_due.status_code == 422
    assert rejected_null_due.json()["detail"] == "due_at cannot be null"

    updated_deck = client.patch(
        f"/v1/cards/decks/{deck_id}",
        json={
            "description": "Refined bootstrap deck",
            "schedule": {
                "new_cards_due_offset_hours": 6,
                "initial_interval_days": 3,
                "initial_ease_factor": 2.8,
            },
        },
        headers=auth_headers,
    )
    assert updated_deck.status_code == 200
    assert updated_deck.json()["description"] == "Refined bootstrap deck"
    assert updated_deck.json()["schedule"]["initial_interval_days"] == 3


def test_default_deck_bootstrap_recovers_from_insert_race(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import srs_service

    existing_default_deck = {
        "id": "cdk_existing",
        "name": srs_service.DEFAULT_DECK_NAME,
        "description": "Default deck for imported and generated cards.",
        "schedule_json": dict(srs_service.DEFAULT_SCHEDULE),
        "created_at": "2026-04-02T00:00:00+00:00",
        "updated_at": "2026-04-02T00:00:00+00:00",
    }

    class FakeConnection:
        def __init__(self) -> None:
            self.insert_attempted = False
            self.rollback_called = False
            self.reassigned_deck_id: str | None = None

        def execute(self, query: str, params: tuple | None = None):
            normalized = " ".join(query.split())
            if normalized.startswith("INSERT INTO card_decks"):
                self.insert_attempted = True
                raise IntegrityError("UNIQUE constraint failed: card_decks.name")
            if normalized.startswith("UPDATE cards SET deck_id = ?"):
                self.reassigned_deck_id = str((params or ("",))[0])
                return None
            raise AssertionError(f"Unexpected query: {normalized}")

        def commit(self) -> None:
            return None

        def rollback(self) -> None:
            self.rollback_called = True

    fake_conn = FakeConnection()

    def fake_fetchone(_conn, query: str, params: tuple):
        normalized = " ".join(query.split())
        if "WHERE name = ?" in normalized:
            return existing_default_deck if fake_conn.insert_attempted else None
        if "WHERE id = ?" in normalized:
            return existing_default_deck
        raise AssertionError(f"Unexpected fetchone query: {normalized}")

    monkeypatch.setattr(srs_service, "execute_fetchone", fake_fetchone)

    payload = srs_service.ensure_default_deck(fake_conn)  # type: ignore[arg-type]

    assert payload["id"] == existing_default_deck["id"]
    assert fake_conn.rollback_called is True
    assert fake_conn.reassigned_deck_id == existing_default_deck["id"]


def test_artifact_actions_use_ai_provider_outputs(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import ai_service

    def fake_run(_conn, capability: str, payload: dict, prefer_local: bool):
        assert prefer_local is True
        if capability == "llm_summary":
            return "codex_bridge", "ok", {"summary": f"Summary for {payload['title']}"}
        if capability == "llm_cards":
            return "api_fallback", "fallback", {
                "cards": [
                    {
                        "prompt": "What matters most?",
                        "answer": "Strong provenance and quick recall.",
                        "card_type": "qa",
                    }
                ]
            }
        if capability == "llm_tasks":
            return "local", "ok", {
                "tasks": [
                    {
                        "title": "Review the captured source",
                        "estimate_min": 20,
                        "priority": 4,
                    }
                ]
            }
        return "none", "failed", {}

    monkeypatch.setattr(ai_service, "run", fake_run)

    artifact = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_browser",
            "capture_source": "browser_ext",
            "title": "Provider-backed clip",
            "normalized": {"text": "Remember the source and act on it."},
        },
        headers=auth_headers,
    )
    assert artifact.status_code == 201
    artifact_id = artifact.json()["artifact"]["id"]

    for action in ["summarize", "cards", "tasks"]:
        response = client.post(
            f"/v1/artifacts/{artifact_id}/actions",
            json={"action": action},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "completed"

    graph = client.get(f"/v1/artifacts/{artifact_id}/graph", headers=auth_headers)
    assert graph.status_code == 200
    payload = graph.json()
    assert payload["summaries"][0]["provider"] == "codex_bridge"
    assert payload["summaries"][0]["content"] == "Summary for Provider-backed clip"
    assert payload["cards"][0]["prompt"] == "What matters most?"
    assert payload["tasks"][0]["title"] == "Review the captured source"


def test_deferred_ai_job_queue_flow(client: TestClient, auth_headers: dict[str, str]) -> None:
    artifact = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_browser",
            "capture_source": "browser_ext",
            "title": "Queued Codex clip",
            "normalized": {"text": "Batch this later with Codex."},
        },
        headers=auth_headers,
    )
    assert artifact.status_code == 201
    artifact_id = artifact.json()["artifact"]["id"]

    queued = client.post(
        f"/v1/artifacts/{artifact_id}/actions",
        json={"action": "summarize", "defer": True, "provider_hint": "codex_local"},
        headers=auth_headers,
    )
    assert queued.status_code == 200
    assert queued.json()["status"] == "queued"
    job_id = queued.json()["output_ref"]
    assert job_id

    jobs = client.get("/v1/ai/jobs?status=pending&provider_hint=codex_local", headers=auth_headers)
    assert jobs.status_code == 200
    ids = {job["id"] for job in jobs.json()}
    assert job_id in ids

    claimed = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "test-codex-runner"},
        headers=auth_headers,
    )
    assert claimed.status_code == 200
    assert claimed.json()["status"] == "running"

    completed = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "test-codex-runner",
            "provider_used": "codex_local",
            "output": {"summary": "Queued summary from Codex."},
        },
        headers=auth_headers,
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"

    graph = client.get(f"/v1/artifacts/{artifact_id}/graph", headers=auth_headers)
    assert graph.status_code == 200
    assert graph.json()["summaries"][0]["content"] == "Queued summary from Codex."
    assert graph.json()["summaries"][0]["provider"] == "codex_local"


def test_voice_capture_queues_whisper_transcription(client: TestClient, auth_headers: dict[str, str]) -> None:
    captured = client.post(
        "/v1/capture/voice",
        headers=auth_headers,
        files={"file": ("voice-note.wav", b"RIFF....WAVEfmt ", "audio/wav")},
        data={
            "title": "Voice thought",
            "duration_ms": "4200",
            "provider_hint": "whisper_local",
        },
    )
    assert captured.status_code == 201
    payload = captured.json()
    artifact_id = payload["artifact"]["id"]
    job_id = payload["job_id"]
    assert payload["artifact"]["source_type"] == "voice_note"

    jobs = client.get("/v1/ai/jobs?status=pending&provider_hint=whisper_local", headers=auth_headers)
    assert jobs.status_code == 200
    assert job_id in {job["id"] for job in jobs.json()}

    claimed = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "test-whisper-runner"},
        headers=auth_headers,
    )
    assert claimed.status_code == 200

    completed = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "test-whisper-runner",
            "provider_used": "whisper_local",
            "output": {"transcript": "Transcribed voice note from Whisper."},
        },
        headers=auth_headers,
    )
    assert completed.status_code == 200

    graph = client.get(f"/v1/artifacts/{artifact_id}/graph", headers=auth_headers)
    assert graph.status_code == 200
    assert graph.json()["artifact"]["normalized_content"] == "Transcribed voice note from Whisper."

    media_asset = client.get(
        f"/v1/media/{payload['artifact']['metadata']['capture']['layers']['raw']['blob_ref'].removeprefix('media://')}",
        headers=auth_headers,
    )
    assert media_asset.status_code == 200


def test_agent_tool_catalog_and_execution(client: TestClient, auth_headers: dict[str, str]) -> None:
    tools = client.get("/v1/agent/tools", headers=auth_headers)
    assert tools.status_code == 200
    tool_names = {item["name"] for item in tools.json()}
    assert "run_artifact_action" in tool_names
    assert "schedule_morning_brief_alarm" in tool_names
    assert "render_briefing_audio" in tool_names
    assert "get_execution_policy" in tool_names
    assert "set_execution_policy" in tool_names
    assert "create_note" in tool_names
    assert "generate_time_blocks" in tool_names
    create_task_tool = next(item for item in tools.json() if item["name"] == "create_task")
    assert create_task_tool["confirmation_policy"]["mode"] == "always"

    openai_tools = client.get("/v1/agent/tools?format=openai", headers=auth_headers)
    assert openai_tools.status_code == 200
    assert openai_tools.json()[0]["type"] == "function"

    updated_policy = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "set_execution_policy",
            "arguments": {
                "llm": ["batch_local_bridge", "server_local", "api_fallback"],
                "stt": ["batch_local_bridge", "server_local", "api_fallback"],
            },
        },
        headers=auth_headers,
    )
    assert updated_policy.status_code == 200
    assert updated_policy.json()["result"]["policy"]["llm"][0] == "desktop_bridge"

    fetched_policy = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "get_execution_policy",
            "arguments": {},
        },
        headers=auth_headers,
    )
    assert fetched_policy.status_code == 200
    assert fetched_policy.json()["result"]["policy"]["llm"][0] == "desktop_bridge"

    captured = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "capture_text_as_artifact",
            "arguments": {
                "title": "Agent-created clip",
                "text": "Create cards from this later.",
                "tags": ["agent", "chat"],
            },
        },
        headers=auth_headers,
    )
    assert captured.status_code == 200
    artifact_id = captured.json()["result"]["artifact"]["id"]

    listed_artifacts = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "list_artifacts",
            "arguments": {"limit": 10},
        },
        headers=auth_headers,
    )
    assert listed_artifacts.status_code == 200
    assert any(item["id"] == artifact_id for item in listed_artifacts.json()["result"]["artifacts"])

    artifact_graph = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "get_artifact_graph",
            "arguments": {"artifact_id": artifact_id},
        },
        headers=auth_headers,
    )
    assert artifact_graph.status_code == 200
    assert artifact_graph.json()["result"]["graph"]["artifact"]["id"] == artifact_id

    queued = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "run_artifact_action",
            "arguments": {
                "artifact_id": artifact_id,
                "action": "cards",
                "defer": True,
                "provider_hint": "codex_local",
            },
        },
        headers=auth_headers,
    )
    assert queued.status_code == 200
    assert queued.json()["result"]["status"] == "queued"

    scheduled = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "schedule_morning_brief_alarm",
            "arguments": {
                "date": "2026-03-07",
                "trigger_at": "2026-03-07T07:30:00+00:00",
                "device_target": "android-phone",
            },
        },
        headers=auth_headers,
    )
    assert scheduled.status_code == 200
    assert scheduled.json()["result"]["alarm"]["device_target"] == "android-phone"

    note = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "create_note",
            "arguments": {"title": "Agent note", "body_md": "Initial body"},
        },
        headers=auth_headers,
    )
    assert note.status_code == 200
    note_id = note.json()["result"]["note"]["id"]

    updated_note = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "update_note",
            "arguments": {"note_id": note_id, "body_md": "Updated body from agent"},
        },
        headers=auth_headers,
    )
    assert updated_note.status_code == 200
    assert updated_note.json()["result"]["note"]["version"] == 2

    listed_notes = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "list_notes",
            "arguments": {"limit": 10},
        },
        headers=auth_headers,
    )
    assert listed_notes.status_code == 200
    assert any(item["id"] == note_id for item in listed_notes.json()["result"]["notes"])

    created_task = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "create_task",
            "arguments": {"title": "Agent scheduled task", "estimate_min": 30, "priority": 4},
        },
        headers=auth_headers,
    )
    assert created_task.status_code == 200

    blocks = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "generate_time_blocks",
            "arguments": {"date": "2026-03-07", "day_start_hour": 8, "day_end_hour": 12},
        },
        headers=auth_headers,
    )
    assert blocks.status_code == 200
    assert len(blocks.json()["result"]["generated"]) >= 1

    created_event = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "create_calendar_event",
            "arguments": {
                "title": "Agent meeting",
                "starts_at": "2026-03-07T10:00:00+00:00",
                "ends_at": "2026-03-07T10:30:00+00:00",
            },
        },
        headers=auth_headers,
    )
    assert created_event.status_code == 200

    listed_events = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "list_calendar_events",
            "arguments": {"limit": 10},
        },
        headers=auth_headers,
    )
    assert listed_events.status_code == 200
    assert any(item["title"] == "Agent meeting" for item in listed_events.json()["result"]["events"])

    search = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "search_starlog",
            "arguments": {"query": "Agent-created", "limit": 5},
        },
        headers=auth_headers,
    )
    assert search.status_code == 200
    assert any(item["id"] == artifact_id for item in search.json()["result"])


def test_agent_command_shell_plans_and_executes(client: TestClient, auth_headers: dict[str, str]) -> None:
    intents = client.get("/v1/agent/intents", headers=auth_headers)
    assert intents.status_code == 200
    assert any(item["name"] == "execution_policy" for item in intents.json())

    artifact = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_browser",
            "capture_source": "browser_ext",
            "title": "Command artifact",
            "normalized": {"text": "Turn commands into concrete Starlog actions."},
        },
        headers=auth_headers,
    )
    assert artifact.status_code == 201

    planned = client.post(
        "/v1/agent/command",
        json={
            "command": "summarize latest artifact",
            "execute": False,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert planned.status_code == 200
    assert planned.json()["matched_intent"] == "summarize"
    assert planned.json()["steps"][0]["tool_name"] == "run_artifact_action"
    assert planned.json()["steps"][0]["status"] == "dry_run"

    executed_task = client.post(
        "/v1/agent/command",
        json={
            "command": "create task Review command planner due tomorrow priority 4 estimate 20m",
            "execute": True,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert executed_task.status_code == 200
    assert executed_task.json()["status"] == "executed"
    assert executed_task.json()["steps"][0]["result"]["task"]["title"] == "Review command planner"

    executed_event = client.post(
        "/v1/agent/command",
        json={
            "command": "create event Deep Work from 2026-03-07 09:00 to 2026-03-07 10:00",
            "execute": True,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert executed_event.status_code == 200
    assert executed_event.json()["steps"][0]["result"]["event"]["title"] == "Deep Work"

    executed_search = client.post(
        "/v1/agent/command",
        json={
            "command": "search for Command artifact",
            "execute": True,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert executed_search.status_code == 200
    assert executed_search.json()["steps"][0]["result"]

    list_tasks = client.post(
        "/v1/agent/command",
        json={
            "command": "list tasks",
            "execute": True,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert list_tasks.status_code == 200
    assert list_tasks.json()["matched_intent"] == "list_tasks"
    assert list_tasks.json()["steps"][0]["result"]["tasks"]

    policy = client.post(
        "/v1/agent/command",
        json={
            "command": "show execution policy",
            "execute": True,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert policy.status_code == 200
    assert "policy" in policy.json()["steps"][0]["result"]

    updated_policy = client.post(
        "/v1/agent/command",
        json={
            "command": "set llm policy to batch_local_bridge, server_local, api_fallback",
            "execute": True,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert updated_policy.status_code == 200
    assert updated_policy.json()["matched_intent"] == "set_execution_policy"
    assert updated_policy.json()["steps"][0]["result"]["policy"]["llm"][0] == "desktop_bridge"

    blocks = client.post(
        "/v1/agent/command",
        json={
            "command": "generate time blocks for tomorrow from 8 to 12",
            "execute": True,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert blocks.status_code == 200
    assert blocks.json()["matched_intent"] == "generate_time_blocks"

    queued_brief_audio = client.post(
        "/v1/agent/command",
        json={
            "command": "render briefing audio for tomorrow",
            "execute": True,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert queued_brief_audio.status_code == 200
    assert queued_brief_audio.json()["matched_intent"] == "render_briefing_audio"
    assert queued_brief_audio.json()["steps"][0]["result"]["job"]["action"] == "briefing_audio"


def test_voice_agent_command_queue_executes_after_transcription(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    queued = client.post(
        "/v1/agent/command/voice",
        headers=auth_headers,
        files={"file": ("assistant-command.wav", b"RIFF....WAVEfmt ", "audio/wav")},
        data={
            "title": "Voice command",
            "duration_ms": "3200",
            "execute": "true",
            "device_target": "android-phone",
            "provider_hint": "whisper_local",
        },
    )
    assert queued.status_code == 201
    payload = queued.json()
    job_id = payload["id"]
    assert payload["action"] == "assistant_command"

    listed = client.get("/v1/ai/jobs?status=pending&action=assistant_command", headers=auth_headers)
    assert listed.status_code == 200
    assert job_id in {job["id"] for job in listed.json()}

    claimed = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "test-voice-command-worker"},
        headers=auth_headers,
    )
    assert claimed.status_code == 200

    completed = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "test-voice-command-worker",
            "provider_used": "whisper_local",
            "output": {"transcript": "create task Voice command task due tomorrow priority 3"},
        },
        headers=auth_headers,
    )
    assert completed.status_code == 200
    completed_payload = completed.json()
    assert completed_payload["output"]["assistant_command"]["status"] == "executed"
    assert completed_payload["output"]["assistant_command"]["matched_intent"] == "create_task"

    tasks = client.get("/v1/tasks", headers=auth_headers)
    assert tasks.status_code == 200
    assert any(task["title"] == "Voice command task" for task in tasks.json())


def test_assist_agent_command_queue_executes_after_codex_plan(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    queued = client.post(
        "/v1/agent/command/assist",
        headers=auth_headers,
        json={
            "command": "please turn this into a concrete task",
            "execute": True,
            "device_target": "android-phone",
            "provider_hint": "codex_local",
        },
    )
    assert queued.status_code == 201
    payload = queued.json()
    job_id = payload["id"]
    assert payload["action"] == "assistant_command_ai"
    assert payload["capability"] == "llm_agent_plan"

    listed = client.get("/v1/ai/jobs?status=pending&action=assistant_command_ai", headers=auth_headers)
    assert listed.status_code == 200
    assert job_id in {job["id"] for job in listed.json()}

    claimed = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "test-codex-command-worker"},
        headers=auth_headers,
    )
    assert claimed.status_code == 200

    completed = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "test-codex-command-worker",
            "provider_used": "codex_local",
            "output": {
                "matched_intent": "create_task",
                "summary": "Create a follow-up task from the request.",
                "tool_calls": [
                    {
                        "tool_name": "create_task",
                        "arguments": {
                            "title": "AI planned follow-up",
                            "priority": 4,
                            "estimate_min": 25,
                        },
                        "message": "Create task AI planned follow-up",
                    }
                ],
            },
        },
        headers=auth_headers,
    )
    assert completed.status_code == 200
    completed_payload = completed.json()
    assert completed_payload["output"]["assistant_command"]["status"] == "planned"
    assert completed_payload["output"]["assistant_command"]["matched_intent"] == "create_task"
    assert completed_payload["output"]["assistant_command"]["planner"] == "llm_assist"
    assert completed_payload["output"]["assistant_command"]["steps"][0]["status"] == "confirmation_required"
    assert completed_payload["output"]["assistant_command"]["steps"][0]["confirmation_state"] == "required"

    tasks = client.get("/v1/tasks", headers=auth_headers)
    assert tasks.status_code == 200
    assert all(task["title"] != "AI planned follow-up" for task in tasks.json())


def test_briefing_audio_queue_attaches_rendered_audio(client: TestClient, auth_headers: dict[str, str]) -> None:
    briefing = client.post(
        "/v1/briefings/generate",
        headers=auth_headers,
        json={"date": "2026-03-07", "provider": "test-suite"},
    )
    assert briefing.status_code == 201
    briefing_id = briefing.json()["id"]

    queued = client.post(
        f"/v1/briefings/{briefing_id}/audio/render",
        headers=auth_headers,
        json={"provider_hint": "piper_local"},
    )
    assert queued.status_code == 201
    payload = queued.json()
    job_id = payload["id"]
    assert payload["action"] == "briefing_audio"
    assert payload["capability"] == "tts"

    claimed = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "test-tts-worker"},
        headers=auth_headers,
    )
    assert claimed.status_code == 200

    completed = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "test-tts-worker",
            "provider_used": "piper_local",
            "output": {"audio_ref": "media://med_rendered_briefing"},
        },
        headers=auth_headers,
    )
    assert completed.status_code == 200

    fetched = client.get("/v1/briefings/2026-03-07", headers=auth_headers)
    assert fetched.status_code == 200
    assert fetched.json()["audio_ref"] == "media://med_rendered_briefing"
    assert fetched.json()["generated_by_provider"] == "piper_local"


def test_ai_job_cancel_retry_and_stale_worker_guard(client: TestClient, auth_headers: dict[str, str]) -> None:
    artifact = client.post(
        "/v1/artifacts",
        json={"source_type": "text", "raw_content": "Queue and retry me."},
        headers=auth_headers,
    )
    assert artifact.status_code == 201
    artifact_id = artifact.json()["id"]

    queued = client.post(
        f"/v1/artifacts/{artifact_id}/actions",
        json={"action": "summarize", "defer": True, "provider_hint": "codex_local"},
        headers=auth_headers,
    )
    assert queued.status_code == 200
    job_id = queued.json()["output_ref"]
    assert job_id

    claimed = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "test-cancel-worker"},
        headers=auth_headers,
    )
    assert claimed.status_code == 200
    assert claimed.json()["status"] == "running"

    cancelled = client.post(
        f"/v1/ai/jobs/{job_id}/cancel",
        json={"reason": "Manual stop"},
        headers=auth_headers,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["error_text"] == "Manual stop"

    stale_complete = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "test-cancel-worker",
            "provider_used": "codex_local",
            "output": {"summary": "This should not win."},
        },
        headers=auth_headers,
    )
    assert stale_complete.status_code == 409

    retried = client.post(
        f"/v1/ai/jobs/{job_id}/retry",
        json={"provider_hint": "codex_local"},
        headers=auth_headers,
    )
    assert retried.status_code == 200
    assert retried.json()["status"] == "pending"
    assert retried.json()["provider_hint"] == "codex_local"

    filtered = client.get("/v1/ai/jobs?status=pending&capability=llm_summary", headers=auth_headers)
    assert filtered.status_code == 200
    assert job_id in {job["id"] for job in filtered.json()}

    reclaimed = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "test-retry-worker"},
        headers=auth_headers,
    )
    assert reclaimed.status_code == 200

    completed = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "test-retry-worker",
            "provider_used": "codex_local",
            "output": {"summary": "Retried queued summary."},
        },
        headers=auth_headers,
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"

    graph = client.get(f"/v1/artifacts/{artifact_id}/graph", headers=auth_headers)
    assert graph.status_code == 200
    assert graph.json()["summaries"][0]["content"] == "Retried queued summary."


def test_worker_token_refresh_and_revocation_lifecycle(client: TestClient, auth_headers: dict[str, str]) -> None:
    started = client.post(
        "/v1/workers/pairing/start",
        json={"expires_in_minutes": 15},
        headers=auth_headers,
    )
    assert started.status_code == 201
    pairing_token = started.json()["pairing_token"]

    worker_id = "security-worker"
    completed = client.post(
        "/v1/workers/pairing/complete",
        json={
            "pairing_token": pairing_token,
            "worker_id": worker_id,
            "worker_label": "Security worker",
            "worker_class": "desktop_bridge",
            "capabilities": ["llm_summary"],
        },
        headers=auth_headers,
    )
    assert completed.status_code == 200
    access_token = completed.json()["access_token"]
    refresh_token = completed.json()["refresh_token"]
    worker_headers = {"Authorization": f"Bearer {access_token}"}

    initial_heartbeat = client.post(
        "/v1/workers/heartbeat",
        json={"worker_id": worker_id, "capabilities": ["llm_summary"]},
        headers=worker_headers,
    )
    assert initial_heartbeat.status_code == 200

    refreshed = client.post(
        "/v1/workers/auth/refresh",
        json={"worker_id": worker_id, "refresh_token": refresh_token},
    )
    assert refreshed.status_code == 200
    next_access_token = refreshed.json()["access_token"]
    assert next_access_token != access_token
    refreshed_headers = {"Authorization": f"Bearer {next_access_token}"}

    stale_heartbeat = client.post(
        "/v1/workers/heartbeat",
        json={"worker_id": worker_id, "capabilities": ["llm_summary"]},
        headers=worker_headers,
    )
    assert stale_heartbeat.status_code == 401

    refreshed_heartbeat = client.post(
        "/v1/workers/heartbeat",
        json={"worker_id": worker_id, "capabilities": ["llm_summary"]},
        headers=refreshed_headers,
    )
    assert refreshed_heartbeat.status_code == 200

    listed_active = client.get("/v1/workers", headers=auth_headers)
    assert listed_active.status_code == 200
    assert worker_id in {item["worker_id"] for item in listed_active.json()}

    revoked = client.post(
        f"/v1/workers/{worker_id}/revoke",
        json={"reason": "security test"},
        headers=auth_headers,
    )
    assert revoked.status_code == 200
    assert revoked.json()["revoked_at"] is not None
    assert revoked.json()["revocation_reason"] == "security test"

    revoked_heartbeat = client.post(
        "/v1/workers/heartbeat",
        json={"worker_id": worker_id, "capabilities": ["llm_summary"]},
        headers=refreshed_headers,
    )
    assert revoked_heartbeat.status_code == 401

    revoked_refresh = client.post(
        "/v1/workers/auth/refresh",
        json={"worker_id": worker_id, "refresh_token": refresh_token},
    )
    assert revoked_refresh.status_code == 401

    listed_default = client.get("/v1/workers", headers=auth_headers)
    assert listed_default.status_code == 200
    assert worker_id not in {item["worker_id"] for item in listed_default.json()}

    listed_revoked = client.get("/v1/workers?include_revoked=true", headers=auth_headers)
    assert listed_revoked.status_code == 200
    revoked_payload = next(item for item in listed_revoked.json() if item["worker_id"] == worker_id)
    assert revoked_payload["revoked_at"] is not None
    assert revoked_payload["online"] is False


def test_review_calendar_briefing_export(client: TestClient, auth_headers: dict[str, str]) -> None:
    deck = client.post(
        "/v1/cards/decks",
        json={
            "name": "Export Deck",
            "description": "Export me too",
            "schedule": {
                "new_cards_due_offset_hours": 0,
                "initial_interval_days": 2,
                "initial_ease_factor": 2.7,
            },
        },
        headers=auth_headers,
    )
    assert deck.status_code == 201

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
    assert manifest["card_decks"] >= 2
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
    assert llm.json()["provider_used"] == "local_ai_runtime"
    assert llm.json()["output"]["_runtime"]["capability"] == "llm_summary"
    assert "Summary draft" in llm.json()["output"]["summary"]

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


def test_notes_edit_and_search(client: TestClient, auth_headers: dict[str, str]) -> None:
    note = client.post(
        "/v1/notes",
        json={"title": "Nebula Notebook", "body_md": "Spacing review notes and orbit ideas."},
        headers=auth_headers,
    )
    assert note.status_code == 201
    note_id = note.json()["id"]

    fetched = client.get(f"/v1/notes/{note_id}", headers=auth_headers)
    assert fetched.status_code == 200
    assert fetched.json()["title"] == "Nebula Notebook"

    updated = client.patch(
        f"/v1/notes/{note_id}",
        json={"body_md": "Spacing review notes, orbit ideas, and capture workflow."},
        headers=auth_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["version"] == 2

    task = client.post(
        "/v1/tasks",
        json={"title": "Capture nebula article", "estimate_min": 20, "priority": 3},
        headers=auth_headers,
    )
    assert task.status_code == 201

    artifact = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_browser",
            "capture_source": "browser_ext",
            "title": "Nebula article",
            "raw": {"text": "<html>Nebula article raw</html>", "mime_type": "text/html"},
            "normalized": {"text": "Nebula article on spaced review loops", "mime_type": "text/plain"},
            "extracted": {"text": "Nebula text extracted"},
            "metadata": {"source": "search_test"},
        },
        headers=auth_headers,
    )
    assert artifact.status_code == 201

    search = client.get("/v1/search?q=nebula&limit=10", headers=auth_headers)
    assert search.status_code == 200
    payload = search.json()
    kinds = {item["kind"] for item in payload["results"]}
    assert "note" in kinds
    assert "task" in kinds
    assert "artifact" in kinds


def test_calendar_event_revision_conflict_records_and_resolves_conflict(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    created = client.post(
        "/v1/calendar/events",
        json={
            "title": "Conflict event",
            "starts_at": "2026-03-06T09:00:00+00:00",
            "ends_at": "2026-03-06T10:00:00+00:00",
            "source": "internal",
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    event = created.json()
    event_id = event["id"]
    assert event["revision"] == 1

    first_update = client.patch(
        f"/v1/calendar/events/{event_id}",
        json={"title": "Conflict event updated", "base_revision": 1},
        headers=auth_headers,
    )
    assert first_update.status_code == 200
    assert first_update.json()["revision"] == 2

    stale_update = client.patch(
        f"/v1/calendar/events/{event_id}",
        json={"source": "google", "base_revision": 1},
        headers=auth_headers,
    )
    assert stale_update.status_code == 409
    conflict_detail = stale_update.json()["detail"]
    assert conflict_detail["code"] == "revision_conflict"
    conflict = conflict_detail["conflict"]
    assert conflict["entity_type"] == "calendar_event"
    assert conflict["entity_id"] == event_id
    assert conflict["base_revision"] == 1
    assert conflict["current_revision"] == 2
    assert conflict["status"] == "open"
    conflict_id = conflict["id"]

    listed = client.get("/v1/conflicts?status=open&entity_type=calendar_event", headers=auth_headers)
    assert listed.status_code == 200
    assert conflict_id in {item["id"] for item in listed.json()}

    resolved = client.post(
        f"/v1/conflicts/{conflict_id}/resolve",
        json={"strategy": "remote_wins"},
        headers=auth_headers,
    )
    assert resolved.status_code == 200
    payload = resolved.json()["conflict"]
    assert payload["status"] == "resolved"
    assert payload["resolution_strategy"] == "remote_wins"

    open_after = client.get("/v1/conflicts?status=open&entity_type=calendar_event", headers=auth_headers)
    assert open_after.status_code == 200
    assert conflict_id not in {item["id"] for item in open_after.json()}


def test_sync_activity_history(client: TestClient, auth_headers: dict[str, str]) -> None:
    pushed = client.post(
        "/v1/sync/activity",
        json={
            "client_id": "web_local",
            "entries": [
                {
                    "id": "act_mut_queued",
                    "mutation_id": "mut_1",
                    "label": "Create note: Nebula",
                    "entity": "note",
                    "op": "create",
                    "method": "POST",
                    "path": "/v1/notes",
                    "status": "queued",
                    "attempts": 0,
                    "detail": "Browser offline",
                    "created_at": "2026-03-06T08:00:00+00:00",
                    "recorded_at": "2026-03-06T08:00:01+00:00",
                },
                {
                    "id": "act_mut_flushed_1",
                    "mutation_id": "mut_1",
                    "label": "Create note: Nebula",
                    "entity": "note",
                    "op": "create",
                    "method": "POST",
                    "path": "/v1/notes",
                    "status": "flushed",
                    "attempts": 1,
                    "created_at": "2026-03-06T08:00:00+00:00",
                    "recorded_at": "2026-03-06T08:05:00+00:00",
                },
            ],
        },
        headers=auth_headers,
    )
    assert pushed.status_code == 200
    assert pushed.json()["accepted"] == 2

    duplicate = client.post(
        "/v1/sync/activity",
        json={
            "client_id": "web_local",
            "entries": [
                {
                    "id": "act_mut_flushed_1",
                    "mutation_id": "mut_1",
                    "label": "Create note: Nebula",
                    "entity": "note",
                    "op": "create",
                    "method": "POST",
                    "path": "/v1/notes",
                    "status": "flushed",
                    "attempts": 1,
                    "created_at": "2026-03-06T08:00:00+00:00",
                    "recorded_at": "2026-03-06T08:05:00+00:00",
                }
            ],
        },
        headers=auth_headers,
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["accepted"] == 0

    listed = client.get("/v1/sync/activity?limit=10", headers=auth_headers)
    assert listed.status_code == 200
    entries = listed.json()["entries"]
    assert len(entries) == 2
    assert entries[0]["status"] == "flushed"
    assert entries[0]["client_id"] == "web_local"

    filtered = client.get("/v1/sync/activity?limit=10&client_id=web_local", headers=auth_headers)
    assert filtered.status_code == 200
    assert len(filtered.json()["entries"]) == 2


def test_export_import_roundtrip(client: TestClient, auth_headers: dict[str, str]) -> None:
    artifact = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_browser",
            "capture_source": "browser_ext",
            "title": "Roundtrip article",
            "raw": {"text": "<html>Roundtrip article raw</html>", "mime_type": "text/html"},
            "normalized": {"text": "Roundtrip article normalized text", "mime_type": "text/plain"},
            "extracted": {"text": "Roundtrip extracted text"},
            "metadata": {"source": "roundtrip_test"},
        },
        headers=auth_headers,
    )
    assert artifact.status_code == 201
    artifact_id = artifact.json()["artifact"]["id"]

    for action in ["summarize", "cards", "tasks", "append_note"]:
        response = client.post(
            f"/v1/artifacts/{artifact_id}/actions",
            json={"action": action},
            headers=auth_headers,
        )
        assert response.status_code == 200

    created_event = client.post(
        "/v1/calendar/events",
        json={
            "title": "Roundtrip event",
            "starts_at": "2026-03-06T12:00:00+00:00",
            "ends_at": "2026-03-06T12:30:00+00:00",
            "source": "internal",
        },
        headers=auth_headers,
    )
    assert created_event.status_code == 201

    voice_capture = client.post(
        "/v1/capture/voice",
        headers=auth_headers,
        files={"file": ("roundtrip-voice.wav", b"RIFF....WAVEfmt ", "audio/wav")},
        data={"title": "Roundtrip voice", "provider_hint": "whisper_local"},
    )
    assert voice_capture.status_code == 201

    exported = client.get("/v1/export", headers=auth_headers)
    assert exported.status_code == 200
    export_payload = exported.json()
    assert export_payload["manifest"]["table_counts"]["media_assets"] == 1
    assert len(export_payload["media_blobs"]) == 1

    restored = client.post(
        "/v1/import/export",
        json={"export_payload": export_payload, "replace_existing": True},
        headers=auth_headers,
    )
    assert restored.status_code == 201
    restored_counts = restored.json()["restored_tables"]
    assert restored_counts["artifacts"] >= 1
    assert restored_counts["artifact_relations"] >= 1

    reexported = client.get("/v1/export", headers=auth_headers)
    assert reexported.status_code == 200
    reexport_payload = reexported.json()

    for table in [
        "artifacts",
        "media_assets",
        "action_runs",
        "artifact_relations",
        "summary_versions",
        "notes",
        "note_blocks",
        "card_set_versions",
        "cards",
        "tasks",
        "calendar_events",
    ]:
        assert reexport_payload["manifest"]["table_counts"][table] == export_payload["manifest"]["table_counts"][table]

    original_artifact_ids = {row["id"] for row in export_payload["entities"]["artifacts"]}
    roundtrip_artifact_ids = {row["id"] for row in reexport_payload["entities"]["artifacts"]}
    assert roundtrip_artifact_ids == original_artifact_ids

    original_relation_ids = {row["id"] for row in export_payload["entities"]["artifact_relations"]}
    roundtrip_relation_ids = {row["id"] for row in reexport_payload["entities"]["artifact_relations"]}
    assert roundtrip_relation_ids == original_relation_ids
    assert set(reexport_payload["media_blobs"]) == set(export_payload["media_blobs"])


def test_calendar_soft_delete_hides_events(client: TestClient, auth_headers: dict[str, str]) -> None:
    created = client.post(
        "/v1/calendar/events",
        json={
            "title": "Disposable Event",
            "starts_at": "2026-03-09T10:00:00+00:00",
            "ends_at": "2026-03-09T10:30:00+00:00",
            "source": "internal",
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    event_id = created.json()["id"]

    deleted = client.delete(f"/v1/calendar/events/{event_id}", headers=auth_headers)
    assert deleted.status_code == 204

    listed = client.get("/v1/calendar/events", headers=auth_headers)
    assert listed.status_code == 200
    ids = {item["id"] for item in listed.json()}
    assert event_id not in ids


def test_provider_config_and_webhooks(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import google_calendar_service, integrations_service, worker_service

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
    assert "secure_storage" in health.json()

    runtime_probe = client.post(
        "/v1/integrations/providers/local_probe",
        json={"enabled": True, "mode": "local_first", "config": {"endpoint": "http://127.0.0.1:65530"}},
        headers=auth_headers,
    )
    assert runtime_probe.status_code == 200
    probe_health = client.get("/v1/integrations/providers/local_probe/health", headers=auth_headers)
    assert probe_health.status_code == 200
    assert probe_health.json()["healthy"] is False
    assert probe_health.json()["checks"]["runtime_probe_ok"] is False
    assert probe_health.json()["probe"]["status"] == "failed"

    secret_value = "sk-live-provider-secret"
    api_config = client.post(
        "/v1/integrations/providers/api_llm",
        json={
            "enabled": True,
            "mode": "api_fallback",
            "config": {"api_key": secret_value, "model": "gpt-4.1-mini"},
        },
        headers=auth_headers,
    )
    assert api_config.status_code == 200
    assert api_config.json()["config"]["api_key"] == "__redacted__"

    listed = client.get("/v1/integrations/providers", headers=auth_headers)
    assert listed.status_code == 200
    provider_map = {item["provider_name"]: item for item in listed.json()}
    assert provider_map["api_llm"]["config"]["api_key"] == "__redacted__"

    missing_secret = client.post(
        "/v1/integrations/providers/api_missing_secret",
        json={"enabled": True, "mode": "api_fallback", "config": {"model": "gpt-4.1-mini"}},
        headers=auth_headers,
    )
    assert missing_secret.status_code == 200
    missing_health = client.get("/v1/integrations/providers/api_missing_secret/health", headers=auth_headers)
    assert missing_health.status_code == 200
    assert missing_health.json()["healthy"] is False
    assert missing_health.json()["checks"]["credential_present"] is False
    assert missing_health.json()["auth_probe"] == {}

    def fake_auth_probe(url: str, config: dict, timeout_seconds: float = 4.0) -> tuple[bool, str, dict[str, str]]:
        return True, "Auth probe succeeded (200)", {
            "target": url,
            "status": "ok",
            "detail": "Auth probe succeeded (200)",
            "header": "Authorization",
        }

    monkeypatch.setattr(integrations_service, "_probe_authenticated_endpoint", fake_auth_probe)

    api_probe = client.post(
        "/v1/integrations/providers/api_with_probe",
        json={
            "enabled": True,
            "mode": "api_fallback",
            "config": {
                "api_key": "sk-probe-secret",
                "model": "gpt-4.1-mini",
                "auth_probe_url": "https://example.com/v1/models",
            },
        },
        headers=auth_headers,
    )
    assert api_probe.status_code == 200
    api_probe_health = client.get("/v1/integrations/providers/api_with_probe/health", headers=auth_headers)
    assert api_probe_health.status_code == 200
    assert api_probe_health.json()["healthy"] is True
    assert api_probe_health.json()["checks"]["auth_probe_ok"] is True
    assert api_probe_health.json()["auth_probe"]["status"] == "ok"

    codex_contract = client.get("/v1/integrations/providers/codex_bridge/contract", headers=auth_headers)
    assert codex_contract.status_code == 200
    assert codex_contract.json()["contract_version"] == 2
    assert codex_contract.json()["execute_enabled"] is False
    assert codex_contract.json()["native_oauth_supported"] is False
    assert codex_contract.json()["native_contract_state"] == "unavailable"
    assert codex_contract.json()["recommended_runtime_mode"] == "api_fallback"
    assert len(codex_contract.json()["first_party_blockers"]) >= 1
    assert isinstance(codex_contract.json()["verified_at"], str)
    assert codex_contract.json()["feature_flag_key"] == "experimental_enabled"

    mobile_contract = client.get("/v1/integrations/providers/mobile_llm/contract", headers=auth_headers)
    assert mobile_contract.status_code == 200
    assert mobile_contract.json()["provider_name"] == "mobile_llm"
    assert mobile_contract.json()["runtime_state"] == "unavailable"
    assert mobile_contract.json()["feature_flag_key"] == "phone_local_llm_enabled"
    assert mobile_contract.json()["route_target"] == "mobile_bridge"
    assert mobile_contract.json()["recommended_policy_order"] == ["mobile_bridge", "desktop_bridge", "api"]
    assert mobile_contract.json()["phone_local_runtime_supported"] is False
    assert "mobile_llm provider config is missing." in mobile_contract.json()["blockers"]

    mobile_provider = client.post(
        "/v1/integrations/providers/mobile_llm",
        json={
            "enabled": True,
            "mode": "local_first",
            "config": {
                "phone_local_llm_enabled": True,
            },
        },
        headers=auth_headers,
    )
    assert mobile_provider.status_code == 200

    def fake_online_classes(_conn, capability: str) -> set[str]:
        if capability.startswith("llm_"):
            return {"mobile_bridge"}
        return set()

    monkeypatch.setattr(worker_service, "online_worker_classes_for_capability", fake_online_classes)

    mobile_ready_contract = client.get("/v1/integrations/providers/mobile_llm/contract", headers=auth_headers)
    assert mobile_ready_contract.status_code == 200
    assert mobile_ready_contract.json()["runtime_state"] == "experimental_available"
    assert mobile_ready_contract.json()["mobile_bridge_worker_online"] is True
    assert mobile_ready_contract.json()["phone_local_runtime_supported"] is True
    assert all(mobile_ready_contract.json()["capability_checks"].values())
    assert mobile_ready_contract.json()["blockers"] == []

    codex_provider = client.post(
        "/v1/integrations/providers/codex_bridge",
        json={
            "enabled": True,
            "mode": "bridge",
            "config": {
                "bridge_url": "https://codex.example.com",
                "api_key": "sk-codex-bridge",
                "model": "gpt-4.1-mini",
                "adapter_kind": "openai_compatible",
                "experimental_enabled": True,
            },
        },
        headers=auth_headers,
    )
    assert codex_provider.status_code == 200
    codex_health = client.get("/v1/integrations/providers/codex_bridge/health", headers=auth_headers)
    assert codex_health.status_code == 200
    assert codex_health.json()["healthy"] is True
    assert codex_health.json()["checks"]["auth_probe_ok"] is True
    assert codex_health.json()["checks"]["experimental_enabled"] is True
    assert codex_health.json()["auth_probe"]["target"] == "https://codex.example.com/v1/models"
    assert codex_health.json()["auth_probe"]["status"] == "ok"

    codex_contract = client.get("/v1/integrations/providers/codex_bridge/contract", headers=auth_headers)
    assert codex_contract.status_code == 200
    assert codex_contract.json()["configured"] is True
    assert codex_contract.json()["execute_enabled"] is True
    assert codex_contract.json()["recommended_runtime_mode"] == "experimental_openai_compatible_bridge"
    assert codex_contract.json()["configured_adapter_kind"] == "openai_compatible"
    assert codex_contract.json()["derived_endpoints"]["execute"] == "https://codex.example.com/v1/chat/completions"

    def fake_google_probe(_conn) -> tuple[bool, str, dict[str, str]]:
        return True, "Google auth probe succeeded", {
            "target": "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1",
            "status": "ok",
            "detail": "Loaded 0 event(s) from Google Calendar API",
        }

    monkeypatch.setattr(google_calendar_service, "probe_oauth_connection", fake_google_probe)

    google_provider = client.post(
        "/v1/integrations/providers/google_calendar",
        json={
            "enabled": True,
            "mode": "oauth_google",
            "config": {
                "source": "google_oauth",
                "access_token": "ya29.test",
                "refresh_token": "refresh_test",
                "expires_at": "2026-03-07T08:00:00+00:00",
            },
        },
        headers=auth_headers,
    )
    assert google_provider.status_code == 200
    google_health = client.get("/v1/integrations/providers/google_calendar/health", headers=auth_headers)
    assert google_health.status_code == 200
    assert google_health.json()["healthy"] is True
    assert google_health.json()["checks"]["auth_probe_ok"] is True
    assert google_health.json()["auth_probe"]["status"] == "ok"

    exported = client.get("/v1/export", headers=auth_headers)
    assert exported.status_code == 200
    raw_configs = exported.json()["entities"]["provider_configs"]
    assert secret_value not in json.dumps(raw_configs)

    webhook = client.post(
        "/v1/webhooks",
        json={"url": "https://example.com/webhook", "event_type": "artifact.created"},
        headers=auth_headers,
    )
    assert webhook.status_code == 201

    webhooks = client.get("/v1/webhooks", headers=auth_headers)
    assert webhooks.status_code == 200
    assert len(webhooks.json()) >= 1


def test_execution_policy_controls_ai_routing(client: TestClient, auth_headers: dict[str, str]) -> None:
    saved = client.post(
        "/v1/integrations/execution-policy",
        json={
            "llm": ["api_fallback", "codex_bridge", "server_local"],
            "stt": ["batch_local_bridge", "server_local", "api_fallback"],
            "tts": ["on_device", "server_local", "api_fallback"],
            "ocr": ["on_device"],
        },
        headers=auth_headers,
    )
    assert saved.status_code == 200
    assert saved.json()["llm"][0] == "api"

    fetched = client.get("/v1/integrations/execution-policy", headers=auth_headers)
    assert fetched.status_code == 200
    assert fetched.json()["available_targets"]["llm"][0] == "mobile_bridge"

    run = client.post(
        "/v1/ai/run",
        json={
            "capability": "llm_summary",
            "input": {"title": "Policy ordered clip", "text": "Use the configured priority order."},
            "prefer_local": True,
        },
        headers=auth_headers,
    )
    assert run.status_code == 200
    assert run.json()["provider_used"] == "local_ai_runtime"
    assert run.json()["output"]["_runtime"]["capability"] == "llm_summary"


def test_codex_bridge_requires_explicit_opt_in_for_execution(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import ai_service

    saved = client.post(
        "/v1/integrations/execution-policy",
        json={
            "llm": ["codex_bridge", "api_fallback"],
            "stt": ["batch_local_bridge", "server_local", "api_fallback"],
            "tts": ["on_device", "server_local", "api_fallback"],
            "ocr": ["on_device"],
        },
        headers=auth_headers,
    )
    assert saved.status_code == 200

    configured = client.post(
        "/v1/integrations/providers/codex_bridge",
        json={
            "enabled": True,
            "mode": "bridge",
            "config": {
                "bridge_url": "https://codex.example.com",
                "api_key": "sk-codex-bridge",
                "model": "gpt-4.1-mini",
            },
        },
        headers=auth_headers,
    )
    assert configured.status_code == 200

    def fail_invoke(*_args, **_kwargs):
        raise AssertionError("codex_bridge should not execute without explicit experimental opt-in")

    monkeypatch.setattr(ai_service, "_invoke_openai_compatible", fail_invoke)

    guarded = client.post(
        "/v1/ai/run",
        json={
            "capability": "llm_summary",
            "input": {"title": "Guarded bridge clip", "text": "Only run when explicitly enabled."},
            "prefer_local": True,
        },
        headers=auth_headers,
    )
    assert guarded.status_code == 200
    assert guarded.json()["provider_used"] == "local_ai_runtime"

    def fake_invoke(_provider_name: str, config: dict, capability: str, payload: dict) -> dict:
        assert capability == "llm_summary"
        assert payload["title"] == "Guarded bridge clip"
        assert config["bridge_url"] == "https://codex.example.com"
        return {
            "provider": "codex_bridge",
            "model": config["model"],
            "summary": "Codex bridge summary",
            "text": "Codex bridge summary",
        }

    monkeypatch.setattr(ai_service, "_invoke_openai_compatible", fake_invoke)

    opted_in = client.post(
        "/v1/integrations/providers/codex_bridge",
        json={
            "enabled": True,
            "mode": "bridge",
            "config": {
                "bridge_url": "https://codex.example.com",
                "api_key": "sk-codex-bridge",
                "model": "gpt-4.1-mini",
                "adapter_kind": "openai_compatible",
                "experimental_enabled": True,
            },
        },
        headers=auth_headers,
    )
    assert opted_in.status_code == 200

    live = client.post(
        "/v1/ai/run",
        json={
            "capability": "llm_summary",
            "input": {"title": "Guarded bridge clip", "text": "Only run when explicitly enabled."},
            "prefer_local": True,
        },
        headers=auth_headers,
    )
    assert live.status_code == 200
    assert live.json()["provider_used"] == "local_ai_runtime"
    assert live.json()["output"]["_runtime"]["capability"] == "llm_summary"


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

    oauth_status = client.get("/v1/calendar/sync/google/oauth/status", headers=auth_headers)
    assert oauth_status.status_code == 200
    oauth_payload = oauth_status.json()
    assert oauth_payload["connected"] is True
    assert oauth_payload["source"] in {"mock_oauth", "google_oauth"}

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
    assert isinstance(payload["run_id"], str)
    assert payload["run_id"].startswith("gsr_")
    assert payload["pushed"] >= 1
    assert payload["pulled"] >= 1

    remote_list = client.get("/v1/calendar/sync/google/remote/events", headers=auth_headers)
    assert remote_list.status_code == 200
    assert len(remote_list.json()) >= 1

    conflicts = client.get("/v1/calendar/sync/google/conflicts", headers=auth_headers)
    assert conflicts.status_code == 200


def test_google_conflict_resolution_flow(client: TestClient, auth_headers: dict[str, str]) -> None:
    start = client.post("/v1/calendar/sync/google/oauth/start", json={}, headers=auth_headers)
    state = start.json()["state"]
    callback = client.post(
        "/v1/calendar/sync/google/oauth/callback",
        json={"code": "demo-code-5678", "state": state},
        headers=auth_headers,
    )
    assert callback.status_code == 200

    local_event = client.post(
        "/v1/calendar/events",
        json={
            "title": "Local Version",
            "starts_at": "2026-03-10T08:00:00+00:00",
            "ends_at": "2026-03-10T09:00:00+00:00",
            "source": "internal",
            "remote_id": "remote_conflict_1",
        },
        headers=auth_headers,
    )
    assert local_event.status_code == 201

    remote_event = client.post(
        "/v1/calendar/sync/google/remote/events",
        json={
            "remote_id": "remote_conflict_1",
            "title": "Remote Version",
            "starts_at": "2026-03-10T10:00:00+00:00",
            "ends_at": "2026-03-10T11:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert remote_event.status_code == 201

    sync = client.post("/v1/calendar/sync/google/run", headers=auth_headers)
    assert sync.status_code == 200

    conflicts = client.get("/v1/calendar/sync/google/conflicts", headers=auth_headers)
    assert conflicts.status_code == 200
    payload = conflicts.json()
    assert len(payload) >= 1
    assert "sync_run_id" in payload[0]["detail"]
    assert "phase" in payload[0]["detail"]

    conflict_id = payload[0]["id"]
    replayed = client.post(
        f"/v1/calendar/sync/google/conflicts/{conflict_id}/replay",
        headers=auth_headers,
    )
    assert replayed.status_code == 200
    assert replayed.json()["sync_run"]["run_id"].startswith("gsr_")

    resolved = client.post(
        f"/v1/calendar/sync/google/conflicts/{conflict_id}/resolve",
        json={"resolution_strategy": "local_wins"},
        headers=auth_headers,
    )
    assert resolved.status_code == 200
    assert resolved.json()["conflict"]["resolved"] is True

    unresolved = client.get("/v1/calendar/sync/google/conflicts", headers=auth_headers)
    assert unresolved.status_code == 200
    unresolved_ids = {item["id"] for item in unresolved.json()}
    assert conflict_id not in unresolved_ids

    all_conflicts = client.get("/v1/calendar/sync/google/conflicts?include_resolved=true", headers=auth_headers)
    assert all_conflicts.status_code == 200
    resolved_items = {item["id"]: item for item in all_conflicts.json()}
    assert resolved_items[conflict_id]["resolution_strategy"] == "local_wins"


def test_plugins_and_markdown_import(client: TestClient, auth_headers: dict[str, str]) -> None:
    plugin = client.post(
        "/v1/plugins",
        json={
            "name": "starlog-card-ext",
            "version": "0.1.0",
            "capabilities": ["card_type.custom", "artifact.transform"],
            "manifest": {"entrypoint": "plugins/card_ext.py"},
        },
        headers=auth_headers,
    )
    assert plugin.status_code == 201
    assert plugin.json()["name"] == "starlog-card-ext"

    plugins = client.get("/v1/plugins", headers=auth_headers)
    assert plugins.status_code == 200
    assert len(plugins.json()) >= 1

    imported = client.post(
        "/v1/import/markdown",
        json={"title": "Imported Note", "markdown": "# Heading\\n\\nImported content"},
        headers=auth_headers,
    )
    assert imported.status_code == 201

    notes = client.get("/v1/notes", headers=auth_headers)
    assert notes.status_code == 200
    titles = {note["title"] for note in notes.json()}
    assert "Imported Note" in titles


def test_ops_metrics_and_backup(client: TestClient, auth_headers: dict[str, str]) -> None:
    metric_response = client.get("/v1/ops/metrics", headers=auth_headers)
    assert metric_response.status_code == 200
    metrics = metric_response.json()
    assert "queue_depth_sync_events" in metrics
    assert "cards_due" in metrics
    assert "tasks_todo" in metrics

    backup_response = client.post("/v1/ops/backup", headers=auth_headers)
    assert backup_response.status_code == 201
    payload = backup_response.json()
    assert payload["bytes_written"] > 0
    assert payload["backup_path"].endswith(".json")
