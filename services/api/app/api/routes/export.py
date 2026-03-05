from sqlite3 import Connection

from fastapi import APIRouter, Depends

from app.api.deps import get_db, require_user_id
from app.schemas.export import ExportResponse
from app.services import export_service

router = APIRouter()


@router.get("/export", response_model=ExportResponse)
def export_all(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ExportResponse:
    payload = export_service.build_export(db)
    return ExportResponse.model_validate(payload)
