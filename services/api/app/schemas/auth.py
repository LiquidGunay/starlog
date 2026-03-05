from datetime import datetime

from pydantic import BaseModel, Field


class BootstrapRequest(BaseModel):
    passphrase: str = Field(..., min_length=12)


class LoginRequest(BaseModel):
    passphrase: str = Field(..., min_length=8)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


class LogoutResponse(BaseModel):
    success: bool
