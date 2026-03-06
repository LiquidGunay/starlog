from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


SearchResultKind = Literal["artifact", "note", "task", "calendar_event"]


class SearchResultResponse(BaseModel):
    kind: SearchResultKind
    id: str
    title: str
    snippet: str
    updated_at: datetime
    metadata: dict = Field(default_factory=dict)


class SearchResponse(BaseModel):
    query: str
    total: int
    results: list[SearchResultResponse] = Field(default_factory=list)
