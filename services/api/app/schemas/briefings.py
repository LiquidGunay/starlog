from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.memory import MemorySuggestionResponse
from app.schemas.memory_context import MemoryEntryResponse, RecommendationHintResponse


class BriefingGenerateRequest(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    provider: str = "template"


class BriefingSectionItem(BaseModel):
    label: str
    detail: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class BriefingSection(BaseModel):
    kind: str
    title: str
    summary: str
    items: list[BriefingSectionItem] = Field(default_factory=list)


class BriefingSourceRef(BaseModel):
    entity_type: str
    entity_id: str
    label: str
    detail: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class BriefingPackageResponse(BaseModel):
    id: str
    date: str
    headline: str
    text: str
    sections: list[BriefingSection] = Field(default_factory=list)
    recent_memories: list[MemoryEntryResponse] = Field(default_factory=list)
    recommendation_hints: list[RecommendationHintResponse] = Field(default_factory=list)
    memory_suggestions: list[MemorySuggestionResponse] = Field(default_factory=list)
    source_refs: list[BriefingSourceRef] = Field(default_factory=list)
    audio_ref: str | None = None
    generated_by_provider: str
    created_at: datetime


class BriefingAudioRenderRequest(BaseModel):
    provider_hint: str | None = None


class AlarmPlanCreateRequest(BaseModel):
    trigger_at: datetime
    briefing_package_id: str = Field(..., min_length=1)
    device_target: str = Field(..., min_length=1)


class AlarmPlanResponse(BaseModel):
    id: str
    trigger_at: datetime
    briefing_package_id: str
    device_target: str
    created_at: datetime
