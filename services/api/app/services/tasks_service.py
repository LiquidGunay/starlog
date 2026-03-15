from sqlite3 import Connection

from app.core.time import utc_now
from app.services import conflict_service, events_service
from app.services.common import execute_fetchall, execute_fetchone, iso, new_id


def create_task(
    conn: Connection,
    title: str,
    status: str,
    estimate_min: int | None,
    priority: int,
    due_at,
    linked_note_id: str | None,
    source_artifact_id: str | None,
) -> dict:
    now = utc_now().isoformat()
    task_id = new_id("tsk")
    conn.execute(
        """
        INSERT INTO tasks (
          id, title, status, estimate_min, priority, due_at,
          linked_note_id, source_artifact_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task_id,
            title,
            status,
            estimate_min,
            priority,
            iso(due_at),
            linked_note_id,
            source_artifact_id,
            now,
            now,
        ),
    )
    events_service.emit(
        conn,
        "task.created",
        {"task_id": task_id, "title": title, "source_artifact_id": source_artifact_id},
    )
    conn.commit()
    created = get_task(conn, task_id)
    if created is None:
        raise RuntimeError("Task creation failed")
    return created


def list_tasks(conn: Connection, status: str | None = None) -> list[dict]:
    if status:
        return execute_fetchall(
            conn,
            "SELECT * FROM tasks WHERE status = ? ORDER BY COALESCE(due_at, '9999') ASC, priority DESC",
            (status,),
        )
    return execute_fetchall(
        conn,
        "SELECT * FROM tasks ORDER BY COALESCE(due_at, '9999') ASC, priority DESC",
    )


def get_task(conn: Connection, task_id: str) -> dict | None:
    return execute_fetchone(conn, "SELECT * FROM tasks WHERE id = ?", (task_id,))


def update_task(conn: Connection, task_id: str, changes: dict) -> dict | None:
    current = get_task(conn, task_id)
    if current is None:
        return None

    local_payload: dict = {}
    for key in ("title", "status", "estimate_min", "priority", "due_at", "linked_note_id"):
        if key not in changes or changes[key] is None:
            continue
        value = changes[key]
        if key == "due_at":
            value = iso(value)
        local_payload[key] = value

    base_revision = changes.get("base_revision")
    current_revision = int(current["revision"])
    if base_revision is not None and int(base_revision) != current_revision:
        conflict = conflict_service.create_conflict(
            conn,
            entity_type="task",
            entity_id=task_id,
            operation="update",
            base_revision=int(base_revision),
            current_revision=current_revision,
            local_payload=local_payload,
            server_payload={
                "id": current["id"],
                "title": current["title"],
                "status": current["status"],
                "estimate_min": current["estimate_min"],
                "priority": current["priority"],
                "due_at": current["due_at"],
                "linked_note_id": current["linked_note_id"],
                "revision": current_revision,
                "updated_at": current["updated_at"],
            },
        )
        raise conflict_service.RevisionConflictError(conflict)

    merged = dict(current)
    merged.update(local_payload)
    merged["revision"] = current_revision + 1
    merged["updated_at"] = utc_now().isoformat()

    conn.execute(
        """
        UPDATE tasks
        SET title = ?, status = ?, estimate_min = ?, priority = ?, due_at = ?, linked_note_id = ?, revision = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            merged["title"],
            merged["status"],
            merged["estimate_min"],
            merged["priority"],
            iso(merged["due_at"]),
            merged["linked_note_id"],
            merged["revision"],
            merged["updated_at"],
            task_id,
        ),
    )
    events_service.emit(
        conn,
        "task.updated",
        {
            "task_id": task_id,
            "status": merged["status"],
            "priority": merged["priority"],
            "revision": merged["revision"],
        },
    )
    conn.commit()
    return get_task(conn, task_id)
