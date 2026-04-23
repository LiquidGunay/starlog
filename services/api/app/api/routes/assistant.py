import json
import asyncio
from sqlite3 import Connection

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse

from app.api.deps import get_db, require_token_hash, require_user_id
from app.db.storage import get_connection
from app.schemas.ai import AIJobResponse
from app.schemas.assistant import (
    AssistantCreateHandoffRequest,
    AssistantCreateHandoffResponse,
    AssistantCreateMessageRequest,
    AssistantCreateMessageResponse,
    AssistantCreateThreadResponse,
    AssistantDeltaListResponse,
    AssistantInterruptSubmitRequest,
    AssistantResolveHandoffResponse,
    AssistantRun,
    AssistantSurfaceEventCreateRequest,
    AssistantThreadSnapshot,
    AssistantThreadSummary,
)
from app.services import (
    assistant_event_service,
    assistant_handoff_service,
    assistant_interrupt_service,
    assistant_run_service,
    assistant_thread_service,
    auth_service,
    media_service,
)

router = APIRouter(prefix="/assistant")


async def _stream_delta_events(
    *,
    thread_id: str,
    user_id: str,
    request: Request,
    cursor: str | None,
    poll_interval_seconds: float = 2.0,
):
    current_cursor = cursor or request.headers.get("last-event-id") or None
    yield "retry: 2000\n\n"
    while True:
        if await request.is_disconnected():
            break
        with get_connection() as conn:
            delta_list = assistant_thread_service.list_deltas(conn, thread_id, cursor=current_cursor, user_id=user_id)
        if delta_list["deltas"]:
            for delta in delta_list["deltas"]:
                yield f"event: {delta['event_type']}\n"
                yield f"data: {json.dumps(delta, sort_keys=True)}\n\n"
            next_cursor = delta_list.get("cursor") or current_cursor
            if next_cursor:
                payload = json.dumps({"cursor": next_cursor}, sort_keys=True)
                yield "event: cursor\n"
                yield f"id: {next_cursor}\n"
                yield f"data: {payload}\n\n"
            current_cursor = next_cursor
        else:
            current_cursor = delta_list.get("cursor") or current_cursor
            yield ": keep-alive\n\n"
        await asyncio.sleep(poll_interval_seconds)


