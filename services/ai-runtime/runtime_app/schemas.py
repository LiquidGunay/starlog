from typing import Any

from pydantic import BaseModel, Field


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
