import json
from datetime import datetime
from sqlite3 import Connection, IntegrityError
from typing import Any

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, execute_fetchone, iso, new_id


class StrategicContextValidationError(ValueError):
    pass


def _clean_string_list(values: list[str] | None) -> list[str]:
    if not values:
        return []
    return [value.strip() for value in values if value.strip()]


def _format_project(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    payload = dict(row)
    payload["open_questions"] = _clean_string_list(payload.pop("open_questions_json", []))
    payload["risks"] = _clean_string_list(payload.pop("risks_json", []))
    return payload


def _format_projects(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [project for row in rows if (project := _format_project(row)) is not None]


def _ensure_goal_exists(conn: Connection, goal_id: str | None) -> None:
    if goal_id is None:
        return
    if execute_fetchone(conn, "SELECT id FROM goals WHERE id = ?", (goal_id,)) is None:
        raise StrategicContextValidationError("Goal not found")


def _ensure_task_exists(conn: Connection, task_id: str | None) -> None:
    if task_id is None:
        return
    if execute_fetchone(conn, "SELECT id FROM tasks WHERE id = ?", (task_id,)) is None:
        raise StrategicContextValidationError("Task not found")


def _json_list(values: list[str] | None) -> str:
    return json.dumps(_clean_string_list(values), sort_keys=True)


def _reject_null_required(changes: dict[str, Any], required_fields: set[str]) -> None:
    null_fields = sorted(field for field in required_fields if field in changes and changes[field] is None)
    if null_fields:
        raise StrategicContextValidationError(f"Required field cannot be null: {', '.join(null_fields)}")


def create_goal(
    conn: Connection,
    *,
    title: str,
    horizon: str,
    why: str | None,
    success_criteria: str | None,
    status: str,
    review_cadence: str,
) -> dict:
    now = utc_now().isoformat()
    goal_id = new_id("goal")
    conn.execute(
        """
        INSERT INTO goals (
          id, title, horizon, why, success_criteria, status, review_cadence,
          created_at, updated_at, last_reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (goal_id, title, horizon, why, success_criteria, status, review_cadence, now, now, None),
    )
    events_service.emit(conn, "goal.created", {"goal_id": goal_id, "title": title, "status": status})
    conn.commit()
    created = get_goal(conn, goal_id)
    if created is None:
        raise RuntimeError("Goal creation failed")
    return created


def list_goals(conn: Connection, *, status: str | None = None) -> list[dict]:
    if status:
        return execute_fetchall(conn, "SELECT * FROM goals WHERE status = ? ORDER BY updated_at DESC", (status,))
    return execute_fetchall(conn, "SELECT * FROM goals ORDER BY updated_at DESC")


def get_goal(conn: Connection, goal_id: str) -> dict | None:
    return execute_fetchone(conn, "SELECT * FROM goals WHERE id = ?", (goal_id,))


def update_goal(conn: Connection, goal_id: str, changes: dict[str, Any]) -> dict | None:
    current = get_goal(conn, goal_id)
    if current is None:
        return None
    _reject_null_required(changes, {"title", "horizon", "status", "review_cadence"})
    allowed = ("title", "horizon", "why", "success_criteria", "status", "review_cadence", "last_reviewed_at")
    merged = dict(current)
    for key in allowed:
        if key not in changes:
            continue
        value = changes[key]
        if isinstance(value, datetime):
            value = value.isoformat()
        merged[key] = value
    merged["updated_at"] = utc_now().isoformat()
    conn.execute(
        """
        UPDATE goals
        SET title = ?, horizon = ?, why = ?, success_criteria = ?, status = ?,
            review_cadence = ?, updated_at = ?, last_reviewed_at = ?
        WHERE id = ?
        """,
        (
            merged["title"],
            merged["horizon"],
            merged["why"],
            merged["success_criteria"],
            merged["status"],
            merged["review_cadence"],
            merged["updated_at"],
            iso(merged["last_reviewed_at"]),
            goal_id,
        ),
    )
    events_service.emit(conn, "goal.updated", {"goal_id": goal_id, "status": merged["status"]})
    conn.commit()
    return get_goal(conn, goal_id)


def create_project(
    conn: Connection,
    *,
    goal_id: str | None,
    title: str,
    desired_outcome: str | None,
    current_state: str | None,
    next_action_id: str | None,
    open_questions: list[str],
    risks: list[str],
    status: str,
) -> dict:
    _ensure_goal_exists(conn, goal_id)
    _ensure_task_exists(conn, next_action_id)
    now = utc_now().isoformat()
    project_id = new_id("proj")
    try:
        conn.execute(
            """
            INSERT INTO projects (
              id, goal_id, title, desired_outcome, current_state, next_action_id,
              open_questions_json, risks_json, status, created_at, updated_at, last_reviewed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                goal_id,
                title,
                desired_outcome,
                current_state,
                next_action_id,
                _json_list(open_questions),
                _json_list(risks),
                status,
                now,
                now,
                None,
            ),
        )
    except IntegrityError as exc:
        raise StrategicContextValidationError("Project linkage target not found") from exc
    events_service.emit(
        conn,
        "project.created",
        {"project_id": project_id, "goal_id": goal_id, "title": title, "status": status},
    )
    conn.commit()
    created = get_project(conn, project_id)
    if created is None:
        raise RuntimeError("Project creation failed")
    return created


def list_projects(conn: Connection, *, status: str | None = None, goal_id: str | None = None) -> list[dict]:
    clauses: list[str] = []
    params: list[str] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if goal_id:
        clauses.append("goal_id = ?")
        params.append(goal_id)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return _format_projects(
        execute_fetchall(conn, f"SELECT * FROM projects{where} ORDER BY updated_at DESC", tuple(params))
    )


def get_project(conn: Connection, project_id: str) -> dict | None:
    return _format_project(execute_fetchone(conn, "SELECT * FROM projects WHERE id = ?", (project_id,)))


def update_project(conn: Connection, project_id: str, changes: dict[str, Any]) -> dict | None:
    current = get_project(conn, project_id)
    if current is None:
        return None
    _reject_null_required(changes, {"title", "status"})
    if "goal_id" in changes:
        _ensure_goal_exists(conn, changes["goal_id"])
    if "next_action_id" in changes:
        _ensure_task_exists(conn, changes["next_action_id"])
    merged = dict(current)
    for key in (
        "goal_id",
        "title",
        "desired_outcome",
        "current_state",
        "next_action_id",
        "open_questions",
        "risks",
        "status",
        "last_reviewed_at",
    ):
        if key not in changes:
            continue
        value = changes[key]
        if isinstance(value, datetime):
            value = value.isoformat()
        merged[key] = value
    merged["updated_at"] = utc_now().isoformat()
    try:
        conn.execute(
            """
            UPDATE projects
            SET goal_id = ?, title = ?, desired_outcome = ?, current_state = ?,
                next_action_id = ?, open_questions_json = ?, risks_json = ?,
                status = ?, updated_at = ?, last_reviewed_at = ?
            WHERE id = ?
            """,
            (
                merged["goal_id"],
                merged["title"],
                merged["desired_outcome"],
                merged["current_state"],
                merged["next_action_id"],
                _json_list(merged["open_questions"]),
                _json_list(merged["risks"]),
                merged["status"],
                merged["updated_at"],
                iso(merged["last_reviewed_at"]),
                project_id,
            ),
        )
    except IntegrityError as exc:
        raise StrategicContextValidationError("Project linkage target not found") from exc
    events_service.emit(
        conn,
        "project.updated",
        {"project_id": project_id, "goal_id": merged["goal_id"], "status": merged["status"]},
    )
    conn.commit()
    return get_project(conn, project_id)


def create_commitment(
    conn: Connection,
    *,
    source_type: str,
    source_id: str | None,
    title: str,
    promised_to: str | None,
    due_at: datetime | None,
    status: str,
    recovery_plan: str | None,
) -> dict:
    now = utc_now().isoformat()
    commitment_id = new_id("com")
    conn.execute(
        """
        INSERT INTO commitments (
          id, source_type, source_id, title, promised_to, due_at, status,
          recovery_plan, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (commitment_id, source_type, source_id, title, promised_to, iso(due_at), status, recovery_plan, now, now),
    )
    events_service.emit(
        conn,
        "commitment.created",
        {"commitment_id": commitment_id, "source_type": source_type, "status": status},
    )
    conn.commit()
    created = get_commitment(conn, commitment_id)
    if created is None:
        raise RuntimeError("Commitment creation failed")
    return created


def list_commitments(conn: Connection, *, status: str | None = None, source_type: str | None = None) -> list[dict]:
    clauses: list[str] = []
    params: list[str] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if source_type:
        clauses.append("source_type = ?")
        params.append(source_type)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return execute_fetchall(conn, f"SELECT * FROM commitments{where} ORDER BY COALESCE(due_at, '9999') ASC, updated_at DESC", tuple(params))


def get_commitment(conn: Connection, commitment_id: str) -> dict | None:
    return execute_fetchone(conn, "SELECT * FROM commitments WHERE id = ?", (commitment_id,))


def update_commitment(conn: Connection, commitment_id: str, changes: dict[str, Any]) -> dict | None:
    current = get_commitment(conn, commitment_id)
    if current is None:
        return None
    _reject_null_required(changes, {"source_type", "title", "status"})
    merged = dict(current)
    for key in ("source_type", "source_id", "title", "promised_to", "due_at", "status", "recovery_plan"):
        if key not in changes:
            continue
        value = changes[key]
        if isinstance(value, datetime):
            value = value.isoformat()
        merged[key] = value
    merged["updated_at"] = utc_now().isoformat()
    conn.execute(
        """
        UPDATE commitments
        SET source_type = ?, source_id = ?, title = ?, promised_to = ?, due_at = ?,
            status = ?, recovery_plan = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            merged["source_type"],
            merged["source_id"],
            merged["title"],
            merged["promised_to"],
            iso(merged["due_at"]),
            merged["status"],
            merged["recovery_plan"],
            merged["updated_at"],
            commitment_id,
        ),
    )
    events_service.emit(conn, "commitment.updated", {"commitment_id": commitment_id, "status": merged["status"]})
    conn.commit()
    return get_commitment(conn, commitment_id)
