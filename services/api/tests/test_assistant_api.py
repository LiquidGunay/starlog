import asyncio
import json
import os
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

from app.api.routes import assistant as assistant_routes
from app.core.security import create_session_token, hash_passphrase
from app.core.time import utc_now
from app.db.storage import get_connection
from app.schemas.assistant import AssistantMessagePart, AssistantRuntimeRequest, AssistantThreadSnapshot
from app.services import (
    ai_runtime_service,
    ai_service,
    agent_service,
    artifacts_service,
    assistant_projection_service,
    assistant_run_service,
    assistant_thread_service,
    memory_service,
    google_calendar_service,
)
from app.services.common import new_id


def _message_texts(payload: dict) -> list[str]:
    return [
        part["text"]
        for message in payload["messages"]
        for part in message["parts"]
        if part["type"] == "text"
    ]


def _focus_options(interrupt: dict) -> list[dict[str, str]]:
    field = next(field for field in interrupt["fields"] if field["id"] == "focus")
    return field["options"]


def _planner_surface_events_for_entity(entity_id: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT kind, visibility, projected_message, entity_ref_json, payload_json
            FROM conversation_surface_events
            WHERE source_surface = 'planner'
            ORDER BY created_at ASC
            """
        ).fetchall()

    events: list[dict] = []
    for row in rows:
        entity_ref = json.loads(row["entity_ref_json"] or "{}")
        if entity_ref.get("entity_id") != entity_id:
            continue
        events.append(
            {
                "kind": row["kind"],
                "visibility": row["visibility"],
                "projected_message": bool(row["projected_message"]),
                "entity_ref": entity_ref,
                "payload": json.loads(row["payload_json"] or "{}"),
            }
        )
    return events


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


async def _collect_stream_output(
    stream,
    *,
    stop_event: str = "cursor",
    max_chunks: int = 16,
    timeout_seconds: float = 1.0,
) -> str:
    chunks: list[str] = []
    stop_event_started = False
    try:
        async with asyncio.timeout(timeout_seconds):
            async for chunk in stream:
                chunks.append(chunk)
                if len(chunks) > max_chunks:
                    raise AssertionError(f"stream exceeded {max_chunks} chunks before {stop_event}")
                if chunk.startswith(f"event: {stop_event}"):
                    stop_event_started = True
                    continue
                if stop_event_started and chunk.startswith("data:"):
                    return "".join(chunks)
    except TimeoutError as exc:
        raise AssertionError(f"stream did not emit {stop_event} within {timeout_seconds} seconds") from exc
    finally:
        await stream.aclose()
    raise AssertionError(f"stream closed before emitting {stop_event}")


async def _keep_alive_stream():
    while True:
        yield ": keep-alive\n\n"
        await asyncio.sleep(0)


def test_assistant_stream_collector_is_bounded() -> None:
    with pytest.raises(AssertionError, match="stream exceeded 2 chunks"):
        asyncio.run(_collect_stream_output(_keep_alive_stream(), max_chunks=2))


def test_assistant_today_route_alias_matches_surface_summary(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    alias_response = client.get("/v1/assistant/today?date=2026-05-19", headers=auth_headers)
    canonical_response = client.get("/v1/surfaces/assistant/today?date=2026-05-19", headers=auth_headers)

    assert alias_response.status_code == 200
    assert canonical_response.status_code == 200

    alias_payload = alias_response.json()
    canonical_payload = canonical_response.json()
    alias_payload.pop("generated_at")
    canonical_payload.pop("generated_at")

    assert alias_payload == canonical_payload
    assert alias_payload["recommended_next_move"]["key"] == "plan_today"


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


def _create_pending_ui_interrupt(
    *,
    tool_name: str,
    title: str,
    fields: list[dict],
    primary_label: str = "Confirm",
    secondary_label: str | None = "Not now",
    renderer_key: str | None = None,
    renderer_version: int | None = None,
    placement: str | None = None,
    structured_content: dict | None = None,
    ui_meta: dict | None = None,
    metadata: dict | None = None,
    entity_ref: dict | None = None,
) -> dict:
    with get_connection() as conn:
        user_id = str(conn.execute("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1").fetchone()["id"])
        thread = assistant_thread_service.ensure_primary_thread(conn, user_id=user_id)
        run = assistant_run_service._create_run(
            conn,
            thread_id=thread["id"],
            origin_message_id=None,
            orchestrator="deterministic",
            metadata={"test": "ui_interrupt"},
        )
        interrupt = assistant_run_service._create_interrupt(
            conn,
            run_id=run["id"],
            thread_id=thread["id"],
            tool_name=tool_name,
            interrupt_type="form",
            title=title,
            body="Choose one value.",
            fields=fields,
            primary_label=primary_label,
            secondary_label=secondary_label,
            renderer_key=renderer_key,
            renderer_version=renderer_version,
            placement=placement,
            structured_content=structured_content,
            ui_meta=ui_meta,
            metadata=metadata or {},
            entity_ref=entity_ref,
        )
        assistant_run_service._update_run(conn, run_id=run["id"], status="interrupted", summary="Waiting for UI interrupt")
        return interrupt


def _create_test_artifact(*, title: str = "Test artifact", source_type: str = "clip_desktop_helper", metadata: dict | None = None) -> str:
    with get_connection() as conn:
        artifact = artifacts_service.create_artifact(
            conn,
            source_type=source_type,
            title=title,
            raw_content="raw artifact text",
            normalized_content="normalized artifact text",
            extracted_content="extracted artifact text",
            metadata=metadata or {"capture": {"capture_source": "desktop_helper"}},
        )
    return str(artifact["id"])


def _create_assistant_study_source_and_topic(
    client: TestClient,
    auth_headers: dict[str, str],
    *,
    source_title: str,
    topic_title: str,
) -> tuple[dict, dict]:
    source_response = client.post(
        "/v1/study/sources",
        json={"title": source_title, "source_type": "manual", "metadata": {"course": "interview prep"}},
        headers=auth_headers,
    )
    assert source_response.status_code == 201
    source = source_response.json()

    topic_response = client.post(
        "/v1/study/topics",
        json={
            "source_id": source["id"],
            "title": topic_title,
            "summary": f"{topic_title} summary.",
            "display_order": 1,
        },
        headers=auth_headers,
    )
    assert topic_response.status_code == 201
    return source, topic_response.json()


def _create_assistant_due_card(
    client: TestClient,
    auth_headers: dict[str, str],
    *,
    prompt: str,
    card_type: str = "qa",
) -> dict:
    response = client.post(
        "/v1/cards",
        json={
            "prompt": prompt,
            "answer": "A gated card for the interview prep loop.",
            "card_type": card_type,
            "due_at": "2026-04-02T00:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.json()


def _post_assistant_study_command(
    client: TestClient,
    auth_headers: dict[str, str],
    *,
    content: str,
) -> dict:
    response = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": content,
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.json()


def _assistant_tool_call(payload: dict, tool_name: str) -> dict:
    return next(
        part["tool_call"]
        for part in payload["assistant_message"]["parts"]
        if part["type"] == "tool_call" and part["tool_call"]["tool_name"] == tool_name
    )


def _assistant_tool_result_for_call(payload: dict, tool_call_id: str) -> dict:
    return next(
        part["tool_result"]
        for part in payload["assistant_message"]["parts"]
        if part["type"] == "tool_result" and part["tool_result"]["tool_call_id"] == tool_call_id
    )


def _assistant_visible_text(payload: dict) -> str:
    return "\n".join(
        part["text"]
        for part in payload["assistant_message"]["parts"]
        if part["type"] == "text"
    )


def _assert_capability_manifest_covers_surface_limits(manifest: dict) -> None:
    assert manifest["approved_surfaces"] == ["Assistant", "Library", "Planner", "Review"]
    surfaces = {entry["surface"]: entry for entry in manifest["surface_capabilities"]}
    assert set(surfaces) == {"Assistant", "Library", "Planner", "Review"}
    assert surfaces["Assistant"]["status"] == "supported_now"
    assert surfaces["Review"]["status"] == "supported_now"
    assert surfaces["Library"]["status"] == "partial_supported_now"
    assert surfaces["Planner"]["status"] == "partial_supported_now"
    assert any("queued voice transcript" in item for item in manifest["supported_now"])
    assert any("task due-date" in item for item in manifest["supported_now"])
    assert any("Review recall grading" in item for item in manifest["supported_now"])
    assert any("live LLM/Codex" in item for item in manifest["unavailable_or_unproven"])
    assert any("real microphone audio" in item for item in manifest["unavailable_or_unproven"])
    assert any("production-hosted parity" in item for item in manifest["unavailable_or_unproven"])
    assert any("full all-surface mutation coverage" in item for item in manifest["unavailable_or_unproven"])


def _assert_capability_text_is_user_facing(text: str) -> None:
    for expected in [
        "Assistant",
        "Library",
        "Planner",
        "Review",
        "queued voice transcripts",
        "live microphone STT",
        "live LLM/Codex panel choice",
        "production-hosted parity",
        "full all-surface mutation coverage",
    ]:
        assert expected in text
    for raw_label in [
        "interview.review_grade",
        "interview.question_request",
        "request_due_date",
        "assistant_thread_voice",
        "tool_call",
        "tool_result",
    ]:
        assert raw_label not in text


def _assert_dynamic_tool_result(
    payload: dict,
    *,
    tool_name: str,
    renderer_key: str,
    structured_keys: set[str],
    ui_meta_keys: set[str],
) -> tuple[dict, dict]:
    tool_call = _assistant_tool_call(payload, tool_name)
    tool_result = _assistant_tool_result_for_call(payload, tool_call["id"])
    assert tool_result["tool_call_id"] == tool_call["id"]
    assert tool_result["renderer_key"] == renderer_key
    assert tool_result["renderer_version"] == 1
    assert tool_result["placement"] == "thread"
    assert structured_keys.issubset(tool_result["structured_content"])
    assert ui_meta_keys.issubset(tool_result["ui_meta"])
    return tool_call, tool_result


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


def test_assistant_snapshot_exposes_strategic_context_cards(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    goal = client.post(
        "/v1/goals",
        json={"title": "Make strategic context visible"},
        headers=auth_headers,
    ).json()
    project = client.post(
        "/v1/projects",
        json={"goal_id": goal["id"], "title": "Assistant context cards"},
        headers=auth_headers,
    ).json()
    commitment = client.post(
        "/v1/commitments",
        json={"source_type": "assistant", "title": "Check the Assistant rail"},
        headers=auth_headers,
    ).json()

    response = client.get("/v1/assistant/threads/primary", headers=auth_headers)

    assert response.status_code == 200
    context_cards = response.json()["context_cards"]
    assert [card["kind"] for card in context_cards] == ["goal_status", "project_status", "commitment_status"]
    assert context_cards[0]["metadata"]["goal_id"] == goal["id"]
    assert context_cards[0]["entity_ref"]["href"] is None
    assert context_cards[1]["metadata"]["project_id"] == project["id"]
    assert context_cards[1]["entity_ref"]["href"] is None
    assert context_cards[2]["metadata"]["commitment_id"] == commitment["id"]
    assert context_cards[2]["entity_ref"]["href"] is None

    with get_connection() as conn:
        thread = assistant_thread_service.get_thread(conn, "primary")
        runtime_request = assistant_run_service._build_runtime_request(  # noqa: SLF001
            conn,
            thread_id=thread["id"],
            content="What strategic context is active?",
            metadata={"surface": "assistant_web"},
        )

    runtime_context_cards = runtime_request["context"]["strategic_context_cards"]
    assert [card["kind"] for card in runtime_context_cards] == ["goal_status", "project_status", "commitment_status"]



def test_assistant_runtime_context_and_message_parts_validate_as_protocol_contract(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ai_runtime_service.AI_RUNTIME_BASE_ENV, raising=False)
    monkeypatch.setattr(
        ai_service,
        "execute_chat_turn",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected runtime turn")),
    )

    create_message = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "show me what UI actions you can take",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )
    assert create_message.status_code == 201
    payload = create_message.json()
    typed_snapshot = AssistantThreadSnapshot.model_validate(payload["snapshot"])
    assistant_message = payload["snapshot"]["messages"][-1]
    typed_parts = TypeAdapter(list[AssistantMessagePart]).validate_python(assistant_message["parts"])
    part_types = [part.type for part in typed_parts]
    assert {"text", "tool_call", "tool_result", "status"} <= set(part_types)

    with get_connection() as conn:
        thread = assistant_thread_service.get_thread(conn, "primary")
        runtime_request = assistant_run_service._build_runtime_request(  # noqa: SLF001
            conn,
            thread_id=thread["id"],
            content="Use this protocol context next.",
            metadata={"surface": "assistant_web", "client_timezone": "UTC"},
        )

    typed_runtime_request = AssistantRuntimeRequest.model_validate(runtime_request)
    assert typed_runtime_request.thread_id == typed_snapshot.id
    assert typed_runtime_request.context.thread.slug == "primary"
    assert typed_runtime_request.context.request_metadata["client_timezone"] == "UTC"
    assert typed_runtime_request.context.ui_capabilities.version == "starlog.dynamic_ui_capabilities.v1"
    assert any(
        message.role == "assistant" and "structured tool output" in message.content
        for message in typed_runtime_request.context.recent_messages
    )


def test_assistant_runtime_request_includes_recommendation_hints(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    hint_entity_id = new_id("card")
    with get_connection() as conn:
        thread = assistant_thread_service.get_thread(conn, "primary")
        memory_service.record_recommendation_event(
            conn,
            surface="briefing",
            signal_type="briefing_review",
            entity_type="card",
            entity_id=hint_entity_id,
            weight=1.0,
            metadata={"source": "runtime_test"},
        )
        assistant_hint_entity_id = new_id("card")
        memory_service.record_recommendation_event(
            conn,
            surface="assistant",
            signal_type="assistant_review",
            entity_type="card",
            entity_id=assistant_hint_entity_id,
            weight=1.0,
            metadata={"source": "runtime_test"},
        )
        briefing_hints = memory_service.list_recommendation_hints(conn, surface="briefing", limit=8)
        runtime_request = assistant_run_service._build_runtime_request(  # noqa: SLF001
            conn,
            thread_id=thread["id"],
            content="Any review signals available?",
            metadata={"surface": "assistant_web", "client_timezone": "UTC"},
        )

    assert [hint["entity_id"] for hint in briefing_hints] == [hint_entity_id]
    hints = runtime_request["context"]["recommendation_hints"]
    assert len(hints) == 2
    assert any(
        hint["entity_type"] == "card" and hint["entity_id"] == hint_entity_id and hint["surface"] == "briefing"
        for hint in hints
    )
    assert any(
        hint["entity_type"] == "card" and hint["entity_id"] == assistant_hint_entity_id and hint["surface"] == "assistant"
        for hint in hints
    )


def test_assistant_dynamic_ui_capabilities_are_structured_and_survive_reload(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ai_runtime_service.AI_RUNTIME_BASE_ENV, raising=False)
    monkeypatch.setattr(
        ai_service,
        "execute_chat_turn",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected runtime turn")),
    )

    payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="show me what UI actions you can take",
    )

    assert payload["run"]["status"] == "completed"
    assert payload["run"]["dynamic_ui_capabilities"]["version"] == "starlog.dynamic_ui_capabilities.v1"
    assert payload["run"]["metadata"]["ui_capabilities"]["version"] == "starlog.dynamic_ui_capabilities.v1"
    _assert_capability_manifest_covers_surface_limits(payload["run"]["dynamic_ui_capabilities"])
    _assert_capability_text_is_user_facing(_assistant_visible_text(payload))
    renderer_keys = {
        renderer["renderer_key"]
        for renderer in payload["run"]["dynamic_ui_capabilities"]["renderers"]
    }
    assert {"interview.topic_unlock", "interview.question_request", "interview.review_grade"} <= renderer_keys
    tool_call = _assistant_tool_call(payload, "list_dynamic_ui_capabilities")
    tool_result = _assistant_tool_result_for_call(payload, tool_call["id"])
    assert tool_result["output"]["version"] == "starlog.dynamic_ui_capabilities.v1"
    assert tool_result["structured_content"]["capabilities"]["version"] == "starlog.dynamic_ui_capabilities.v1"
    _assert_capability_manifest_covers_surface_limits(tool_result["output"])
    _assert_capability_manifest_covers_surface_limits(tool_result["structured_content"]["capabilities"])
    assert tool_result["ui_meta"] == {"tone": "system", "source": "backend_capability_registry"}
    assert "renderer_key" not in tool_result

    reloaded = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert reloaded.status_code == 200
    snapshot = reloaded.json()
    reloaded_run = next(run for run in snapshot["runs"] if run["id"] == payload["run"]["id"])
    assert reloaded_run["dynamic_ui_capabilities"]["version"] == "starlog.dynamic_ui_capabilities.v1"
    reloaded_result = next(
        part["tool_result"]
        for message in snapshot["messages"]
        for part in message["parts"]
        if part["type"] == "tool_result" and part["tool_result"]["tool_call_id"] == tool_call["id"]
    )
    assert reloaded_result["output"]["renderers"] == tool_result["output"]["renderers"]


def test_assistant_surface_capability_response_is_reachable_from_queued_voice_transcript(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ai_runtime_service.AI_RUNTIME_BASE_ENV, raising=False)
    monkeypatch.setattr(
        ai_service,
        "execute_chat_turn",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected runtime turn")),
    )

    queued = client.post(
        "/v1/assistant/threads/primary/voice",
        headers=auth_headers,
        files={"file": ("assistant-capabilities.webm", b"voice-bytes", "audio/webm")},
        data={
            "title": "Assistant capability voice question",
            "duration_ms": "1800",
            "device_target": "web-desktop",
            "provider_hint": "whisper_local",
            "metadata_json": json.dumps({"surface": "assistant_web", "submitted_via": "voice_recording"}),
        },
    )
    assert queued.status_code == 201
    job_id = queued.json()["id"]
    assert queued.json()["action"] == "assistant_thread_voice"

    claim = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "assistant-capability-voice-worker"},
        headers=auth_headers,
    )
    assert claim.status_code == 200

    transcript = "what app surfaces can you control and what are your limitations"
    complete = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "assistant-capability-voice-worker",
            "provider_used": "whisper_local",
            "output": {"transcript": transcript},
        },
        headers=auth_headers,
    )
    assert complete.status_code == 200
    assert complete.json()["output"]["assistant_thread"]["run_status"] == "completed"
    assert complete.json()["output"]["assistant_thread"]["transcript"] == transcript

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    thread_payload = snapshot.json()
    assistant_message = next(
        message
        for message in reversed(thread_payload["messages"])
        if message["role"] == "assistant"
        and message.get("metadata", {}).get("matched_intent") == "list_dynamic_ui_capabilities"
    )
    visible_text = "\n".join(
        part["text"] for part in assistant_message["parts"] if part["type"] == "text"
    )
    _assert_capability_text_is_user_facing(visible_text)

    tool_result = next(
        part["tool_result"]
        for part in assistant_message["parts"]
        if part["type"] == "tool_result"
    )
    _assert_capability_manifest_covers_surface_limits(tool_result["output"])
    assert tool_result["ui_meta"] == {"tone": "system", "source": "backend_capability_registry"}


def test_assistant_handoff_token_is_resolved_into_trusted_context(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    artifact_id = _create_test_artifact(title="Helper handoff artifact")

    create_handoff = client.post(
        "/v1/assistant/handoffs",
        json={
            "source_surface": "desktop_helper",
            "artifact_id": artifact_id,
            "draft": "Help me process this helper capture.",
        },
        headers=auth_headers,
    )
    assert create_handoff.status_code == 201
    handoff_payload = create_handoff.json()
    handoff_token = handoff_payload["token"]

    resolve_handoff = client.get(
        f"/v1/assistant/handoffs/resolve?token={handoff_token}",
        headers=auth_headers,
    )
    assert resolve_handoff.status_code == 200
    assert resolve_handoff.json()["handoff"] == {
        "source": "desktop_helper",
        "artifact_id": artifact_id,
        "draft": "Help me process this helper capture.",
    }

    create_message = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "create task Trusted helper handoff task",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {
                "surface": "assistant_web",
                "client_timezone": "UTC",
                "handoff_token": handoff_token,
                "handoff_context": {
                    "source": "desktop_helper",
                    "artifact_id": "art_forged",
                    "draft": "Forged helper context",
                },
            },
        },
        headers=auth_headers,
    )
    assert create_message.status_code == 201
    request_metadata = create_message.json()["user_message"]["metadata"]["request_metadata"]
    assert request_metadata["surface"] == "assistant_web"
    assert request_metadata["handoff_context"] == {
        "source": "desktop_helper",
        "artifact_id": artifact_id,
        "draft": "Help me process this helper capture.",
    }
    assert "handoff_token" not in request_metadata


def test_assistant_runtime_turn_prefers_native_parts_from_handoff_context(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    artifact_id = _create_test_artifact(title="Runtime helper handoff artifact")

    create_handoff = client.post(
        "/v1/assistant/handoffs",
        json={
            "source_surface": "desktop_helper",
            "artifact_id": artifact_id,
            "draft": "Help me process this helper capture.",
        },
        headers=auth_headers,
    )
    assert create_handoff.status_code == 201
    handoff_token = create_handoff.json()["token"]

    create_message = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "What should I do with this?",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {
                "surface": "assistant_web",
                "client_timezone": "UTC",
                "handoff_token": handoff_token,
            },
        },
        headers=auth_headers,
    )

    assert create_message.status_code == 201
    assistant_message = create_message.json()["assistant_message"]
    card_parts = [part for part in assistant_message["parts"] if part["type"] == "card"]
    assert any(part["card"]["kind"] == "capture_item" for part in card_parts)
    assert any(part["type"] == "status" and part["status"] == "complete" for part in assistant_message["parts"])
    capture_card = next(part["card"] for part in card_parts if part["card"]["kind"] == "capture_item")
    assert capture_card["metadata"]["projection"] == "runtime_handoff"
    assert capture_card["metadata"]["artifact_id"] == artifact_id


def test_assistant_runtime_turn_emits_tool_result_part_for_recent_trace(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    create_card = client.post(
        "/v1/cards",
        json={
            "prompt": "Explain spaced repetition.",
            "answer": "Active recall over time.",
            "card_type": "qa",
            "due_at": (utc_now() - timedelta(hours=1)).isoformat(),
        },
        headers=auth_headers,
    )
    assert create_card.status_code == 201

    seed_trace = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "load due cards",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )
    assert seed_trace.status_code == 201

    runtime_turn = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "What should I focus on next?",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )
    assert runtime_turn.status_code == 201

    assistant_message = runtime_turn.json()["assistant_message"]
    tool_call_part = next(part for part in assistant_message["parts"] if part["type"] == "tool_call")
    assert tool_call_part["tool_call"]["tool_name"] == "list_due_cards"
    assert tool_call_part["tool_call"]["status"] == "complete"
    assert tool_call_part["tool_call"]["metadata"]["projection"] == "runtime_recent_trace"
    tool_result_part = next(part for part in assistant_message["parts"] if part["type"] == "tool_result")
    assert tool_result_part["tool_result"]["tool_call_id"] == tool_call_part["tool_call"]["id"]
    assert tool_result_part["tool_result"]["metadata"]["projection"] == "runtime_recent_trace"
    assert tool_result_part["tool_result"]["metadata"]["tool_name"] == "list_due_cards"
    assert tool_result_part["tool_result"]["card"]["kind"] == "review_queue"
    message_cards = assistant_message.get("cards", [])
    assert not any(card["kind"] == "assistant_summary" for card in message_cards)

    with get_connection() as conn:
        trace_row = conn.execute(
            """
            SELECT result_json
            FROM conversation_tool_traces
            WHERE tool_name = 'chat_turn_runtime'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
    assert trace_row is not None
    trace_result = trace_row["result_json"]
    if isinstance(trace_result, str):
        trace_result = json.loads(trace_result)
    trace_cards = trace_result["cards"]
    assert any(card["kind"] == "review_queue" for card in trace_cards)


def test_assistant_runtime_turn_stays_local_when_ai_runtime_env_started_bogus(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert os.environ.get(ai_runtime_service.AI_RUNTIME_BASE_ENV) is None

    def fail_runtime_http(*_args, **_kwargs):
        raise AssertionError("assistant API test attempted AI runtime HTTP")

    monkeypatch.setattr(ai_runtime_service, "urlopen", fail_runtime_http)

    runtime_turn = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "What should I focus on next?",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )

    assert runtime_turn.status_code == 201
    payload = runtime_turn.json()
    assert payload["run"]["status"] == "completed"
    assert payload["assistant_message"]["metadata"]["chat_turn"]["provider_used"] == "local_prompt_preview"


def test_assistant_primary_study_read_command_unblocks_gated_due_card(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ai_runtime_service.AI_RUNTIME_BASE_ENV, raising=False)
    monkeypatch.setattr(ai_service, "execute_chat_turn", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected runtime turn")))
    card = _create_assistant_due_card(client, auth_headers, prompt="BFS gated Assistant card")
    _source, topic = _create_assistant_study_source_and_topic(
        client,
        auth_headers,
        source_title="Graph Algorithms",
        topic_title="Breadth-first search",
    )
    link_response = client.post(
        "/v1/study/card-topic-links",
        json={"card_id": card["id"], "topic_id": topic["id"], "gate_required": True},
        headers=auth_headers,
    )
    assert link_response.status_code == 201

    due_before_read = client.get("/v1/cards/due", headers=auth_headers)
    assert due_before_read.status_code == 200
    assert card["id"] not in {item["id"] for item in due_before_read.json()}

    payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="I read Breadth-first search",
    )

    assert payload["run"]["status"] == "completed"
    assert payload["assistant_message"]["status"] == "complete"
    assistant_command = payload["assistant_message"]["metadata"]["assistant_command"]
    assert assistant_command["matched_intent"] == "mark_study_topic_read"
    assert assistant_command["status"] == "executed"
    tool_call, tool_result = _assert_dynamic_tool_result(
        payload,
        tool_name="mark_study_topic_read",
        renderer_key="interview.topic_unlock",
        structured_keys={"topic", "topic_id", "topic_title", "unlock_reason"},
        ui_meta_keys={"tone", "action", "status", "source_id"},
    )
    assert tool_call["status"] == "complete"
    assert tool_call["arguments"]["topic_id"] == topic["id"]
    assert tool_result["status"] == "complete"
    assert tool_result["structured_content"]["topic"]["id"] == topic["id"]
    assert tool_result["ui_meta"]["source_id"] == topic["source_id"]
    assert tool_result["output"]["topic"]["id"] == topic["id"]
    assert tool_result["output"]["topic"]["status"] == "read"

    due_after_read = client.get("/v1/cards/due", headers=auth_headers)
    assert due_after_read.status_code == 200
    assert card["id"] in {item["id"] for item in due_after_read.json()}


def test_assistant_primary_study_unlock_command_is_visible_and_executes(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ai_runtime_service.AI_RUNTIME_BASE_ENV, raising=False)
    monkeypatch.setattr(ai_service, "execute_chat_turn", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected runtime turn")))
    _source, topic = _create_assistant_study_source_and_topic(
        client,
        auth_headers,
        source_title="Neetcode",
        topic_title="Sliding Window",
    )

    payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="unlock Neetcode sliding window drills",
    )

    assert payload["run"]["status"] == "completed"
    assistant_command = payload["assistant_message"]["metadata"]["assistant_command"]
    assert assistant_command["matched_intent"] == "unlock_study_topic"
    assert assistant_command["status"] == "executed"
    tool_call, tool_result = _assert_dynamic_tool_result(
        payload,
        tool_name="unlock_study_topic",
        renderer_key="interview.topic_unlock",
        structured_keys={"topic", "topic_id", "topic_title", "unlock_reason"},
        ui_meta_keys={"tone", "action", "status", "source_id"},
    )
    assert tool_call["status"] == "complete"
    assert tool_call["arguments"]["topic_id"] == topic["id"]
    assert tool_result["structured_content"]["topic"]["id"] == topic["id"]
    assert tool_result["output"]["topic"]["status"] == "unlocked"
    assert tool_result["output"]["topic"]["manually_unlocked"] is True


def test_assistant_primary_study_quiz_command_is_visible_and_creates_request(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ai_runtime_service.AI_RUNTIME_BASE_ENV, raising=False)
    monkeypatch.setattr(ai_service, "execute_chat_turn", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected runtime turn")))
    source, _topic = _create_assistant_study_source_and_topic(
        client,
        auth_headers,
        source_title="Interview Prep",
        topic_title="Embeddings",
    )

    payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="quiz me on application questions for embeddings",
    )

    assert payload["run"]["status"] == "completed"
    assistant_command = payload["assistant_message"]["metadata"]["assistant_command"]
    assert assistant_command["matched_intent"] == "create_study_question_request"
    assert assistant_command["status"] == "executed"
    tool_call, tool_result = _assert_dynamic_tool_result(
        payload,
        tool_name="create_study_question_request",
        renderer_key="interview.question_request",
        structured_keys={"request", "source_id", "topic_id", "question_type", "prompt"},
        ui_meta_keys={"tone", "request_id", "question_preference"},
    )
    assert tool_call["status"] == "complete"
    request = tool_result["output"]["request"]
    assert tool_result["structured_content"]["request"]["id"] == request["id"]
    assert tool_result["ui_meta"]["question_preference"] == "application"
    assert request["source_id"] == source["id"]
    assert request["question"] == "Quiz me on application questions for Embeddings"
    assert request["response"]["question_preference"] == "application"
    with get_connection() as conn:
        row = conn.execute(
            "SELECT source_id, question, response_json FROM study_question_requests WHERE id = ?",
            (request["id"],),
        ).fetchone()

    assert row is not None
    assert row["source_id"] == source["id"]
    assert row["question"] == "Quiz me on application questions for Embeddings"
    assert json.loads(row["response_json"])["question_preference"] == "application"


def test_assistant_interview_prep_dynamic_ui_loop_accepts_natural_phrases_and_reloads(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ai_runtime_service.AI_RUNTIME_BASE_ENV, raising=False)
    monkeypatch.setattr(ai_service, "execute_chat_turn", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected runtime turn")))
    source, topic = _create_assistant_study_source_and_topic(
        client,
        auth_headers,
        source_title="Neetcode",
        topic_title="Sliding Window",
    )

    read_payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="unlock/read Sliding Window",
    )

    assert read_payload["run"]["status"] == "completed"
    read_command = read_payload["assistant_message"]["metadata"]["assistant_command"]
    assert read_command["matched_intent"] == "mark_study_topic_read"
    read_tool_call, read_tool_result = _assert_dynamic_tool_result(
        read_payload,
        tool_name="mark_study_topic_read",
        renderer_key="interview.topic_unlock",
        structured_keys={"topic", "topic_id", "topic_title", "unlock_reason"},
        ui_meta_keys={"tone", "action", "status", "source_id"},
    )
    assert read_tool_result["structured_content"]["topic_id"] == topic["id"]
    assert read_tool_result["output"]["topic"]["status"] == "read"

    quiz_payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="quiz me with application questions",
    )

    assert quiz_payload["run"]["status"] == "completed"
    quiz_command = quiz_payload["assistant_message"]["metadata"]["assistant_command"]
    assert quiz_command["matched_intent"] == "create_study_question_request"
    quiz_tool_call, quiz_tool_result = _assert_dynamic_tool_result(
        quiz_payload,
        tool_name="create_study_question_request",
        renderer_key="interview.question_request",
        structured_keys={"request", "source_id", "topic_id", "question_type", "prompt"},
        ui_meta_keys={"tone", "request_id", "question_preference"},
    )
    request = quiz_tool_result["output"]["request"]
    assert quiz_tool_result["structured_content"]["topic_id"] == topic["id"]
    assert quiz_tool_result["structured_content"]["source_id"] == source["id"]
    assert quiz_tool_result["ui_meta"]["question_preference"] == "application"
    assert request["question"] == "Quiz me on application questions for Sliding Window"

    reloaded = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert reloaded.status_code == 200
    snapshot = reloaded.json()
    reloaded_read_result = next(
        part["tool_result"]
        for message in snapshot["messages"]
        for part in message["parts"]
        if part["type"] == "tool_result" and part["tool_result"]["tool_call_id"] == read_tool_call["id"]
    )
    assert reloaded_read_result["renderer_key"] == "interview.topic_unlock"
    assert reloaded_read_result["structured_content"]["topic_id"] == topic["id"]
    reloaded_quiz_result = next(
        part["tool_result"]
        for message in snapshot["messages"]
        for part in message["parts"]
        if part["type"] == "tool_result" and part["tool_result"]["tool_call_id"] == quiz_tool_call["id"]
    )
    assert reloaded_quiz_result["renderer_key"] == "interview.question_request"
    assert reloaded_quiz_result["structured_content"]["topic_id"] == topic["id"]
    assert reloaded_quiz_result["ui_meta"]["question_preference"] == "application"


