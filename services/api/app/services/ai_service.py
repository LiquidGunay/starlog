from typing import Literal

from app.core.config import get_settings


class ProviderError(Exception):
    pass


def _local_provider(capability: str, payload: dict) -> dict:
    if capability == "ocr":
        return {
            "text": payload.get("text_hint", ""),
            "mode": "on_device_required",
        }

    if capability in {"llm_summary", "llm_cards", "llm_tasks"}:
        source = str(payload.get("text") or payload.get("content") or "")
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


def _codex_bridge_provider(capability: str, payload: dict) -> dict:
    # Placeholder bridge adapter: wiring to external codex bridge service happens next.
    raise ProviderError(f"Codex bridge unavailable for capability {capability}")


def _api_provider(capability: str, payload: dict) -> dict:
    if capability == "ocr":
        raise ProviderError("OCR is strict on-device only")

    model = payload.get("model", "fallback-model")
    return {
        "provider": "api_fallback",
        "model": model,
        "capability": capability,
    }


def run(
    capability: str,
    payload: dict,
    prefer_local: bool,
) -> tuple[str, Literal["ok", "fallback", "failed"], dict]:
    _ = get_settings()

    if prefer_local:
        try:
            return "local", "ok", _local_provider(capability, payload)
        except ProviderError:
            pass

    try:
        return "codex_bridge", "ok", _codex_bridge_provider(capability, payload)
    except ProviderError:
        pass

    try:
        output = _api_provider(capability, payload)
        return "api_fallback", "fallback", output
    except ProviderError:
        return "none", "failed", {}
