from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

ConversationRole = Literal["system", "user", "assistant", "tool"]


class ConversationCardEntityRef(BaseModel):
    entity_type: str = Field(..., min_length=1)
    entity_id: str = Field(..., min_length=1)
    href: str | None = None
    title: str | None = None


class ConversationCardAction(BaseModel):
    id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    kind: Literal["navigate", "mutation", "composer"]
    payload: dict[str, Any] = Field(default_factory=dict)
    style: Literal["primary", "secondary", "ghost", "danger"] = "secondary"
    requires_confirmation: bool = False


class ConversationCard(BaseModel):
    kind: str = Field(..., min_length=1)
    version: int = Field(default=1, ge=1)
    title: str | None = None
    body: str | None = None
    entity_ref: ConversationCardEntityRef | None = None
    actions: list[ConversationCardAction] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConversationMessage(BaseModel):
    id: str
    thread_id: str
    role: ConversationRole
    content: str
    cards: list[ConversationCard] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class ConversationToolTrace(BaseModel):
    id: str
    thread_id: str
    message_id: str | None = None
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    status: str
    result: dict[str, Any] | list[dict[str, Any]] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class ConversationThreadSnapshot(BaseModel):
    id: str
    slug: str
    title: str
    mode: str
    message_limit: int = Field(default=200, ge=1)
    trace_limit: int = Field(default=100, ge=0)
    has_more_messages: bool = False
    next_before_message_id: str | None = None
    session_state: dict[str, Any] = Field(default_factory=dict)
    messages: list[ConversationMessage] = Field(default_factory=list)
    tool_traces: list[ConversationToolTrace] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ConversationMessageCreateRequest(BaseModel):
    role: ConversationRole
    content: str = Field(..., min_length=1)
    cards: list[ConversationCard] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConversationSessionResetResponse(BaseModel):
    thread_id: str
    session_state: dict[str, Any] = Field(default_factory=dict)
    cleared_keys: list[str] = Field(default_factory=list)
    preserved_message_count: int = Field(default=0, ge=0)
    preserved_tool_trace_count: int = Field(default=0, ge=0)
    updated_at: datetime


class ConversationTurnRequest(BaseModel):
    content: str = Field(..., min_length=1)
    title: str | None = None
    message_limit: int = Field(default=12, ge=1, le=50)
    trace_limit: int = Field(default=10, ge=0, le=50)
    input_mode: str = Field(default="text", min_length=1)
    device_target: str = Field(default="web-pwa", min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)
    context_overrides: dict[str, Any] = Field(default_factory=dict)


class ConversationTurnResponse(BaseModel):
    thread_id: str
    user_message: ConversationMessage
    assistant_message: ConversationMessage
    trace: ConversationToolTrace
    session_state: dict[str, Any] = Field(default_factory=dict)


class ConversationPreviewRequest(BaseModel):
    content: str = Field(..., min_length=1)
    title: str | None = None
    message_limit: int = Field(default=12, ge=1, le=50)
    trace_limit: int = Field(default=10, ge=0, le=50)
    metadata: dict[str, Any] = Field(default_factory=dict)
    context_overrides: dict[str, Any] = Field(default_factory=dict)


class ConversationPreviewResponse(BaseModel):
    thread_id: str
    workflow: str
    provider_used: str
    model: str
    system_prompt: str
    user_prompt: str
    context: dict[str, Any] = Field(default_factory=dict)
