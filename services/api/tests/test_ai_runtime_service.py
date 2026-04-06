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
