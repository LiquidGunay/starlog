from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from types import ModuleType
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

AI_RUNTIME_ROOT = Path(__file__).resolve().parents[3] / "ai-runtime"

AI_RUNTIME_DEFAULT_MODEL = "gpt-5.4-nano"
AI_RUNTIME_BASE_ENV = "STARLOG_AI_RUNTIME_BASE_URL"
AI_RUNTIME_EXECUTE_PATH = "/v1/execute"
AI_RUNTIME_CHAT_EXECUTE_PATH = "/v1/chat/execute"
AI_RUNTIME_EXECUTE_TIMEOUT_SECONDS = 8.0
AI_RUNTIME_EXECUTE_RETRIES = 2
AI_RUNTIME_CHAT_EXECUTE_TIMEOUT_SECONDS = 8.0
AI_RUNTIME_CHAT_EXECUTE_RETRIES = 2
AI_RUNTIME_PREVIEW_TIMEOUT_SECONDS = 5.0
AI_RUNTIME_PREVIEW_RETRIES = 2
_RUNTIME_WORKFLOWS_MODULE: ModuleType | None = None


class RuntimeServiceError(Exception):
    pass


def _runtime_workflows() -> ModuleType:
    global _RUNTIME_WORKFLOWS_MODULE

    if _RUNTIME_WORKFLOWS_MODULE is not None:
        return _RUNTIME_WORKFLOWS_MODULE

    if str(AI_RUNTIME_ROOT) not in sys.path:
        sys.path.insert(0, str(AI_RUNTIME_ROOT))

    try:
        _RUNTIME_WORKFLOWS_MODULE = importlib.import_module("runtime_app.workflows")
    except ModuleNotFoundError as exc:
        raise RuntimeServiceError(
            "Local AI runtime workflows are unavailable. Configure "
            f"{AI_RUNTIME_BASE_ENV} or ship services/ai-runtime with this deployment."
        ) from exc
    return _RUNTIME_WORKFLOWS_MODULE


