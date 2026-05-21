from __future__ import annotations

import json
import re
from datetime import datetime, time, timezone
from sqlite3 import Connection
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.time import utc_now
from app.schemas.agent import AgentCommandResponse
from app.schemas.assistant import AssistantRuntimeRequest
from app.services import (
    agent_command_service,
    ai_jobs_service,
    ai_service,
    assistant_handoff_service,
    assistant_interrupt_handlers,
    assistant_projection_service,
    assistant_thread_service,
    artifacts_service,
    conversation_card_service,
    conversation_service,
    integrations_service,
    memory_service,
    memory_vault_service,
)
from app.services.common import execute_fetchall, execute_fetchone, new_id


def _ui_capability_manifest() -> dict[str, Any]:
    return {
        "version": "starlog.dynamic_ui_capabilities.v1",
        "ui_tools": [
            {
                "tool_name": "list_dynamic_ui_capabilities",
                "kind": "protocol",
                "description": "Return the backend-approved dynamic UI renderer/action registry.",
                "action_examples": ["show me what UI actions you can take"],
            },
            {
                "tool_name": "mark_study_topic_read",
                "kind": "domain_tool",
                "description": "Mark an interview-prep topic read and emit the topic unlock/read renderer payload.",
                "renderer_key": "interview.topic_unlock",
                "renderer_version": 1,
                "action_examples": ["read Sliding Window", "unlock/read Sliding Window"],
            },
            {
                "tool_name": "unlock_study_topic",
                "kind": "domain_tool",
                "description": "Unlock an interview-prep topic and emit the topic unlock renderer payload.",
                "renderer_key": "interview.topic_unlock",
                "renderer_version": 1,
                "action_examples": ["unlock Sliding Window"],
            },
            {
                "tool_name": "create_study_question_request",
                "kind": "domain_tool",
                "description": "Request interview-prep questions and emit the question request renderer payload.",
                "renderer_key": "interview.question_request",
                "renderer_version": 1,
                "action_examples": [
                    "quiz me with application questions",
                    "quiz me on application questions for Sliding Window",
                ],
            },
            {
                "tool_name": "grade_review_recall",
                "kind": "choice",
                "description": "Record a review grade and emit the review grade renderer payload.",
                "renderer_key": "interview.review_grade",
                "renderer_version": 1,
                "action_examples": ["grade the revealed review card"],
            },
            {
                "tool_name": "request_due_date",
                "kind": "form",
                "description": "Ask for missing task due-date fields.",
            },
            {
                "tool_name": "resolve_planner_conflict",
                "kind": "choice",
                "description": "Ask the user to resolve a planner conflict.",
            },
            {
                "tool_name": "triage_capture",
                "kind": "form",
                "description": "Ask how to process a captured artifact.",
            },
            {
                "tool_name": "choose_morning_focus",
                "kind": "choice",
                "description": "Ask which focus should drive a morning briefing.",
            },
        ],
        "renderers": [
            {
                "renderer_key": "interview.topic_unlock",
                "renderer_version": 1,
                "placements": ["thread"],
                "tool_names": ["mark_study_topic_read", "unlock_study_topic"],
                "structured_content_fields": ["topic", "topic_id", "topic_title", "unlock_reason"],
                "ui_meta_fields": ["tone", "action", "status", "source_id"],
                "description": "Show an interview-prep topic unlock/read state from backend tool output.",
            },
            {
                "renderer_key": "interview.question_request",
                "renderer_version": 1,
                "placements": ["thread"],
                "tool_names": ["create_study_question_request"],
                "structured_content_fields": [
                    "request",
                    "source_id",
                    "topic_id",
                    "question_type",
                    "prompt",
                ],
                "ui_meta_fields": ["tone", "request_id", "question_preference"],
                "description": "Show a backend-created interview-prep question request.",
            },
            {
                "renderer_key": "interview.review_grade",
                "renderer_version": 1,
                "placements": ["inline", "thread"],
                "tool_names": ["grade_review_recall"],
                "structured_content_fields": ["card_id", "grade", "next_due_at"],
                "ui_meta_fields": ["tone", "rating_label", "review_mode", "card_type"],
                "description": "Show review grading choices/results backed by SRS scheduling updates.",
            },
        ],
        "surfaces": ["assistant", "library", "planner", "review", "desktop_helper"],
        "command_examples": [
            "show me what UI actions you can take",
            "unlock/read Sliding Window",
            "read Sliding Window",
            "quiz me with application questions",
            "quiz me on application questions for Sliding Window",
        ],
    }


