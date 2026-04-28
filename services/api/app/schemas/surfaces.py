from datetime import datetime

from pydantic import BaseModel, Field


class CountBucket(BaseModel):
    key: str
    label: str
    count: int


class SuggestedActionSummary(BaseModel):
    action: str
    label: str
    count: int


class SurfaceArtifactSummary(BaseModel):
    id: str
    title: str | None = None
    source_type: str
    created_at: datetime
    updated_at: datetime
    summary_count: int = 0
    card_count: int = 0
    task_count: int = 0
    note_count: int = 0


class SurfaceNoteSummary(BaseModel):
    total: int
    recent_count: int
    latest_updated_at: datetime | None = None


class LibrarySurfaceSummary(BaseModel):
    status_buckets: list[CountBucket]
    source_breakdown: list[CountBucket]
    recent_artifacts: list[SurfaceArtifactSummary]
    notes: SurfaceNoteSummary
    suggested_actions: list[SuggestedActionSummary]
    generated_at: datetime


class PlannerSurfaceSummary(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    task_buckets: list[CountBucket]
    block_buckets: list[CountBucket]
    calendar_event_count: int
    conflict_count: int
    focus_minutes: int
    buffer_minutes: int
    generated_at: datetime


class ReviewQueueHealth(BaseModel):
    due_count: int
    overdue_count: int
    due_soon_count: int
    suspended_count: int
    reviewed_today_count: int
    last_reviewed_at: datetime | None = None
    average_latency_ms: int | None = None


class ReviewSurfaceSummary(BaseModel):
    ladder_counts: list[CountBucket]
    total_ladder_counts: list[CountBucket]
    deck_buckets: list[CountBucket]
    queue_health: ReviewQueueHealth
    generated_at: datetime


class AssistantOpenLoopSummary(BaseModel):
    key: str
    label: str
    count: int
    href: str | None = None


class AssistantTodaySummary(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    thread_id: str | None = None
    active_run_count: int
    open_interrupt_count: int
    recent_surface_event_count: int
    open_loops: list[AssistantOpenLoopSummary]
    generated_at: datetime
