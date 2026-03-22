from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, HttpUrl, model_validator


class ResearchSourceResponse(BaseModel):
    id: str
    source_kind: str
    label: str
    enabled: bool
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ResearchSourceUpsertRequest(BaseModel):
    source_kind: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


class ManualResearchUrlRequest(BaseModel):
    title: str | None = None
    url: HttpUrl
    notes: str | None = None


class ManualResearchPdfRequest(BaseModel):
    media_id: str = Field(..., min_length=1)
    title: str | None = None
    notes: str | None = None


class ArxivResearchIngestRequest(BaseModel):
    arxiv_id: str | None = None
    url: HttpUrl | None = None
    title: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def require_identifier(self) -> "ArxivResearchIngestRequest":
        if self.arxiv_id or self.url:
            return self
        raise ValueError("Either arxiv_id or url is required")


class ResearchItemResponse(BaseModel):
    id: str
    source_id: str | None = None
    external_id: str | None = None
    title: str
    url: str | None = None
    authors: list[str] = Field(default_factory=list)
    abstract: str | None = None
    published_at: datetime | None = None
    content_artifact_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ResearchDigestResponse(BaseModel):
    id: str
    digest_date: str
    title: str
    summary_md: str
    items: list[dict[str, Any]] = Field(default_factory=list)
    provider: str
    created_at: datetime


class ResearchDigestGenerateRequest(BaseModel):
    digest_date: date | None = None
    limit: int = Field(default=10, ge=1, le=25)
    source_kind: str | None = None
    title: str | None = None


class ResearchDeepSummaryRequest(BaseModel):
    focus: str | None = None


class ResearchDeepSummaryResponse(BaseModel):
    item_id: str
    title: str
    summary_md: str
    provider: str
    context: dict[str, Any] = Field(default_factory=dict)
