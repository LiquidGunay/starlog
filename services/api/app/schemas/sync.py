from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SyncMutation(BaseModel):
    id: str = Field(..., min_length=1)
    entity: str = Field(..., min_length=1)
    op: str = Field(..., min_length=1)
    payload: dict = Field(default_factory=dict)
    occurred_at: datetime


class SyncPushRequest(BaseModel):
    client_id: str = Field(..., min_length=1)
    mutations: list[SyncMutation] = Field(default_factory=list)


class SyncPushResponse(BaseModel):
    accepted: int
    rejected: int
    cursor: int


SyncActivityStatus = Literal["queued", "flushed", "failed", "dropped"]


class SyncEvent(BaseModel):
    cursor: int
    client_id: str
    mutation_id: str
    entity: str
    op: str
    payload: dict = Field(default_factory=dict)
    occurred_at: datetime
    server_received_at: datetime


class SyncPullResponse(BaseModel):
    next_cursor: int
    events: list[SyncEvent] = Field(default_factory=list)


class SyncActivityWrite(BaseModel):
    id: str = Field(..., min_length=1)
    mutation_id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    entity: str = Field(..., min_length=1)
    op: str = Field(..., min_length=1)
    method: str = Field(..., min_length=1)
    path: str = Field(..., min_length=1)
    status: SyncActivityStatus
    attempts: int = Field(default=0, ge=0)
    detail: str | None = None
    created_at: datetime
    recorded_at: datetime


class SyncActivityPushRequest(BaseModel):
    client_id: str = Field(..., min_length=1)
    entries: list[SyncActivityWrite] = Field(default_factory=list)


class SyncActivityPushResponse(BaseModel):
    accepted: int


class SyncActivityResponse(BaseModel):
    id: str
    client_id: str
    mutation_id: str
    label: str
    entity: str
    op: str
    method: str
    path: str
    status: SyncActivityStatus
    attempts: int
    detail: str | None = None
    created_at: datetime
    recorded_at: datetime


class SyncActivityListResponse(BaseModel):
    entries: list[SyncActivityResponse] = Field(default_factory=list)
