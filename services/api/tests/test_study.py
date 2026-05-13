import json
from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.time import utc_now
from app.db.storage import get_connection
from app.services.common import new_id


def _create_due_card(client: TestClient, auth_headers: dict[str, str], *, prompt: str = "What is a gated recall card?") -> dict:
    response = client.post(
        "/v1/cards",
        json={
            "prompt": prompt,
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


def _create_topic(client: TestClient, auth_headers: dict[str, str], source_id: str, title: str, display_order: int) -> dict:
    topic_response = client.post(
        "/v1/study/topics",
        json={
            "source_id": source_id,
            "title": title,
            "summary": f"{title} summary.",
            "display_order": display_order,
        },
        headers=auth_headers,
    )
    assert topic_response.status_code == 201
    return topic_response.json()


def _link_card_to_topic(
    client: TestClient,
    auth_headers: dict[str, str],
    *,
    card_id: str,
    topic_id: str,
    gate_required: bool = False,
) -> dict:
    link_response = client.post(
        "/v1/study/card-topic-links",
        json={"card_id": card_id, "topic_id": topic_id, "gate_required": gate_required},
        headers=auth_headers,
    )
    assert link_response.status_code == 201
    return link_response.json()


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


def test_agent_study_read_command_unblocks_gated_due_card(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    card = _create_due_card(client, auth_headers, prompt="BFS gated card")
    _source, topic = _create_source_and_topic(client, auth_headers)
    _link_card_to_topic(client, auth_headers, card_id=card["id"], topic_id=topic["id"], gate_required=True)

    due_before_read = client.get("/v1/cards/due", headers=auth_headers)
    assert due_before_read.status_code == 200
    assert card["id"] not in {item["id"] for item in due_before_read.json()}

    command = client.post(
        "/v1/agent/command",
        json={"command": "I read Breadth-first search", "execute": True, "device_target": "web-pwa"},
        headers=auth_headers,
    )
    assert command.status_code == 200
    payload = command.json()
    assert payload["matched_intent"] == "mark_study_topic_read"
    assert payload["status"] == "executed"
    assert payload["steps"][0]["tool_name"] == "mark_study_topic_read"
    assert payload["steps"][0]["arguments"]["topic_id"] == topic["id"]
    assert payload["steps"][0]["result"]["topic"]["status"] == "read"

    due_after_read = client.get("/v1/cards/due", headers=auth_headers)
    assert due_after_read.status_code == 200
    assert card["id"] in {item["id"] for item in due_after_read.json()}


def test_agent_study_quiz_command_creates_topic_question_request(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    source, _topic = _create_source_and_topic(client, auth_headers)
    embeddings = _create_topic(client, auth_headers, source["id"], "Embeddings", 2)

    command = client.post(
        "/v1/agent/command",
        json={
            "command": "quiz me on application questions for embeddings",
            "execute": True,
            "device_target": "web-pwa",
        },
        headers=auth_headers,
    )
    assert command.status_code == 200
    payload = command.json()
    assert payload["matched_intent"] == "create_study_question_request"
    assert payload["steps"][0]["tool_name"] == "create_study_question_request"
    request = payload["steps"][0]["result"]["request"]
    assert request["topic_id"] == embeddings["id"]
    assert request["source_id"] == source["id"]
    assert request["question"] == "Quiz me on application questions for Embeddings"
    assert request["response"]["question_preference"] == "application"

    with get_connection() as conn:
        row = conn.execute(
            "SELECT topic_id, source_id, question, response_json FROM study_question_requests WHERE id = ?",
            (request["id"],),
        ).fetchone()

    assert row is not None
    assert row["topic_id"] == embeddings["id"]
    assert row["source_id"] == source["id"]
    assert row["question"] == "Quiz me on application questions for Embeddings"
    assert json.loads(row["response_json"])["question_preference"] == "application"


def test_agent_study_commands_expose_tools_and_intents(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    tools = client.get("/v1/agent/tools", headers=auth_headers)
    assert tools.status_code == 200
    tool_names = {item["name"] for item in tools.json()}
    assert {"mark_study_topic_read", "unlock_study_topic", "create_study_question_request"}.issubset(tool_names)

    intents = client.get("/v1/agent/intents", headers=auth_headers)
    assert intents.status_code == 200
    study_intent = next(item for item in intents.json() if item["name"] == "study_progress")
    assert "mark Breadth-first search read" in study_intent["examples"]
    assert "quiz me on application questions for embeddings" in study_intent["examples"]


def test_agent_study_topic_reference_errors_are_clear_400(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    source, _topic = _create_source_and_topic(client, auth_headers)
    _create_topic(client, auth_headers, source["id"], "Breadth-first spanning tree", 2)

    ambiguous = client.post(
        "/v1/agent/command",
        json={"command": "mark Breadth-first read", "execute": True, "device_target": "web-pwa"},
        headers=auth_headers,
    )
    assert ambiguous.status_code == 400
    assert "Ambiguous study topic reference 'Breadth-first'" in ambiguous.json()["detail"]

    unknown = client.post(
        "/v1/agent/command",
        json={"command": "unlock Dynamic programming", "execute": True, "device_target": "web-pwa"},
        headers=auth_headers,
    )
    assert unknown.status_code == 400
    assert unknown.json()["detail"] == "Study topic not found for reference: Dynamic programming"


def test_due_cards_prioritize_study_signals_then_due_date_fallback(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    low_review = _create_due_card(client, auth_headers, prompt="Low review card")
    practice_miss = _create_due_card(client, auth_headers, prompt="Practice miss card")
    question_request = _create_due_card(client, auth_headers, prompt="Question request card")
    topic_read = _create_due_card(client, auth_headers, prompt="Topic read card")
    plain_earlier = _create_due_card(client, auth_headers, prompt="Plain earlier card")
    plain_later = _create_due_card(client, auth_headers, prompt="Plain later card")

    source, read_topic = _create_source_and_topic(client, auth_headers)
    practice_topic = _create_topic(client, auth_headers, source["id"], "Practice misses", 2)
    question_topic = _create_topic(client, auth_headers, source["id"], "Question requests", 3)
    plain_topic = _create_topic(client, auth_headers, source["id"], "Plain fallback", 4)

    _link_card_to_topic(client, auth_headers, card_id=practice_miss["id"], topic_id=practice_topic["id"])
    _link_card_to_topic(client, auth_headers, card_id=question_request["id"], topic_id=question_topic["id"])
    _link_card_to_topic(client, auth_headers, card_id=topic_read["id"], topic_id=read_topic["id"], gate_required=True)
    _link_card_to_topic(client, auth_headers, card_id=plain_earlier["id"], topic_id=plain_topic["id"])
    _link_card_to_topic(client, auth_headers, card_id=plain_later["id"], topic_id=plain_topic["id"])

    read = client.post(f"/v1/study/topics/{read_topic['id']}/read", headers=auth_headers)
    assert read.status_code == 200
    item = client.post(
        "/v1/study/practice-items",
        json={
            "source_id": source["id"],
            "topic_id": practice_topic["id"],
            "prompt": "Miss this practice item.",
            "answer": "Try again.",
        },
        headers=auth_headers,
    )
    assert item.status_code == 201
    attempt = client.post(
        "/v1/study/practice-attempts",
        json={
            "practice_item_id": item.json()["id"],
            "rating": 1,
            "response_text": "Wrong",
            "correct": False,
        },
        headers=auth_headers,
    )
    assert attempt.status_code == 201
    request = client.post(
        "/v1/study/question-requests",
        json={"topic_id": question_topic["id"], "question": "Give me another graph traversal question."},
        headers=auth_headers,
    )
    assert request.status_code == 201

    now = utc_now()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO review_events (id, card_id, rating, latency_ms, reviewed_at) VALUES (?, ?, ?, ?, ?)",
            (new_id("rev"), low_review["id"], 1, 900, (now - timedelta(hours=1)).isoformat()),
        )
        conn.execute(
            "UPDATE cards SET due_at = ? WHERE id = ?",
            ((now - timedelta(days=10)).isoformat(), plain_earlier["id"]),
        )
        conn.execute(
            "UPDATE cards SET due_at = ? WHERE id = ?",
            ((now - timedelta(days=1)).isoformat(), plain_later["id"]),
        )
        conn.commit()

    due = client.get("/v1/cards/due?limit=6", headers=auth_headers)
    assert due.status_code == 200
    ordered_ids = [item["id"] for item in due.json()]

    assert ordered_ids[:6] == [
        low_review["id"],
        practice_miss["id"],
        question_request["id"],
        topic_read["id"],
        plain_earlier["id"],
        plain_later["id"],
    ]


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
        attempt_event = conn.execute(
            "SELECT payload_json FROM domain_events WHERE event_type = 'practice.attempt.logged'"
        ).fetchone()
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

    assert attempt_event is not None
    attempt_payload = json.loads(attempt_event["payload_json"])
    assert attempt_payload == {
        "attempt_id": attempt.json()["id"],
        "correct": True,
        "practice_item_id": item_payload["id"],
        "rating": 4,
        "topic_id": topic["id"],
    }
    assert domain_event is not None
    assert json.loads(domain_event["payload_json"])["request_id"] == request_payload["id"]
    assert surface_event is not None
    assert surface_event["source_surface"] == "assistant"
    assert surface_event["visibility"] == "ambient"
    assert json.loads(surface_event["entity_ref_json"])["entity_id"] == request_payload["id"]
    assert json.loads(surface_event["payload_json"])["request_id"] == request_payload["id"]


def test_study_progress_summary_counts_topics_and_due_unlocked_cards(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    card = _create_due_card(client, auth_headers)
    generic_card = _create_due_card(client, auth_headers, prompt="Generic SRS card")
    source, topic = _create_source_and_topic(client, auth_headers)

    link_response = client.post(
        "/v1/study/card-topic-links",
        json={"card_id": card["id"], "topic_id": topic["id"]},
        headers=auth_headers,
    )
    assert link_response.status_code == 201

    initial = client.get("/v1/study/progress", headers=auth_headers)
    assert initial.status_code == 200
    assert initial.json() == {
        "source_count": 1,
        "topic_count": 1,
        "read_topic_count": 0,
        "unlocked_topic_count": 0,
        "locked_topic_count": 1,
        "due_unlocked_card_count": 0,
    }

    unlocked = client.post(f"/v1/study/topics/{topic['id']}/unlock", headers=auth_headers)
    assert unlocked.status_code == 200
    unlocked_progress = client.get("/v1/study/progress", headers=auth_headers)
    assert unlocked_progress.status_code == 200
    assert unlocked_progress.json()["unlocked_topic_count"] == 1
    assert unlocked_progress.json()["locked_topic_count"] == 0
    assert unlocked_progress.json()["due_unlocked_card_count"] == 0

    read = client.post(f"/v1/study/topics/{topic['id']}/read", headers=auth_headers)
    assert read.status_code == 200
    read_progress = client.get("/v1/study/progress", headers=auth_headers)
    assert read_progress.status_code == 200
    assert read_progress.json() == {
        "source_count": 1,
        "topic_count": 1,
        "read_topic_count": 1,
        "unlocked_topic_count": 0,
        "locked_topic_count": 0,
        "due_unlocked_card_count": 1,
    }
    due_cards = client.get("/v1/cards/due", headers=auth_headers)
    assert due_cards.status_code == 200
    assert {card["id"], generic_card["id"]}.issubset({item["id"] for item in due_cards.json()})
