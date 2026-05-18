from runtime_app.prompt_loader import load_prompt, resolve_prompt_path


def test_prompt_loader_prefers_markdown_files() -> None:
    path = resolve_prompt_path("chat_turn.system.md")
    assert path.name == "chat_turn.system.md"


def test_prompt_loader_keeps_legacy_txt_lookups_working() -> None:
    path = resolve_prompt_path("chat_turn.system.txt")
    assert path.name == "chat_turn.system.md"
    assert "voice-native assistant" in load_prompt("chat_turn.system.txt")


def test_chat_turn_prompt_includes_proven_interview_prep_contracts() -> None:
    prompt = load_prompt("chat_turn.system.md").lower()
    proven_terms = [
        "mark_study_topic_read",
        "unlock_study_topic",
        "create_study_question_request",
        "grade_review_recall",
        "interview.topic_unlock",
        "interview.question_request",
        "interview.review_grade",
    ]
    for term in proven_terms:
        assert term in prompt


def test_chat_turn_prompt_marks_capability_wiring_gaps_explicitly() -> None:
    prompt = load_prompt("chat_turn.system.md").lower()
    conditional_terms = [
        "list_due_cards",
        "schedule_morning_brief_alarm",
    ]
    for term in conditional_terms:
        assert term in prompt
    assert "conditional / indirect review-capability paths" in prompt
    assert "not present in the current backend `ui_capabilities` registry" in prompt


def test_chat_turn_prompt_marks_unproven_capabilities_explicitly() -> None:
    prompt = load_prompt("chat_turn.system.md").lower()
    assert "not yet exposed as a dedicated dynamic-ui action" in prompt
    assert (
        "if a capability is not in `ui_capabilities` or not wired as above, state that limitation"
        in prompt
    )
