from __future__ import annotations

from dataclasses import dataclass
from sqlite3 import Connection
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.agent import (
    AgentToolDefinition,
    CaptureTextToolArgs,
    CreateCalendarEventToolArgs,
    CreateTaskToolArgs,
    GenerateBriefingToolArgs,
    ListDueCardsToolArgs,
    RunArtifactActionToolArgs,
    ScheduleMorningBriefAlarmToolArgs,
    SearchStarlogToolArgs,
    SubmitReviewToolArgs,
    UpdateTaskToolArgs,
)
from app.services import (
    artifacts_service,
    briefing_service,
    calendar_service,
    capture_service,
    search_service,
    srs_service,
    tasks_service,
)


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    arg_model: type[BaseModel]
    backing_endpoint: str
    handler: Any


def _capture_text(conn: Connection, args: CaptureTextToolArgs) -> dict[str, Any]:
    artifact = capture_service.ingest_capture(
        conn,
        source_type=args.source_type,
        capture_source=args.capture_source,
        title=args.title,
        source_url=args.source_url,
        raw={"text": args.text, "mime_type": "text/plain"},
        normalized={"text": args.text, "mime_type": "text/plain"},
        extracted={"text": args.text, "mime_type": "text/plain"},
        tags=args.tags,
        metadata={**args.metadata, "origin": "agent_tool"},
    )
    return {"artifact": artifact}


def _run_artifact_action(conn: Connection, args: RunArtifactActionToolArgs) -> dict[str, Any]:
    status_text, output_ref = artifacts_service.run_action(
        conn,
        artifact_id=args.artifact_id,
        action=args.action,
        defer=args.defer,
        provider_hint=args.provider_hint,
    )
    return {
        "status": status_text,
        "output_ref": output_ref,
        "artifact_id": args.artifact_id,
        "action": args.action,
    }


def _create_task(conn: Connection, args: CreateTaskToolArgs) -> dict[str, Any]:
    task = tasks_service.create_task(
        conn,
        title=args.title,
        status=args.status,
        estimate_min=args.estimate_min,
        priority=args.priority,
        due_at=args.due_at,
        linked_note_id=args.linked_note_id,
        source_artifact_id=args.source_artifact_id,
    )
    return {"task": task}


def _update_task(conn: Connection, args: UpdateTaskToolArgs) -> dict[str, Any]:
    updated = tasks_service.update_task(
        conn,
        args.task_id,
        args.model_dump(exclude={"task_id"}, exclude_none=True),
    )
    if updated is None:
        raise LookupError(f"Task not found: {args.task_id}")
    return {"task": updated}


def _create_calendar_event(conn: Connection, args: CreateCalendarEventToolArgs) -> dict[str, Any]:
    event = calendar_service.create_event(
        conn,
        title=args.title,
        starts_at=args.starts_at,
        ends_at=args.ends_at,
        source=args.source,
        remote_id=None,
        etag=None,
    )
    return {"event": event}


def _generate_briefing(conn: Connection, args: GenerateBriefingToolArgs) -> dict[str, Any]:
    briefing = briefing_service.generate_briefing(conn, date=args.date, provider=args.provider)
    return {"briefing": briefing}


def _schedule_morning_brief_alarm(conn: Connection, args: ScheduleMorningBriefAlarmToolArgs) -> dict[str, Any]:
    briefing = briefing_service.get_latest_briefing_for_date(conn, args.date)
    if briefing is None:
        briefing = briefing_service.generate_briefing(conn, date=args.date, provider=args.provider)
    alarm = briefing_service.create_alarm_plan(
        conn,
        trigger_at=args.trigger_at,
        briefing_package_id=str(briefing["id"]),
        device_target=args.device_target,
    )
    return {"briefing": briefing, "alarm": alarm}


def _list_due_cards(conn: Connection, args: ListDueCardsToolArgs) -> list[dict[str, Any]]:
    return list(srs_service.due_cards(conn, args.limit))


def _submit_review(conn: Connection, args: SubmitReviewToolArgs) -> dict[str, Any]:
    review = srs_service.review_card(
        conn,
        card_id=args.card_id,
        rating=args.rating,
        latency_ms=args.latency_ms,
    )
    if review is None:
        raise LookupError(f"Card not found: {args.card_id}")
    return review


