import json
import asyncio
from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.api.deps import get_db, require_user_id
from app.schemas.assistant import (
    AssistantCreateMessageRequest,
    AssistantCreateMessageResponse,
    AssistantCreateThreadResponse,
    AssistantDeltaListResponse,
    AssistantInterruptSubmitRequest,
    AssistantRun,
    AssistantSurfaceEventCreateRequest,
    AssistantThreadSnapshot,
    AssistantThreadSummary,
)
from app.services import assistant_event_service, assistant_interrupt_service, assistant_run_service, assistant_thread_service

router = APIRouter(prefix="/assistant")


@router.get("/threads", response_model=list[AssistantThreadSummary])
def list_threads(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[AssistantThreadSummary]:
    threads = assistant_thread_service.list_threads(db)
    return [AssistantThreadSummary.model_validate(item) for item in threads]


@router.post("/threads", response_model=AssistantCreateThreadResponse, status_code=status.HTTP_201_CREATED)
def create_thread(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantCreateThreadResponse:
    thread = assistant_thread_service.create_thread(db, title="Assistant thread")
    payload = {
        "id": thread["id"],
        "slug": thread["slug"],
        "title": thread["title"],
        "mode": thread["mode"],
        "created_at": thread["created_at"],
        "updated_at": thread["updated_at"],
        "last_message_at": None,
        "last_preview_text": None,
    }
    return AssistantCreateThreadResponse.model_validate(payload)


@router.get("/threads/{thread_id}", response_model=AssistantThreadSnapshot)
def get_thread(
    thread_id: str,
    message_limit: int = Query(default=120, ge=1, le=200),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantThreadSnapshot:
    try:
        thread = assistant_thread_service.get_thread_snapshot(db, thread_id, message_limit=message_limit)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AssistantThreadSnapshot.model_validate(thread)


@router.post("/threads/{thread_id}/messages", response_model=AssistantCreateMessageResponse, status_code=status.HTTP_201_CREATED)
def create_message_and_start_run(
    thread_id: str,
    payload: AssistantCreateMessageRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantCreateMessageResponse:
    try:
        result = assistant_run_service.start_run(
            db,
            thread_id=thread_id,
            content=payload.content,
            input_mode=payload.input_mode,
            device_target=payload.device_target,
            metadata=payload.metadata,
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AssistantCreateMessageResponse.model_validate(result)


@router.get("/threads/{thread_id}/runs/{run_id}", response_model=AssistantRun)
def get_run(
    thread_id: str,
    run_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantRun:
    try:
        run = assistant_run_service.get_run(db, thread_id=thread_id, run_id=run_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AssistantRun.model_validate(run)


@router.post("/runs/{run_id}/cancel", response_model=AssistantRun)
def cancel_run(
    run_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantRun:
    try:
        run = assistant_run_service.cancel_run(db, run_id=run_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AssistantRun.model_validate(run)


@router.post("/interrupts/{interrupt_id}/submit", response_model=AssistantThreadSnapshot)
def submit_interrupt(
    interrupt_id: str,
    payload: AssistantInterruptSubmitRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantThreadSnapshot:
    try:
        snapshot = assistant_interrupt_service.submit_interrupt(db, interrupt_id=interrupt_id, values=payload.values)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AssistantThreadSnapshot.model_validate(snapshot)


@router.post("/interrupts/{interrupt_id}/dismiss", response_model=AssistantThreadSnapshot)
def dismiss_interrupt(
    interrupt_id: str,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantThreadSnapshot:
    try:
        snapshot = assistant_interrupt_service.dismiss_interrupt(db, interrupt_id=interrupt_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AssistantThreadSnapshot.model_validate(snapshot)


@router.post("/threads/{thread_id}/events", response_model=AssistantThreadSnapshot, status_code=status.HTTP_201_CREATED)
def create_surface_event(
    thread_id: str,
    payload: AssistantSurfaceEventCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantThreadSnapshot:
    try:
        snapshot = assistant_event_service.create_surface_event(
            db,
            thread_id=thread_id,
            source_surface=payload.source_surface,
            kind=payload.kind,
            entity_ref=payload.entity_ref.model_dump(mode="json") if payload.entity_ref else None,
            payload=payload.payload,
            visibility=payload.visibility,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AssistantThreadSnapshot.model_validate(snapshot)


@router.get("/threads/{thread_id}/updates", response_model=AssistantDeltaListResponse)
def list_updates(
    thread_id: str,
    cursor: str | None = Query(default=None),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantDeltaListResponse:
    try:
        delta_list = assistant_thread_service.list_deltas(db, thread_id, cursor=cursor)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AssistantDeltaListResponse.model_validate(delta_list)


@router.get("/threads/{thread_id}/stream")
async def stream_updates(
    thread_id: str,
    request: Request,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> StreamingResponse:
    try:
        assistant_thread_service.get_thread(db, thread_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    async def _iter() -> str:
        cursor: str | None = None
        while True:
            if await request.is_disconnected():
                break
            delta_list = assistant_thread_service.list_deltas(db, thread_id, cursor=cursor)
            if delta_list["deltas"]:
                cursor = delta_list.get("cursor")
                for delta in delta_list["deltas"]:
                    yield f"event: {delta['event_type']}\n"
                    yield f"data: {json.dumps(delta, sort_keys=True)}\n\n"
            else:
                cursor = delta_list.get("cursor") or cursor
                yield ": keep-alive\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(_iter(), media_type="text/event-stream")
