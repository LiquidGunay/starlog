import importlib

import pytest

from app.services import ai_runtime_service


def test_local_preview_workflow_uses_runtime_prompts_but_preserves_api_provider_name() -> None:
    payload = ai_runtime_service.preview_workflow(
        "chat_turn",
        {
            "title": "Primary Starlog Thread",
            "text": "Summarize the current thread.",
            "context": {"surface": "assistant"},
        },
    )

    assert payload["provider_used"] == "local_prompt_preview"
    assert payload["workflow"] == "chat_turn"
    assert "voice-native assistant" in payload["system_prompt"]
    assert "Summarize the current thread." in payload["user_prompt"]


def test_local_execute_runtime_capability_uses_runtime_owned_prompts() -> None:
    payload = ai_runtime_service.execute_runtime_capability(
        "llm_summary",
        {"title": "Orbit clip", "text": "Important details go here."},
        prefer_local=True,
    )

    assert payload["provider_used"] == "local_ai_runtime"
    assert payload["capability"] == "llm_summary"
    assert payload["output"]["summary"].startswith("Summary draft for Orbit clip")
    assert "Important details go here." in payload["user_prompt"]


def test_local_chat_turn_returns_native_parts() -> None:
    payload = ai_runtime_service.execute_chat_turn(
        {
            "title": "Primary Starlog Thread",
            "text": "What should I do with this?",
            "context": {
                "request_metadata": {
                    "handoff_context": {
                        "source": "desktop_helper",
                        "artifact_id": "art_helper_1",
                        "draft": "Screenshot capture from the helper.",
                    }
                }
            },
        }
    )

    assert payload["provider_used"] == "local_prompt_preview"
    assert payload["parts"][0]["type"] == "text"
    assert payload["parts"][-1]["type"] == "status"
    capture_card = next(card for card in payload["cards"] if card["kind"] == "capture_item")
    assert capture_card["metadata"]["projection"] == "runtime_handoff"


def test_local_chat_turn_returns_tool_call_and_tool_result_parts_for_recent_trace() -> None:
    payload = ai_runtime_service.execute_chat_turn(
        {
            "title": "Primary Starlog Thread",
            "text": "What changed?",
            "context": {
                "recent_tool_traces": [
                    {
                        "id": "trace_task_1",
                        "tool_name": "create_task",
                        "status": "completed",
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
        }
    )

    tool_call = next(part["tool_call"] for part in payload["parts"] if part["type"] == "tool_call")
    tool_result = next(part["tool_result"] for part in payload["parts"] if part["type"] == "tool_result")
    assert tool_call["id"] == "trace_task_1"
    assert tool_call["tool_name"] == "create_task"
    assert tool_result["tool_call_id"] == "trace_task_1"
    assert tool_result["card"]["kind"] == "task_list"


def test_runtime_import_is_lazy_until_local_fallback_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    module = importlib.reload(ai_runtime_service)
    monkeypatch.setattr(module, "_RUNTIME_WORKFLOWS_MODULE", None)

    real_import_module = importlib.import_module

    def fake_import_module(name: str, package: str | None = None) -> object:
        if name == "runtime_app.workflows":
            raise ModuleNotFoundError("No module named 'runtime_app'")
        return real_import_module(name, package)

    monkeypatch.setattr(module.importlib, "import_module", fake_import_module)

    assert module._runtime_url("/v1/chat/execute") is None

    with pytest.raises(module.RuntimeServiceError, match="Local AI runtime workflows are unavailable"):
        module.execute_chat_turn({"text": "hello"})
