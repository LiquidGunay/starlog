from __future__ import annotations

from sqlite3 import Connection
from typing import Any

from app.services import artifacts_service, memory_vault_service, review_mode_service


def _snippet(text: str | None, *, limit: int = 220) -> str:
    normalized = " ".join(str(text or "").split())
    if not normalized:
        return ""
    return normalized[:limit] + ("..." if len(normalized) > limit else "")


def _navigate_action(
    action_id: str,
    label: str,
    href: str,
    *,
    style: str = "secondary",
) -> dict[str, Any]:
    return {
        "id": action_id,
        "label": label,
        "kind": "navigate",
        "payload": {"href": href},
        "style": style,
        "requires_confirmation": False,
    }


def _composer_action(
    action_id: str,
    label: str,
    prompt: str,
    *,
    style: str = "ghost",
) -> dict[str, Any]:
    return {
        "id": action_id,
        "label": label,
        "kind": "composer",
        "payload": {"prompt": prompt},
        "style": style,
        "requires_confirmation": False,
    }


def _mutation_action(
    action_id: str,
    label: str,
    endpoint: str,
    body: dict[str, Any],
    *,
    method: str = "POST",
    style: str = "primary",
    requires_confirmation: bool = False,
) -> dict[str, Any]:
    return {
        "id": action_id,
        "label": label,
        "kind": "mutation",
        "payload": {
            "endpoint": endpoint,
            "method": method,
            "body": body,
        },
        "style": style,
        "requires_confirmation": requires_confirmation,
    }


def _media_content_url(audio_ref: str | None) -> str | None:
    if not audio_ref or not audio_ref.startswith("media://"):
        return None
    return f"/v1/media/{audio_ref.removeprefix('media://')}/content"


def _default_actions(card: dict[str, Any]) -> list[dict[str, Any]]:
    kind = str(card.get("kind") or "").strip()
    title = str(card.get("title") or "").strip()
    body = str(card.get("body") or "").strip()
    metadata = card.get("metadata") if isinstance(card.get("metadata"), dict) else {}
    entity_ref = card.get("entity_ref") if isinstance(card.get("entity_ref"), dict) else {}
    entity_type = str(entity_ref.get("entity_type") or "").strip()
    entity_id = str(entity_ref.get("entity_id") or "").strip()
    href = str(entity_ref.get("href") or "").strip()

    if kind == "assistant_summary":
        prompt = f"Follow up on this: {title or body}".strip()
        return [_composer_action("ask_follow_up", "Ask follow-up", prompt)]

    if kind == "thread_context":
        prompt = body or title or "Reuse the latest thread context"
        return [_composer_action("reuse_context", "Reuse in Assistant", prompt)]

    if kind == "knowledge_note":
        prompt = f"Follow up on {title or 'this note'}".strip()
        return [
            _navigate_action("open_library", "Open", href or "/notes"),
            _composer_action("ask_follow_up", "Ask follow-up", prompt),
        ]

    if kind == "task_list":
        actions: list[dict[str, Any]] = []
        if entity_type == "task" and entity_id:
            actions.append(
                _mutation_action(
                    "complete_task",
                    "Complete",
                    f"/v1/tasks/{entity_id}",
                    {"status": "done"},
                    method="PATCH",
                )
            )
        actions.append(_composer_action("schedule_task", "Schedule", f"Schedule {title or 'this plan'} in Planner"))
        actions.append(_navigate_action("open_planner", "Open Planner", "/planner"))
        return actions

    if kind == "review_queue":
        actions: list[dict[str, Any]] = []
        if entity_type == "card" and entity_id:
            for label, rating, style in [("Hard", 3, "secondary"), ("Good", 4, "primary"), ("Easy", 5, "ghost")]:
                actions.append(
                    _mutation_action(
                        f"review_{rating}",
                        label,
                        "/v1/reviews",
                        {"card_id": entity_id, "rating": rating},
                        style=style,
                    )
                )
        actions.append(_navigate_action("open_review", "Open Review", "/review"))
        return actions

    if kind == "briefing":
        briefing_id = str(entity_id or metadata.get("briefing_id") or "").strip()
        actions: list[dict[str, Any]] = []
        if briefing_id:
            actions.append(
                _mutation_action(
                    "cache_audio",
                    "Cache audio",
                    f"/v1/briefings/{briefing_id}/audio/render",
                    {"provider_hint": "web_assistant"},
                )
            )
        actions.append(_navigate_action("open_planner", "Open Planner", "/planner"))
        return actions

    if kind == "capture_item":
        artifact_id = entity_id or str(metadata.get("artifact_id") or "").strip()
        if not artifact_id:
            return [_navigate_action("open_library", "Open Library", "/notes")]
        return [
            _mutation_action(
                "summarize_capture",
                "Summarize",
                f"/v1/artifacts/{artifact_id}/actions",
                {"action": "summarize"},
            ),
            _mutation_action(
                "make_cards",
                "Make cards",
                f"/v1/artifacts/{artifact_id}/actions",
                {"action": "cards"},
                style="secondary",
            ),
            _navigate_action("open_library", "Open Library", href or "/notes"),
        ]

    if kind == "memory_suggestion":
        actions: list[dict[str, Any]] = []
        page_path = str(metadata.get("page_path") or href or "").strip()
        proposal_id = str(metadata.get("proposal_id") or "").strip()
        if page_path:
            actions.append(_navigate_action("open_memory", "Open page", href or page_path, style="primary"))
        if proposal_id:
            actions.append(
                _mutation_action(
                    "confirm_profile_proposal",
                    "Confirm",
                    f"/v1/memory/profile-proposals/{proposal_id}/confirm",
                    {},
                )
            )
            actions.append(
                _mutation_action(
                    "dismiss_profile_proposal",
                    "Dismiss",
                    f"/v1/memory/profile-proposals/{proposal_id}/dismiss",
                    {},
                    style="secondary",
                )
            )
        else:
            prompt = f"Follow up on {title or body or 'this memory suggestion'}".strip()
            actions.append(_composer_action("follow_up_memory", "Ask Assistant", prompt, style="secondary"))
        return actions

    return []


