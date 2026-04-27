from __future__ import annotations

import json
from datetime import datetime, time, timezone
from sqlite3 import Connection
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.time import utc_now
from app.schemas.agent import AgentCommandResponse, AgentCommandStep
from app.services import (
    agent_command_service,
    agent_service,
    ai_jobs_service,
    ai_service,
    assistant_handoff_service,
    assistant_projection_service,
    assistant_thread_service,
    artifacts_service,
    conversation_card_service,
    conversation_service,
    integrations_service,
    memory_vault_service,
    review_mode_service,
    srs_service,
)
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _ui_capability_manifest() -> dict[str, Any]:
    return {
        "ui_tools": [
            {"tool_name": "request_due_date", "kind": "form"},
            {"tool_name": "resolve_planner_conflict", "kind": "choice"},
            {"tool_name": "triage_capture", "kind": "form"},
            {"tool_name": "grade_review_recall", "kind": "choice"},
            {"tool_name": "choose_morning_focus", "kind": "choice"},
        ],
        "surfaces": ["assistant", "library", "planner", "review", "desktop_helper"],
    }


def _review_rating_label(rating: int) -> str:
    return {
        1: "Again",
        2: "Again",
        3: "Hard",
        4: "Good",
        5: "Easy",
    }.get(rating, f"Rating {rating}")


def _assistant_client_timezone(metadata: dict[str, Any] | None, values: dict[str, Any] | None = None) -> str:
    request_metadata = metadata if isinstance(metadata, dict) else {}
    submitted_values = values if isinstance(values, dict) else {}
    raw_timezone = str(
        submitted_values.get("client_timezone")
        or request_metadata.get("client_timezone")
        or request_metadata.get("timezone")
        or "UTC"
    ).strip()
    if not raw_timezone:
        return "UTC"
    try:
        ZoneInfo(raw_timezone)
    except ZoneInfoNotFoundError:
        return "UTC"
    return raw_timezone


def _capture_triage_result_card(
    conn: Connection,
    *,
    artifact_id: str,
    artifact: dict[str, Any] | None,
    action: str,
    action_status: str | None,
    output_ref: str | None,
) -> dict[str, Any] | None:
    if artifact is None:
        return None
    if action in {"summarize", "cards", "tasks", "append_note"}:
        cards = conversation_card_service.project_step_cards(
            conn,
            SimpleNamespace(
                tool_name="run_artifact_action",
                result={
                    "artifact_id": artifact_id,
                    "action": action,
                    "status": action_status or "completed",
                    "output_ref": output_ref,
                },
                arguments={"artifact_id": artifact_id, "action": action},
                status=action_status or "completed",
            ),
        )
        if cards:
            return cards[0]
    return assistant_projection_service.capture_triage_card(artifact=artifact)


def _due_date_to_utc_start(due_date_raw: str, *, client_timezone: str) -> datetime:
    due_date = datetime.strptime(due_date_raw, "%Y-%m-%d").date()
    local_start = datetime.combine(due_date, time.min, tzinfo=ZoneInfo(client_timezone))
    return local_start.astimezone(timezone.utc)


def _next_step_index(conn: Connection, *, run_id: str) -> int:
    row = execute_fetchone(
        conn,
        "SELECT COALESCE(MAX(step_index), -1) AS max_step_index FROM conversation_run_steps WHERE run_id = ?",
        (run_id,),
    )
    if row is None:
        return 0
    return int(row.get("max_step_index") or -1) + 1