@router.get("/threads", response_model=list[AssistantThreadSummary])
def list_threads(
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> list[AssistantThreadSummary]:
    try:
        threads = assistant_thread_service.list_threads(db, user_id=user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return [AssistantThreadSummary.model_validate(item) for item in threads]


@router.post("/threads", response_model=AssistantCreateThreadResponse, status_code=status.HTTP_201_CREATED)
def create_thread(
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantCreateThreadResponse:
    try:
        thread = assistant_thread_service.create_thread(db, title="Assistant thread", user_id=user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
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
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantThreadSnapshot:
    try:
        thread = assistant_thread_service.get_thread_snapshot(db, thread_id, message_limit=message_limit, user_id=user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AssistantThreadSnapshot.model_validate(thread)


@router.post("/threads/{thread_id}/messages", response_model=AssistantCreateMessageResponse, status_code=status.HTTP_201_CREATED)
def create_message_and_start_run(
    thread_id: str,
    payload: AssistantCreateMessageRequest,
    user_id: str = Depends(require_user_id),
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
            user_id=user_id,
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AssistantCreateMessageResponse.model_validate(result)


@router.post("/handoffs", response_model=AssistantCreateHandoffResponse, status_code=status.HTTP_201_CREATED)
def create_handoff(
    payload: AssistantCreateHandoffRequest,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantCreateHandoffResponse:
    try:
        handoff = assistant_handoff_service.issue_handoff(
            db,
            user_id=user_id,
            source=payload.source_surface,
            draft=payload.draft,
            artifact_id=payload.artifact_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AssistantCreateHandoffResponse.model_validate(handoff)


@router.get("/handoffs/resolve", response_model=AssistantResolveHandoffResponse)
def resolve_handoff(
    token: str = Query(..., min_length=1),
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantResolveHandoffResponse:
    try:
        handoff = assistant_handoff_service.resolve_handoff(db, token=token, user_id=user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AssistantResolveHandoffResponse.model_validate({"handoff": handoff})


@router.post("/threads/{thread_id}/voice", response_model=AIJobResponse, status_code=status.HTTP_201_CREATED)
def queue_voice_message(
    thread_id: str,
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    duration_ms: int | None = Form(default=None),
    device_target: str = Form(default="mobile-native"),
    provider_hint: str | None = Form(default=None),
    metadata_json: str | None = Form(default=None),
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AIJobResponse:
    payload = file.file.read()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded assistant voice message is empty")

    metadata: dict[str, object] = {}
    if metadata_json:
        try:
            parsed_metadata = json.loads(metadata_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="metadata_json must be valid JSON") from exc
        if not isinstance(parsed_metadata, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="metadata_json must decode to an object")
        metadata = parsed_metadata

    media = media_service.create_media_asset(
        db,
        source_filename=file.filename,
        content_type=file.content_type,
        payload=payload,
    )
    try:
        job = assistant_run_service.queue_voice_run(
            db,
            thread_id=thread_id,
            blob_ref=str(media["blob_ref"]),
            content_type=media.get("content_type"),
            title=title,
            duration_ms=duration_ms,
            device_target=device_target,
            provider_hint=provider_hint,
            metadata=metadata,
            user_id=user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AIJobResponse.model_validate(job)


@router.get("/threads/{thread_id}/runs/{run_id}", response_model=AssistantRun)
def get_run(
    thread_id: str,
    run_id: str,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantRun:
    try:
        run = assistant_run_service.get_run(db, thread_id=thread_id, run_id=run_id, user_id=user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AssistantRun.model_validate(run)


@router.post("/runs/{run_id}/cancel", response_model=AssistantRun)
def cancel_run(
    run_id: str,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantRun:
    try:
        run = assistant_run_service.cancel_run(db, run_id=run_id, user_id=user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AssistantRun.model_validate(run)


@router.post("/interrupts/{interrupt_id}/submit", response_model=AssistantThreadSnapshot)
def submit_interrupt(
    interrupt_id: str,
    payload: AssistantInterruptSubmitRequest,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantThreadSnapshot:
    try:
        snapshot = assistant_interrupt_service.submit_interrupt(db, interrupt_id=interrupt_id, values=payload.values, user_id=user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AssistantThreadSnapshot.model_validate(snapshot)


@router.post("/interrupts/{interrupt_id}/dismiss", response_model=AssistantThreadSnapshot)
def dismiss_interrupt(
    interrupt_id: str,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantThreadSnapshot:
    try:
        snapshot = assistant_interrupt_service.dismiss_interrupt(db, interrupt_id=interrupt_id, user_id=user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AssistantThreadSnapshot.model_validate(snapshot)


@router.post("/threads/{thread_id}/events", response_model=AssistantThreadSnapshot, status_code=status.HTTP_201_CREATED)
def create_surface_event(
    thread_id: str,
    payload: AssistantSurfaceEventCreateRequest,
    user_id: str = Depends(require_user_id),
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
            user_id=user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AssistantThreadSnapshot.model_validate(snapshot)


@router.get("/threads/{thread_id}/updates", response_model=AssistantDeltaListResponse)
def list_updates(
    thread_id: str,
    cursor: str | None = Query(default=None),
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AssistantDeltaListResponse:
    try:
        delta_list = assistant_thread_service.list_deltas(db, thread_id, cursor=cursor, user_id=user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AssistantDeltaListResponse.model_validate(delta_list)


@router.get("/threads/{thread_id}/stream")
async def stream_updates(
    thread_id: str,
    request: Request,
    cursor: str | None = Query(default=None),
    token_hash: str = Depends(require_token_hash),
) -> StreamingResponse:
    with get_connection() as conn:
        user_id = auth_service.get_user_id_from_token_hash(conn, token_hash)
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token")
        try:
            assistant_thread_service.get_thread(conn, thread_id, user_id=user_id)
        except LookupError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    return StreamingResponse(
        _stream_delta_events(thread_id=thread_id, user_id=user_id, request=request, cursor=cursor),
        media_type="text/event-stream",
    )
