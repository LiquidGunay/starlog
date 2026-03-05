from datetime import datetime

from pydantic import BaseModel, Field


class GenerateBlocksRequest(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    day_start_hour: int = Field(default=7, ge=0, le=23)
    day_end_hour: int = Field(default=21, ge=1, le=23)


class TimeBlockResponse(BaseModel):
    id: str
    task_id: str | None = None
    title: str
    starts_at: datetime
    ends_at: datetime
    locked: bool
    created_at: datetime


class GenerateBlocksResponse(BaseModel):
    date: str
    generated: int
    blocks: list[TimeBlockResponse]