def test_assistant_interview_loop_records_study_review_and_recommendation_signals(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ai_runtime_service.AI_RUNTIME_BASE_ENV, raising=False)
    monkeypatch.setattr(ai_service, "execute_chat_turn", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected runtime turn")))
    source, topic = _create_assistant_study_source_and_topic(
        client,
        auth_headers,
        source_title="Interview Prep",
        topic_title="Sliding Window",
    )
    card = _create_assistant_due_card(
        client,
        auth_headers,
        prompt="When should a sliding window shrink?",
        card_type="application",
    )
    link_response = client.post(
        "/v1/study/card-topic-links",
        json={"card_id": card["id"], "topic_id": topic["id"], "gate_required": True},
        headers=auth_headers,
    )
    assert link_response.status_code == 201

    due_before_read = client.get("/v1/cards/due", headers=auth_headers)
    assert due_before_read.status_code == 200
    assert card["id"] not in {item["id"] for item in due_before_read.json()}

    read_payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="unlock/read Sliding Window",
    )
    read_command = read_payload["assistant_message"]["metadata"]["assistant_command"]
    assert read_command["matched_intent"] == "mark_study_topic_read"
    _read_tool_call, read_tool_result = _assert_dynamic_tool_result(
        read_payload,
        tool_name="mark_study_topic_read",
        renderer_key="interview.topic_unlock",
        structured_keys={"topic", "topic_id", "topic_title", "unlock_reason"},
        ui_meta_keys={"tone", "action", "status", "source_id"},
    )
    assert read_tool_result["structured_content"]["topic_id"] == topic["id"]
    assert read_tool_result["output"]["topic"]["status"] == "read"

    progress_after_read = client.get("/v1/study/progress", headers=auth_headers)
    assert progress_after_read.status_code == 200
    assert progress_after_read.json()["read_topic_count"] == 1
    assert progress_after_read.json()["due_unlocked_card_count"] == 1
    due_after_read = client.get("/v1/cards/due", headers=auth_headers)
    assert due_after_read.status_code == 200
    assert card["id"] in {item["id"] for item in due_after_read.json()}

    quiz_payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="quiz me with application questions",
    )
    quiz_command = quiz_payload["assistant_message"]["metadata"]["assistant_command"]
    assert quiz_command["matched_intent"] == "create_study_question_request"
    _quiz_tool_call, quiz_tool_result = _assert_dynamic_tool_result(
        quiz_payload,
        tool_name="create_study_question_request",
        renderer_key="interview.question_request",
        structured_keys={"request", "source_id", "topic_id", "question_type", "prompt"},
        ui_meta_keys={"tone", "request_id", "question_preference"},
    )
    request = quiz_tool_result["output"]["request"]
    assert quiz_tool_result["structured_content"]["topic_id"] == topic["id"]
    assert quiz_tool_result["ui_meta"]["question_preference"] == "application"
    assert request["source_id"] == source["id"]
    assert request["topic_id"] == topic["id"]
    assert request["response"]["question_preference"] == "application"

    briefing = client.post(
        "/v1/briefings/generate",
        json={"date": "2026-05-19", "provider": "template"},
        headers=auth_headers,
    )
    assert briefing.status_code == 201
    review_hints = [
        hint
        for hint in briefing.json()["recommendation_hints"]
        if hint["signal_type"] == "briefing_review"
    ]
    assert any(hint["entity_type"] == "card" and hint["entity_id"] == card["id"] for hint in review_hints)

    reveal = client.post(
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
    assert reveal.status_code == 201
    interrupt = next(item for item in reveal.json()["interrupts"] if item["tool_name"] == "grade_review_recall")
    assert interrupt["renderer_key"] == "interview.review_grade"
    assert interrupt["structured_content"]["card_id"] == card["id"]
    assert interrupt["ui_meta"]["review_mode"] == "application"

    submit = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"rating": "1", "latency_ms": "1500"}},
        headers=auth_headers,
    )
    assert submit.status_code == 200
    review_grade_results = [
        part["tool_result"]
        for message in submit.json()["messages"]
        for part in message["parts"]
        if part["type"] == "tool_result" and part["tool_result"].get("renderer_key") == "interview.review_grade"
    ]
    assert review_grade_results[-1]["structured_content"]["card_id"] == card["id"]
    assert review_grade_results[-1]["structured_content"]["grade"] == "1"
    assert review_grade_results[-1]["ui_meta"]["review_mode"] == "application"

    with get_connection() as conn:
        persisted_request = conn.execute(
            "SELECT topic_id, source_id, response_json FROM study_question_requests WHERE id = ?",
            (request["id"],),
        ).fetchone()
        review_event = conn.execute(
            "SELECT rating, latency_ms FROM review_events WHERE card_id = ?",
            (card["id"],),
        ).fetchone()
        reviewed_event = conn.execute(
            "SELECT payload_json FROM domain_events WHERE event_type = 'card.reviewed'",
        ).fetchone()
        recommendation_event = conn.execute(
            """
            SELECT signal_type, entity_type, entity_id
            FROM recommendation_events
            WHERE signal_type = 'briefing_review' AND entity_id = ?
            """,
            (card["id"],),
        ).fetchone()

    assert persisted_request is not None
    assert persisted_request["topic_id"] == topic["id"]
    assert persisted_request["source_id"] == source["id"]
    assert json.loads(persisted_request["response_json"])["question_preference"] == "application"
    assert review_event is not None
    assert review_event["rating"] == 1
    assert review_event["latency_ms"] == 1500
    assert reviewed_event is not None
    assert json.loads(reviewed_event["payload_json"])["review_mode"] == "application"
    assert recommendation_event is not None
    assert recommendation_event["entity_type"] == "card"

    review_summary = client.get("/v1/surfaces/review/summary", headers=auth_headers)
    assert review_summary.status_code == 200
    assert review_summary.json()["queue_health"]["reviewed_today_count"] == 1
    assert review_summary.json()["queue_health"]["average_latency_ms"] == 1500
    assistant_today = client.get(
        f"/v1/surfaces/assistant/today?date={utc_now().date().isoformat()}",
        headers=auth_headers,
    )
    assert assistant_today.status_code == 200
    assert "1 briefing review recommendation available" in assistant_today.json()["reason_stack"]


