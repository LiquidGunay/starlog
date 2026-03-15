from collections.abc import Iterator
from sqlite3 import Connection

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.core.security import hash_token
from app.db.storage import get_connection
from app.services import auth_service, worker_service

bearer_scheme = HTTPBearer(auto_error=False)


def get_db() -> Iterator[Connection]:
    with get_connection() as conn:
        yield conn


def require_user_id(
    db: Connection = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth token")

    token_hash = hash_token(credentials.credentials)
    user_id = auth_service.get_user_id_from_token_hash(db, token_hash)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token")
    return user_id


def require_token_hash(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth token")
    return hash_token(credentials.credentials)


def _forwarded_proto_scheme(request: Request) -> str | None:
    forwarded_proto = request.headers.get("x-forwarded-proto", "").strip()
    if forwarded_proto:
        first = forwarded_proto.split(",", 1)[0].strip().lower()
        if first in {"http", "https"}:
            return first

    forwarded = request.headers.get("forwarded", "").strip()
    if not forwarded:
        return None
    first_entry = forwarded.split(",", 1)[0]
    for token in first_entry.split(";"):
        key, _, value = token.strip().partition("=")
        if key.lower() != "proto":
            continue
        normalized = value.strip().strip('"').lower()
        if normalized in {"http", "https"}:
            return normalized
    return None


def require_secure_worker_transport(request: Request) -> None:
    settings = get_settings()
    if settings.env == "dev":
        return

    scheme = request.url.scheme.lower()
    if scheme != "https":
        forwarded_scheme = _forwarded_proto_scheme(request)
        if forwarded_scheme:
            scheme = forwarded_scheme
    if scheme == "https":
        return

    hostname = (request.url.hostname or "").lower()
    if hostname in {"localhost", "127.0.0.1", "::1"}:
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Worker endpoints require HTTPS outside local development.",
    )


def require_worker_session(
    db: Connection = Depends(get_db),
    _secure: None = Depends(require_secure_worker_transport),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing worker auth token")
    worker = worker_service.get_worker_by_access_token(db, access_token=credentials.credentials)
    if worker is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired worker token")
    return worker
