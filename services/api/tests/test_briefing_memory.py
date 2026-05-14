from datetime import datetime, timedelta, timezone

from app.core.time import utc_now
from app.db.storage import get_connection
from app.services import memory_vault_service
from app.services.common import new_id


def _create_source_and_topic(client, auth_headers: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    source_response = client.post(
        "/v1/study/sources",
        json={"title": "Study source", "source_type": "manual"},
        headers=auth_headers,
    )
    assert source_response.status_code == 201
    source = source_response.json()

    topic_response = client.post(
        "/v1/study/topics",
        json={
            "source_id": source["id"],
            "title": "Priority topic",
            "summary": "Signals from this topic should prioritize cards.",
            "display_order": 1,
        },
        headers=auth_headers,
    )
    assert topic_response.status_code == 201
    return source, topic_response.json()


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def test_generate_briefing_surfaces_memory_and_recommendation_hints(client, auth_headers) -> None:
    task = client.post(
        "/v1/tasks",
        json={"title": "Write the project brief", "status": "todo", "priority": 4},
        headers=auth_headers,
    )
    assert task.status_code == 201
    task_id = task.json()["id"]

    event = client.post(
        "/v1/calendar/events",
        json={
            "title": "Project sync",
            "starts_at": "2026-03-22T10:00:00+00:00",
            "ends_at": "2026-03-22T10:30:00+00:00",
            "source": "internal",
        },
        headers=auth_headers,
    )
    assert event.status_code == 201
    event_id = event.json()["id"]

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO research_digests (id, digest_date, title, summary_md, items_json, provider, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "rdig_test_digest",
                "2026-03-22",
                "Top papers for systems work",
                "A compact systems digest.",
                '[{"id":"ritm_1","title":"Scheduling With Memory","summary":"Paper summary"}]',
                "test-suite",
                "2026-03-22T07:00:00+00:00",
            ),
        )
        memory_vault_service.create_profile_proposal(
            conn,
            title="Morning planning preference",
            body_md="Surface forgotten commitments in the morning briefing.",
            kind="preference",
            namespace="profile/preferences",
            rationale="The user wants proactive forgotten-item reminders.",
            commit=False,
        )
        conn.commit()

    generated = client.post(
        "/v1/briefings/generate",
        json={"date": "2026-03-22", "provider": "test-suite"},
        headers=auth_headers,
    )
    assert generated.status_code == 201
    payload = generated.json()

    assert payload["headline"] == "Starlog Briefing for 2026-03-22"
    section_kinds = {section["kind"] for section in payload["sections"]}
    assert {"tasks", "calendar", "review", "research"} <= section_kinds
    assert any(memory["entry_type"] == "briefing_summary" for memory in payload["recent_memories"])
    assert any(hint["entity_type"] == "task" and hint["entity_id"] == task_id for hint in payload["recommendation_hints"])
    assert any(
        hint["entity_type"] == "calendar_event" and hint["entity_id"] == event_id
        for hint in payload["recommendation_hints"]
    )
    assert any(item["suggestion_type"] == "confirm_profile_update" for item in payload["memory_suggestions"])
    assert any(ref["entity_type"] == "research_digest" for ref in payload["source_refs"])

    fetched = client.get("/v1/briefings/2026-03-22", headers=auth_headers)
    assert fetched.status_code == 200
    fetched_payload = fetched.json()
    assert fetched_payload["headline"] == payload["headline"]
    assert fetched_payload["recent_memories"]
    assert fetched_payload["memory_suggestions"]


def test_generate_briefing_review_pressure_prioritizes_low_review_and_study_signals(
    client,
    auth_headers: dict[str, str],
) -> None:
    low_review_card = client.post(
        "/v1/cards",
        json={
            "prompt": "Low-review card",
            "answer": "Priority from review misses.",
            "due_at": "2026-03-22T09:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert low_review_card.status_code == 201
    low_review_card_id = low_review_card.json()["id"]

    study_signal_card = client.post(
        "/v1/cards",
        json={
            "prompt": "Study-signal card",
            "answer": "Priority from study activity.",
            "due_at": "2026-03-22T09:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert study_signal_card.status_code == 201
    study_signal_card_id = study_signal_card.json()["id"]

    plain_card = client.post(
        "/v1/cards",
        json={
            "prompt": "Plain due card",
            "answer": "No review or study signal.",
            "due_at": "2026-03-22T09:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert plain_card.status_code == 201
    plain_card_id = plain_card.json()["id"]

    _, topic = _create_source_and_topic(client, auth_headers)
    link_response = client.post(
        "/v1/study/card-topic-links",
        json={"card_id": study_signal_card_id, "topic_id": topic["id"]},
        headers=auth_headers,
    )
    assert link_response.status_code == 201

    mark_read = client.post(f"/v1/study/topics/{topic['id']}/read", headers=auth_headers)
    assert mark_read.status_code == 200

    request = client.post(
        "/v1/study/question-requests",
        json={"topic_id": topic["id"], "question": "Give me a follow-up drill question."},
        headers=auth_headers,
    )
    assert request.status_code == 201

    now = utc_now()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO review_events (id, card_id, rating, latency_ms, reviewed_at) VALUES (?, ?, ?, ?, ?)",
            (new_id("rev"), low_review_card_id, 1, 800, _iso(now - timedelta(hours=1))),
        )
        conn.commit()

    generated = client.post(
        "/v1/briefings/generate",
        json={"date": "2026-03-22", "provider": "test-suite"},
        headers=auth_headers,
    )
    assert generated.status_code == 201
    payload = generated.json()

    review_section = next(section for section in payload["sections"] if section["kind"] == "review")
    review_item_ids = [item["metadata"]["card_id"] for item in review_section["items"]]
    assert review_item_ids[0] == study_signal_card_id
    assert review_item_ids.index(low_review_card_id) < review_item_ids.index(plain_card_id)
    assert review_item_ids.index(study_signal_card_id) < review_item_ids.index(plain_card_id)
    assert len(review_item_ids) >= 3

    review_hints = [hint for hint in payload["recommendation_hints"] if hint["signal_type"] == "briefing_review"]
    assert low_review_card_id in {hint["entity_id"] for hint in review_hints}
    assert study_signal_card_id in {hint["entity_id"] for hint in review_hints}
    assert plain_card_id in {hint["entity_id"] for hint in review_hints}

    scheduled = client.post(
        "/v1/agent/execute",
        json={
            "tool_name": "schedule_morning_brief_alarm",
            "arguments": {
                "date": "2026-03-22",
                "trigger_at": "2026-03-22T07:00:00+00:00",
                "device_target": "web-pwa",
            },
        },
        headers=auth_headers,
    )
    assert scheduled.status_code == 200
    alarm_payload = scheduled.json()
    assert alarm_payload["result"]["briefing"]["id"] == payload["id"]
    alarm_review_section = next(
        section for section in alarm_payload["result"]["briefing"]["sections"] if section["kind"] == "review"
    )
    assert alarm_payload["result"]["briefing"]["id"] == payload["id"]
    assert alarm_review_section["items"][0]["metadata"]["card_id"] == study_signal_card_id
