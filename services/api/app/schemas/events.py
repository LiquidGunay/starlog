from datetime import datetime

from pydantic import BaseModel, Field


class DomainEventResponse(BaseModel):
    id: int
    event_type: str
    payload: dict = Field(default_factory=dict)
    created_at: datetime


class WebhookCreateRequest(BaseModel):
    url: str = Field(..., min_length=1)
    event_type: str = Field(default="*")


class WebhookResponse(BaseModel):
    id: str
    url: str
    event_type: str
    active: bool
    created_at: datetime
