from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

AssistantRole = Literal["system", "user", "assistant", "tool"]
AssistantMessageStatus = Literal["pending", "running", "requires_action", "complete", "error"]
AssistantRunStatus = Literal["queued", "running", "interrupted", "completed", "failed", "cancelled"]
AssistantInterruptStatus = Literal["pending", "submitted", "dismissed", "expired"]


class AssistantEntityRef(BaseModel):
    entity_type: str = Field(..., min_length=1)
    entity_id: str = Field(..., min_length=1)
    href: str | None = None
    title: str | None = None


class AssistantCardAction(BaseModel):
    id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    kind: Literal["navigate", "mutation", "composer", "interrupt"]
    payload: dict[str, Any] = Field(default_factory=dict)
    style: Literal["primary", "secondary", "ghost", "danger"] = "secondary"
    requires_confirmation: bool = False


class AssistantCard(BaseModel):
    kind: str = Field(..., min_length=1)
    version: int = Field(default=1, ge=1)
    title: str | None = None
    body: str | None = None
    entity_ref: AssistantEntityRef | None = None
    actions: list[AssistantCardAction] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssistantInterruptField(BaseModel):
    id: str = Field(..., min_length=1)
    kind: Literal["text", "textarea", "select", "date", "time", "datetime", "toggle", "priority", "entity_search"]
    label: str = Field(..., min_length=1)
    required: bool = False
    placeholder: str | None = None
    value: Any = None
    min: int | None = None
    max: int | None = None
    options: list[dict[str, str]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssistantInterrupt(BaseModel):
    id: str
    thread_id: str
    run_id: str
    status: AssistantInterruptStatus
    interrupt_type: Literal["choice", "form", "confirm"]
    tool_name: str
    title: str
    body: str | None = None
    entity_ref: AssistantEntityRef | None = None
    fields: list[AssistantInterruptField] = Field(default_factory=list)
    primary_label: str
    secondary_label: str | None = None
    display_mode: Literal["inline", "composer", "sidecar", "bottom_sheet"] | None = None
    consequence_preview: str | None = None
    defer_label: str | None = None
    destructive: bool = False
    recommended_defaults: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    resolved_at: datetime | None = None
    resolution: dict[str, Any] = Field(default_factory=dict)


class AssistantRunStep(BaseModel):
    id: str
    run_id: str
    step_index: int = Field(ge=0)
    title: str
    tool_name: str | None = None
    tool_kind: str | None = None
    status: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    error_text: str | None = None
    interrupt_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class AssistantRun(BaseModel):
    id: str
    thread_id: str
    origin_message_id: str | None = None
    orchestrator: Literal["deterministic", "runtime", "hybrid"]
    status: AssistantRunStatus
    summary: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    steps: list[AssistantRunStep] = Field(default_factory=list)
    current_interrupt: AssistantInterrupt | None = None
    created_at: datetime
    updated_at: datetime


class AssistantThreadMessage(BaseModel):
    id: str
    thread_id: str
    run_id: str | None = None
    role: AssistantRole
    status: AssistantMessageStatus
    parts: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime | None = None


class AssistantThreadSummary(BaseModel):
    id: str
    slug: str
    title: str
    mode: str
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime | None = None
    last_preview_text: str | None = None


class AssistantThreadSnapshot(AssistantThreadSummary):
    messages: list[AssistantThreadMessage] = Field(default_factory=list)
    runs: list[AssistantRun] = Field(default_factory=list)
    interrupts: list[AssistantInterrupt] = Field(default_factory=list)
    context_cards: list[AssistantCard] = Field(default_factory=list)
    session_state: dict[str, Any] = Field(default_factory=dict)
    next_cursor: str | None = None


class AssistantCreateThreadResponse(AssistantThreadSummary):
    pass


class AssistantCreateMessageRequest(BaseModel):
    content: str = Field(..., min_length=1)
    input_mode: str = Field(default="text", min_length=1)
    device_target: str = Field(default="web-desktop", min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssistantHandoff(BaseModel):
    source: Literal["assistant", "library", "planner", "review", "desktop_helper", "system"]
    artifact_id: str | None = None
    draft: str = Field(..., min_length=1)


class AssistantCreateHandoffRequest(BaseModel):
    source_surface: Literal["assistant", "library", "planner", "review", "desktop_helper", "system"]
    artifact_id: str | None = None
    draft: str = Field(..., min_length=1)


class AssistantCreateHandoffResponse(BaseModel):
    token: str = Field(..., min_length=1)
    handoff: AssistantHandoff
    expires_at: datetime


class AssistantResolveHandoffResponse(BaseModel):
    handoff: AssistantHandoff


class AssistantCreateMessageResponse(BaseModel):
    thread_id: str
    run: AssistantRun
    user_message: AssistantThreadMessage
    assistant_message: AssistantThreadMessage
    snapshot: AssistantThreadSnapshot


class AssistantInterruptSubmitRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


class AssistantSurfaceEventCreateRequest(BaseModel):
    source_surface: Literal["assistant", "library", "planner", "review", "desktop_helper", "system"]
    kind: str = Field(..., min_length=1)
    entity_ref: AssistantEntityRef | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    visibility: Literal["internal", "ambient", "assistant_message", "dynamic_panel"] = "internal"


class AssistantThreadDelta(BaseModel):
    id: str
    thread_id: str
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AssistantDeltaListResponse(BaseModel):
    thread_id: str
    cursor: str | None = None
    deltas: list[AssistantThreadDelta] = Field(default_factory=list)
