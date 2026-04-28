from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services import review_mode_service
from app.services.common import execute_fetchall, execute_fetchone


def _count(conn: Connection, sql: str, params: tuple[Any, ...] = ()) -> int:
    row = execute_fetchone(conn, sql, params)
    if row is None:
        return 0
    return int(next(iter(row.values())) or 0)


def _bucket(key: str, label: str, count: int) -> dict[str, Any]:
    return {"key": key, "label": label, "count": int(count)}


def _today() -> date:
    return utc_now().date()


def _date_bounds(day: date) -> tuple[str, str]:
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start.isoformat(), end.isoformat()


def _parse_date(value: str | None) -> date:
    if not value:
        return _today()
    return date.fromisoformat(value)


def _source_breakdown(conn: Connection) -> list[dict[str, Any]]:
    rows = execute_fetchall(
        conn,
        """
        SELECT source_type AS key, source_type AS label, COUNT(*) AS count
        FROM artifacts
        GROUP BY source_type
        ORDER BY count DESC, source_type ASC
        """,
    )
    return [_bucket(str(row["key"]), str(row["label"]), int(row["count"] or 0)) for row in rows]


def _recent_artifacts(conn: Connection, limit: int = 8) -> list[dict[str, Any]]:
    return execute_fetchall(
        conn,
        """
        SELECT
          a.id,
          a.title,
          a.source_type,
          a.created_at,
          a.updated_at,
          (SELECT COUNT(*) FROM summary_versions sv WHERE sv.artifact_id = a.id) AS summary_count,
          (SELECT COUNT(*) FROM cards c WHERE c.artifact_id = a.id) AS card_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.source_artifact_id = a.id) AS task_count,
          (SELECT COUNT(DISTINCT nb.note_id) FROM note_blocks nb WHERE nb.artifact_id = a.id) AS note_count
        FROM artifacts a
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?
        """,
        (limit,),
    )


def _library_missing_count(conn: Connection, table_sql: str) -> int:
    return _count(
        conn,
        f"""
        SELECT COUNT(*)
        FROM artifacts a
        WHERE NOT EXISTS ({table_sql})
        """,
    )


