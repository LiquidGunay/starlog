from pydantic import BaseModel


class ExportResponse(BaseModel):
    exported_at: str
    manifest: dict
    notes_markdown: dict[str, str]
    entities: dict[str, list[dict]]
