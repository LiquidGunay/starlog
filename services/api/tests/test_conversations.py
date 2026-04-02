from fastapi.testclient import TestClient


def test_primary_conversation_bootstraps(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get("/v1/conversations/primary", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["slug"] == "primary"
    assert payload["mode"] == "voice_native"
    assert payload["message_limit"] == 50
    assert payload["trace_limit"] == 25
    assert payload["has_more_messages"] is False
    assert payload["next_before_message_id"] is None
    assert payload["session_state"] == {}
    assert payload["messages"] == []


def test_agent_command_persists_conversation_and_tool_traces(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    command = "create task Review chat persistence due tomorrow priority 4"

    response = client.post(
        "/v1/agent/command",
        json={"command": command, "execute": True, "device_target": "web-pwa"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    conversation = client.get("/v1/conversations/primary", headers=auth_headers)
    assert conversation.status_code == 200
    payload = conversation.json()
    assert len(payload["messages"]) == 2
    assert payload["messages"][0]["role"] == "user"
    assert payload["messages"][0]["content"] == command
    assert payload["messages"][1]["role"] == "assistant"
    assert payload["messages"][1]["metadata"]["assistant_command"]["matched_intent"] == "create_task"
    assert payload["tool_traces"][0]["tool_name"] == "create_task"
    assert payload["tool_traces"][0]["metadata"]["confirmation_state"] == "confirmed"
    assert payload["tool_traces"][0]["metadata"]["backing_endpoint"] == "/v1/tasks"
    assert payload["session_state"]["last_matched_intent"] == "create_task"


def test_reset_primary_conversation_session(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    client.post(
        "/v1/conversations/primary/chat",
        json={"content": "Where did we leave off?", "device_target": "web-pwa"},
        headers=auth_headers,
    )

    reset = client.post("/v1/conversations/primary/session/reset", headers=auth_headers)
    assert reset.status_code == 200
    assert reset.json()["session_state"] == {}

    conversation = client.get("/v1/conversations/primary", headers=auth_headers)
    assert conversation.status_code == 200
    assert conversation.json()["session_state"] == {}
    assert len(conversation.json()["messages"]) == 2


def test_chat_turn_persists_messages_cards_and_runtime_trace(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/v1/conversations/primary/chat",
        json={
            "content": "Summarize the current thread state.",
            "device_target": "web-pwa",
            "metadata": {"surface": "assistant"},
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["user_message"]["role"] == "user"
    assert payload["assistant_message"]["role"] == "assistant"
    assert payload["assistant_message"]["metadata"]["chat_turn"]["workflow"] == "chat_turn"
    assert payload["assistant_message"]["cards"][0]["kind"] == "assistant_summary"
    assert payload["trace"]["tool_name"] == "chat_turn_runtime"
    assert payload["trace"]["metadata"]["workflow"] == "chat_turn"
    assert payload["session_state"]["last_turn_kind"] == "chat_turn"
    assert payload["session_state"]["last_chat_turn_provider"] == "local_prompt_preview"


def test_thread_context_cards_project_latest_session_state(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    seed = client.post(
        "/v1/agent/command",
        json={"command": "create task Review chat projection", "execute": True, "device_target": "web-pwa"},
        headers=auth_headers,
    )
    assert seed.status_code == 200

    chat = client.post(
        "/v1/conversations/primary/chat",
        json={"content": "Check thread context", "device_target": "web-pwa"},
        headers=auth_headers,
    )
    assert chat.status_code == 201
    assistant_id = chat.json()["assistant_message"]["id"]

    initial = client.get("/v1/conversations/primary", headers=auth_headers)
    assert initial.status_code == 200
    initial_payload = initial.json()
    initial_message = next(item for item in initial_payload["messages"] if item["id"] == assistant_id)
    initial_cards = [card for card in initial_message["cards"] if card["kind"] == "thread_context"]
    assert initial_cards, "expected thread_context card in assistant message"
    initial_card = initial_cards[0]
    assert initial_card["metadata"]["projection"] == "thread_context"
    assert "create task" in initial_card["body"].lower()
    initial_version = initial_card["version"]

    update = client.post(
        "/v1/agent/command",
        json={"command": "list tasks", "execute": True, "device_target": "web-pwa"},
        headers=auth_headers,
    )
    assert update.status_code == 200

    conversation = client.get("/v1/conversations/primary?trace_limit=0", headers=auth_headers)
    assert conversation.status_code == 200
    payload = conversation.json()
    message = next(item for item in payload["messages"] if item["id"] == assistant_id)
    cards = [card for card in message["cards"] if card["kind"] == "thread_context"]
    assert cards, "expected thread_context card in assistant message"
    card = cards[0]
    assert card["metadata"]["projection"] == "thread_context"
    assert card["metadata"]["projection_version"] == card["version"]
    assert "list tasks" in card["body"].lower()
    assert card["version"] > initial_version


def test_primary_conversation_supports_message_pagination(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    created_ids: list[str] = []
    for index in range(3):
        response = client.post(
            "/v1/conversations/primary/messages",
            json={"role": "user", "content": f"message {index + 1}"},
            headers=auth_headers,
        )
        assert response.status_code == 201
        created_ids.append(response.json()["id"])

    page_one = client.get("/v1/conversations/primary?message_limit=2&trace_limit=0", headers=auth_headers)
    assert page_one.status_code == 200
    payload = page_one.json()
    assert [message["content"] for message in payload["messages"]] == ["message 2", "message 3"]
    assert payload["has_more_messages"] is True
    assert payload["next_before_message_id"] == created_ids[1]

    page_two = client.get(
        f"/v1/conversations/primary?message_limit=2&trace_limit=0&before_message_id={created_ids[1]}",
        headers=auth_headers,
    )
    assert page_two.status_code == 200
    older_payload = page_two.json()
    assert [message["content"] for message in older_payload["messages"]] == ["message 1"]
    assert older_payload["has_more_messages"] is False
    assert older_payload["next_before_message_id"] is None


def test_primary_conversation_preview_assembles_runtime_context(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    command = "create task Review chat preview due tomorrow priority 4"
    command_response = client.post(
        "/v1/agent/command",
        json={"command": command, "execute": True, "device_target": "web-pwa"},
        headers=auth_headers,
    )
    assert command_response.status_code == 200

    preview = client.post(
        "/v1/conversations/primary/preview",
        json={
            "content": "What should I do next?",
            "message_limit": 4,
            "trace_limit": 4,
            "metadata": {"surface": "assistant"},
        },
        headers=auth_headers,
    )
    assert preview.status_code == 200
    payload = preview.json()
    assert payload["workflow"] == "chat_turn"
    assert payload["provider_used"] == "local_prompt_preview"
    assert payload["model"] == "gpt-5.4-nano"
    assert payload["context"]["session_state"]["last_matched_intent"] == "create_task"
    assert payload["context"]["recent_messages"][-1]["role"] == "assistant"
    assert payload["context"]["request_metadata"] == {"surface": "assistant"}
    assert "What should I do next?" in payload["user_prompt"]
