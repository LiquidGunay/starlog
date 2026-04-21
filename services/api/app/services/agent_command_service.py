from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from sqlite3 import Connection
from typing import Any, Literal

from app.schemas.agent import AgentCommandIntent, AgentCommandResponse, AgentCommandStep
from app.services import (
    agent_service,
    ai_jobs_service,
    artifacts_service,
    conversation_card_service,
    conversation_service,
    integrations_service,
    tasks_service,
)

COMMAND_DATE_PATTERN = r"(today|tomorrow|\d{4}-\d{2}-\d{2})"
DATETIME_PATTERN = r"(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})"
ARTIFACT_CAPABILITY = {
    "summarize": "llm_summary",
    "cards": "llm_cards",
    "tasks": "llm_tasks",
}


@dataclass(frozen=True)
class PlannedToolCall:
    tool_name: str
    arguments: dict[str, Any]
    message: str


COMMAND_INTENTS: list[AgentCommandIntent] = [
    AgentCommandIntent(
        name="capture",
        description="Capture typed text into the Starlog inbox as a new artifact.",
        examples=["capture Clip title: captured body text", "save This idea for later"],
    ),
    AgentCommandIntent(
        name="artifact_actions",
        description="Run summarize/cards/tasks/append-note on an artifact, usually the latest one.",
        examples=["summarize latest artifact", "create cards for latest artifact", "append note on Nebula article"],
    ),
    AgentCommandIntent(
        name="tasks",
        description="Create, complete, or list tasks.",
        examples=["create task Review notes due tomorrow priority 4", "complete task Review notes", "list todo tasks"],
    ),
    AgentCommandIntent(
        name="notes",
        description="Create notes or list recent notes.",
        examples=["create note Daily plan: review queue first", "list notes"],
    ),
    AgentCommandIntent(
        name="calendar",
        description="Create calendar events, list events, or generate time blocks.",
        examples=[
            "create event Deep Work from 2026-03-07 09:00 to 2026-03-07 10:00",
            "list calendar events",
            "generate time blocks for tomorrow from 8 to 12",
        ],
    ),
    AgentCommandIntent(
        name="briefing_alarm",
        description="Generate briefings or schedule morning alarms.",
        examples=[
            "generate briefing for tomorrow",
            "render briefing audio for tomorrow",
            "schedule alarm for tomorrow at 07:00",
        ],
    ),
    AgentCommandIntent(
        name="review_search",
        description="Load due cards or search Starlog content.",
        examples=["load due cards", "search for spaced repetition"],
    ),
    AgentCommandIntent(
        name="execution_policy",
        description="Inspect or update AI routing priority order.",
        examples=["show execution policy", "set llm policy to mobile_bridge, desktop_bridge, api"],
    ),
]


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _resolve_date_token(raw: str | None) -> str:
    token = (raw or "").strip().lower()
    if not token or token == "today":
        return _today_utc().isoformat()
    if token == "tomorrow":
        return (_today_utc() + timedelta(days=1)).isoformat()
    return token


def _resolve_due_datetime(raw: str | None) -> str | None:
    if not raw:
        return None
    return f"{_resolve_date_token(raw)}T09:00:00+00:00"


def _parse_datetime(raw: str) -> str:
    match = re.fullmatch(DATETIME_PATTERN, raw.strip())
    if not match:
        raise ValueError("Datetime must use YYYY-MM-DD HH:MM format")
    day, clock = match.groups()
    return f"{day}T{clock}:00+00:00"


