from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ConflictStatus = Literal["open", "resolved"]
ConflictResolutionStrategy = Literal["local_wins", "remote_wins", "merged_patch"]


class ConflictResponse(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    operation: str
    base_revision: int
    current_revision: int
    local_payload: dict = Field(default_factory=dict)
    server_payload: dict = Field(default_factory=dict)
    status: ConflictStatus
    created_at: datetime
    resolved_at: datetime | None = None
    resolution_strategy: ConflictResolutionStrategy | None = None
    resolution_payload: dict | None = None


class ConflictResolveRequest(BaseModel):
    strategy: ConflictResolutionStrategy
    merged_payload: dict | None = None


class ConflictResolveResponse(BaseModel):
    conflict: ConflictResponse

