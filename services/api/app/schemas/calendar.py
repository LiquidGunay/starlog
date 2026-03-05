from datetime import datetime

from pydantic import BaseModel, Field


class CalendarEventCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    starts_at: datetime
    ends_at: datetime
    source: str = "internal"
    remote_id: str | None = None
    etag: str | None = None


class CalendarEventUpdateRequest(BaseModel):
    title: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    source: str | None = None
    remote_id: str | None = None
    etag: str | None = None


class CalendarEventResponse(BaseModel):
    id: str
    title: str
    starts_at: datetime
    ends_at: datetime
    source: str
    remote_id: str | None = None
    etag: str | None = None


class CalendarSyncResponse(BaseModel):
    status: str
    detail: str
