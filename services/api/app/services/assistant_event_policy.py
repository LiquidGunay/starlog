from __future__ import annotations

from typing import Final, Literal, TypeAlias, cast


AssistantEventVisibility: TypeAlias = Literal[
    "internal",
    "ambient",
    "assistant_message",
    "dynamic_panel",
]

VISIBILITY_INTERNAL: Final[AssistantEventVisibility] = "internal"
VISIBILITY_AMBIENT: Final[AssistantEventVisibility] = "ambient"
VISIBILITY_ASSISTANT_MESSAGE: Final[AssistantEventVisibility] = "assistant_message"
VISIBILITY_DYNAMIC_PANEL: Final[AssistantEventVisibility] = "dynamic_panel"

VALID_VISIBILITIES: Final[frozenset[str]] = frozenset(
    {
        VISIBILITY_INTERNAL,
        VISIBILITY_AMBIENT,
        VISIBILITY_ASSISTANT_MESSAGE,
        VISIBILITY_DYNAMIC_PANEL,
    }
)

# Product-level defaults for how surface events should enter the assistant thread.
# The resolver below may still honor a caller's explicit override when it is safe.
EVENT_VISIBILITY_POLICY: Final[dict[str, AssistantEventVisibility]] = {
    "capture.created": VISIBILITY_DYNAMIC_PANEL,
    "capture.enriched": VISIBILITY_AMBIENT,
    "artifact.opened": VISIBILITY_AMBIENT,
    "artifact.summarized": VISIBILITY_AMBIENT,
    "task.created": VISIBILITY_AMBIENT,
    "task.completed": VISIBILITY_AMBIENT,
    "task.snoozed": VISIBILITY_AMBIENT,
    "time_block.started": VISIBILITY_AMBIENT,
    "time_block.completed": VISIBILITY_AMBIENT,
    "planner.conflict.detected": VISIBILITY_DYNAMIC_PANEL,
    "review.session.started": VISIBILITY_AMBIENT,
    "review.answer.revealed": VISIBILITY_DYNAMIC_PANEL,
    "review.answer.graded": VISIBILITY_AMBIENT,
    "briefing.generated": VISIBILITY_DYNAMIC_PANEL,
    "briefing.played": VISIBILITY_AMBIENT,
    "assistant.card.action_used": VISIBILITY_INTERNAL,
    "assistant.panel.submitted": VISIBILITY_AMBIENT,
    "voice.capture.transcribed": VISIBILITY_AMBIENT,
}


def resolve_event_visibility(kind: str, requested: str | None) -> AssistantEventVisibility:
    """Resolve caller-requested visibility into the persisted assistant event visibility.

    Requested visibility is what a caller asks for on the event write. Resolved visibility
    is the policy-backed result that controls whether the event stays internal, becomes an
    ambient thread update, becomes a plain assistant message, or opens a dynamic panel.
    """
    if requested is None:
        return EVENT_VISIBILITY_POLICY.get(kind, VISIBILITY_INTERNAL)
    if requested == VISIBILITY_INTERNAL:
        return VISIBILITY_INTERNAL
    if requested == VISIBILITY_ASSISTANT_MESSAGE:
        return EVENT_VISIBILITY_POLICY.get(kind, VISIBILITY_ASSISTANT_MESSAGE)
    if requested in VALID_VISIBILITIES:
        return cast(AssistantEventVisibility, requested)
    return EVENT_VISIBILITY_POLICY.get(kind, VISIBILITY_INTERNAL)
