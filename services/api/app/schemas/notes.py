from datetime import datetime

from pydantic import BaseModel, Field


class NoteCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    body_md: str = ""


class NoteUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    body_md: str | None = None
    base_revision: int | None = Field(default=None, ge=1)


class NoteResponse(BaseModel):
    id: str
    title: str
    body_md: str
    version: int
    created_at: datetime
    updated_at: datetime
