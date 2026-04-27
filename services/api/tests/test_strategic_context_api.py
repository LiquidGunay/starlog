from fastapi.testclient import TestClient

from app.services import conversation_card_service


def test_goal_create_list_update(client: TestClient, auth_headers: dict[str, str]) -> None:
    created = client.post(
        "/v1/goals",
        headers=auth_headers,
        json={
            "title": "Build the learning engine",
            "horizon": "long_term",
            "why": "Make daily learning compounding.",
            "success_criteria": "Daily review and project progress feel connected.",
            "review_cadence": "weekly",
        },
    )

    assert created.status_code == 201
    goal = created.json()
    assert goal["id"].startswith("goal_")
    assert goal["status"] == "active"
    assert goal["why"] == "Make daily learning compounding."

    listed = client.get("/v1/goals", headers=auth_headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [goal["id"]]

    updated = client.patch(
        f"/v1/goals/{goal['id']}",
        headers=auth_headers,
        json={"status": "paused", "last_reviewed_at": "2026-04-27T09:00:00Z"},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "paused"
    assert updated.json()["last_reviewed_at"] == "2026-04-27T09:00:00Z"


def test_project_create_list_update_links_to_goal(client: TestClient, auth_headers: dict[str, str]) -> None:
    goal = client.post(
        "/v1/goals",
        headers=auth_headers,
        json={"title": "Ship useful planning context"},
    ).json()

    created = client.post(
        "/v1/projects",
        headers=auth_headers,
        json={
            "goal_id": goal["id"],
            "title": "Assistant strategic context foundation",
            "desired_outcome": "Assistant can reference durable strategic objects.",
            "current_state": "Backend primitives are being added.",
            "open_questions": ["How should ranking use this later?", ""],
            "risks": ["Overbuilding v1"],
        },
    )

    assert created.status_code == 201
    project = created.json()
    assert project["goal_id"] == goal["id"]
    assert project["open_questions"] == ["How should ranking use this later?"]
    assert project["risks"] == ["Overbuilding v1"]

    listed = client.get(f"/v1/projects?goal_id={goal['id']}", headers=auth_headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [project["id"]]

    updated = client.patch(
        f"/v1/projects/{project['id']}",
        headers=auth_headers,
        json={"status": "paused", "open_questions": ["Which Planner view owns this?"]},
    )
    assert updated.status_code == 200
    assert updated.json()["goal_id"] == goal["id"]
    assert updated.json()["status"] == "paused"
    assert updated.json()["open_questions"] == ["Which Planner view owns this?"]


def test_project_rejects_missing_goal(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        "/v1/projects",
        headers=auth_headers,
        json={"goal_id": "goal_missing", "title": "Unlinked project"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Goal not found"


def test_commitment_create_list_update(client: TestClient, auth_headers: dict[str, str]) -> None:
    created = client.post(
        "/v1/commitments",
        headers=auth_headers,
        json={
            "source_type": "assistant",
            "source_id": "msg_123",
            "title": "Send the preview notes",
            "promised_to": "future self",
            "due_at": "2026-04-28T15:30:00Z",
        },
    )

    assert created.status_code == 201
    commitment = created.json()
    assert commitment["id"].startswith("com_")
    assert commitment["status"] == "open"

    listed = client.get("/v1/commitments?status=open", headers=auth_headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [commitment["id"]]

    updated = client.patch(
        f"/v1/commitments/{commitment['id']}",
        headers=auth_headers,
        json={"status": "done", "recovery_plan": "Sent a shorter note."},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "done"
    assert updated.json()["recovery_plan"] == "Sent a shorter note."


def test_goal_rejects_invalid_horizon(client: TestClient, auth_headers: dict[str, str]) -> None:
    created = client.post(
        "/v1/goals",
        headers=auth_headers,
        json={"title": "Ambiguous horizon", "horizon": "soonish"},
    )
    assert created.status_code == 422

    goal = client.post(
        "/v1/goals",
        headers=auth_headers,
        json={"title": "Concrete horizon", "horizon": "month"},
    ).json()
    updated = client.patch(
        f"/v1/goals/{goal['id']}",
        headers=auth_headers,
        json={"horizon": "eventually"},
    )
    assert updated.status_code == 422


def test_strategic_context_rejects_invalid_statuses(client: TestClient, auth_headers: dict[str, str]) -> None:
    invalid_goal = client.post(
        "/v1/goals",
        headers=auth_headers,
        json={"title": "Invalid goal status", "status": "in_progress"},
    )
    assert invalid_goal.status_code == 422

    invalid_project = client.post(
        "/v1/projects",
        headers=auth_headers,
        json={"title": "Invalid project status", "status": "blocked"},
    )
    assert invalid_project.status_code == 422

    invalid_commitment = client.post(
        "/v1/commitments",
        headers=auth_headers,
        json={"source_type": "assistant", "title": "Invalid commitment status", "status": "recovered"},
    )
    assert invalid_commitment.status_code == 422

    goal = client.post("/v1/goals", headers=auth_headers, json={"title": "Valid goal"}).json()
    invalid_goal_update = client.patch(
        f"/v1/goals/{goal['id']}",
        headers=auth_headers,
        json={"status": "in_progress"},
    )
    assert invalid_goal_update.status_code == 422

    project = client.post("/v1/projects", headers=auth_headers, json={"title": "Valid project"}).json()
    invalid_project_update = client.patch(
        f"/v1/projects/{project['id']}",
        headers=auth_headers,
        json={"status": "blocked"},
    )
    assert invalid_project_update.status_code == 422

    commitment = client.post(
        "/v1/commitments",
        headers=auth_headers,
        json={"source_type": "assistant", "title": "Valid commitment"},
    ).json()
    invalid_commitment_update = client.patch(
        f"/v1/commitments/{commitment['id']}",
        headers=auth_headers,
        json={"status": "recovered"},
    )
    assert invalid_commitment_update.status_code == 422


def test_strategic_context_cards_use_existing_contract_kinds() -> None:
    goal_card = conversation_card_service.goal_status_card(
        {
            "id": "goal_test",
            "title": "Learn deliberately",
            "horizon": "long_term",
            "status": "active",
            "review_cadence": "weekly",
            "last_reviewed_at": None,
        }
    )
    project_card = conversation_card_service.project_status_card(
        {
            "id": "proj_test",
            "goal_id": "goal_test",
            "title": "Build review loop",
            "status": "active",
            "current_state": "Designing",
            "desired_outcome": "Daily progress is visible.",
            "next_action_id": None,
            "open_questions": [],
            "risks": [],
            "last_reviewed_at": None,
        }
    )
    commitment_card = conversation_card_service.commitment_status_card(
        {
            "id": "com_test",
            "source_type": "assistant",
            "source_id": None,
            "title": "Review the plan",
            "promised_to": None,
            "due_at": None,
            "status": "open",
            "recovery_plan": None,
        }
    )

    assert goal_card["kind"] == "goal_status"
    assert project_card["kind"] == "project_status"
    assert commitment_card["kind"] == "commitment_status"
    assert goal_card["actions"][0]["payload"]["href"] == "/planner?goal=goal_test"


def test_strategic_context_cards_collect_active_records(client: TestClient, auth_headers: dict[str, str]) -> None:
    goal = client.post(
        "/v1/goals",
        headers=auth_headers,
        json={"title": "Keep strategy visible"},
    ).json()
    project = client.post(
        "/v1/projects",
        headers=auth_headers,
        json={"goal_id": goal["id"], "title": "Wire Assistant context"},
    ).json()
    commitment = client.post(
        "/v1/commitments",
        headers=auth_headers,
        json={"source_type": "assistant", "title": "Review context rail"},
    ).json()
    client.post(
        "/v1/goals",
        headers=auth_headers,
        json={"title": "Paused goal stays out", "status": "paused"},
    )

    from app.db.storage import get_connection

    with get_connection() as conn:
        cards = conversation_card_service.strategic_context_cards(conn, per_kind_limit=1)

    assert [card["kind"] for card in cards] == ["goal_status", "project_status", "commitment_status"]
    assert cards[0]["metadata"]["goal_id"] == goal["id"]
    assert cards[1]["metadata"]["project_id"] == project["id"]
    assert cards[2]["metadata"]["commitment_id"] == commitment["id"]
