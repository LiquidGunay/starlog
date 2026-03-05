from sqlite3 import Connection

from fastapi import APIRouter, Depends, status

from app.api.deps import get_db, require_user_id
from app.schemas.ops import BackupResponse, MetricsResponse
from app.services import ops_service

router = APIRouter(prefix="/ops")


@router.get("/metrics", response_model=MetricsResponse)
def metrics(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MetricsResponse:
    payload = ops_service.collect_metrics(db)
    return MetricsResponse.model_validate(payload)


@router.post("/backup", response_model=BackupResponse, status_code=status.HTTP_201_CREATED)
def backup(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> BackupResponse:
    payload = ops_service.write_backup_snapshot(db)
    return BackupResponse.model_validate(payload)
