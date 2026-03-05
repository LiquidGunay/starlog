from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db, require_user_id
from app.schemas.sync import SyncEvent, SyncPullResponse, SyncPushRequest, SyncPushResponse
from app.services import sync_service

router = APIRouter(prefix="/sync")


@router.post("/push", response_model=SyncPushResponse)
def push_sync(
    payload: SyncPushRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> SyncPushResponse:
    accepted, rejected, cursor = sync_service.push(db, payload.client_id, payload.mutations)
    return SyncPushResponse(accepted=accepted, rejected=rejected, cursor=cursor)


@router.get("/pull", response_model=SyncPullResponse)
def pull_sync(
    cursor: int = Query(default=0, ge=0),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> SyncPullResponse:
    next_cursor, events = sync_service.pull(db, cursor)
    return SyncPullResponse(
        next_cursor=next_cursor,
        events=[SyncEvent.model_validate(event) for event in events],
    )
