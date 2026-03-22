import json
import os
from pathlib import Path
from sqlite3 import Connection
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from app.services import integrations_service


class ProviderError(Exception):
    pass


LLM_CAPABILITIES = {"llm_summary", "llm_cards", "llm_tasks", "llm_agent_plan"}
PROMPTS_ROOT = Path(__file__).resolve().parents[3] / "ai-runtime" / "prompts"
AI_RUNTIME_DEFAULT_MODEL = "gpt-5.4-nano"
AI_RUNTIME_BASE_ENV = "STARLOG_AI_RUNTIME_BASE_URL"
AI_RUNTIME_PREVIEW_TIMEOUT_SECONDS = 5.0
AI_RUNTIME_PREVIEW_RETRIES = 2

PREVIEW_WORKFLOWS: dict[str, dict[str, str]] = {
    "chat_turn": {
        "path": "/v1/chat/preview",
        "system_prompt": "chat_turn.system.txt",
        "user_prompt": "chat_turn.user.txt",
        "default_title": "Primary Starlog Thread",
    },
    "briefing": {
        "path": "/v1/briefings/preview",
        "system_prompt": "briefing.system.txt",
        "user_prompt": "briefing.user.txt",
        "default_title": "Daily briefing",
    },
    "research_digest": {
        "path": "/v1/research/digests/preview",
        "system_prompt": "research_digest.system.txt",
        "user_prompt": "research_digest.user.txt",
        "default_title": "Research digest",
    },
}


class _SafePromptDict(dict[str, object]):
    def __missing__(self, key: str) -> str:
        return ""


def _load_prompt(name: str) -> str:
    return (PROMPTS_ROOT / name).read_text(encoding="utf-8").strip()


def _render_prompt(name: str, **kwargs: object) -> str:
    rendered_kwargs = {key: _format_prompt_value(value) for key, value in kwargs.items()}
    return _load_prompt(name).format_map(_SafePromptDict(rendered_kwargs))


def _format_prompt_value(value: object) -> object:
    if isinstance(value, (dict, list)):
        return json.dumps(value, indent=2, sort_keys=True)
    return value


def _text_source(payload: dict) -> str:
    return str(payload.get("text") or payload.get("content") or payload.get("text_hint") or "").strip()


def _valid_url(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _provider_record(conn: Connection | None, provider_name: str) -> dict | None:
    if conn is None:
        return None
    provider = integrations_service.get_provider_config(conn, provider_name, redact=False)
    if provider is None or not provider["enabled"]:
        return None
    return provider


def _config_endpoint(config: dict, path_key: str, default_suffix: str) -> str | None:
    explicit = str(config.get(path_key) or "").strip()
    if _valid_url(explicit):
        return explicit

    base = str(config.get("endpoint") or config.get("bridge_url") or config.get("base_url") or "").strip()
    if not _valid_url(base):
        return None
    if base.endswith(default_suffix):
        return base
    if base.endswith("/v1"):
        return f"{base}{default_suffix}"
    if urlparse(base).path in {"", "/"}:
        return f"{base.rstrip('/')}/v1{default_suffix}"
    return f"{base.rstrip('/')}{default_suffix}"


def _extract_message_text(payload: object) -> str:
    if isinstance(payload, str):
        return payload
    if not isinstance(payload, dict):
        return ""

    if isinstance(payload.get("output_text"), str):
        return str(payload["output_text"])
    if isinstance(payload.get("text"), str):
        return str(payload["text"])

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str):
                    return content
                if isinstance(content, list):
                    parts: list[str] = []
                    for item in content:
                        if isinstance(item, dict) and isinstance(item.get("text"), str):
                            parts.append(str(item["text"]))
                    return "\n".join(parts).strip()
            if isinstance(first.get("text"), str):
                return str(first["text"])

    response = payload.get("response")
    if isinstance(response, dict):
        return _extract_message_text(response)
    return ""


def _parse_json_object(text: str) -> dict:
    if not text.strip():
        return {}
    try:
        loaded = json.loads(text)
        return loaded if isinstance(loaded, dict) else {}
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return {}

    try:
        loaded = json.loads(text[start : end + 1])
        return loaded if isinstance(loaded, dict) else {}
    except json.JSONDecodeError:
        return {}


