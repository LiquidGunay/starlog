import pytest

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


def test_proactive_capture_untriaged_defaults_to_ambient() -> None:
    assert resolve_event_visibility("capture.untriaged", None) == "ambient"
    assert resolve_event_visibility("capture.untriaged", "assistant_message") == "ambient"


@pytest.mark.parametrize(
    "kind",
    [
        "task.missed",
        "commitment.overdue",
        "review.repeated_failure",
        "project.stale",
        "goal.stale",
    ],
)
def test_proactive_events_default_to_assistant_message(kind: str) -> None:
    assert resolve_event_visibility(kind, None) == "assistant_message"


@pytest.mark.parametrize(
    "kind",
    [
        "task.missed",
        "commitment.overdue",
        "review.repeated_failure",
        "project.stale",
        "goal.stale",
    ],
)
def test_proactive_events_honor_assistant_message_policy(kind: str) -> None:
    assert resolve_event_visibility(kind, "assistant_message") == "assistant_message"


def test_deferred_recommendation_stays_internal() -> None:
    assert resolve_event_visibility("assistant.recommendation.deferred", None) == "internal"
    assert resolve_event_visibility("assistant.recommendation.deferred", "assistant_message") == "internal"
