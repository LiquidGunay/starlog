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
from app.services import agent_command_service, ai_service, conversation_card_service, conversation_service

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
    return ConversationSessionResetResponse.model_validate(
        conversation_service.reset_session_state(db)
    ).model_dump(mode="json")


@router.post("/primary/chat", response_model=ConversationTurnResponse, status_code=status.HTTP_201_CREATED)
def execute_primary_conversation_turn(
    payload: ConversationTurnRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> ConversationTurnResponse:
    try:
        planned_turn = agent_command_service.run_conversation_command(
            db,
            command=payload.content,
            input_mode=payload.input_mode,
            device_target=payload.device_target,
        )
    except ValueError:
        planned_turn = None
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc

    if planned_turn is not None:
        return ConversationTurnResponse.model_validate(planned_turn)

    request_payload = conversation_service.build_chat_preview_request(
        db,
        content=payload.content,
        title=payload.title,
        message_limit=payload.message_limit,
        trace_limit=payload.trace_limit,
        metadata=payload.metadata,
        context_overrides=payload.context_overrides,
    )
    try:
        turn = ai_service.execute_chat_turn(request_payload)
    except ai_service.ProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    response = conversation_service.record_chat_turn(
        db,
        content=payload.content,
        assistant_content=str(turn.get("response_text") or ""),
        cards=conversation_card_service.normalize_cards(
            turn.get("cards") if isinstance(turn.get("cards"), list) else [
                {
                    "kind": "assistant_summary",
                    "title": "Assistant",
                    "body": str(turn.get("response_text") or ""),
                    "metadata": {},
                }
            ]
        ),
        request_metadata={
            "input_mode": payload.input_mode,
            "device_target": payload.device_target,
            "request_metadata": payload.metadata,
        },
        assistant_metadata={
            "chat_turn": {
                "workflow": turn.get("workflow") or "chat_turn",
                "provider_used": turn.get("provider_used") or "local_prompt_preview",
                "model": turn.get("model") or "",
                "metadata": turn.get("metadata") if isinstance(turn.get("metadata"), dict) else {},
            },
            "status": "completed",
        },
        session_state_patch={
            **(turn.get("session_state") if isinstance(turn.get("session_state"), dict) else {}),
            "last_chat_turn_provider": turn.get("provider_used") or "local_prompt_preview",
            "last_chat_turn_model": turn.get("model") or "",
        },
        runtime_trace_metadata={
            "workflow": turn.get("workflow") or "chat_turn",
            "provider_used": turn.get("provider_used") or "local_prompt_preview",
            "model": turn.get("model") or "",
            "system_prompt": turn.get("system_prompt") or "",
            "user_prompt": turn.get("user_prompt") or "",
            "metadata": turn.get("metadata") if isinstance(turn.get("metadata"), dict) else {},
        },
    )
    return ConversationTurnResponse.model_validate(response)


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
