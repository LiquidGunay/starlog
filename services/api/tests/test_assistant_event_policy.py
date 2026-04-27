from app.services.assistant_event_policy import resolve_event_visibility


def test_explicit_internal_stays_internal() -> None:
    assert resolve_event_visibility("capture.created", "internal") == "internal"
    assert resolve_event_visibility("unknown.event", "internal") == "internal"


def test_assistant_message_routes_known_dynamic_panel_events_to_dynamic_panel() -> None:
    assert resolve_event_visibility("capture.created", "assistant_message") == "dynamic_panel"
    assert resolve_event_visibility("planner.conflict.detected", "assistant_message") == "dynamic_panel"
    assert resolve_event_visibility("review.answer.revealed", "assistant_message") == "dynamic_panel"
    assert resolve_event_visibility("briefing.generated", "assistant_message") == "dynamic_panel"


def test_unknown_assistant_message_remains_assistant_message() -> None:
    assert resolve_event_visibility("unknown.event", "assistant_message") == "assistant_message"


def test_known_low_noise_events_default_to_ambient_or_internal() -> None:
    assert resolve_event_visibility("task.created", None) == "ambient"
    assert resolve_event_visibility("artifact.opened", None) == "ambient"
    assert resolve_event_visibility("assistant.panel.submitted", None) == "ambient"
    assert resolve_event_visibility("assistant.card.action_used", None) == "internal"