def test_assistant_interview_loop_gates_unread_signals_and_surfaces_low_grade_reason(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ai_runtime_service.AI_RUNTIME_BASE_ENV, raising=False)
    monkeypatch.setattr(ai_service, "execute_chat_turn", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected runtime turn")))
    source, topic = _create_assistant_study_source_and_topic(
        client,
        auth_headers,
        source_title="Interview Prep",
        topic_title="Sliding Window",
    )
    study_card = _create_assistant_due_card(
        client,
        auth_headers,
        prompt="How do you decide when a sliding window should shrink?",
        card_type="application",
    )
    plain_card = _create_assistant_due_card(
        client,
        auth_headers,
        prompt="What is a hash map?",
        card_type="qa",
    )
    low_grade_peer = _create_assistant_due_card(
        client,
        auth_headers,
        prompt="When is a fixed-size window appropriate?",
        card_type="application",
    )
    for card_id in {study_card["id"], low_grade_peer["id"]}:
        link_response = client.post(
            "/v1/study/card-topic-links",
            json={"card_id": card_id, "topic_id": topic["id"], "gate_required": True},
            headers=auth_headers,
        )
        assert link_response.status_code == 201

    quiz_payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="quiz me on application questions for sliding window",
    )

    quiz_tool_call, quiz_tool_result = _assert_dynamic_tool_result(
        quiz_payload,
        tool_name="create_study_question_request",
        renderer_key="interview.question_request",
        structured_keys={"request", "source_id", "topic_id", "question_type", "prompt"},
        ui_meta_keys={"tone", "request_id", "question_preference"},
    )
    request = quiz_tool_result["output"]["request"]
    assert request["source_id"] == source["id"]
    assert request["topic_id"] == topic["id"]
    assert quiz_tool_result["tool_call_id"] == quiz_tool_call["id"]
    assert quiz_tool_result["structured_content"]["request"]["id"] == request["id"]

    due_before_read = client.get("/v1/cards/due?limit=5", headers=auth_headers)
    assert due_before_read.status_code == 200
    due_before_read_ids = [item["id"] for item in due_before_read.json()]
    assert plain_card["id"] in due_before_read_ids
    assert study_card["id"] not in due_before_read_ids
    assert low_grade_peer["id"] not in due_before_read_ids

    review_before_read = client.get("/v1/surfaces/review/summary", headers=auth_headers)
    assert review_before_read.status_code == 200
    review_before_payload = review_before_read.json()
    assert review_before_payload["queue_health"]["due_count"] == 1
    ladder_counts_before_read = {bucket["key"]: bucket["count"] for bucket in review_before_payload["ladder_counts"]}
    assert ladder_counts_before_read["recall"] == 1
    assert ladder_counts_before_read["application"] == 0
    assert ladder_counts_before_read["synthesis"] == 0
    assert ladder_counts_before_read["judgment"] == 0
    assistant_today_before_read = client.get(
        f"/v1/surfaces/assistant/today?date={utc_now().date().isoformat()}",
        headers=auth_headers,
    )
    assert assistant_today_before_read.status_code == 200
    assert "1 study-loop review card due" not in assistant_today_before_read.json()["reason_stack"]

    read_payload = _post_assistant_study_command(
        client,
        auth_headers,
        content="unlock/read Sliding Window",
    )
    read_tool_call, read_tool_result = _assert_dynamic_tool_result(
        read_payload,
        tool_name="mark_study_topic_read",
        renderer_key="interview.topic_unlock",
        structured_keys={"topic", "topic_id", "topic_title", "unlock_reason"},
        ui_meta_keys={"tone", "action", "status", "source_id"},
    )
    assert read_tool_result["tool_call_id"] == read_tool_call["id"]
    assert read_tool_result["structured_content"]["topic_id"] == topic["id"]
    assert read_tool_result["output"]["topic"]["status"] == "read"

    due_after_read = client.get("/v1/cards/due?limit=5", headers=auth_headers)
    assert due_after_read.status_code == 200
    due_after_read_ids = [item["id"] for item in due_after_read.json()]
    assert set(due_after_read_ids[:2]) == {study_card["id"], low_grade_peer["id"]}
    assert due_after_read_ids.index(plain_card["id"]) > due_after_read_ids.index(study_card["id"])
    assert due_after_read_ids.index(plain_card["id"]) > due_after_read_ids.index(low_grade_peer["id"])
    assistant_today_after_read = client.get(
        f"/v1/surfaces/assistant/today?date={utc_now().date().isoformat()}",
        headers=auth_headers,
    )
    assert assistant_today_after_read.status_code == 200
    assert "2 study-loop review cards due" in assistant_today_after_read.json()["reason_stack"]

    reveal = client.post(
        "/v1/assistant/threads/primary/events",
        json={
            "source_surface": "review",
            "kind": "review.answer.revealed",
            "entity_ref": {
                "entity_type": "card",
                "entity_id": study_card["id"],
                "href": "/review",
                "title": study_card["prompt"],
            },
            "payload": {
                "card_id": study_card["id"],
                "prompt": study_card["prompt"],
                "card_type": study_card["card_type"],
            },
            "visibility": "assistant_message",
        },
        headers=auth_headers,
    )
    assert reveal.status_code == 201
    interrupt = next(item for item in reveal.json()["interrupts"] if item["tool_name"] == "grade_review_recall")
    assert interrupt["tool_call_id"]
    assert interrupt["renderer_key"] == "interview.review_grade"
    assert interrupt["structured_content"]["card_id"] == study_card["id"]
    assert interrupt["ui_meta"]["review_mode"] == "application"

    submit = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"rating": "1", "latency_ms": "1500"}},
        headers=auth_headers,
    )
    assert submit.status_code == 200
    review_grade_result = next(
        part["tool_result"]
        for message in reversed(submit.json()["messages"])
        for part in message["parts"]
        if part["type"] == "tool_result" and part["tool_result"].get("renderer_key") == "interview.review_grade"
    )
    assert review_grade_result["tool_call_id"] == interrupt["tool_call_id"]
    assert review_grade_result["structured_content"]["card_id"] == study_card["id"]
    assert review_grade_result["structured_content"]["grade"] == "1"
    assert review_grade_result["ui_meta"]["review_mode"] == "application"

    peer_review = client.post(
        "/v1/reviews",
        json={"card_id": low_grade_peer["id"], "rating": 1, "latency_ms": 1200},
        headers=auth_headers,
    )
    assert peer_review.status_code == 201

    review_after_low_grades = client.get("/v1/surfaces/review/summary", headers=auth_headers)
    assert review_after_low_grades.status_code == 200
    recommended_drill = review_after_low_grades.json()["recommended_drill"]
    assert recommended_drill == {
        "mode": "application",
        "title": "Application drill",
        "body": "Practice cards with 2 recent low ratings before returning to the full queue.",
        "prompt": "Start an application drill from cards I recently rated low.",
        "reason": "2 recent low ratings on application cards.",
        "enabled": True,
    }


