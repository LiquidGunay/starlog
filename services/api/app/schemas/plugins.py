from datetime import datetime

from pydantic import BaseModel, Field


class PluginRegisterRequest(BaseModel):
    name: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    capabilities: list[str] = Field(default_factory=list)
    manifest: dict = Field(default_factory=dict)


class PluginResponse(BaseModel):
    id: str
    name: str
    version: str
    capabilities: list[str] = Field(default_factory=list)
    manifest: dict = Field(default_factory=dict)
    enabled: bool
    created_at: datetime
    updated_at: datetime
