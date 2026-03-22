from app.db.storage import get_connection


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
    assert any(ref["entity_type"] == "research_digest" for ref in payload["source_refs"])

    fetched = client.get("/v1/briefings/2026-03-22", headers=auth_headers)
    assert fetched.status_code == 200
    fetched_payload = fetched.json()
    assert fetched_payload["headline"] == payload["headline"]
    assert fetched_payload["recent_memories"]
