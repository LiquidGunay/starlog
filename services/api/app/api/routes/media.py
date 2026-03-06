from sqlite3 import Connection

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.api.deps import get_db, require_user_id
from app.schemas.media import MediaAssetResponse
from app.services import media_service

router = APIRouter(prefix="/media")


@router.post("/upload", response_model=MediaAssetResponse, status_code=status.HTTP_201_CREATED)
def upload_media(
    file: UploadFile = File(...),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MediaAssetResponse:
    payload = file.file.read()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
    created = media_service.create_media_asset(
        db,
        source_filename=file.filename,
        content_type=file.content_type,
        payload=payload,
    )
    return MediaAssetResponse.model_validate(created)


@router.get("/{media_id}", response_model=MediaAssetResponse)
def get_media(
    media_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> MediaAssetResponse:
    asset = media_service.get_media_asset(db, media_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")
    return MediaAssetResponse.model_validate(asset)


@router.get("/{media_id}/content")
def get_media_content(
    media_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> FileResponse:
    asset = media_service.get_media_asset(db, media_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media asset not found")
    path = media_service.media_asset_path(asset)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file missing on disk")
    return FileResponse(path, media_type=asset.get("content_type"), filename=asset.get("source_filename"))
