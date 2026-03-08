from sqlite3 import Connection
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import ValidationError

from app.api.deps import get_db, require_user_id
from app.schemas.agent import (
    AgentCommandRequest,
    AgentCommandResponse,
    AgentToolCallRequest,
    AgentToolCallResponse,
    AgentToolDefinition,
)
from app.services import agent_command_service, agent_service

router = APIRouter(prefix="/agent")


@router.get("/tools")
def list_agent_tools(
    format: Literal["plain", "openai"] = Query(default="plain"),
    _user_id: str = Depends(require_user_id),
) -> list[AgentToolDefinition] | list[dict]:
    if format == "openai":
        return agent_service.list_openai_tools()
    return agent_service.list_tool_definitions()


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
