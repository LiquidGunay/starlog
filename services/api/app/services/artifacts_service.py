import json
from datetime import timedelta
from sqlite3 import Connection

from app.core.time import utc_now
from app.services import ai_service, events_service, integrations_service, memory_vault_service, srs_service
from app.services.common import execute_fetchall, execute_fetchone, new_id

DEFERRED_CAPABILITIES = {
    "summarize": "llm_summary",
    "cards": "llm_cards",
    "tasks": "llm_tasks",
}


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


def _record_relation(
    conn: Connection,
    artifact_id: str,
    relation_type: str,
    target_type: str,
    target_id: str,
) -> None:
    conn.execute(
        """
        INSERT INTO artifact_relations (id, artifact_id, relation_type, target_type, target_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (new_id("rel"), artifact_id, relation_type, target_type, target_id, utc_now().isoformat()),
    )


def _artifact_source_text(artifact: dict) -> str:
    return str(
        artifact.get("normalized_content")
        or artifact.get("extracted_content")
        or artifact.get("raw_content")
        or ""
    ).strip()


def _llm_text(output: dict, fallback: str) -> str:
    for key in ("summary", "text", "suggestion", "excerpt"):
        value = output.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def _task_suggestions(output: dict) -> list[dict]:
    tasks = output.get("tasks")
    if not isinstance(tasks, list):
        return []

    suggestions: list[dict] = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        title = str(task.get("title") or "").strip()
        if not title:
            continue
        suggestions.append(
            {
                "title": title,
                "estimate_min": int(task.get("estimate_min") or 15),
                "priority": int(task.get("priority") or 3),
            }
        )
    return suggestions


def _card_suggestions(output: dict) -> list[dict]:
    cards = output.get("cards")
    if not isinstance(cards, list):
        return []

    suggestions: list[dict] = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        prompt = str(card.get("prompt") or "").strip()
        answer = str(card.get("answer") or "").strip()
        if not prompt or not answer:
            continue
        suggestions.append(
            {
                "prompt": prompt,
                "answer": answer,
                "card_type": str(card.get("card_type") or "qa"),
            }
        )
    return suggestions


def _default_summary_text(artifact: dict) -> str:
    excerpt = _artifact_source_text(artifact)[:400]
    return (
        "Summary draft (approve/edit):\n\n"
        f"- Key context: {artifact.get('title') or 'Untitled clip'}\n"
        f"- Main point: {excerpt or 'No source text available yet.'}"
    )


def _create_summary_record(
    conn: Connection,
    artifact: dict,
    summary_text: str,
    provider: str,
) -> str:
    version = _next_version(conn, "summary_versions", str(artifact["id"]))
    summary_id = new_id("sum")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO summary_versions (id, artifact_id, version, content, provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (summary_id, artifact["id"], version, summary_text, provider, now),
    )
    _record_relation(conn, str(artifact["id"]), "artifact.summary_version", "summary_version", summary_id)
    memory_vault_service.promote_artifact_summary(
        conn,
        artifact=artifact,
        summary_id=summary_id,
        summary_text=summary_text,
    )
    conn.commit()
    return summary_id


def _default_card_rows(artifact: dict) -> list[dict]:
    title = str(artifact.get("title") or "artifact")
    source = _artifact_source_text(artifact).replace("\n", " ")
    excerpt = source[:220] if source else "No content yet"
    return [
        {"prompt": f"What is the core idea in '{title}'?", "answer": excerpt, "card_type": "qa"},
        {"prompt": f"Which detail should you revisit from '{title}'?", "answer": excerpt[:120], "card_type": "qa"},
    ]


def _create_card_set_record(conn: Connection, artifact: dict, cards: list[dict]) -> str:
    version = _next_version(conn, "card_set_versions", str(artifact["id"]))
    set_id = new_id("csv")
    now = utc_now()
    now_iso = now.isoformat()
    default_deck = srs_service.ensure_default_deck(conn)
    schedule = default_deck["schedule"]

    conn.execute(
        "INSERT INTO card_set_versions (id, artifact_id, version, created_at) VALUES (?, ?, ?, ?)",
        (set_id, artifact["id"], version, now_iso),
    )

    for card in cards[:5]:
        conn.execute(
            """
            INSERT INTO cards (
              id, card_set_version_id, artifact_id, note_block_id, deck_id, card_type, prompt, answer,
              tags_json, suspended, due_at, interval_days, repetitions, ease_factor, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("crd"),
                set_id,
                artifact["id"],
                None,
                default_deck["id"],
                card["card_type"],
                card["prompt"],
                card["answer"],
                json.dumps([], sort_keys=True),
                0,
                (now + timedelta(hours=int(schedule["new_cards_due_offset_hours"]))).isoformat(),
                int(schedule["initial_interval_days"]),
                0,
                float(schedule["initial_ease_factor"]),
                now_iso,
                now_iso,
            ),
        )

    _record_relation(conn, str(artifact["id"]), "artifact.card_set_version", "card_set_version", set_id)
    conn.commit()
    return set_id