def _request_spec(capability: str, payload: dict) -> tuple[str, str]:
    source_text = _text_source(payload)
    title = str(payload.get("title") or "Untitled artifact").strip()

    if capability == "llm_summary":
        return (
            _load_prompt("llm_summary.system.txt"),
            _render_prompt("llm_summary.user.txt", title=title, text=source_text),
        )

    if capability == "llm_cards":
        return (
            _load_prompt("llm_cards.system.txt"),
            _render_prompt("llm_cards.user.txt", title=title, text=source_text),
        )

    if capability == "llm_tasks":
        return (
            _load_prompt("llm_tasks.system.txt"),
            _render_prompt("llm_tasks.user.txt", title=title, text=source_text),
        )

    if capability == "llm_agent_plan":
        intents = payload.get("intents", [])
        intent_lines = []
        if isinstance(intents, list):
            for item in intents:
                if not isinstance(item, dict):
                    continue
                examples = item.get("examples")
                examples_text = ", ".join(str(entry) for entry in examples) if isinstance(examples, list) else ""
                intent_lines.append(
                    f"- {item.get('name', 'unknown')}: {item.get('description', '')} Examples: {examples_text}"
                )
        tools = payload.get("tool_catalog", [])
        tool_lines = []
        if isinstance(tools, list):
            for item in tools:
                if not isinstance(item, dict):
                    continue
                tool_lines.append(
                    f"- {item.get('name', 'unknown')}: {item.get('description', '')} Parameters schema: {json.dumps(item.get('parameters_schema', {}), sort_keys=True)}"
                )
        return (
            _load_prompt("llm_agent_plan.system.txt"),
            _render_prompt(
                "llm_agent_plan.user.txt",
                current_date=str(payload.get("current_date") or "unknown"),
                command=str(payload.get("command") or source_text),
                intent_lines="\n".join(intent_lines) if intent_lines else "- none provided",
                tool_lines="\n".join(tool_lines) if tool_lines else "- none provided",
            ),
        )

    return ("", source_text)


def _runtime_preview_url(path: str) -> str | None:
    base = os.environ.get(AI_RUNTIME_BASE_ENV, "").strip()
    if not _valid_url(base):
        return None
    return f"{base.rstrip('/')}{path}"


