import json
from sqlite3 import Connection
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from app.services import ai_runtime_service, integrations_service


class ProviderError(Exception):
    pass


LLM_CAPABILITIES = {"llm_summary", "llm_cards", "llm_tasks", "llm_agent_plan"}
AI_RUNTIME_DEFAULT_MODEL = "gpt-5-mini"


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


def preview_workflow(workflow: str, payload: dict) -> dict:
    try:
        return ai_runtime_service.preview_workflow(workflow, payload)
    except ai_runtime_service.RuntimeServiceError as exc:
        raise ProviderError(str(exc)) from exc


def execute_chat_turn(payload: dict) -> dict:
    try:
        return ai_runtime_service.execute_chat_turn(payload)
    except ai_runtime_service.RuntimeServiceError as exc:
        raise ProviderError(str(exc)) from exc


def _invoke_openai_compatible(provider_name: str, config: dict, capability: str, payload: dict) -> dict:
    url = _config_endpoint(config, "chat_completions_url", "/chat/completions")
    if not url:
        raise ProviderError(f"{provider_name} missing chat completion endpoint")

    headers = {"Content-Type": "application/json", **integrations_service.build_auth_headers(config)}
    model = str(config.get("model") or payload.get("model") or "default").strip() or "default"
    system_prompt, user_prompt = ai_runtime_service.capability_prompts(capability, payload)

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
    parsed_text = _parse_json_object(text)
    if parsed_text:
        structured = {**structured, **parsed_text}

    return {
        "provider": provider_name,
        "model": model,
        "text": text,
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
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
    config.setdefault("model", payload.get("model") or "gpt-5-mini")
    return _invoke_openai_compatible("codex_bridge", config, capability, payload)


def _api_provider(conn: Connection | None, capability: str, payload: dict) -> dict:
    if capability == "ocr":
        raise ProviderError("OCR is strict on-device only")

    if capability in LLM_CAPABILITIES:
        try:
            return ai_runtime_service.execute_runtime_capability(capability, payload, prefer_local=True)
        except ai_runtime_service.RuntimeServiceError as exc:
            raise ProviderError(str(exc)) from exc

    if capability == "stt":
        return {"provider": "api_fallback", "transcript": payload.get("text_hint", "")}
    if capability == "tts":
        return {"provider": "api_fallback", "audio_ref": payload.get("audio_ref", "remote://generated")}

    raise ProviderError("Unsupported capability")


def _normalize_llm_output(capability: str, output: dict, *, default_provider: str) -> tuple[str, dict]:
    normalized_output = dict(output)
    provider = str(normalized_output.pop("provider", "") or default_provider)
    model = str(normalized_output.pop("model", "") or AI_RUNTIME_DEFAULT_MODEL)
    system_prompt = str(normalized_output.pop("system_prompt", "") or "")
    user_prompt = str(normalized_output.pop("user_prompt", "") or "")
    normalized_output["_runtime"] = {
        "capability": capability,
        "model": model,
        "provider_used": provider,
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
    }
    return provider, normalized_output


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
                if target == "desktop_bridge" and capability in LLM_CAPABILITIES:
                    output = _codex_bridge_provider(conn, capability, payload)
                    provider, normalized_output = _normalize_llm_output(
                        capability,
                        output,
                        default_provider="codex_bridge",
                    )
                    return provider, "ok", normalized_output
                # Other bridge targets run via queued workers; synchronous API execution keeps walking.
                continue
            if target == "api":
                output = _api_provider(conn, capability, payload)
                if capability in LLM_CAPABILITIES:
                    runtime_output = output.get("output")
                    normalized_output = dict(runtime_output) if isinstance(runtime_output, dict) else {}
                    provider, normalized_output = _normalize_llm_output(
                        str(output.get("capability") or capability),
                        {
                            **normalized_output,
                            "provider": str(output.get("provider_used") or "ai_runtime"),
                            "model": str(output.get("model") or AI_RUNTIME_DEFAULT_MODEL),
                            "system_prompt": str(output.get("system_prompt") or ""),
                            "user_prompt": str(output.get("user_prompt") or ""),
                        },
                        default_provider="ai_runtime",
                    )
                    return provider, "ok", normalized_output
                return "api", "fallback", output
        except ProviderError:
            continue

    return "none", "failed", {}