def _default_task_rows(artifact: dict) -> list[dict]:
    return [
        {
            "title": f"Review clip: {artifact.get('title') or artifact['id']}",
            "estimate_min": 15,
            "priority": 2,
        }
    ]


def _create_task_records(conn: Connection, artifact: dict, suggestions: list[dict]) -> str:
    now = utc_now().isoformat()
    created_task_ids: list[str] = []
    for suggestion in suggestions[:3]:
        task_id = new_id("tsk")
        conn.execute(
            """
            INSERT INTO tasks (
              id, title, status, estimate_min, priority, due_at, linked_note_id, source_artifact_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                suggestion["title"],
                "todo",
                suggestion["estimate_min"],
                suggestion["priority"],
                None,
                None,
                artifact["id"],
                now,
                now,
            ),
        )
        events_service.emit(
            conn,
            "task.suggested",
            {"task_id": task_id, "artifact_id": artifact["id"], "source": "artifact_action"},
        )
        _record_relation(conn, str(artifact["id"]), "artifact.task", "task", task_id)
        created_task_ids.append(task_id)
    conn.commit()
    return created_task_ids[0]


def _create_summary(conn: Connection, artifact: dict) -> str:
    provider, _, output = ai_service.run(
        conn,
        "llm_summary",
        {
            "title": artifact.get("title") or "Untitled clip",
            "text": _artifact_source_text(artifact),
        },
        prefer_local=True,
    )
    summary_text = _llm_text(output, _default_summary_text(artifact))
    return _create_summary_record(conn, artifact, summary_text, provider)


def _create_cards(conn: Connection, artifact: dict) -> str:
    title = str(artifact.get("title") or "artifact")
    _, _, output = ai_service.run(
        conn,
        "llm_cards",
        {
            "title": title,
            "text": _artifact_source_text(artifact),
        },
        prefer_local=True,
    )
    cards = _card_suggestions(output) or _default_card_rows(artifact)
    return _create_card_set_record(conn, artifact, cards)


def _create_task(conn: Connection, artifact: dict) -> str:
    _, _, output = ai_service.run(
        conn,
        "llm_tasks",
        {
            "title": artifact.get("title") or artifact["id"],
            "text": _artifact_source_text(artifact),
        },
        prefer_local=True,
    )
    suggestions = _task_suggestions(output) or _default_task_rows(artifact)
    return _create_task_records(conn, artifact, suggestions)


def _append_note(conn: Connection, artifact: dict) -> str:
    now = utc_now().isoformat()
    note_id = new_id("nte")
    latest_summary = execute_fetchone(
        conn,
        "SELECT content FROM summary_versions WHERE artifact_id = ? ORDER BY version DESC LIMIT 1",
        (artifact["id"],),
    )
    summary_text = str(latest_summary["content"]) if latest_summary is not None else ""
    body = (
        "# Clip Notes\n\n"
        f"Source: {artifact.get('title') or artifact['id']}\n\n"
        f"{summary_text}\n\n{artifact.get('normalized_content') or artifact.get('extracted_content') or ''}".strip()
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
    _record_relation(conn, str(artifact["id"]), "artifact.note", "note", note_id)
    conn.commit()
    return note_id


def _apply_transcript(
    conn: Connection,
    artifact: dict,
    transcript: str,
    provider_used: str,
) -> str:
    now = utc_now().isoformat()
    metadata = dict(artifact.get("metadata") or {})
    metadata["transcription"] = {
        "provider": provider_used,
        "updated_at": now,
    }
    conn.execute(
        """
        UPDATE artifacts
        SET normalized_content = ?, extracted_content = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            transcript,
            transcript,
            json.dumps(metadata, sort_keys=True),
            now,
            artifact["id"],
        ),
    )
    events_service.emit(
        conn,
        "artifact.transcribed",
        {"artifact_id": artifact["id"], "provider_used": provider_used},
    )
    updated_artifact = get_artifact(conn, str(artifact["id"]))
    if updated_artifact is not None:
        memory_vault_service.index_artifact_capture(conn, updated_artifact, commit=False)
    conn.commit()
    return str(artifact["id"])