def test_assistant_runtime_turn_emits_task_tool_result_for_recent_task_trace(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    seed_trace = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "create task Review runtime migration due tomorrow priority 4",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )
    assert seed_trace.status_code == 201

    runtime_turn = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "What just changed?",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )
    assert runtime_turn.status_code == 201

    assistant_message = runtime_turn.json()["assistant_message"]
    tool_call_part = next(part for part in assistant_message["parts"] if part["type"] == "tool_call")
    assert tool_call_part["tool_call"]["tool_name"] == "create_task"
    assert tool_call_part["tool_call"]["status"] == "complete"
    tool_result_part = next(part for part in assistant_message["parts"] if part["type"] == "tool_result")
    assert tool_result_part["tool_result"]["tool_call_id"] == tool_call_part["tool_call"]["id"]
    assert tool_result_part["tool_result"]["metadata"]["tool_name"] == "create_task"
    assert tool_result_part["tool_result"]["card"]["kind"] == "task_list"
    message_cards = assistant_message.get("cards", [])
    assert not any(card["kind"] == "assistant_summary" for card in message_cards)

    with get_connection() as conn:
        thread = assistant_thread_service.get_thread(conn, "primary")
        runtime_request = assistant_run_service._build_runtime_request(  # noqa: SLF001
            conn,
            thread_id=thread["id"],
            content="What just changed next?",
            metadata={"surface": "assistant_web", "client_timezone": "UTC"},
        )
    recent_message_cards = runtime_request["context"]["recent_messages"][-1]["cards"]
    assert any(card["kind"] == "task_list" for card in recent_message_cards)


