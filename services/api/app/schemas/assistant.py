from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

AssistantRole = Literal["system", "user", "assistant", "tool"]
AssistantMessageStatus = Literal["pending", "running", "requires_action", "complete", "error"]
AssistantRunStatus = Literal["queued", "running", "interrupted", "completed", "failed", "cancelled"]
AssistantInterruptStatus = Literal["pending", "submitted", "dismissed", "expired"]
AssistantDynamicUiPlacement = str


class AssistantDynamicUiToolDescriptor(BaseModel):
    tool_name: str = Field(..., min_length=1)
    kind: str = Field(..., min_length=1)
    description: str | None = None
    renderer_key: str | None = None
    renderer_version: int | None = Field(default=None, ge=1)
    action_examples: list[str] = Field(default_factory=list)


class AssistantDynamicUiRendererDescriptor(BaseModel):
    renderer_key: str = Field(..., min_length=1)
    renderer_version: int = Field(default=1, ge=1)
    placements: list[AssistantDynamicUiPlacement] = Field(default_factory=list)
    tool_names: list[str] = Field(default_factory=list)
    structured_content_fields: list[str] = Field(default_factory=list)
    ui_meta_fields: list[str] = Field(default_factory=list)
    description: str | None = None


class AssistantDynamicUiCapabilityManifest(BaseModel):
    version: str = Field(..., min_length=1)
    approved_surfaces: list[str] = Field(default_factory=list)
    surfaces: list[str] = Field(default_factory=list)
    surface_capabilities: list[dict[str, Any]] = Field(default_factory=list)
    supported_now: list[str] = Field(default_factory=list)
    unavailable_or_unproven: list[str] = Field(default_factory=list)
    ui_tools: list[AssistantDynamicUiToolDescriptor] = Field(default_factory=list)
    renderers: list[AssistantDynamicUiRendererDescriptor] = Field(default_factory=list)
    command_examples: list[str] = Field(default_factory=list)


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
    renderer_key: str | None = None
    renderer_version: int | None = None
    placement: AssistantDynamicUiPlacement | None = None
    structured_content: dict[str, Any] | None = None
    ui_meta: dict[str, Any] | None = None
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
    tool_call_id: str | None = None
    title: str
    body: str | None = None
    renderer_key: str | None = None
    renderer_version: int | None = None
    placement: AssistantDynamicUiPlacement | None = None
    structured_content: dict[str, Any] | None = None
    ui_meta: dict[str, Any] | None = None
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


class AssistantTextPart(BaseModel):
    type: Literal["text"]
    id: str = Field(..., min_length=1)
    text: str


class AssistantCardPart(BaseModel):
    type: Literal["card"]
    id: str = Field(..., min_length=1)
    card: AssistantCard


class AssistantStatusPart(BaseModel):
    type: Literal["status"]
    id: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)
    label: str | None = None


class AssistantToolCall(BaseModel):
    id: str = Field(..., min_length=1)
    tool_name: str = Field(..., min_length=1)
    tool_kind: str = Field(default="system_tool", min_length=1)
    status: str = Field(..., min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict)
    title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssistantToolCallPart(BaseModel):
    type: Literal["tool_call"]
    id: str = Field(..., min_length=1)
    tool_call: AssistantToolCall


class AssistantToolResult(BaseModel):
    id: str = Field(..., min_length=1)
    tool_call_id: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)
    output: dict[str, Any] = Field(default_factory=dict)
    renderer_key: str | None = None
    renderer_version: int | None = None
    placement: AssistantDynamicUiPlacement | None = None
    structured_content: dict[str, Any] | None = None
    ui_meta: dict[str, Any] | None = None
    card: AssistantCard | None = None
    entity_ref: AssistantEntityRef | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssistantToolResultPart(BaseModel):
    type: Literal["tool_result"]
    id: str = Field(..., min_length=1)
    tool_result: AssistantToolResult


class AssistantInterruptRequestPart(BaseModel):
    type: Literal["interrupt_request"]
    id: str = Field(..., min_length=1)
    interrupt: AssistantInterrupt


class AssistantInterruptResolutionPart(BaseModel):
    type: Literal["interrupt_resolution"]
    id: str = Field(..., min_length=1)
    resolution: dict[str, Any] = Field(default_factory=dict)


class AssistantAmbientUpdate(BaseModel):
    id: str = Field(..., min_length=1)
    event_id: str = Field(..., min_length=1)
    label: str
    body: str | None = None
    entity_ref: AssistantEntityRef | None = None
    actions: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | str


class AssistantAmbientUpdatePart(BaseModel):
    type: Literal["ambient_update"]
    id: str = Field(..., min_length=1)
    update: AssistantAmbientUpdate


class AssistantAttachment(BaseModel):
    id: str = Field(..., min_length=1)
    kind: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    url: str | None = None
    mime_type: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssistantAttachmentPart(BaseModel):
    type: Literal["attachment"]
    id: str = Field(..., min_length=1)
    attachment: AssistantAttachment


AssistantMessagePart = Annotated[
    AssistantTextPart
    | AssistantCardPart
    | AssistantStatusPart
    | AssistantToolCallPart
    | AssistantToolResultPart
    | AssistantInterruptRequestPart
    | AssistantInterruptResolutionPart
    | AssistantAmbientUpdatePart
    | AssistantAttachmentPart,
    Field(discriminator="type"),
]


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
    dynamic_ui_capabilities: AssistantDynamicUiCapabilityManifest | None = None
    steps: list[AssistantRunStep] = Field(default_factory=list)
    current_interrupt: AssistantInterrupt | None = None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def populate_dynamic_ui_capabilities(self) -> "AssistantRun":
        if self.dynamic_ui_capabilities is not None:
            return self
        raw_capabilities = self.metadata.get("ui_capabilities") if isinstance(self.metadata, dict) else None
        if isinstance(raw_capabilities, dict):
            self.dynamic_ui_capabilities = AssistantDynamicUiCapabilityManifest.model_validate(raw_capabilities)
        return self


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


class AssistantRuntimeThreadContext(BaseModel):
    id: str
    slug: str
    mode: str


class AssistantRuntimeRecentMessage(BaseModel):
    id: str
    role: AssistantRole
    content: str
    cards: list[AssistantCard] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AssistantRuntimeRecentToolTrace(BaseModel):
    id: str
    message_id: str | None = None
    tool_name: str
    status: str
    result: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    projected_card: AssistantCard | None = None


class AssistantRuntimeContext(BaseModel):
    thread: AssistantRuntimeThreadContext
    session_state: dict[str, Any] = Field(default_factory=dict)
    recent_messages: list[AssistantRuntimeRecentMessage] = Field(default_factory=list)
    recent_tool_traces: list[AssistantRuntimeRecentToolTrace] = Field(default_factory=list)
    strategic_context_cards: list[AssistantCard] = Field(default_factory=list)
    request_metadata: dict[str, Any] = Field(default_factory=dict)
    memory_context: dict[str, Any] = Field(default_factory=dict)
    assistant_memory_suggestions: list[dict[str, Any]] = Field(default_factory=list)
    recommendation_hints: list[dict[str, Any]] = Field(default_factory=list)
    ui_capabilities: AssistantDynamicUiCapabilityManifest


class AssistantRuntimeRequest(BaseModel):
    thread_id: str
    title: str
    text: str
    context: AssistantRuntimeContext


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
