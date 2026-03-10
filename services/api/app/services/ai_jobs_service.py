import json
from sqlite3 import Connection

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
        "artifact_id": row.get("artifact_id"),
        "action": row.get("action"),
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
    artifact_id: str | None = None,
    action: str | None = None,
) -> dict:
    job_id = new_id("job")
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO ai_jobs (
          id, capability, status, provider_hint, provider_used, artifact_id, action,
          payload_json, output_json, error_text, worker_id, created_at, claimed_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            capability,
            "pending",
            provider_hint,
            None,
            artifact_id,
            action,
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
    claimed_at = utc_now().isoformat()
    cursor = conn.execute(
        """
        UPDATE ai_jobs
        SET status = ?, worker_id = ?, claimed_at = ?
        WHERE id = ? AND status = 'pending'
        """,
        ("running", worker_id, claimed_at, job_id),
    )
    conn.commit()
    if cursor.rowcount == 0:
        return None

    events_service.emit(conn, "ai.job_claimed", {"job_id": job_id, "worker_id": worker_id})
    conn.commit()
    return get_job(conn, job_id)


def cancel_job(conn: Connection, job_id: str, reason: str | None = None) -> dict | None:
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
    from app.services import agent_command_service, artifacts_service, briefing_service

    job = get_job(conn, job_id)
    if job is None:
        return None
    if job["status"] != "running":
        raise ValueError("Job is not running")
    if job.get("worker_id") and job["worker_id"] != worker_id:
        raise ValueError("Job is claimed by a different worker")

    created_ref: str | None = None
    if job.get("artifact_id") and job.get("action"):
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
        SET status = ?, provider_hint = ?, provider_used = ?, output_json = ?, error_text = ?, worker_id = ?, claimed_at = ?, finished_at = ?
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
