from sqlite3 import Connection

from fastapi import APIRouter, Depends, status

from app.api.deps import get_db, require_user_id
from app.schemas.importing import (
    ExportImportRequest,
    ExportImportResponse,
    MarkdownImportRequest,
    MarkdownImportResponse,
)
from app.services import import_service

router = APIRouter(prefix="/import")


@router.post("/markdown", response_model=MarkdownImportResponse, status_code=status.HTTP_201_CREATED)
def import_markdown(
    payload: MarkdownImportRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MarkdownImportResponse:
    imported = import_service.import_markdown_note(db, payload.title, payload.markdown)
    return MarkdownImportResponse.model_validate(imported)


@router.post("/export", response_model=ExportImportResponse, status_code=status.HTTP_201_CREATED)
def import_export_payload(
    payload: ExportImportRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ExportImportResponse:
    restored = import_service.restore_export(
        db,
        export_payload=payload.export_payload.model_dump(),
        replace_existing=payload.replace_existing,
    )
    return ExportImportResponse.model_validate(restored)
