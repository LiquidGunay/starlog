from __future__ import annotations

from dataclasses import dataclass
from sqlite3 import Connection
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.agent import (
    AgentToolDefinition,
    CaptureTextToolArgs,
    CreateCalendarEventToolArgs,
    CreateNoteToolArgs,
    CreateTaskToolArgs,
    GenerateBriefingToolArgs,
    GenerateTimeBlocksToolArgs,
    GetArtifactGraphToolArgs,
    GetExecutionPolicyToolArgs,
    GetNoteToolArgs,
    ListArtifactsToolArgs,
    ListCalendarEventsToolArgs,
    ListDueCardsToolArgs,
    ListNotesToolArgs,
    ListTasksToolArgs,
    RunArtifactActionToolArgs,
    ScheduleMorningBriefAlarmToolArgs,
    SearchStarlogToolArgs,
    SetExecutionPolicyToolArgs,
    SubmitReviewToolArgs,
    UpdateNoteToolArgs,
    UpdateTaskToolArgs,
)
from app.services import (
    artifacts_service,
    briefing_service,
    calendar_service,
    capture_service,
    integrations_service,
    notes_service,
    planning_service,
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


def _list_artifacts(conn: Connection, args: ListArtifactsToolArgs) -> dict[str, Any]:
    artifacts = artifacts_service.list_artifacts(conn)
    return {"artifacts": artifacts[: args.limit]}


def _get_artifact_graph(conn: Connection, args: GetArtifactGraphToolArgs) -> dict[str, Any]:
    graph = artifacts_service.get_artifact_graph(conn, args.artifact_id)
    if graph is None:
        raise LookupError(f"Artifact not found: {args.artifact_id}")
    return {"graph": graph}


def _create_note(conn: Connection, args: CreateNoteToolArgs) -> dict[str, Any]:
    note = notes_service.create_note(conn, title=args.title, body_md=args.body_md)
    return {"note": note}


def _update_note(conn: Connection, args: UpdateNoteToolArgs) -> dict[str, Any]:
    updated = notes_service.update_note(
        conn,
        args.note_id,
        args.model_dump(exclude={"note_id"}, exclude_none=True),
    )
    if updated is None:
        raise LookupError(f"Note not found: {args.note_id}")
    return {"note": updated}


def _list_notes(conn: Connection, args: ListNotesToolArgs) -> dict[str, Any]:
    notes = notes_service.list_notes(conn)
    return {"notes": notes[: args.limit]}


def _get_note(conn: Connection, args: GetNoteToolArgs) -> dict[str, Any]:
    note = notes_service.get_note(conn, args.note_id)
    if note is None:
        raise LookupError(f"Note not found: {args.note_id}")
    return {"note": note}


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


def _list_tasks(conn: Connection, args: ListTasksToolArgs) -> dict[str, Any]:
    tasks = tasks_service.list_tasks(conn, status=args.status)
    return {"tasks": tasks[: args.limit]}


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


def _list_calendar_events(conn: Connection, args: ListCalendarEventsToolArgs) -> dict[str, Any]:
    events = calendar_service.list_events(conn)
    return {"events": events[: args.limit]}


def _generate_time_blocks(conn: Connection, args: GenerateTimeBlocksToolArgs) -> dict[str, Any]:
    generated = planning_service.generate_time_blocks(
        conn,
        date=args.date,
        day_start_hour=args.day_start_hour,
        day_end_hour=args.day_end_hour,
    )
    return {"generated": generated}


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


def _get_execution_policy(conn: Connection, _args: GetExecutionPolicyToolArgs) -> dict[str, Any]:
    return {"policy": integrations_service.get_execution_policy(conn)}


def _set_execution_policy(conn: Connection, args: SetExecutionPolicyToolArgs) -> dict[str, Any]:
    current = integrations_service.get_execution_policy(conn)
    policy = integrations_service.upsert_execution_policy(
        conn,
        {
            "llm": args.llm if args.llm is not None else current["llm"],
            "stt": args.stt if args.stt is not None else current["stt"],
            "tts": args.tts if args.tts is not None else current["tts"],
            "ocr": args.ocr if args.ocr is not None else current["ocr"],
        },
    )
    return {"policy": policy}


TOOL_SPECS: dict[str, ToolSpec] = {
    "capture_text_as_artifact": ToolSpec(
        name="capture_text_as_artifact",
        description="Create a new text artifact in Starlog from chat or voice-transcribed content.",
        arg_model=CaptureTextToolArgs,
        backing_endpoint="/v1/capture",
        handler=_capture_text,
    ),
    "list_artifacts": ToolSpec(
        name="list_artifacts",
        description="List recent Starlog artifacts for clip triage or follow-up actions.",
        arg_model=ListArtifactsToolArgs,
        backing_endpoint="/v1/artifacts",
        handler=_list_artifacts,
    ),
    "get_artifact_graph": ToolSpec(
        name="get_artifact_graph",
        description="Load the full Starlog artifact graph including summaries, cards, tasks, notes, and provenance links.",
        arg_model=GetArtifactGraphToolArgs,
        backing_endpoint="/v1/artifacts/{artifact_id}/graph",
        handler=_get_artifact_graph,
    ),
    "run_artifact_action": ToolSpec(
        name="run_artifact_action",
        description="Run or queue a Starlog artifact action such as summarize, create cards, generate tasks, or append note.",
        arg_model=RunArtifactActionToolArgs,
        backing_endpoint="/v1/artifacts/{artifact_id}/actions",
        handler=_run_artifact_action,
    ),
    "create_note": ToolSpec(
        name="create_note",
        description="Create a Markdown note in Starlog.",
        arg_model=CreateNoteToolArgs,
        backing_endpoint="/v1/notes",
        handler=_create_note,
    ),
    "update_note": ToolSpec(
        name="update_note",
        description="Update an existing Starlog note title or Markdown body.",
        arg_model=UpdateNoteToolArgs,
        backing_endpoint="/v1/notes/{note_id}",
        handler=_update_note,
    ),
    "list_notes": ToolSpec(
        name="list_notes",
        description="List recent Starlog notes.",
        arg_model=ListNotesToolArgs,
        backing_endpoint="/v1/notes",
        handler=_list_notes,
    ),
    "get_note": ToolSpec(
        name="get_note",
        description="Fetch a single Starlog note by ID.",
        arg_model=GetNoteToolArgs,
        backing_endpoint="/v1/notes/{note_id}",
        handler=_get_note,
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
    "list_tasks": ToolSpec(
        name="list_tasks",
        description="List Starlog tasks, optionally filtered by status.",
        arg_model=ListTasksToolArgs,
        backing_endpoint="/v1/tasks",
        handler=_list_tasks,
    ),
    "create_calendar_event": ToolSpec(
        name="create_calendar_event",
        description="Create an internal Starlog calendar event or time block anchor.",
        arg_model=CreateCalendarEventToolArgs,
        backing_endpoint="/v1/calendar/events",
        handler=_create_calendar_event,
    ),
    "list_calendar_events": ToolSpec(
        name="list_calendar_events",
        description="List Starlog calendar events and time anchors.",
        arg_model=ListCalendarEventsToolArgs,
        backing_endpoint="/v1/calendar/events",
        handler=_list_calendar_events,
    ),
    "generate_time_blocks": ToolSpec(
        name="generate_time_blocks",
        description="Generate Starlog time blocks from the current task queue for a target day window.",
        arg_model=GenerateTimeBlocksToolArgs,
        backing_endpoint="/v1/planning/blocks/generate",
        handler=_generate_time_blocks,
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
    "get_execution_policy": ToolSpec(
        name="get_execution_policy",
        description="Read the shared Starlog execution priority policy for LLM, STT, TTS, and OCR routing.",
        arg_model=GetExecutionPolicyToolArgs,
        backing_endpoint="/v1/integrations/execution-policy",
        handler=_get_execution_policy,
    ),
    "set_execution_policy": ToolSpec(
        name="set_execution_policy",
        description="Update the shared execution priority policy so Starlog knows when to prefer on-device, batch bridge, local server, Codex bridge, or API fallback routes.",
        arg_model=SetExecutionPolicyToolArgs,
        backing_endpoint="/v1/integrations/execution-policy",
        handler=_set_execution_policy,
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
