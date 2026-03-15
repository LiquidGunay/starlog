from datetime import datetime

from pydantic import BaseModel, Field


class TaskCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    status: str = "todo"
    estimate_min: int | None = Field(default=None, ge=1)
    priority: int = Field(default=2, ge=1, le=5)
    due_at: datetime | None = None
    linked_note_id: str | None = None
    source_artifact_id: str | None = None


class TaskUpdateRequest(BaseModel):
    title: str | None = None
    status: str | None = None
    estimate_min: int | None = Field(default=None, ge=1)
    priority: int | None = Field(default=None, ge=1, le=5)
    due_at: datetime | None = None
    linked_note_id: str | None = None
    base_revision: int | None = Field(default=None, ge=1)


class TaskResponse(BaseModel):
    id: str
    title: str
    status: str
    revision: int
    estimate_min: int | None = None
    priority: int
    due_at: datetime | None = None
    linked_note_id: str | None = None
    source_artifact_id: str | None = None
    created_at: datetime
    updated_at: datetime