def _search_starlog(conn: Connection, args: SearchStarlogToolArgs) -> list[dict[str, Any]]:
    return list(search_service.search(conn, query=args.query, limit=args.limit))


TOOL_SPECS: dict[str, ToolSpec] = {
    "capture_text_as_artifact": ToolSpec(
        name="capture_text_as_artifact",
        description="Create a new text artifact in Starlog from chat or voice-transcribed content.",
        arg_model=CaptureTextToolArgs,
        backing_endpoint="/v1/capture",
        handler=_capture_text,
    ),
    "run_artifact_action": ToolSpec(
        name="run_artifact_action",
        description="Run or queue a Starlog artifact action such as summarize, create cards, generate tasks, or append note.",
        arg_model=RunArtifactActionToolArgs,
        backing_endpoint="/v1/artifacts/{artifact_id}/actions",
        handler=_run_artifact_action,
    ),
    "create_task": ToolSpec(
        name="create_task",
        description="Create a task in Starlog with optional due date, estimate, and source artifact linkage.",
        arg_model=CreateTaskToolArgs,
        backing_endpoint="/v1/tasks",
        handler=_create_task,
    ),
    "update_task": ToolSpec(
        name="update_task",
        description="Update an existing Starlog task status, priority, due date, or title.",
        arg_model=UpdateTaskToolArgs,
        backing_endpoint="/v1/tasks/{task_id}",
        handler=_update_task,
    ),
    "create_calendar_event": ToolSpec(
        name="create_calendar_event",
        description="Create an internal Starlog calendar event or time block anchor.",
        arg_model=CreateCalendarEventToolArgs,
        backing_endpoint="/v1/calendar/events",
        handler=_create_calendar_event,
    ),
    "generate_briefing": ToolSpec(
        name="generate_briefing",
        description="Generate a Starlog daily briefing package for a specific date.",
        arg_model=GenerateBriefingToolArgs,
        backing_endpoint="/v1/briefings/generate",
        handler=_generate_briefing,
    ),
    "schedule_morning_brief_alarm": ToolSpec(
        name="schedule_morning_brief_alarm",
        description="Generate or reuse a briefing for a date and create an alarm plan targeting a device.",
        arg_model=ScheduleMorningBriefAlarmToolArgs,
        backing_endpoint="/v1/alarms",
        handler=_schedule_morning_brief_alarm,
    ),
    "list_due_cards": ToolSpec(
        name="list_due_cards",
        description="List due cards for the current spaced-repetition review queue.",
        arg_model=ListDueCardsToolArgs,
        backing_endpoint="/v1/cards/due",
        handler=_list_due_cards,
    ),
    "submit_review": ToolSpec(
        name="submit_review",
        description="Submit a review rating for a Starlog card.",
        arg_model=SubmitReviewToolArgs,
        backing_endpoint="/v1/reviews",
        handler=_submit_review,
    ),
    "search_starlog": ToolSpec(
        name="search_starlog",
        description="Search across Starlog artifacts, notes, tasks, and calendar events.",
        arg_model=SearchStarlogToolArgs,
        backing_endpoint="/v1/search",
        handler=_search_starlog,
    ),
}


def list_tool_definitions() -> list[AgentToolDefinition]:
    return [
        AgentToolDefinition(
            name=spec.name,
            description=spec.description,
            parameters_schema=spec.arg_model.model_json_schema(),
            backing_endpoint=spec.backing_endpoint,
        )
        for spec in TOOL_SPECS.values()
    ]


def list_openai_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.arg_model.model_json_schema(),
            },
        }
        for spec in TOOL_SPECS.values()
    ]


def execute_tool(
    conn: Connection,
    tool_name: str,
    arguments: dict[str, Any],
    dry_run: bool = False,
) -> tuple[Literal["ok", "dry_run"], dict[str, Any], Any]:
    spec = TOOL_SPECS.get(tool_name)
    if spec is None:
        raise KeyError(f"Unknown tool: {tool_name}")

    validated = spec.arg_model.model_validate(arguments)
    normalized = validated.model_dump(mode="json", exclude_none=True)
    if dry_run:
        return "dry_run", normalized, {
            "description": spec.description,
            "backing_endpoint": spec.backing_endpoint,
        }
    result = spec.handler(conn, validated)
    return "ok", normalized, result
