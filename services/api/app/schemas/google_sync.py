from datetime import datetime

from pydantic import BaseModel, Field


class GoogleOAuthStartRequest(BaseModel):
    redirect_uri: str | None = None


class GoogleOAuthStartResponse(BaseModel):
    auth_url: str
    state: str


class GoogleOAuthCallbackRequest(BaseModel):
    code: str = Field(..., min_length=1)
    state: str = Field(..., min_length=1)


class GoogleOAuthCallbackResponse(BaseModel):
    connected: bool
    detail: str


class GoogleOAuthStatusResponse(BaseModel):
    connected: bool
    mode: str | None = None
    source: str | None = None
    expires_at: datetime | None = None
    has_refresh_token: bool = False
    detail: str


class GoogleRemoteEventCreateRequest(BaseModel):
    remote_id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    starts_at: datetime
    ends_at: datetime


class GoogleRemoteEventResponse(BaseModel):
    remote_id: str
    title: str
    starts_at: datetime
    ends_at: datetime
    etag: str
    updated_at: datetime


class GoogleSyncRunResponse(BaseModel):
    pushed: int
    pulled: int
    conflicts: int
    last_synced_at: datetime


class CalendarConflictResponse(BaseModel):
    id: str
    local_event_id: str | None = None
    remote_id: str
    strategy: str
    detail: dict
    created_at: datetime
