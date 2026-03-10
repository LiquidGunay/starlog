from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Capability = Literal["llm_summary", "llm_cards", "llm_tasks", "llm_agent_plan", "stt", "tts", "ocr"]


class AIRequest(BaseModel):
    capability: Capability
    input: dict = Field(default_factory=dict)
    prefer_local: bool = True


class AIResponse(BaseModel):
    capability: Capability
    provider_used: str
    status: Literal["ok", "fallback", "failed"]
    output: dict = Field(default_factory=dict)


AIJobStatus = Literal["pending", "running", "completed", "failed", "cancelled"]


class AIJobCreateRequest(BaseModel):
    capability: Capability
    payload: dict = Field(default_factory=dict)
    provider_hint: str | None = None
    artifact_id: str | None = None
    action: str | None = None


class AIJobResponse(BaseModel):
    id: str
    capability: Capability
    status: AIJobStatus
    provider_hint: str | None = None
    provider_used: str | None = None
    artifact_id: str | None = None
    action: str | None = None
    payload: dict = Field(default_factory=dict)
    output: dict = Field(default_factory=dict)
    error_text: str | None = None
    worker_id: str | None = None
    created_at: datetime
    claimed_at: datetime | None = None
    finished_at: datetime | None = None


class AIJobClaimRequest(BaseModel):
    worker_id: str = Field(..., min_length=1)


class AIJobCompleteRequest(BaseModel):
    worker_id: str = Field(..., min_length=1)
    provider_used: str = Field(..., min_length=1)
    output: dict = Field(default_factory=dict)


class AIJobFailRequest(BaseModel):
    worker_id: str = Field(..., min_length=1)
    error_text: str = Field(..., min_length=1)
    provider_used: str | None = None


class AIJobCancelRequest(BaseModel):
    reason: str | None = None


class AIJobRetryRequest(BaseModel):
    provider_hint: str | None = None
