from __future__ import annotations

import json
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services import assistant_projection_service, assistant_thread_service
from app.services.assistant_run_service import (
    _complete_interrupt,
    _create_interrupt,
    _create_run,
    _next_step_index,
    _record_step,
    _update_run,
)
from app.services.common import execute_fetchall, execute_fetchone, new_id


_INTERRUPT_TOOL_BY_EVENT_KIND = {
    "planner.conflict.detected": "resolve_planner_conflict",
    "capture.created": "triage_capture",
    "review.answer.revealed": "grade_review_recall",
    "briefing.generated": "choose_morning_focus",
}

_EVENT_VISIBILITY_POLICY = {
    "capture.created": "dynamic_panel",
    "capture.enriched": "ambient",
    "artifact.opened": "ambient",
    "artifact.summarized": "ambient",
    "task.created": "ambient",
    "task.completed": "ambient",
    "task.snoozed": "ambient",
    "time_block.started": "ambient",
    "time_block.completed": "ambient",
    "planner.conflict.detected": "dynamic_panel",
    "review.session.started": "ambient",
    "review.answer.revealed": "dynamic_panel",
    "review.answer.graded": "ambient",
    "briefing.generated": "dynamic_panel",
    "briefing.played": "ambient",
    "assistant.card.action_used": "internal",
    "assistant.panel.submitted": "ambient",
    "voice.capture.transcribed": "ambient",
}

_VALID_VISIBILITIES = {"internal", "ambient", "assistant_message", "dynamic_panel"}


def _event_visibility(kind: str, requested: str | None) -> str:
    if requested is None:
        return _EVENT_VISIBILITY_POLICY.get(kind, "internal")
    if requested == "internal":
        return "internal"
    if requested == "assistant_message":
        return _EVENT_VISIBILITY_POLICY.get(kind, "assistant_message")
    if requested in _VALID_VISIBILITIES:
        return requested
    return _EVENT_VISIBILITY_POLICY.get(kind, "internal")


def _normalize_entity_ref(entity_ref: dict[str, Any] | None) -> tuple[str, str] | None:
    if not isinstance(entity_ref, dict):
        return None
    entity_type = str(entity_ref.get("entity_type") or "").strip()
    entity_id = str(entity_ref.get("entity_id") or "").strip()
    if not entity_type or not entity_id:
        return None
    return entity_type, entity_id


