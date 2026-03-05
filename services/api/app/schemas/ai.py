from typing import Literal

from pydantic import BaseModel, Field

Capability = Literal["llm_summary", "llm_cards", "llm_tasks", "stt", "tts", "ocr"]


class AIRequest(BaseModel):
    capability: Capability
    input: dict = Field(default_factory=dict)
    prefer_local: bool = True


class AIResponse(BaseModel):
    capability: Capability
    provider_used: str
    status: Literal["ok", "fallback", "failed"]
    output: dict = Field(default_factory=dict)
