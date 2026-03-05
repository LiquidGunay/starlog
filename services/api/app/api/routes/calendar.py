from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_db, require_user_id
from app.schemas.calendar import (
    CalendarEventCreateRequest,
    CalendarEventResponse,
    CalendarEventUpdateRequest,
)
from app.schemas.google_sync import (
    CalendarConflictResponse,
    GoogleOAuthCallbackRequest,
    GoogleOAuthCallbackResponse,
    GoogleOAuthStatusResponse,
    GoogleOAuthStartRequest,
    GoogleOAuthStartResponse,
    GoogleRemoteEventCreateRequest,
    GoogleRemoteEventResponse,
    GoogleSyncRunResponse,
)
from app.services import calendar_service
from app.services import google_calendar_service

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


@router.post("/sync/google/oauth/start", response_model=GoogleOAuthStartResponse)
def google_oauth_start(
    payload: GoogleOAuthStartRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> GoogleOAuthStartResponse:
    auth_url, state = google_calendar_service.oauth_start(db, payload.redirect_uri)
    return GoogleOAuthStartResponse(auth_url=auth_url, state=state)


@router.post("/sync/google/oauth/callback", response_model=GoogleOAuthCallbackResponse)
def google_oauth_callback(
    payload: GoogleOAuthCallbackRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> GoogleOAuthCallbackResponse:
    connected, detail = google_calendar_service.oauth_callback(db, payload.code, payload.state)
    return GoogleOAuthCallbackResponse(connected=connected, detail=detail)


@router.get("/sync/google/oauth/status", response_model=GoogleOAuthStatusResponse)
def google_oauth_status(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> GoogleOAuthStatusResponse:
    status_payload = google_calendar_service.oauth_status(db)
    return GoogleOAuthStatusResponse.model_validate(status_payload)


@router.post("/sync/google/run", response_model=GoogleSyncRunResponse)
def run_google_sync(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> GoogleSyncRunResponse:
    result = google_calendar_service.run_two_way_sync(db)
    return GoogleSyncRunResponse.model_validate(result)


@router.post("/sync/google/remote/events", response_model=GoogleRemoteEventResponse, status_code=status.HTTP_201_CREATED)
def upsert_remote_event(
    payload: GoogleRemoteEventCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> GoogleRemoteEventResponse:
    row = google_calendar_service.upsert_remote_event(
        db,
        remote_id=payload.remote_id,
        title=payload.title,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
    )
    return GoogleRemoteEventResponse.model_validate(row)


@router.get("/sync/google/remote/events", response_model=list[GoogleRemoteEventResponse])
def list_remote_events(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[GoogleRemoteEventResponse]:
    rows = google_calendar_service.list_remote_events(db)
    return [GoogleRemoteEventResponse.model_validate(item) for item in rows]


@router.get("/sync/google/conflicts", response_model=list[CalendarConflictResponse])
def list_conflicts(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[CalendarConflictResponse]:
    rows = google_calendar_service.list_conflicts(db)
    return [CalendarConflictResponse.model_validate(item) for item in rows]
