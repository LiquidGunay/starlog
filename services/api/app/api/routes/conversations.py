from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import ValidationError

from app.api.deps import get_db, require_user_id
from app.schemas.conversations import (
    ConversationMessage,
    ConversationMessageCreateRequest,
    ConversationPreviewRequest,
    ConversationPreviewResponse,
    ConversationSessionResetResponse,
    ConversationTurnRequest,
    ConversationTurnResponse,
    ConversationThreadSnapshot,
)
from app.services import (
    ai_service,
    assistant_legacy_adapter_service,
    assistant_run_service,
    assistant_thread_service,
    conversation_service,
)

router = APIRouter(prefix="/conversations")


@router.get("/primary", response_model=ConversationThreadSnapshot)
def get_primary_conversation(
    message_limit: int = Query(default=50, ge=1, le=200),
    trace_limit: int = Query(default=25, ge=0, le=100),
    before_message_id: str | None = Query(default=None),
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationThreadSnapshot:
    try:
        thread = conversation_service.get_primary_thread(
            db,
            user_id=user_id,
            message_limit=message_limit,
            trace_limit=trace_limit,
            before_message_id=before_message_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return ConversationThreadSnapshot.model_validate(thread)


@router.post("/primary/messages", response_model=ConversationMessage, status_code=status.HTTP_201_CREATED)
def append_primary_conversation_message(
    payload: ConversationMessageCreateRequest,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationMessage:
    try:
        message = conversation_service.append_message(
            db,
            role=payload.role,
            content=payload.content,
            cards=[item.model_dump(mode="json") for item in payload.cards],
            metadata=payload.metadata,
            user_id=user_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return ConversationMessage.model_validate(message)


@router.post("/primary/session/reset", response_model=ConversationSessionResetResponse)
def reset_primary_conversation_session(
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationSessionResetResponse:
    try:
        payload = conversation_service.reset_session_state(db, user_id=user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return ConversationSessionResetResponse.model_validate(payload).model_dump(mode="json")


@router.post("/primary/chat", response_model=ConversationTurnResponse, status_code=status.HTTP_201_CREATED)
def execute_primary_conversation_turn(
    payload: ConversationTurnRequest,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationTurnResponse:
    try:
        thread = assistant_thread_service.ensure_primary_thread(db, user_id=user_id)
        result = assistant_run_service.start_run(
            db,
            thread_id=str(thread["id"]),
            content=payload.content,
            input_mode=payload.input_mode,
            device_target=payload.device_target,
            metadata=payload.metadata,
            user_id=user_id,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc
    except ai_service.ProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    response = assistant_legacy_adapter_service.snapshot_to_legacy_turn(db, result)
    return ConversationTurnResponse.model_validate(response)


@router.post("/primary/preview", response_model=ConversationPreviewResponse)
def preview_primary_conversation_turn(
    payload: ConversationPreviewRequest,
    user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationPreviewResponse:
    try:
        preview_request = conversation_service.build_chat_preview_request(
            db,
            content=payload.content,
            title=payload.title,
            message_limit=payload.message_limit,
            trace_limit=payload.trace_limit,
            metadata=payload.metadata,
            context_overrides=payload.context_overrides,
            user_id=user_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    try:
        preview = ai_service.preview_workflow("chat_turn", preview_request)
    except ai_service.ProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return ConversationPreviewResponse.model_validate(
        {
            "thread_id": preview_request["thread_id"],
            **preview,
        }
    )
