from datetime import datetime

from pydantic import BaseModel


class MediaAssetResponse(BaseModel):
    id: str
    blob_ref: str
    source_filename: str | None = None
    content_type: str | None = None
    bytes_size: int
    checksum_sha256: str
    content_url: str
    created_at: datetime
