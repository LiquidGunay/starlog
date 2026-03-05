from datetime import datetime

from pydantic import BaseModel, Field


class NoteCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    body_md: str = ""


class NoteResponse(BaseModel):
    id: str
    title: str
    body_md: str
    version: int
    created_at: datetime
    updated_at: datetime