def _review_rating_label(rating: int) -> str:
    return {
        1: "Again",
        2: "Again",
        3: "Hard",
        4: "Good",
        5: "Easy",
    }.get(rating, f"Rating {rating}")


def _assistant_client_timezone(
    metadata: dict[str, Any] | None, values: dict[str, Any] | None = None
) -> str:
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


def _pending_interrupt_count(conn: Connection, *, run_id: str) -> int:
    row = execute_fetchone(
        conn,
        "SELECT COUNT(*) AS count FROM conversation_interrupts WHERE run_id = ? AND status = 'pending'",
        (run_id,),
    )
    return int(row.get("count") or 0) if row is not None else 0


def _update_run_after_interrupt_resolution(
    conn: Connection,
    *,
    run_id: str,
    status: str,
    summary: str | None = None,
    metadata_patch: dict[str, Any] | None = None,
) -> None:
    if status in {"completed", "cancelled"} and _pending_interrupt_count(conn, run_id=run_id) > 0:
        _update_run(
            conn,
            run_id=run_id,
            status="interrupted",
            summary=summary,
            metadata_patch=metadata_patch,
        )
        return
    _update_run(conn, run_id=run_id, status=status, summary=summary, metadata_patch=metadata_patch)


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


def _create_run(
    conn: Connection,
    *,
    thread_id: str,
    origin_message_id: str | None,
    orchestrator: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now().isoformat()
    run_id = new_id("run")
    run_metadata = dict(metadata or {})
    run_metadata.setdefault("ui_capabilities", _ui_capability_manifest())
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
            json.dumps(run_metadata, sort_keys=True),
            now,
            now,
        ),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM conversation_runs WHERE id = ?", (run_id,))
    if row is None:
        raise RuntimeError("Failed to create assistant run")
    return row


def _update_run(
    conn: Connection,
    *,
    run_id: str,
    status: str,
    summary: str | None = None,
    metadata_patch: dict[str, Any] | None = None,
) -> None:
    row = execute_fetchone(
        conn, "SELECT metadata_json FROM conversation_runs WHERE id = ?", (run_id,)
    )
    metadata = (
        row.get("metadata_json") if row and isinstance(row.get("metadata_json"), dict) else {}
    )
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
    renderer_key: str | None = None,
    renderer_version: int | None = None,
    placement: str | None = None,
    structured_content: dict[str, Any] | None = None,
    ui_meta: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    entity_ref: dict[str, Any] | None = None,
    tool_call_id: str | None = None,
) -> dict[str, Any]:
    now = utc_now().isoformat()
    interrupt_id = new_id("interrupt")
    interrupt_metadata = dict(metadata or {})
    if tool_call_id:
        interrupt_metadata["tool_call_id"] = tool_call_id
    if renderer_key:
        interrupt_metadata["renderer_key"] = renderer_key
    if renderer_version is not None:
        interrupt_metadata["renderer_version"] = renderer_version
    if placement:
        interrupt_metadata["placement"] = placement
    if structured_content is not None:
        interrupt_metadata["structured_content"] = structured_content
    if ui_meta is not None:
        interrupt_metadata["ui_meta"] = ui_meta
    interrupt_metadata.setdefault("tool_call_id", new_id("toolcall"))
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
            json.dumps(interrupt_metadata, sort_keys=True),
            json.dumps({}, sort_keys=True),
            now,
            None,
        ),
    )
    conn.commit()
    row = execute_fetchone(
        conn, "SELECT * FROM conversation_interrupts WHERE id = ?", (interrupt_id,)
    )
    if row is None:
        raise RuntimeError("Failed to create assistant interrupt")
    presentation = row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {}
    tool_call_id = (
        str(presentation.get("tool_call_id"))
        if isinstance(presentation.get("tool_call_id"), str)
        else str(row["id"])
    )
    return {
        "id": row["id"],
        "thread_id": row["thread_id"],
        "run_id": row["run_id"],
        "tool_call_id": tool_call_id,
        "status": row["status"],
        "interrupt_type": row["interrupt_type"],
        "tool_name": row["tool_name"],
        "title": row["title"],
        "body": row.get("body"),
        "renderer_key": presentation.get("renderer_key")
        if isinstance(presentation.get("renderer_key"), str)
        else None,
        "renderer_version": (
            int(presentation.get("renderer_version"))
            if isinstance(presentation.get("renderer_version"), int)
            else None
        ),
        "placement": (
            str(presentation.get("placement"))
            if isinstance(presentation.get("placement"), str)
            else str(presentation.get("display_mode"))
            if isinstance(presentation.get("display_mode"), str)
            else None
        ),
        "structured_content": presentation.get("structured_content")
        if isinstance(presentation.get("structured_content"), dict)
        else None,
        "ui_meta": presentation.get("ui_meta")
        if isinstance(presentation.get("ui_meta"), dict)
        else None,
        "entity_ref": row.get("entity_ref_json")
        if isinstance(row.get("entity_ref_json"), dict)
        else None,
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
        "resolution": row.get("resolution_json")
        if isinstance(row.get("resolution_json"), dict)
        else {},
    }