def library_summary(conn: Connection) -> dict[str, Any]:
    generated_at = utc_now()
    recent_cutoff = (generated_at - timedelta(days=7)).isoformat()
    total_artifacts = _count(conn, "SELECT COUNT(*) FROM artifacts")
    summarized_artifacts = _count(
        conn,
        "SELECT COUNT(DISTINCT artifact_id) FROM summary_versions",
    )
    card_ready_artifacts = _count(conn, "SELECT COUNT(DISTINCT artifact_id) FROM cards WHERE artifact_id IS NOT NULL")
    task_linked_artifacts = _count(conn, "SELECT COUNT(DISTINCT source_artifact_id) FROM tasks WHERE source_artifact_id IS NOT NULL")
    note_linked_artifacts = _count(conn, "SELECT COUNT(DISTINCT artifact_id) FROM note_blocks WHERE artifact_id IS NOT NULL")
    unprocessed_artifacts = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM artifacts a
        WHERE NOT EXISTS (SELECT 1 FROM summary_versions sv WHERE sv.artifact_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.artifact_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_artifact_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM note_blocks nb WHERE nb.artifact_id = a.id)
        """,
    )

    note_row = execute_fetchone(
        conn,
        """
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END) AS recent_count,
          MAX(updated_at) AS latest_updated_at
        FROM notes
        """,
        (recent_cutoff,),
    ) or {}

    return {
        "status_buckets": [
            _bucket("total_artifacts", "Artifacts", total_artifacts),
            _bucket("unprocessed_artifacts", "Unprocessed captures", unprocessed_artifacts),
            _bucket("summarized_artifacts", "Summarized", summarized_artifacts),
            _bucket("card_ready_artifacts", "Cards ready", card_ready_artifacts),
            _bucket("task_linked_artifacts", "Tasks linked", task_linked_artifacts),
            _bucket("note_linked_artifacts", "Notes linked", note_linked_artifacts),
        ],
        "source_breakdown": _source_breakdown(conn),
        "recent_artifacts": _recent_artifacts(conn),
        "notes": {
            "total": int(note_row.get("total") or 0),
            "recent_count": int(note_row.get("recent_count") or 0),
            "latest_updated_at": note_row.get("latest_updated_at"),
        },
        "suggested_actions": [
            {
                "action": "summarize",
                "label": "Summarize unprocessed sources",
                "count": _library_missing_count(conn, "SELECT 1 FROM summary_versions sv WHERE sv.artifact_id = a.id"),
            },
            {
                "action": "cards",
                "label": "Generate review cards",
                "count": _library_missing_count(conn, "SELECT 1 FROM cards c WHERE c.artifact_id = a.id"),
            },
            {
                "action": "tasks",
                "label": "Extract tasks",
                "count": _library_missing_count(conn, "SELECT 1 FROM tasks t WHERE t.source_artifact_id = a.id"),
            },
            {
                "action": "append_note",
                "label": "Append to notes",
                "count": _library_missing_count(conn, "SELECT 1 FROM note_blocks nb WHERE nb.artifact_id = a.id"),
            },
        ],
        "generated_at": generated_at,
    }


def planner_summary(conn: Connection, *, day_value: str | None = None) -> dict[str, Any]:
    day = _parse_date(day_value)
    start, end = _date_bounds(day)
    generated_at = utc_now()

    open_tasks = _count(conn, "SELECT COUNT(*) FROM tasks WHERE status IN ('todo', 'in_progress')")
    in_progress_tasks = _count(conn, "SELECT COUNT(*) FROM tasks WHERE status = 'in_progress'")
    due_today_tasks = _count(
        conn,
        "SELECT COUNT(*) FROM tasks WHERE status NOT IN ('done', 'completed') AND due_at >= ? AND due_at < ?",
        (start, end),
    )
    overdue_tasks = _count(
        conn,
        "SELECT COUNT(*) FROM tasks WHERE status NOT IN ('done', 'completed') AND due_at IS NOT NULL AND due_at < ?",
        (start,),
    )
    unscheduled_tasks = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM tasks t
        WHERE t.status IN ('todo', 'in_progress')
          AND NOT EXISTS (SELECT 1 FROM time_blocks b WHERE b.task_id = t.id)
        """,
    )

    block_rows = execute_fetchone(
        conn,
        """
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN locked = 1 THEN 1 ELSE 0 END) AS fixed_count,
          SUM(CASE WHEN locked = 0 THEN 1 ELSE 0 END) AS flexible_count,
          SUM(CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END) AS focus_count,
          SUM(CASE WHEN locked = 0 AND (task_id IS NULL OR LOWER(title) LIKE '%buffer%') THEN 1 ELSE 0 END) AS buffer_count,
          SUM(CASE WHEN task_id IS NOT NULL THEN CAST(ROUND((julianday(ends_at) - julianday(starts_at)) * 24 * 60) AS INTEGER) ELSE 0 END) AS focus_minutes,
          SUM(CASE WHEN locked = 0 AND (task_id IS NULL OR LOWER(title) LIKE '%buffer%') THEN CAST(ROUND((julianday(ends_at) - julianday(starts_at)) * 24 * 60) AS INTEGER) ELSE 0 END) AS buffer_minutes
        FROM time_blocks
        WHERE starts_at >= ? AND starts_at < ?
        """,
        (start, end),
    ) or {}

    calendar_event_count = _count(
        conn,
        "SELECT COUNT(*) FROM calendar_events WHERE deleted = 0 AND starts_at < ? AND ends_at > ?",
        (end, start),
    )
    open_entity_conflicts = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM entity_conflicts
        WHERE status = 'open' AND entity_type IN ('task', 'time_block', 'calendar_event')
        """,
    )
    open_calendar_conflicts = _count(
        conn,
        "SELECT COUNT(*) FROM calendar_sync_conflicts WHERE resolved = 0",
    )

    return {
        "date": day.isoformat(),
        "task_buckets": [
            _bucket("open_tasks", "Open tasks", open_tasks),
            _bucket("in_progress_tasks", "In progress", in_progress_tasks),
            _bucket("due_today_tasks", "Due today", due_today_tasks),
            _bucket("overdue_tasks", "Overdue", overdue_tasks),
            _bucket("unscheduled_tasks", "Unscheduled", unscheduled_tasks),
        ],
        "block_buckets": [
            _bucket("fixed_blocks", "Fixed blocks", int(block_rows.get("fixed_count") or 0) + calendar_event_count),
            _bucket("flexible_blocks", "Flexible blocks", int(block_rows.get("flexible_count") or 0)),
            _bucket("focus_blocks", "Focus blocks", int(block_rows.get("focus_count") or 0)),
            _bucket("buffer_blocks", "Buffer blocks", int(block_rows.get("buffer_count") or 0)),
        ],
        "calendar_event_count": calendar_event_count,
        "conflict_count": open_entity_conflicts + open_calendar_conflicts,
        "focus_minutes": int(block_rows.get("focus_minutes") or 0),
        "buffer_minutes": int(block_rows.get("buffer_minutes") or 0),
        "generated_at": generated_at,
    }


def _mode_bucket_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts = {mode: 0 for mode in review_mode_service.REVIEW_MODE_ORDER}
    for row in rows:
        mode = review_mode_service.review_mode_for_card_type(str(row.get("card_type") or ""))
        counts[mode] += int(row.get("count") or 0)
    return [
        _bucket(mode, review_mode_service.MODE_BODY_LABELS[mode], counts[mode])
        for mode in review_mode_service.REVIEW_MODE_ORDER
    ]


def review_summary(conn: Connection) -> dict[str, Any]:
    now = utc_now()
    start, end = _date_bounds(now.date())
    due_soon = (now + timedelta(hours=24)).isoformat()

    due_mode_rows = execute_fetchall(
        conn,
        """
        SELECT card_type, COUNT(*) AS count
        FROM cards
        WHERE suspended = 0 AND due_at <= ?
        GROUP BY card_type
        """,
        (now.isoformat(),),
    )
    total_mode_rows = execute_fetchall(
        conn,
        """
        SELECT card_type, COUNT(*) AS count
        FROM cards
        WHERE suspended = 0
        GROUP BY card_type
        """,
    )
    deck_rows = execute_fetchall(
        conn,
        """
        SELECT COALESCE(d.name, 'Inbox') AS key, COALESCE(d.name, 'Inbox') AS label, COUNT(c.id) AS count
        FROM cards c
        LEFT JOIN card_decks d ON d.id = c.deck_id
        WHERE c.suspended = 0
        GROUP BY COALESCE(d.name, 'Inbox')
        ORDER BY count DESC, label ASC
        """,
    )
    health_row = execute_fetchone(
        conn,
        """
        SELECT
          SUM(CASE WHEN suspended = 0 AND due_at <= ? THEN 1 ELSE 0 END) AS due_count,
          SUM(CASE WHEN suspended = 0 AND due_at < ? THEN 1 ELSE 0 END) AS overdue_count,
          SUM(CASE WHEN suspended = 0 AND due_at <= ? THEN 1 ELSE 0 END) AS due_soon_count,
          SUM(CASE WHEN suspended = 1 THEN 1 ELSE 0 END) AS suspended_count
        FROM cards
        WHERE suspended = 0 OR suspended = 1
        """,
        (now.isoformat(), start, due_soon),
    ) or {}
    review_row = execute_fetchone(
        conn,
        """
        SELECT
          COUNT(*) AS reviewed_today_count,
          MAX(reviewed_at) AS last_reviewed_at,
          CAST(AVG(latency_ms) AS INTEGER) AS average_latency_ms
        FROM review_events
        WHERE reviewed_at >= ? AND reviewed_at < ?
        """,
        (start, end),
    ) or {}

    return {
        "ladder_counts": _mode_bucket_rows(due_mode_rows),
        "total_ladder_counts": _mode_bucket_rows(total_mode_rows),
        "deck_buckets": [_bucket(str(row["key"]), str(row["label"]), int(row["count"] or 0)) for row in deck_rows],
        "queue_health": {
            "due_count": int(health_row.get("due_count") or 0),
            "overdue_count": int(health_row.get("overdue_count") or 0),
            "due_soon_count": int(health_row.get("due_soon_count") or 0),
            "suspended_count": int(health_row.get("suspended_count") or 0),
            "reviewed_today_count": int(review_row.get("reviewed_today_count") or 0),
            "last_reviewed_at": review_row.get("last_reviewed_at"),
            "average_latency_ms": review_row.get("average_latency_ms"),
        },
        "generated_at": now,
    }


def assistant_today_summary(conn: Connection, *, user_id: str, day_value: str | None = None) -> dict[str, Any]:
    day = _parse_date(day_value)
    start, end = _date_bounds(day)
    generated_at = utc_now()

    thread = execute_fetchone(
        conn,
        """
        SELECT id
        FROM conversation_threads
        WHERE slug = 'primary' AND owner_user_id = ?
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (user_id,),
    )
    thread_id = str(thread["id"]) if thread else None

    active_run_count = 0
    open_interrupt_count = 0
    recent_surface_event_count = 0
    if thread_id:
        active_run_count = _count(
            conn,
            """
            SELECT COUNT(*)
            FROM conversation_runs
            WHERE thread_id = ? AND status NOT IN ('completed', 'cancelled', 'failed')
            """,
            (thread_id,),
        )
        open_interrupt_count = _count(
            conn,
            "SELECT COUNT(*) FROM conversation_interrupts WHERE thread_id = ? AND status IN ('open', 'pending')",
            (thread_id,),
        )
        recent_surface_event_count = _count(
            conn,
            "SELECT COUNT(*) FROM conversation_surface_events WHERE thread_id = ? AND created_at >= ? AND created_at < ?",
            (thread_id, start, end),
        )

    open_tasks = _count(conn, "SELECT COUNT(*) FROM tasks WHERE status IN ('todo', 'in_progress')")
    overdue_tasks = _count(
        conn,
        "SELECT COUNT(*) FROM tasks WHERE status NOT IN ('done', 'completed') AND due_at IS NOT NULL AND due_at < ?",
        (start,),
    )
    due_reviews = _count(conn, "SELECT COUNT(*) FROM cards WHERE suspended = 0 AND due_at <= ?", (generated_at.isoformat(),))
    unprocessed_library = _count(
        conn,
        """
        SELECT COUNT(*)
        FROM artifacts a
        WHERE NOT EXISTS (SELECT 1 FROM summary_versions sv WHERE sv.artifact_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.artifact_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_artifact_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM note_blocks nb WHERE nb.artifact_id = a.id)
        """,
    )
    open_commitments = _count(conn, "SELECT COUNT(*) FROM commitments WHERE status NOT IN ('done', 'completed', 'cancelled')")

    return {
        "date": day.isoformat(),
        "thread_id": thread_id,
        "active_run_count": active_run_count,
        "open_interrupt_count": open_interrupt_count,
        "recent_surface_event_count": recent_surface_event_count,
        "open_loops": [
            {"key": "open_tasks", "label": "Open tasks", "count": open_tasks, "href": "/planner"},
            {"key": "overdue_tasks", "label": "Overdue tasks", "count": overdue_tasks, "href": "/planner"},
            {"key": "due_reviews", "label": "Reviews due", "count": due_reviews, "href": "/review"},
            {"key": "unprocessed_library", "label": "Library inbox", "count": unprocessed_library, "href": "/library"},
            {"key": "open_commitments", "label": "Open commitments", "count": open_commitments, "href": "/planner"},
        ],
        "generated_at": generated_at,
    }
