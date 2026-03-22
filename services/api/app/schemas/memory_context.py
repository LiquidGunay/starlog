from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class MemoryEntryResponse(BaseModel):
    id: str
    entry_type: str
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class RecommendationHintResponse(BaseModel):
    id: str
    surface: str
    signal_type: str
    entity_type: str
    entity_id: str
    weight: float
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