def _clean_quotes(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {'"', "'"}:
        return text[1:-1].strip()
    return text


def list_command_intents() -> list[AgentCommandIntent]:
    return COMMAND_INTENTS


def _latest_artifact(conn: Connection) -> dict[str, Any]:
    artifacts = artifacts_service.list_artifacts(conn)
    if not artifacts:
        raise ValueError("No artifacts exist yet")
    return artifacts[0]


def _resolve_artifact(conn: Connection, target: str | None) -> dict[str, Any]:
    normalized = (target or "").strip()
    if not normalized or normalized.lower() in {"latest", "latest artifact", "recent artifact"}:
        return _latest_artifact(conn)

    direct = artifacts_service.get_artifact(conn, normalized)
    if direct is not None:
        return direct

    rows = artifacts_service.list_artifacts(conn)
    needle = normalized.lower()
    exact = [row for row in rows if str(row.get("title") or "").strip().lower() == needle]
    if exact:
        return exact[0]
    partial = [row for row in rows if needle in str(row.get("title") or "").strip().lower()]
    if partial:
        return partial[0]
    raise ValueError(f"Artifact not found for reference: {normalized}")


def _resolve_task(conn: Connection, target: str) -> dict[str, Any]:
    normalized = target.strip()
    direct = tasks_service.get_task(conn, normalized)
    if direct is not None:
        return direct

    rows = tasks_service.list_tasks(conn)
    needle = normalized.lower()
    exact = [row for row in rows if str(row.get("title") or "").strip().lower() == needle]
    if exact:
        return exact[0]
    partial = [row for row in rows if needle in str(row.get("title") or "").strip().lower()]
    if partial:
        return partial[0]
    raise ValueError(f"Task not found for reference: {normalized}")


def _artifact_action_call(conn: Connection, action: str, target: str | None) -> PlannedToolCall:
    artifact = _resolve_artifact(conn, target)
    arguments: dict[str, Any] = {
        "artifact_id": str(artifact["id"]),
        "action": action,
    }
    capability = ARTIFACT_CAPABILITY.get(action)
    if capability is not None:
        execution_order = integrations_service.capability_execution_order(
            conn,
            capability,
            executable_targets={"mobile_bridge", "desktop_bridge", "api"},
            prefer_local=True,
        )
        if execution_order and execution_order[0] in {"mobile_bridge", "desktop_bridge"}:
            arguments["defer"] = True
            provider_hint = integrations_service.default_batch_provider_hint(conn, capability)
            if provider_hint:
                arguments["provider_hint"] = provider_hint
    title = str(artifact.get("title") or artifact["id"])
    return PlannedToolCall(
        tool_name="run_artifact_action",
        arguments=arguments,
        message=f"{action} for artifact {title}",
    )


def _strip_metadata_tokens(raw: str) -> tuple[str, dict[str, Any]]:
    text = raw
    metadata: dict[str, Any] = {}

    due_match = re.search(rf"\bdue\s+{COMMAND_DATE_PATTERN}\b", text, re.IGNORECASE)
    if due_match:
        metadata["due_at"] = _resolve_due_datetime(due_match.group(1))
        text = re.sub(rf"\bdue\s+{COMMAND_DATE_PATTERN}\b", "", text, count=1, flags=re.IGNORECASE)

    priority_match = re.search(r"\bpriority\s+([1-5])\b", text, re.IGNORECASE)
    if priority_match:
        metadata["priority"] = int(priority_match.group(1))
        text = re.sub(r"\bpriority\s+([1-5])\b", "", text, count=1, flags=re.IGNORECASE)

    estimate_match = re.search(r"\bestimate\s+(\d{1,3})\s*(?:m|min|minutes)\b", text, re.IGNORECASE)
    if estimate_match:
        metadata["estimate_min"] = int(estimate_match.group(1))
        text = re.sub(r"\bestimate\s+(\d{1,3})\s*(?:m|min|minutes)\b", "", text, count=1, flags=re.IGNORECASE)

    return " ".join(text.split()).strip(), metadata


def _parse_execution_targets(raw: str, family: str) -> list[str]:
    allowed = set(integrations_service.AVAILABLE_EXECUTION_TARGETS[family])
    parts = [item.strip().lower() for item in re.split(r"[,\s]+", raw) if item.strip()]
    normalized: list[str] = []
    aliases = {
        "mobile": "mobile_bridge",
        "phone": "mobile_bridge",
        "local": "desktop_bridge",
        "server": "desktop_bridge",
        "bridge": "desktop_bridge",
        "batch": "desktop_bridge",
        "codex": "desktop_bridge",
        "on_device": "mobile_bridge",
        "batch_local_bridge": "desktop_bridge",
        "server_local": "desktop_bridge",
        "codex_bridge": "desktop_bridge",
        "api_fallback": "api",
        "api": "api",
    }
    for part in parts:
        candidate = aliases.get(part, part)
        candidate = integrations_service._normalize_execution_target(candidate, family)
        if candidate in allowed and candidate not in normalized:
            normalized.append(candidate)
    if not normalized:
        raise ValueError(
            f"No valid targets found for {family}. Allowed targets: {', '.join(integrations_service.AVAILABLE_EXECUTION_TARGETS[family])}"
        )
    return normalized


def _plan_command(conn: Connection, command: str, device_target: str) -> tuple[str, str, list[PlannedToolCall]]:
    text = " ".join(command.strip().split())
    lower = text.lower()

    list_artifacts_match = re.match(r"^(?:show|list)\s+(?:artifacts|clips|inbox)$", text, re.IGNORECASE)
    if list_artifacts_match:
        return "list_artifacts", "List recent artifacts", [
            PlannedToolCall("list_artifacts", {"limit": 10}, "List recent artifacts"),
        ]

    artifact_graph_match = re.match(r"^(?:show|inspect|open)\s+artifact\s+(.+)$", text, re.IGNORECASE)
    if artifact_graph_match:
        artifact = _resolve_artifact(conn, _clean_quotes(artifact_graph_match.group(1)))
        title = str(artifact.get("title") or artifact["id"])
        return "get_artifact_graph", f"Inspect artifact {title}", [
            PlannedToolCall("get_artifact_graph", {"artifact_id": str(artifact["id"])}, f"Inspect artifact {title}"),
        ]

    search_match = re.match(r"^(?:search|find)(?:\s+for)?\s+(.+)$", text, re.IGNORECASE)
    if search_match:
        query = _clean_quotes(search_match.group(1))
        return "search", f"Search Starlog for {query}", [
            PlannedToolCall("search_starlog", {"query": query, "limit": 10}, f"Search for {query}"),
        ]

    capture_match = re.match(r"^(?:capture|clip|save)\s+(.+)$", text, re.IGNORECASE)
    if capture_match:
        body = capture_match.group(1).strip()
        title = "Command capture"
        capture_text = body
        if ":" in body:
            possible_title, possible_text = body.split(":", 1)
            if possible_text.strip():
                title = _clean_quotes(possible_title)
                capture_text = possible_text.strip()
        return "capture", "Capture text into Starlog inbox", [
            PlannedToolCall(
                "capture_text_as_artifact",
                {
                    "title": title,
                    "text": capture_text,
                    "source_type": "clip_manual",
                    "capture_source": "assistant_command",
                    "metadata": {"origin": "assistant_command"},
                },
                f"Capture text as artifact {title}",
            ),
        ]

    for phrase, action in [
        ("summarize", "summarize"),
        ("summarise", "summarize"),
        ("create cards", "cards"),
        ("make cards", "cards"),
        ("generate cards", "cards"),
        ("generate tasks", "tasks"),
        ("create tasks", "tasks"),
        ("append note", "append_note"),
    ]:
        if lower.startswith(phrase):
            target = text[len(phrase) :].strip()
            target = re.sub(r"^(?:for|on)\s+", "", target, flags=re.IGNORECASE)
            planned = _artifact_action_call(conn, action, target or None)
            return action, planned.message, [planned]

    note_match = re.match(r"^(?:create|add)\s+note\s+(.+)$", text, re.IGNORECASE)
    if note_match:
        body = note_match.group(1).strip()
        title = body
        note_body = ""
        if ":" in body:
            title_part, body_part = body.split(":", 1)
            title = _clean_quotes(title_part)
            note_body = body_part.strip()
        return "create_note", f"Create note {title}", [
            PlannedToolCall("create_note", {"title": title, "body_md": note_body}, f"Create note {title}"),
        ]

    list_notes_match = re.match(r"^(?:show|list)\s+notes$", text, re.IGNORECASE)
    if list_notes_match:
        return "list_notes", "List recent notes", [
            PlannedToolCall("list_notes", {"limit": 10}, "List recent notes"),
        ]

    create_task_match = re.match(r"^(?:create|add)\s+task\s+(.+)$", text, re.IGNORECASE)
    if create_task_match:
        title_text, metadata = _strip_metadata_tokens(create_task_match.group(1))
        title = _clean_quotes(title_text)
        if not title:
            raise ValueError("Task title is required")
        arguments: dict[str, Any] = {"title": title}
        arguments.update(metadata)
        return "create_task", f"Create task {title}", [
            PlannedToolCall("create_task", arguments, f"Create task {title}"),
        ]

    list_tasks_match = re.match(r"^(?:show|list)(?:\s+(todo|done|in_progress))?\s+tasks$", text, re.IGNORECASE)
    if list_tasks_match:
        status_filter = list_tasks_match.group(1)
        summary = f"List {status_filter} tasks" if status_filter else "List tasks"
        arguments = {"limit": 20}
        if status_filter:
            arguments["status"] = status_filter
        return "list_tasks", summary, [
            PlannedToolCall("list_tasks", arguments, summary),
        ]

    complete_task_match = re.match(
        r"^(?:complete|finish|mark)\s+task\s+(.+?)(?:\s+(?:done|complete))?$",
        text,
        re.IGNORECASE,
    )
    if complete_task_match:
        task = _resolve_task(conn, _clean_quotes(complete_task_match.group(1)))
        return "complete_task", f"Mark task {task['title']} done", [
            PlannedToolCall(
                "update_task",
                {"task_id": str(task["id"]), "status": "done"},
                f"Mark task {task['title']} done",
            ),
        ]

    event_match = re.match(
        rf"^(?:create|add|schedule)\s+(?:event|calendar event)\s+(.+?)\s+from\s+{DATETIME_PATTERN}\s+to\s+{DATETIME_PATTERN}$",
        text,
        re.IGNORECASE,
    )
    if event_match:
        title = _clean_quotes(event_match.group(1))
        starts_at = _parse_datetime(f"{event_match.group(2)} {event_match.group(3)}")
        ends_at = _parse_datetime(f"{event_match.group(4)} {event_match.group(5)}")
        return "create_calendar_event", f"Create calendar event {title}", [
            PlannedToolCall(
                "create_calendar_event",
                {"title": title, "starts_at": starts_at, "ends_at": ends_at, "source": "internal"},
                f"Create calendar event {title}",
            ),
        ]

    list_events_match = re.match(r"^(?:show|list)\s+(?:calendar events|events|calendar)$", text, re.IGNORECASE)
    if list_events_match:
        return "list_calendar_events", "List calendar events", [
            PlannedToolCall("list_calendar_events", {"limit": 20}, "List calendar events"),
        ]

    blocks_match = re.match(
        rf"^(?:generate|plan)\s+(?:time blocks|blocks)(?:\s+for\s+{COMMAND_DATE_PATTERN})?(?:\s+from\s+(\d{{1,2}}))?(?:\s+to\s+(\d{{1,2}}))?$",
        text,
        re.IGNORECASE,
    )
    if blocks_match:
        target_date = _resolve_date_token(blocks_match.group(1))
        start_hour = int(blocks_match.group(2) or "8")
        end_hour = int(blocks_match.group(3) or "18")
        return "generate_time_blocks", f"Generate time blocks for {target_date}", [
            PlannedToolCall(
                "generate_time_blocks",
                {
                    "date": target_date,
                    "day_start_hour": start_hour,
                    "day_end_hour": end_hour,
                },
                f"Generate time blocks for {target_date}",
            ),
        ]

    briefing_match = re.match(
        rf"^(?:generate|make)\s+(?:briefing|morning briefing)(?:\s+for\s+{COMMAND_DATE_PATTERN})?$",
        text,
        re.IGNORECASE,
    )
    if briefing_match:
        target_date = _resolve_date_token(briefing_match.group(1) if briefing_match.lastindex else None)
        return "generate_briefing", f"Generate briefing for {target_date}", [
            PlannedToolCall(
                "generate_briefing",
                {"date": target_date, "provider": "assistant-command"},
                f"Generate briefing for {target_date}",
            ),
        ]

    briefing_audio_match = re.match(
        rf"^(?:render|queue|generate|make)\s+(?:briefing audio|audio briefing|spoken briefing)(?:\s+for\s+{COMMAND_DATE_PATTERN})?$",
        text,
        re.IGNORECASE,
    )
    if briefing_audio_match:
        target_date = _resolve_date_token(briefing_audio_match.group(1) if briefing_audio_match.lastindex else None)
        return "render_briefing_audio", f"Queue briefing audio render for {target_date}", [
            PlannedToolCall(
                "render_briefing_audio",
                {"date": target_date, "provider": "assistant-command"},
                f"Queue briefing audio render for {target_date}",
            ),
        ]

    alarm_match = re.match(
        rf"^(?:set|schedule)\s+(?:alarm|morning alarm)(?:\s+for\s+{COMMAND_DATE_PATTERN})?(?:\s+at\s+(\d{{1,2}}:\d{{2}}))?(?:\s+on\s+(.+))?$",
        text,
        re.IGNORECASE,
    )
    if alarm_match:
        target_date = _resolve_date_token(alarm_match.group(1))
        clock = alarm_match.group(2) or "07:00"
        if not re.fullmatch(r"\d{1,2}:\d{2}", clock):
            raise ValueError("Alarm time must use HH:MM")
        hh, mm = clock.split(":", 1)
        trigger_at = f"{target_date}T{int(hh):02d}:{int(mm):02d}:00+00:00"
        return "schedule_alarm", f"Schedule morning alarm for {target_date} at {clock}", [
            PlannedToolCall(
                "schedule_morning_brief_alarm",
                {
                    "date": target_date,
                    "trigger_at": trigger_at,
                    "device_target": _clean_quotes(alarm_match.group(3) or device_target),
                    "provider": "assistant-command",
                },
                f"Schedule morning alarm for {target_date} at {clock}",
            ),
        ]

    due_cards_match = re.match(r"^(?:show|list|load)\s+(?:due cards|review queue)$", text, re.IGNORECASE)
    if due_cards_match:
        return "list_due_cards", "Load due cards", [
            PlannedToolCall("list_due_cards", {"limit": 20}, "Load due cards"),
        ]

    get_policy_match = re.match(r"^(?:show|view|get|list)\s+(?:execution\s+policy|policy)$", text, re.IGNORECASE)
    if get_policy_match:
        return "get_execution_policy", "Show execution policy", [
            PlannedToolCall("get_execution_policy", {}, "Show execution policy"),
        ]

    set_policy_match = re.match(
        r"^(?:set|update)\s+(llm|stt|tts|ocr)\s+(?:policy|priority|order)\s+to\s+(.+)$",
        text,
        re.IGNORECASE,
    )
    if set_policy_match:
        family = set_policy_match.group(1).lower()
        targets = _parse_execution_targets(set_policy_match.group(2), family)
        return "set_execution_policy", f"Update {family} execution policy", [
            PlannedToolCall("set_execution_policy", {family: targets}, f"Update {family} execution policy"),
        ]

    raise ValueError(
        "Command not recognized. Try commands like 'summarize latest artifact', "
        "'create task Review notes due tomorrow priority 4', "
        "'list tasks', "
        "'show execution policy', "
        "'create event Deep Work from 2026-03-07 09:00 to 2026-03-07 10:00', "
        "or 'schedule alarm for tomorrow at 07:00'."
    )


def _execute_planned_calls(
    conn: Connection,
    command: str,
    *,
    planner: str,
    matched_intent: str,
    summary: str,
    execute: bool,
    planned_calls: list[PlannedToolCall],
    enforce_confirmation_policy: bool = False,
) -> AgentCommandResponse:
    steps: list[AgentCommandStep] = []
    overall_status: Literal["planned", "executed", "failed"] = "executed" if execute else "planned"

    for planned in planned_calls:
        try:
            spec, _validated, normalized, confirmation_policy = agent_service.prepare_tool_call(
                planned.tool_name,
                planned.arguments,
            )
            requires_confirmation = confirmation_policy.mode == "always"
            confirmation_state: Literal["not_required", "required", "confirmed"] = "not_required"
            if requires_confirmation:
                confirmation_state = "confirmed" if not enforce_confirmation_policy else "required"

            if execute and enforce_confirmation_policy and requires_confirmation:
                overall_status = "planned"
                steps.append(
                    AgentCommandStep(
                        tool_name=planned.tool_name,
                        arguments=normalized,
                        status="confirmation_required",
                        message=planned.message,
                        result={"confirmation_reason": confirmation_policy.reason or ""},
                        backing_endpoint=spec.backing_endpoint,
                        requires_confirmation=True,
                        confirmation_state="required",
                    )
                )
                continue

            status_text, _executed_normalized, result = agent_service.execute_tool(
                conn,
                tool_name=planned.tool_name,
                arguments=normalized,
                dry_run=not execute,
            )
            steps.append(
                AgentCommandStep(
                    tool_name=planned.tool_name,
                    arguments=normalized,
                    status=status_text,
                    message=planned.message,
                    result=result,
                    backing_endpoint=spec.backing_endpoint,
                    requires_confirmation=requires_confirmation,
                    confirmation_state=confirmation_state,
                )
            )
        except Exception as exc:
            overall_status = "failed"
            steps.append(
                AgentCommandStep(
                    tool_name=planned.tool_name,
                    arguments=planned.arguments,
                    status="failed",
                    message=f"{planned.message}: {exc}",
                    result={},
                    requires_confirmation=False,
                    confirmation_state="not_required",
                )
            )
            break

    return AgentCommandResponse(
        command=command,
        planner=planner,
        matched_intent=matched_intent,
        status=overall_status,
        summary=summary,
        steps=steps,
    )


def _assistant_cards(response: AgentCommandResponse) -> list[dict[str, Any]]:
    raise RuntimeError("_assistant_cards no longer accepts a response without a database connection")


def _assistant_cards_for_conversation(conn: Connection, response: AgentCommandResponse) -> list[dict[str, Any]]:
    return conversation_card_service.project_agent_response_cards(conn, response)


def _persist_conversation_turn(
    conn: Connection,
    *,
    command: str,
    response: AgentCommandResponse,
    input_mode: str,
    device_target: str,
) -> None:
    conversation_service.record_assistant_tool_turn(
        conn,
        content=command,
        assistant_content=response.summary,
        cards=_assistant_cards_for_conversation(conn, response),
        tool_traces=[
            {
                "tool_name": step.tool_name,
                "arguments": step.arguments,
                "status": step.status,
                "result": step.result,
                "metadata": {
                    "planner": response.planner,
                    "message": step.message,
                    "backing_endpoint": step.backing_endpoint,
                    "requires_confirmation": step.requires_confirmation,
                    "confirmation_state": step.confirmation_state,
                },
            }
            for step in response.steps
        ],
        request_metadata={
            "input_mode": input_mode,
            "device_target": device_target,
            "execute_requested": response.status != "planned",
        },
        assistant_metadata={
            "assistant_command": response.model_dump(mode="json"),
            "matched_intent": response.matched_intent,
            "planner": response.planner,
            "status": response.status,
        },
        session_state_patch={
            "last_command": command,
            "last_matched_intent": response.matched_intent,
            "last_planner": response.planner,
            "last_status": response.status,
            "last_tool_names": [step.tool_name for step in response.steps],
            "last_turn_kind": "assistant_command",
            "last_user_message": command,
            "last_assistant_response": response.summary,
        },
    )


def run_command(
    conn: Connection,
    command: str,
    *,
    execute: bool,
    device_target: str,
) -> AgentCommandResponse:
    matched_intent, summary, planned_calls = _plan_command(conn, command, device_target)
    response = _execute_planned_calls(
        conn,
        command,
        planner="deterministic",
        matched_intent=matched_intent,
        summary=summary,
        execute=execute,
        planned_calls=planned_calls,
        enforce_confirmation_policy=False,
    )
    _persist_conversation_turn(
        conn,
        command=command,
        response=response,
        input_mode="text",
        device_target=device_target,
    )
    return response


def plan_command(
    conn: Connection,
    command: str,
    *,
    device_target: str,
) -> tuple[str, str, list[PlannedToolCall]]:
    return _plan_command(conn, command, device_target)


def execute_planned_command(
    conn: Connection,
    *,
    command: str,
    planner: str,
    matched_intent: str,
    summary: str,
    execute: bool,
    planned_calls: list[PlannedToolCall],
    enforce_confirmation_policy: bool = False,
) -> AgentCommandResponse:
    return _execute_planned_calls(
        conn,
        command,
        planner=planner,
        matched_intent=matched_intent,
        summary=summary,
        execute=execute,
        planned_calls=planned_calls,
        enforce_confirmation_policy=enforce_confirmation_policy,
    )


def run_conversation_command(
    conn: Connection,
    command: str,
    *,
    input_mode: str,
    device_target: str,
) -> dict[str, Any]:
    matched_intent, summary, planned_calls = _plan_command(conn, command, device_target)
    response = _execute_planned_calls(
        conn,
        command,
        planner="deterministic",
        matched_intent=matched_intent,
        summary=summary,
        execute=True,
        planned_calls=planned_calls,
        enforce_confirmation_policy=False,
    )
    return conversation_service.record_assistant_tool_turn(
        conn,
        content=command,
        assistant_content=response.summary,
        cards=_assistant_cards_for_conversation(conn, response),
        tool_traces=[
            {
                "tool_name": step.tool_name,
                "arguments": step.arguments,
                "status": step.status,
                "result": step.result,
                "metadata": {
                    "planner": response.planner,
                    "message": step.message,
                    "backing_endpoint": step.backing_endpoint,
                    "requires_confirmation": step.requires_confirmation,
                    "confirmation_state": step.confirmation_state,
                },
            }
            for step in response.steps
        ],
        request_metadata={
            "input_mode": input_mode,
            "device_target": device_target,
            "execute_requested": True,
        },
        assistant_metadata={
            "assistant_command": response.model_dump(mode="json"),
            "matched_intent": response.matched_intent,
            "planner": response.planner,
            "status": response.status,
        },
        session_state_patch={
            "last_command": command,
            "last_matched_intent": response.matched_intent,
            "last_planner": response.planner,
            "last_status": response.status,
            "last_tool_names": [step.tool_name for step in response.steps],
            "last_turn_kind": "assistant_command",
            "last_user_message": command,
            "last_assistant_response": response.summary,
            "last_chat_turn_provider": response.planner,
            "last_chat_turn_model": "",
        },
    )


def apply_ai_command_plan(
    conn: Connection,
    *,
    command: str,
    execute: bool,
    output: dict[str, Any],
) -> AgentCommandResponse:
    raw_calls = output.get("tool_calls")
    matched_intent = str(output.get("matched_intent") or "assistant_ai")
    summary = str(output.get("summary") or "AI planned command")
    planner = str(output.get("planner") or "llm_assist")

    planned_calls: list[PlannedToolCall] = []
    if isinstance(raw_calls, list):
        for index, item in enumerate(raw_calls):
            if not isinstance(item, dict):
                continue
            tool_name = str(item.get("tool_name") or "").strip()
            arguments = item.get("arguments")
            if not isinstance(arguments, dict):
                raw_arguments = item.get("arguments_json")
                if isinstance(raw_arguments, str):
                    try:
                        parsed_arguments = json.loads(raw_arguments)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(parsed_arguments, dict):
                        arguments = parsed_arguments
            if not tool_name or not isinstance(arguments, dict):
                continue
            message = str(item.get("message") or f"Run tool {tool_name} ({index + 1})").strip()
            planned_calls.append(PlannedToolCall(tool_name=tool_name, arguments=arguments, message=message))

    if not planned_calls:
        response = AgentCommandResponse(
            command=command,
            planner=planner,
            matched_intent=matched_intent,
            status="failed",
            summary=f"{summary} No valid tool calls were returned.",
            steps=[],
        )
        _persist_conversation_turn(
            conn,
            command=command,
            response=response,
            input_mode="llm_assist",
            device_target="assistant-ai",
        )
        return response

    response = _execute_planned_calls(
        conn,
        command,
        planner=planner,
        matched_intent=matched_intent,
        summary=summary,
        execute=execute,
        planned_calls=planned_calls,
        enforce_confirmation_policy=True,
    )
    _persist_conversation_turn(
        conn,
        command=command,
        response=response,
        input_mode="llm_assist",
        device_target="assistant-ai",
    )
    return response


def queue_assist_command(
    conn: Connection,
    *,
    command: str,
    execute: bool,
    device_target: str,
    provider_hint: str | None = None,
) -> dict[str, Any]:
    resolved_provider_hint = (
        provider_hint
        or integrations_service.default_batch_provider_hint(conn, "llm_agent_plan")
        or "desktop_bridge_codex"
    )
    return ai_jobs_service.create_job(
        conn,
        capability="llm_agent_plan",
        payload={
            "command": command,
            "assistant_command": {
                "kind": "typed_assist",
                "execute": execute,
                "device_target": device_target,
            },
            "intents": [intent.model_dump(mode="json") for intent in list_command_intents()],
            "tool_catalog": [tool.model_dump(mode="json") for tool in agent_service.list_tool_definitions()],
            "current_date": _today_utc().isoformat(),
        },
        provider_hint=resolved_provider_hint,
        requested_targets=integrations_service.capability_execution_order(
            conn,
            "llm_agent_plan",
            executable_targets={"mobile_bridge", "desktop_bridge", "api"},
            prefer_local=True,
        ),
        action="assistant_command_ai",
    )


def queue_voice_command(
    conn: Connection,
    *,
    blob_ref: str,
    content_type: str | None,
    title: str | None,
    duration_ms: int | None,
    execute: bool,
    device_target: str,
    provider_hint: str | None = None,
) -> dict[str, Any]:
    resolved_provider_hint = (
        provider_hint
        or integrations_service.default_batch_provider_hint(conn, "stt")
        or "desktop_bridge_stt"
    )
    return ai_jobs_service.create_job(
        conn,
        capability="stt",
        payload={
            "blob_ref": blob_ref,
            "content_type": content_type,
            "title": title or "Voice command",
            "duration_ms": duration_ms,
            "assistant_command": {
                "kind": "voice",
                "execute": execute,
                "device_target": device_target,
            },
        },
        provider_hint=resolved_provider_hint,
        requested_targets=integrations_service.capability_execution_order(
            conn,
            "stt",
            executable_targets={"mobile_bridge", "desktop_bridge", "api"},
            prefer_local=True,
        ),
        action="assistant_command",
    )