def _find_pending_interrupt_for_entity(
    conn: Connection,
    *,
    thread_id: str,
    tool_name: str,
    entity_ref: dict[str, Any] | None,
) -> dict[str, Any] | None:
    normalized = _normalize_entity_ref(entity_ref)
    if normalized is None:
        return None
    rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_interrupts
        WHERE thread_id = ? AND status = 'pending' AND tool_name = ?
        ORDER BY created_at DESC, id DESC
        """,
        (thread_id, tool_name),
    )
    for row in rows:
        existing_ref = row.get("entity_ref_json") if isinstance(row.get("entity_ref_json"), dict) else None
        if _normalize_entity_ref(existing_ref) == normalized:
            return row
    return None


def _planner_conflict_fingerprint(payload: dict[str, Any]) -> dict[str, Any]:
    detail = payload.get("detail") if isinstance(payload.get("detail"), dict) else {}
    options = payload.get("options") if isinstance(payload.get("options"), list) else []
    normalized_options = [
        {
            "label": str(item.get("label") or "").strip(),
            "value": str(item.get("value") or "").strip(),
        }
        for item in options
        if isinstance(item, dict)
    ]
    return {
        "assistant_text": str(payload.get("assistant_text") or "").strip(),
        "body": str(payload.get("body") or "").strip(),
        "detail": detail,
        "label": str(payload.get("label") or "").strip(),
        "options": normalized_options,
    }


def _surface_event_fingerprint(kind: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if kind == "planner.conflict.detected":
        return _planner_conflict_fingerprint(payload)
    return None


def _find_latest_surface_event_for_entity(
    conn: Connection,
    *,
    thread_id: str,
    kind: str,
    entity_ref: dict[str, Any] | None,
) -> dict[str, Any] | None:
    normalized = _normalize_entity_ref(entity_ref)
    if normalized is None:
        return None
    rows = execute_fetchall(
        conn,
        """
        SELECT *
        FROM conversation_surface_events
        WHERE thread_id = ? AND kind = ?
        ORDER BY created_at DESC, id DESC
        """,
        (thread_id, kind),
    )
    for row in rows:
        existing_ref = row.get("entity_ref_json") if isinstance(row.get("entity_ref_json"), dict) else None
        if _normalize_entity_ref(existing_ref) == normalized:
            return {
                "id": row["id"],
                "thread_id": row["thread_id"],
                "source_surface": row["source_surface"],
                "kind": row["kind"],
                "entity_ref": existing_ref,
                "payload": row.get("payload_json") if isinstance(row.get("payload_json"), dict) else {},
                "visibility": row["visibility"],
                "projected_message": bool(row.get("projected_message")),
                "created_at": row["created_at"],
            }
    return None


def _summarize_text(value: Any, *, limit: int = 180) -> str | None:
    if not isinstance(value, str):
        return None
    collapsed = " ".join(value.split()).strip()
    if not collapsed:
        return None
    if len(collapsed) <= limit:
        return collapsed
    return f"{collapsed[: limit - 1].rstrip()}…"


def _capture_source_surface(artifact: dict[str, Any]) -> str:
    metadata = artifact.get("metadata") if isinstance(artifact.get("metadata"), dict) else {}
    capture = metadata.get("capture") if isinstance(metadata.get("capture"), dict) else {}
    capture_source = str(capture.get("capture_source") or "").strip().lower()
    if capture_source.startswith("desktop_helper"):
        return "desktop_helper"
    return "library"


def reflect_capture_created(conn: Connection, *, artifact: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
    artifact_id = str(artifact.get("id") or "").strip()
    if not artifact_id:
        raise ValueError("Capture reflection requires an artifact id")
    title = str(artifact.get("title") or "Saved capture").strip() or "Saved capture"
    snippet = _summarize_text(((artifact.get("extracted") or {}) if isinstance(artifact.get("extracted"), dict) else {}).get("text"))
    source_surface = _capture_source_surface(artifact)
    if source_surface == "desktop_helper":
        assistant_text = f"I saved {title} from the desktop helper. One quick choice will help route it correctly."
    else:
        assistant_text = f"I saved {title}. One quick choice will help route it correctly."
    if snippet:
        assistant_text = f"{assistant_text} {snippet}"
    return create_surface_event(
        conn,
        thread_id="primary",
        source_surface=source_surface,
        kind="capture.created",
        entity_ref={"entity_type": "artifact", "entity_id": artifact_id, "href": f"/artifacts?artifact={artifact_id}", "title": title},
        payload={"artifact_id": artifact_id, "assistant_text": assistant_text, "title": title},
        visibility="assistant_message",
        user_id=user_id,
    )


def reflect_briefing_generated(conn: Connection, *, briefing: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
    briefing_id = str(briefing.get("id") or "").strip()
    if not briefing_id:
        raise ValueError("Briefing reflection requires a briefing id")
    briefing_date = str(briefing.get("date") or briefing_id).strip() or briefing_id
    body = _summarize_text(briefing.get("text"))
    return create_surface_event(
        conn,
        thread_id="primary",
        source_surface="planner",
        kind="briefing.generated",
        entity_ref={
            "entity_type": "briefing",
            "entity_id": briefing_id,
            "href": f"/planner?briefing={briefing_id}",
            "title": briefing_date,
        },
        payload={"briefing_id": briefing_id, "date": briefing_date, "body": body},
        visibility="assistant_message",
        user_id=user_id,
    )


def reflect_planner_conflict_detected(
    conn: Connection,
    *,
    conflict: dict[str, Any],
    user_id: str | None = None,
) -> dict[str, Any]:
    conflict_id = str(conflict.get("id") or "").strip()
    if not conflict_id:
        raise ValueError("Planner conflict reflection requires a conflict id")
    remote_id = str(conflict.get("remote_id") or "remote event").strip() or "remote event"
    strategy = str(conflict.get("strategy") or "prefer_local").strip() or "prefer_local"
    detail = conflict.get("detail") if isinstance(conflict.get("detail"), dict) else {}
    options = [
        {"label": "Prefer local", "value": "local_wins"},
        {"label": "Prefer remote", "value": "remote_wins"},
        {"label": "Dismiss for now", "value": "dismiss"},
    ]
    return create_surface_event(
        conn,
        thread_id="primary",
        source_surface="planner",
        kind="planner.conflict.detected",
        entity_ref={
            "entity_type": "planner_conflict",
            "entity_id": conflict_id,
            "href": "/planner",
            "title": remote_id,
        },
        payload={
            "conflict_id": conflict_id,
            "assistant_text": f"{remote_id} needs a quick planner decision.",
            "options": options,
            "label": f"Planner conflict: {remote_id}",
            "body": f"Suggested sync policy: {strategy}",
            "detail": detail,
        },
        visibility="assistant_message",
        user_id=user_id,
    )


def _append_ambient_update_message(
    conn: Connection,
    *,
    thread_id: str,
    run_id: str | None,
    event: dict[str, Any],
    entity_ref: dict[str, Any] | None,
    label: str,
    body: str | None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    update = {
        "id": new_id("ambient"),
        "event_id": event["id"],
        "label": label,
        "body": body,
        "entity_ref": entity_ref,
        "actions": [],
        "metadata": {"source_surface": event["source_surface"], "kind": event["kind"]},
        "created_at": event["created_at"],
    }
    return assistant_thread_service.append_message(
        conn,
        thread_id=thread_id,
        role="system",
        status="complete",
        run_id=run_id,
        metadata={"surface_event": event, **(metadata or {})},
        parts=[assistant_projection_service.ambient_update_part(update)],
    )


def _close_pending_interrupt_for_entity(
    conn: Connection,
    *,
    thread_id: str,
    tool_name: str,
    entity_ref: dict[str, Any] | None,
    action: str,
    values: dict[str, Any],
    step_title: str,
    summary: str,
    message_id: str | None,
    tool_status: str = "completed",
) -> dict[str, Any] | None:
    pending_interrupt = _find_pending_interrupt_for_entity(
        conn,
        thread_id=thread_id,
        tool_name=tool_name,
        entity_ref=entity_ref,
    )
    if pending_interrupt is None:
        return None

    resolution = _complete_interrupt(
        conn,
        interrupt_id=str(pending_interrupt["id"]),
        action=action,
        values=values,
    )
    run_id = str(pending_interrupt["run_id"])
    _record_step(
        conn,
        run_id=run_id,
        thread_id=thread_id,
        step_index=_next_step_index(conn, run_id=run_id),
        title=step_title,
        tool_name=tool_name,
        tool_kind="surface_action",
        status=tool_status,
        arguments=values,
        result={"source_surface": "planner"},
        interrupt_id=str(pending_interrupt["id"]),
        message_id=message_id,
        metadata={"resolution_source": "planner_surface"},
    )
    _update_run(
        conn,
        run_id=run_id,
        status="completed" if action == "submit" else "cancelled",
        summary=summary,
        metadata_patch={"external_resolution": resolution},
    )
    return resolution


def reflect_planner_conflict_resolved(
    conn: Connection,
    *,
    conflict: dict[str, Any],
    resolution_strategy: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    conflict_id = str(conflict.get("id") or "").strip()
    if not conflict_id:
        raise ValueError("Planner conflict resolution reflection requires a conflict id")
    remote_id = str(conflict.get("remote_id") or conflict_id).strip() or conflict_id
    entity_ref = {
        "entity_type": "planner_conflict",
        "entity_id": conflict_id,
        "href": "/planner",
        "title": remote_id,
    }
    thread = assistant_thread_service.get_thread(conn, "primary", user_id=user_id)
    label = "Planner conflict resolved"
    body = f"{remote_id} was resolved in Planner with {resolution_strategy.replace('_', ' ')}."
    event = _insert_surface_event(
        conn,
        thread_id=thread["id"],
        source_surface="planner",
        kind="planner.conflict.resolved",
        entity_ref=entity_ref,
        payload={
            "conflict_id": conflict_id,
            "resolution_strategy": resolution_strategy,
            "label": label,
            "body": body,
        },
        visibility="ambient",
        projected_message=True,
    )
    assistant_message = _append_ambient_update_message(
        conn,
        thread_id=thread["id"],
        run_id=None,
        event=event,
        entity_ref=entity_ref,
        label=label,
        body=body,
    )
    resolution = _close_pending_interrupt_for_entity(
        conn,
        thread_id=thread["id"],
        tool_name="resolve_planner_conflict",
        entity_ref=entity_ref,
        action="submit",
        values={
            "resolution": resolution_strategy,
            "resolution_source": "planner_surface",
        },
        step_title="Resolve planner conflict from Planner",
        summary="Planner conflict resolved from Planner",
        message_id=assistant_message["id"],
    )
    if resolution is not None:
        assistant_message["metadata"] = {
            **(assistant_message.get("metadata") or {}),
            "interrupt_resolution": resolution,
        }
    return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)


def reflect_planner_conflict_cleared(
    conn: Connection,
    *,
    conflict_id: str,
    remote_id: str | None = None,
    reason: str = "replayed_cleanly",
    user_id: str | None = None,
) -> dict[str, Any]:
    normalized_conflict_id = str(conflict_id or "").strip()
    if not normalized_conflict_id:
        raise ValueError("Planner conflict clear reflection requires a conflict id")
    remote_label = str(remote_id or normalized_conflict_id).strip() or normalized_conflict_id
    entity_ref = {
        "entity_type": "planner_conflict",
        "entity_id": normalized_conflict_id,
        "href": "/planner",
        "title": remote_label,
    }
    thread = assistant_thread_service.get_thread(conn, "primary", user_id=user_id)
    label = "Planner conflict cleared"
    body = f"{remote_label} no longer needs attention after the Planner replay."
    event = _insert_surface_event(
        conn,
        thread_id=thread["id"],
        source_surface="planner",
        kind="planner.conflict.cleared",
        entity_ref=entity_ref,
        payload={
            "conflict_id": normalized_conflict_id,
            "reason": reason,
            "label": label,
            "body": body,
        },
        visibility="ambient",
        projected_message=True,
    )
    assistant_message = _append_ambient_update_message(
        conn,
        thread_id=thread["id"],
        run_id=None,
        event=event,
        entity_ref=entity_ref,
        label=label,
        body=body,
    )
    resolution = _close_pending_interrupt_for_entity(
        conn,
        thread_id=thread["id"],
        tool_name="resolve_planner_conflict",
        entity_ref=entity_ref,
        action="dismiss",
        values={"reason": reason, "resolution_source": "planner_surface"},
        step_title="Clear planner conflict after replay",
        summary="Planner conflict cleared after replay",
        message_id=assistant_message["id"],
        tool_status="cancelled",
    )
    if resolution is not None:
        assistant_message["metadata"] = {
            **(assistant_message.get("metadata") or {}),
            "interrupt_resolution": resolution,
        }
    return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)


def reflect_artifact_action(
    conn: Connection,
    *,
    artifact: dict[str, Any],
    action: str,
    status: str,
    output_ref: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    artifact_id = str(artifact.get("id") or "").strip()
    if not artifact_id:
        raise ValueError("Artifact action reflection requires an artifact id")
    title = str(artifact.get("title") or "artifact").strip() or "artifact"
    action_label = action.replace("_", " ")
    action_title = {
        "summarize": "Summary",
        "cards": "Review cards",
        "tasks": "Task suggestions",
        "append_note": "Note draft",
    }.get(action, action_label.replace("_", " ").title())
    normalized_status = status.strip() or "completed"

    if normalized_status == "queued":
        kind = "artifact.action.queued"
        label = f"{action_title} queued"
        body = f"{title} is queued for the local runner."
    elif normalized_status == "completed":
        kind = "artifact.action.completed"
        label = f"{action_title} ready"
        body = {
            "summarize": f"{title} now has a fresh summary draft.",
            "cards": f"{title} now has new review cards.",
            "tasks": f"{title} now has suggested next actions.",
            "append_note": f"{title} now has a linked note draft.",
        }.get(action, f"{title} produced a new {action_label} result.")
    elif normalized_status == "failed":
        kind = "artifact.action.failed"
        label = f"{action_title} failed"
        body = f"{title} did not complete its {action_label} action."
    elif normalized_status == "cancelled":
        kind = "artifact.action.cancelled"
        label = f"{action_title} cancelled"
        body = f"{title} no longer has a pending {action_label} action."
    else:
        kind = f"artifact.action.{normalized_status}"
        label = f"{action_title} {normalized_status}"
        body = f"{title} updated its {action_label} action."

    payload = {
        "artifact_id": artifact_id,
        "action": action,
        "status": normalized_status,
        "output_ref": output_ref,
        "label": label,
        "body": body,
    }
    return create_surface_event(
        conn,
        thread_id="primary",
        source_surface="library",
        kind=kind,
        entity_ref={"entity_type": "artifact", "entity_id": artifact_id, "href": f"/artifacts?artifact={artifact_id}", "title": title},
        payload=payload,
        visibility="ambient",
        user_id=user_id,
    )


def _insert_surface_event(
    conn: Connection,
    *,
    thread_id: str,
    source_surface: str,
    kind: str,
    entity_ref: dict[str, Any] | None,
    payload: dict[str, Any],
    visibility: str,
    projected_message: bool,
) -> dict[str, Any]:
    now = utc_now().isoformat()
    event_id = new_id("event")
    conn.execute(
        """
        INSERT INTO conversation_surface_events (
          id, thread_id, source_surface, kind, entity_ref_json, payload_json, visibility, projected_message, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            thread_id,
            source_surface,
            kind,
            json.dumps(entity_ref or {}, sort_keys=True),
            json.dumps(payload, sort_keys=True),
            visibility,
            1 if projected_message else 0,
            now,
        ),
    )
    conn.commit()
    row = execute_fetchone(conn, "SELECT * FROM conversation_surface_events WHERE id = ?", (event_id,))
    if row is None:
        raise RuntimeError("Failed to create assistant surface event")
    return {
        "id": row["id"],
        "thread_id": row["thread_id"],
        "source_surface": row["source_surface"],
        "kind": row["kind"],
        "entity_ref": row.get("entity_ref_json") if isinstance(row.get("entity_ref_json"), dict) else None,
        "payload": row.get("payload_json") if isinstance(row.get("payload_json"), dict) else {},
        "visibility": row["visibility"],
        "projected_message": bool(row.get("projected_message")),
        "created_at": row["created_at"],
    }


