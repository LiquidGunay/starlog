from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from sqlite3 import Connection
from typing import Any, Protocol

from app.schemas.agent import AgentCommandResponse, AgentCommandStep
from app.services import (
    agent_service,
    assistant_projection_service,
    assistant_thread_service,
    conversation_card_service,
    review_mode_service,
    srs_service,
)
from app.services.common import new_id


RecordStep = Callable[..., dict[str, Any]]
RecordTrace = Callable[..., dict[str, Any]]
CompleteInterrupt = Callable[..., dict[str, Any]]
UpdateRun = Callable[..., None]
MergeSessionState = Callable[..., dict[str, Any]]
ClientTimezoneResolver = Callable[[dict[str, Any] | None, dict[str, Any] | None], str]
DueDateConverter = Callable[[str, str], datetime]
ReviewRatingLabel = Callable[[int], str]


@dataclass(frozen=True)
class InterruptActionContext:
    row: dict[str, Any]
    metadata: dict[str, Any]
    resolution: dict[str, Any]
    interrupt_id: str
    user_id: str | None
    record_step: RecordStep
    record_trace: RecordTrace
    complete_interrupt: CompleteInterrupt
    update_run: UpdateRun
    merge_session_state: MergeSessionState
    assistant_client_timezone: ClientTimezoneResolver
    due_date_to_utc_start: DueDateConverter
    review_rating_label: ReviewRatingLabel


class InterruptSubmitHandler(Protocol):
    tool_name: str

    def validate_submit(
        self, *, row: dict[str, Any], metadata: dict[str, Any], values: dict[str, Any]
    ) -> None: ...

    def submit(
        self, conn: Connection, *, context: InterruptActionContext, values: dict[str, Any]
    ) -> None: ...


class RequestDueDateInterruptHandler:
    tool_name = "request_due_date"

    def validate_submit(
        self, *, row: dict[str, Any], metadata: dict[str, Any], values: dict[str, Any]
    ) -> None:
        if not str(values.get("due_date") or "").strip():
            raise ValueError("due_date is required")

    def submit(
        self, conn: Connection, *, context: InterruptActionContext, values: dict[str, Any]
    ) -> None:
        metadata = context.metadata
        planned_arguments = (
            metadata.get("planned_arguments")
            if isinstance(metadata.get("planned_arguments"), dict)
            else {}
        )
        user_content = str(metadata.get("user_content") or "Create task")
        due_date_raw = str(values.get("due_date") or "").strip()
        client_timezone = context.assistant_client_timezone(
            metadata.get("request_metadata"), values
        )
        due_at = context.due_date_to_utc_start(due_date_raw, client_timezone)
        priority = int(values.get("priority") or planned_arguments.get("priority") or 3)
        create_arguments = {
            **planned_arguments,
            "due_at": due_at.isoformat(),
            "priority": priority,
        }
        spec, _validated, normalized, confirmation_policy = agent_service.prepare_tool_call(
            "create_task", create_arguments
        )
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
        row = context.row
        assistant_message = assistant_thread_service.append_message(
            conn,
            thread_id=row["thread_id"],
            role="assistant",
            status="complete",
            run_id=row["run_id"],
            metadata={
                "assistant_command": response.model_dump(mode="json"),
                "interrupt_resolution": context.resolution,
                "due_date_resolution": {
                    "due_date": due_date_raw,
                    "client_timezone": client_timezone,
                    "due_at_utc": due_at.isoformat(),
                },
            },
            parts=[
                assistant_projection_service.text_part(response.summary),
                assistant_projection_service.interrupt_resolution_part(context.resolution),
                *[
                    assistant_projection_service.card_part(card)
                    for card in conversation_card_service.project_agent_response_cards(
                        conn, response
                    )
                ],
            ],
        )
        context.record_step(
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
            interrupt_id=context.interrupt_id,
            message_id=assistant_message["id"],
        )
        context.record_trace(
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
            metadata={"resolved_from_interrupt": context.interrupt_id},
        )
        context.merge_session_state(
            conn,
            command=user_content,
            response_text=response.summary,
            matched_intent="create_task",
            planner="deterministic",
            status="executed",
            tool_names=["create_task"],
        )
        context.complete_interrupt(
            conn,
            interrupt_id=context.interrupt_id,
            action="submit",
            values=values,
            resolution=context.resolution,
        )
        context.update_run(conn, run_id=row["run_id"], status="completed", summary=response.summary)