def apply_deferred_action_result(
    conn: Connection,
    artifact_id: str,
    action: str,
    output: dict,
    provider_used: str,
) -> str | None:
    artifact = get_artifact(conn, artifact_id)
    if artifact is None:
        return None

    if action == "summarize":
        summary_text = _llm_text(output, _default_summary_text(artifact))
        return _create_summary_record(conn, artifact, summary_text, provider_used)
    if action == "cards":
        cards = _card_suggestions(output) or _default_card_rows(artifact)
        return _create_card_set_record(conn, artifact, cards)
    if action == "tasks":
        suggestions = _task_suggestions(output) or _default_task_rows(artifact)
        return _create_task_records(conn, artifact, suggestions)
    if action == "transcribe":
        transcript = str(output.get("transcript") or "").strip() or _artifact_source_text(artifact)
        return _apply_transcript(conn, artifact, transcript, provider_used)
    if action == "append_note":
        return _append_note(conn, artifact)
    return None


def run_action(
    conn: Connection,
    artifact_id: str,
    action: str,
    defer: bool = False,
    provider_hint: str | None = None,
    user_id: str | None = None,
) -> tuple[str, str | None]:
    artifact = get_artifact(conn, artifact_id)
    if artifact is None:
        return "not_found", None

    run_id = new_id("act")
    now = utc_now().isoformat()
    conn.execute(
        "INSERT INTO action_runs (id, artifact_id, action, status, output_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (run_id, artifact_id, action, "running", None, now),
    )
    conn.commit()

    if defer and action in {"summarize", "cards", "tasks"}:
        from app.services import ai_jobs_service

        job = ai_jobs_service.create_job(
            conn,
            capability=DEFERRED_CAPABILITIES[action],
            payload={
                "title": artifact.get("title") or artifact_id,
                "text": _artifact_source_text(artifact),
            },
            provider_hint=provider_hint
            or integrations_service.default_batch_provider_hint(conn, DEFERRED_CAPABILITIES[action])
            or "desktop_bridge_codex",
            owner_user_id=user_id,
            requested_targets=integrations_service.capability_execution_order(
                conn,
                DEFERRED_CAPABILITIES[action],
                executable_targets={"mobile_bridge", "desktop_bridge", "api"},
                prefer_local=True,
            ),
            artifact_id=artifact_id,
            action=action,
        )
        conn.execute(
            "UPDATE action_runs SET status = ?, output_ref = ? WHERE id = ?",
            ("queued", job["id"], run_id),
        )
        events_service.emit(
            conn,
            "artifact.action_queued",
            {"artifact_id": artifact_id, "action": action, "job_id": job["id"]},
        )
        conn.commit()
        return "queued", str(job["id"])

    output_ref: str | None = None
    status_text = "completed"
    if action == "summarize":
        output_ref = _create_summary(conn, artifact)
    elif action == "cards":
        output_ref = _create_cards(conn, artifact)
    elif action == "tasks":
        output_ref = _create_task(conn, artifact)
    elif action == "append_note":
        output_ref = _append_note(conn, artifact)
    else:
        status_text = "failed"

    conn.execute("UPDATE action_runs SET status = ?, output_ref = ? WHERE id = ?", (status_text, output_ref, run_id))
    events_service.emit(
        conn,
        "artifact.action_suggested",
        {"artifact_id": artifact_id, "action": action, "output_ref": output_ref},
    )
    conn.commit()
    return status_text, output_ref


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
    relations = execute_fetchall(
        conn,
        """
        SELECT id, artifact_id, relation_type, target_type, target_id, created_at
        FROM artifact_relations
        WHERE artifact_id = ?
        ORDER BY created_at DESC
        """,
        (artifact_id,),
    )

    return {
        "artifact": artifact,
        "summaries": summaries,
        "cards": cards,
        "tasks": tasks,
        "notes": notes,
        "relations": relations,
    }


def get_artifact_versions(conn: Connection, artifact_id: str) -> dict | None:
    artifact = get_artifact(conn, artifact_id)
    if artifact is None:
        return None

    summaries = execute_fetchall(
        conn,
        "SELECT id, artifact_id, version, content, provider, created_at FROM summary_versions WHERE artifact_id = ? ORDER BY version DESC",
        (artifact_id,),
    )
    card_sets = execute_fetchall(
        conn,
        "SELECT id, artifact_id, version, created_at FROM card_set_versions WHERE artifact_id = ? ORDER BY version DESC",
        (artifact_id,),
    )
    actions = execute_fetchall(
        conn,
        "SELECT id, artifact_id, action, status, output_ref, created_at FROM action_runs WHERE artifact_id = ? ORDER BY created_at DESC",
        (artifact_id,),
    )

    return {
        "artifact_id": artifact_id,
        "summaries": summaries,
        "card_sets": card_sets,
        "actions": actions,
    }
