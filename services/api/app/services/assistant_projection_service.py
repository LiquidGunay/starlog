from __future__ import annotations

from typing import Any

from app.services import conversation_card_service
from app.services.common import new_id


def text_part(text: str) -> dict[str, Any]:
    return {
        "type": "text",
        "id": new_id("part"),
        "text": text,
    }


def card_part(card: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "card",
        "id": new_id("part"),
        "card": conversation_card_service.normalize_card(card),
    }


def tool_call_part(*, tool_name: str, tool_kind: str, status: str, arguments: dict[str, Any], title: str | None = None, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "type": "tool_call",
        "id": new_id("part"),
        "tool_call": {
            "id": new_id("tool"),
            "tool_name": tool_name,
            "tool_kind": tool_kind,
            "status": status,
            "arguments": arguments,
            "title": title,
            "metadata": metadata or {},
        },
    }


def tool_result_part(*, tool_call_id: str, status: str, output: dict[str, Any], metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "type": "tool_result",
        "id": new_id("part"),
        "tool_result": {
            "id": new_id("tool_result"),
            "tool_call_id": tool_call_id,
            "status": status,
            "output": output,
            "metadata": metadata or {},
        },
    }


def status_part(status: str, label: str | None = None) -> dict[str, Any]:
    return {
        "type": "status",
        "id": new_id("part"),
        "status": status,
        "label": label,
    }


def interrupt_request_part(interrupt: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "interrupt_request",
        "id": new_id("part"),
        "interrupt": interrupt,
    }


def interrupt_resolution_part(resolution: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "interrupt_resolution",
        "id": new_id("part"),
        "resolution": resolution,
    }


def ambient_update_part(update: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "ambient_update",
        "id": new_id("part"),
        "update": update,
    }


def attachment_part(attachment: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "attachment",
        "id": new_id("part"),
        "attachment": attachment,
    }


def draft_task_card(*, title: str, priority: int = 3) -> dict[str, Any]:
    return conversation_card_service.normalize_card(
        {
            "kind": "task_list",
            "title": title,
            "body": f"- {title} [draft]",
            "metadata": {
                "draft": True,
                "priority": priority,
            },
        }
    )


def capture_triage_card(*, artifact: dict[str, Any]) -> dict[str, Any]:
    return conversation_card_service.normalize_card(
        {
            "kind": "capture_item",
            "title": artifact.get("title") or "New capture",
            "body": "Capture saved. Choose what Starlog should do with it next.",
            "entity_ref": {
                "entity_type": "artifact",
                "entity_id": str(artifact["id"]),
                "href": f"/notes?artifact={artifact['id']}",
                "title": artifact.get("title") or str(artifact["id"]),
            },
            "metadata": {
                "artifact_id": artifact["id"],
                "draft": True,
            },
        }
    )


def ambient_update(*, event_id: str, label: str, body: str | None = None, entity_ref: dict[str, Any] | None = None, actions: list[dict[str, Any]] | None = None, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": new_id("ambient"),
        "event_id": event_id,
        "label": label,
        "body": body,
        "entity_ref": entity_ref,
        "actions": actions or [],
        "metadata": metadata or {},
        "created_at": "",
    }


def legacy_projection_from_parts(parts: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    text_chunks: list[str] = []
    cards: list[dict[str, Any]] = []
    for part in parts:
        part_type = str(part.get("type") or "")
        if part_type == "text":
            text = str(part.get("text") or "").strip()
            if text:
                text_chunks.append(text)
        elif part_type == "card":
            card = part.get("card")
            if isinstance(card, dict):
                cards.append(conversation_card_service.normalize_card(card))
        elif part_type == "ambient_update":
            update = part.get("update")
            if isinstance(update, dict):
                label = str(update.get("label") or "").strip()
                body = str(update.get("body") or "").strip()
                text_chunks.append(" ".join(item for item in [label, body] if item).strip())
        elif part_type == "interrupt_request":
            interrupt = part.get("interrupt")
            if isinstance(interrupt, dict):
                title = str(interrupt.get("title") or "").strip()
                body = str(interrupt.get("body") or "").strip()
                text_chunks.append(" ".join(item for item in [title, body] if item).strip())
    return "\n\n".join(chunk for chunk in text_chunks if chunk).strip(), cards


def synthesize_parts_from_legacy(*, content: str, cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    if content.strip():
        parts.append(text_part(content))
    for card in cards:
        parts.append(card_part(card))
    return parts
