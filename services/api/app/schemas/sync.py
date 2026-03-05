from datetime import datetime

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
