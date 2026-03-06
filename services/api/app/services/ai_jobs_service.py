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


def complete_job(
    conn: Connection,
    job_id: str,
    worker_id: str,
    provider_used: str,
    output: dict,
) -> dict | None:
    from app.services import artifacts_service

    job = get_job(conn, job_id)
    if job is None:
        return None

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
