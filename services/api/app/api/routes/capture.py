from sqlite3 import Connection

from fastapi import APIRouter, Depends, status

from app.api.deps import get_db, require_user_id
from app.schemas.artifacts import ArtifactResponse
from app.schemas.capture import CaptureRequest, CaptureResponse
from app.services import capture_service

router = APIRouter(prefix="/capture")


@router.post("", response_model=CaptureResponse, status_code=status.HTTP_201_CREATED)
def capture(
    payload: CaptureRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CaptureResponse:
    artifact = capture_service.ingest_capture(
        db,
        source_type=payload.source_type,
        capture_source=payload.capture_source,
        title=payload.title,
        source_url=payload.source_url,
        raw=payload.raw.model_dump() if payload.raw else None,
        normalized=payload.normalized.model_dump() if payload.normalized else None,
        extracted=payload.extracted.model_dump() if payload.extracted else None,
        tags=payload.tags,
        metadata=payload.metadata,
    )
    return CaptureResponse(artifact=ArtifactResponse.model_validate(artifact))
