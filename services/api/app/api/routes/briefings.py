from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_db, require_user_id
from app.schemas.ai import AIJobResponse
from app.schemas.briefings import (
    AlarmPlanCreateRequest,
    AlarmPlanResponse,
    BriefingAudioRenderRequest,
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


@router.post("/briefings/{briefing_id}/audio/render", response_model=AIJobResponse, status_code=status.HTTP_201_CREATED)
def queue_briefing_audio_render(
    briefing_id: str,
    payload: BriefingAudioRenderRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AIJobResponse:
    try:
        job = briefing_service.queue_briefing_audio_render(db, briefing_id, provider_hint=payload.provider_hint)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AIJobResponse.model_validate(job)


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
