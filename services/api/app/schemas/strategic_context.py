from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

GoalHorizon = Literal["today", "week", "month", "quarter", "long_term"]
StrategicStatus = Literal["active", "paused", "completed", "archived"]
CommitmentStatus = Literal["open", "done", "dropped", "archived"]


class GoalCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    horizon: GoalHorizon = "quarter"
    why: str | None = None
    success_criteria: str | None = None
    status: StrategicStatus = "active"
    review_cadence: str = Field(default="weekly", min_length=1)


class GoalUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    horizon: GoalHorizon | None = None
    why: str | None = None
    success_criteria: str | None = None
    status: StrategicStatus | None = None
    review_cadence: str | None = Field(default=None, min_length=1)
    last_reviewed_at: datetime | None = None


class GoalResponse(BaseModel):
    id: str
    title: str
    horizon: str
    why: str | None = None
    success_criteria: str | None = None
    status: str
    review_cadence: str
    created_at: datetime
    updated_at: datetime
    last_reviewed_at: datetime | None = None


class ProjectCreateRequest(BaseModel):
    goal_id: str | None = None
    title: str = Field(..., min_length=1)
    desired_outcome: str | None = None
    current_state: str | None = None
    next_action_id: str | None = None
    open_questions: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    status: StrategicStatus = "active"


class ProjectUpdateRequest(BaseModel):
    goal_id: str | None = None
    title: str | None = Field(default=None, min_length=1)
    desired_outcome: str | None = None
    current_state: str | None = None
    next_action_id: str | None = None
    open_questions: list[str] | None = None
    risks: list[str] | None = None
    status: StrategicStatus | None = None
    last_reviewed_at: datetime | None = None


class ProjectResponse(BaseModel):
    id: str
    goal_id: str | None = None
    title: str
    desired_outcome: str | None = None
    current_state: str | None = None
    next_action_id: str | None = None
    open_questions: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    status: str
    created_at: datetime
    updated_at: datetime
    last_reviewed_at: datetime | None = None


class CommitmentCreateRequest(BaseModel):
    source_type: str = Field(..., min_length=1)
    source_id: str | None = None
    title: str = Field(..., min_length=1)
    promised_to: str | None = None
    due_at: datetime | None = None
    status: CommitmentStatus = "open"
    recovery_plan: str | None = None


class CommitmentUpdateRequest(BaseModel):
    source_type: str | None = Field(default=None, min_length=1)
    source_id: str | None = None
    title: str | None = Field(default=None, min_length=1)
    promised_to: str | None = None
    due_at: datetime | None = None
    status: CommitmentStatus | None = None
    recovery_plan: str | None = None


class CommitmentResponse(BaseModel):
    id: str
    source_type: str
    source_id: str | None = None
    title: str
    promised_to: str | None = None
    due_at: datetime | None = None
    status: str
    recovery_plan: str | None = None
    created_at: datetime
    updated_at: datetime
