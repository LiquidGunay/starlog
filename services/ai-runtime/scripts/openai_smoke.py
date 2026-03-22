from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from runtime_app.workflows import briefing_preview, chat_preview, research_digest_preview


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    return ""


def _load_context() -> dict[str, object]:
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


def build_request_payload(model: str) -> tuple[str, dict[str, object]]:
    workflow, prompt = _build_input()
    return workflow, {"model": model, "input": prompt}


def main() -> int:
    api_key = _env("OPENAI_API_KEY") or _env("STARLOG_OPENAI_API_KEY")
    if not api_key:
        print("Missing OPENAI_API_KEY or STARLOG_OPENAI_API_KEY", file=sys.stderr)
        return 2

    model = _env("STARLOG_OPENAI_MODEL") or "gpt-5.4-nano"
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

    print(json.dumps({"workflow": workflow, "model": model, "id": payload.get("id"), "status": "ok"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
