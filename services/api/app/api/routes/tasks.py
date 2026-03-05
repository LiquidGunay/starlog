from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.tasks import TaskCreateRequest, TaskResponse, TaskUpdateRequest
from app.services import tasks_service

router = APIRouter(prefix="/tasks")


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> TaskResponse:
    task = tasks_service.create_task(
        db,
        title=payload.title,
        status=payload.status,
        estimate_min=payload.estimate_min,
        priority=payload.priority,
        due_at=payload.due_at,
        linked_note_id=payload.linked_note_id,
        source_artifact_id=payload.source_artifact_id,
    )
    return TaskResponse.model_validate(task)


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    status_filter: str | None = Query(default=None, alias="status"),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[TaskResponse]:
    tasks = tasks_service.list_tasks(db, status=status_filter)
    return [TaskResponse.model_validate(task) for task in tasks]


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: str,
    payload: TaskUpdateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> TaskResponse:
    updated = tasks_service.update_task(db, task_id, payload.model_dump())
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return TaskResponse.model_validate(updated)
