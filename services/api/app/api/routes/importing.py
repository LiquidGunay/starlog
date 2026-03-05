from sqlite3 import Connection

from fastapi import APIRouter, Depends, status

from app.api.deps import get_db, require_user_id
from app.schemas.importing import MarkdownImportRequest, MarkdownImportResponse
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