class GradeReviewRecallInterruptHandler:
    tool_name = "grade_review_recall"

    def validate_submit(
        self, *, row: dict[str, Any], metadata: dict[str, Any], values: dict[str, Any]
    ) -> None:
        return None

    def submit(
        self, conn: Connection, *, context: InterruptActionContext, values: dict[str, Any]
    ) -> None:
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
                raise ValueError(
                    "Review latency must be a non-negative integer when provided"
                ) from exc
            if latency_ms < 0:
                raise ValueError("Review latency must be a non-negative integer when provided")

        row = context.row
        metadata = context.metadata
        entity_ref = (
            row.get("entity_ref_json") if isinstance(row.get("entity_ref_json"), dict) else {}
        )
        card_id = (
            str(metadata.get("card_id") or "").strip()
            or str(entity_ref.get("entity_id") or "").strip()
        )
        if not card_id:
            raise ValueError("Review interrupt is missing the target card")

        reviewed = srs_service.review_card(
            conn, card_id=card_id, rating=rating, latency_ms=latency_ms
        )
        if reviewed is None:
            raise LookupError(f"Review card not found: {card_id}")

        prompt_text = str(metadata.get("prompt") or "that card").strip() or "that card"
        card_type = (
            str(metadata.get("card_type") or reviewed.get("card_type") or "").strip() or None
        )
        raw_review_mode = str(
            metadata.get("review_mode") or reviewed.get("review_mode") or ""
        ).strip()
        review_mode = (
            raw_review_mode
            if raw_review_mode in review_mode_service.REVIEW_MODE_ORDER
            else review_mode_service.review_mode_for_card_type(card_type)
        )
        review_mode_label = review_mode.replace("_", " ")
        rating_label = context.review_rating_label(rating)
        next_due_at = str(reviewed.get("next_due_at") or "")
        next_due_label = next_due_at[:10] if next_due_at else "the next review window"
        assistant_message = assistant_thread_service.append_message(
            conn,
            thread_id=row["thread_id"],
            role="assistant",
            status="complete",
            run_id=row["run_id"],
            metadata={
                "interrupt_resolution": context.resolution,
                "review_result": reviewed,
                "card_type": card_type,
                "review_mode": review_mode,
            },
            parts=[
                assistant_projection_service.text_part(
                    f"Recorded {rating_label} for {review_mode_label} review: {prompt_text}. Next due: {next_due_label}."
                ),
                assistant_projection_service.tool_result_part(
                    tool_call_id=str(metadata.get("tool_call_id") or new_id("toolcall")),
                    status="complete",
                    output=reviewed,
                    metadata={
                        "message": "Review grade recorded",
                        "tool_name": "grade_review_recall",
                    },
                    renderer_key="interview.review_grade",
                    renderer_version=1,
                    placement="thread",
                    structured_content={
                        "card_id": card_id,
                        "grade": str(rating),
                        "next_due_at": reviewed.get("next_due_at"),
                    },
                    ui_meta={
                        "tone": "review",
                        "rating_label": rating_label,
                        "review_mode": review_mode,
                        "card_type": card_type,
                    },
                ),
                assistant_projection_service.interrupt_resolution_part(context.resolution),
            ],
        )
        context.record_step(
            conn,
            run_id=row["run_id"],
            thread_id=row["thread_id"],
            step_index=1,
            title="Grade review recall",
            tool_name="grade_review_recall",
            tool_kind="ui_tool",
            status="completed",
            arguments={
                "rating": rating,
                "latency_ms": latency_ms,
                "card_type": card_type,
                "review_mode": review_mode,
            },
            result=reviewed,
            interrupt_id=context.interrupt_id,
            message_id=assistant_message["id"],
        )
        context.complete_interrupt(
            conn,
            interrupt_id=context.interrupt_id,
            action="submit",
            values=values,
            resolution=context.resolution,
        )
        context.update_run(
            conn, run_id=row["run_id"], status="completed", summary="Review grade recorded"
        )


class UnsupportedInterruptHandler:
    tool_name = "unsupported"

    def validate_submit(
        self, *, row: dict[str, Any], metadata: dict[str, Any], values: dict[str, Any]
    ) -> None:
        return None

    def submit(
        self, conn: Connection, *, context: InterruptActionContext, values: dict[str, Any]
    ) -> None:
        raise ValueError(f"Unsupported interrupt tool: {context.row['tool_name']}")


def dismiss_interrupt(
    conn: Connection,
    *,
    row: dict[str, Any],
    interrupt_id: str,
    resolution: dict[str, Any],
    complete_interrupt: CompleteInterrupt,
    update_run: UpdateRun,
) -> None:
    complete_interrupt(
        conn, interrupt_id=interrupt_id, action="dismiss", values={}, resolution=resolution
    )
    assistant_thread_service.append_message(
        conn,
        thread_id=row["thread_id"],
        role="assistant",
        status="complete",
        run_id=row["run_id"],
        metadata={"interrupt_resolution": resolution},
        parts=[
            assistant_projection_service.text_part(
                "Okay. I left that as a draft and kept the thread moving."
            ),
            assistant_projection_service.interrupt_resolution_part(resolution),
        ],
    )
    update_run(conn, run_id=row["run_id"], status="cancelled", summary="Interrupt dismissed")


_MONOLITH_FALLBACK_TOOLS = {
    "triage_capture",
    "resolve_planner_conflict",
    "choose_morning_focus",
    "clarify_schedule_time",
    "defer_recommendation",
    "link_capture_project",
}
_SUBMIT_HANDLERS: dict[str, InterruptSubmitHandler] = {
    RequestDueDateInterruptHandler.tool_name: RequestDueDateInterruptHandler(),
    GradeReviewRecallInterruptHandler.tool_name: GradeReviewRecallInterruptHandler(),
}
_UNSUPPORTED_HANDLER = UnsupportedInterruptHandler()


def handler_for_tool(tool_name: str) -> InterruptSubmitHandler | None:
    handler = _SUBMIT_HANDLERS.get(tool_name)
    if handler is not None:
        return handler
    if tool_name in _MONOLITH_FALLBACK_TOOLS:
        return None
    return _UNSUPPORTED_HANDLER