def _record_run_failure(
    conn: Connection,
    *,
    thread_id: str,
    run_id: str,
    error_text: str,
    stage: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    assistant_message = assistant_thread_service.append_message(
        conn,
        thread_id=thread_id,
        role="assistant",
        status="error",
        run_id=run_id,
        metadata={
            "run_failure": {
                "stage": stage,
                "error_text": error_text,
            },
            **(metadata or {}),
        },
        parts=[
            assistant_projection_service.text_part(
                "That turn failed before it could finish. The run was marked failed, and you can retry from the thread."
            ),
            assistant_projection_service.status_part("error", "Run failed"),
        ],
    )
    _record_step(
        conn,
        run_id=run_id,
        thread_id=thread_id,
        step_index=_next_step_index(conn, run_id=run_id),
        title="Run failed",
        tool_name=stage,
        tool_kind="system_tool",
        status="failed",
        arguments={},
        result={},
        error_text=error_text,
        message_id=assistant_message["id"],
        metadata=metadata or {},
    )
    _update_run(
        conn,
        run_id=run_id,
        status="failed",
        summary="Run failed before completion",
        metadata_patch={"failure": {"stage": stage, "error_text": error_text}},
    )
    return assistant_message


def _create_run(conn: Connection, *, thread_id: str, origin_message_id: str | None, orchestrator: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    now = utc_now().isoformat()
    run_id = new_id("run")
    conn.execute(
        """
        INSERT INTO conversation_runs (id, thread_id, origin_message_id, orchestrator, status, summary, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            thread_id,
            origin_message_id,
            orchestrator,
            "running",
            None,
            json.dumps(metadata or {}, sort_keys=True),
            now,
            now,
        ),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM conversation_runs WHERE id = ?", (run_id,))
    if row is None:
        raise RuntimeError("Failed to create assistant run")
    return row


def _update_run(conn: Connection, *, run_id: str, status: str, summary: str | None = None, metadata_patch: dict[str, Any] | None = None) -> None:
    row = execute_fetchone(conn, "SELECT metadata_json FROM conversation_runs WHERE id = ?", (run_id,))
    metadata = row.get("metadata_json") if row and isinstance(row.get("metadata_json"), dict) else {}
    if metadata_patch:
        metadata = {**metadata, **metadata_patch}
    now = utc_now().isoformat()
    conn.execute(
        """
        UPDATE conversation_runs
        SET status = ?, summary = COALESCE(?, summary), metadata_json = ?, updated_at = ?
        WHERE id = ?
        """,
        (status, summary, json.dumps(metadata, sort_keys=True), now, run_id),
    )
    conn.commit()


def _record_step(
    conn: Connection,
    *,
    run_id: str,
    thread_id: str,
    step_index: int,
    title: str,
    status: str,
    tool_name: str | None = None,
    tool_kind: str | None = None,
    arguments: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    error_text: str | None = None,
    interrupt_id: str | None = None,
    message_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now().isoformat()
    step_id = new_id("step")
    conn.execute(
        """
        INSERT INTO conversation_run_steps (
          id, run_id, thread_id, message_id, step_index, title, tool_name, tool_kind, status,
          arguments_json, result_json, error_text, interrupt_id, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            step_id,
            run_id,
            thread_id,
            message_id,
            step_index,
            title,
            tool_name,
            tool_kind,
            status,
            json.dumps(arguments or {}, sort_keys=True),
            json.dumps(result or {}, sort_keys=True),
            error_text,
            interrupt_id,
            json.dumps(metadata or {}, sort_keys=True),
            now,
            now,
        ),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM conversation_run_steps WHERE id = ?", (step_id,))
    if row is None:
        raise RuntimeError("Failed to record assistant run step")
    return row


def _create_interrupt(
    conn: Connection,
    *,
    run_id: str,
    thread_id: str,
    tool_name: str,
    interrupt_type: str,
    title: str,
    body: str,
    fields: list[dict[str, Any]],
    primary_label: str,
    secondary_label: str | None,
    metadata: dict[str, Any] | None = None,
    entity_ref: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now().isoformat()
    interrupt_id = new_id("interrupt")
    conn.execute(
        """
        INSERT INTO conversation_interrupts (
          id, run_id, thread_id, status, interrupt_type, tool_name, title, body,
          entity_ref_json, fields_json, primary_label, secondary_label, metadata_json, resolution_json,
          created_at, resolved_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            interrupt_id,
            run_id,
            thread_id,
            "pending",
            interrupt_type,
            tool_name,
            title,
            body,
            json.dumps(entity_ref or {}, sort_keys=True),
            json.dumps(fields, sort_keys=True),
            primary_label,
            secondary_label,
            json.dumps(metadata or {}, sort_keys=True),
            json.dumps({}, sort_keys=True),
            now,
            None,
        ),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM conversation_interrupts WHERE id = ?", (interrupt_id,))
    if row is None:
        raise RuntimeError("Failed to create assistant interrupt")
    presentation = row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {}
    return {
        "id": row["id"],
        "thread_id": row["thread_id"],
        "run_id": row["run_id"],
        "status": row["status"],
        "interrupt_type": row["interrupt_type"],
        "tool_name": row["tool_name"],
        "title": row["title"],
        "body": row.get("body"),
        "entity_ref": row.get("entity_ref_json") if isinstance(row.get("entity_ref_json"), dict) else None,
        "fields": row.get("fields_json") if isinstance(row.get("fields_json"), list) else [],
        "primary_label": row["primary_label"],
        "secondary_label": row.get("secondary_label"),
        "display_mode": presentation.get("display_mode"),
        "consequence_preview": presentation.get("consequence_preview"),
        "defer_label": presentation.get("defer_label"),
        "destructive": bool(presentation.get("destructive", False)),
        "recommended_defaults": presentation.get("recommended_defaults")
        if isinstance(presentation.get("recommended_defaults"), dict)
        else None,
        "metadata": presentation,
        "created_at": row["created_at"],
        "resolved_at": row.get("resolved_at"),
        "resolution": row.get("resolution_json") if isinstance(row.get("resolution_json"), dict) else {},
    }


def _build_interrupt_resolution(*, interrupt_id: str, action: str, values: dict[str, Any]) -> dict[str, Any]:
    now = utc_now().isoformat()
    return {
        "id": new_id("resolution"),
        "interrupt_id": interrupt_id,
        "action": action,
        "values": values,
        "metadata": {},
        "created_at": now,
    }


def _complete_interrupt(
    conn: Connection,
    *,
    interrupt_id: str,
    action: str,
    values: dict[str, Any],
    resolution: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now().isoformat()
    resolution = resolution or _build_interrupt_resolution(interrupt_id=interrupt_id, action=action, values=values)
    next_status = "submitted" if action == "submit" else "dismissed"
    conn.execute(
        """
        UPDATE conversation_interrupts
        SET status = ?, resolution_json = ?, resolved_at = ?
        WHERE id = ?
        """,
        (next_status, json.dumps(resolution, sort_keys=True), now, interrupt_id),
    )
    conn.commit()
    return resolution


def _record_trace(
    conn: Connection,
    *,
    thread_id: str,
    assistant_message_id: str,
    tool_name: str,
    arguments: dict[str, Any],
    status: str,
    result: dict[str, Any],
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now().isoformat()
    trace_id = new_id("trace")
    conn.execute(
        """
        INSERT INTO conversation_tool_traces (
          id, thread_id, message_id, tool_name, arguments_json, status, result_json, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            trace_id,
            thread_id,
            assistant_message_id,
            tool_name,
            json.dumps(arguments, sort_keys=True),
            status,
            json.dumps(result, sort_keys=True),
            json.dumps(metadata or {}, sort_keys=True),
            now,
        ),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM conversation_tool_traces WHERE id = ?", (trace_id,))
    if row is None:
        raise RuntimeError("Failed to record assistant trace")
    return row


def _merge_session_state(conn: Connection, *, command: str, response_text: str, matched_intent: str, planner: str, status: str, tool_names: list[str], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "last_command": command,
        "last_matched_intent": matched_intent,
        "last_planner": planner,
        "last_status": status,
        "last_tool_names": tool_names,
        "last_turn_kind": "assistant_command" if planner == "deterministic" else "chat_turn",
        "last_user_message": command,
        "last_assistant_response": response_text,
        "last_chat_turn_provider": planner,
        "last_chat_turn_model": "",
    }
    if extra:
        payload.update(extra)
    return conversation_service.merge_session_state(conn, payload)


def _build_runtime_request(conn: Connection, *, thread_id: str, content: str, metadata: dict[str, Any]) -> dict[str, Any]:
    snapshot = assistant_thread_service.get_thread_snapshot(conn, thread_id, message_limit=12)
    recent_messages = []
    for message in snapshot["messages"]:
        message_content, message_cards = assistant_projection_service.legacy_projection_from_parts(message["parts"])
        recent_messages.append(
            {
                "id": message["id"],
                "role": message["role"],
                "content": message_content,
                "cards": message_cards,
                "metadata": message.get("metadata", {}),
                "created_at": message["created_at"],
            }
        )
    traces = execute_fetchall(
        conn,
        """
        SELECT id, message_id, tool_name, status, result_json, metadata_json, created_at
        FROM conversation_tool_traces
        WHERE thread_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 10
        """,
        (thread_id,),
    )
    recent_tool_traces: list[dict[str, Any]] = []
    for trace in traces:
        result_payload = trace.get("result_json") if isinstance(trace.get("result_json"), dict) else {}
        metadata_payload = trace.get("metadata_json") if isinstance(trace.get("metadata_json"), dict) else {}
        projected_cards = conversation_card_service.project_step_cards(
            conn,
            SimpleNamespace(
                tool_name=trace["tool_name"],
                result=result_payload,
                arguments={},
                status=trace["status"],
            ),
        )
        recent_tool_traces.append(
            {
                "id": trace["id"],
                "message_id": trace.get("message_id"),
                "tool_name": trace["tool_name"],
                "status": trace["status"],
                "result": result_payload,
                "metadata": metadata_payload,
                "created_at": trace["created_at"],
                "projected_card": projected_cards[0] if projected_cards else None,
            }
        )
    return {
        "thread_id": snapshot["id"],
        "title": snapshot["title"],
        "text": content,
        "context": {
            "thread": {
                "id": snapshot["id"],
                "slug": snapshot["slug"],
                "mode": snapshot["mode"],
            },
            "session_state": snapshot.get("session_state", {}),
            "recent_messages": recent_messages,
            "recent_tool_traces": recent_tool_traces,
            "request_metadata": metadata,
            "memory_context": memory_vault_service.runtime_memory_context(conn, query=content, limit=4),
            "assistant_memory_suggestions": memory_vault_service.list_suggestions(conn, surface="assistant", refresh=True)[:3],
            "ui_capabilities": _ui_capability_manifest(),
        },
    }


def _request_due_date_interrupt(conn: Connection, *, thread_id: str, run_id: str, content: str, title: str, arguments: dict[str, Any], input_mode: str, device_target: str, metadata: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    interrupt = _create_interrupt(
        conn,
        run_id=run_id,
        thread_id=thread_id,
        tool_name="request_due_date",
        interrupt_type="form",
        title="Finish task details",
        body="Give the missing fields so Starlog can create the task without leaving the thread.",
        fields=[
            {"id": "due_date", "kind": "date", "label": "Due date", "required": True},
            {"id": "priority", "kind": "priority", "label": "Priority", "value": int(arguments.get("priority") or 3), "min": 1, "max": 5},
            {"id": "create_time_block", "kind": "toggle", "label": "Create 45m block", "value": False},
        ],
        primary_label="Create task",
        secondary_label="Not now",
        metadata={
            "planned_tool_name": "create_task",
            "planned_arguments": arguments,
            "user_content": content,
            "input_mode": input_mode,
            "device_target": device_target,
            "request_metadata": metadata,
            "display_mode": "composer",
            "consequence_preview": "Creates a Planner task. Time blocking can be handled next.",
            "defer_label": "Not now",
            "recommended_defaults": {
                "priority": int(arguments.get("priority") or 3),
                "create_time_block": False,
            },
        },
        entity_ref={"entity_type": "task", "entity_id": f"draft:{title}", "title": title},
    )
    assistant_message = assistant_thread_service.append_message(
        conn,
        thread_id=thread_id,
        role="assistant",
        status="requires_action",
        run_id=run_id,
        metadata={
            "assistant_command": {
                "command": content,
                "planner": "deterministic",
                "matched_intent": "create_task",
                "status": "planned",
                "summary": f"Create task {title}",
                "steps": [],
            },
            "interrupt_id": interrupt["id"],
        },
        parts=[
            assistant_projection_service.text_part("I can add that now. I only need when you want it due."),
            assistant_projection_service.card_part(assistant_projection_service.draft_task_card(title=title, priority=int(arguments.get("priority") or 3))),
            assistant_projection_service.interrupt_request_part(interrupt),
            assistant_projection_service.status_part("requires_action", "Waiting for task details"),
        ],
    )
    _record_step(
        conn,
        run_id=run_id,
        thread_id=thread_id,
        step_index=0,
        title="Request missing task details",
        tool_name="request_due_date",
        tool_kind="ui_tool",
        status="requires_action",
        arguments=arguments,
        result={"interrupt_id": interrupt["id"]},
        interrupt_id=interrupt["id"],
        message_id=assistant_message["id"],
    )
    _record_trace(
        conn,
        thread_id=thread_id,
        assistant_message_id=assistant_message["id"],
        tool_name="request_due_date",
        arguments=arguments,
        status="requires_action",
        result={"interrupt_id": interrupt["id"]},
        metadata={"planner": "deterministic", "kind": "ui_tool"},
    )
    _update_run(conn, run_id=run_id, status="interrupted", summary=f"Create task {title}")
    _merge_session_state(
        conn,
        command=content,
        response_text=f"Create task {title}",
        matched_intent="create_task",
        planner="deterministic",
        status="planned",
        tool_names=["request_due_date"],
    )
    return interrupt, assistant_message


def _assistant_message_from_command_response(
    conn: Connection,
    *,
    thread_id: str,
    run_id: str,
    command: str,
    response: AgentCommandResponse,
    input_mode: str,
    device_target: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    cards = conversation_card_service.project_agent_response_cards(conn, response)
    parts: list[dict[str, Any]] = [assistant_projection_service.text_part(response.summary)]
    for step in response.steps:
        tool_call_id = new_id("toolcall")
        tool_status = "complete" if step.status in {"ok", "completed", "dry_run"} else "error"
        if step.status == "confirmation_required":
            tool_status = "requires_action"
        parts.append(
            {
                "type": "tool_call",
                "id": new_id("part"),
                "tool_call": {
                    "id": tool_call_id,
                    "tool_name": step.tool_name,
                    "tool_kind": "domain_tool",
                    "status": tool_status,
                    "arguments": step.arguments,
                    "title": step.message,
                    "metadata": {
                        "backing_endpoint": step.backing_endpoint,
                        "confirmation_state": step.confirmation_state,
                    },
                },
            }
        )
        parts.append(
            assistant_projection_service.tool_result_part(
                tool_call_id=tool_call_id,
                status=tool_status,
                output=step.result if isinstance(step.result, dict) else {"value": step.result},
                metadata={"message": step.message or ""},
            )
        )
    for card in cards:
        parts.append(assistant_projection_service.card_part(card))

    assistant_message = assistant_thread_service.append_message(
        conn,
        thread_id=thread_id,
        role="assistant",
        status="complete" if response.status != "failed" else "error",
        run_id=run_id,
        metadata={
            "assistant_command": response.model_dump(mode="json"),
            "matched_intent": response.matched_intent,
            "planner": response.planner,
            "status": response.status,
            "input_mode": input_mode,
            "device_target": device_target,
            "request_metadata": metadata,
        },
        parts=parts,
    )
    for index, step in enumerate(response.steps):
        _record_step(
            conn,
            run_id=run_id,
            thread_id=thread_id,
            step_index=index,
            title=step.message or step.tool_name,
            tool_name=step.tool_name,
            tool_kind="domain_tool",
            status="completed" if step.status in {"ok", "completed", "dry_run"} else step.status,
            arguments=step.arguments,
            result=step.result if isinstance(step.result, dict) else {"value": step.result},
            message_id=assistant_message["id"],
            metadata={
                "backing_endpoint": step.backing_endpoint,
                "requires_confirmation": step.requires_confirmation,
                "confirmation_state": step.confirmation_state,
            },
        )
        _record_trace(
            conn,
            thread_id=thread_id,
            assistant_message_id=assistant_message["id"],
            tool_name=step.tool_name,
            arguments=step.arguments,
            status=step.status,
            result=step.result if isinstance(step.result, dict) else {"value": step.result},
            metadata={
                "planner": response.planner,
                "message": step.message,
                "backing_endpoint": step.backing_endpoint,
                "requires_confirmation": step.requires_confirmation,
                "confirmation_state": step.confirmation_state,
            },
        )
    _merge_session_state(
        conn,
        command=command,
        response_text=response.summary,
        matched_intent=response.matched_intent,
        planner=response.planner,
        status=response.status,
        tool_names=[step.tool_name for step in response.steps],
    )
    _update_run(conn, run_id=run_id, status="completed" if response.status != "failed" else "failed", summary=response.summary)
    return assistant_message


def _assistant_message_from_runtime_turn(
    conn: Connection,
    *,
    thread_id: str,
    run_id: str,
    content: str,
    turn: dict[str, Any],
    input_mode: str,
    device_target: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    runtime_cards = conversation_card_service.normalize_cards(
        turn.get("cards") if isinstance(turn.get("cards"), list) else [
            {
                "kind": "assistant_summary",
                "title": "Assistant",
                "body": str(turn.get("response_text") or ""),
                "metadata": {},
            }
        ]
    )
    runtime_parts = assistant_projection_service.normalize_runtime_parts(
        turn.get("parts") if isinstance(turn.get("parts"), list) else []
    )
    if runtime_parts:
        if runtime_cards and not any(part.get("type") == "card" for part in runtime_parts):
            runtime_parts.extend(assistant_projection_service.card_part(card) for card in runtime_cards)
        if str(turn.get("response_text") or "").strip() and not any(part.get("type") == "text" for part in runtime_parts):
            runtime_parts.insert(0, assistant_projection_service.text_part(str(turn.get("response_text") or "")))
    else:
        runtime_parts = assistant_projection_service.synthesize_parts_from_legacy(
            content=str(turn.get("response_text") or ""),
            cards=runtime_cards,
        )
    suggestion_cards = conversation_card_service.memory_suggestion_cards(conn, surface="assistant", limit=2)
    for card in suggestion_cards:
        runtime_parts.append(assistant_projection_service.card_part(card))
    response_text, all_cards = assistant_projection_service.legacy_projection_from_parts(runtime_parts)
    assistant_message = assistant_thread_service.append_message(
        conn,
        thread_id=thread_id,
        role="assistant",
        status="complete",
        run_id=run_id,
        metadata={
            "chat_turn": {
                "workflow": turn.get("workflow") or "chat_turn",
                "provider_used": turn.get("provider_used") or "local_prompt_preview",
                "model": turn.get("model") or "",
                "metadata": turn.get("metadata") if isinstance(turn.get("metadata"), dict) else {},
            },
            "status": "completed",
            "input_mode": input_mode,
            "device_target": device_target,
            "request_metadata": metadata,
        },
        parts=runtime_parts,
    )
    _record_step(
        conn,
        run_id=run_id,
        thread_id=thread_id,
        step_index=0,
        title="Chat turn runtime",
        tool_name="chat_turn_runtime",
        tool_kind="system_tool",
        status="completed",
        arguments={"content": content},
        result={
            "response_text": response_text,
            "cards": all_cards,
            "parts": runtime_parts,
        },
        message_id=assistant_message["id"],
        metadata={
            "workflow": turn.get("workflow") or "chat_turn",
            "provider_used": turn.get("provider_used") or "local_prompt_preview",
            "model": turn.get("model") or "",
        },
    )
    _record_trace(
        conn,
        thread_id=thread_id,
        assistant_message_id=assistant_message["id"],
        tool_name="chat_turn_runtime",
        arguments={"content": content},
        status="completed",
        result={"response_text": response_text, "cards": all_cards, "parts": runtime_parts},
        metadata={
            "workflow": turn.get("workflow") or "chat_turn",
            "provider_used": turn.get("provider_used") or "local_prompt_preview",
            "model": turn.get("model") or "",
            "system_prompt": turn.get("system_prompt") or "",
            "user_prompt": turn.get("user_prompt") or "",
            "metadata": turn.get("metadata") if isinstance(turn.get("metadata"), dict) else {},
        },
    )
    conversation_service.merge_session_state(
        conn,
        {
            **(turn.get("session_state") if isinstance(turn.get("session_state"), dict) else {}),
            "last_turn_kind": "chat_turn",
            "last_user_message": content,
            "last_assistant_response": response_text,
            "last_chat_turn_provider": turn.get("provider_used") or "local_prompt_preview",
            "last_chat_turn_model": turn.get("model") or "",
        },
    )
    _update_run(conn, run_id=run_id, status="completed", summary=response_text)
    return assistant_message


def start_run(
    conn: Connection,
    *,
    thread_id: str,
    content: str,
    input_mode: str,
    device_target: str,
    metadata: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    thread = assistant_thread_service.get_thread(conn, thread_id, user_id=user_id)
    raw_request_metadata = metadata if isinstance(metadata, dict) else {}
    request_metadata = {
        key: value for key, value in raw_request_metadata.items() if key not in {"handoff_context", "handoff_token"}
    }
    handoff_token = str(raw_request_metadata.get("handoff_token") or "").strip()
    if handoff_token:
        request_metadata["handoff_context"] = assistant_handoff_service.resolve_handoff(
            conn,
            token=handoff_token,
            user_id=str(thread.get("owner_user_id") or user_id or ""),
        )
    user_message = assistant_thread_service.append_message(
        conn,
        thread_id=thread["id"],
        role="user",
        status="complete",
        metadata={
            "input_mode": input_mode,
            "device_target": device_target,
            "request_metadata": request_metadata,
        },
        parts=[assistant_projection_service.text_part(content)],
        user_id=user_id,
    )
    run = _create_run(
        conn,
        thread_id=thread["id"],
        origin_message_id=user_message["id"],
        orchestrator="hybrid",
        metadata={"input_mode": input_mode, "device_target": device_target},
    )

    try:
        try:
            matched_intent, summary, planned_calls = agent_command_service.plan_command(
                conn,
                content,
                device_target=device_target,
            )
        except ValueError:
            matched_intent = ""
            summary = ""
            planned_calls = []

        if planned_calls:
            first_call = planned_calls[0]
            if first_call.tool_name == "create_task" and "due_at" not in first_call.arguments:
                _request_due_date_interrupt(
                    conn,
                    thread_id=thread["id"],
                    run_id=run["id"],
                    content=content,
                    title=str(first_call.arguments.get("title") or "New task"),
                    arguments=first_call.arguments,
                    input_mode=input_mode,
                    device_target=device_target,
                    metadata=request_metadata,
                )
            else:
                response = agent_command_service.execute_planned_command(
                    conn,
                    command=content,
                    planner="deterministic",
                    matched_intent=matched_intent,
                    summary=summary,
                    execute=True,
                    planned_calls=planned_calls,
                )
                _assistant_message_from_command_response(
                    conn,
                    thread_id=thread["id"],
                    run_id=run["id"],
                    command=content,
                    response=response,
                    input_mode=input_mode,
                    device_target=device_target,
                    metadata=request_metadata,
                )
        else:
            runtime_request = _build_runtime_request(
                conn,
                thread_id=thread["id"],
                content=content,
                metadata=request_metadata,
            )
            turn = ai_service.execute_chat_turn(runtime_request)
            _assistant_message_from_runtime_turn(
                conn,
                thread_id=thread["id"],
                run_id=run["id"],
                content=content,
                turn=turn,
                input_mode=input_mode,
                device_target=device_target,
                metadata=request_metadata,
            )
    except Exception as exc:
        _record_run_failure(
            conn,
            thread_id=thread["id"],
            run_id=run["id"],
            error_text=str(exc),
            stage="assistant_turn",
            metadata={
                "input_mode": input_mode,
                "device_target": device_target,
                "request_metadata": request_metadata,
            },
        )

    snapshot = assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)
    final_run = next(item for item in snapshot["runs"] if item["id"] == run["id"])
    assistant_messages = [message for message in snapshot["messages"] if message.get("run_id") == run["id"] and message["role"] == "assistant"]
    return {
        "thread_id": thread["id"],
        "run": final_run,
        "user_message": user_message,
        "assistant_message": assistant_messages[-1],
        "snapshot": snapshot,
    }


def queue_voice_run(
    conn: Connection,
    *,
    thread_id: str,
    blob_ref: str,
    content_type: str | None,
    title: str | None,
    duration_ms: int | None,
    device_target: str,
    provider_hint: str | None = None,
    metadata: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    thread = assistant_thread_service.get_thread(conn, thread_id, user_id=user_id)
    owner_user_id = assistant_thread_service._require_assistant_user(conn, user_id)
    resolved_provider_hint = (
        provider_hint
        or integrations_service.default_batch_provider_hint(conn, "stt")
        or "desktop_bridge_stt"
    )
    request_metadata = metadata or {}
    return ai_jobs_service.create_job(
        conn,
        capability="stt",
        payload={
            "blob_ref": blob_ref,
            "content_type": content_type,
            "title": title or "Assistant voice message",
            "duration_ms": duration_ms,
            "assistant_thread": {
                "thread_id": thread["id"],
                "kind": "voice_message",
                "input_mode": "voice",
                "device_target": device_target,
                "metadata": request_metadata,
            },
        },
        provider_hint=resolved_provider_hint,
        owner_user_id=owner_user_id,
        requested_targets=integrations_service.capability_execution_order(
            conn,
            "stt",
            executable_targets={"mobile_bridge", "desktop_bridge", "api"},
            prefer_local=True,
        ),
        action="assistant_thread_voice",
    )


def _interrupt_row(conn: Connection, interrupt_id: str, *, user_id: str | None = None) -> dict[str, Any]:
    owner_user_id = assistant_thread_service._require_assistant_user(conn, user_id)
    sql = """
        SELECT i.*
        FROM conversation_interrupts i
        JOIN conversation_threads t ON t.id = i.thread_id
        WHERE i.id = ?
    """
    params: tuple[Any, ...] = (interrupt_id,)
    if owner_user_id is not None:
        sql += " AND t.owner_user_id = ?"
        params += (owner_user_id,)
    row = execute_fetchone(conn, sql, params)
    if row is None:
        raise LookupError(f"Assistant interrupt not found: {interrupt_id}")
    return row


def _run_row(conn: Connection, run_id: str, *, user_id: str | None = None) -> dict[str, Any]:
    owner_user_id = assistant_thread_service._require_assistant_user(conn, user_id)
    sql = """
        SELECT r.*
        FROM conversation_runs r
        JOIN conversation_threads t ON t.id = r.thread_id
        WHERE r.id = ?
    """
    params: tuple[Any, ...] = (run_id,)
    if owner_user_id is not None:
        sql += " AND t.owner_user_id = ?"
        params += (owner_user_id,)
    row = execute_fetchone(conn, sql, params)
    if row is None:
        raise LookupError(f"Assistant run not found: {run_id}")
    return row


def get_run(conn: Connection, *, thread_id: str, run_id: str, user_id: str | None = None) -> dict[str, Any]:
    snapshot = assistant_thread_service.get_thread_snapshot(conn, thread_id, user_id=user_id)
    for run in snapshot["runs"]:
        if run["id"] == run_id:
            return run
    raise LookupError(f"Assistant run not found: {run_id}")


def cancel_run(conn: Connection, *, run_id: str, user_id: str | None = None) -> dict[str, Any]:
    row = _run_row(conn, run_id, user_id=user_id)
    _update_run(conn, run_id=run_id, status="cancelled", summary="Run cancelled")
    return get_run(conn, thread_id=str(row["thread_id"]), run_id=run_id, user_id=user_id)


def submit_interrupt(conn: Connection, *, interrupt_id: str, values: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
    row = _interrupt_row(conn, interrupt_id, user_id=user_id)
    if row["status"] != "pending":
        raise ValueError("Interrupt is no longer pending")

    metadata = row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {}
    planned_arguments = metadata.get("planned_arguments") if isinstance(metadata.get("planned_arguments"), dict) else {}
    user_content = str(metadata.get("user_content") or "Create task")
    due_date_raw = str(values.get("due_date") or "").strip()
    if row["tool_name"] == "request_due_date" and not due_date_raw:
        raise ValueError("due_date is required")

    resolution = _build_interrupt_resolution(interrupt_id=interrupt_id, action="submit", values=values)
    try:
        if row["tool_name"] == "request_due_date":
            client_timezone = _assistant_client_timezone(metadata.get("request_metadata"), values)
            due_at = _due_date_to_utc_start(due_date_raw, client_timezone=client_timezone)
            priority = int(values.get("priority") or planned_arguments.get("priority") or 3)
            create_arguments = {
                **planned_arguments,
                "due_at": due_at.isoformat(),
                "priority": priority,
            }
            spec, _validated, normalized, confirmation_policy = agent_service.prepare_tool_call("create_task", create_arguments)
            status_text, _executed_arguments, result = agent_service.execute_tool(
                conn,
                tool_name="create_task",
                arguments=normalized,
                dry_run=False,
            )
            step = AgentCommandStep(
                tool_name="create_task",
                arguments=normalized,
                status="ok" if status_text in {"ok", "completed"} else status_text,
                message=f"Create task {normalized['title']}",
                result=result,
                backing_endpoint=spec.backing_endpoint,
                requires_confirmation=confirmation_policy.mode == "always",
                confirmation_state="confirmed",
            )
            response = AgentCommandResponse(
                command=user_content,
                planner="deterministic",
                matched_intent="create_task",
                status="executed",
                summary=f"Created task {normalized['title']}.",
                steps=[step],
            )
            assistant_message = assistant_thread_service.append_message(
                conn,
                thread_id=row["thread_id"],
                role="assistant",
                status="complete",
                run_id=row["run_id"],
                metadata={
                    "assistant_command": response.model_dump(mode="json"),
                    "interrupt_resolution": resolution,
                    "due_date_resolution": {
                        "due_date": due_date_raw,
                        "client_timezone": client_timezone,
                        "due_at_utc": due_at.isoformat(),
                    },
                },
                parts=[
                    assistant_projection_service.text_part(response.summary),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                    *[
                        assistant_projection_service.card_part(card)
                        for card in conversation_card_service.project_agent_response_cards(conn, response)
                    ],
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=1,
                title="Create task after due date resolution",
                tool_name="create_task",
                tool_kind="domain_tool",
                status="completed",
                arguments={
                    **normalized,
                    "due_date": due_date_raw,
                    "client_timezone": client_timezone,
                },
                result=result,
                interrupt_id=interrupt_id,
                message_id=assistant_message["id"],
            )
            _record_trace(
                conn,
                thread_id=row["thread_id"],
                assistant_message_id=assistant_message["id"],
                tool_name="create_task",
                arguments={
                    **normalized,
                    "due_date": due_date_raw,
                    "client_timezone": client_timezone,
                },
                status="completed",
                result=result,
                metadata={"resolved_from_interrupt": interrupt_id},
            )
            _merge_session_state(
                conn,
                command=user_content,
                response_text=response.summary,
                matched_intent="create_task",
                planner="deterministic",
                status="executed",
                tool_names=["create_task"],
            )
            _complete_interrupt(
                conn,
                interrupt_id=interrupt_id,
                action="submit",
                values=values,
                resolution=resolution,
            )
            _update_run(conn, run_id=row["run_id"], status="completed", summary=response.summary)
        elif row["tool_name"] == "triage_capture":
            artifact_id = str(metadata.get("artifact_id") or "")
            artifact = artifacts_service.get_artifact(conn, artifact_id) if artifact_id else None
            next_step_value = str(values.get("next_step") or "follow_up").strip()
            action_status: str | None = None
            output_ref: str | None = None
            if artifact is not None:
                artifact_metadata = dict(artifact.get("metadata") or {})
                artifact_metadata["triage"] = {
                    "capture_kind": values.get("capture_kind"),
                    "next_step": next_step_value,
                    "updated_at": utc_now().isoformat(),
                }
                if next_step_value == "archive":
                    artifact_metadata["triage"]["archived_as_reference"] = True
                conn.execute(
                    "UPDATE artifacts SET metadata_json = ?, updated_at = ? WHERE id = ?",
                    (
                        json.dumps(artifact_metadata, sort_keys=True),
                        utc_now().isoformat(),
                        artifact_id,
                    ),
                )
                conn.commit()
                if next_step_value in {"summarize", "cards", "tasks", "append_note"}:
                    action_status, output_ref = artifacts_service.run_action(
                        conn,
                        artifact_id,
                        next_step_value,
                        defer=False,
                        user_id=user_id,
                    )
                    artifact = artifacts_service.get_artifact(conn, artifact_id) or artifact
            next_step = next_step_value.replace("_", " ")
            result_card = _capture_triage_result_card(
                conn,
                artifact_id=artifact_id,
                artifact=artifact,
                action=next_step_value,
                action_status=action_status,
                output_ref=output_ref,
            )
            assistant_message = assistant_thread_service.append_message(
                conn,
                thread_id=row["thread_id"],
                role="assistant",
                status="complete",
                run_id=row["run_id"],
                metadata={
                    "interrupt_resolution": resolution,
                    "capture_triage": {
                        "artifact_id": artifact_id,
                        "next_step": next_step_value,
                        "action_status": action_status,
                        "output_ref": output_ref,
                    },
                },
                parts=[
                    assistant_projection_service.text_part(
                        f"Saved the capture triage. Next step: {next_step}."
                        + (f" Action {action_status}." if action_status else "")
                    ),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                    *([assistant_projection_service.card_part(result_card)] if result_card else []),
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=1,
                title="Save capture triage",
                tool_name="triage_capture",
                tool_kind="ui_tool",
                status="completed",
                arguments=values,
                result={
                    "artifact_id": artifact_id,
                    "next_step": next_step_value,
                    "action_status": action_status,
                    "output_ref": output_ref,
                },
                interrupt_id=interrupt_id,
                message_id=assistant_message["id"],
            )
            _complete_interrupt(
                conn,
                interrupt_id=interrupt_id,
                action="submit",
                values=values,
                resolution=resolution,
            )
            _update_run(conn, run_id=row["run_id"], status="completed", summary="Capture triage saved")
        elif row["tool_name"] == "resolve_planner_conflict":
            resolution_choice = str(values.get("resolution") or "").strip() or "open_planner"
            assistant_message = assistant_thread_service.append_message(
                conn,
                thread_id=row["thread_id"],
                role="assistant",
                status="complete",
                run_id=row["run_id"],
                metadata={"interrupt_resolution": resolution},
                parts=[
                    assistant_projection_service.text_part(f"Recorded the planner conflict resolution: {resolution_choice}."),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=1,
                title="Resolve planner conflict",
                tool_name="resolve_planner_conflict",
                tool_kind="ui_tool",
                status="completed",
                arguments=values,
                result={"resolution": resolution_choice},
                interrupt_id=interrupt_id,
                message_id=assistant_message["id"],
            )
            _complete_interrupt(
                conn,
                interrupt_id=interrupt_id,
                action="submit",
                values=values,
                resolution=resolution,
            )
            _update_run(conn, run_id=row["run_id"], status="completed", summary="Planner conflict resolved")
        elif row["tool_name"] == "choose_morning_focus":
            focus = str(values.get("focus") or "").strip() or "review"
            assistant_message = assistant_thread_service.append_message(
                conn,
                thread_id=row["thread_id"],
                role="assistant",
                status="complete",
                run_id=row["run_id"],
                metadata={"interrupt_resolution": resolution},
                parts=[
                    assistant_projection_service.text_part(f"Locked in the first move for today: {focus.replace('_', ' ')}."),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=1,
                title="Choose morning focus",
                tool_name="choose_morning_focus",
                tool_kind="ui_tool",
                status="completed",
                arguments=values,
                result={"focus": focus},
                interrupt_id=interrupt_id,
                message_id=assistant_message["id"],
            )
            _complete_interrupt(
                conn,
                interrupt_id=interrupt_id,
                action="submit",
                values=values,
                resolution=resolution,
            )
            _update_run(conn, run_id=row["run_id"], status="completed", summary="Morning focus selected")
        elif row["tool_name"] == "grade_review_recall":
            rating_raw = values.get("rating")
            try:
                rating = int(rating_raw)
            except (TypeError, ValueError) as exc:
                raise ValueError("Review rating must be one of 1, 3, 4, or 5") from exc
            if rating not in {1, 3, 4, 5}:
                raise ValueError("Review rating must be one of 1, 3, 4, or 5")

            latency_raw = values.get("latency_ms")
            latency_ms: int | None = None
            if latency_raw not in (None, ""):
                try:
                    latency_ms = int(latency_raw)
                except (TypeError, ValueError) as exc:
                    raise ValueError("Review latency must be a non-negative integer when provided") from exc
                if latency_ms < 0:
                    raise ValueError("Review latency must be a non-negative integer when provided")

            card_id = str(metadata.get("card_id") or "").strip() or str(
                ((row.get("entity_ref_json") or {}) if isinstance(row.get("entity_ref_json"), dict) else {}).get("entity_id") or ""
            ).strip()
            if not card_id:
                raise ValueError("Review interrupt is missing the target card")

            reviewed = srs_service.review_card(conn, card_id=card_id, rating=rating, latency_ms=latency_ms)
            if reviewed is None:
                raise LookupError(f"Review card not found: {card_id}")

            prompt_text = str(metadata.get("prompt") or "that card").strip() or "that card"
            card_type = str(metadata.get("card_type") or reviewed.get("card_type") or "").strip() or None
            raw_review_mode = str(metadata.get("review_mode") or reviewed.get("review_mode") or "").strip()
            review_mode = (
                raw_review_mode
                if raw_review_mode in review_mode_service.REVIEW_MODE_ORDER
                else review_mode_service.review_mode_for_card_type(card_type)
            )
            review_mode_label = review_mode.replace("_", " ")
            rating_label = _review_rating_label(rating)
            next_due_at = str(reviewed.get("next_due_at") or "")
            next_due_label = next_due_at[:10] if next_due_at else "the next review window"
            assistant_message = assistant_thread_service.append_message(
                conn,
                thread_id=row["thread_id"],
                role="assistant",
                status="complete",
                run_id=row["run_id"],
                metadata={
                    "interrupt_resolution": resolution,
                    "review_result": reviewed,
                    "card_type": card_type,
                    "review_mode": review_mode,
                },
                parts=[
                    assistant_projection_service.text_part(
                        f"Recorded {rating_label} for {review_mode_label} review: {prompt_text}. Next due: {next_due_label}."
                    ),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=1,
                title="Grade review recall",
                tool_name="grade_review_recall",
                tool_kind="ui_tool",
                status="completed",
                arguments={"rating": rating, "latency_ms": latency_ms, "card_type": card_type, "review_mode": review_mode},
                result=reviewed,
                interrupt_id=interrupt_id,
                message_id=assistant_message["id"],
            )
            _complete_interrupt(
                conn,
                interrupt_id=interrupt_id,
                action="submit",
                values=values,
                resolution=resolution,
            )
            _update_run(conn, run_id=row["run_id"], status="completed", summary="Review grade recorded")
        else:
            raise ValueError(f"Unsupported interrupt tool: {row['tool_name']}")
    except Exception as exc:
        _record_run_failure(
            conn,
            thread_id=str(row["thread_id"]),
            run_id=str(row["run_id"]),
            error_text=str(exc),
            stage=f"interrupt:{row['tool_name']}",
            metadata={"interrupt_id": interrupt_id},
        )

    return assistant_thread_service.get_thread_snapshot(conn, str(row["thread_id"]), user_id=user_id)


def dismiss_interrupt(conn: Connection, *, interrupt_id: str, user_id: str | None = None) -> dict[str, Any]:
    row = _interrupt_row(conn, interrupt_id, user_id=user_id)
    if row["status"] != "pending":
        raise ValueError("Interrupt is no longer pending")
    resolution = _complete_interrupt(conn, interrupt_id=interrupt_id, action="dismiss", values={})
    assistant_thread_service.append_message(
        conn,
        thread_id=row["thread_id"],
        role="assistant",
        status="complete",
        run_id=row["run_id"],
        metadata={"interrupt_resolution": resolution},
        parts=[
            assistant_projection_service.text_part("Okay. I left that as a draft and kept the thread moving."),
            assistant_projection_service.interrupt_resolution_part(resolution),
        ],
    )
    _update_run(conn, run_id=row["run_id"], status="cancelled", summary="Interrupt dismissed")
    return assistant_thread_service.get_thread_snapshot(conn, str(row["thread_id"]), user_id=user_id)
