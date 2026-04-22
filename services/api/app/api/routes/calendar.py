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
    CalendarConflictReplayResponse,
    CalendarConflictResolveRequest,
    CalendarConflictResolveResponse,
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
from app.services import assistant_event_service, google_calendar_service
from app.services.common import execute_fetchone

router = APIRouter(prefix="/calendar")


def _reflect_unresolved_conflicts(db: Connection, *, user_id: str) -> None:
    conflicts = google_calendar_service.list_conflicts(db, include_resolved=False)
    for conflict in conflicts:
        if bool(conflict.get("resolved")):
            continue
        assistant_event_service.reflect_planner_conflict_detected(db, conflict=conflict, user_id=user_id)


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
    try:
        updated = calendar_service.update_event(db, event_id, payload.model_dump())
    except calendar_service.conflict_service.RevisionConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "revision_conflict",
                "conflict": exc.conflict,
            },
        ) from exc
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")
    return CalendarEventResponse.model_validate(updated)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> None:
    deleted = calendar_service.delete_event(db, event_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")


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
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> GoogleSyncRunResponse:
    result = google_calendar_service.run_two_way_sync(db)
    try:
        _reflect_unresolved_conflicts(db, user_id=user_id)
    except Exception:
        # Calendar sync is primary; assistant reflection should not block the sync result.
        pass
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
    include_resolved: bool = False,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[CalendarConflictResponse]:
    rows = google_calendar_service.list_conflicts(db, include_resolved=include_resolved)
    return [CalendarConflictResponse.model_validate(item) for item in rows]


@router.post("/sync/google/conflicts/{conflict_id}/resolve", response_model=CalendarConflictResolveResponse)
def resolve_conflict(
    conflict_id: str,
    payload: CalendarConflictResolveRequest,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CalendarConflictResolveResponse:
    existing = execute_fetchone(db, "SELECT resolved FROM calendar_sync_conflicts WHERE id = ?", (conflict_id,))
    was_already_resolved = bool(existing.get("resolved")) if existing is not None else False
    try:
        resolved = google_calendar_service.resolve_conflict(db, conflict_id, payload.resolution_strategy)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if resolved is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync conflict not found")
    if not was_already_resolved:
        try:
            assistant_event_service.reflect_planner_conflict_resolved(
                db,
                conflict=resolved,
                resolution_strategy=payload.resolution_strategy,
                user_id=user_id,
            )
        except Exception:
            # Planner resolution is primary; assistant reflection should not block the resolution path.
            pass
    return CalendarConflictResolveResponse(conflict=CalendarConflictResponse.model_validate(resolved))


@router.post("/sync/google/conflicts/{conflict_id}/replay", response_model=CalendarConflictReplayResponse)
def replay_conflict(
    conflict_id: str,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CalendarConflictReplayResponse:
    replayed = google_calendar_service.replay_conflict(db, conflict_id)
    if replayed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync conflict not found")
    conflict = replayed.get("conflict")
    if isinstance(conflict, dict) and not bool(conflict.get("resolved")):
        try:
            assistant_event_service.reflect_planner_conflict_detected(db, conflict=conflict, user_id=user_id)
        except Exception:
            # Conflict replay is primary; assistant reflection should not block the replay path.
            pass
    elif conflict is None:
        try:
            assistant_event_service.reflect_planner_conflict_cleared(db, conflict_id=conflict_id, user_id=user_id)
        except Exception:
            # Conflict replay is primary; assistant reflection should not block the replay path.
            pass
    return CalendarConflictReplayResponse(
        sync_run=GoogleSyncRunResponse.model_validate(replayed["sync_run"]),
        conflict=CalendarConflictResponse.model_validate(conflict) if isinstance(conflict, dict) else None,
    )
