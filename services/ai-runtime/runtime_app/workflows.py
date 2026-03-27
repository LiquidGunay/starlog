from __future__ import annotations

from typing import Any

from runtime_app.prompt_loader import load_prompt, render_prompt
from runtime_app.schemas import (
    CapabilityExecutionResponse,
    ChatTurnExecutionResponse,
    RuntimeCapability,
    WorkflowPreviewResponse,
)

DEFAULT_MODEL = "gpt-5.4-nano"
DEFAULT_PROVIDER = "runtime_prompt_fallback"


def _source_text(payload: dict[str, Any]) -> str:
    return str(payload.get("text") or payload.get("content") or payload.get("text_hint") or "").strip()


def _excerpt(text: str, *, limit: int = 240) -> str:
    trimmed = " ".join(text.split())
    return trimmed[:limit] if trimmed else ""


def _summary_output(title: str, payload: dict[str, Any]) -> dict[str, Any]:
    text = _source_text(payload)
    excerpt = _excerpt(text, limit=280)
    summary = (
        f"Summary draft for {title}: {excerpt}"
        if excerpt
        else f"Summary draft for {title}: no source text was provided."
    )
    return {
        "summary": summary,
        "text": summary,
    }


def _cards_output(title: str, payload: dict[str, Any]) -> dict[str, Any]:
    excerpt = _excerpt(_source_text(payload), limit=180) or f"Review the key ideas from {title}."
    return {
        "cards": [
            {
                "prompt": f"What is the core idea in {title}?",
                "answer": excerpt,
                "card_type": "qa",
            },
            {
                "prompt": f"What detail from {title} is most worth revisiting?",
                "answer": excerpt[:120] or title,
                "card_type": "qa",
            },
        ]
    }


def _tasks_output(title: str, payload: dict[str, Any]) -> dict[str, Any]:
    excerpt = _excerpt(_source_text(payload), limit=80)
    return {
        "tasks": [
            {
                "title": f"Review {title}",
                "estimate_min": 20,
                "priority": 3,
                "notes": excerpt,
            }
        ]
    }


def _intent_lines(payload: dict[str, Any]) -> str:
    intents = payload.get("intents")
    if not isinstance(intents, list):
        return "- none provided"
    lines: list[str] = []
    for item in intents:
        if not isinstance(item, dict):
            continue
        examples = item.get("examples")
        examples_text = ", ".join(str(entry) for entry in examples) if isinstance(examples, list) else ""
        lines.append(f"- {item.get('name', 'unknown')}: {item.get('description', '')} Examples: {examples_text}")
    return "\n".join(lines) if lines else "- none provided"


def _tool_lines(payload: dict[str, Any]) -> str:
    tools = payload.get("tool_catalog")
    if not isinstance(tools, list):
        return "- none provided"
    lines: list[str] = []
    for item in tools:
        if not isinstance(item, dict):
            continue
        confirmation_policy = item.get("confirmation_policy")
        confirmation_text = ""
        if isinstance(confirmation_policy, dict):
            mode = str(confirmation_policy.get("mode") or "").strip()
            reason = str(confirmation_policy.get("reason") or "").strip()
            if mode:
                confirmation_text = f" Confirmation policy: {mode}."
            if reason:
                confirmation_text = f"{confirmation_text} {reason}".strip()
        lines.append(
            f"- {item.get('name', 'unknown')}: {item.get('description', '')} "
            f"Parameters schema: {item.get('parameters_schema', {})!r}{confirmation_text}"
        )
    return "\n".join(lines) if lines else "- none provided"


def _latest_tool_name(context: dict[str, Any]) -> str | None:
    traces = context.get("recent_tool_traces")
    if not isinstance(traces, list) or not traces:
        return None
    first = traces[0]
    if not isinstance(first, dict):
        return None
    tool_name = str(first.get("tool_name") or "").strip()
    return tool_name or None


