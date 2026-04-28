from fastapi.testclient import TestClient

from app.db.storage import get_connection


def _create_capture(client: TestClient, auth_headers: dict[str, str]) -> str:
    response = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_browser",
            "capture_source": "browser_ext",
            "title": "Library detail source",
            "source_url": "https://example.com/library-detail",
            "raw": {
                "text": "<html>" + ("raw capture text " * 40) + "</html>",
                "mime_type": "text/html",
                "checksum_sha256": "raw-checksum",
            },
            "normalized": {
                "text": "Normalized capture text for trustworthy provenance.",
                "mime_type": "text/plain",
            },
            "extracted": {"text": "Extracted capture text."},
            "tags": ["research", "library"],
            "metadata": {
                "capture": {
                    "capture_method": "browser_selection",
                    "source_file": "library-detail.html",
                }
            },
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    return str(response.json()["artifact"]["id"])


def _seed_connections(artifact_id: str) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO summary_versions (id, artifact_id, version, content, provider, created_at)
            VALUES
              ('sum_detail_1', ?, 1, 'First summary version', 'test', '2026-04-28T06:00:00+00:00'),
              ('sum_detail_2', ?, 2, 'Latest summary version for the detail panel', 'test', '2026-04-28T06:05:00+00:00')
            """,
            (artifact_id, artifact_id),
        )
        conn.execute(
            """
            INSERT INTO card_set_versions (id, artifact_id, version, created_at)
            VALUES ('csv_detail_1', ?, 1, '2026-04-28T06:06:00+00:00')
            """,
            (artifact_id,),
        )
        conn.executemany(
            """
            INSERT INTO cards (
              id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type,
              prompt, answer, tags_json, suspended, due_at, interval_days,
              repetitions, ease_factor, created_at, updated_at
            ) VALUES (?, 'csv_detail_1', ?, NULL, NULL, 'qa', ?, ?, '[]', 0,
              '2026-04-29T06:00:00+00:00', 1, 0, 2.5, '2026-04-28T06:06:00+00:00',
              '2026-04-28T06:06:00+00:00')
            """,
            [
                ("crd_detail_1", artifact_id, "Prompt one", "Answer one"),
                ("crd_detail_2", artifact_id, "Prompt two", "Answer two"),
            ],
        )
        conn.execute(
            """
            INSERT INTO tasks (
              id, title, status, estimate_min, priority, due_at, linked_note_id,
              source_artifact_id, created_at, updated_at
            ) VALUES ('tsk_detail_1', 'Review detail contract', 'todo', 15, 2, NULL,
              NULL, ?, '2026-04-28T06:07:00+00:00', '2026-04-28T06:07:00+00:00')
            """,
            (artifact_id,),
        )
        conn.execute(
            """
            INSERT INTO notes (id, title, body_md, version, created_at, updated_at)
            VALUES ('nte_detail_1', 'Detail note', 'Body', 3,
              '2026-04-28T06:08:00+00:00', '2026-04-28T06:08:00+00:00')
            """
        )
        conn.execute(
            """
            INSERT INTO note_blocks (id, note_id, artifact_id, block_type, content, created_at)
            VALUES ('blk_detail_1', 'nte_detail_1', ?, 'paragraph', 'Body',
              '2026-04-28T06:08:00+00:00')
            """,
            (artifact_id,),
        )
        conn.execute(
            """
            INSERT INTO action_runs (id, artifact_id, action, status, output_ref, created_at)
            VALUES
              ('act_detail_1', ?, 'summarize', 'completed', 'sum_detail_2', '2026-04-28T06:09:00+00:00'),
              ('act_detail_2', ?, 'cards', 'completed', 'csv_detail_1', '2026-04-28T06:10:00+00:00')
            """,
            (artifact_id, artifact_id),
        )
        conn.execute(
            """
            INSERT INTO artifact_relations (id, artifact_id, relation_type, target_type, target_id, created_at)
            VALUES ('rel_detail_1', ?, 'artifact.summary_version', 'summary_version', 'sum_detail_2',
              '2026-04-28T06:11:00+00:00')
            """,
            (artifact_id,),
        )
        conn.commit()


def test_artifact_detail_returns_provenance_connections_layers_and_actions(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    artifact_id = _create_capture(client, auth_headers)
    _seed_connections(artifact_id)

    response = client.get(f"/v1/artifacts/{artifact_id}/detail", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["artifact"] == {
        "id": artifact_id,
        "source_type": "clip_browser",
        "title": "Library detail source",
        "created_at": payload["artifact"]["created_at"],
        "updated_at": payload["artifact"]["updated_at"],
    }
    assert "raw_content" not in payload["artifact"]
    assert payload["capture"]["source_app"] == "browser_ext"
    assert payload["capture"]["source_url"] == "https://example.com/library-detail"
    assert payload["capture"]["source_file"] == "library-detail.html"
    assert payload["capture"]["capture_method"] == "browser_selection"
    assert payload["capture"]["tags"] == ["research", "library"]

    layers = {layer["layer"]: layer for layer in payload["source_layers"]}
    assert layers["raw"]["present"] is True
    assert layers["raw"]["mime_type"] == "text/html"
    assert layers["raw"]["checksum_sha256"] == "raw-checksum"
    assert layers["raw"]["character_count"] > 240
    assert layers["raw"]["preview"].endswith("...")
    assert layers["normalized"]["preview"] == "Normalized capture text for trustworthy provenance."
    assert layers["extracted"]["preview"] == "Extracted capture text."

    connections = payload["connections"]
    assert connections["summary_version_count"] == 2
    assert connections["latest_summary"]["id"] == "sum_detail_2"
    assert connections["latest_summary"]["version"] == 2
    assert connections["latest_summary"]["preview"] == "Latest summary version for the detail panel"
    assert connections["card_count"] == 2
    assert connections["card_set_version_count"] == 1
    assert connections["task_count"] == 1
    assert connections["note_count"] == 1
    assert connections["notes"] == [{"id": "nte_detail_1", "title": "Detail note", "version": 3}]
    assert connections["relation_count"] == 1
    relation = connections["relations"][0]
    assert relation["id"] == "rel_detail_1"
    assert relation["artifact_id"] == artifact_id
    assert relation["relation_type"] == "artifact.summary_version"
    assert relation["target_type"] == "summary_version"
    assert relation["target_id"] == "sum_detail_2"
    assert connections["action_run_count"] == 2

    timeline_kinds = {event["kind"] for event in payload["timeline"]}
    assert {"artifact.created", "capture.ingested", "summary.version_created", "action.summarize"} <= timeline_kinds

    actions = {action["action"]: action for action in payload["suggested_actions"]}
    assert actions["summarize"]["enabled"] is True
    assert actions["summarize"]["endpoint"] == f"/v1/artifacts/{artifact_id}/actions"
    assert actions["append_note"]["enabled"] is True
    assert actions["archive"]["enabled"] is False
    assert actions["link"]["enabled"] is False


def test_artifact_detail_does_not_report_fallback_normalized_layer_for_raw_only_capture(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/v1/capture",
        json={
            "source_type": "clip_manual",
            "capture_source": "manual_entry",
            "title": "Raw only",
            "raw": {"text": "Only raw text exists.", "mime_type": "text/plain"},
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    artifact_id = response.json()["artifact"]["id"]
    assert response.json()["artifact"]["normalized_content"] == "Only raw text exists."

    detail = client.get(f"/v1/artifacts/{artifact_id}/detail", headers=auth_headers)

    assert detail.status_code == 200
    layers = {layer["layer"]: layer for layer in detail.json()["source_layers"]}
    assert layers["raw"]["present"] is True
    assert layers["raw"]["preview"] == "Only raw text exists."
    assert layers["normalized"] == {
        "layer": "normalized",
        "present": False,
        "preview": None,
        "character_count": None,
        "mime_type": None,
        "checksum_sha256": None,
        "source_filename": None,
    }
    assert layers["extracted"]["present"] is False


def test_artifact_detail_404s_for_missing_artifact(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.get("/v1/artifacts/art_missing/detail", headers=auth_headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Artifact not found"
