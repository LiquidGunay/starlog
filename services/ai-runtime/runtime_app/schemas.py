from typing import Any, Literal

from pydantic import BaseModel, Field

RuntimeCapability = Literal["llm_summary", "llm_cards", "llm_tasks", "llm_agent_plan"]


class WorkflowPreviewRequest(BaseModel):
    title: str | None = None
    text: str = ""
    context: dict[str, Any] = Field(default_factory=dict)


class WorkflowPreviewResponse(BaseModel):
    workflow: str
    model: str
    system_prompt: str
    user_prompt: str
    context: dict[str, Any] = Field(default_factory=dict)


class ChatTurnExecutionRequest(BaseModel):
    title: str | None = None
    text: str = ""
    context: dict[str, Any] = Field(default_factory=dict)


class ChatTurnExecutionResponse(BaseModel):
    workflow: Literal["chat_turn"] = "chat_turn"
    provider_used: str
    model: str
    system_prompt: str
    user_prompt: str
    response_text: str
    cards: list[dict[str, Any]] = Field(default_factory=list)
    session_state: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CapabilityExecutionRequest(BaseModel):
    capability: RuntimeCapability
    payload: dict[str, Any] = Field(default_factory=dict)
    prefer_local: bool = True


class CapabilityExecutionResponse(BaseModel):
    capability: RuntimeCapability
    provider_used: str
    model: str
    system_prompt: str
    user_prompt: str
    output: dict[str, Any] = Field(default_factory=dict)
