from fastapi.testclient import TestClient

from app.services import conversation_card_service


def test_goal_create_list_update(client: TestClient, auth_headers: dict[str, str]) -> None:
    created = client.post(
        "/v1/goals",
        headers=auth_headers,
        json={
            "title": "Build the learning engine",
            "horizon": "year",
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
        json={"status": "blocked", "open_questions": ["Which Planner view owns this?"]},
    )
    assert updated.status_code == 200
    assert updated.json()["goal_id"] == goal["id"]
    assert updated.json()["status"] == "blocked"
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
        json={"status": "recovered", "recovery_plan": "Send a shorter note now."},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "recovered"
    assert updated.json()["recovery_plan"] == "Send a shorter note now."


def test_strategic_context_cards_use_existing_contract_kinds() -> None:
    goal_card = conversation_card_service.goal_status_card(
        {
            "id": "goal_test",
            "title": "Learn deliberately",
            "horizon": "year",
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
