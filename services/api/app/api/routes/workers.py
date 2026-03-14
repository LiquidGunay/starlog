from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials

from app.api.deps import (
    bearer_scheme,
    get_db,
    require_secure_worker_transport,
    require_user_id,
    require_worker_session,
)
from app.schemas.workers import (
    WorkerAuthResponse,
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
    WorkerPairingCompleteRequest,
    WorkerPairingStartRequest,
    WorkerPairingStartResponse,
    WorkerRefreshRequest,
    WorkerRefreshResponse,
    WorkerRevokeRequest,
    WorkerSessionResponse,
)
from app.services import worker_service

router = APIRouter(prefix="/workers")


@router.post("/pairing/start", response_model=WorkerPairingStartResponse, status_code=status.HTTP_201_CREATED)
def start_worker_pairing(
    payload: WorkerPairingStartRequest,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> WorkerPairingStartResponse:
    pairing = worker_service.create_pairing_token(
        db,
        created_by_user_id=user_id,
        expires_in_minutes=payload.expires_in_minutes,
    )
    return WorkerPairingStartResponse.model_validate(pairing)


@router.post("/pairing/complete", response_model=WorkerAuthResponse)
def complete_worker_pairing(
    payload: WorkerPairingCompleteRequest,
    _secure: None = Depends(require_secure_worker_transport),
    db: Connection = Depends(get_db),
) -> WorkerAuthResponse:
    try:
        completed = worker_service.complete_pairing(
            db,
            pairing_token=payload.pairing_token,
            worker_id=payload.worker_id,
            worker_label=payload.worker_label,
            worker_class=payload.worker_class,
            capabilities=payload.capabilities,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return WorkerAuthResponse.model_validate(completed)


@router.post("/auth/refresh", response_model=WorkerRefreshResponse)
def refresh_worker_access(
    payload: WorkerRefreshRequest,
    _secure: None = Depends(require_secure_worker_transport),
    db: Connection = Depends(get_db),
) -> WorkerRefreshResponse:
    try:
        refreshed = worker_service.refresh_access_token(
            db,
            worker_id=payload.worker_id,
            refresh_token=payload.refresh_token,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return WorkerRefreshResponse.model_validate(refreshed)


@router.post("/heartbeat", response_model=WorkerHeartbeatResponse)
def worker_heartbeat(
    payload: WorkerHeartbeatRequest,
    worker_session: dict = Depends(require_worker_session),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Connection = Depends(get_db),
) -> WorkerHeartbeatResponse:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing worker auth token")
    if payload.worker_id != str(worker_session["worker_id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker identity mismatch")
    try:
        heartbeat = worker_service.heartbeat(
            db,
            worker_id=payload.worker_id,
            access_token=credentials.credentials,
            capabilities=payload.capabilities,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return WorkerHeartbeatResponse.model_validate(heartbeat)


@router.get("", response_model=list[WorkerSessionResponse])
def list_workers(
    include_revoked: bool = Query(default=False),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[WorkerSessionResponse]:
    workers = worker_service.list_workers(db, include_revoked=include_revoked)
    return [WorkerSessionResponse.model_validate(item) for item in workers]


@router.post("/{worker_id}/revoke", response_model=WorkerSessionResponse)
def revoke_worker(
    worker_id: str,
    payload: WorkerRevokeRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> WorkerSessionResponse:
    revoked = worker_service.revoke_worker(db, worker_id=worker_id, reason=payload.reason)
    if revoked is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    return WorkerSessionResponse.model_validate(revoked)
