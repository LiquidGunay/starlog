from __future__ import annotations

import json
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
            f"Parameters schema: {json.dumps(item.get('parameters_schema', {}), sort_keys=True)}"
            f"{confirmation_text}"
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


def _memory_counts(context: dict[str, Any]) -> tuple[int, int, int]:
    memory = context.get("memory_context")
    if not isinstance(memory, dict):
        return 0, 0, 0
    wiki_pages = memory.get("wiki_pages")
    profile_pages = memory.get("profile_pages")
    artifact_matches = memory.get("artifact_matches")
    return (
        len(wiki_pages) if isinstance(wiki_pages, list) else 0,
        len(profile_pages) if isinstance(profile_pages, list) else 0,
        len(artifact_matches) if isinstance(artifact_matches, list) else 0,
    )


def _text_part(text: str) -> dict[str, Any]:
    return {
        "type": "text",
        "text": text,
    }


def _card_part(card: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "card",
        "card": card,
    }


def _tool_call_part(*, tool_call_id: str, tool_name: str, status: str = "complete", title: str | None = None, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "type": "tool_call",
        "tool_call": {
            "id": tool_call_id,
            "tool_name": tool_name,
            "tool_kind": "system_tool",
            "status": status,
            "arguments": {},
            "title": title,
            "metadata": metadata or {},
        },
    }


def _status_part(status: str, label: str | None = None) -> dict[str, Any]:
    return {
        "type": "status",
        "status": status,
        "label": label,
    }


def _tool_result_part(*, tool_call_id: str, output: dict[str, Any], card: dict[str, Any] | None = None, entity_ref: dict[str, Any] | None = None, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "type": "tool_result",
        "tool_result": {
            "tool_call_id": tool_call_id,
            "status": "complete",
            "output": output,
            "card": card,
            "entity_ref": entity_ref,
            "metadata": metadata or {},
        },
    }


def _artifact_entity_ref(artifact_id: str, title: str) -> dict[str, Any]:
    return {
        "entity_type": "artifact",
        "entity_id": artifact_id,
        "href": f"/notes?artifact={artifact_id}",
        "title": title,
    }


def _note_entity_ref(note_id: str, title: str) -> dict[str, Any]:
    return {
        "entity_type": "note",
        "entity_id": note_id,
        "href": f"/notes?note={note_id}",
        "title": title,
    }


def _task_entity_ref(task_id: str, title: str) -> dict[str, Any]:
    return {
        "entity_type": "task",
        "entity_id": task_id,
        "href": f"/planner?task={task_id}",
        "title": title,
    }


def _briefing_entity_ref(briefing_id: str, title: str) -> dict[str, Any]:
    return {
        "entity_type": "briefing",
        "entity_id": briefing_id,
        "href": f"/planner?briefing={briefing_id}",
        "title": title,
    }


def _card_entity_ref(card_id: str, title: str) -> dict[str, Any]:
    return {
        "entity_type": "card",
        "entity_id": card_id,
        "href": "/review",
        "title": title,
    }


