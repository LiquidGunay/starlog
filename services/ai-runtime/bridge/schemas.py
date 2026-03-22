from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CapabilityInfo(BaseModel):
    status: str
    detail: str
    preferred_backend: str | None = None


class BridgeHealthResponse(BaseModel):
    status: str
    service: str
    base_url: str
    capabilities: dict[str, CapabilityInfo]


class SttRequest(BaseModel):
    audio_path: str | None = None
    provider_hint: str | None = None
    text_hint: str | None = None
    debug_transcript: str | None = None


class SttResponse(BaseModel):
    status: str
    provider: str
    transcript: str
    detail: str


class TtsRequest(BaseModel):
    text: str = Field(min_length=1)
    provider_hint: str | None = None
    output_path: str | None = None
    debug_audio_path: str | None = None


class TtsResponse(BaseModel):
    status: str
    provider: str
    audio_path: str
    detail: str


class ContextResponse(BaseModel):
    status: str
    provider: str
    context: dict[str, Any]
    detail: str
