from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from sqlite3 import Connection
from typing import Any, Literal

from app.schemas.agent import AgentCommandResponse, AgentCommandStep
from app.services import agent_service, artifacts_service, integrations_service, tasks_service

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
            executable_targets={"batch_local_bridge", "server_local", "codex_bridge", "api_fallback"},
            prefer_local=True,
        )
        if execution_order and execution_order[0] == "batch_local_bridge":
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


def _plan_command(conn: Connection, command: str, device_target: str) -> tuple[str, str, list[PlannedToolCall]]:
    text = " ".join(command.strip().split())
    lower = text.lower()

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

    raise ValueError(
        "Command not recognized. Try commands like 'summarize latest artifact', "
        "'create task Review notes due tomorrow priority 4', "
        "'create event Deep Work from 2026-03-07 09:00 to 2026-03-07 10:00', "
        "or 'schedule alarm for tomorrow at 07:00'."
    )


def run_command(
    conn: Connection,
    command: str,
    *,
    execute: bool,
    device_target: str,
) -> AgentCommandResponse:
    matched_intent, summary, planned_calls = _plan_command(conn, command, device_target)
    steps: list[AgentCommandStep] = []
    overall_status: Literal["planned", "executed", "failed"] = "executed" if execute else "planned"

    for planned in planned_calls:
        try:
            status_text, normalized, result = agent_service.execute_tool(
                conn,
                tool_name=planned.tool_name,
                arguments=planned.arguments,
                dry_run=not execute,
            )
            steps.append(
                AgentCommandStep(
                    tool_name=planned.tool_name,
                    arguments=normalized,
                    status=status_text,
                    message=planned.message,
                    result=result,
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
                )
            )
            break

    return AgentCommandResponse(
        command=command,
        planner="deterministic",
        matched_intent=matched_intent,
        status=overall_status,
        summary=summary,
        steps=steps,
    )
