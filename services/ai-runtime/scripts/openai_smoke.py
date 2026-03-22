from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


_PING_PROMPT = (
    "Reply with JSON only using keys status and summary. "
    "Set status to ok if the model is reachable."
)

_WORKFLOW_PROMPTS = {
    "chat_turn": "You are validating the voice-native chat turn workflow.",
    "briefing": "You are validating the daily briefing workflow.",
    "research_digest": "You are validating the research digest workflow.",
}


def _load_context() -> dict[str, Any]:
    raw_context = os.getenv("STARLOG_OPENAI_SMOKE_CONTEXT", "").strip()
    if not raw_context:
        return {}

    context = json.loads(raw_context)
    if not isinstance(context, dict):
        raise ValueError("STARLOG_OPENAI_SMOKE_CONTEXT must decode to a JSON object")
    return context


def _build_input(workflow: str) -> str:
    if workflow == "ping":
        return _PING_PROMPT

    if workflow not in _WORKFLOW_PROMPTS:
        raise ValueError(f"Unsupported smoke workflow: {workflow}")

    title = os.getenv("STARLOG_OPENAI_SMOKE_TITLE", "Smoke workflow")
    text = os.getenv("STARLOG_OPENAI_SMOKE_TEXT", "Confirm the workflow can run.")
    context = _load_context()

    return "\n".join(
        [
            f"Workflow: {workflow}",
            _WORKFLOW_PROMPTS[workflow],
            f"Title: {title}",
            f"Text: {text}",
            f"Context: {json.dumps(context, sort_keys=True)}",
            "Reply with JSON only using keys status, workflow, and summary.",
        ]
    )


def build_request_payload(model: str) -> tuple[str, dict[str, Any]]:
    workflow = os.getenv("STARLOG_OPENAI_SMOKE_WORKFLOW", "ping").strip() or "ping"
    return workflow, {"model": model, "input": _build_input(workflow)}


def _extract_output_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text:
        return output_text

    collected: list[str] = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            text_value = content.get("text")
            if isinstance(text_value, str):
                collected.append(text_value)
    return "\n".join(collected)


def main() -> int:
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("STARLOG_OPENAI_API_KEY")
    if not api_key:
        print("Missing OPENAI_API_KEY or STARLOG_OPENAI_API_KEY.", file=sys.stderr)
        return 1

    model = os.getenv("OPENAI_MODEL", "gpt-5.4-nano")
    workflow, request_payload = build_request_payload(model)
    request_body = json.dumps(request_payload).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=request_body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_text = exc.read().decode("utf-8", errors="replace")
        print(json.dumps({"status": "error", "workflow": workflow, "error": error_text}))
        return 1

    print(
        json.dumps(
            {
                "status": "ok",
                "workflow": workflow,
                "model": model,
                "response_id": response_payload.get("id"),
                "output_text": _extract_output_text(response_payload),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
