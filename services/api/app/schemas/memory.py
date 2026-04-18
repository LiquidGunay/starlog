from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class MemoryRef(BaseModel):
    entity_type: str = Field(..., min_length=1)
    entity_id: str = Field(..., min_length=1)
    label: str | None = None
    detail: str | None = None
    target_type: str | None = None
    target_id: str | None = None


class MemoryEdgeInput(BaseModel):
    relation_type: str = Field(..., min_length=1)
    target_type: str = Field(..., min_length=1)
    target_id: str = Field(..., min_length=1)
    label: str | None = None
    detail: str | None = None


class MemoryPageCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    body_md: str = ""
    kind: str = Field(..., min_length=1)
    namespace: str = Field(..., min_length=1)
    path: str | None = None
    tags: list[str] = Field(default_factory=list)
    source_refs: list[MemoryRef] = Field(default_factory=list)
    entity_refs: list[MemoryRef] = Field(default_factory=list)
    edge_refs: list[MemoryEdgeInput] = Field(default_factory=list)
    confidence: float = Field(default=0.6, ge=0.0, le=1.0)
    status: str = "active"
    review_after: datetime | None = None


class MemoryPageUpdateRequest(BaseModel):
    markdown_source: str = Field(..., min_length=1)
    base_version: int | None = Field(default=None, ge=1)


class MemoryEdgeResponse(BaseModel):
    id: str
    source_page_id: str
    relation_type: str
    target_type: str
    target_id: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class MemoryPageVersionResponse(BaseModel):
    id: str
    page_id: str
    version: int
    markdown_source: str
    frontmatter: dict[str, Any] = Field(default_factory=dict)
    body_md: str
    created_at: datetime


class MemoryPageResponse(BaseModel):
    id: str
    path: str
    title: str
    kind: str
    namespace: str
    status: str
    confidence: float
    latest_version: int
    created_at: datetime
    updated_at: datetime
    last_activated_at: datetime | None = None
    review_after: datetime | None = None
    archived_at: datetime | None = None
    frontmatter: dict[str, Any] = Field(default_factory=dict)
    markdown_source: str
    body_md: str
    backlinks: list[MemoryEdgeResponse] = Field(default_factory=list)
    linked_entities: list[MemoryEdgeResponse] = Field(default_factory=list)
    versions_count: int = 1


class MemoryTreeNode(BaseModel):
    kind: str
    name: str
    path: str
    page_id: str | None = None
    title: str | None = None
    namespace: str | None = None
    status: str | None = None
    children: list["MemoryTreeNode"] = Field(default_factory=list)


class MemoryTreeResponse(BaseModel):
    tree: MemoryTreeNode


class ProfileProposalResponse(BaseModel):
    id: str
    page_id: str | None = None
    proposed_page_id: str
    path: str
    title: str
    kind: str
    namespace: str
    status: str
    rationale: str | None = None
    markdown_source: str
    frontmatter: dict[str, Any] = Field(default_factory=dict)
    body_md: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None


class MemorySuggestionResponse(BaseModel):
    id: str
    surface: str
    suggestion_type: str
    title: str
    body: str
    weight: float
    entity_type: str
    entity_id: str
    page_id: str | None = None
    status: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


MemoryTreeNode.model_rebuild()