def test_assistant_handoff_rejects_artifact_source_mismatch(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    artifact_id = _create_test_artifact(
        title="Manual artifact",
        source_type="clip_manual",
        metadata={"capture": {"capture_source": "manual_entry"}},
    )

    create_handoff = client.post(
        "/v1/assistant/handoffs",
        json={
            "source_surface": "desktop_helper",
            "artifact_id": artifact_id,
            "draft": "Pretend this came from the helper.",
        },
        headers=auth_headers,
    )
    assert create_handoff.status_code == 400
    assert "source_surface=library" in create_handoff.text


def test_untrusted_client_handoff_context_is_stripped_without_token(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    create_message = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "create task Ignore forged helper context",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {
                "surface": "assistant_web",
                "client_timezone": "UTC",
                "handoff_context": {
                    "source": "desktop_helper",
                    "artifact_id": "art_forged",
                    "draft": "Forged helper context",
                },
            },
        },
        headers=auth_headers,
    )
    assert create_message.status_code == 201
    request_metadata = create_message.json()["user_message"]["metadata"]["request_metadata"]
    assert request_metadata["surface"] == "assistant_web"
    assert "handoff_context" not in request_metadata


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

    with get_connection() as conn:
        task_count = conn.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE title = ?",
            ("Review the diffusion notes",),
        ).fetchone()["count"]
        step = conn.execute(
            """
            SELECT message_id, result_json
            FROM conversation_run_steps
            WHERE interrupt_id = ? AND tool_name = 'create_task' AND status = 'completed'
            """,
            (interrupt["id"],),
        ).fetchone()
        trace_count = conn.execute(
            "SELECT COUNT(*) AS count FROM conversation_tool_traces WHERE metadata_json LIKE ?",
            (f'%"resolved_from_interrupt": "{interrupt["id"]}"%',),
        ).fetchone()["count"]
    assert task_count == 1
    assert step is not None
    assert step["message_id"] in {message["id"] for message in snapshot["messages"]}
    assert trace_count == 1

    duplicate = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"due_date": "2026-04-22", "priority": "4", "create_time_block": False, "client_timezone": "America/Los_Angeles"}},
        headers=auth_headers,
    )
    assert duplicate.status_code == 200
    assert len(duplicate.json()["messages"]) == len(snapshot["messages"])
    with get_connection() as conn:
        assert conn.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE title = ?",
            ("Review the diffusion notes",),
        ).fetchone()["count"] == 1
        assert conn.execute(
            "SELECT COUNT(*) AS count FROM conversation_run_steps WHERE interrupt_id = ? AND tool_name = 'create_task'",
            (interrupt["id"],),
        ).fetchone()["count"] == 1

    legacy = client.get("/v1/conversations/primary", headers=auth_headers)
    assert legacy.status_code == 200
    legacy_payload = legacy.json()
    assert any(message["content"] == "create task Review the diffusion notes" for message in legacy_payload["messages"])



def test_runtime_due_date_interrupt_submit_uses_next_step_and_preserves_pending_run(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    def mock_chat_turn(request: dict) -> dict:
        return {
            "workflow": "chat_turn",
            "provider_used": "mock_runtime",
            "model": "mock-multi-interrupt",
            "response_text": "I need dates for both tasks.",
            "parts": [assistant_projection_service.text_part("I need dates for both tasks.")],
            "interrupts": [
                {
                    "tool_call_id": "toolcall_runtime_first_due_date",
                    "tool_name": "request_due_date",
                    "interrupt_type": "form",
                    "title": "First task details",
                    "body": "Pick a due date for the first task.",
                    "primary_label": "Create task",
                    "fields": [
                        {"id": "due_date", "kind": "date", "label": "Due date", "required": True}
                    ],
                    "entity_ref": {
                        "entity_type": "task",
                        "entity_id": "draft:Runtime first task",
                        "title": "Runtime first task",
                    },
                    "metadata": {
                        "planned_tool_name": "create_task",
                        "planned_arguments": {"title": "Runtime first task", "priority": 2},
                    },
                },
                {
                    "tool_call_id": "toolcall_runtime_second_due_date",
                    "tool_name": "request_due_date",
                    "interrupt_type": "form",
                    "title": "Second task details",
                    "body": "Pick a due date for the second task.",
                    "primary_label": "Create task",
                    "fields": [
                        {"id": "due_date", "kind": "date", "label": "Due date", "required": True}
                    ],
                    "entity_ref": {
                        "entity_type": "task",
                        "entity_id": "draft:Runtime second task",
                        "title": "Runtime second task",
                    },
                    "metadata": {
                        "planned_tool_name": "create_task",
                        "planned_arguments": {"title": "Runtime second task", "priority": 3},
                    },
                },
            ],
        }

    monkeypatch.setattr(ai_service, "execute_chat_turn", mock_chat_turn)

    create = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "help me schedule both runtime followups",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )

    assert create.status_code == 201
    payload = create.json()
    run_id = payload["run"]["id"]
    assert payload["run"]["status"] == "interrupted"
    pending = [
        item
        for item in payload["snapshot"]["interrupts"]
        if item["run_id"] == run_id and item["status"] == "pending"
    ]
    assert len(pending) == 2

    first_interrupt = next(
        item for item in pending if item["tool_call_id"] == "toolcall_runtime_first_due_date"
    )
    submit_first = client.post(
        f"/v1/assistant/interrupts/{first_interrupt['id']}/submit",
        json={"values": {"due_date": "2026-05-22", "priority": "2", "client_timezone": "UTC"}},
        headers=auth_headers,
    )

    assert submit_first.status_code == 200
    first_snapshot = submit_first.json()
    run_after_first_submit = next(run for run in first_snapshot["runs"] if run["id"] == run_id)
    assert run_after_first_submit["status"] == "interrupted"
    assert run_after_first_submit["current_interrupt"] is not None
    assert run_after_first_submit["current_interrupt"]["id"] != first_interrupt["id"]
    assert run_after_first_submit["current_interrupt"]["status"] == "pending"
    assert (
        next(item for item in first_snapshot["interrupts"] if item["id"] == first_interrupt["id"])[
            "status"
        ]
        == "submitted"
    )
    assert [step["step_index"] for step in run_after_first_submit["steps"]] == [0, 1, 2, 3]
    assert [step["tool_name"] for step in run_after_first_submit["steps"]] == [
        "request_due_date",
        "request_due_date",
        "chat_turn_runtime",
        "create_task",
    ]

    second_interrupt = run_after_first_submit["current_interrupt"]
    submit_second = client.post(
        f"/v1/assistant/interrupts/{second_interrupt['id']}/submit",
        json={"values": {"due_date": "2026-05-23", "priority": "3", "client_timezone": "UTC"}},
        headers=auth_headers,
    )

    assert submit_second.status_code == 200
    final_snapshot = submit_second.json()
    completed_run = next(run for run in final_snapshot["runs"] if run["id"] == run_id)
    assert completed_run["status"] == "completed"
    assert completed_run["current_interrupt"] is None
    assert [step["step_index"] for step in completed_run["steps"]] == [0, 1, 2, 3, 4]


