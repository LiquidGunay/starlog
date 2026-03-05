from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_db, require_user_id
from app.schemas.briefings import (
    AlarmPlanCreateRequest,
    AlarmPlanResponse,
    BriefingGenerateRequest,
    BriefingPackageResponse,
)
from app.services import briefing_service

router = APIRouter()


@router.post("/briefings/generate", response_model=BriefingPackageResponse, status_code=status.HTTP_201_CREATED)
def generate_briefing(
    payload: BriefingGenerateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> BriefingPackageResponse:
    briefing = briefing_service.generate_briefing(db, payload.date, payload.provider)
    return BriefingPackageResponse.model_validate(briefing)


@router.get("/briefings/{date}", response_model=BriefingPackageResponse)
def get_briefing(
    date: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> BriefingPackageResponse:
    briefing = briefing_service.get_latest_briefing_for_date(db, date)
    if briefing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Briefing not found")
    return BriefingPackageResponse.model_validate(briefing)


@router.post("/alarms", response_model=AlarmPlanResponse, status_code=status.HTTP_201_CREATED)
def create_alarm(
    payload: AlarmPlanCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AlarmPlanResponse:
    alarm = briefing_service.create_alarm_plan(
        db,
        trigger_at=payload.trigger_at,
        briefing_package_id=payload.briefing_package_id,
        device_target=payload.device_target,
    )
    return AlarmPlanResponse.model_validate(alarm)


@router.get("/alarms", response_model=list[AlarmPlanResponse])
def list_alarms(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[AlarmPlanResponse]:
    alarms = briefing_service.list_alarm_plans(db)
    return [AlarmPlanResponse.model_validate(item) for item in alarms]