def create_surface_event(
    conn: Connection,
    *,
    thread_id: str,
    source_surface: str,
    kind: str,
    entity_ref: dict[str, Any] | None,
    payload: dict[str, Any],
    visibility: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    thread = assistant_thread_service.get_thread(conn, thread_id, user_id=user_id)
    visibility = _event_visibility(kind, visibility)
    interrupt_tool = _INTERRUPT_TOOL_BY_EVENT_KIND.get(kind)
    if interrupt_tool and _find_pending_interrupt_for_entity(
        conn,
        thread_id=thread["id"],
        tool_name=interrupt_tool,
        entity_ref=entity_ref,
    ):
        return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)
    fingerprint = _surface_event_fingerprint(kind, payload)
    if fingerprint is not None:
        previous_event = _find_latest_surface_event_for_entity(
            conn,
            thread_id=thread["id"],
            kind=kind,
            entity_ref=entity_ref,
        )
        if previous_event is not None:
            previous_fingerprint = _surface_event_fingerprint(
                kind,
                previous_event.get("payload") if isinstance(previous_event.get("payload"), dict) else {},
            )
            if previous_fingerprint == fingerprint:
                return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)
    event = _insert_surface_event(
        conn,
        thread_id=thread["id"],
        source_surface=source_surface,
        kind=kind,
        entity_ref=entity_ref,
        payload=payload,
        visibility=visibility,
        projected_message=visibility != "internal",
    )

    if visibility == "internal":
        return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)

    if visibility == "ambient":
        label = payload.get("label") if isinstance(payload.get("label"), str) else kind.replace(".", " ")
        body = payload.get("body") if isinstance(payload.get("body"), str) else None
        update = {
            "id": new_id("ambient"),
            "event_id": event["id"],
            "label": label,
            "body": body,
            "entity_ref": entity_ref,
            "actions": [],
            "metadata": {"source_surface": source_surface, "kind": kind},
            "created_at": event["created_at"],
        }
        assistant_thread_service.append_message(
            conn,
            thread_id=thread["id"],
            role="system",
            status="complete",
            metadata={"surface_event": event},
            parts=[assistant_projection_service.ambient_update_part(update)],
        )
        return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)

    run = _create_run(conn, thread_id=thread["id"], origin_message_id=None, orchestrator="hybrid", metadata={"surface_event": event})

    if kind == "planner.conflict.detected":
        options = payload.get("options") if isinstance(payload.get("options"), list) else []
        interrupt = _create_interrupt(
            conn,
            run_id=run["id"],
            thread_id=thread["id"],
            tool_name="resolve_planner_conflict",
            interrupt_type="choice",
            title="Resolve scheduling conflict",
            body="Choose how Starlog should resolve this overlap.",
            fields=[
                {
                    "id": "resolution",
                    "kind": "select",
                    "label": "Resolution",
                    "required": True,
                    "options": [item for item in options if isinstance(item, dict)],
                }
            ],
            primary_label="Apply choice",
            secondary_label="Open Planner",
            metadata={
                "surface_event": event,
                "conflict_payload": payload,
                "display_mode": "sidecar",
                "consequence_preview": "Applies the selected planner conflict resolution.",
                "defer_label": "Open Planner",
            },
            entity_ref=entity_ref,
        )
        assistant_thread_service.append_message(
            conn,
            thread_id=thread["id"],
            role="assistant",
            status="requires_action",
            run_id=run["id"],
            metadata={"surface_event": event, "interrupt_id": interrupt["id"]},
            parts=[
                assistant_projection_service.text_part(
                    str(payload.get("assistant_text") or "Planner found a conflict that needs a quick decision.")
                ),
                assistant_projection_service.interrupt_request_part(interrupt),
            ],
        )
        _record_step(
            conn,
            run_id=run["id"],
            thread_id=thread["id"],
            step_index=0,
            title="Resolve planner conflict",
            tool_name="resolve_planner_conflict",
            tool_kind="ui_tool",
            status="requires_action",
            arguments=payload,
            result={"interrupt_id": interrupt["id"]},
            interrupt_id=interrupt["id"],
        )
        _update_run(conn, run_id=run["id"], status="interrupted", summary="Planner conflict needs resolution")
        return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)

    if kind == "capture.created":
        interrupt = _create_interrupt(
            conn,
            run_id=run["id"],
            thread_id=thread["id"],
            tool_name="triage_capture",
            interrupt_type="form",
            title="Triage this capture",
            body="Tell Starlog what this capture is and what to do next.",
            fields=[
                {
                    "id": "capture_kind",
                    "kind": "select",
                    "label": "What is this?",
                    "required": True,
                    "options": [
                        {"label": "Reference", "value": "reference"},
                        {"label": "Idea", "value": "idea"},
                        {"label": "Task", "value": "task"},
                        {"label": "Review material", "value": "review_material"},
                        {"label": "Project input", "value": "project_input"},
                        {"label": "Research source", "value": "research_source"},
                    ],
                },
                {
                    "id": "next_step",
                    "kind": "select",
                    "label": "Best next step",
                    "required": True,
                    "options": [
                        {"label": "Summarize", "value": "summarize"},
                        {"label": "Make cards", "value": "cards"},
                        {"label": "Create tasks", "value": "tasks"},
                        {"label": "Append to note", "value": "append_note"},
                        {"label": "Archive as reference", "value": "archive"},
                    ],
                },
            ],
            primary_label="Save choice",
            secondary_label="Not now",
            metadata={
                "surface_event": event,
                "artifact_id": payload.get("artifact_id"),
                "display_mode": "inline",
                "consequence_preview": "Routes this capture into Library, Planner, or Review without losing the original source.",
                "defer_label": "Not now",
            },
            entity_ref=entity_ref,
        )
        assistant_thread_service.append_message(
            conn,
            thread_id=thread["id"],
            role="assistant",
            status="requires_action",
            run_id=run["id"],
            metadata={"surface_event": event, "interrupt_id": interrupt["id"]},
            parts=[
                assistant_projection_service.text_part(
                    str(payload.get("assistant_text") or "I saved this as a new capture. One quick choice will help route it correctly.")
                ),
                assistant_projection_service.interrupt_request_part(interrupt),
            ],
        )
        _record_step(
            conn,
            run_id=run["id"],
            thread_id=thread["id"],
            step_index=0,
            title="Triage capture",
            tool_name="triage_capture",
            tool_kind="ui_tool",
            status="requires_action",
            arguments=payload,
            result={"interrupt_id": interrupt["id"]},
            interrupt_id=interrupt["id"],
        )
        _update_run(conn, run_id=run["id"], status="interrupted", summary="Capture triage requested")
        return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)

    if kind == "review.answer.revealed":
        card_id = str(payload.get("card_id") or (entity_ref or {}).get("entity_id") or "").strip()
        prompt_text = str(payload.get("prompt") or (entity_ref or {}).get("title") or "this card").strip() or "this card"
        interrupt = _create_interrupt(
            conn,
            run_id=run["id"],
            thread_id=thread["id"],
            tool_name="grade_review_recall",
            interrupt_type="choice",
            title="Grade recall",
            body=f"How well did you recall: {prompt_text}?",
            fields=[
                {
                    "id": "rating",
                    "kind": "select",
                    "label": "Recall quality",
                    "required": True,
                    "options": [
                        {"label": "Again", "value": "1"},
                        {"label": "Hard", "value": "3"},
                        {"label": "Good", "value": "4"},
                        {"label": "Easy", "value": "5"},
                    ],
                }
            ],
            primary_label="Save grade",
            secondary_label="Keep in Review",
            metadata={
                "surface_event": event,
                "card_id": card_id,
                "prompt": prompt_text,
                "display_mode": "inline",
                "consequence_preview": "Updates the review schedule for this item.",
                "defer_label": "Keep in Review",
            },
            entity_ref=entity_ref,
        )
        assistant_thread_service.append_message(
            conn,
            thread_id=thread["id"],
            role="assistant",
            status="requires_action",
            run_id=run["id"],
            metadata={"surface_event": event, "interrupt_id": interrupt["id"]},
            parts=[
                assistant_projection_service.text_part(
                    "You revealed the answer in Review. Record the recall grade here if you want the thread to track the result."
                ),
                assistant_projection_service.interrupt_request_part(interrupt),
            ],
        )
        _record_step(
            conn,
            run_id=run["id"],
            thread_id=thread["id"],
            step_index=0,
            title="Grade review recall",
            tool_name="grade_review_recall",
            tool_kind="ui_tool",
            status="requires_action",
            arguments=payload,
            result={"interrupt_id": interrupt["id"]},
            interrupt_id=interrupt["id"],
        )
        _update_run(conn, run_id=run["id"], status="interrupted", summary="Review grade requested")
        return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)

    if kind == "briefing.generated":
        interrupt = _create_interrupt(
            conn,
            run_id=run["id"],
            thread_id=thread["id"],
            tool_name="choose_morning_focus",
            interrupt_type="choice",
            title="Start with one thing",
            body="Choose today’s first bounded move.",
            fields=[
                {
                    "id": "focus",
                    "kind": "select",
                    "label": "First move",
                    "required": True,
                    "options": [
                        {"label": "Review queue", "value": "review"},
                        {"label": "Process latest capture", "value": "capture"},
                        {"label": "Start deep work block", "value": "deep_work"},
                        {"label": "Plan today", "value": "plan_day"},
                    ],
                }
            ],
            primary_label="Begin",
            secondary_label="Later",
            metadata={
                "surface_event": event,
                "display_mode": "composer",
                "consequence_preview": "Starts the selected focus from the Assistant thread.",
                "defer_label": "Later",
            },
            entity_ref=entity_ref,
        )
        assistant_thread_service.append_message(
            conn,
            thread_id=thread["id"],
            role="assistant",
            status="requires_action",
            run_id=run["id"],
            metadata={"surface_event": event, "interrupt_id": interrupt["id"]},
            parts=[
                assistant_projection_service.text_part("Here is your morning briefing. Choose one focused way to start."),
                assistant_projection_service.interrupt_request_part(interrupt),
            ],
        )
        _record_step(
            conn,
            run_id=run["id"],
            thread_id=thread["id"],
            step_index=0,
            title="Choose morning focus",
            tool_name="choose_morning_focus",
            tool_kind="ui_tool",
            status="requires_action",
            arguments=payload,
            result={"interrupt_id": interrupt["id"]},
            interrupt_id=interrupt["id"],
        )
        _update_run(conn, run_id=run["id"], status="interrupted", summary="Morning focus requested")
        return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)

    assistant_thread_service.append_message(
        conn,
        thread_id=thread["id"],
        role="system",
        status="complete",
        run_id=run["id"],
        metadata={"surface_event": event},
        parts=[
            assistant_projection_service.ambient_update_part(
                {
                    "id": new_id("ambient"),
                    "event_id": event["id"],
                    "label": kind.replace(".", " "),
                    "body": str(payload.get("body") or "").strip() or None,
                    "entity_ref": entity_ref,
                    "actions": [],
                    "metadata": {"source_surface": source_surface},
                    "created_at": event["created_at"],
                }
            )
        ],
    )
    _update_run(conn, run_id=run["id"], status="completed", summary=kind.replace(".", " "))
    return assistant_thread_service.get_thread_snapshot(conn, thread["id"], user_id=user_id)