def test_assistant_due_date_interrupt_dismiss_records_protocol_resolution(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    create = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "create task Decide whether to file the draft",
            "input_mode": "text",
            "device_target": "web-desktop",
            "metadata": {"surface": "assistant_web", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )
    assert create.status_code == 201
    payload = create.json()
    run_id = payload["run"]["id"]
    interrupt = payload["run"]["current_interrupt"]
    assert payload["run"]["status"] == "interrupted"
    assert interrupt is not None
    assert interrupt["status"] == "pending"

    dismiss = client.post(f"/v1/assistant/interrupts/{interrupt['id']}/dismiss", headers=auth_headers)
    assert dismiss.status_code == 200
    snapshot = dismiss.json()
    typed_snapshot = AssistantThreadSnapshot.model_validate(snapshot)

    dismissed_interrupt = next(item for item in typed_snapshot.interrupts if item.id == interrupt["id"])
    assert dismissed_interrupt.status == "dismissed"
    assert dismissed_interrupt.resolution["action"] == "dismiss"
    assert dismissed_interrupt.resolution["values"] == {}

    cancelled_run = next(run for run in typed_snapshot.runs if run.id == run_id)
    assert cancelled_run.status == "cancelled"
    assert cancelled_run.current_interrupt is None

    resolution_part = next(
        part
        for message in snapshot["messages"]
        if message.get("run_id") == run_id and message["role"] == "assistant"
        for part in TypeAdapter(list[AssistantMessagePart]).validate_python(message["parts"])
        if part.type == "interrupt_resolution"
    )
    assert resolution_part.resolution["interrupt_id"] == interrupt["id"]
    assert resolution_part.resolution["action"] == "dismiss"

    duplicate = client.post(f"/v1/assistant/interrupts/{interrupt['id']}/dismiss", headers=auth_headers)
    assert duplicate.status_code == 200
    assert len(duplicate.json()["messages"]) == len(snapshot["messages"])
    with get_connection() as conn:
        assert conn.execute(
            "SELECT COUNT(*) AS count FROM conversation_run_steps WHERE run_id = ? AND title = 'Run failed'",
            (run_id,),
        ).fetchone()["count"] == 0
        assert conn.execute(
            "SELECT COUNT(*) AS count FROM conversation_messages WHERE run_id = ? AND role = 'assistant'",
            (run_id,),
        ).fetchone()["count"] == 2


def test_create_interrupt_enriches_dynamic_ui_contract_fields(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    interrupt = _create_pending_ui_interrupt(
        tool_name="grade_review_recall",
        title="Grade review",
        fields=[{"id": "rating", "kind": "select", "label": "Grade", "options": [{"label": "Again", "value": "1"}]}],
        renderer_key="interview.review_grade",
        renderer_version=1,
        placement="sidecar",
        structured_content={"card_id": "card-1", "grade": "again"},
        ui_meta={"tone": "compact"},
        metadata={"display_mode": "inline", "consequence_preview": "Tracks recall feedback."},
        entity_ref={"entity_type": "card", "entity_id": "card-1", "href": "/review", "title": "Grade review"},
    )
    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    persisted_interrupt = next(item for item in payload["interrupts"] if item["id"] == interrupt["id"])
    assert persisted_interrupt["renderer_key"] == "interview.review_grade"
    assert persisted_interrupt["renderer_version"] == 1
    assert persisted_interrupt["placement"] == "sidecar"
    assert persisted_interrupt["structured_content"]["card_id"] == "card-1"
    assert persisted_interrupt["ui_meta"]["tone"] == "compact"
    assert str(persisted_interrupt["tool_call_id"]).startswith("toolcall_")


def test_due_date_interrupt_failure_leaves_interrupt_pending_for_retry(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    create = client.post(
        "/v1/assistant/threads/primary/messages",
        json={
            "content": "create task Retry the assistant failure path",
            "input_mode": "text",
            "device_target": "android-phone",
            "metadata": {"surface": "assistant_mobile", "client_timezone": "UTC"},
        },
        headers=auth_headers,
    )
    assert create.status_code == 201
    payload = create.json()
    interrupt = payload["run"]["current_interrupt"]
    assert interrupt is not None

    def explode_execute_tool(*args, **kwargs):
        raise RuntimeError("synthetic create_task failure")

    monkeypatch.setattr(agent_service, "execute_tool", explode_execute_tool)

    submit = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"due_date": "2026-04-22", "priority": "3", "client_timezone": "UTC"}},
        headers=auth_headers,
    )
    assert submit.status_code == 200
    snapshot = submit.json()

    failed_run = next(run for run in snapshot["runs"] if run["id"] == payload["run"]["id"])
    assert failed_run["status"] == "failed"

    pending_interrupt = next(item for item in snapshot["interrupts"] if item["id"] == interrupt["id"])
    assert pending_interrupt["status"] == "pending"
    assert pending_interrupt["resolution"] == {}
    assert any(
        part["type"] == "status" and part["status"] == "error"
        for message in snapshot["messages"]
        for part in message["parts"]
    )


def test_assistant_voice_message_queue_completes_into_shared_thread(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    queued = client.post(
        "/v1/assistant/threads/primary/voice",
        headers=auth_headers,
        files={"file": ("assistant-voice.m4a", b"voice-bytes", "audio/mp4")},
        data={
            "title": "Assistant voice message",
            "duration_ms": "2400",
            "device_target": "android-phone",
            "provider_hint": "whisper_local",
            "metadata_json": json.dumps({"surface": "assistant_mobile", "submitted_via": "voice_recording"}),
        },
    )
    assert queued.status_code == 201
    payload = queued.json()
    job_id = payload["id"]
    assert payload["action"] == "assistant_thread_voice"

    claim = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "assistant-voice-worker"},
        headers=auth_headers,
    )
    assert claim.status_code == 200

    complete = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "assistant-voice-worker",
            "provider_used": "whisper_local",
            "output": {"transcript": "create task Voice thread task due tomorrow priority 3"},
        },
        headers=auth_headers,
    )
    assert complete.status_code == 200
    completed_payload = complete.json()
    assert completed_payload["output"]["assistant_thread"]["run_status"] == "completed"
    assert completed_payload["output"]["assistant_thread"]["transcript"] == "create task Voice thread task due tomorrow priority 3"

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    thread_payload = snapshot.json()
    assert any(
        part["type"] == "text" and part["text"] == "create task Voice thread task due tomorrow priority 3"
        for message in thread_payload["messages"]
        for part in message["parts"]
    )

    tasks = client.get("/v1/tasks", headers=auth_headers)
    assert tasks.status_code == 200
    assert any(task["title"] == "Voice thread task" for task in tasks.json())


def test_assistant_voice_message_completion_can_open_and_resolve_runtime_review_panel(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = client.post(
        "/v1/cards",
        json={
            "prompt": "Apply two pointers to a minimum-window interview problem.",
            "answer": "Expand the window, satisfy the target counts, then shrink while the window remains valid.",
            "card_type": "scenario",
            "due_at": "2026-05-01T00:00:00.000Z",
            "interval_days": 1,
            "repetitions": 0,
            "ease_factor": 2.5,
            "tags": ["interview-prep", "voice"],
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    card = created.json()
    transcript = "I answered the current interview prep review card; grade it from voice"
    runtime_requests: list[dict] = []

    def mock_chat_turn(request: dict) -> dict:
        runtime_requests.append(request)
        return {
            "workflow": "chat_turn",
            "provider_used": "mock_codex_bridge",
            "model": "mock-agent-voice-review",
            "response_text": "I can record that review result once you choose how it went.",
            "parts": [
                assistant_projection_service.text_part(
                    "I can record that review result once you choose how it went."
                )
            ],
            "interrupts": [
                {
                    "tool_call_id": "toolcall_voice_review_grade",
                    "tool_name": "grade_review_recall",
                    "interrupt_type": "choice",
                    "title": "Grade application review",
                    "body": "Choose the grade for the interview-prep card you just answered.",
                    "primary_label": "Record grade",
                    "secondary_label": "Not now",
                    "fields": [
                        {
                            "id": "rating",
                            "kind": "select",
                            "label": "Review quality",
                            "value": "3",
                            "required": True,
                            "options": [
                                {"label": "Again", "value": "1"},
                                {"label": "Hard", "value": "3"},
                                {"label": "Good", "value": "4"},
                                {"label": "Easy", "value": "5"},
                            ],
                        }
                    ],
                    "display_mode": "composer",
                    "renderer_key": "interview.review_grade",
                    "renderer_version": 1,
                    "placement": "inline",
                    "structured_content": {
                        "card_id": card["id"],
                        "prompt": card["prompt"],
                        "review_mode": card["review_mode"],
                    },
                    "ui_meta": {
                        "tone": "review",
                        "review_mode": card["review_mode"],
                        "card_type": card["card_type"],
                    },
                    "consequence_preview": "Updates the SRS schedule for this interview-prep card.",
                    "recommended_defaults": {"rating": "4"},
                    "entity_ref": {
                        "entity_type": "card",
                        "entity_id": card["id"],
                        "title": card["prompt"],
                        "href": "/review",
                    },
                    "metadata": {
                        "card_id": card["id"],
                        "card_type": card["card_type"],
                        "review_mode": card["review_mode"],
                        "prompt": card["prompt"],
                        "planned_tool_name": "grade_review_recall",
                        "planned_arguments": {"card_id": card["id"]},
                        "display_mode": "composer",
                    },
                }
            ],
        }

    monkeypatch.setattr(ai_service, "execute_chat_turn", mock_chat_turn)

    queued = client.post(
        "/v1/assistant/threads/primary/voice",
        headers=auth_headers,
        files={"file": ("assistant-voice.webm", b"voice-bytes", "audio/webm")},
        data={
            "title": "PWA voice review grade",
            "duration_ms": "1800",
            "device_target": "web-desktop",
            "provider_hint": "whisper_local",
            "metadata_json": json.dumps({"surface": "assistant_web", "submitted_via": "voice_recording"}),
        },
    )
    assert queued.status_code == 201
    job_id = queued.json()["id"]
    assert queued.json()["action"] == "assistant_thread_voice"

    claim = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "assistant-voice-worker"},
        headers=auth_headers,
    )
    assert claim.status_code == 200

    complete = client.post(
        f"/v1/ai/jobs/{job_id}/complete",
        json={
            "worker_id": "assistant-voice-worker",
            "provider_used": "whisper_local_mock",
            "output": {"transcript": transcript},
        },
        headers=auth_headers,
    )
    assert complete.status_code == 200
    completed_payload = complete.json()
    assistant_thread_output = completed_payload["output"]["assistant_thread"]
    assert assistant_thread_output["run_status"] == "interrupted"
    assert assistant_thread_output["transcript"] == transcript
    run_id = assistant_thread_output["run_id"]

    assert len(runtime_requests) == 1
    assert runtime_requests[0]["text"] == transcript
    assert runtime_requests[0]["context"]["ui_capabilities"]["version"] == "starlog.dynamic_ui_capabilities.v1"

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    runtime_run = next(run for run in payload["runs"] if run["id"] == run_id)
    assert runtime_run["status"] == "interrupted"
    interrupt = next(
        item for item in payload["interrupts"] if item["run_id"] == run_id and item["status"] == "pending"
    )
    assert interrupt["tool_name"] == "grade_review_recall"
    assert interrupt["renderer_key"] == "interview.review_grade"
    assert interrupt["renderer_version"] == 1
    assert interrupt["structured_content"]["card_id"] == card["id"]
    assert interrupt["ui_meta"]["review_mode"] == card["review_mode"]

    submit = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"rating": "4"}},
        headers=auth_headers,
    )
    assert submit.status_code == 200
    submitted_snapshot = submit.json()
    completed_run = next(run for run in submitted_snapshot["runs"] if run["id"] == run_id)
    assert completed_run["status"] == "completed"
    assert completed_run["current_interrupt"] is None
    assert [step["tool_name"] for step in completed_run["steps"]] == [
        "grade_review_recall",
        "chat_turn_runtime",
        "grade_review_recall",
    ]
    assert any(
        part["type"] == "text" and "Recorded Good for" in part["text"]
        for message in submitted_snapshot["messages"]
        for part in message["parts"]
        if part["type"] == "text"
    )
    session_state = submitted_snapshot["session_state"]
    assert session_state["last_turn_kind"] == "chat_turn"
    assert session_state["last_user_message"] == transcript
    assert session_state["last_matched_intent"] == "grade_review_recall"
    assert session_state["last_status"] == "executed"
    assert session_state["last_tool_names"] == ["grade_review_recall"]
    assert session_state["last_chat_turn_provider"] == "mock_codex_bridge"
    assert session_state["last_chat_turn_model"] == "mock-agent-voice-review"
    assert session_state["last_review_grade"]["card_id"] == card["id"]
    assert session_state["last_review_grade"]["rating"] == 4

    cards = client.get("/v1/cards", headers=auth_headers)
    assert cards.status_code == 200
    reviewed = next(item for item in cards.json() if item["id"] == card["id"])
    assert reviewed["repetitions"] == 1
    assert reviewed["interval_days"] == 1


