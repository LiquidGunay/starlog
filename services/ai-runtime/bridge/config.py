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
    stt_server_url: str
    stt_server_auth_token: str
    tts_command: str
    tts_server_url: str
    tts_server_auth_token: str
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
        stt_server_url=os.getenv("STARLOG_BRIDGE_STT_SERVER_URL", "").strip(),
        stt_server_auth_token=os.getenv("STARLOG_BRIDGE_STT_SERVER_AUTH_TOKEN", "").strip(),
        tts_command=os.getenv("STARLOG_BRIDGE_TTS_CMD", "").strip(),
        tts_server_url=os.getenv("STARLOG_BRIDGE_TTS_SERVER_URL", "").strip(),
        tts_server_auth_token=os.getenv("STARLOG_BRIDGE_TTS_SERVER_AUTH_TOKEN", "").strip(),
        context_command=os.getenv("STARLOG_BRIDGE_CONTEXT_CMD", "").strip(),
        clip_command=os.getenv("STARLOG_BRIDGE_CLIP_CMD", "").strip(),
        static_context_json=os.getenv("STARLOG_BRIDGE_CONTEXT_JSON", "").strip(),
    )


def capability_summary(config: BridgeConfig) -> dict[str, dict[str, Any]]:
    stt_available = bool(config.stt_server_url or config.stt_command)
    stt_preferred_backend = "http" if config.stt_server_url else ("command" if config.stt_command else None)
    if config.stt_server_url:
        stt_detail = f"Server-backed STT bridge is configured at {config.stt_server_url}."
    elif config.stt_command:
        stt_detail = "Command-backed STT bridge is configured."
    else:
        stt_detail = (
            "Set STARLOG_BRIDGE_STT_SERVER_URL for a resident local server, or "
            "STARLOG_BRIDGE_STT_CMD for command-backed transcription."
        )

    tts_available = bool(config.tts_server_url or config.tts_command)
    tts_preferred_backend = "http" if config.tts_server_url else ("command" if config.tts_command else None)
    if config.tts_server_url:
        tts_detail = f"Server-backed TTS bridge is configured at {config.tts_server_url}."
    elif config.tts_command:
        tts_detail = "Command-backed TTS bridge is configured."
    else:
        tts_detail = (
            "Set STARLOG_BRIDGE_TTS_SERVER_URL for a resident local server, or "
            "STARLOG_BRIDGE_TTS_CMD for command-backed synthesis."
        )

    return {
        "stt": {
            "status": "available" if stt_available else "unavailable",
            "detail": stt_detail,
            "preferred_backend": stt_preferred_backend,
        },
        "tts": {
            "status": "available" if tts_available else "unavailable",
            "detail": tts_detail,
            "preferred_backend": tts_preferred_backend,
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
