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