def test_assistant_voice_message_job_failure_emits_thread_error_message(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    queued = client.post(
        "/v1/assistant/threads/primary/voice",
        headers=auth_headers,
        files={"file": ("assistant-voice.m4a", b"voice-bytes", "audio/mp4")},
        data={
            "title": "Assistant voice message",
            "duration_ms": "1600",
            "device_target": "android-phone",
            "provider_hint": "whisper_local",
        },
    )
    assert queued.status_code == 201
    job_id = queued.json()["id"]

    claim = client.post(
        f"/v1/ai/jobs/{job_id}/claim",
        json={"worker_id": "assistant-voice-worker"},
        headers=auth_headers,
    )
    assert claim.status_code == 200

    failed = client.post(
        f"/v1/ai/jobs/{job_id}/fail",
        json={
            "worker_id": "assistant-voice-worker",
            "provider_used": "whisper_local",
            "error_text": "speech worker unavailable",
        },
        headers=auth_headers,
    )
    assert failed.status_code == 200

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    assert any(
        part["type"] == "text" and "could not be transcribed" in part["text"]
        for message in payload["messages"]
        for part in message["parts"]
        if part["type"] == "text"
    )
    assert any(
        part["type"] == "status" and part["status"] == "error"
        for message in payload["messages"]
        for part in message["parts"]
    )


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


def test_assistant_surface_event_explicit_internal_task_created_stays_internal(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    before = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert before.status_code == 200
    before_payload = before.json()

    response = client.post(
        "/v1/assistant/threads/primary/events",
        json={
            "source_surface": "planner",
            "kind": "task.created",
            "entity_ref": {"entity_type": "task", "entity_id": "task_internal_1", "href": "/planner"},
            "payload": {"label": "Task created", "body": "This should remain internal."},
            "visibility": "internal",
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    payload = response.json()
    assert len(payload["messages"]) == len(before_payload["messages"])
    assert len(payload["interrupts"]) == len(before_payload["interrupts"])
    assert not any(
        part["type"] == "ambient_update" and part["update"]["metadata"].get("kind") == "task.created"
        for message in payload["messages"]
        for part in message["parts"]
    )


def test_assistant_surface_event_explicit_internal_capture_created_stays_internal(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    artifact_id = _create_test_artifact(title="Internal capture", source_type="clip_manual")
    before = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert before.status_code == 200
    before_payload = before.json()

    response = client.post(
        "/v1/assistant/threads/primary/events",
        json={
            "source_surface": "library",
            "kind": "capture.created",
            "entity_ref": {"entity_type": "artifact", "entity_id": artifact_id, "href": f"/artifacts?artifact={artifact_id}"},
            "payload": {"artifact_id": artifact_id, "assistant_text": "This should remain internal."},
            "visibility": "internal",
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    payload = response.json()
    assert len(payload["messages"]) == len(before_payload["messages"])
    assert not any(interrupt["tool_name"] == "triage_capture" for interrupt in payload["interrupts"])
    assert not any(
        part["type"] == "ambient_update" and part["update"]["metadata"].get("kind") == "capture.created"
        for message in payload["messages"]
        for part in message["parts"]
    )


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
    assert interrupt["title"] == "Grade Recall"
    assert interrupt["tool_call_id"]
    assert interrupt["renderer_key"] == "interview.review_grade"
    assert interrupt["renderer_version"] == 1
    assert interrupt["placement"] == "inline"
    assert interrupt["structured_content"]["card_id"] == card["id"]
    assert interrupt["structured_content"]["grade"] is None
    assert interrupt["ui_meta"]["review_mode"] == "recall"
    assert interrupt["metadata"]["card_type"] == "qa"
    assert interrupt["metadata"]["review_mode"] == "recall"

    reloaded_before_submit = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert reloaded_before_submit.status_code == 200
    reloaded_interrupt = next(
        item for item in reloaded_before_submit.json()["interrupts"] if item["id"] == interrupt["id"]
    )
    assert reloaded_interrupt["tool_call_id"] == interrupt["tool_call_id"]
    assert reloaded_interrupt["renderer_key"] == "interview.review_grade"
    assert reloaded_interrupt["structured_content"]["card_id"] == card["id"]
    assert reloaded_interrupt["ui_meta"]["review_mode"] == "recall"

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
        part["type"] == "text" and "Recorded Good for recall review" in part["text"]
        for message in snapshot["messages"]
        for part in message["parts"]
        if part["type"] == "text"
    )
    review_grade_results = [
        part["tool_result"]
        for message in snapshot["messages"]
        for part in message["parts"]
        if part["type"] == "tool_result" and part["tool_result"].get("renderer_key") == "interview.review_grade"
    ]
    assert review_grade_results
    assert review_grade_results[-1]["tool_call_id"] == interrupt["tool_call_id"]
    assert review_grade_results[-1]["renderer_version"] == 1
    assert review_grade_results[-1]["placement"] == "thread"
    assert review_grade_results[-1]["structured_content"]["card_id"] == card["id"]
    assert review_grade_results[-1]["structured_content"]["grade"] == "4"
    assert review_grade_results[-1]["ui_meta"]["review_mode"] == "recall"

    reloaded_after_submit = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert reloaded_after_submit.status_code == 200
    reloaded_review_grade_results = [
        part["tool_result"]
        for message in reloaded_after_submit.json()["messages"]
        for part in message["parts"]
        if part["type"] == "tool_result" and part["tool_result"].get("renderer_key") == "interview.review_grade"
    ]
    assert reloaded_review_grade_results
    assert reloaded_review_grade_results[-1]["tool_call_id"] == interrupt["tool_call_id"]
    assert reloaded_review_grade_results[-1]["structured_content"]["card_id"] == card["id"]
    assert reloaded_review_grade_results[-1]["structured_content"]["grade"] == "4"
    assert reloaded_review_grade_results[-1]["ui_meta"]["review_mode"] == "recall"

    cards = client.get("/v1/cards", headers=auth_headers)
    assert cards.status_code == 200
    updated = next(item for item in cards.json() if item["id"] == card["id"])
    assert updated["repetitions"] == 1
    assert updated["interval_days"] == 1

    with get_connection() as conn:
        assert conn.execute(
            "SELECT COUNT(*) AS count FROM review_events WHERE card_id = ?",
            (card["id"],),
        ).fetchone()["count"] == 1
        step = conn.execute(
            """
            SELECT message_id, result_json
            FROM conversation_run_steps
            WHERE interrupt_id = ? AND tool_name = 'grade_review_recall' AND status = 'completed'
            """,
            (interrupt["id"],),
        ).fetchone()
        step_count_before_duplicate = conn.execute(
            "SELECT COUNT(*) AS count FROM conversation_run_steps WHERE interrupt_id = ? AND tool_name = 'grade_review_recall'",
            (interrupt["id"],),
        ).fetchone()["count"]
    assert step is not None
    assert step["message_id"] in {message["id"] for message in snapshot["messages"]}

    duplicate = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"rating": "4"}},
        headers=auth_headers,
    )
    assert duplicate.status_code == 200
    assert len(duplicate.json()["messages"]) == len(snapshot["messages"])
    with get_connection() as conn:
        assert conn.execute(
            "SELECT COUNT(*) AS count FROM review_events WHERE card_id = ?",
            (card["id"],),
        ).fetchone()["count"] == 1
        assert conn.execute(
            "SELECT COUNT(*) AS count FROM conversation_run_steps WHERE interrupt_id = ? AND tool_name = 'grade_review_recall'",
            (interrupt["id"],),
        ).fetchone()["count"] == step_count_before_duplicate


def test_unsupported_interrupt_submit_records_failed_run_without_resolution(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    interrupt = _create_pending_ui_interrupt(
        tool_name="unknown_future_renderer",
        title="Future renderer",
        fields=[{"id": "choice", "kind": "text", "label": "Choice"}],
        metadata={"display_mode": "inline"},
        entity_ref={"entity_type": "artifact", "entity_id": "future-renderer", "href": "/library", "title": "Future renderer"},
    )

    submitted = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"choice": "ok"}},
        headers=auth_headers,
    )

    assert submitted.status_code == 200
    payload = submitted.json()
    pending = next(item for item in payload["interrupts"] if item["id"] == interrupt["id"])
    assert pending["status"] == "pending"
    assert pending["resolution"] == {}
    run = next(item for item in payload["runs"] if item["id"] == interrupt["run_id"])
    assert run["status"] == "failed"
    assert run["summary"] == "Run failed before completion"
    assert any(
        part["type"] == "status" and part["status"] == "error"
        for message in payload["messages"]
        for part in message["parts"]
    )
    with get_connection() as conn:
        failed_step = conn.execute(
            """
            SELECT message_id, error_text
            FROM conversation_run_steps
            WHERE run_id = ? AND tool_name = ? AND status = 'failed'
            """,
            (interrupt["run_id"], "interrupt:unknown_future_renderer"),
        ).fetchone()
    assert failed_step is not None
    assert "Unsupported interrupt tool" in failed_step["error_text"]
    assert failed_step["message_id"] in {message["id"] for message in payload["messages"]}


def test_mobile_phase2_ui_interrupt_tools_submit_conservatively(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    cases = [
        (
            "clarify_schedule_time",
            "What time should I schedule this?",
            [
                {
                    "id": "scheduled_time",
                    "kind": "select",
                    "label": "Schedule time",
                    "required": True,
                    "options": [{"label": "10:30 AM", "value": "10:30"}],
                }
            ],
            {"scheduled_time": "10:30", "reuse_for_similar_blocks": True},
            "Schedule time recorded",
        ),
        (
            "defer_recommendation",
            "Remind me later",
            [
                {
                    "id": "remind_at",
                    "kind": "select",
                    "label": "Reminder",
                    "required": True,
                    "options": [{"label": "Tomorrow morning", "value": "tomorrow_morning"}],
                }
            ],
            {"remind_at": "tomorrow_morning"},
            "Reminder preference saved",
        ),
        (
            "link_capture_project",
            "Link to project",
            [
                {
                    "id": "project_id",
                    "kind": "entity_search",
                    "label": "Suggested projects",
                    "required": True,
                    "options": [{"label": "Assistant v2.0 launch", "value": "project_assistant_v2"}],
                }
            ],
            {"project_id": "project_custom_research"},
            "Project link recorded",
        ),
    ]

    for tool_name, title, fields, values, run_summary in cases:
        interrupt = _create_pending_ui_interrupt(
            tool_name=tool_name,
            title=title,
            fields=fields,
            primary_label="Confirm",
            metadata={"display_mode": "inline"},
            entity_ref={"entity_type": "artifact", "entity_id": "artifact_test", "href": "/library", "title": "Test artifact"},
        )

        submit = client.post(
            f"/v1/assistant/interrupts/{interrupt['id']}/submit",
            json={"values": values},
            headers=auth_headers,
        )

        assert submit.status_code == 200
        payload = submit.json()
        completed = next(item for item in payload["interrupts"] if item["id"] == interrupt["id"])
        assert completed["status"] == "submitted"
        assert completed["resolution"]["values"] == values
        run = next(item for item in payload["runs"] if item["id"] == interrupt["run_id"])
        assert run["status"] == "completed"
        assert run["summary"] == run_summary


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
    assert interrupt["display_mode"] == "inline"
    assert interrupt["consequence_preview"]
    assert any(option["value"] == "tasks" for field in interrupt["fields"] for option in field.get("options", []))
    assert any("One quick choice" in text for text in _message_texts(payload))

    submitted = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"capture_kind": "task", "next_step": "tasks"}},
        headers=auth_headers,
    )
    assert submitted.status_code == 200
    submitted_payload = submitted.json()
    triage_message = next(
        message
        for message in reversed(submitted_payload["messages"])
        if message["metadata"].get("capture_triage", {}).get("next_step") == "tasks"
    )
    result_cards = [part["card"] for part in triage_message["parts"] if part["type"] == "card"]
    assert result_cards
    assert result_cards[0]["kind"] == "task_list"
    assert result_cards[0]["metadata"]["artifact_id"] == artifact_id
    assert result_cards[0]["entity_ref"]["href"].startswith("/planner?task=")
    assert any(action["id"] == "open_planner" for action in result_cards[0]["actions"])
    graph = client.get(f"/v1/artifacts/{artifact_id}/graph", headers=auth_headers)
    assert graph.status_code == 200
    assert graph.json()["tasks"]
    assert all(task["source_artifact_id"] == artifact_id for task in graph.json()["tasks"])