def _build_interrupt_resolution(
    *, interrupt_id: str, action: str, values: dict[str, Any]
) -> dict[str, Any]:
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
    resolution = resolution or _build_interrupt_resolution(
        interrupt_id=interrupt_id, action=action, values=values
    )
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


def _merge_session_state(
    conn: Connection,
    *,
    command: str,
    response_text: str,
    matched_intent: str,
    planner: str,
    status: str,
    tool_names: list[str],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
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


def _build_runtime_request(
    conn: Connection, *, thread_id: str, content: str, metadata: dict[str, Any]
) -> dict[str, Any]:
    snapshot = assistant_thread_service.get_thread_snapshot(conn, thread_id, message_limit=12)
    recent_messages = []
    for message in snapshot["messages"]:
        message_content, message_cards = assistant_projection_service.legacy_projection_from_parts(
            message["parts"]
        )
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
        result_payload = (
            trace.get("result_json") if isinstance(trace.get("result_json"), dict) else {}
        )
        metadata_payload = (
            trace.get("metadata_json") if isinstance(trace.get("metadata_json"), dict) else {}
        )
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
    runtime_request = AssistantRuntimeRequest.model_validate(
        {
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
                "strategic_context_cards": snapshot.get("context_cards", []),
                "request_metadata": metadata,
                "memory_context": memory_vault_service.runtime_memory_context(
                    conn, query=content, limit=4
                ),
                "assistant_memory_suggestions": memory_vault_service.list_suggestions(
                    conn, surface="assistant", refresh=True
                )[:3],
                "recommendation_hints": memory_service.list_recommendation_hints(conn, limit=8),
                "ui_capabilities": _ui_capability_manifest(),
            },
        }
    )
    return runtime_request.model_dump(mode="json")


def _request_due_date_interrupt(
    conn: Connection,
    *,
    thread_id: str,
    run_id: str,
    content: str,
    title: str,
    arguments: dict[str, Any],
    input_mode: str,
    device_target: str,
    metadata: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
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
            {
                "id": "priority",
                "kind": "priority",
                "label": "Priority",
                "value": int(arguments.get("priority") or 3),
                "min": 1,
                "max": 5,
            },
            {
                "id": "create_time_block",
                "kind": "toggle",
                "label": "Create 45m block",
                "value": False,
            },
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
            assistant_projection_service.text_part(
                "I can add that now. I only need when you want it due."
            ),
            assistant_projection_service.card_part(
                assistant_projection_service.draft_task_card(
                    title=title, priority=int(arguments.get("priority") or 3)
                )
            ),
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
        step_result = step.result if isinstance(step.result, dict) else {}
        dynamic_result_fields = assistant_projection_service._pick_dynamic_ui_fields(step_result)
        tool_call_id = (
            str(dynamic_result_fields.get("tool_call_id"))
            if isinstance(dynamic_result_fields.get("tool_call_id"), str)
            else new_id("toolcall")
        )
        dynamic_result_fields.pop("tool_call_id", None)
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
                **dynamic_result_fields,
                **_study_tool_dynamic_ui_payload(step.tool_name, step.result),
                metadata={"message": step.message or "", "tool_name": step.tool_name},
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
        extra=_study_session_state_extra(response),
    )
    _update_run(
        conn,
        run_id=run_id,
        status="completed" if response.status != "failed" else "failed",
        summary=response.summary,
    )
    return assistant_message


