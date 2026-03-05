from sqlite3 import Connection

from fastapi import APIRouter, Depends, status

from app.api.deps import get_db, require_user_id
from app.schemas.notes import NoteCreateRequest, NoteResponse
from app.services import notes_service

router = APIRouter(prefix="/notes")


@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: NoteCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> NoteResponse:
    return NoteResponse.model_validate(notes_service.create_note(db, payload.title, payload.body_md))


@router.get("", response_model=list[NoteResponse])
def list_notes(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[NoteResponse]:
    return [NoteResponse.model_validate(item) for item in notes_service.list_notes(db)]
