from datetime import datetime, timedelta, timezone
from sqlite3 import Connection

from app.core.time import utc_now
from app.services import events_service
from app.services.common import execute_fetchall, new_id


def _parse_utc(date: str, hour: int) -> datetime:
    return datetime.fromisoformat(f"{date}T{hour:02d}:00:00+00:00").astimezone(timezone.utc)


def generate_time_blocks(conn: Connection, date: str, day_start_hour: int, day_end_hour: int) -> list[dict]:
    start_cursor = _parse_utc(date, day_start_hour)
    end_limit = _parse_utc(date, day_end_hour)

    tasks = execute_fetchall(
        conn,
        """
        SELECT id, title, estimate_min, priority
        FROM tasks
        WHERE status IN ('todo', 'in_progress')
        ORDER BY priority DESC, COALESCE(due_at, '9999') ASC
        """,
    )

    generated: list[dict] = []
    now_iso = utc_now().isoformat()

    for task in tasks:
        estimate = int(task.get("estimate_min") or 30)
        block_start = start_cursor
        block_end = block_start + timedelta(minutes=estimate)

        if block_end > end_limit:
            break

        block_id = new_id("blkplan")
        conn.execute(
            """
            INSERT INTO time_blocks (id, task_id, title, starts_at, ends_at, locked, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                block_id,
                task["id"],
                f"Focus: {task['title']}",
                block_start.isoformat(),
                block_end.isoformat(),
                0,
                now_iso,
            ),
        )
        events_service.emit(
            conn,
            "time_block.generated",
            {"time_block_id": block_id, "task_id": task["id"], "date": date},
        )

        generated.append(
            {
                "id": block_id,
                "task_id": task["id"],
                "title": f"Focus: {task['title']}",
                "starts_at": block_start.isoformat(),
                "ends_at": block_end.isoformat(),
                "locked": False,
                "created_at": now_iso,
            }
        )

        start_cursor = block_end + timedelta(minutes=5)

    conn.commit()
    return generated


def list_blocks_for_date(conn: Connection, date: str) -> list[dict]:
    return execute_fetchall(
        conn,
        "SELECT id, task_id, title, starts_at, ends_at, locked, created_at FROM time_blocks WHERE starts_at LIKE ? ORDER BY starts_at ASC",
        (f"{date}%",),
    )
