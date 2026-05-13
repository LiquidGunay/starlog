from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class StudySourceCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    source_type: str = Field(default="artifact", min_length=1)
    artifact_id: str | None = None
    url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class StudySourceResponse(BaseModel):
    id: str
    title: str
    source_type: str
    artifact_id: str | None = None
    url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class StudyTopicCreateRequest(BaseModel):
    source_id: str = Field(..., min_length=1)
    parent_topic_id: str | None = None
    title: str = Field(..., min_length=1)
    summary: str | None = None
    display_order: int = 0


class StudyTopicResponse(BaseModel):
    id: str
    source_id: str
    parent_topic_id: str | None = None
    title: str
    summary: str | None = None
    display_order: int = 0
    status: str = "locked"
    manually_unlocked: bool = False
    unlocked_at: datetime | None = None
    read_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class StudyProgressResponse(BaseModel):
    source_count: int = 0
    topic_count: int = 0
    read_topic_count: int = 0
    unlocked_topic_count: int = 0
    locked_topic_count: int = 0
    due_unlocked_card_count: int = 0


class SourceChunkCreateRequest(BaseModel):
    source_id: str = Field(..., min_length=1)
    topic_id: str | None = None
    artifact_id: str | None = None
    chunk_index: int = Field(..., ge=0)
    content: str = Field(..., min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceChunkResponse(BaseModel):
    id: str
    source_id: str
    topic_id: str | None = None
    artifact_id: str | None = None
    chunk_index: int
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class CardTopicLinkCreateRequest(BaseModel):
    card_id: str = Field(..., min_length=1)
    topic_id: str = Field(..., min_length=1)
    gate_required: bool = True


class CardTopicLinkResponse(BaseModel):
    id: str
    card_id: str
    topic_id: str
    gate_required: bool = True
    created_at: datetime


class PracticeItemCreateRequest(BaseModel):
    source_id: str | None = None
    topic_id: str | None = None
    item_type: str = Field(default="short_answer", min_length=1)
    prompt: str = Field(..., min_length=1)
    answer: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PracticeItemResponse(BaseModel):
    id: str
    source_id: str | None = None
    topic_id: str | None = None
    item_type: str
    prompt: str
    answer: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class PracticeAttemptCreateRequest(BaseModel):
    practice_item_id: str | None = None
    topic_id: str | None = None
    rating: int | None = Field(default=None, ge=0, le=5)
    response_text: str | None = None
    correct: bool | None = None
    latency_ms: int | None = Field(default=None, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PracticeAttemptResponse(BaseModel):
    id: str
    practice_item_id: str | None = None
    topic_id: str | None = None
    rating: int | None = None
    response_text: str | None = None
    correct: bool | None = None
    latency_ms: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    attempted_at: datetime


class StudyQuestionRequestCreateRequest(BaseModel):
    source_id: str | None = None
    topic_id: str | None = None
    question: str = Field(..., min_length=1)
    status: str = Field(default="requested", min_length=1)
    response: dict[str, Any] = Field(default_factory=dict)


class StudyQuestionRequestResponse(BaseModel):
    id: str
    source_id: str | None = None
    topic_id: str | None = None
    question: str
    status: str
    response: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
