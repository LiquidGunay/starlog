from sqlite3 import Connection

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_db, require_user_id
from app.schemas.conversations import (
    ConversationMessage,
    ConversationMessageCreateRequest,
    ConversationPreviewRequest,
    ConversationPreviewResponse,
    ConversationSessionResetResponse,
    ConversationThreadSnapshot,
)
from app.services import ai_service, conversation_service

router = APIRouter(prefix="/conversations")


@router.get("/primary", response_model=ConversationThreadSnapshot)
def get_primary_conversation(
    message_limit: int = Query(default=50, ge=1, le=200),
    trace_limit: int = Query(default=25, ge=0, le=100),
    before_message_id: str | None = Query(default=None),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationThreadSnapshot:
    try:
        thread = conversation_service.get_primary_thread(
            db,
            message_limit=message_limit,
            trace_limit=trace_limit,
            before_message_id=before_message_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ConversationThreadSnapshot.model_validate(thread)


@router.post("/primary/messages", response_model=ConversationMessage, status_code=status.HTTP_201_CREATED)
def append_primary_conversation_message(
    payload: ConversationMessageCreateRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationMessage:
    message = conversation_service.append_message(
        db,
        role=payload.role,
        content=payload.content,
        cards=[item.model_dump(mode="json") for item in payload.cards],
        metadata=payload.metadata,
    )
    return ConversationMessage.model_validate(message)


@router.post("/primary/session/reset", response_model=ConversationSessionResetResponse)
def reset_primary_conversation_session(
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationSessionResetResponse:
    return ConversationSessionResetResponse.model_validate(conversation_service.reset_session_state(db))


@router.post("/primary/preview", response_model=ConversationPreviewResponse)
def preview_primary_conversation_turn(
    payload: ConversationPreviewRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationPreviewResponse:
    preview_request = conversation_service.build_chat_preview_request(
        db,
        content=payload.content,
        title=payload.title,
        message_limit=payload.message_limit,
        trace_limit=payload.trace_limit,
        metadata=payload.metadata,
        context_overrides=payload.context_overrides,
    )
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
