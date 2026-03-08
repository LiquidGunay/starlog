from sqlite3 import Connection
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import ValidationError

from app.api.deps import get_db, require_user_id
from app.schemas.ai import AIJobResponse
from app.schemas.agent import (
    AgentCommandRequest,
    AgentCommandResponse,
    AgentCommandIntent,
    AgentToolCallRequest,
    AgentToolCallResponse,
    AgentToolDefinition,
)
from app.services import agent_command_service, agent_service, media_service

router = APIRouter(prefix="/agent")


@router.get("/tools")
def list_agent_tools(
    format: Literal["plain", "openai"] = Query(default="plain"),
    _user_id: str = Depends(require_user_id),
) -> list[AgentToolDefinition] | list[dict]:
    if format == "openai":
        return agent_service.list_openai_tools()
    return agent_service.list_tool_definitions()


@router.get("/intents", response_model=list[AgentCommandIntent])
def list_agent_command_intents(
    _user_id: str = Depends(require_user_id),
) -> list[AgentCommandIntent]:
    return agent_command_service.list_command_intents()


@router.post("/execute", response_model=AgentToolCallResponse)
def execute_agent_tool(
    payload: AgentToolCallRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AgentToolCallResponse:
    try:
        status_text, normalized, result = agent_service.execute_tool(
            db,
            tool_name=payload.tool_name,
            arguments=payload.arguments,
            dry_run=payload.dry_run,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AgentToolCallResponse(
        tool_name=payload.tool_name,
        status=status_text,
        validated_arguments=normalized,
        result=result,
    )


@router.post("/command", response_model=AgentCommandResponse)
def run_agent_command(
    payload: AgentCommandRequest,
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AgentCommandResponse:
    try:
        return agent_command_service.run_command(
            db,
            command=payload.command,
            execute=payload.execute,
            device_target=payload.device_target,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc


@router.post("/command/voice", response_model=AIJobResponse, status_code=status.HTTP_201_CREATED)
def queue_voice_agent_command(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    duration_ms: int | None = Form(default=None),
    execute: bool = Form(default=True),
    device_target: str = Form(default="primary-device"),
    provider_hint: str | None = Form(default=None),
    _user_id: str = Depends(require_user_id),
    db: Connection = Depends(get_db),
) -> AIJobResponse:
    payload = file.file.read()
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded voice command is empty")

    media = media_service.create_media_asset(
        db,
        source_filename=file.filename,
        content_type=file.content_type,
        payload=payload,
    )
    job = agent_command_service.queue_voice_command(
        db,
        blob_ref=str(media["blob_ref"]),
        content_type=media.get("content_type"),
        title=title,
        duration_ms=duration_ms,
        execute=execute,
        device_target=device_target,
        provider_hint=provider_hint,
    )
    return AIJobResponse.model_validate(job)
