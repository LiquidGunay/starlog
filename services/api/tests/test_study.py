import json

from fastapi.testclient import TestClient

from app.db.storage import get_connection


def _create_due_card(client: TestClient, auth_headers: dict[str, str]) -> dict:
    response = client.post(
        "/v1/cards",
        json={
            "prompt": "What is a gated recall card?",
            "answer": "A card that waits until its topic has been read.",
            "due_at": "2026-04-02T00:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.json()


def _create_source_and_topic(client: TestClient, auth_headers: dict[str, str]) -> tuple[dict, dict]:
    source_response = client.post(
        "/v1/study/sources",
        json={
            "title": "Graph Algorithms",
            "source_type": "manual",
            "metadata": {"course": "interview prep"},
        },
        headers=auth_headers,
    )
    assert source_response.status_code == 201
    source = source_response.json()

    topic_response = client.post(
        "/v1/study/topics",
        json={
            "source_id": source["id"],
            "title": "Breadth-first search",
            "summary": "Queue-based graph traversal.",
            "display_order": 1,
        },
        headers=auth_headers,
    )
    assert topic_response.status_code == 201
    topic = topic_response.json()
    assert topic["status"] == "locked"
    return source, topic


def test_study_topic_read_unblocks_gated_due_cards(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    card = _create_due_card(client, auth_headers)
    source, topic = _create_source_and_topic(client, auth_headers)

    link_response = client.post(
        "/v1/study/card-topic-links",
        json={"card_id": card["id"], "topic_id": topic["id"]},
        headers=auth_headers,
    )
    assert link_response.status_code == 201
    assert link_response.json()["gate_required"] is True

    due_before_read = client.get("/v1/cards/due", headers=auth_headers)
    assert due_before_read.status_code == 200
    assert card["id"] not in {item["id"] for item in due_before_read.json()}

    unlocked = client.post(f"/v1/study/topics/{topic['id']}/unlock", headers=auth_headers)
    assert unlocked.status_code == 200
    assert unlocked.json()["status"] == "unlocked"
    assert unlocked.json()["manually_unlocked"] is True

    due_after_unlock = client.get("/v1/cards/due", headers=auth_headers)
    assert due_after_unlock.status_code == 200
    assert card["id"] not in {item["id"] for item in due_after_unlock.json()}

    read = client.post(f"/v1/study/topics/{topic['id']}/read", headers=auth_headers)
    assert read.status_code == 200
    assert read.json()["status"] == "read"
    assert read.json()["read_at"] is not None

    due_after_read = client.get("/v1/cards/due", headers=auth_headers)
    assert due_after_read.status_code == 200
    assert card["id"] in {item["id"] for item in due_after_read.json()}

    with get_connection() as conn:
        domain_events = conn.execute(
            "SELECT event_type, payload_json FROM domain_events WHERE event_type = 'study.topic.read'"
        ).fetchall()
        surface_events = conn.execute(
            """
            SELECT source_surface, kind, visibility, entity_ref_json, payload_json
            FROM conversation_surface_events
            WHERE kind = 'study.topic.read'
            """
        ).fetchall()

    assert len(domain_events) == 1
    assert json.loads(domain_events[0]["payload_json"])["topic_id"] == topic["id"]
    assert len(surface_events) == 1
    assert surface_events[0]["source_surface"] == "review"
    assert surface_events[0]["visibility"] == "ambient"
    assert json.loads(surface_events[0]["entity_ref_json"])["entity_id"] == topic["id"]
    assert json.loads(surface_events[0]["payload_json"])["source_id"] == source["id"]


def test_study_primitives_record_chunks_practice_and_question_requests(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    source, topic = _create_source_and_topic(client, auth_headers)

    chunk = client.post(
        "/v1/study/source-chunks",
        json={
            "source_id": source["id"],
            "topic_id": topic["id"],
            "chunk_index": 0,
            "content": "BFS visits nodes by distance from the start node.",
            "metadata": {"page": 3},
        },
        headers=auth_headers,
    )
    assert chunk.status_code == 201
    assert chunk.json()["metadata"]["page"] == 3

    item = client.post(
        "/v1/study/practice-items",
        json={
            "source_id": source["id"],
            "topic_id": topic["id"],
            "prompt": "When is BFS useful?",
            "answer": "Shortest paths in unweighted graphs.",
        },
        headers=auth_headers,
    )
    assert item.status_code == 201
    item_payload = item.json()

    attempt = client.post(
        "/v1/study/practice-attempts",
        json={
            "practice_item_id": item_payload["id"],
            "rating": 4,
            "response_text": "Shortest path in unweighted graphs",
            "correct": True,
            "latency_ms": 1200,
        },
        headers=auth_headers,
    )
    assert attempt.status_code == 201
    assert attempt.json()["topic_id"] == topic["id"]
    assert attempt.json()["correct"] is True

    request = client.post(
        "/v1/study/question-requests",
        json={
            "topic_id": topic["id"],
            "question": "Give me a harder BFS practice question.",
        },
        headers=auth_headers,
    )
    assert request.status_code == 201
    request_payload = request.json()
    assert request_payload["source_id"] == source["id"]
    assert request_payload["status"] == "requested"

    with get_connection() as conn:
        domain_event = conn.execute(
            "SELECT payload_json FROM domain_events WHERE event_type = 'study.question.requested'"
        ).fetchone()
        surface_event = conn.execute(
            """
            SELECT source_surface, kind, visibility, entity_ref_json, payload_json
            FROM conversation_surface_events
            WHERE kind = 'study.question.requested'
            """
        ).fetchone()

    assert domain_event is not None
    assert json.loads(domain_event["payload_json"])["request_id"] == request_payload["id"]
    assert surface_event is not None
    assert surface_event["source_surface"] == "assistant"
    assert surface_event["visibility"] == "ambient"
    assert json.loads(surface_event["entity_ref_json"])["entity_id"] == request_payload["id"]
    assert json.loads(surface_event["payload_json"])["request_id"] == request_payload["id"]
