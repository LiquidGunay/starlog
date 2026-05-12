from types import SimpleNamespace

from app.services import assistant_projection_service
from app.services.assistant_event_service import _briefing_card_from_event_payload
from app.services.conversation_card_service import project_step_cards


def _assert_review_actions(card: dict, card_id: str) -> None:
    assert [action["label"] for action in card["actions"][:4]] == ["Again", "Hard", "Good", "Easy"]
    assert [action["payload"]["body"] for action in card["actions"][:4]] == [
        {"card_id": card_id, "rating": 1},
        {"card_id": card_id, "rating": 3},
        {"card_id": card_id, "rating": 4},
        {"card_id": card_id, "rating": 5},
    ]


def test_list_due_cards_projection_exposes_inline_review_actions() -> None:
    due_card = {
        "id": "card_123",
        "prompt": "Explain spaced repetition.",
        "answer": "Active recall over time.",
        "card_type": "qa",
    }

    list_result_card = project_step_cards(
        None,
        SimpleNamespace(tool_name="list_due_cards", result=[due_card]),
    )[0]
    assert list_result_card["kind"] == "review_queue"
    _assert_review_actions(list_result_card, "card_123")

    wrapped_result_card = project_step_cards(
        None,
        SimpleNamespace(tool_name="list_due_cards", result={"value": [due_card]}),
    )[0]
    assert wrapped_result_card["kind"] == "review_queue"
    _assert_review_actions(wrapped_result_card, "card_123")


def test_briefing_projection_preserves_audio_job_and_alarm_metadata() -> None:
    briefing = {
        "id": "briefing_123",
        "date": "2026-04-23",
        "text": "Morning briefing text.",
        "audio_ref": "media://briefing_123.mp3",
    }

    audio_card = project_step_cards(
        None,
        SimpleNamespace(
            tool_name="render_briefing_audio",
            result={"briefing": briefing, "job": {"id": "job_123", "action": "briefing_audio"}},
        ),
    )[0]
    assert audio_card["metadata"]["job_id"] == "job_123"
    assert audio_card["metadata"]["job_action"] == "briefing_audio"
    assert audio_card["metadata"]["audio_content_url"] == "/v1/media/briefing_123.mp3/content"

    alarm_card = project_step_cards(
        None,
        SimpleNamespace(
            tool_name="schedule_morning_brief_alarm",
            result={
                "briefing": briefing,
                "alarm": {
                    "id": "alarm_123",
                    "trigger_at": "2026-04-23T07:30:00+00:00",
                    "device_target": "android-phone",
                },
            },
        ),
    )[0]
    assert alarm_card["metadata"]["alarm_id"] == "alarm_123"
    assert alarm_card["metadata"]["alarm_trigger_at"] == "2026-04-23T07:30:00+00:00"
    assert alarm_card["metadata"]["alarm_device_target"] == "android-phone"


def test_briefing_surface_event_projection_includes_card_metadata() -> None:
    event_card = assistant_projection_service.card_part(
        _briefing_card_from_event_payload(
            entity_ref={
                "entity_type": "briefing",
                "entity_id": "briefing_456",
                "href": "/planner?briefing=briefing_456",
            },
            payload={
                "briefing_id": "briefing_456",
                "date": "2026-04-24",
                "body": "Briefing ready.",
                "sections": [{"kind": "schedule", "items": [{"title": "Focus"}]}],
                "source_refs": [{"type": "task", "id": "task_1"}],
            },
        )
    )

    assert event_card["type"] == "card"
    assert event_card["card"]["kind"] == "briefing"
    assert event_card["card"]["metadata"]["briefing_id"] == "briefing_456"
    assert event_card["card"]["metadata"]["section_count"] == 1
    assert event_card["card"]["metadata"]["source_refs"] == [{"type": "task", "id": "task_1"}]
