from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ArtifactAction = Literal["summarize", "cards", "tasks", "append_note"]
ArtifactDetailAction = Literal["summarize", "cards", "tasks", "append_note", "archive", "link"]
ArtifactDetailLayerKind = Literal["raw", "normalized", "extracted"]


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


class ArtifactDetailIdentityResponse(BaseModel):
    id: str
    source_type: str
    title: str | None = None
    created_at: datetime
    updated_at: datetime


class ArtifactCaptureProvenanceResponse(BaseModel):
    source_app: str | None = None
    source_type: str
    source_url: str | None = None
    source_file: str | None = None
    capture_method: str | None = None
    captured_at: datetime
    tags: list[str] = Field(default_factory=list)


class ArtifactSourceLayerPreviewResponse(BaseModel):
    layer: ArtifactDetailLayerKind
    present: bool
    preview: str | None = None
    character_count: int | None = None
    mime_type: str | None = None
    checksum_sha256: str | None = None
    source_filename: str | None = None


class ArtifactLatestSummaryResponse(BaseModel):
    id: str
    version: int
    provider: str
    created_at: datetime
    preview: str
    character_count: int


class ArtifactNoteLinkResponse(BaseModel):
    id: str
    title: str
    version: int


class ArtifactDetailRelationResponse(BaseModel):
    id: str
    artifact_id: str
    relation_type: str
    target_type: str
    target_id: str
    created_at: datetime


class ArtifactDetailConnectionsResponse(BaseModel):
    summary_version_count: int
    latest_summary: ArtifactLatestSummaryResponse | None = None
    card_count: int
    card_set_version_count: int
    task_count: int
    note_count: int
    notes: list[ArtifactNoteLinkResponse] = Field(default_factory=list)
    relation_count: int
    relations: list[ArtifactDetailRelationResponse] = Field(default_factory=list)
    action_run_count: int


class ArtifactDetailTimelineEventResponse(BaseModel):
    kind: str
    label: str
    occurred_at: datetime
    entity_type: str
    entity_id: str
    status: str | None = None


class ArtifactDetailSuggestedActionResponse(BaseModel):
    action: ArtifactDetailAction
    label: str
    enabled: bool
    method: str | None = None
    endpoint: str | None = None
    disabled_reason: str | None = None


class ArtifactDetailResponse(BaseModel):
    artifact: ArtifactDetailIdentityResponse
    capture: ArtifactCaptureProvenanceResponse
    source_layers: list[ArtifactSourceLayerPreviewResponse]
    connections: ArtifactDetailConnectionsResponse
    timeline: list[ArtifactDetailTimelineEventResponse]
    suggested_actions: list[ArtifactDetailSuggestedActionResponse]


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