def test_desktop_helper_capture_reflects_with_desktop_helper_surface(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    captured = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_desktop_helper",
            "capture_source": "desktop_helper",
            "title": "Codex clip",
            "raw": {"text": "Clip from the desktop helper.", "mime_type": "text/plain"},
            "normalized": {"text": "Clip from the desktop helper.", "mime_type": "text/plain"},
            "extracted": {"text": "Clip from the desktop helper.", "mime_type": "text/plain"},
        },
        headers=auth_headers,
    )
    assert captured.status_code == 201

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    payload = snapshot.json()
    helper_message = next(
        message
        for message in payload["messages"]
        if message["metadata"].get("surface_event", {}).get("source_surface") == "desktop_helper"
    )
    assert any(
        part["type"] == "text" and "desktop helper" in part["text"].lower()
        for part in helper_message["parts"]
    )
    interrupt = next(item for item in payload["interrupts"] if item["tool_name"] == "triage_capture")
    assert interrupt["metadata"]["surface_event"]["source_surface"] == "desktop_helper"


def test_briefing_with_due_open_task_produces_task_specific_focus_option(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    task = client.post(
        "/v1/tasks",
        json={
            "title": "Draft release summary",
            "status": "todo",
            "priority": 5,
            "due_at": (utc_now() - timedelta(hours=1)).isoformat(),
        },
        headers=auth_headers,
    )
    assert task.status_code == 201
    task_id = task.json()["id"]

    generated = client.post(
        "/v1/briefings/generate",
        json={"date": "2026-04-22", "provider": "test-suite"},
        headers=auth_headers,
    )
    assert generated.status_code == 201

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    interrupt = next(item for item in snapshot.json()["interrupts"] if item["tool_name"] == "choose_morning_focus")
    assert {"label": "Task: Draft release summary", "value": f"task:{task_id}"} in _focus_options(interrupt)
    assert interrupt["metadata"]["focus_options"]["source"] == "derived"
    assert interrupt["metadata"]["focus_options"]["counts"]["task"] == 1


def test_briefing_with_pending_capture_triage_produces_capture_focus_option(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    captured = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_manual",
            "capture_source": "test-suite",
            "title": "Unprocessed clip",
            "raw": {"text": "Capture this for later.", "mime_type": "text/plain"},
            "normalized": {"text": "Capture this for later.", "mime_type": "text/plain"},
            "extracted": {"text": "Capture this for later.", "mime_type": "text/plain"},
        },
        headers=auth_headers,
    )
    assert captured.status_code == 201

    generated = client.post(
        "/v1/briefings/generate",
        json={"date": "2026-04-22", "provider": "test-suite"},
        headers=auth_headers,
    )
    assert generated.status_code == 201

    snapshot = client.get("/v1/assistant/threads/primary", headers=auth_headers)
    assert snapshot.status_code == 200
    interrupt = next(item for item in snapshot.json()["interrupts"] if item["tool_name"] == "choose_morning_focus")
    assert {"label": "Process latest capture", "value": "capture"} in _focus_options(interrupt)
    assert interrupt["metadata"]["focus_options"]["source"] == "derived"
    assert interrupt["metadata"]["focus_options"]["counts"]["capture"] == 1


def test_briefing_without_open_loops_falls_back_to_default_focus_options(
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
    assert _focus_options(interrupt) == [
        {"label": "Review queue", "value": "review"},
        {"label": "Process latest capture", "value": "capture"},
        {"label": "Start deep work block", "value": "deep_work"},
        {"label": "Plan today", "value": "plan_day"},
    ]
    assert interrupt["metadata"]["focus_options"]["source"] == "fallback"
    assert any("morning briefing" in text.lower() for text in _message_texts(payload))


def test_submitted_morning_focus_value_is_preserved(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    event = client.post(
        "/v1/assistant/threads/primary/events",
        json={
            "source_surface": "planner",
            "kind": "briefing.generated",
            "entity_ref": {
                "entity_type": "briefing",
                "entity_id": "brf_custom_focus",
                "href": "/planner?briefing=brf_custom_focus",
                "title": "2026-04-22",
            },
            "payload": {
                "briefing_id": "brf_custom_focus",
                "date": "2026-04-22",
                "focus_options": [{"label": "Task: Preserve focus", "value": "task:tsk_custom_focus"}],
            },
            "visibility": "assistant_message",
        },
        headers=auth_headers,
    )
    assert event.status_code == 201
    interrupt = next(item for item in event.json()["interrupts"] if item["tool_name"] == "choose_morning_focus")

    submitted = client.post(
        f"/v1/assistant/interrupts/{interrupt['id']}/submit",
        json={"values": {"focus": "task:tsk_custom_focus"}},
        headers=auth_headers,
    )
    assert submitted.status_code == 200
    resolved_interrupt = next(item for item in submitted.json()["interrupts"] if item["id"] == interrupt["id"])
    assert resolved_interrupt["status"] == "submitted"
    assert resolved_interrupt["resolution"]["values"]["focus"] == "task:tsk_custom_focus"


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
    resolved_events = [
        event
        for event in _planner_surface_events_for_entity(conflict["id"])
        if event["kind"] == "planner.conflict.resolved"
    ]
    assert len(resolved_events) == 1
    assert resolved_events[0]["visibility"] == "ambient"
    assert resolved_events[0]["projected_message"] is True
    assert resolved_events[0]["payload"]["resolution_strategy"] == "local_wins"
    assert any(
        part["type"] == "ambient_update"
        and part["update"]["label"] == "Planner conflict resolved"
        and part["update"]["metadata"].get("kind") == "planner.conflict.resolved"
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
    cleared_events = [
        event
        for event in _planner_surface_events_for_entity(conflict["id"])
        if event["kind"] == "planner.conflict.cleared"
    ]
    assert len(cleared_events) == 1
    assert cleared_events[0]["visibility"] == "ambient"
    assert cleared_events[0]["projected_message"] is True
    assert cleared_events[0]["payload"]["reason"] == "replayed_cleanly"
    assert any(
        part["type"] == "ambient_update"
        and part["update"]["label"] == "Planner conflict cleared"
        and part["update"]["metadata"].get("kind") == "planner.conflict.cleared"
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
