from sqlite3 import Connection

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.deps import get_db, require_user_id
from app.schemas.artifacts import ArtifactResponse
from app.schemas.capture import CaptureRequest, CaptureResponse, VoiceCaptureResponse
from app.services import assistant_event_service, capture_service, media_service

router = APIRouter(prefix="/capture")


@router.post("", response_model=CaptureResponse, status_code=status.HTTP_201_CREATED)
def capture(
    payload: CaptureRequest,
    user_id: str = Depends(require_user_id),
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
    try:
        assistant_event_service.reflect_capture_created(db, artifact=artifact, user_id=user_id)
    except Exception:
        # Capture is primary; assistant reflection should not block ingestion.
        pass
    return CaptureResponse(artifact=ArtifactResponse.model_validate(artifact))


@router.post("/voice", response_model=VoiceCaptureResponse, status_code=status.HTTP_201_CREATED)
def capture_voice(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    source_url: str | None = Form(default=None),
    duration_ms: int | None = Form(default=None),
    provider_hint: str | None = Form(default=None),
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> VoiceCaptureResponse:
    payload = file.file.read()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded voice note is empty")
    media = media_service.create_media_asset(
        db,
        source_filename=file.filename,
        content_type=file.content_type,
        payload=payload,
    )
    artifact, job_id = capture_service.ingest_voice_capture(
        db,
        title=title,
        source_url=source_url,
        blob_ref=str(media["blob_ref"]),
        mime_type=media.get("content_type"),
        checksum_sha256=str(media["checksum_sha256"]),
        duration_ms=duration_ms,
        provider_hint=provider_hint,
        user_id=user_id,
    )
    try:
        assistant_event_service.reflect_capture_created(db, artifact=artifact, user_id=user_id)
    except Exception:
        # Voice capture is primary; assistant reflection should not block ingestion.
        pass
    return VoiceCaptureResponse(
        artifact=ArtifactResponse.model_validate(artifact),
        job_id=job_id,
    )
