from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services import review_mode_service, strategic_context_service
from app.services.common import execute_fetchall, execute_fetchone

OPEN_TASK_STATUSES_SQL = "status NOT IN ('done', 'completed', 'cancelled', 'canceled')"
STRATEGIC_CONTEXT_ITEM_LIMIT = 6
PROJECT_STALE_AFTER_DAYS = 14
# Goal cadence is intentionally simple and deterministic for the Today read model.
# Unknown cadence strings default to weekly so stale checks remain predictable.
GOAL_REVIEW_CADENCE_DAYS = {
    "daily": 1,
    "weekly": 7,
    "biweekly": 14,
    "monthly": 30,
    "quarterly": 90,
}
DEFAULT_GOAL_REVIEW_CADENCE_DAYS = 7


def _count(conn: Connection, sql: str, params: tuple[Any, ...] = ()) -> int:
    row = execute_fetchone(conn, sql, params)
    if row is None:
        return 0
    return int(next(iter(row.values())) or 0)


def _bucket(key: str, label: str, count: int) -> dict[str, Any]:
    return {"key": key, "label": label, "count": int(count)}


def _linked_bucket(key: str, label: str, count: int, href: str) -> dict[str, Any]:
    return {"key": key, "label": label, "count": int(count), "href": href}


def _count_phrase(count: int, singular: str, plural: str | None = None) -> str:
    noun = singular if count == 1 else (plural or f"{singular}s")
    return f"{count} {noun}"


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


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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
        f"SELECT COUNT(*) FROM tasks WHERE {OPEN_TASK_STATUSES_SQL} AND due_at >= ? AND due_at < ?",
        (start, end),
    )
    overdue_tasks = _count(
        conn,
        f"SELECT COUNT(*) FROM tasks WHERE {OPEN_TASK_STATUSES_SQL} AND due_at IS NOT NULL AND due_at < ?",
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


def _goal_review_threshold_days(review_cadence: str | None) -> int:
    return GOAL_REVIEW_CADENCE_DAYS.get((review_cadence or "").strip().lower(), DEFAULT_GOAL_REVIEW_CADENCE_DAYS)


def _strategic_goal_summary(goal: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": goal["id"],
        "title": goal["title"],
        "horizon": goal["horizon"],
        "review_cadence": goal["review_cadence"],
        "updated_at": goal["updated_at"],
        "last_reviewed_at": goal.get("last_reviewed_at"),
    }


def _strategic_project_summary(project: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": project["id"],
        "goal_id": project.get("goal_id"),
        "title": project["title"],
        "next_action_id": project.get("next_action_id"),
        "updated_at": project["updated_at"],
        "last_reviewed_at": project.get("last_reviewed_at"),
    }


def _strategic_commitment_summary(commitment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": commitment["id"],
        "source_type": commitment["source_type"],
        "source_id": commitment.get("source_id"),
        "title": commitment["title"],
        "promised_to": commitment.get("promised_to"),
        "due_at": commitment.get("due_at"),
        "updated_at": commitment["updated_at"],
    }


def _strategic_attention_items(
    *,
    active_goals: list[dict[str, Any]],
    active_projects: list[dict[str, Any]],
    open_commitments: list[dict[str, Any]],
    generated_at: datetime,
    overdue_before: datetime,
) -> list[dict[str, Any]]:
    attention_items: list[dict[str, Any]] = []

    for commitment in open_commitments:
        due_at = _parse_datetime(commitment.get("due_at"))
        if due_at is None or due_at >= overdue_before:
            continue
        attention_items.append(
            {
                "key": f"commitment_overdue:{commitment['id']}",
                "kind": "commitment_overdue",
                "title": commitment["title"],
                "body": "Open commitment is overdue.",
                "entity_type": "commitment",
                "entity_id": commitment["id"],
                "surface": "planner",
                "href": "/planner",
                "priority": 90,
                "due_at": commitment.get("due_at"),
            }
        )

    for project in active_projects:
        if project.get("next_action_id") is None:
            attention_items.append(
                {
                    "key": f"project_missing_next_action:{project['id']}",
                    "kind": "project_missing_next_action",
                    "title": project["title"],
                    "body": "Active project has no next action.",
                    "entity_type": "project",
                    "entity_id": project["id"],
                    "surface": "planner",
                    "href": "/planner",
                    "priority": 85,
                    "due_at": None,
                }
            )

        project_reviewed_at = _parse_datetime(project.get("last_reviewed_at")) or _parse_datetime(project.get("updated_at"))
        if project_reviewed_at is not None and project_reviewed_at <= generated_at - timedelta(days=PROJECT_STALE_AFTER_DAYS):
            attention_items.append(
                {
                    "key": f"project_stale:{project['id']}",
                    "kind": "project_stale",
                    "title": project["title"],
                    "body": f"Active project has not been reviewed in {PROJECT_STALE_AFTER_DAYS} days.",
                    "entity_type": "project",
                    "entity_id": project["id"],
                    "surface": "planner",
                    "href": "/planner",
                    "priority": 55,
                    "due_at": None,
                }
            )

    for goal in active_goals:
        cadence_days = _goal_review_threshold_days(goal.get("review_cadence"))
        reviewed_at = (
            _parse_datetime(goal.get("last_reviewed_at"))
            or _parse_datetime(goal.get("updated_at"))
            or _parse_datetime(goal.get("created_at"))
        )
        if reviewed_at is not None and reviewed_at <= generated_at - timedelta(days=cadence_days):
            attention_items.append(
                {
                    "key": f"goal_review_due:{goal['id']}",
                    "kind": "goal_review_due",
                    "title": goal["title"],
                    "body": f"Active goal has not been reviewed within its {goal['review_cadence']} cadence.",
                    "entity_type": "goal",
                    "entity_id": goal["id"],
                    "surface": "planner",
                    "href": "/planner",
                    "priority": 50,
                    "due_at": None,
                }
            )

    return sorted(attention_items, key=lambda item: (-int(item["priority"]), item["title"], item["key"]))


def _assistant_strategic_context(conn: Connection, *, generated_at: datetime, overdue_before: datetime) -> dict[str, Any]:
    active_goals = strategic_context_service.list_goals(conn, status="active")
    active_projects = strategic_context_service.list_projects(conn, status="active")
    open_commitments = strategic_context_service.list_commitments(conn, status="open")
    attention_items = _strategic_attention_items(
        active_goals=active_goals,
        active_projects=active_projects,
        open_commitments=open_commitments,
        generated_at=generated_at,
        overdue_before=overdue_before,
    )

    return {
        "active_goal_count": len(active_goals),
        "active_project_count": len(active_projects),
        "open_commitment_count": len(open_commitments),
        "overdue_commitment_count": sum(1 for item in attention_items if item["kind"] == "commitment_overdue"),
        "project_missing_next_action_count": sum(
            1 for item in attention_items if item["kind"] == "project_missing_next_action"
        ),
        "attention_count": len(attention_items),
        "active_goals": [_strategic_goal_summary(goal) for goal in active_goals[:STRATEGIC_CONTEXT_ITEM_LIMIT]],
        "active_projects": [
            _strategic_project_summary(project) for project in active_projects[:STRATEGIC_CONTEXT_ITEM_LIMIT]
        ],
        "open_commitments": [
            _strategic_commitment_summary(commitment) for commitment in open_commitments[:STRATEGIC_CONTEXT_ITEM_LIMIT]
        ],
        "attention_items": attention_items[:STRATEGIC_CONTEXT_ITEM_LIMIT],
    }


def _assistant_recommended_next_move(counts: dict[str, int]) -> dict[str, Any]:
    if counts["open_interrupt_count"] > 0:
        return {
            "key": "resolve_interrupt",
            "title": "Resolve pending assistant decision",
            "body": f"{_count_phrase(counts['open_interrupt_count'], 'assistant decision')} waiting before the current run can continue.",
            "surface": "assistant",
            "href": "/assistant",
            "action_label": "Review decision",
            "prompt": "Show my pending assistant decisions.",
            "priority": 100,
            "urgency": "high",
        }
    if counts["overdue_tasks"] > 0:
        return {
            "key": "clear_overdue_tasks",
            "title": "Clear overdue tasks",
            "body": f"{_count_phrase(counts['overdue_tasks'], 'task')} overdue and needs a decision today.",
            "surface": "planner",
            "href": "/planner",
            "action_label": "Open planner",
            "prompt": "Help me triage my overdue tasks.",
            "priority": 90,
            "urgency": "high",
        }
    if counts["overdue_commitments"] > 0:
        return {
            "key": "clear_overdue_commitments",
            "title": "Clear overdue commitments",
            "body": f"{_count_phrase(counts['overdue_commitments'], 'open commitment')} overdue and needs a decision today.",
            "surface": "planner",
            "href": "/planner",
            "action_label": "Open planner",
            "prompt": "Help me triage overdue commitments.",
            "priority": 90,
            "urgency": "high",
        }
    if counts["projects_missing_next_action"] > 0:
        return {
            "key": "define_project_next_action",
            "title": "Define next project action",
            "body": f"{_count_phrase(counts['projects_missing_next_action'], 'active project')} missing a next action.",
            "surface": "planner",
            "href": "/planner",
            "action_label": "Open planner",
            "prompt": "Help me define next actions for active projects.",
            "priority": 85,
            "urgency": "medium",
        }
    if counts["unprocessed_library"] > 0:
        return {
            "key": "process_library_inbox",
            "title": "Process new captures",
            "body": f"{_count_phrase(counts['unprocessed_library'], 'capture')} unprocessed in the library inbox.",
            "surface": "library",
            "href": "/library",
            "action_label": "Process captures",
            "prompt": "Help me process my unprocessed captures.",
            "priority": 80,
            "urgency": "medium",
        }
    if counts["due_reviews"] > 0:
        return {
            "key": "start_due_review",
            "title": "Start due review",
            "body": f"{_count_phrase(counts['due_reviews'], 'review card')} due now.",
            "surface": "review",
            "href": "/review",
            "action_label": "Start review",
            "prompt": "Start my due review queue.",
            "priority": 70,
            "urgency": "medium",
        }
    if counts["open_tasks"] > 0 or counts["open_commitments"] > 0:
        body_parts = []
        if counts["open_tasks"] > 0:
            body_parts.append(_count_phrase(counts["open_tasks"], "open task"))
        if counts["open_commitments"] > 0:
            body_parts.append(_count_phrase(counts["open_commitments"], "open commitment"))
        return {
            "key": "plan_open_loops",
            "title": "Plan open loops",
            "body": f"{' and '.join(body_parts)} ready to organize.",
            "surface": "planner",
            "href": "/planner",
            "action_label": "Plan today",
            "prompt": "Help me plan my open tasks and commitments.",
            "priority": 60,
            "urgency": "normal",
        }
    return {
        "key": "plan_today",
        "title": "Plan today",
        "body": "No urgent open loops are visible; choose the next focus for today.",
        "surface": "planner",
        "href": "/planner",
        "action_label": "Plan today",
        "prompt": "Help me plan today.",
        "priority": 10,
        "urgency": "low",
    }


def _assistant_reason_stack(counts: dict[str, int]) -> list[str]:
    reasons: list[str] = []
    if counts["open_interrupt_count"] > 0:
        reasons.append(f"{_count_phrase(counts['open_interrupt_count'], 'assistant decision')} pending")
    if counts["overdue_tasks"] > 0:
        reasons.append(f"{_count_phrase(counts['overdue_tasks'], 'task')} overdue")
    if counts["overdue_commitments"] > 0:
        reasons.append(f"{_count_phrase(counts['overdue_commitments'], 'commitment')} overdue")
    if counts["projects_missing_next_action"] > 0:
        reasons.append(f"{_count_phrase(counts['projects_missing_next_action'], 'active project')} missing a next action")
    if counts["unprocessed_library"] > 0:
        reasons.append(f"{_count_phrase(counts['unprocessed_library'], 'library capture')} unprocessed")
    if counts["due_reviews"] > 0:
        reasons.append(f"{_count_phrase(counts['due_reviews'], 'review card')} due")
    if len(reasons) < 4 and counts["open_commitments"] > 0:
        reasons.append(f"{_count_phrase(counts['open_commitments'], 'commitment')} open")
    if len(reasons) < 4 and counts["open_tasks"] > 0:
        reasons.append(f"{_count_phrase(counts['open_tasks'], 'task')} open")
    if len(reasons) < 4 and counts["active_run_count"] > 0:
        reasons.append(f"{_count_phrase(counts['active_run_count'], 'assistant run')} active")
    if reasons:
        return reasons[:4]
    return ["No pending interrupts, overdue tasks, unprocessed captures, or due reviews are visible."]


def _assistant_at_a_glance(counts: dict[str, int]) -> list[dict[str, Any]]:
    return [
        _linked_bucket("planner", "Planner", counts["open_tasks"], "/planner"),
        _linked_bucket("library", "Library inbox", counts["unprocessed_library"], "/library"),
        _linked_bucket("review", "Review due", counts["due_reviews"], "/review"),
        _linked_bucket("commitments", "Open commitments", counts["open_commitments"], "/planner"),
    ]


def _assistant_quick_actions(counts: dict[str, int]) -> list[dict[str, Any]]:
    unprocessed_library = counts["unprocessed_library"]
    due_reviews = counts["due_reviews"]
    return [
        {
            "key": "plan_today",
            "title": "Plan today",
            "surface": "planner",
            "href": "/planner",
            "action_label": "Plan today",
            "prompt": "Help me plan today.",
            "enabled": True,
            "count": counts["open_tasks"] + counts["open_commitments"],
            "reason": None,
            "priority": 10,
        },
        {
            "key": "process_captures",
            "title": "Process captures",
            "surface": "library",
            "href": "/library",
            "action_label": "Process captures",
            "prompt": (
                f"Help me process {_count_phrase(unprocessed_library, 'unprocessed capture')}."
                if unprocessed_library > 0
                else None
            ),
            "enabled": unprocessed_library > 0,
            "count": unprocessed_library,
            "reason": None if unprocessed_library > 0 else "No unprocessed captures.",
            "priority": 20,
        },
        {
            "key": "start_review",
            "title": "Start review",
            "surface": "review",
            "href": "/review",
            "action_label": "Start review",
            "prompt": f"Start my {_count_phrase(due_reviews, 'due review card')}." if due_reviews > 0 else None,
            "enabled": due_reviews > 0,
            "count": due_reviews,
            "reason": None if due_reviews > 0 else "No review cards due.",
            "priority": 30,
        },
        {
            "key": "create_task",
            "title": "Create task",
            "surface": "planner",
            "href": "/planner",
            "action_label": "Create task",
            "prompt": "Create a task.",
            "enabled": True,
            "count": 0,
            "reason": None,
            "priority": 40,
        },
    ]


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
        f"SELECT COUNT(*) FROM tasks WHERE {OPEN_TASK_STATUSES_SQL} AND due_at IS NOT NULL AND due_at < ?",
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
    open_commitments = _count(conn, "SELECT COUNT(*) FROM commitments WHERE status = 'open'")
    strategic_context = _assistant_strategic_context(
        conn,
        generated_at=generated_at,
        overdue_before=datetime(day.year, day.month, day.day, tzinfo=timezone.utc),
    )
    counts = {
        "active_run_count": active_run_count,
        "open_interrupt_count": open_interrupt_count,
        "recent_surface_event_count": recent_surface_event_count,
        "open_tasks": open_tasks,
        "overdue_tasks": overdue_tasks,
        "overdue_commitments": int(strategic_context["overdue_commitment_count"]),
        "projects_missing_next_action": int(strategic_context["project_missing_next_action_count"]),
        "due_reviews": due_reviews,
        "unprocessed_library": unprocessed_library,
        "open_commitments": open_commitments,
    }

    return {
        "date": day.isoformat(),
        "thread_id": thread_id,
        "active_run_count": active_run_count,
        "open_interrupt_count": open_interrupt_count,
        "recent_surface_event_count": recent_surface_event_count,
        "open_loops": [
            _linked_bucket("open_tasks", "Open tasks", open_tasks, "/planner"),
            _linked_bucket("overdue_tasks", "Overdue tasks", overdue_tasks, "/planner"),
            _linked_bucket("due_reviews", "Reviews due", due_reviews, "/review"),
            _linked_bucket("unprocessed_library", "Library inbox", unprocessed_library, "/library"),
            _linked_bucket("open_commitments", "Open commitments", open_commitments, "/planner"),
        ],
        "recommended_next_move": _assistant_recommended_next_move(counts),
        "reason_stack": _assistant_reason_stack(counts),
        "at_a_glance": _assistant_at_a_glance(counts),
        "quick_actions": _assistant_quick_actions(counts),
        "strategic_context": strategic_context,
        "generated_at": generated_at,
    }
