from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.ai import (
    AIJobClaimRequest,
    AIJobCompleteRequest,
    AIJobCreateRequest,
    AIJobFailRequest,
    AIJobResponse,
    AIRequest,
    AIResponse,
)
from app.services import ai_jobs_service, ai_service

router = APIRouter(prefix="/ai")


@router.post("/run", response_model=AIResponse)
def run_ai(
    payload: AIRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AIResponse:
    provider, status_text, output = ai_service.run(
        conn=db,
        capability=payload.capability,
        payload=payload.input,
        prefer_local=payload.prefer_local,
    )
    return AIResponse(
        capability=payload.capability,
        provider_used=provider,
        status=status_text,
        output=output,
    )


@router.post("/jobs", response_model=AIJobResponse, status_code=status.HTTP_201_CREATED)
def create_ai_job(
    payload: AIJobCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AIJobResponse:
    created = ai_jobs_service.create_job(
        db,
        capability=payload.capability,
        payload=payload.payload,
        provider_hint=payload.provider_hint,
        artifact_id=payload.artifact_id,
        action=payload.action,
    )
    return AIJobResponse.model_validate(created)


@router.get("/jobs", response_model=list[AIJobResponse])
def list_ai_jobs(
    status_text: str | None = Query(default=None, alias="status"),
    provider_hint: str | None = Query(default=None),
    action: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[AIJobResponse]:
    jobs = ai_jobs_service.list_jobs(db, status=status_text, provider_hint=provider_hint, action=action, limit=limit)
    return [AIJobResponse.model_validate(job) for job in jobs]


@router.post("/jobs/{job_id}/claim", response_model=AIJobResponse)
def claim_ai_job(
    job_id: str,
    payload: AIJobClaimRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AIJobResponse:
    claimed = ai_jobs_service.claim_job(db, job_id, worker_id=payload.worker_id)
    if claimed is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is not pending")
    return AIJobResponse.model_validate(claimed)


@router.post("/jobs/{job_id}/complete", response_model=AIJobResponse)
def complete_ai_job(
    job_id: str,
    payload: AIJobCompleteRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AIJobResponse:
    completed = ai_jobs_service.complete_job(
        db,
        job_id,
        worker_id=payload.worker_id,
        provider_used=payload.provider_used,
        output=payload.output,
    )
    if completed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return AIJobResponse.model_validate(completed)


@router.post("/jobs/{job_id}/fail", response_model=AIJobResponse)
def fail_ai_job(
    job_id: str,
    payload: AIJobFailRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AIJobResponse:
    failed = ai_jobs_service.fail_job(
        db,
        job_id,
        worker_id=payload.worker_id,
        error_text=payload.error_text,
        provider_used=payload.provider_used,
    )
    if failed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return AIJobResponse.model_validate(failed)
