from fastapi.testclient import TestClient

from app.db.storage import get_connection
from app.services import memory_vault_service


def test_memory_page_crud_and_versions(client: TestClient, auth_headers: dict[str, str]) -> None:
    created = client.post(
        "/v1/memory/pages",
        json={
            "title": "Memory system",
            "body_md": "Track durable notes and clip promotions.",
            "kind": "project",
            "namespace": "wiki/projects",
            "tags": ["memory", "clipper"],
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    page = created.json()
    assert page["path"].startswith("wiki/projects/")
    assert page["frontmatter"]["namespace"] == "wiki/projects"

    fetched = client.get(f"/v1/memory/pages/{page['id']}", headers=auth_headers)
    assert fetched.status_code == 200
    assert fetched.json()["markdown_source"].startswith("---\n")

    tree = client.get("/v1/memory/tree", headers=auth_headers)
    assert tree.status_code == 200
    assert "wiki/projects" in str(tree.json())

    updated = client.put(
        f"/v1/memory/pages/{page['id']}",
        json={
            "markdown_source": page["markdown_source"].replace(
                "Track durable notes and clip promotions.",
                "Track durable notes, clip promotions, and retrieval context.",
            ),
            "base_version": 1,
        },
        headers=auth_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["latest_version"] == 2

    versions = client.get(f"/v1/memory/pages/{page['id']}/versions", headers=auth_headers)
    assert versions.status_code == 200
    assert len(versions.json()) == 2


def test_memory_profile_proposals_and_suggestions(client: TestClient, auth_headers: dict[str, str]) -> None:
    with get_connection() as conn:
        proposal = memory_vault_service.create_profile_proposal(
            conn,
            title="Learning focus",
            body_md="Focus on memory retrieval, embeddings, and blocker analysis.",
            kind="goal",
            namespace="profile/goals",
            rationale="You repeatedly asked for blocker-driven memory suggestions.",
        )

    confirmed = client.post(
        f"/v1/memory/profile-proposals/{proposal['id']}/confirm",
        headers=auth_headers,
    )
    assert confirmed.status_code == 200
    confirmed_page = confirmed.json()
    assert confirmed_page["namespace"] == "profile/goals"

    artifact = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_browser",
            "capture_source": "browser_extension",
            "title": "Embeddings reference",
            "normalized": {"text": "Memory retrieval and embeddings design notes for blocker analysis."},
            "metadata": {"origin": "test"},
        },
        headers=auth_headers,
    )
    assert artifact.status_code == 201

    blocked_task = client.post(
        "/v1/tasks",
        json={"title": "Blocked on memory retrieval pipeline", "status": "blocked", "priority": 4},
        headers=auth_headers,
    )
    assert blocked_task.status_code == 201

    with get_connection() as conn:
        pending = memory_vault_service.create_profile_proposal(
            conn,
            title="Learning focus",
            body_md="Focus on memory retrieval, contradiction handling, and embeddings.",
            kind="goal",
            namespace="profile/goals",
            page_id=confirmed_page["id"],
            rationale="This proposal sharpens the confirmed goal with contradiction work.",
        )

    suggestions = client.get("/v1/memory/suggestions?surface=assistant", headers=auth_headers)
    assert suggestions.status_code == 200
    suggestion_types = {item["suggestion_type"] for item in suggestions.json()}
    assert "confirm_profile_update" in suggestion_types
    assert "learn_next_from_blocker" in suggestion_types
    assert "relevant_past_clip" in suggestion_types

    dismissed = client.post(
        f"/v1/memory/profile-proposals/{pending['id']}/dismiss",
        headers=auth_headers,
    )
    assert dismissed.status_code == 200
    assert dismissed.json()["status"] == "dismissed"


def test_memory_page_update_cannot_move_wiki_page_into_profile_namespace(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    created = client.post(
        "/v1/memory/pages",
        json={
            "title": "Project that stays wiki",
            "body_md": "Keep this in the wiki namespace.",
            "kind": "project",
            "namespace": "wiki/projects",
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    page = created.json()

    response = client.put(
        f"/v1/memory/pages/{page['id']}",
        json={
            "markdown_source": page["markdown_source"].replace("namespace: wiki/projects", "namespace: profile/goals"),
            "base_version": page["latest_version"],
        },
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert "confirmed profile proposal" in response.json()["detail"]
