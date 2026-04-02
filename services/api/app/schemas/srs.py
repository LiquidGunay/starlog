from datetime import datetime

from pydantic import BaseModel, Field


class DeckScheduleConfig(BaseModel):
    new_cards_due_offset_hours: int = Field(default=24, ge=0, le=24 * 30)
    initial_interval_days: int = Field(default=1, ge=1, le=365)
    initial_ease_factor: float = Field(default=2.5, ge=1.3, le=4.0)


class CardDeckResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    schedule: DeckScheduleConfig
    card_count: int = 0
    due_count: int = 0
    created_at: datetime
    updated_at: datetime


class CardResponse(BaseModel):
    id: str
    card_set_version_id: str | None = None
    artifact_id: str | None = None
    note_block_id: str | None = None
    deck_id: str | None = None
    card_type: str
    prompt: str
    answer: str
    tags: list[str] = Field(default_factory=list)
    suspended: bool = False
    due_at: datetime
    interval_days: int
    repetitions: int
    ease_factor: float
    created_at: datetime
    updated_at: datetime | None = None


class CardCreateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)
    card_type: str = Field(default="qa", min_length=1)
    deck_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    due_at: datetime | None = None
    interval_days: int | None = Field(default=None, ge=1, le=365)
    repetitions: int | None = Field(default=None, ge=0, le=10_000)
    ease_factor: float | None = Field(default=None, ge=1.3, le=4.0)
    suspended: bool = False
    artifact_id: str | None = None
    note_block_id: str | None = None


class CardUpdateRequest(BaseModel):
    prompt: str | None = Field(default=None, min_length=1)
    answer: str | None = Field(default=None, min_length=1)
    deck_id: str | None = None
    tags: list[str] | None = None
    due_at: datetime | None = None
    interval_days: int | None = Field(default=None, ge=1, le=365)
    repetitions: int | None = Field(default=None, ge=0, le=10_000)
    ease_factor: float | None = Field(default=None, ge=1.3, le=4.0)
    suspended: bool | None = None


class CardDeckCreateRequest(BaseModel):
    name: str = Field(..., min_length=1)
    description: str | None = None
    schedule: DeckScheduleConfig = Field(default_factory=DeckScheduleConfig)


class CardDeckUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    schedule: DeckScheduleConfig | None = None


class ReviewCreateRequest(BaseModel):
    card_id: str = Field(..., min_length=1)
    rating: int = Field(..., ge=0, le=5)
    latency_ms: int | None = Field(default=None, ge=0)


class ReviewResponse(BaseModel):
    card_id: str
    next_due_at: datetime
    interval_days: int
    repetitions: int
    ease_factor: float
