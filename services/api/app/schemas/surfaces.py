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


class ReviewLearningInsight(BaseModel):
    key: str
    title: str
    body: str
    mode: str | None = None
    ladder_stage: str | None = None
    count: int
    severity: str
    href: str | None = None
    prompt: str | None = None


class ReviewRecommendedDrill(BaseModel):
    mode: str
    title: str
    body: str
    prompt: str | None = None
    reason: str
    enabled: bool


class ReviewSurfaceSummary(BaseModel):
    ladder_counts: list[CountBucket]
    total_ladder_counts: list[CountBucket]
    deck_buckets: list[CountBucket]
    queue_health: ReviewQueueHealth
    learning_insights: list[ReviewLearningInsight] = Field(default_factory=list)
    recommended_drill: ReviewRecommendedDrill | None = None
    generated_at: datetime


class AssistantOpenLoopSummary(BaseModel):
    key: str
    label: str
    count: int
    href: str | None = None


class AssistantRecommendedNextMove(BaseModel):
    key: str
    title: str
    body: str
    surface: str
    href: str | None = None
    action_label: str | None = None
    prompt: str | None = None
    priority: int
    urgency: str


class AssistantQuickAction(BaseModel):
    key: str
    title: str
    surface: str
    href: str | None = None
    action_label: str | None = None
    prompt: str | None = None
    enabled: bool
    count: int
    reason: str | None = None
    priority: int


class AssistantWeeklyProgressSummary(BaseModel):
    tasks_completed: int
    review_session_count: int
    review_item_count: int
    captures_created: int
    captures_processed: int
    captures_summarized: int
    cards_created: int
    artifact_tasks_created: int
    goals_updated: int
    goals_reviewed: int
    projects_updated: int
    projects_reviewed: int


class AssistantWeeklySlippageSummary(BaseModel):
    overdue_tasks: int
    overdue_commitments: int
    unprocessed_captures: int
    due_review_cards: int
    stale_active_projects: int
    stale_active_goals: int
    projects_missing_next_action: int


class AssistantWeeklyAdaptationOption(BaseModel):
    key: str
    title: str
    body: str
    surface: str
    href: str | None = None
    prompt: str | None = None
    enabled: bool
    priority: int


class AssistantWeeklyAttentionItem(BaseModel):
    key: str
    kind: str
    title: str
    body: str
    surface: str
    href: str | None = None
    priority: int
    count: int


class AssistantWeeklySystemHealth(BaseModel):
    progress_signal_count: int
    slippage_signal_count: int


class AssistantWeeklySummary(BaseModel):
    week_start: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    week_end: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    generated_at: datetime
    progress: AssistantWeeklyProgressSummary
    slippage: AssistantWeeklySlippageSummary
    adaptation_options: list[AssistantWeeklyAdaptationOption]
    attention_items: list[AssistantWeeklyAttentionItem]
    system_health: AssistantWeeklySystemHealth


class AssistantStrategicGoalSummary(BaseModel):
    id: str
    title: str
    horizon: str
    review_cadence: str
    updated_at: datetime
    last_reviewed_at: datetime | None = None


class AssistantStrategicProjectSummary(BaseModel):
    id: str
    goal_id: str | None = None
    title: str
    next_action_id: str | None = None
    updated_at: datetime
    last_reviewed_at: datetime | None = None


class AssistantStrategicCommitmentSummary(BaseModel):
    id: str
    source_type: str
    source_id: str | None = None
    title: str
    promised_to: str | None = None
    due_at: datetime | None = None
    updated_at: datetime


class AssistantStrategicAttentionItem(BaseModel):
    key: str
    kind: str
    title: str
    body: str
    entity_type: str
    entity_id: str
    surface: str
    href: str | None = None
    priority: int
    due_at: datetime | None = None


class AssistantStrategicContextSummary(BaseModel):
    active_goal_count: int
    active_project_count: int
    open_commitment_count: int
    overdue_commitment_count: int
    project_missing_next_action_count: int
    attention_count: int
    active_goals: list[AssistantStrategicGoalSummary]
    active_projects: list[AssistantStrategicProjectSummary]
    open_commitments: list[AssistantStrategicCommitmentSummary]
    attention_items: list[AssistantStrategicAttentionItem]


class AssistantTodaySummary(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    thread_id: str | None = None
    active_run_count: int
    open_interrupt_count: int
    recent_surface_event_count: int
    open_loops: list[AssistantOpenLoopSummary]
    recommended_next_move: AssistantRecommendedNextMove
    reason_stack: list[str]
    at_a_glance: list[AssistantOpenLoopSummary]
    quick_actions: list[AssistantQuickAction]
    strategic_context: AssistantStrategicContextSummary | None = None
    generated_at: datetime
