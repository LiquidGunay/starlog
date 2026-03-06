from datetime import datetime

from pydantic import BaseModel, Field


class ProviderConfigRequest(BaseModel):
    enabled: bool = True
    mode: str = Field(default="local_first", min_length=1)
    config: dict = Field(default_factory=dict)


class ProviderConfigResponse(BaseModel):
    provider_name: str
    enabled: bool
    mode: str
    config: dict = Field(default_factory=dict)
    updated_at: datetime


class ProviderHealthResponse(BaseModel):
    provider_name: str
    healthy: bool
    detail: str
    checks: dict[str, bool] = Field(default_factory=dict)
    secure_storage: str = "fallback_insecure"
    probe: dict[str, str] = Field(default_factory=dict)
    auth_probe: dict[str, str] = Field(default_factory=dict)
