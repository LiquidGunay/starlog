from typing import Any

from pydantic import BaseModel, Field

from app.schemas.artifacts import ArtifactResponse


class CaptureLayer(BaseModel):
    text: str | None = None
    mime_type: str | None = None
    blob_ref: str | None = None
    checksum_sha256: str | None = None


class CaptureRequest(BaseModel):
    source_type: str = Field(..., min_length=1)
    capture_source: str = Field(..., min_length=1)
    title: str | None = None
    source_url: str | None = None
    raw: CaptureLayer | None = None
    normalized: CaptureLayer | None = None
    extracted: CaptureLayer | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CaptureResponse(BaseModel):
    artifact: ArtifactResponse
