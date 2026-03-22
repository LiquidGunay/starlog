from runtime_app.workflows import briefing_preview, chat_preview, execute_capability, research_digest_preview


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
