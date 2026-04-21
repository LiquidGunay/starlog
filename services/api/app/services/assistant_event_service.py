from __future__ import annotations

import json
from sqlite3 import Connection
from typing import Any

from app.core.time import utc_now
from app.services import assistant_projection_service, assistant_thread_service
from app.services.assistant_run_service import _create_interrupt, _create_run, _record_step, _update_run
from app.services.common import execute_fetchone, new_id


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
            metadata={"surface_event": event, "conflict_payload": payload},
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
                    "label": "Capture kind",
                    "required": True,
                    "options": [
                        {"label": "Research source", "value": "research_source"},
                        {"label": "Fleeting note", "value": "fleeting_note"},
                        {"label": "Reference image", "value": "reference_image"},
                    ],
                },
                {
                    "id": "next_step",
                    "kind": "select",
                    "label": "Next step",
                    "required": True,
                    "options": [
                        {"label": "Summarize", "value": "summarize"},
                        {"label": "Make cards", "value": "cards"},
                        {"label": "Append to note", "value": "append_note"},
                    ],
                },
            ],
            primary_label="Save choice",
            secondary_label="Not now",
            metadata={"surface_event": event, "artifact_id": payload.get("artifact_id")},
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
            metadata={"surface_event": event, "card_id": card_id, "prompt": prompt_text},
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
                        {"label": "30m review queue", "value": "review"},
                        {"label": "Process latest capture", "value": "capture"},
                        {"label": "Start deep work block", "value": "deep_work"},
                    ],
                }
            ],
            primary_label="Begin",
            secondary_label="Later",
            metadata={"surface_event": event},
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
