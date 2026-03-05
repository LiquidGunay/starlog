import json
from datetime import timedelta
from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _format_artifact(row: dict) -> dict:
    payload = dict(row)
    payload["metadata"] = payload.pop("metadata_json", {})
    return payload


def create_artifact(
    conn: Connection,
    source_type: str,
    title: str | None,
    raw_content: str | None,
    normalized_content: str | None,
    extracted_content: str | None,
    metadata: dict,
) -> dict:
    now = utc_now().isoformat()
    artifact_id = new_id("art")

    conn.execute(
        """
        INSERT INTO artifacts (id, source_type, title, raw_content, normalized_content, extracted_content,
                               metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            artifact_id,
            source_type,
            title,
            raw_content,
            normalized_content,
            extracted_content,
            json.dumps(metadata, sort_keys=True),
            now,
            now,
        ),
    )
    events_service.emit(
        conn,
        "artifact.created",
        {"artifact_id": artifact_id, "source_type": source_type},
    )
    conn.commit()
    created = get_artifact(conn, artifact_id)
    if created is None:
        raise RuntimeError("Artifact creation failed")
    return created


def list_artifacts(conn: Connection) -> list[dict]:
    rows = execute_fetchall(
        conn,
        """
        SELECT id, source_type, title, raw_content, normalized_content, extracted_content,
               metadata_json, created_at, updated_at
        FROM artifacts
        ORDER BY created_at DESC
        """,
    )
    return [_format_artifact(row) for row in rows]


def get_artifact(conn: Connection, artifact_id: str) -> dict | None:
    row = execute_fetchone(
        conn,
        """
        SELECT id, source_type, title, raw_content, normalized_content, extracted_content,
               metadata_json, created_at, updated_at
        FROM artifacts WHERE id = ?
        """,
        (artifact_id,),
    )
    if row is None:
        return None
    return _format_artifact(row)


def _next_version(conn: Connection, table: str, artifact_id: str) -> int:
    value = conn.execute(
        f"SELECT COALESCE(MAX(version), 0) FROM {table} WHERE artifact_id = ?",
        (artifact_id,),
    ).fetchone()[0]
    return int(value) + 1


def _create_summary(conn: Connection, artifact: dict) -> str:
    version = _next_version(conn, "summary_versions", str(artifact["id"]))
    text_source = (
        artifact.get("normalized_content")
        or artifact.get("extracted_content")
        or artifact.get("raw_content")
        or ""
    )
    excerpt = str(text_source).strip()[:400]
    summary_text = (
        "Summary draft (approve/edit):\n\n"
        f"- Key context: {artifact.get('title') or 'Untitled clip'}\n"
        f"- Main point: {excerpt or 'No source text available yet.'}"
    )

    summary_id = new_id("sum")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO summary_versions (id, artifact_id, version, content, provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (summary_id, artifact["id"], version, summary_text, "template", now),
    )
    conn.commit()
    return summary_id


def _create_cards(conn: Connection, artifact: dict) -> str:
    version = _next_version(conn, "card_set_versions", str(artifact["id"]))
    set_id = new_id("csv")
    now = utc_now()
    now_iso = now.isoformat()

    conn.execute(
        "INSERT INTO card_set_versions (id, artifact_id, version, created_at) VALUES (?, ?, ?, ?)",
        (set_id, artifact["id"], version, now_iso),
    )

    title = str(artifact.get("title") or "artifact")
    source = (
        str(artifact.get("normalized_content") or artifact.get("extracted_content") or artifact.get("raw_content") or "")
        .strip()
        .replace("\n", " ")
    )
    excerpt = source[:220] if source else "No content yet"

    cards = [
        (f"What is the core idea in '{title}'?", excerpt),
        (f"Which detail should you revisit from '{title}'?", excerpt[:120]),
    ]

    for prompt, answer in cards:
        conn.execute(
            """
            INSERT INTO cards (
              id, card_set_version_id, artifact_id, note_block_id, card_type, prompt, answer,
              due_at, interval_days, repetitions, ease_factor, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("crd"),
                set_id,
                artifact["id"],
                None,
                "qa",
                prompt,
                answer,
                (now + timedelta(days=1)).isoformat(),
                1,
                0,
                2.5,
                now_iso,
            ),
        )

    conn.commit()
    return set_id