def _valid_url(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _runtime_url(path: str) -> str | None:
    base = os.environ.get(AI_RUNTIME_BASE_ENV, "").strip()
    if not _valid_url(base):
        return None
    return f"{base.rstrip('/')}{path}"


def capability_prompts(capability: str, payload: dict) -> tuple[str, str]:
    return _runtime_workflows().capability_request_spec(capability, payload)


def _local_preview_workflow(workflow: str, payload: dict) -> dict:
    workflows = _runtime_workflows()
    title = str(payload.get("title") or "").strip() or None
    text = str(payload.get("text") or payload.get("content") or payload.get("text_hint") or "").strip()
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    if workflow == "chat_turn":
        preview = workflows.chat_preview(title, text, context)
    elif workflow == "briefing":
        preview = workflows.briefing_preview(title, text, context)
    elif workflow == "research_digest":
        preview = workflows.research_digest_preview(title, text, context)
    else:
        raise RuntimeServiceError(f"Unsupported preview workflow: {workflow}")
    return {
        **preview.model_dump(mode="json"),
        "provider_used": "local_prompt_preview",
    }


def preview_workflow(workflow: str, payload: dict) -> dict:
    config: dict[str, str] = {
        "chat_turn": "/v1/chat/preview",
        "briefing": "/v1/briefings/preview",
        "research_digest": "/v1/research/digests/preview",
    }
    path = config.get(workflow)
    if path is None:
        raise RuntimeServiceError(f"Unsupported preview workflow: {workflow}")

    url = _runtime_url(path)
    if not url:
        return _local_preview_workflow(workflow, payload)

    title = str(payload.get("title") or "").strip()
    text = str(payload.get("text") or payload.get("content") or payload.get("text_hint") or "").strip()
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    request = Request(
        url,
        data=json.dumps({"title": title, "text": text, "context": context}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    last_error: Exception | None = None
    for _attempt in range(AI_RUNTIME_PREVIEW_RETRIES):
        try:
            with urlopen(request, timeout=AI_RUNTIME_PREVIEW_TIMEOUT_SECONDS) as response:  # noqa: S310
                body = response.read().decode("utf-8")
            decoded = json.loads(body)
            if not isinstance(decoded, dict):
                raise RuntimeServiceError("AI runtime returned a non-object preview payload")
            return {
                "provider_used": "ai_runtime",
                "workflow": str(decoded.get("workflow") or workflow),
                "model": str(decoded.get("model") or AI_RUNTIME_DEFAULT_MODEL),
                "system_prompt": str(decoded.get("system_prompt") or ""),
                "user_prompt": str(decoded.get("user_prompt") or ""),
                "context": decoded.get("context") if isinstance(decoded.get("context"), dict) else context,
            }
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeServiceError(f"AI runtime HTTP {exc.code}: {detail or 'request failed'}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc

    if last_error is not None:
        raise RuntimeServiceError(f"AI runtime preview request failed: {last_error}") from last_error
    raise RuntimeServiceError("AI runtime preview request failed")


def execute_chat_turn(payload: dict) -> dict:
    url = _runtime_url(AI_RUNTIME_CHAT_EXECUTE_PATH)
    title = str(payload.get("title") or "Primary Starlog Thread").strip() or "Primary Starlog Thread"
    text = str(payload.get("text") or payload.get("content") or payload.get("text_hint") or "").strip()
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    if not url:
        result = _runtime_workflows().execute_chat_turn(title, text, context).model_dump(mode="json")
        result["provider_used"] = "local_prompt_preview"
        return result

    request = Request(
        url,
        data=json.dumps({"title": title, "text": text, "context": context}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    last_error: Exception | None = None
    for _attempt in range(AI_RUNTIME_CHAT_EXECUTE_RETRIES):
        try:
            with urlopen(request, timeout=AI_RUNTIME_CHAT_EXECUTE_TIMEOUT_SECONDS) as response:  # noqa: S310
                body = response.read().decode("utf-8")
            decoded = json.loads(body)
            if not isinstance(decoded, dict):
                raise RuntimeServiceError("AI runtime returned a non-object chat payload")
            return {
                "workflow": str(decoded.get("workflow") or "chat_turn"),
                "provider_used": str(decoded.get("provider_used") or "ai_runtime"),
                "model": str(decoded.get("model") or AI_RUNTIME_DEFAULT_MODEL),
                "system_prompt": str(decoded.get("system_prompt") or ""),
                "user_prompt": str(decoded.get("user_prompt") or ""),
                "response_text": str(decoded.get("response_text") or ""),
                "cards": decoded.get("cards") if isinstance(decoded.get("cards"), list) else [],
                "tool_calls": decoded.get("tool_calls") if isinstance(decoded.get("tool_calls"), list) else [],
                "interrupts": decoded.get("interrupts") if isinstance(decoded.get("interrupts"), list) else [],
                "ambient_updates": decoded.get("ambient_updates") if isinstance(decoded.get("ambient_updates"), list) else [],
                "attachments": decoded.get("attachments") if isinstance(decoded.get("attachments"), list) else [],
                "session_state": decoded.get("session_state") if isinstance(decoded.get("session_state"), dict) else {},
                "metadata": decoded.get("metadata") if isinstance(decoded.get("metadata"), dict) else {},
            }
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeServiceError(f"AI runtime HTTP {exc.code}: {detail or 'request failed'}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc

    if last_error is not None:
        raise RuntimeServiceError(f"AI runtime chat request failed: {last_error}") from last_error
    raise RuntimeServiceError("AI runtime chat request failed")


def execute_runtime_capability(capability: str, payload: dict, prefer_local: bool) -> dict:
    url = _runtime_url(AI_RUNTIME_EXECUTE_PATH)
    if not url:
        result = _runtime_workflows().execute_capability(capability, payload).model_dump(mode="json")
        result["provider_used"] = "local_ai_runtime"
        return result

    request = Request(
        url,
        data=json.dumps({"capability": capability, "payload": payload, "prefer_local": prefer_local}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    last_error: Exception | None = None
    for _attempt in range(AI_RUNTIME_EXECUTE_RETRIES):
        try:
            with urlopen(request, timeout=AI_RUNTIME_EXECUTE_TIMEOUT_SECONDS) as response:  # noqa: S310
                body = response.read().decode("utf-8")
            decoded = json.loads(body)
            if not isinstance(decoded, dict):
                raise RuntimeServiceError("AI runtime returned a non-object execution payload")
            output = decoded.get("output")
            if not isinstance(output, dict):
                output = {}
            return {
                "provider_used": str(decoded.get("provider_used") or "ai_runtime"),
                "capability": str(decoded.get("capability") or capability),
                "model": str(decoded.get("model") or AI_RUNTIME_DEFAULT_MODEL),
                "system_prompt": str(decoded.get("system_prompt") or ""),
                "user_prompt": str(decoded.get("user_prompt") or ""),
                "output": output,
            }
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeServiceError(f"AI runtime HTTP {exc.code}: {detail or 'request failed'}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc

    if last_error is not None:
        raise RuntimeServiceError(f"AI runtime execution request failed: {last_error}") from last_error
    raise RuntimeServiceError("AI runtime execution request failed")