def _study_tool_dynamic_ui_payload(tool_name: str, result: Any) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {}

    if tool_name in {"mark_study_topic_read", "unlock_study_topic"}:
        topic = result.get("topic") if isinstance(result.get("topic"), dict) else {}
        topic_id = str(topic.get("id") or "").strip()
        topic_title = str(topic.get("title") or "").strip()
        action_label = "read" if tool_name == "mark_study_topic_read" else "unlocked"
        return {
            "renderer_key": "interview.topic_unlock",
            "renderer_version": 1,
            "placement": "thread",
            "structured_content": {
                "topic": topic,
                "topic_id": topic_id,
                "topic_title": topic_title,
                "unlock_reason": f"Marked {action_label} by Assistant command.",
            },
            "ui_meta": {
                "tone": "study",
                "action": tool_name,
                "status": action_label,
                "source_id": str(topic.get("source_id") or "").strip(),
            },
        }

    if tool_name == "create_study_question_request":
        request = result.get("request") if isinstance(result.get("request"), dict) else {}
        response = request.get("response") if isinstance(request.get("response"), dict) else {}
        return {
            "renderer_key": "interview.question_request",
            "renderer_version": 1,
            "placement": "thread",
            "structured_content": {
                "request": request,
                "source_id": str(request.get("source_id") or "").strip(),
                "topic_id": str(request.get("topic_id") or "").strip(),
                "question_type": str(request.get("question_type") or "").strip(),
                "prompt": str(request.get("prompt") or request.get("question") or "").strip(),
            },
            "ui_meta": {
                "tone": "study",
                "request_id": str(request.get("id") or "").strip(),
                "question_preference": str(response.get("question_preference") or "").strip(),
            },
        }

    return {}


def _study_session_state_extra(response: AgentCommandResponse) -> dict[str, Any]:
    for step in response.steps:
        result = step.result if isinstance(step.result, dict) else {}
        topic = result.get("topic") if isinstance(result.get("topic"), dict) else {}
        if topic:
            return {
                "last_study_topic_id": str(topic.get("id") or "").strip(),
                "last_study_topic_title": str(topic.get("title") or "").strip(),
                "last_study_source_id": str(topic.get("source_id") or "").strip(),
            }
        request = result.get("request") if isinstance(result.get("request"), dict) else {}
        if request:
            return {
                "last_study_topic_id": str(request.get("topic_id") or "").strip(),
                "last_study_source_id": str(request.get("source_id") or "").strip(),
            }
    return {}


def _latest_study_topic_title_from_session(conn: Connection, *, thread_id: str) -> str:
    row = execute_fetchone(
        conn,
        "SELECT state_json FROM conversation_session_state WHERE thread_id = ?",
        (thread_id,),
    )
    state = row.get("state_json") if row and isinstance(row.get("state_json"), dict) else {}
    return str(state.get("last_study_topic_title") or "").strip()


