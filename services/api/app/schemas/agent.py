from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.artifacts import ArtifactAction


class AgentToolDefinition(BaseModel):
    name: str
    description: str
    parameters_schema: dict[str, Any] = Field(default_factory=dict)
    backing_endpoint: str | None = None


class AgentToolCallRequest(BaseModel):
    tool_name: str = Field(..., min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict)
    dry_run: bool = False


class AgentToolCallResponse(BaseModel):
    tool_name: str
    status: Literal["ok", "dry_run"]
    validated_arguments: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | list[dict[str, Any]] = Field(default_factory=lambda: {})


class CaptureTextToolArgs(BaseModel):
    title: str | None = None
    text: str = Field(..., min_length=1)
    source_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    source_type: str = "clip_manual"
    capture_source: str = "agent_tool"
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunArtifactActionToolArgs(BaseModel):
    artifact_id: str = Field(..., min_length=1)
    action: ArtifactAction
    defer: bool = False
    provider_hint: str | None = None


class CreateTaskToolArgs(BaseModel):
    title: str = Field(..., min_length=1)
    status: str = "todo"
    estimate_min: int | None = Field(default=None, ge=1)
    priority: int = Field(default=2, ge=1, le=5)
    due_at: datetime | None = None
    linked_note_id: str | None = None
    source_artifact_id: str | None = None


class UpdateTaskToolArgs(BaseModel):
    task_id: str = Field(..., min_length=1)
    title: str | None = None
    status: str | None = None
    estimate_min: int | None = Field(default=None, ge=1)
    priority: int | None = Field(default=None, ge=1, le=5)
    due_at: datetime | None = None
    linked_note_id: str | None = None


class CreateCalendarEventToolArgs(BaseModel):
    title: str = Field(..., min_length=1)
    starts_at: datetime
    ends_at: datetime
    source: str = "internal"


class GenerateBriefingToolArgs(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    provider: str = "template"


class ScheduleMorningBriefAlarmToolArgs(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    trigger_at: datetime
    device_target: str = Field(..., min_length=1)
    provider: str = "template"


class ListDueCardsToolArgs(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)


class SubmitReviewToolArgs(BaseModel):
    card_id: str = Field(..., min_length=1)
    rating: int = Field(..., ge=0, le=5)
    latency_ms: int | None = Field(default=None, ge=0)


class SearchStarlogToolArgs(BaseModel):
    query: str = Field(..., min_length=1)
    limit: int = Field(default=10, ge=1, le=100)