def _create_task(conn: Connection, artifact: dict) -> str:
    now = utc_now().isoformat()
    task_id = new_id("tsk")
    title = f"Review clip: {artifact.get('title') or artifact['id']}"
    conn.execute(
        """
        INSERT INTO tasks (
          id, title, status, estimate_min, priority, due_at, linked_note_id, source_artifact_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (task_id, title, "todo", 15, 2, None, None, artifact["id"], now, now),
    )
    events_service.emit(
        conn,
        "task.suggested",
        {"task_id": task_id, "artifact_id": artifact["id"], "source": "artifact_action"},
    )
    conn.commit()
    return task_id


def _append_note(conn: Connection, artifact: dict) -> str:
    now = utc_now().isoformat()
    note_id = new_id("nte")
    body = (
        "# Clip Notes\n\n"
        f"Source: {artifact.get('title') or artifact['id']}\n\n"
        f"{artifact.get('normalized_content') or artifact.get('extracted_content') or ''}"
    )
    conn.execute(
        "INSERT INTO notes (id, title, body_md, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (note_id, artifact.get("title") or "Clip Note", body, 1, now, now),
    )
    conn.execute(
        "INSERT INTO note_blocks (id, note_id, artifact_id, block_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (new_id("blk"), note_id, artifact["id"], "paragraph", body[:500], now),
    )
    events_service.emit(
        conn,
        "note.suggested",
        {"note_id": note_id, "artifact_id": artifact["id"], "source": "artifact_action"},
    )
    conn.commit()
    return note_id


def run_action(conn: Connection, artifact_id: str, action: str) -> tuple[str, str | None]:
    artifact = get_artifact(conn, artifact_id)
    if artifact is None:
        return "not_found", None

    run_id = new_id("act")
    now = utc_now().isoformat()
    conn.execute(
        "INSERT INTO action_runs (id, artifact_id, action, status, output_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (run_id, artifact_id, action, "suggested", None, now),
    )
    conn.commit()

    output_ref: str | None = None
    if action == "summarize":
        output_ref = _create_summary(conn, artifact)
    elif action == "cards":
        output_ref = _create_cards(conn, artifact)
    elif action == "tasks":
        output_ref = _create_task(conn, artifact)
    elif action == "append_note":
        output_ref = _append_note(conn, artifact)

    conn.execute("UPDATE action_runs SET output_ref = ? WHERE id = ?", (output_ref, run_id))
    events_service.emit(
        conn,
        "artifact.action_suggested",
        {"artifact_id": artifact_id, "action": action, "output_ref": output_ref},
    )
    conn.commit()
    return "suggested", output_ref


def get_artifact_graph(conn: Connection, artifact_id: str) -> dict | None:
    artifact = get_artifact(conn, artifact_id)
    if artifact is None:
        return None

    summaries = execute_fetchall(
        conn,
        "SELECT id, artifact_id, version, content, provider, created_at FROM summary_versions WHERE artifact_id = ? ORDER BY version DESC",
        (artifact_id,),
    )
    cards = execute_fetchall(
        conn,
        """
        SELECT id, artifact_id, prompt, answer, card_type, due_at, interval_days, repetitions, ease_factor
        FROM cards
        WHERE artifact_id = ?
        ORDER BY created_at DESC
        """,
        (artifact_id,),
    )
    tasks = execute_fetchall(
        conn,
        """
        SELECT id, title, status, estimate_min, priority, due_at, linked_note_id, source_artifact_id
        FROM tasks
        WHERE source_artifact_id = ?
        ORDER BY created_at DESC
        """,
        (artifact_id,),
    )
    notes = execute_fetchall(
        conn,
        """
        SELECT DISTINCT n.id, n.title, n.body_md, n.version
        FROM notes n
        INNER JOIN note_blocks nb ON nb.note_id = n.id
        WHERE nb.artifact_id = ?
        ORDER BY n.updated_at DESC
        """,
        (artifact_id,),
    )

    return {
        "artifact": artifact,
        "summaries": summaries,
        "cards": cards,
        "tasks": tasks,
        "notes": notes,
    }