def _is_dynamic_ui_capability_request(content: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", " ", content.lower()).strip()
    if not normalized:
        return False
    return any(
        phrase in normalized
        for phrase in {
            "show me what ui actions you can take",
            "what ui actions can you take",
            "show ui actions",
            "show dynamic ui capabilities",
            "list dynamic ui capabilities",
            "what dynamic ui capabilities do you have",
        }
    )


def _normalize_dynamic_ui_command(conn: Connection, *, thread_id: str, content: str) -> str:
    text = content.strip()
    match = re.match(r"^(?:unlock/read|unlock\s+(?:and|then)\s+read)\s+(.+)$", text, re.IGNORECASE)
    if match:
        return f"read {match.group(1).strip()}"
    quiz_match = re.match(r"^quiz\s+me\s+with\s+(.+?)\s+questions?$", text, re.IGNORECASE)
    if quiz_match:
        topic_title = _latest_study_topic_title_from_session(conn, thread_id=thread_id)
        if topic_title:
            return f"quiz me on {quiz_match.group(1).strip()} questions for {topic_title}"
    return text


def _assistant_message_from_dynamic_ui_capability_request(
    conn: Connection,
    *,
    thread_id: str,
    run_id: str,
    command: str,
    input_mode: str,
    device_target: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    manifest = _ui_capability_manifest()
    tool_call_id = new_id("toolcall")
    summary = (
        "I can request Starlog dynamic UI for topic unlock/read, interview question requests, "
        "and review grading. The backend capability manifest is attached as structured tool output."
    )
    parts = [
        assistant_projection_service.text_part(summary),
        {
            "type": "tool_call",
            "id": new_id("part"),
            "tool_call": {
                "id": tool_call_id,
                "tool_name": "list_dynamic_ui_capabilities",
                "tool_kind": "protocol_tool",
                "status": "complete",
                "arguments": {},
                "title": "List dynamic UI capabilities",
                "metadata": {"capability_manifest_version": manifest["version"]},
            },
        },
        assistant_projection_service.tool_result_part(
            tool_call_id=tool_call_id,
            status="complete",
            output=manifest,
            metadata={
                "message": "Dynamic UI capabilities listed",
                "tool_name": "list_dynamic_ui_capabilities",
                "capability_manifest_version": manifest["version"],
            },
            structured_content={"capabilities": manifest},
            ui_meta={"tone": "system", "source": "backend_capability_registry"},
        ),
        assistant_projection_service.status_part("complete", "Dynamic UI capabilities listed"),
    ]
    assistant_message = assistant_thread_service.append_message(
        conn,
        thread_id=thread_id,
        role="assistant",
        status="complete",
        run_id=run_id,
        metadata={
            "assistant_command": {
                "command": command,
                "planner": "deterministic",
                "matched_intent": "list_dynamic_ui_capabilities",
                "status": "executed",
                "summary": summary,
                "steps": [
                    {
                        "tool_name": "list_dynamic_ui_capabilities",
                        "arguments": {},
                        "status": "ok",
                        "message": "Dynamic UI capabilities listed",
                        "result": manifest,
                    }
                ],
            },
            "matched_intent": "list_dynamic_ui_capabilities",
            "planner": "deterministic",
            "status": "executed",
            "input_mode": input_mode,
            "device_target": device_target,
            "request_metadata": metadata,
        },
        parts=parts,
    )
    _record_step(
        conn,
        run_id=run_id,
        thread_id=thread_id,
        step_index=0,
        title="List dynamic UI capabilities",
        tool_name="list_dynamic_ui_capabilities",
        tool_kind="protocol_tool",
        status="completed",
        arguments={},
        result={"ui_capabilities": manifest},
        message_id=assistant_message["id"],
        metadata={"capability_manifest_version": manifest["version"]},
    )
    _record_trace(
        conn,
        thread_id=thread_id,
        assistant_message_id=assistant_message["id"],
        tool_name="list_dynamic_ui_capabilities",
        arguments={},
        status="ok",
        result={"ui_capabilities": manifest},
        metadata={
            "planner": "deterministic",
            "kind": "protocol_tool",
            "capability_manifest_version": manifest["version"],
        },
    )
    _merge_session_state(
        conn,
        command=command,
        response_text=summary,
        matched_intent="list_dynamic_ui_capabilities",
        planner="deterministic",
        status="executed",
        tool_names=["list_dynamic_ui_capabilities"],
    )
    _update_run(conn, run_id=run_id, status="completed", summary=summary)
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
    runtime_interrupts: list[dict[str, Any]] = []
    for raw_interrupt in turn.get("interrupts") if isinstance(turn.get("interrupts"), list) else []:
        if not isinstance(raw_interrupt, dict):
            continue
        tool_name = str(raw_interrupt.get("tool_name") or "").strip()
        if not tool_name:
            continue
        interrupt_metadata = (
            raw_interrupt.get("metadata") if isinstance(raw_interrupt.get("metadata"), dict) else {}
        )
        interrupt_metadata = {
            **interrupt_metadata,
            "user_content": str(interrupt_metadata.get("user_content") or content),
            "input_mode": input_mode,
            "device_target": device_target,
            "request_metadata": metadata,
            "display_mode": str(
                interrupt_metadata.get("display_mode")
                or raw_interrupt.get("display_mode")
                or "composer"
            ),
        }
        if raw_interrupt.get("consequence_preview") is not None:
            interrupt_metadata["consequence_preview"] = raw_interrupt.get("consequence_preview")
        if raw_interrupt.get("defer_label") is not None:
            interrupt_metadata["defer_label"] = raw_interrupt.get("defer_label")
        if isinstance(raw_interrupt.get("recommended_defaults"), dict):
            interrupt_metadata["recommended_defaults"] = raw_interrupt.get("recommended_defaults")
        if raw_interrupt.get("destructive") is not None:
            interrupt_metadata["destructive"] = bool(raw_interrupt.get("destructive"))

        runtime_interrupts.append(
            _create_interrupt(
                conn,
                run_id=run_id,
                thread_id=thread_id,
                tool_name=tool_name,
                interrupt_type=str(raw_interrupt.get("interrupt_type") or "form"),
                title=str(raw_interrupt.get("title") or "Assistant needs input"),
                body=str(raw_interrupt.get("body") or ""),
                fields=raw_interrupt.get("fields")
                if isinstance(raw_interrupt.get("fields"), list)
                else [],
                primary_label=str(raw_interrupt.get("primary_label") or "Submit"),
                secondary_label=str(raw_interrupt.get("secondary_label"))
                if raw_interrupt.get("secondary_label") is not None
                else None,
                renderer_key=str(raw_interrupt.get("renderer_key")).strip()
                if raw_interrupt.get("renderer_key") is not None
                else None,
                renderer_version=raw_interrupt.get("renderer_version")
                if isinstance(raw_interrupt.get("renderer_version"), int)
                else None,
                placement=str(raw_interrupt.get("placement")).strip()
                if raw_interrupt.get("placement") is not None
                else None,
                structured_content=raw_interrupt.get("structured_content")
                if isinstance(raw_interrupt.get("structured_content"), dict)
                else None,
                ui_meta=raw_interrupt.get("ui_meta")
                if isinstance(raw_interrupt.get("ui_meta"), dict)
                else None,
                metadata=interrupt_metadata,
                entity_ref=raw_interrupt.get("entity_ref")
                if isinstance(raw_interrupt.get("entity_ref"), dict)
                else None,
                tool_call_id=str(raw_interrupt.get("tool_call_id")).strip()
                if raw_interrupt.get("tool_call_id") is not None
                else None,
            )
        )

    runtime_cards = conversation_card_service.normalize_cards(
        turn.get("cards")
        if isinstance(turn.get("cards"), list)
        else [
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
            runtime_parts.extend(
                assistant_projection_service.card_part(card) for card in runtime_cards
            )
        if str(turn.get("response_text") or "").strip() and not any(
            part.get("type") == "text" for part in runtime_parts
        ):
            runtime_parts.insert(
                0, assistant_projection_service.text_part(str(turn.get("response_text") or ""))
            )
    else:
        runtime_parts = assistant_projection_service.synthesize_parts_from_legacy(
            content=str(turn.get("response_text") or ""),
            cards=runtime_cards,
        )
    suggestion_cards = conversation_card_service.memory_suggestion_cards(
        conn, surface="assistant", limit=2
    )
    for card in suggestion_cards:
        runtime_parts.append(assistant_projection_service.card_part(card))
    for interrupt in runtime_interrupts:
        runtime_parts.append(assistant_projection_service.interrupt_request_part(interrupt))
    if runtime_interrupts and not any(part.get("type") == "status" for part in runtime_parts):
        runtime_parts.append(
            assistant_projection_service.status_part("requires_action", "Waiting for task details")
        )
    response_text, all_cards = assistant_projection_service.legacy_projection_from_parts(
        runtime_parts
    )
    assistant_message = assistant_thread_service.append_message(
        conn,
        thread_id=thread_id,
        role="assistant",
        status="requires_action" if runtime_interrupts else "complete",
        run_id=run_id,
        metadata={
            "chat_turn": {
                "workflow": turn.get("workflow") or "chat_turn",
                "provider_used": turn.get("provider_used") or "local_prompt_preview",
                "model": turn.get("model") or "",
                "metadata": turn.get("metadata") if isinstance(turn.get("metadata"), dict) else {},
            },
            "status": "requires_action" if runtime_interrupts else "completed",
            "input_mode": input_mode,
            "device_target": device_target,
            "request_metadata": metadata,
        },
        parts=runtime_parts,
    )
    for index, interrupt in enumerate(runtime_interrupts):
        interrupt_metadata = (
            interrupt.get("metadata") if isinstance(interrupt.get("metadata"), dict) else {}
        )
        planned_arguments = (
            interrupt_metadata.get("planned_arguments")
            if isinstance(interrupt_metadata.get("planned_arguments"), dict)
            else {}
        )
        step_result = {
            "interrupt_id": interrupt["id"],
            "provider_used": turn.get("provider_used") or "local_prompt_preview",
        }
        _record_step(
            conn,
            run_id=run_id,
            thread_id=thread_id,
            step_index=index,
            title=str(interrupt.get("title") or interrupt.get("tool_name") or "Runtime interrupt"),
            tool_name=str(interrupt.get("tool_name") or ""),
            tool_kind="ui_tool",
            status="requires_action",
            arguments=planned_arguments,
            result=step_result,
            interrupt_id=str(interrupt["id"]),
            message_id=assistant_message["id"],
            metadata={
                "workflow": turn.get("workflow") or "chat_turn",
                "provider_used": turn.get("provider_used") or "local_prompt_preview",
                "kind": "runtime_interrupt",
            },
        )
        _record_trace(
            conn,
            thread_id=thread_id,
            assistant_message_id=assistant_message["id"],
            tool_name=str(interrupt.get("tool_name") or ""),
            arguments=planned_arguments,
            status="requires_action",
            result=step_result,
            metadata={
                "workflow": turn.get("workflow") or "chat_turn",
                "provider_used": turn.get("provider_used") or "local_prompt_preview",
                "kind": "runtime_interrupt",
            },
        )
    _record_step(
        conn,
        run_id=run_id,
        thread_id=thread_id,
        step_index=len(runtime_interrupts),
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
    _update_run(
        conn,
        run_id=run_id,
        status="interrupted" if runtime_interrupts else "completed",
        summary=response_text,
    )
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
        key: value
        for key, value in raw_request_metadata.items()
        if key not in {"handoff_context", "handoff_token"}
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
        command_for_planning = _normalize_dynamic_ui_command(
            conn, thread_id=thread["id"], content=content
        )
        if _is_dynamic_ui_capability_request(content):
            _assistant_message_from_dynamic_ui_capability_request(
                conn,
                thread_id=thread["id"],
                run_id=run["id"],
                command=content,
                input_mode=input_mode,
                device_target=device_target,
                metadata=request_metadata,
            )
        else:
            try:
                matched_intent, summary, planned_calls = agent_command_service.plan_command(
                    conn,
                    command_for_planning,
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
                        command=command_for_planning,
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
                    metadata=request_metadata,
                    content=content,
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
    assistant_messages = [
        message
        for message in snapshot["messages"]
        if message.get("run_id") == run["id"] and message["role"] == "assistant"
    ]
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


def _interrupt_row(
    conn: Connection, interrupt_id: str, *, user_id: str | None = None
) -> dict[str, Any]:
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


def get_run(
    conn: Connection, *, thread_id: str, run_id: str, user_id: str | None = None
) -> dict[str, Any]:
    snapshot = assistant_thread_service.get_thread_snapshot(conn, thread_id, user_id=user_id)
    for run in snapshot["runs"]:
        if run["id"] == run_id:
            return run
    raise LookupError(f"Assistant run not found: {run_id}")


def cancel_run(conn: Connection, *, run_id: str, user_id: str | None = None) -> dict[str, Any]:
    row = _run_row(conn, run_id, user_id=user_id)
    _update_run(conn, run_id=run_id, status="cancelled", summary="Run cancelled")
    return get_run(conn, thread_id=str(row["thread_id"]), run_id=run_id, user_id=user_id)


def submit_interrupt(
    conn: Connection, *, interrupt_id: str, values: dict[str, Any], user_id: str | None = None
) -> dict[str, Any]:
    row = _interrupt_row(conn, interrupt_id, user_id=user_id)
    if row["status"] != "pending":
        if row["status"] == "submitted":
            return assistant_thread_service.get_thread_snapshot(
                conn, str(row["thread_id"]), user_id=user_id
            )
        raise ValueError("Interrupt is no longer pending")

    metadata = row.get("metadata_json") if isinstance(row.get("metadata_json"), dict) else {}
    handler = assistant_interrupt_handlers.handler_for_tool(str(row["tool_name"]))
    if handler is not None:
        handler.validate_submit(row=row, metadata=metadata, values=values)
        resolution = _build_interrupt_resolution(
            interrupt_id=interrupt_id, action="submit", values=values
        )
        context = assistant_interrupt_handlers.InterruptActionContext(
            row=row,
            metadata=metadata,
            resolution=resolution,
            interrupt_id=interrupt_id,
            user_id=user_id,
            record_step=_record_step,
            record_trace=_record_trace,
            complete_interrupt=_complete_interrupt,
            update_run=_update_run_after_interrupt_resolution,
            merge_session_state=_merge_session_state,
            assistant_client_timezone=_assistant_client_timezone,
            due_date_to_utc_start=lambda due_date, client_timezone: _due_date_to_utc_start(
                due_date,
                client_timezone=client_timezone,
            ),
            review_rating_label=_review_rating_label,
            next_step_index=_next_step_index,
        )
        try:
            handler.submit(conn, context=context, values=values)
        except Exception as exc:
            _record_run_failure(
                conn,
                thread_id=str(row["thread_id"]),
                run_id=str(row["run_id"]),
                error_text=str(exc),
                stage=f"interrupt:{row['tool_name']}",
                metadata={"interrupt_id": interrupt_id},
            )
        return assistant_thread_service.get_thread_snapshot(
            conn, str(row["thread_id"]), user_id=user_id
        )

    resolution = _build_interrupt_resolution(
        interrupt_id=interrupt_id, action="submit", values=values
    )
    try:
        if row["tool_name"] == "triage_capture":
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
                step_index=_next_step_index(conn, run_id=row["run_id"]),
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
            _update_run_after_interrupt_resolution(
                conn, run_id=row["run_id"], status="completed", summary="Capture triage saved"
            )
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
                    assistant_projection_service.text_part(
                        f"Recorded the planner conflict resolution: {resolution_choice}."
                    ),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=_next_step_index(conn, run_id=row["run_id"]),
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
            _update_run_after_interrupt_resolution(
                conn, run_id=row["run_id"], status="completed", summary="Planner conflict resolved"
            )
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
                    assistant_projection_service.text_part(
                        f"Locked in the first move for today: {focus.replace('_', ' ')}."
                    ),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=_next_step_index(conn, run_id=row["run_id"]),
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
            _update_run_after_interrupt_resolution(
                conn, run_id=row["run_id"], status="completed", summary="Morning focus selected"
            )
        elif row["tool_name"] == "clarify_schedule_time":
            scheduled_time = str(values.get("scheduled_time") or values.get("time") or "").strip()
            if not scheduled_time:
                raise ValueError("scheduled_time is required")
            assistant_message = assistant_thread_service.append_message(
                conn,
                thread_id=row["thread_id"],
                role="assistant",
                status="complete",
                run_id=row["run_id"],
                metadata={"interrupt_resolution": resolution},
                parts=[
                    assistant_projection_service.text_part(
                        f"Recorded the schedule time: {scheduled_time}."
                    ),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=_next_step_index(conn, run_id=row["run_id"]),
                title="Clarify schedule time",
                tool_name="clarify_schedule_time",
                tool_kind="ui_tool",
                status="completed",
                arguments=values,
                result={"scheduled_time": scheduled_time},
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
            _update_run_after_interrupt_resolution(
                conn, run_id=row["run_id"], status="completed", summary="Schedule time recorded"
            )
        elif row["tool_name"] == "defer_recommendation":
            remind_at = str(values.get("remind_at") or values.get("reminder") or "").strip()
            if not remind_at:
                raise ValueError("remind_at is required")
            assistant_message = assistant_thread_service.append_message(
                conn,
                thread_id=row["thread_id"],
                role="assistant",
                status="complete",
                run_id=row["run_id"],
                metadata={"interrupt_resolution": resolution},
                parts=[
                    assistant_projection_service.text_part(
                        f"Reminder preference saved: {remind_at.replace('_', ' ')}."
                    ),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=_next_step_index(conn, run_id=row["run_id"]),
                title="Defer recommendation",
                tool_name="defer_recommendation",
                tool_kind="ui_tool",
                status="completed",
                arguments=values,
                result={"remind_at": remind_at},
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
            _update_run_after_interrupt_resolution(
                conn, run_id=row["run_id"], status="completed", summary="Reminder preference saved"
            )
        elif row["tool_name"] == "link_capture_project":
            project_id = str(values.get("project_id") or "").strip()
            if not project_id:
                raise ValueError("project_id is required")
            assistant_message = assistant_thread_service.append_message(
                conn,
                thread_id=row["thread_id"],
                role="assistant",
                status="complete",
                run_id=row["run_id"],
                metadata={
                    "interrupt_resolution": resolution,
                    "project_link": {
                        "project_id": project_id,
                        "entity_ref": row.get("entity_ref_json")
                        if isinstance(row.get("entity_ref_json"), dict)
                        else {},
                    },
                },
                parts=[
                    assistant_projection_service.text_part(
                        f"Recorded the project link: {project_id}."
                    ),
                    assistant_projection_service.interrupt_resolution_part(resolution),
                ],
            )
            _record_step(
                conn,
                run_id=row["run_id"],
                thread_id=row["thread_id"],
                step_index=_next_step_index(conn, run_id=row["run_id"]),
                title="Link capture project",
                tool_name="link_capture_project",
                tool_kind="ui_tool",
                status="completed",
                arguments=values,
                result={"project_id": project_id},
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
            _update_run_after_interrupt_resolution(
                conn, run_id=row["run_id"], status="completed", summary="Project link recorded"
            )
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

    return assistant_thread_service.get_thread_snapshot(
        conn, str(row["thread_id"]), user_id=user_id
    )


def dismiss_interrupt(
    conn: Connection, *, interrupt_id: str, user_id: str | None = None
) -> dict[str, Any]:
    row = _interrupt_row(conn, interrupt_id, user_id=user_id)
    if row["status"] != "pending":
        if row["status"] == "dismissed":
            return assistant_thread_service.get_thread_snapshot(
                conn, str(row["thread_id"]), user_id=user_id
            )
        raise ValueError("Interrupt is no longer pending")
    resolution = _build_interrupt_resolution(interrupt_id=interrupt_id, action="dismiss", values={})
    assistant_interrupt_handlers.dismiss_interrupt(
        conn,
        row=row,
        interrupt_id=interrupt_id,
        resolution=resolution,
        complete_interrupt=_complete_interrupt,
        update_run=_update_run_after_interrupt_resolution,
    )
    return assistant_thread_service.get_thread_snapshot(
        conn, str(row["thread_id"]), user_id=user_id
    )
