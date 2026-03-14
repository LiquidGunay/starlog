from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_db, require_user_id
from app.schemas.notes import NoteCreateRequest, NoteResponse, NoteUpdateRequest
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


@router.get("/{note_id}", response_model=NoteResponse)
def get_note(
    note_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> NoteResponse:
    note = notes_service.get_note(db, note_id)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return NoteResponse.model_validate(note)


@router.patch("/{note_id}", response_model=NoteResponse)
def update_note(
    note_id: str,
    payload: NoteUpdateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> NoteResponse:
    try:
        updated = notes_service.update_note(db, note_id, payload.model_dump())
    except notes_service.conflict_service.RevisionConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "revision_conflict",
                "conflict": exc.conflict,
            },
        ) from exc
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return NoteResponse.model_validate(updated)