def _invoke_runtime_preview(workflow: str, payload: dict) -> dict:
    config = PREVIEW_WORKFLOWS.get(workflow)
    if config is None:
        raise ProviderError(f"Unsupported preview workflow: {workflow}")

    url = _runtime_preview_url(config["path"])
    title = str(payload.get("title") or config["default_title"]).strip() or config["default_title"]
    text = _text_source(payload)
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}

    if not url:
        return {
            "workflow": workflow,
            "provider_used": "local_prompt_preview",
            "model": AI_RUNTIME_DEFAULT_MODEL,
            "system_prompt": _load_prompt(config["system_prompt"]),
            "user_prompt": _render_prompt(
                config["user_prompt"],
                title=title,
                text=text,
                context=_format_prompt_value(context),
            ),
            "context": context,
        }

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
                raise ProviderError("AI runtime returned a non-object preview payload")
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
            raise ProviderError(f"AI runtime HTTP {exc.code}: {detail or 'request failed'}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc

    if last_error is not None:
        raise ProviderError(f"AI runtime preview request failed: {last_error}") from last_error
    raise ProviderError("AI runtime preview request failed")


def preview_workflow(workflow: str, payload: dict) -> dict:
    return _invoke_runtime_preview(workflow, payload)


def _invoke_openai_compatible(provider_name: str, config: dict, capability: str, payload: dict) -> dict:
    url = _config_endpoint(config, "chat_completions_url", "/chat/completions")
    if not url:
        raise ProviderError(f"{provider_name} missing chat completion endpoint")

    headers = {"Content-Type": "application/json", **integrations_service.build_auth_headers(config)}
    model = str(config.get("model") or payload.get("model") or "default").strip() or "default"
    system_prompt, user_prompt = _request_spec(capability, payload)

    request_payload = {
        "model": model,
        "temperature": float(config.get("temperature") or 0.2),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    request = Request(
        url,
        data=json.dumps(request_payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=8.0) as response:  # noqa: S310
            body = response.read().decode("utf-8")
    except HTTPError as exc:  # pragma: no cover - exercised via error handling
        detail = exc.read().decode("utf-8", errors="ignore")
        raise ProviderError(f"{provider_name} HTTP {exc.code}: {detail or 'request failed'}") from exc
    except URLError as exc:  # pragma: no cover - exercised via error handling
        raise ProviderError(f"{provider_name} request failed: {exc.reason}") from exc
    except TimeoutError as exc:  # pragma: no cover - exercised via error handling
        raise ProviderError(f"{provider_name} request timed out") from exc

    try:
        decoded = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ProviderError(f"{provider_name} returned invalid JSON") from exc

    text = _extract_message_text(decoded).strip()
    structured = decoded if isinstance(decoded, dict) else {}
    if capability in {"llm_cards", "llm_tasks"}:
        parsed_text = _parse_json_object(text)
        if parsed_text:
            structured = {**structured, **parsed_text}

    return {
        "provider": provider_name,
        "model": model,
        "text": text,
        **structured,
    }


def _local_provider(conn: Connection | None, capability: str, payload: dict) -> dict:
    if capability == "ocr":
        return {
            "text": payload.get("text_hint", ""),
            "mode": "on_device_required",
        }

    local_provider = _provider_record(conn, "local_llm")
    if capability in LLM_CAPABILITIES and local_provider is not None:
        config = dict(local_provider["config"])
        config.setdefault("model", payload.get("model") or "local-default")
        return _invoke_openai_compatible("local_llm", config, capability, payload)

    if capability in {"llm_summary", "llm_cards", "llm_tasks"}:
        source = _text_source(payload)
        excerpt = source[:240] if source else ""
        return {
            "suggestion": f"Local draft for {capability}",
            "excerpt": excerpt,
        }

    if capability == "stt":
        return {"transcript": payload.get("text_hint", "")}

    if capability == "tts":
        return {"audio_ref": payload.get("audio_ref", "local://generated")}

    raise ProviderError("Unsupported capability")


def _codex_bridge_provider(conn: Connection | None, capability: str, payload: dict) -> dict:
    if capability not in LLM_CAPABILITIES:
        raise ProviderError(f"Codex bridge unavailable for capability {capability}")

    if conn is None:
        raise ProviderError("Codex bridge requires an active provider configuration")

    config, missing_requirements = integrations_service.codex_bridge_runtime_config(conn)
    if config is None:
        detail = missing_requirements[0] if missing_requirements else "Codex bridge is unavailable"
        raise ProviderError(detail)

    config = dict(config)
    config.setdefault("model", payload.get("model") or "gpt-4.1-mini")
    return _invoke_openai_compatible("codex_bridge", config, capability, payload)


def _api_provider(conn: Connection | None, capability: str, payload: dict) -> dict:
    if capability == "ocr":
        raise ProviderError("OCR is strict on-device only")

    if capability in LLM_CAPABILITIES:
        provider = _provider_record(conn, "api_llm")
        if provider is not None:
            config = dict(provider["config"])
            config.setdefault("model", payload.get("model") or "fallback-model")
            return _invoke_openai_compatible("api_llm", config, capability, payload)

        return {
            "provider": "api_fallback",
            "model": payload.get("model", "fallback-model"),
            "capability": capability,
        }

    if capability == "stt":
        return {"provider": "api_fallback", "transcript": payload.get("text_hint", "")}
    if capability == "tts":
        return {"provider": "api_fallback", "audio_ref": payload.get("audio_ref", "remote://generated")}

    raise ProviderError("Unsupported capability")


def run(
    conn: Connection | None,
    capability: str,
    payload: dict,
    prefer_local: bool,
) -> tuple[str, Literal["ok", "fallback", "failed"], dict]:
    execution_order = (
        integrations_service.capability_execution_order(
            conn,
            capability,
            executable_targets={"mobile_bridge", "desktop_bridge", "api"},
            prefer_local=prefer_local,
        )
        if conn is not None
        else (["mobile_bridge", "desktop_bridge", "api"] if prefer_local else ["api"])
    )

    for target in execution_order:
        try:
            if target in {"mobile_bridge", "desktop_bridge"}:
                # Bridge targets run via queued workers; synchronous API execution keeps walking.
                continue
            if target == "api":
                output = _api_provider(conn, capability, payload)
                return "api", "fallback", output
        except ProviderError:
            continue

    return "none", "failed", {}
