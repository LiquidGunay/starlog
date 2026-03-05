from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.events import DomainEventResponse, WebhookCreateRequest, WebhookResponse
from app.services import events_service

router = APIRouter()


@router.get("/events", response_model=list[DomainEventResponse])
def list_events(
    cursor: int = Query(default=0, ge=0),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[DomainEventResponse]:
    rows = events_service.list_events(db, cursor)
    return [DomainEventResponse.model_validate(item) for item in rows]


@router.post("/webhooks", response_model=WebhookResponse, status_code=status.HTTP_201_CREATED)
def create_webhook(
    payload: WebhookCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> WebhookResponse:
    created = events_service.create_webhook(db, payload.url, payload.event_type)
    return WebhookResponse.model_validate(created)


@router.get("/webhooks", response_model=list[WebhookResponse])
def list_webhooks(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[WebhookResponse]:
    rows = events_service.list_webhooks(db)
    return [WebhookResponse.model_validate(item) for item in rows]