def _agent_plan_output(payload: dict[str, Any]) -> dict[str, Any]:
    command = str(payload.get("command") or _source_text(payload) or "").strip()
    tool_catalog = payload.get("tool_catalog")
    available_tools = {
        str(item.get("name")) for item in tool_catalog if isinstance(tool_catalog, list) and isinstance(item, dict)
    }
    if "create_task" in available_tools and "task" in command.lower():
        return {
            "planner": "runtime_prompt_fallback",
            "matched_intent": "create_task",
            "summary": "Draft a follow-up task from the request and require confirmation before committing.",
            "tool_calls": [
                {
                    "tool_name": "create_task",
                    "arguments": {
                        "title": command[:120] or "Follow up",
                        "priority": 3,
                    },
                    "message": "Create a task from the assisted command",
                }
            ],
        }
    return {
        "planner": "runtime_prompt_fallback",
        "matched_intent": "assistant_ai",
        "summary": "No direct runtime fallback tool call matched the request.",
        "tool_calls": [],
    }


def execute_capability(capability: RuntimeCapability, payload: dict[str, Any]) -> CapabilityExecutionResponse:
    title = str(payload.get("title") or "Untitled").strip() or "Untitled"
    system_prompt = load_prompt(f"{capability}.system.txt")
    if capability == "llm_agent_plan":
        user_prompt = render_prompt(
            "llm_agent_plan.user.txt",
            current_date=str(payload.get("current_date") or "unknown"),
            command=str(payload.get("command") or _source_text(payload)),
            intent_lines=payload.get("intent_lines") or _intent_lines(payload),
            tool_lines=payload.get("tool_lines") or _tool_lines(payload),
        )
        output = _agent_plan_output(payload)
    else:
        user_prompt = render_prompt(f"{capability}.user.txt", title=title, text=_source_text(payload))
        if capability == "llm_summary":
            output = _summary_output(title, payload)
        elif capability == "llm_cards":
            output = _cards_output(title, payload)
        else:
            output = _tasks_output(title, payload)

    return CapabilityExecutionResponse(
        capability=capability,
        provider_used=DEFAULT_PROVIDER,
        model=DEFAULT_MODEL,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        output=output,
    )


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


def execute_chat_turn(title: str | None, text: str, context: dict[str, Any]) -> ChatTurnExecutionResponse:
    resolved_title = title or "Primary Starlog Thread"
    excerpt = _excerpt(text, limit=180) or "No user message was provided."
    session_state = context.get("session_state") if isinstance(context.get("session_state"), dict) else {}
    last_intent = str(session_state.get("last_matched_intent") or "").strip()
    latest_tool = _latest_tool_name(context)

    response_parts = [f"Captured into {resolved_title}: {excerpt}"]
    if last_intent:
        response_parts.append(f"The latest tracked intent is {last_intent.replace('_', ' ')}.")
    elif latest_tool:
        response_parts.append(f"The latest execution trace is {latest_tool.replace('_', ' ')}.")
    else:
        response_parts.append("The persistent thread is ready for the next explicit action.")
    response_text = " ".join(response_parts)

    cards: list[dict[str, Any]] = [
        {
            "kind": "assistant_summary",
            "version": 1,
            "title": "Chat turn",
            "body": response_text,
            "metadata": {
                "workflow": "chat_turn",
                "provider": DEFAULT_PROVIDER,
                "model": DEFAULT_MODEL,
            },
        }
    ]
    if last_intent or latest_tool:
        cards.append(
            {
                "kind": "thread_context",
                "version": 1,
                "title": "Thread context",
                "body": (
                    f"Last intent: {last_intent.replace('_', ' ')}"
                    if last_intent
                    else f"Latest trace: {latest_tool.replace('_', ' ')}"
                ),
                "metadata": {
                    "last_matched_intent": last_intent,
                    "latest_tool_name": latest_tool,
                },
            }
        )

    return ChatTurnExecutionResponse(
        provider_used=DEFAULT_PROVIDER,
        model=DEFAULT_MODEL,
        system_prompt=render_prompt("chat_turn.system.txt"),
        user_prompt=render_prompt(
            "chat_turn.user.txt",
            title=resolved_title,
            text=text,
            context=context,
        ),
        response_text=response_text,
        cards=cards,
        session_state={
            "last_turn_kind": "chat_turn",
            "last_user_message": text,
            "last_assistant_response": response_text,
        },
        metadata={
            "title": resolved_title,
            "recent_message_count": len(context.get("recent_messages") or []),
            "recent_trace_count": len(context.get("recent_tool_traces") or []),
        },
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