def normalize_card(card: dict[str, Any]) -> dict[str, Any]:
    metadata = card.get("metadata") if isinstance(card.get("metadata"), dict) else {}
    entity_ref = card.get("entity_ref") if isinstance(card.get("entity_ref"), dict) else None
    actions = card.get("actions")
    normalized_actions = [item for item in actions if isinstance(item, dict)] if isinstance(actions, list) else []
    if not normalized_actions:
        normalized_actions = _default_actions({**card, "metadata": metadata, "entity_ref": entity_ref})
    version = card.get("version")
    normalized_version = version if isinstance(version, int) and version > 0 else 1
    return {
        **card,
        "version": normalized_version,
        "metadata": metadata,
        "entity_ref": entity_ref,
        "actions": normalized_actions,
    }


def normalize_cards(cards: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not isinstance(cards, list):
        return []
    return [normalize_card(card) for card in cards if isinstance(card, dict)]


def _artifact_entity_ref(artifact: dict[str, Any]) -> dict[str, Any]:
    artifact_id = str(artifact["id"])
    return {
        "entity_type": "artifact",
        "entity_id": artifact_id,
        "href": f"/notes?artifact={artifact_id}",
        "title": artifact.get("title") or artifact_id,
    }


def _note_entity_ref(note: dict[str, Any]) -> dict[str, Any]:
    note_id = str(note["id"])
    return {
        "entity_type": "note",
        "entity_id": note_id,
        "href": f"/notes?note={note_id}",
        "title": note.get("title") or note_id,
    }


def _task_entity_ref(task: dict[str, Any]) -> dict[str, Any]:
    task_id = str(task["id"])
    return {
        "entity_type": "task",
        "entity_id": task_id,
        "href": f"/planner?task={task_id}",
        "title": task.get("title") or task_id,
    }


def _briefing_entity_ref(briefing: dict[str, Any]) -> dict[str, Any]:
    briefing_id = str(briefing["id"])
    return {
        "entity_type": "briefing",
        "entity_id": briefing_id,
        "href": f"/planner?briefing={briefing_id}",
        "title": briefing.get("date") or briefing_id,
    }


def _card_entity_ref(card: dict[str, Any]) -> dict[str, Any]:
    card_id = str(card["id"])
    return {
        "entity_type": "card",
        "entity_id": card_id,
        "href": "/review",
        "title": card.get("prompt") or card_id,
    }


def _memory_page_entity_ref(page: dict[str, Any]) -> dict[str, Any]:
    page_id = str(page["id"])
    path = str(page.get("path") or page_id)
    return {
        "entity_type": "memory_page",
        "entity_id": page_id,
        "href": f"/notes/memory?page={page_id}",
        "title": page.get("title") or path,
    }


def _assistant_summary_card(response: Any) -> dict[str, Any]:
    return normalize_card(
        {
            "kind": "assistant_summary",
            "title": str(getattr(response, "matched_intent", "") or "assistant").replace("_", " ").title(),
            "body": str(getattr(response, "summary", "") or ""),
            "metadata": {
                "planner": getattr(response, "planner", "deterministic"),
                "status": getattr(response, "status", "executed"),
            },
        }
    )


def _tool_step_card(step: Any) -> dict[str, Any]:
    return normalize_card(
        {
            "kind": "tool_step",
            "title": getattr(step, "tool_name", "tool_step"),
            "body": getattr(step, "message", None) or getattr(step, "status", "completed"),
            "metadata": {
                "status": getattr(step, "status", "completed"),
                "arguments": getattr(step, "arguments", {}),
                "confirmation_state": getattr(step, "confirmation_state", "not_required"),
                "requires_confirmation": getattr(step, "requires_confirmation", False),
            },
        }
    )


def _capture_card_from_artifact(artifact: dict[str, Any], *, body: str | None = None, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    excerpt = body or _snippet(
        artifact.get("normalized_content") or artifact.get("extracted_content") or artifact.get("raw_content")
    )
    return normalize_card(
        {
            "kind": "capture_item",
            "title": artifact.get("title") or "Saved capture",
            "body": excerpt or "Capture saved to Starlog.",
            "entity_ref": _artifact_entity_ref(artifact),
            "metadata": {
                "artifact_id": artifact["id"],
                "source_type": artifact.get("source_type"),
                **(metadata or {}),
            },
        }
    )


def _knowledge_note_card(note: dict[str, Any], *, body: str | None = None, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return normalize_card(
        {
            "kind": "knowledge_note",
            "title": note.get("title") or "Note",
            "body": body or _snippet(note.get("body_md")),
            "entity_ref": _note_entity_ref(note),
            "metadata": {
                "note_id": note["id"],
                "version": note.get("version"),
                **(metadata or {}),
            },
        }
    )


def _task_list_card(tasks: list[dict[str, Any]], *, title: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    lines = []
    for task in tasks[:4]:
        due = f" due {task['due_at']}" if task.get("due_at") else ""
        lines.append(f"- {task.get('title') or task['id']} [{task.get('status') or 'todo'}]{due}")
    entity_ref = _task_entity_ref(tasks[0]) if len(tasks) == 1 else None
    return normalize_card(
        {
            "kind": "task_list",
            "title": title,
            "body": "\n".join(lines) or "No tasks matched yet.",
            "entity_ref": entity_ref,
            "metadata": {
                "task_count": len(tasks),
                "task_ids": [task["id"] for task in tasks[:6]],
                **(metadata or {}),
            },
        }
    )


def _review_queue_card(cards: list[dict[str, Any]], *, title: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    first = cards[0] if cards else None
    mode_counts = review_mode_service.mode_counts_for_cards(cards)
    primary_mode = review_mode_service.primary_mode_for_counts(mode_counts)
    mode_summary = review_mode_service.review_queue_summary(mode_counts)
    body = mode_summary or f"{len(cards)} card{'s' if len(cards) != 1 else ''} ready now."
    if first:
        body = f"{body}\n{first.get('prompt') or 'Open Review to continue.'}"
    return normalize_card(
        {
            "kind": "review_queue",
            "title": title,
            "body": body,
            "entity_ref": _card_entity_ref(first) if first else None,
            "metadata": {
                "due_count": len(cards),
                "card_id": first.get("id") if first else None,
                "prompt": first.get("prompt") if first else None,
                "answer": first.get("answer") if first else None,
                "card_type": first.get("card_type") if first else None,
                "review_mode": review_mode_service.review_mode_for_card_type(first.get("card_type")) if first else primary_mode,
                "mode_counts": mode_counts,
                "primary_mode": primary_mode,
                **(metadata or {}),
            },
        }
    )


def _briefing_card(briefing: dict[str, Any], *, title: str = "Briefing") -> dict[str, Any]:
    audio_ref = str(briefing.get("audio_ref") or "").strip() or None
    return normalize_card(
        {
            "kind": "briefing",
            "title": title,
            "body": _snippet(briefing.get("text"), limit=260) or "Briefing ready.",
            "entity_ref": _briefing_entity_ref(briefing),
            "metadata": {
                "briefing_id": briefing["id"],
                "date": briefing.get("date"),
                "audio_ref": audio_ref,
                "audio_content_url": _media_content_url(audio_ref),
            },
        }
    )


def _memory_suggestion_card(suggestion: dict[str, Any], *, page: dict[str, Any] | None = None) -> dict[str, Any]:
    entity_ref = _memory_page_entity_ref(page) if page is not None else {
        "entity_type": str(suggestion.get("entity_type") or "memory_suggestion"),
        "entity_id": str(suggestion.get("entity_id") or suggestion["id"]),
        "href": "/notes/memory",
        "title": suggestion.get("title") or "Memory suggestion",
    }
    metadata = {
        "suggestion_id": suggestion["id"],
        "suggestion_type": suggestion.get("suggestion_type"),
        "weight": suggestion.get("weight"),
        "page_id": suggestion.get("page_id"),
        "page_path": page.get("path") if page else None,
        "proposal_id": suggestion["entity_id"] if suggestion.get("entity_type") == "profile_proposal" else None,
        **(suggestion.get("metadata") if isinstance(suggestion.get("metadata"), dict) else {}),
    }
    return normalize_card(
        {
            "kind": "memory_suggestion",
            "title": suggestion.get("title") or "Memory suggestion",
            "body": suggestion.get("body") or "",
            "entity_ref": entity_ref,
            "metadata": metadata,
        }
    )


def memory_suggestion_cards(conn: Connection, *, surface: str, limit: int = 2) -> list[dict[str, Any]]:
    suggestions = memory_vault_service.list_suggestions(conn, surface=surface, refresh=True)[:limit]
    cards: list[dict[str, Any]] = []
    for suggestion in suggestions:
        page = None
        page_id = suggestion.get("page_id")
        if isinstance(page_id, str) and page_id.strip():
            page = memory_vault_service.get_page(conn, page_id, record_access=False)
        cards.append(_memory_suggestion_card(suggestion, page=page))
    return cards


def project_step_cards(conn: Connection, step: Any) -> list[dict[str, Any]]:
    tool_name = str(getattr(step, "tool_name", "") or "")
    result = getattr(step, "result", {})
    result_dict = result if isinstance(result, dict) else {}

    if tool_name == "capture_text_as_artifact" and isinstance(result_dict.get("artifact"), dict):
        return [_capture_card_from_artifact(result_dict["artifact"])]

    if tool_name == "run_artifact_action":
        artifact_id = str(result_dict.get("artifact_id") or getattr(step, "arguments", {}).get("artifact_id") or "").strip()
        action = str(result_dict.get("action") or getattr(step, "arguments", {}).get("action") or "").strip()
        artifact = artifacts_service.get_artifact(conn, artifact_id) if artifact_id else None
        graph = artifacts_service.get_artifact_graph(conn, artifact_id) if artifact_id else None
        if action == "summarize" and graph and graph.get("summaries"):
            summary = graph["summaries"][0]
            note_like = {"id": summary["id"], "title": artifact.get("title") if artifact else "Summary", "body_md": summary.get("content"), "version": summary.get("version")}
            return [_knowledge_note_card(note_like, metadata={"artifact_id": artifact_id, "summary_id": summary["id"]})]
        if action == "cards" and graph and graph.get("cards"):
            return [_review_queue_card(graph["cards"], title=f"Review from {artifact.get('title') or 'capture'}", metadata={"artifact_id": artifact_id})]
        if action == "tasks" and graph and graph.get("tasks"):
            return [_task_list_card(graph["tasks"], title=f"Next actions from {artifact.get('title') or 'capture'}", metadata={"artifact_id": artifact_id})]
        if action == "append_note" and graph and graph.get("notes"):
            return [_knowledge_note_card(graph["notes"][0], metadata={"artifact_id": artifact_id})]
        if artifact:
            status = str(result_dict.get("status") or getattr(step, "status", "completed")).replace("_", " ")
            return [_capture_card_from_artifact(artifact, body=f"{action.replace('_', ' ')} {status}.")]

    if tool_name in {"create_note", "update_note", "get_note"} and isinstance(result_dict.get("note"), dict):
        return [_knowledge_note_card(result_dict["note"])]

    if tool_name == "list_notes":
        notes = result_dict.get("notes") if isinstance(result_dict.get("notes"), list) else []
        if notes:
            return [_knowledge_note_card(notes[0], body=f"{len(notes)} note{'s' if len(notes) != 1 else ''} available. {_snippet(notes[0].get('body_md'))}")]

    if tool_name in {"create_task", "update_task"} and isinstance(result_dict.get("task"), dict):
        task = result_dict["task"]
        return [_task_list_card([task], title="Task updated")]

    if tool_name == "list_tasks":
        tasks = result_dict.get("tasks") if isinstance(result_dict.get("tasks"), list) else []
        return [_task_list_card(tasks, title="Current plan")]

    if tool_name in {"generate_time_blocks", "list_calendar_events"}:
        generated = result_dict.get("generated") if isinstance(result_dict.get("generated"), list) else result_dict.get("events")
        items = generated if isinstance(generated, list) else []
        pseudo_tasks = [
            {
                "id": str(item.get("id") or index),
                "title": item.get("title") or "Planned block",
                "status": "scheduled",
                "due_at": item.get("starts_at") or item.get("ends_at"),
            }
            for index, item in enumerate(items)
            if isinstance(item, dict)
        ]
        return [_task_list_card(pseudo_tasks, title="Planner updates", metadata={"projection": tool_name})]

    if tool_name == "create_calendar_event" and isinstance(result_dict.get("event"), dict):
        event = result_dict["event"]
        pseudo_task = {
            "id": event["id"],
            "title": event.get("title") or "Calendar event",
            "status": "scheduled",
            "due_at": event.get("starts_at"),
        }
        return [_task_list_card([pseudo_task], title="Planner update")]

    if tool_name in {"generate_briefing", "render_briefing_audio", "schedule_morning_brief_alarm"} and isinstance(result_dict.get("briefing"), dict):
        title = "Briefing ready"
        if tool_name == "render_briefing_audio":
            title = "Briefing audio"
        if tool_name == "schedule_morning_brief_alarm":
            title = "Morning briefing"
        return [_briefing_card(result_dict["briefing"], title=title)]

    if tool_name == "list_due_cards":
        cards = result_dict if isinstance(result, list) else result_dict.get("cards")
        due_cards = cards if isinstance(cards, list) else []
        return [_review_queue_card(due_cards, title="Review queue")]

    if tool_name == "search_starlog":
        rows = result if isinstance(result, list) else result_dict.get("results")
        results = rows if isinstance(rows, list) else []
        if results:
            first = results[0]
            if isinstance(first, dict) and first.get("kind") == "note":
                note = {"id": first["id"], "title": first.get("title") or "Note", "body_md": first.get("snippet") or "", "version": first.get("metadata", {}).get("version")}
                return [_knowledge_note_card(note, body=first.get("snippet") or "", metadata={"search_result": True})]
            if isinstance(first, dict) and first.get("kind") == "task":
                task = {"id": first["id"], "title": first.get("title") or "Task", "status": first.get("metadata", {}).get("status") or "todo", "due_at": None}
                return [_task_list_card([task], title="Planner match", metadata={"search_result": True})]
            if isinstance(first, dict) and first.get("kind") == "artifact":
                artifact = artifacts_service.get_artifact(conn, str(first["id"]))
                if artifact:
                    return [_capture_card_from_artifact(artifact, body=first.get("snippet") or "", metadata={"search_result": True})]
        return []

    if tool_name == "get_artifact_graph" and isinstance(result_dict.get("graph"), dict):
        graph = result_dict["graph"]
        artifact = graph.get("artifact") if isinstance(graph.get("artifact"), dict) else None
        if artifact:
            return [_capture_card_from_artifact(artifact)]

    return []


def project_agent_response_cards(conn: Connection, response: Any) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = [_assistant_summary_card(response)]
    projected_primary = False
    for step in getattr(response, "steps", []):
        step_cards = project_step_cards(conn, step)
        if step_cards:
            projected_primary = True
            cards.extend(step_cards)
    for step in getattr(response, "steps", []):
        cards.append(_tool_step_card(step))
    if projected_primary:
        return cards
    return cards
