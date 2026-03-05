from datetime import datetime

from pydantic import BaseModel, Field


class CardResponse(BaseModel):
    id: str
    card_set_version_id: str | None = None
    artifact_id: str | None = None
    note_block_id: str | None = None
    card_type: str
    prompt: str
    answer: str
    due_at: datetime
    interval_days: int
    repetitions: int
    ease_factor: float
    created_at: datetime


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
