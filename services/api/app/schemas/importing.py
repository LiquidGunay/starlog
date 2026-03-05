from datetime import datetime

from pydantic import BaseModel, Field


class MarkdownImportRequest(BaseModel):
    title: str = Field(..., min_length=1)
    markdown: str


class MarkdownImportResponse(BaseModel):
    note_id: str
    created_at: datetime
