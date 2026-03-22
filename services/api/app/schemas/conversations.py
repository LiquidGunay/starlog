from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

ConversationRole = Literal["system", "user", "assistant", "tool"]


class ConversationCard(BaseModel):
    kind: str = Field(..., min_length=1)
    version: int = Field(default=1, ge=1)
    title: str | None = None
    body: str | None = None
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
    updated_at: datetime


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
