from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.export import ExportResponse


class MarkdownImportRequest(BaseModel):
    title: str = Field(..., min_length=1)
    markdown: str


class MarkdownImportResponse(BaseModel):
    note_id: str
    created_at: datetime


class ExportImportRequest(BaseModel):
    export_payload: ExportResponse
    replace_existing: bool = True


class ExportImportResponse(BaseModel):
    restored_tables: dict[str, int] = Field(default_factory=dict)
    restored_at: datetime
