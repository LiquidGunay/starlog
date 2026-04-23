from runtime_app.workflows import (
    briefing_preview,
    chat_preview,
    execute_capability,
    execute_chat_turn,
    research_digest_preview,
)


def test_chat_preview_renders_prompts() -> None:
    payload = chat_preview("Command", "Summarize latest artifact", {"mode": "test"})
    assert payload.model == "gpt-5.4-nano"
    assert "voice-native assistant" in payload.system_prompt
    assert "Summarize latest artifact" in payload.user_prompt


def test_briefing_preview_renders_prompts() -> None:
    payload = briefing_preview("Daily", "Tasks and events", {"date": "2026-03-22"})
    assert "daily briefing" in payload.system_prompt.lower()
    assert "Tasks and events" in payload.user_prompt


def test_research_digest_preview_renders_prompts() -> None:
    payload = research_digest_preview("Research", "Paper list", {"source": "arxiv"})
    assert "research items" in payload.system_prompt.lower()
    assert "Paper list" in payload.user_prompt


def test_execute_capability_renders_summary_output() -> None:
    payload = execute_capability("llm_summary", {"title": "Runtime clip", "text": "Important details go here."})
    assert payload.provider_used == "runtime_prompt_fallback"
    assert payload.output["summary"].startswith("Summary draft for Runtime clip")
    assert "Important details go here." in payload.user_prompt


def test_execute_capability_generates_confirmation_ready_agent_plan() -> None:
    payload = execute_capability(
        "llm_agent_plan",
        {
            "command": "create task Review runtime routing",
            "tool_catalog": [{"name": "create_task"}],
        },
    )
    assert payload.output["matched_intent"] == "create_task"
    assert payload.output["tool_calls"][0]["tool_name"] == "create_task"


def test_execute_chat_turn_returns_structured_response() -> None:
    payload = execute_chat_turn(
        "Primary Starlog Thread",
        "Summarize where we left off.",
        {
            "session_state": {"last_matched_intent": "create_task"},
            "recent_messages": [{"role": "user", "content": "create a task"}],
            "recent_tool_traces": [{"tool_name": "create_task"}],
        },
    )
    assert payload.workflow == "chat_turn"
    assert payload.provider_used == "runtime_prompt_fallback"
    assert "Summarize where we left off." in payload.user_prompt
    assert payload.parts[0]["type"] == "text"
    assert payload.parts[-1]["type"] == "status"
    assert payload.cards[0]["kind"] == "assistant_summary"
    assert payload.session_state["last_turn_kind"] == "chat_turn"
    assert payload.session_state["last_user_message"] == "Summarize where we left off."


def test_execute_chat_turn_projects_capture_card_from_helper_handoff() -> None:
    payload = execute_chat_turn(
        "Primary Starlog Thread",
        "What should I do with this?",
        {
            "request_metadata": {
                "handoff_context": {
                    "source": "desktop_helper",
                    "artifact_id": "art_helper_1",
                    "draft": "Screenshot capture from the helper.",
                }
            }
        },
    )

    capture_card = next(card for card in payload.cards if card["kind"] == "capture_item")
    assert capture_card["metadata"]["artifact_id"] == "art_helper_1"
    assert capture_card["metadata"]["projection"] == "runtime_handoff"
    assert any(part["type"] == "card" and part["card"]["kind"] == "capture_item" for part in payload.parts)


def test_execute_chat_turn_projects_recent_review_trace_into_review_queue() -> None:
    payload = execute_chat_turn(
        "Primary Starlog Thread",
        "Where should I focus next?",
        {
            "recent_tool_traces": [
                {
                    "id": "trace_due_1",
                    "tool_name": "list_due_cards",
                    "result": {
                        "value": [
                            {
                                "id": "crd_1",
                                "prompt": "Explain spaced repetition.",
                                "answer": "Active recall over time.",
                            }
                        ]
                    },
                }
            ]
        },
    )

    review_card = next(card for card in payload.cards if card["kind"] == "review_queue")
    assert review_card["metadata"]["projection"] == "runtime_recent_trace"
    assert review_card["metadata"]["due_count"] == 1
    tool_call = next(part["tool_call"] for part in payload.parts if part["type"] == "tool_call")
    assert tool_call["id"] == "trace_due_1"
    assert tool_call["tool_name"] == "list_due_cards"
    assert tool_call["metadata"]["projection"] == "runtime_recent_trace"
    tool_result = next(part["tool_result"] for part in payload.parts if part["type"] == "tool_result")
    assert tool_result["tool_call_id"] == "trace_due_1"
    assert tool_result["metadata"]["tool_name"] == "list_due_cards"
    assert tool_result["card"]["kind"] == "review_queue"


def test_execute_chat_turn_projects_recent_task_trace_into_tool_result() -> None:
    payload = execute_chat_turn(
        "Primary Starlog Thread",
        "What just changed?",
        {
            "recent_tool_traces": [
                {
                    "id": "trace_task_1",
                    "tool_name": "create_task",
                    "result": {
                        "task": {
                            "id": "tsk_1",
                            "title": "Review runtime migration",
                            "status": "todo",
                            "due_at": "2026-04-24T09:00:00+00:00",
                        }
                    },
                }
            ]
        },
    )

    tool_call = next(part["tool_call"] for part in payload.parts if part["type"] == "tool_call")
    assert tool_call["id"] == "trace_task_1"
    assert tool_call["tool_name"] == "create_task"
    tool_result = next(part["tool_result"] for part in payload.parts if part["type"] == "tool_result")
    assert tool_result["metadata"]["tool_name"] == "create_task"
    assert tool_result["tool_call_id"] == tool_call["id"]
    assert tool_result["card"]["kind"] == "task_list"
    assert tool_result["card"]["metadata"]["task_ids"] == ["tsk_1"]


def test_execute_chat_turn_prefers_server_projected_trace_cards() -> None:
    payload = execute_chat_turn(
        "Primary Starlog Thread",
        "What changed most recently?",
        {
            "recent_tool_traces": [
                {
                    "id": "trace_projected_1",
                    "tool_name": "create_task",
                    "projected_card": {
                        "kind": "knowledge_note",
                        "version": 1,
                        "title": "Projected from server",
                        "body": "Use the API-provided projection.",
                        "entity_ref": {
                            "entity_type": "note",
                            "entity_id": "note_projected_1",
                            "href": "/notes?note=note_projected_1",
                            "title": "Projected from server",
                        },
                        "actions": [],
                        "metadata": {"projection": "server_trace_projection"},
                    },
                    "result": {
                        "task": {
                            "id": "tsk_1",
                            "title": "Review runtime migration",
                            "status": "todo",
                        }
                    },
                }
            ]
        },
    )

    tool_call = next(part["tool_call"] for part in payload.parts if part["type"] == "tool_call")
    assert tool_call["tool_name"] == "create_task"
    tool_result = next(part["tool_result"] for part in payload.parts if part["type"] == "tool_result")
    assert tool_result["tool_call_id"] == tool_call["id"]
    assert tool_result["card"]["kind"] == "knowledge_note"
    assert tool_result["card"]["metadata"]["projection"] == "server_trace_projection"
