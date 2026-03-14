from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.conflicts import ConflictResolveRequest, ConflictResolveResponse, ConflictResponse
from app.services import conflict_service

router = APIRouter(prefix="/conflicts")


@router.get("", response_model=list[ConflictResponse])
def list_conflicts(
    status_filter: str | None = Query(default=None, alias="status"),
    entity_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[ConflictResponse]:
    rows = conflict_service.list_conflicts(
        db,
        status=status_filter,
        entity_type=entity_type,
        limit=limit,
    )
    return [ConflictResponse.model_validate(item) for item in rows]


@router.get("/{conflict_id}", response_model=ConflictResponse)
def get_conflict(
    conflict_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConflictResponse:
    conflict = conflict_service.get_conflict(db, conflict_id)
    if conflict is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conflict not found")
    return ConflictResponse.model_validate(conflict)


@router.post("/{conflict_id}/resolve", response_model=ConflictResolveResponse)
def resolve_conflict(
    conflict_id: str,
    payload: ConflictResolveRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConflictResolveResponse:
    resolved = conflict_service.resolve_conflict(
        db,
        conflict_id,
        strategy=payload.strategy,
        merged_payload=payload.merged_payload,
    )
    if resolved is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conflict not found")
    return ConflictResolveResponse(conflict=ConflictResponse.model_validate(resolved))
