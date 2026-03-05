from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
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

    merged = dict(current)
    merged.update({k: v for k, v in changes.items() if v is not None})
    merged["updated_at"] = utc_now().isoformat()

    conn.execute(
        """
        UPDATE tasks
        SET title = ?, status = ?, estimate_min = ?, priority = ?, due_at = ?, linked_note_id = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            merged["title"],
            merged["status"],
            merged["estimate_min"],
            merged["priority"],
            iso(merged["due_at"]),
            merged["linked_note_id"],
            merged["updated_at"],
            task_id,
        ),
    )
    events_service.emit(
        conn,
        "task.updated",
        {"task_id": task_id, "status": merged["status"], "priority": merged["priority"]},
    )
    conn.commit()
    return get_task(conn, task_id)
