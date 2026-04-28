from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db, require_user_id
from app.schemas.surfaces import (
    AssistantTodaySummary,
    AssistantWeeklySummary,
    LibrarySurfaceSummary,
    PlannerSurfaceSummary,
    ReviewSurfaceSummary,
)
from app.services import surface_summary_service

router = APIRouter(prefix="/surfaces")


@router.get("/library/summary", response_model=LibrarySurfaceSummary)
def library_summary(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> LibrarySurfaceSummary:
    return LibrarySurfaceSummary.model_validate(surface_summary_service.library_summary(db))


@router.get("/planner/summary", response_model=PlannerSurfaceSummary)
def planner_summary(
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> PlannerSurfaceSummary:
    return PlannerSurfaceSummary.model_validate(surface_summary_service.planner_summary(db, day_value=date))


@router.get("/review/summary", response_model=ReviewSurfaceSummary)
def review_summary(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ReviewSurfaceSummary:
    return ReviewSurfaceSummary.model_validate(surface_summary_service.review_summary(db))


@router.get("/assistant/today", response_model=AssistantTodaySummary)
def assistant_today(
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantTodaySummary:
    return AssistantTodaySummary.model_validate(
        surface_summary_service.assistant_today_summary(db, user_id=user_id, day_value=date)
    )


@router.get("/assistant/weekly", response_model=AssistantWeeklySummary)
def assistant_weekly(
    week_start: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantWeeklySummary:
    return AssistantWeeklySummary.model_validate(surface_summary_service.assistant_weekly_summary(db, week_start_value=week_start))
