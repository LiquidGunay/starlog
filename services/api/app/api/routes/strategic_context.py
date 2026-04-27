from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.strategic_context import (
    CommitmentCreateRequest,
    CommitmentResponse,
    CommitmentUpdateRequest,
    GoalCreateRequest,
    GoalResponse,
    GoalUpdateRequest,
    ProjectCreateRequest,
    ProjectResponse,
    ProjectUpdateRequest,
)
from app.services import strategic_context_service

router = APIRouter()


def _validation_error(exc: strategic_context_service.StrategicContextValidationError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/goals", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(
    payload: GoalCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> GoalResponse:
    goal = strategic_context_service.create_goal(
        db,
        title=payload.title,
        horizon=payload.horizon,
        why=payload.why,
        success_criteria=payload.success_criteria,
        status=payload.status,
        review_cadence=payload.review_cadence,
    )
    return GoalResponse.model_validate(goal)


@router.get("/goals", response_model=list[GoalResponse])
def list_goals(
    status_filter: str | None = Query(default=None, alias="status"),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[GoalResponse]:
    goals = strategic_context_service.list_goals(db, status=status_filter)
    return [GoalResponse.model_validate(goal) for goal in goals]


@router.patch("/goals/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: str,
    payload: GoalUpdateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> GoalResponse:
    try:
        updated = strategic_context_service.update_goal(
            goal_id=goal_id,
            conn=db,
            changes=payload.model_dump(exclude_unset=True),
        )
    except strategic_context_service.StrategicContextValidationError as exc:
        raise _validation_error(exc) from exc
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return GoalResponse.model_validate(updated)


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ProjectResponse:
    try:
        project = strategic_context_service.create_project(
            db,
            goal_id=payload.goal_id,
            title=payload.title,
            desired_outcome=payload.desired_outcome,
            current_state=payload.current_state,
            next_action_id=payload.next_action_id,
            open_questions=payload.open_questions,
            risks=payload.risks,
            status=payload.status,
        )
    except strategic_context_service.StrategicContextValidationError as exc:
        raise _validation_error(exc) from exc
    return ProjectResponse.model_validate(project)


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(
    status_filter: str | None = Query(default=None, alias="status"),
    goal_id: str | None = None,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[ProjectResponse]:
    projects = strategic_context_service.list_projects(db, status=status_filter, goal_id=goal_id)
    return [ProjectResponse.model_validate(project) for project in projects]


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: str,
    payload: ProjectUpdateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ProjectResponse:
    try:
        updated = strategic_context_service.update_project(
            conn=db,
            project_id=project_id,
            changes=payload.model_dump(exclude_unset=True),
        )
    except strategic_context_service.StrategicContextValidationError as exc:
        raise _validation_error(exc) from exc
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return ProjectResponse.model_validate(updated)


@router.post("/commitments", response_model=CommitmentResponse, status_code=status.HTTP_201_CREATED)
def create_commitment(
    payload: CommitmentCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CommitmentResponse:
    commitment = strategic_context_service.create_commitment(
        db,
        source_type=payload.source_type,
        source_id=payload.source_id,
        title=payload.title,
        promised_to=payload.promised_to,
        due_at=payload.due_at,
        status=payload.status,
        recovery_plan=payload.recovery_plan,
    )
    return CommitmentResponse.model_validate(commitment)


@router.get("/commitments", response_model=list[CommitmentResponse])
def list_commitments(
    status_filter: str | None = Query(default=None, alias="status"),
    source_type: str | None = None,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[CommitmentResponse]:
    commitments = strategic_context_service.list_commitments(db, status=status_filter, source_type=source_type)
    return [CommitmentResponse.model_validate(commitment) for commitment in commitments]


@router.patch("/commitments/{commitment_id}", response_model=CommitmentResponse)
def update_commitment(
    commitment_id: str,
    payload: CommitmentUpdateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> CommitmentResponse:
    try:
        updated = strategic_context_service.update_commitment(
            conn=db,
            commitment_id=commitment_id,
            changes=payload.model_dump(exclude_unset=True),
        )
    except strategic_context_service.StrategicContextValidationError as exc:
        raise _validation_error(exc) from exc
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commitment not found")
    return CommitmentResponse.model_validate(updated)
