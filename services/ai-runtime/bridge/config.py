from __future__ import annotations

from dataclasses import dataclass
import json
import os
from typing import Any

DEFAULT_BRIDGE_HOST = "127.0.0.1"
DEFAULT_BRIDGE_PORT = 8091


@dataclass(frozen=True)
class BridgeConfig:
    host: str
    port: int
    base_url: str
    auth_token: str
    stt_command: str
    tts_command: str
    context_command: str
    clip_command: str
    static_context_json: str


def _read_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def load_bridge_config() -> BridgeConfig:
    host = os.getenv("STARLOG_BRIDGE_HOST", DEFAULT_BRIDGE_HOST).strip() or DEFAULT_BRIDGE_HOST
    port = _read_int("STARLOG_BRIDGE_PORT", DEFAULT_BRIDGE_PORT)
    base_url = os.getenv("STARLOG_BRIDGE_BASE_URL", "").strip() or f"http://{host}:{port}"
    return BridgeConfig(
        host=host,
        port=port,
        base_url=base_url,
        auth_token=os.getenv("STARLOG_BRIDGE_AUTH_TOKEN", "").strip(),
        stt_command=os.getenv("STARLOG_BRIDGE_STT_CMD", "").strip(),
        tts_command=os.getenv("STARLOG_BRIDGE_TTS_CMD", "").strip(),
        context_command=os.getenv("STARLOG_BRIDGE_CONTEXT_CMD", "").strip(),
        clip_command=os.getenv("STARLOG_BRIDGE_CLIP_CMD", "").strip(),
        static_context_json=os.getenv("STARLOG_BRIDGE_CONTEXT_JSON", "").strip(),
    )


def capability_summary(config: BridgeConfig) -> dict[str, dict[str, Any]]:
    return {
        "stt": {
            "status": "available" if config.stt_command else "unavailable",
            "detail": "Command-backed STT bridge is configured."
            if config.stt_command
            else "Set STARLOG_BRIDGE_STT_CMD to enable local speech transcription.",
            "preferred_backend": "command" if config.stt_command else None,
        },
        "tts": {
            "status": "available" if config.tts_command else "unavailable",
            "detail": "Command-backed TTS bridge is configured."
            if config.tts_command
            else "Set STARLOG_BRIDGE_TTS_CMD to enable local speech synthesis.",
            "preferred_backend": "command" if config.tts_command else None,
        },
        "context": {
            "status": "available" if config.context_command or config.static_context_json else "degraded",
            "detail": "Desktop context bridge is configured."
            if config.context_command or config.static_context_json
            else "Set STARLOG_BRIDGE_CONTEXT_CMD or STARLOG_BRIDGE_CONTEXT_JSON to expose local desktop context.",
            "preferred_backend": "command" if config.context_command else ("static_json" if config.static_context_json else None),
        },
        "clip": {
            "status": "available" if config.clip_command else "degraded",
            "detail": "Local clip forwarding command is configured."
            if config.clip_command
            else "Set STARLOG_BRIDGE_CLIP_CMD to route bridge clip actions into existing Starlog capture tooling.",
            "preferred_backend": "command" if config.clip_command else None,
        },
    }


def parse_static_context(config: BridgeConfig) -> dict[str, Any] | None:
    raw = config.static_context_json
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
