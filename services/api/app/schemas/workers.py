from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


WorkerClass = Literal["mobile_bridge", "desktop_bridge"]
WorkerCapability = Literal["llm_summary", "llm_cards", "llm_tasks", "llm_agent_plan", "stt", "tts", "ocr"]


class WorkerPairingStartRequest(BaseModel):
    expires_in_minutes: int = Field(default=15, ge=1, le=60)


class WorkerPairingStartResponse(BaseModel):
    pairing_token: str
    expires_at: datetime


class WorkerPairingCompleteRequest(BaseModel):
    pairing_token: str = Field(..., min_length=12)
    worker_id: str = Field(..., min_length=3)
    worker_label: str = Field(..., min_length=1)
    worker_class: WorkerClass
    capabilities: list[WorkerCapability] = Field(default_factory=list)


class WorkerAuthResponse(BaseModel):
    worker_id: str
    worker_label: str
    worker_class: WorkerClass
    capabilities: list[WorkerCapability] = Field(default_factory=list)
    access_token: str
    refresh_token: str
    access_expires_at: datetime
    refresh_expires_at: datetime


class WorkerRefreshRequest(BaseModel):
    worker_id: str = Field(..., min_length=3)
    refresh_token: str = Field(..., min_length=12)


class WorkerRefreshResponse(BaseModel):
    worker_id: str
    access_token: str
    access_expires_at: datetime


class WorkerHeartbeatRequest(BaseModel):
    worker_id: str = Field(..., min_length=3)
    capabilities: list[WorkerCapability] = Field(default_factory=list)


class WorkerHeartbeatResponse(BaseModel):
    worker_id: str
    worker_class: WorkerClass
    capabilities: list[WorkerCapability] = Field(default_factory=list)
    last_seen_at: datetime


class WorkerSessionResponse(BaseModel):
    worker_id: str
    worker_label: str
    worker_class: WorkerClass
    capabilities: list[WorkerCapability] = Field(default_factory=list)
    last_seen_at: datetime | None = None
    access_expires_at: datetime
    refresh_expires_at: datetime
    revoked_at: datetime | None = None
    revocation_reason: str | None = None
    online: bool


class WorkerRevokeRequest(BaseModel):
    reason: str | None = None

