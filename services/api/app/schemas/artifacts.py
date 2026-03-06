from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ArtifactAction = Literal["summarize", "cards", "tasks", "append_note"]


class ArtifactCreateRequest(BaseModel):
    source_type: str = Field(..., min_length=1)
    title: str | None = None
    raw_content: str | None = None
    normalized_content: str | None = None
    extracted_content: str | None = None
    metadata: dict = Field(default_factory=dict)


class ArtifactResponse(BaseModel):
    id: str
    source_type: str
    title: str | None = None
    raw_content: str | None = None
    normalized_content: str | None = None
    extracted_content: str | None = None
    metadata: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ArtifactActionRequest(BaseModel):
    action: ArtifactAction
    defer: bool = False
    provider_hint: str | None = None


class ArtifactActionResponse(BaseModel):
    artifact_id: str
    action: ArtifactAction
    status: str
    output_ref: str | None = None


class SummaryVersionResponse(BaseModel):
    id: str
    artifact_id: str
    version: int
    content: str
    provider: str
    created_at: datetime


class CardResponse(BaseModel):
    id: str
    artifact_id: str | None = None
    prompt: str
    answer: str
    card_type: str
    due_at: datetime
    interval_days: int
    repetitions: int
    ease_factor: float


class TaskResponse(BaseModel):
    id: str
    title: str
    status: str
    estimate_min: int | None = None
    priority: int
    due_at: datetime | None = None
    linked_note_id: str | None = None
    source_artifact_id: str | None = None


class NoteResponse(BaseModel):
    id: str
    title: str
    body_md: str
    version: int


class ArtifactRelationResponse(BaseModel):
    id: str
    artifact_id: str
    relation_type: str
    target_type: str
    target_id: str
    created_at: datetime


class ActionRunResponse(BaseModel):
    id: str
    artifact_id: str
    action: str
    status: str
    output_ref: str | None = None
    created_at: datetime


class CardSetVersionResponse(BaseModel):
    id: str
    artifact_id: str
    version: int
    created_at: datetime


class ArtifactGraphResponse(BaseModel):
    artifact: ArtifactResponse
    summaries: list[SummaryVersionResponse]
    cards: list[CardResponse]
    tasks: list[TaskResponse]
    notes: list[NoteResponse]
    relations: list[ArtifactRelationResponse]


class ArtifactVersionsResponse(BaseModel):
    artifact_id: str
    summaries: list[SummaryVersionResponse]
    card_sets: list[CardSetVersionResponse]
    actions: list[ActionRunResponse]
