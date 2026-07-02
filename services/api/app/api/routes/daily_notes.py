from datetime import date
from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.daily_notes import DailyNoteResponse, DailyNoteUpsertRequest
from app.services import daily_notes_service

router = APIRouter(prefix="/daily-notes")


@router.get("", response_model=list[DailyNoteResponse])
def list_daily_notes(
    limit: int = Query(default=30, ge=1, le=365),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[DailyNoteResponse]:
    return [DailyNoteResponse.model_validate(item) for item in daily_notes_service.list_daily_notes(db, limit=limit)]


@router.get("/{entry_date}", response_model=DailyNoteResponse)
def get_daily_note(
    entry_date: date,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> DailyNoteResponse:
    daily_note = daily_notes_service.get_daily_note(db, entry_date)
    if daily_note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Daily note not found")
    return DailyNoteResponse.model_validate(daily_note)


@router.put("/{entry_date}", response_model=DailyNoteResponse)
def upsert_daily_note(
    entry_date: date,
    payload: DailyNoteUpsertRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> DailyNoteResponse:
    daily_note = daily_notes_service.upsert_daily_note(
        db,
        entry_date=entry_date,
        morning_plan_md=payload.morning_plan_md,
        evening_reflection_md=payload.evening_reflection_md,
    )
    return DailyNoteResponse.model_validate(daily_note)
