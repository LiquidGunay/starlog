from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_db, require_user_id
from app.schemas.calendar import (
    CalendarEventCreateRequest,
    CalendarEventResponse,
    CalendarEventUpdateRequest,
    CalendarSyncResponse,
)
from app.services import calendar_service

router = APIRouter(prefix="/calendar")


@router.post("/events", response_model=CalendarEventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: CalendarEventCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CalendarEventResponse:
    event = calendar_service.create_event(
        db,
        title=payload.title,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        source=payload.source,
        remote_id=payload.remote_id,
        etag=payload.etag,
    )
    return CalendarEventResponse.model_validate(event)


@router.get("/events", response_model=list[CalendarEventResponse])
def list_events(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[CalendarEventResponse]:
    events = calendar_service.list_events(db)
    return [CalendarEventResponse.model_validate(event) for event in events]


@router.patch("/events/{event_id}", response_model=CalendarEventResponse)
def update_event(
    event_id: str,
    payload: CalendarEventUpdateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CalendarEventResponse:
    updated = calendar_service.update_event(db, event_id, payload.model_dump())
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")
    return CalendarEventResponse.model_validate(updated)


@router.post("/sync/google", response_model=CalendarSyncResponse)
def sync_google(
    _user_id: str = Depends(require_user_id),
) -> CalendarSyncResponse:
    return CalendarSyncResponse(
        status="queued",
        detail="Google two-way sync adapter is scaffolded; provider credentials wiring is next.",
    )
