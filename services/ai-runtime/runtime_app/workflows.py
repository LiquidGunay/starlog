from __future__ import annotations

from typing import Any

from runtime_app.prompt_loader import render_prompt
from runtime_app.schemas import WorkflowPreviewResponse

DEFAULT_MODEL = "gpt-5.4-nano"


def chat_preview(title: str | None, text: str, context: dict[str, Any]) -> WorkflowPreviewResponse:
    resolved_title = title or "Untitled"
    return WorkflowPreviewResponse(
        workflow="chat_turn",
        model=DEFAULT_MODEL,
        system_prompt=render_prompt("chat_turn.system.txt"),
        user_prompt=render_prompt(
            "chat_turn.user.txt",
            title=resolved_title,
            text=text,
            context=context,
        ),
        context=context,
    )


def briefing_preview(title: str | None, text: str, context: dict[str, Any]) -> WorkflowPreviewResponse:
    resolved_title = title or "Daily briefing"
    return WorkflowPreviewResponse(
        workflow="briefing",
        model=DEFAULT_MODEL,
        system_prompt=render_prompt("briefing.system.txt"),
        user_prompt=render_prompt(
            "briefing.user.txt",
            title=resolved_title,
            text=text,
            context=context,
        ),
        context=context,
    )


def research_digest_preview(title: str | None, text: str, context: dict[str, Any]) -> WorkflowPreviewResponse:
    resolved_title = title or "Research digest"
    return WorkflowPreviewResponse(
        workflow="research_digest",
        model=DEFAULT_MODEL,
        system_prompt=render_prompt("research_digest.system.txt"),
        user_prompt=render_prompt(
            "research_digest.user.txt",
            title=resolved_title,
            text=text,
            context=context,
        ),
        context=context,
    )
