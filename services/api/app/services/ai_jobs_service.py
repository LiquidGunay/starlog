import json
from sqlite3 import Connection
from typing import Sequence

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _job_payload(row: dict) -> dict:
    return {
        "id": row["id"],
        "capability": row["capability"],
        "status": row["status"],
        "provider_hint": row.get("provider_hint"),
        "provider_used": row.get("provider_used"),
        "owner_user_id": row.get("owner_user_id"),
        "artifact_id": row.get("artifact_id"),
        "action": row.get("action"),
        "requested_targets": row.get("requested_targets_json", []),
        "selected_target": row.get("selected_target"),
        "claimed_worker_class": row.get("claimed_worker_class"),
        "payload": row.get("payload_json", {}),
        "output": row.get("output_json", {}),
        "error_text": row.get("error_text"),
        "worker_id": row.get("worker_id"),
        "created_at": row["created_at"],
        "claimed_at": row.get("claimed_at"),
        "finished_at": row.get("finished_at"),
    }


def create_job(
    conn: Connection,
    capability: str,
    payload: dict,
    provider_hint: str | None = None,
    owner_user_id: str | None = None,
    artifact_id: str | None = None,
    action: str | None = None,
    requested_targets: list[str] | None = None,
    selected_target: str | None = None,
) -> dict:
    from app.services import integrations_service

    job_id = new_id("job")
    now = utc_now().isoformat()
    if requested_targets is None:
        requested_targets = integrations_service.capability_execution_order(
            conn,
            capability,
            executable_targets={"mobile_bridge", "desktop_bridge", "api"},
            prefer_local=True,
        )
    if selected_target is None:
        selected_target = requested_targets[0] if requested_targets else None
    conn.execute(
        """
        INSERT INTO ai_jobs (
          id, capability, status, provider_hint, provider_used, owner_user_id, artifact_id, action,
          requested_targets_json, selected_target, claimed_worker_class,
          payload_json, output_json, error_text, worker_id, created_at, claimed_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            capability,
            "pending",
            provider_hint,
            None,
            owner_user_id,
            artifact_id,
            action,
            json.dumps(requested_targets or [], sort_keys=True),
            selected_target,
            None,
            json.dumps(payload, sort_keys=True),
            json.dumps({}, sort_keys=True),
            None,
            None,
            now,
            None,
            None,
        ),
    )
    events_service.emit(
        conn,
        "ai.job_created",
        {"job_id": job_id, "capability": capability, "provider_hint": provider_hint},
    )
    conn.commit()
    created = get_job(conn, job_id)
    if created is None:
        raise RuntimeError("AI job creation failed")
    return created


def get_job(conn: Connection, job_id: str) -> dict | None:
    row = execute_fetchone(conn, "SELECT * FROM ai_jobs WHERE id = ?", (job_id,))
    return _job_payload(row) if row is not None else None


def list_jobs(
    conn: Connection,
    status: str | None = None,
    provider_hint: str | None = None,
    action: str | None = None,
    capability: str | None = None,
    limit: int = 50,
) -> list[dict]:
    clauses: list[str] = []
    params: list[object] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if provider_hint:
        clauses.append("provider_hint = ?")
        params.append(provider_hint)
    if action:
        clauses.append("action = ?")
        params.append(action)
    if capability:
        clauses.append("capability = ?")
        params.append(capability)

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = execute_fetchall(
        conn,
        f"SELECT * FROM ai_jobs {where_sql} ORDER BY created_at ASC LIMIT ?",
        tuple([*params, limit]),
    )
    return [_job_payload(row) for row in rows]


def claim_job(conn: Connection, job_id: str, worker_id: str) -> dict | None:
    return _claim_job(conn, job_id=job_id, worker_id=worker_id, worker_class=None, selected_target=None)


def _claim_job(
    conn: Connection,
    *,
    job_id: str,
    worker_id: str,
    worker_class: str | None,
    selected_target: str | None,
) -> dict | None:
    claimed_at = utc_now().isoformat()
    cursor = conn.execute(
        """
        UPDATE ai_jobs
        SET status = ?, worker_id = ?, claimed_at = ?, claimed_worker_class = COALESCE(?, claimed_worker_class),
            selected_target = COALESCE(?, selected_target)
        WHERE id = ? AND status = 'pending'
        """,
        ("running", worker_id, claimed_at, worker_class, selected_target, job_id),
    )
    conn.commit()
    if cursor.rowcount == 0:
        return None

    events_service.emit(
        conn,
        "ai.job_claimed",
        {
            "job_id": job_id,
            "worker_id": worker_id,
            "worker_class": worker_class,
            "selected_target": selected_target,
        },
    )
    conn.commit()
    return get_job(conn, job_id)


def claim_next_job_for_worker(
    conn: Connection,
    *,
    worker_id: str,
    worker_class: str,
    capabilities: Sequence[str],
) -> dict | None:
    from app.services import integrations_service, worker_service

    capability_set = {item for item in capabilities if item}
    if not capability_set:
        return None

    pending_rows = execute_fetchall(
        conn,
        "SELECT * FROM ai_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 200",
    )
    for row in pending_rows:
        capability = str(row.get("capability") or "")
        if capability not in capability_set:
            continue

        requested_targets = row.get("requested_targets_json")
        if not isinstance(requested_targets, list) or not requested_targets:
            requested_targets = integrations_service.capability_execution_order(
                conn,
                capability,
                executable_targets={"mobile_bridge", "desktop_bridge", "api"},
                prefer_local=True,
            )

        online_classes = worker_service.online_worker_classes_for_capability(conn, capability)
        selected_target: str | None = None
        for target in requested_targets:
            if not isinstance(target, str):
                continue
            if target == "api":
                selected_target = "api"
                break
            if target in {"mobile_bridge", "desktop_bridge"} and target in online_classes:
                selected_target = target
                break

        if selected_target != worker_class:
            continue

        claimed = _claim_job(
            conn,
            job_id=str(row["id"]),
            worker_id=worker_id,
            worker_class=worker_class,
            selected_target=selected_target,
        )
        if claimed is not None:
            return claimed
    return None


def cancel_job(conn: Connection, job_id: str, reason: str | None = None) -> dict | None:
    from app.services import assistant_event_service, artifacts_service

    job = get_job(conn, job_id)
    if job is None:
        return None
    if job["status"] not in {"pending", "running"}:
        raise ValueError("Job is not pending or running")

    finished_at = utc_now().isoformat()
    reason_text = (reason or "").strip() or "Cancelled by user."
    conn.execute(
        """
        UPDATE ai_jobs
        SET status = ?, error_text = ?, finished_at = ?
        WHERE id = ?
        """,
        ("cancelled", reason_text, finished_at, job_id),
    )

    if job.get("artifact_id") and job.get("action"):
        conn.execute(
            """
            UPDATE action_runs
            SET status = ?
            WHERE artifact_id = ? AND action = ? AND output_ref = ?
            """,
            ("cancelled", job["artifact_id"], job["action"], job_id),
        )
        artifact = artifacts_service.get_artifact(conn, str(job["artifact_id"]))
        if artifact is not None:
            try:
                assistant_event_service.reflect_artifact_action(
                    conn,
                    artifact=artifact,
                    action=str(job["action"]),
                    status="cancelled",
                    output_ref=str(job["id"]),
                    user_id=str(job.get("owner_user_id") or "").strip() or None,
                )
            except Exception:
                pass

    events_service.emit(
        conn,
        "ai.job_cancelled",
        {"job_id": job_id, "reason": reason_text, "worker_id": job.get("worker_id")},
    )
    conn.commit()
    return get_job(conn, job_id)


def complete_job(
    conn: Connection,
    job_id: str,
    worker_id: str,
    provider_used: str,
    output: dict,
) -> dict | None:
    from app.services import agent_command_service, artifacts_service, assistant_event_service, briefing_service

    job = get_job(conn, job_id)
    if job is None:
        return None
    if job["status"] != "running":
        raise ValueError("Job is not running")
    if job.get("worker_id") and job["worker_id"] != worker_id:
        raise ValueError("Job is claimed by a different worker")

    created_ref: str | None = None
    artifact_for_reflection: dict | None = None
    if job.get("artifact_id") and job.get("action"):
        artifact_for_reflection = artifacts_service.get_artifact(conn, str(job["artifact_id"]))
        created_ref = artifacts_service.apply_deferred_action_result(
            conn,
            artifact_id=str(job["artifact_id"]),
            action=str(job["action"]),
            output=output,
            provider_used=provider_used,
        )
        if created_ref:
            conn.execute(
                """
                UPDATE action_runs
                SET status = ?, output_ref = ?
                WHERE artifact_id = ? AND action = ? AND output_ref = ?
                """,
                ("completed", created_ref, job["artifact_id"], job["action"], job_id),
            )
        if artifact_for_reflection is not None:
            try:
                assistant_event_service.reflect_artifact_action(
                    conn,
                    artifact=artifact_for_reflection,
                    action=str(job["action"]),
                    status="completed",
                    output_ref=created_ref,
                    user_id=str(job.get("owner_user_id") or "").strip() or None,
                )
            except Exception:
                pass

    payload = dict(job.get("payload") or {})
    action = str(job.get("action") or "")
    if action == "briefing_audio":
        audio_ref = str(output.get("audio_ref") or output.get("blob_ref") or "").strip()
        briefing_package_id = str(payload.get("briefing_package_id") or "").strip()
        if audio_ref and briefing_package_id:
            briefing_service.attach_audio_ref(conn, briefing_package_id, audio_ref, provider_used)
            created_ref = audio_ref
    elif action == "assistant_command":
        transcript = str(output.get("transcript") or "").strip()
        assistant_payload = dict(payload.get("assistant_command") or {})
        if transcript:
            command_result = agent_command_service.run_command(
                conn,
                command=transcript,
                execute=bool(assistant_payload.get("execute", True)),
                device_target=str(assistant_payload.get("device_target") or "primary-device"),
            )
            output = {
                **output,
                "assistant_command": command_result.model_dump(mode="json"),
            }
        else:
            output = {
                **output,
                "assistant_command": {
                    "command": "",
                    "planner": "deterministic",
                    "matched_intent": "none",
                    "status": "failed",
                    "summary": "Voice command transcript was empty.",
                    "steps": [],
                },
            }
    elif action == "assistant_thread_voice":
        from app.services import assistant_projection_service, assistant_run_service, assistant_thread_service

        transcript = str(output.get("transcript") or "").strip()
        thread_payload = dict(payload.get("assistant_thread") or {})
        thread_id = str(thread_payload.get("thread_id") or "").strip() or "primary"
        request_metadata = dict(thread_payload.get("metadata") or {})
        device_target = str(thread_payload.get("device_target") or "mobile-native")
        if transcript:
            run_result = assistant_run_service.start_run(
                conn,
                thread_id=thread_id,
                content=transcript,
                input_mode=str(thread_payload.get("input_mode") or "voice"),
                device_target=device_target,
                metadata=request_metadata,
                user_id=str(job.get("owner_user_id") or "").strip() or None,
            )
            output = {
                **output,
                "assistant_thread": {
                    "thread_id": thread_id,
                    "run_id": run_result["run"]["id"],
                    "run_status": run_result["run"]["status"],
                    "user_message_id": run_result["user_message"]["id"],
                    "assistant_message_id": run_result["assistant_message"]["id"],
                    "transcript": transcript,
                },
            }
        else:
            assistant_thread_service.append_message(
                conn,
                thread_id=thread_id,
                role="assistant",
                status="error",
                metadata={
                    "voice_job_id": job_id,
                    "voice_transcription": "empty",
                    "request_metadata": request_metadata,
                },
                parts=[
                    assistant_projection_service.text_part(
                        "The voice message uploaded, but transcription returned no text. Try recording it again."
                    ),
                    assistant_projection_service.status_part("error", "Voice transcription empty"),
                ],
                user_id=str(job.get("owner_user_id") or "").strip() or None,
            )
            output = {
                **output,
                "assistant_thread": {
                    "thread_id": thread_id,
                    "run_id": None,
                    "run_status": "failed",
                    "user_message_id": None,
                    "assistant_message_id": None,
                    "transcript": "",
                },
            }
    elif action == "assistant_command_ai":
        assistant_payload = dict(payload.get("assistant_command") or {})
        command_result = agent_command_service.apply_ai_command_plan(
            conn,
            command=str(payload.get("command") or ""),
            execute=bool(assistant_payload.get("execute", True)),
            output=output,
        )
        output = {
            **output,
            "assistant_command": command_result.model_dump(mode="json"),
        }

    finished_at = utc_now().isoformat()
    conn.execute(
        """
        UPDATE ai_jobs
        SET status = ?, provider_used = ?, output_json = ?, error_text = ?, worker_id = ?, finished_at = ?
        WHERE id = ?
        """,
        (
            "completed",
            provider_used,
            json.dumps(output, sort_keys=True),
            None,
            worker_id,
            finished_at,
            job_id,
        ),
    )
    events_service.emit(
        conn,
        "ai.job_completed",
        {"job_id": job_id, "worker_id": worker_id, "provider_used": provider_used, "created_ref": created_ref},
    )
    conn.commit()
    return get_job(conn, job_id)


def fail_job(
    conn: Connection,
    job_id: str,
    worker_id: str,
    error_text: str,
    provider_used: str | None = None,
) -> dict | None:
    from app.services import assistant_event_service, artifacts_service

    job = get_job(conn, job_id)
    if job is None:
        return None
    if job["status"] != "running":
        raise ValueError("Job is not running")
    if job.get("worker_id") and job["worker_id"] != worker_id:
        raise ValueError("Job is claimed by a different worker")

    if job.get("artifact_id") and job.get("action"):
        conn.execute(
            """
            UPDATE action_runs
            SET status = ?
            WHERE artifact_id = ? AND action = ? AND output_ref = ?
            """,
            ("failed", job["artifact_id"], job["action"], job_id),
        )
        artifact = artifacts_service.get_artifact(conn, str(job["artifact_id"]))
        if artifact is not None:
            try:
                assistant_event_service.reflect_artifact_action(
                    conn,
                    artifact=artifact,
                    action=str(job["action"]),
                    status="failed",
                    output_ref=str(job["id"]),
                    user_id=str(job.get("owner_user_id") or "").strip() or None,
                )
            except Exception:
                pass

    if str(job.get("action") or "") == "assistant_thread_voice":
        from app.services import assistant_projection_service, assistant_thread_service

        payload = dict(job.get("payload") or {})
        thread_payload = dict(payload.get("assistant_thread") or {})
        thread_id = str(thread_payload.get("thread_id") or "").strip() or "primary"
        try:
            assistant_thread_service.append_message(
                conn,
                thread_id=thread_id,
                role="assistant",
                status="error",
                metadata={
                    "voice_job_id": job_id,
                    "voice_transcription": "failed",
                    "request_metadata": dict(thread_payload.get("metadata") or {}),
                },
                parts=[
                    assistant_projection_service.text_part(
                        "The voice message could not be transcribed. Try again when the speech worker is available."
                    ),
                    assistant_projection_service.status_part("error", "Voice transcription failed"),
                ],
                user_id=str(job.get("owner_user_id") or "").strip() or None,
            )
        except Exception:
            pass

    finished_at = utc_now().isoformat()
    conn.execute(
        """
        UPDATE ai_jobs
        SET status = ?, provider_used = ?, error_text = ?, worker_id = ?, finished_at = ?
        WHERE id = ?
        """,
        ("failed", provider_used, error_text, worker_id, finished_at, job_id),
    )
    events_service.emit(
        conn,
        "ai.job_failed",
        {"job_id": job_id, "worker_id": worker_id, "provider_used": provider_used, "error_text": error_text},
    )
    conn.commit()
    return get_job(conn, job_id)


def retry_job(conn: Connection, job_id: str, provider_hint: str | None = None) -> dict | None:
    job = get_job(conn, job_id)
    if job is None:
        return None
    if job["status"] not in {"failed", "cancelled"}:
        raise ValueError("Job is not failed or cancelled")

    next_provider_hint = provider_hint.strip() if isinstance(provider_hint, str) else None
    resolved_provider_hint = next_provider_hint or job.get("provider_hint")
    conn.execute(
        """
        UPDATE ai_jobs
        SET status = ?, provider_hint = ?, provider_used = ?, output_json = ?, error_text = ?, worker_id = ?, claimed_at = ?, finished_at = ?, claimed_worker_class = ?
        WHERE id = ?
        """,
        (
            "pending",
            resolved_provider_hint,
            None,
            json.dumps({}, sort_keys=True),
            None,
            None,
            None,
            None,
            None,
            job_id,
        ),
    )

    if job.get("artifact_id") and job.get("action"):
        conn.execute(
            """
            UPDATE action_runs
            SET status = ?, output_ref = ?
            WHERE artifact_id = ? AND action = ? AND output_ref = ?
            """,
            ("queued", job_id, job["artifact_id"], job["action"], job_id),
        )

    events_service.emit(
        conn,
        "ai.job_retried",
        {"job_id": job_id, "provider_hint": resolved_provider_hint},
    )
    conn.commit()
    return get_job(conn, job_id)
