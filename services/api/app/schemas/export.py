from pydantic import BaseModel, Field


class ExportResponse(BaseModel):
    exported_at: str
    manifest: dict
    notes_markdown: dict[str, str]
    media_blobs: dict[str, dict[str, str]] = Field(default_factory=dict)
    entities: dict[str, list[dict]]
