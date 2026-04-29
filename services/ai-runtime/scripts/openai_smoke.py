from __future__ import annotations

import json
import os
import sys
from typing import Any
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))

from runtime_app.workflows import briefing_preview, chat_preview, research_digest_preview


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    return ""


def _load_context() -> dict[str, Any]:
    raw = _env("STARLOG_OPENAI_SMOKE_CONTEXT")
    if not raw:
        return {}
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("STARLOG_OPENAI_SMOKE_CONTEXT must decode to a JSON object")
    return payload


def _build_input() -> tuple[str, str]:
    workflow = (_env("STARLOG_OPENAI_SMOKE_WORKFLOW") or "ping").strip().lower()
    if workflow == "chat_turn":
        preview = chat_preview(
            _env("STARLOG_OPENAI_SMOKE_TITLE") or "Smoke Chat",
            _env("STARLOG_OPENAI_SMOKE_TEXT") or "Summarize the latest artifact.",
            _load_context(),
        )
    elif workflow == "briefing":
        preview = briefing_preview(
            _env("STARLOG_OPENAI_SMOKE_TITLE") or "Smoke Briefing",
            _env("STARLOG_OPENAI_SMOKE_TEXT") or "Summarize today's priorities and schedule.",
            _load_context(),
        )
    elif workflow == "research_digest":
        preview = research_digest_preview(
            _env("STARLOG_OPENAI_SMOKE_TITLE") or "Smoke Research Digest",
            _env("STARLOG_OPENAI_SMOKE_TEXT") or "Rank and summarize the top papers.",
            _load_context(),
        )
    else:
        return "ping", 'Reply with JSON only: {"status":"ok","surface":"starlog-ai-runtime"}'

    prompt = "\n\n".join(
        [
            f"Workflow: {preview.workflow}",
            "System prompt:",
            preview.system_prompt,
            "User prompt:",
            preview.user_prompt,
            'Reply with JSON only: {"status":"ok","surface":"starlog-ai-runtime"}',
        ]
    )
    return preview.workflow, prompt


def build_request_payload(model: str) -> tuple[str, dict[str, Any]]:
    workflow, prompt = _build_input()
    return workflow, {"model": model, "input": prompt}


def _extract_output_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text:
        return output_text

    collected: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            text_value = content.get("text")
            if isinstance(text_value, str):
                collected.append(text_value)
    return "\n".join(collected)


def main() -> int:
    api_key = _env("OPENAI_API_KEY") or _env("STARLOG_OPENAI_API_KEY")
    if not api_key:
        print("Missing OPENAI_API_KEY or STARLOG_OPENAI_API_KEY", file=sys.stderr)
        return 2

    model = _env("STARLOG_OPENAI_MODEL") or _env("OPENAI_MODEL") or "gpt-5.4-mini"
    try:
        workflow, request_payload = build_request_payload(model)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=30.0) as response:  # noqa: S310
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        print(exc.read().decode("utf-8", errors="ignore"), file=sys.stderr)
        return exc.code
    except URLError as exc:
        print(str(exc.reason), file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "status": "ok",
                "workflow": workflow,
                "model": model,
                "response_id": payload.get("id"),
                "output_text": _extract_output_text(payload),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
