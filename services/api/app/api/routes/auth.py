from datetime import datetime
from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_db, require_token_hash, require_user_id
from app.schemas.auth import AuthResponse, BootstrapRequest, LoginRequest, LogoutResponse
from app.services import auth_service

router = APIRouter(prefix="/auth")


@router.post("/bootstrap", status_code=status.HTTP_201_CREATED)
def bootstrap(payload: BootstrapRequest, db: Connection = Depends(get_db)) -> dict[str, bool]:
    created = auth_service.bootstrap_user(db, payload.passphrase)
    if not created:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already bootstrapped")
    return {"created": True}


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Connection = Depends(get_db)) -> AuthResponse:
    session = auth_service.login(db, payload.passphrase)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token, expires_at = session
    return AuthResponse(access_token=token, expires_at=datetime.fromisoformat(expires_at))


@router.post("/logout", response_model=LogoutResponse)
def logout(
    _user_id: str = Depends(require_user_id),
    token_hash: str = Depends(require_token_hash),
    db: Connection = Depends(get_db),
) -> LogoutResponse:
    auth_service.logout(db, token_hash)
    return LogoutResponse(success=True)
