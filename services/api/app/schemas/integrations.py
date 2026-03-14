from datetime import datetime
from typing import Literal

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


class CodexBridgeContractResponse(BaseModel):
    provider_name: str
    summary: str
    feature_flag_key: str
    supported_adapter_kinds: list[str] = Field(default_factory=list)
    configured_adapter_kind: str | None = None
    supported_auth: list[str] = Field(default_factory=list)
    supported_capabilities: list[str] = Field(default_factory=list)
    unsupported_capabilities: list[str] = Field(default_factory=list)
    required_config: list[str] = Field(default_factory=list)
    optional_config: list[str] = Field(default_factory=list)
    native_oauth_supported: bool = False
    safe_fallback: str
    configured: bool = False
    enabled: bool = False
    execute_enabled: bool = False
    missing_requirements: list[str] = Field(default_factory=list)
    derived_endpoints: dict[str, str] = Field(default_factory=dict)


# Canonical v2 targets:
# - mobile_bridge
# - desktop_bridge
# - api
# Legacy values remain accepted for backward compatibility and are normalized server-side.
ExecutionTarget = Literal[
    "mobile_bridge",
    "desktop_bridge",
    "api",
    "on_device",
    "server_local",
    "batch_local_bridge",
    "codex_bridge",
    "api_fallback",
]


class ExecutionPolicyRequest(BaseModel):
    llm: list[ExecutionTarget] = Field(default_factory=list)
    stt: list[ExecutionTarget] = Field(default_factory=list)
    tts: list[ExecutionTarget] = Field(default_factory=list)
    ocr: list[ExecutionTarget] = Field(default_factory=list)


class ExecutionPolicyResponse(ExecutionPolicyRequest):
    version: int = 1
    available_targets: dict[str, list[ExecutionTarget]] = Field(default_factory=dict)
    resolved_routes: dict[str, dict] = Field(default_factory=dict)
    updated_at: datetime | None = None