def _assistant_summary_card(response_text: str) -> dict[str, Any]:
    return {
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


def _thread_context_card(*, last_intent: str, latest_tool: str | None) -> dict[str, Any]:
    return {
        "kind": "thread_context",
        "version": 1,
        "title": "Thread context",
        "body": (
            f"Last intent: {last_intent.replace('_', ' ')}"
            if last_intent
            else f"Latest trace: {str(latest_tool or '').replace('_', ' ')}"
        ),
        "metadata": {
            "last_matched_intent": last_intent,
            "latest_tool_name": latest_tool,
        },
    }


def _capture_card_from_handoff(context: dict[str, Any]) -> dict[str, Any] | None:
    request_metadata = context.get("request_metadata")
    if not isinstance(request_metadata, dict):
        return None
    handoff = request_metadata.get("handoff_context")
    if not isinstance(handoff, dict):
        return None
    artifact_id = str(handoff.get("artifact_id") or "").strip()
    if not artifact_id:
        return None
    source = str(handoff.get("source") or "").strip() or "support_surface"
    draft = str(handoff.get("draft") or "").strip()
    title = f"{source.replace('_', ' ').title()} capture"
    return {
        "kind": "capture_item",
        "version": 1,
        "title": title,
        "body": draft or "A captured item is attached to this thread handoff.",
        "entity_ref": _artifact_entity_ref(artifact_id, title),
        "metadata": {
            "artifact_id": artifact_id,
            "source_surface": source,
            "projection": "runtime_handoff",
        },
    }


def _knowledge_note_card_from_memory(context: dict[str, Any]) -> dict[str, Any] | None:
    memory = context.get("memory_context")
    if not isinstance(memory, dict):
        return None
    matches = memory.get("artifact_matches")
    if not isinstance(matches, list) or not matches:
        return None
    first = matches[0]
    if not isinstance(first, dict):
        return None
    artifact_id = str(first.get("id") or "").strip()
    if not artifact_id:
        return None
    title = str(first.get("title") or "Relevant note").strip() or "Relevant note"
    return {
        "kind": "knowledge_note",
        "version": 1,
        "title": title,
        "body": _excerpt(str(first.get("excerpt") or ""), limit=220) or "Relevant context is available in Library.",
        "entity_ref": _artifact_entity_ref(artifact_id, title),
        "metadata": {
            "artifact_id": artifact_id,
            "projection": "runtime_memory_match",
            "source_type": first.get("source_type"),
        },
    }


def _trace_result(trace: dict[str, Any]) -> dict[str, Any]:
    result = trace.get("result")
    return result if isinstance(result, dict) else {}


def _humanize_tool_name(tool_name: str) -> str:
    humanized = " ".join(tool_name.strip().split("_"))
    return humanized.capitalize() if humanized else "Recent trace"


def _project_card_from_trace(trace: dict[str, Any]) -> dict[str, Any] | None:
    projected_card = trace.get("projected_card")
    if isinstance(projected_card, dict):
        return projected_card

    tool_name = str(trace.get("tool_name") or "").strip()
    result = _trace_result(trace)

    if tool_name == "capture_text_as_artifact":
        artifact = result.get("artifact")
        if isinstance(artifact, dict):
            artifact_id = str(artifact.get("id") or "").strip()
            if artifact_id:
                title = str(artifact.get("title") or "Saved capture").strip() or "Saved capture"
                body = _excerpt(
                    str(artifact.get("normalized_content") or artifact.get("extracted_content") or artifact.get("raw_content") or ""),
                    limit=220,
                ) or "Capture saved to Starlog."
                return {
                    "kind": "capture_item",
                    "version": 1,
                    "title": title,
                    "body": body,
                    "entity_ref": _artifact_entity_ref(artifact_id, title),
                    "metadata": {
                        "artifact_id": artifact_id,
                        "source_type": artifact.get("source_type"),
                        "projection": "runtime_recent_trace",
                    },
                }

    if tool_name in {"create_note", "update_note", "get_note"}:
        note = result.get("note")
        if isinstance(note, dict):
            note_id = str(note.get("id") or "").strip()
            if note_id:
                title = str(note.get("title") or "Note").strip() or "Note"
                return {
                    "kind": "knowledge_note",
                    "version": 1,
                    "title": title,
                    "body": _excerpt(str(note.get("body_md") or ""), limit=220) or "Note updated.",
                    "entity_ref": _note_entity_ref(note_id, title),
                    "metadata": {
                        "note_id": note_id,
                        "version": note.get("version"),
                        "projection": "runtime_recent_trace",
                    },
                }

    if tool_name in {"create_task", "update_task"}:
        task = result.get("task")
        if isinstance(task, dict):
            task_id = str(task.get("id") or "").strip()
            if task_id:
                title = str(task.get("title") or "Task updated").strip() or "Task updated"
                due = f" due {task['due_at']}" if task.get("due_at") else ""
                body = f"- {title} [{task.get('status') or 'todo'}]{due}"
                return {
                    "kind": "task_list",
                    "version": 1,
                    "title": "Task updated",
                    "body": body,
                    "entity_ref": _task_entity_ref(task_id, title),
                    "metadata": {
                        "task_count": 1,
                        "task_ids": [task_id],
                        "projection": "runtime_recent_trace",
                    },
                }

    if tool_name == "list_due_cards":
        cards = result.get("cards")
        due_cards = cards if isinstance(cards, list) else result.get("value")
        if isinstance(due_cards, list) and due_cards:
            first = due_cards[0] if isinstance(due_cards[0], dict) else {}
            title = str(first.get("prompt") or "Review queue").strip() or "Review queue"
            return {
                "kind": "review_queue",
                "version": 1,
                "title": "Review queue",
                "body": f"{len(due_cards)} card{'s' if len(due_cards) != 1 else ''} ready now.\n{title}",
                "entity_ref": _card_entity_ref(str(first.get("id") or "review_queue"), title),
                "metadata": {
                    "due_count": len(due_cards),
                    "card_id": first.get("id"),
                    "projection": "runtime_recent_trace",
                },
            }

    if tool_name == "list_tasks":
        tasks = result.get("tasks")
        if isinstance(tasks, list) and tasks:
            body_lines = []
            for task in tasks[:4]:
                if not isinstance(task, dict):
                    continue
                due = f" due {task['due_at']}" if task.get("due_at") else ""
                body_lines.append(f"- {task.get('title') or task.get('id') or 'Task'} [{task.get('status') or 'todo'}]{due}")
            first = tasks[0] if isinstance(tasks[0], dict) else {}
            return {
                "kind": "task_list",
                "version": 1,
                "title": "Current plan",
                "body": "\n".join(body_lines) or "No current tasks are available.",
                "entity_ref": _task_entity_ref(str(first.get("id") or "plan"), str(first.get("title") or "Current plan")),
                "metadata": {
                    "task_count": len(tasks),
                    "task_ids": [item.get("id") for item in tasks[:6] if isinstance(item, dict) and item.get("id")],
                    "projection": "runtime_recent_trace",
                },
            }

    if tool_name in {"generate_briefing", "render_briefing_audio", "schedule_morning_brief_alarm"}:
        briefing = result.get("briefing")
        if isinstance(briefing, dict):
            briefing_id = str(briefing.get("id") or "").strip()
            if not briefing_id:
                return None
            title = str(briefing.get("date") or briefing_id).strip() or briefing_id
            return {
                "kind": "briefing",
                "version": 1,
                "title": "Morning briefing",
                "body": _excerpt(str(briefing.get("text") or ""), limit=240) or "Briefing ready.",
                "entity_ref": _briefing_entity_ref(briefing_id, title),
                "metadata": {
                    "briefing_id": briefing_id,
                    "date": briefing.get("date"),
                    "audio_ref": briefing.get("audio_ref"),
                    "projection": "runtime_recent_trace",
                },
            }

    return None


def _tool_call_part_from_trace(trace: dict[str, Any]) -> dict[str, Any]:
    trace_id = str(trace.get("id") or trace.get("tool_name") or "recent_trace").strip() or "recent_trace"
    tool_name = str(trace.get("tool_name") or "").strip() or "recent_trace"
    return _tool_call_part(
        tool_call_id=trace_id,
        tool_name=tool_name,
        status=str(trace.get("status") or "complete").strip() or "complete",
        title=_humanize_tool_name(tool_name),
        metadata={
            "projection": "runtime_recent_trace",
            "trace_id": str(trace.get("id") or "").strip() or None,
        },
    )


def _tool_result_part_from_trace(trace: dict[str, Any]) -> dict[str, Any] | None:
    projected_card = _project_card_from_trace(trace)
    if projected_card is None:
        return None

    trace_id = str(trace.get("id") or trace.get("tool_name") or "recent_trace").strip() or "recent_trace"
    output = _trace_result(trace)
    entity_ref = projected_card.get("entity_ref") if isinstance(projected_card.get("entity_ref"), dict) else None
    return _tool_result_part(
        tool_call_id=trace_id,
        output=output,
        card=projected_card,
        entity_ref=entity_ref,
        metadata={
            "projection": "runtime_recent_trace",
            "tool_name": str(trace.get("tool_name") or "").strip(),
            "trace_id": str(trace.get("id") or "").strip() or None,
        },
    )


def _project_chat_turn_cards(context: dict[str, Any], *, response_text: str, last_intent: str, latest_tool: str | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cards: list[dict[str, Any]] = [_assistant_summary_card(response_text)]
    if last_intent or latest_tool:
        cards.append(_thread_context_card(last_intent=last_intent, latest_tool=latest_tool))

    handoff_card = _capture_card_from_handoff(context)
    if handoff_card is not None:
        cards.append(handoff_card)

    projected_trace_parts: list[dict[str, Any]] = []
    traces = context.get("recent_tool_traces")
    if isinstance(traces, list):
        for item in traces:
            if not isinstance(item, dict):
                continue
            projected = _project_card_from_trace(item)
            if projected is not None:
                cards.append(projected)
                projected_trace_parts = [_tool_call_part_from_trace(item)]
                projected_tool_result_part = _tool_result_part_from_trace(item)
                if projected_tool_result_part is not None:
                    projected_trace_parts.append(projected_tool_result_part)
                break

    if handoff_card is None:
        memory_card = _knowledge_note_card_from_memory(context)
        if memory_card is not None:
            cards.append(memory_card)

    return cards, projected_trace_parts


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


def capability_request_spec(capability: RuntimeCapability, payload: dict[str, Any]) -> tuple[str, str]:
    title = str(payload.get("title") or "Untitled").strip() or "Untitled"
    if capability == "llm_agent_plan":
        return (
            load_prompt("llm_agent_plan.system.md"),
            render_prompt(
                "llm_agent_plan.user.md",
                current_date=str(payload.get("current_date") or "unknown"),
                command=str(payload.get("command") or _source_text(payload)),
                intent_lines=payload.get("intent_lines") or _intent_lines(payload),
                tool_lines=payload.get("tool_lines") or _tool_lines(payload),
            ),
        )
    return (
        load_prompt(f"{capability}.system.md"),
        render_prompt(f"{capability}.user.md", title=title, text=_source_text(payload)),
    )


def execute_capability(capability: RuntimeCapability, payload: dict[str, Any]) -> CapabilityExecutionResponse:
    title = str(payload.get("title") or "Untitled").strip() or "Untitled"
    system_prompt, user_prompt = capability_request_spec(capability, payload)
    if capability == "llm_agent_plan":
        output = _agent_plan_output(payload)
    elif capability == "llm_summary":
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
        system_prompt=render_prompt("chat_turn.system.md"),
        user_prompt=render_prompt(
            "chat_turn.user.md",
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
    wiki_count, profile_count, artifact_count = _memory_counts(context)

    response_parts = [f"Captured into {resolved_title}: {excerpt}"]
    if last_intent:
        response_parts.append(f"The latest tracked intent is {last_intent.replace('_', ' ')}.")
    elif latest_tool:
        response_parts.append(f"The latest execution trace is {latest_tool.replace('_', ' ')}.")
    else:
        response_parts.append("The persistent thread is ready for the next explicit action.")
    if wiki_count or profile_count or artifact_count:
        response_parts.append(
            f"Memory context surfaced {wiki_count} wiki page(s), {profile_count} profile page(s), and {artifact_count} related artifact match(es)."
        )
    response_text = " ".join(response_parts)

    cards, projected_trace_parts = _project_chat_turn_cards(
        context,
        response_text=response_text,
        last_intent=last_intent,
        latest_tool=latest_tool,
    )
    parts = [_text_part(response_text)]
    projected_tool_result_part = next(
        (
            part
            for part in projected_trace_parts
            if isinstance(part, dict) and part.get("type") == "tool_result"
        ),
        None,
    )
    trace_projection_card = (
        projected_tool_result_part.get("tool_result", {}).get("card")
        if isinstance(projected_tool_result_part, dict)
        else None
    )
    for card in cards:
        if trace_projection_card is not None and card is trace_projection_card:
            continue
        parts.append(_card_part(card))
    parts.extend(projected_trace_parts)
    parts.append(_status_part("complete", "Ready"))

    return ChatTurnExecutionResponse(
        provider_used=DEFAULT_PROVIDER,
        model=DEFAULT_MODEL,
        system_prompt=render_prompt("chat_turn.system.md"),
        user_prompt=render_prompt(
            "chat_turn.user.md",
            title=resolved_title,
            text=text,
            context=context,
        ),
        response_text=response_text,
        parts=parts,
        cards=cards,
        tool_calls=[],
        interrupts=[],
        ambient_updates=[],
        attachments=[],
        session_state={
            "last_turn_kind": "chat_turn",
            "last_user_message": text,
            "last_assistant_response": response_text,
        },
        metadata={
            "title": resolved_title,
            "recent_message_count": len(context.get("recent_messages") or []),
            "recent_trace_count": len(context.get("recent_tool_traces") or []),
            "memory_context_counts": {
                "wiki_pages": wiki_count,
                "profile_pages": profile_count,
                "artifact_matches": artifact_count,
            },
        },
    )


def briefing_preview(title: str | None, text: str, context: dict[str, Any]) -> WorkflowPreviewResponse:
    resolved_title = title or "Daily briefing"
    return WorkflowPreviewResponse(
        workflow="briefing",
        model=DEFAULT_MODEL,
        system_prompt=render_prompt("briefing.system.md"),
        user_prompt=render_prompt(
            "briefing.user.md",
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
        system_prompt=render_prompt("research_digest.system.md"),
        user_prompt=render_prompt(
            "research_digest.user.md",
            title=resolved_title,
            text=text,
            context=context,
        ),
        context=context,
    )
