from __future__ import annotations

from pathlib import Path
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bridge.server import active_context, health, speak, transcribe
from bridge.schemas import SttRequest, TtsRequest


def clear_bridge_env(monkeypatch) -> None:
    for name in (
        "STARLOG_BRIDGE_HOST",
        "STARLOG_BRIDGE_PORT",
        "STARLOG_BRIDGE_BASE_URL",
        "STARLOG_BRIDGE_STT_CMD",
        "STARLOG_BRIDGE_TTS_CMD",
        "STARLOG_BRIDGE_CONTEXT_CMD",
        "STARLOG_BRIDGE_CLIP_CMD",
        "STARLOG_BRIDGE_CONTEXT_JSON",
    ):
        monkeypatch.delenv(name, raising=False)


def test_health_reports_unconfigured_bridge(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)

    payload = health()
    assert payload.status == "ok"
    assert payload.service == "desktop_local_bridge"
    assert payload.capabilities["stt"].status == "unavailable"
    assert payload.capabilities["context"].status == "degraded"


def test_health_reports_configured_bridge(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)
    monkeypatch.setenv("STARLOG_BRIDGE_STT_CMD", "echo transcript")
    monkeypatch.setenv("STARLOG_BRIDGE_TTS_CMD", "echo /tmp/audio.wav")
    monkeypatch.setenv("STARLOG_BRIDGE_CONTEXT_JSON", '{"app":"Codex"}')

    payload = health()
    assert payload.capabilities["stt"].status == "available"
    assert payload.capabilities["tts"].status == "available"
    assert payload.capabilities["context"].preferred_backend == "static_json"


def test_stt_debug_transcript(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)

    payload = transcribe(SttRequest(debug_transcript="hello starlog"))
    assert payload.provider == "debug"
    assert payload.transcript == "hello starlog"


def test_tts_requires_configuration_without_debug(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        speak(TtsRequest(text="hello", output_path="/tmp/out.wav"))
    assert exc.value.status_code == 503


def test_context_supports_static_json(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)
    monkeypatch.setenv("STARLOG_BRIDGE_CONTEXT_JSON", '{"app_name":"Codex","window_title":"Starlog"}')

    payload = active_context()
    assert payload.status == "ok"
    assert payload.provider == "static_json"
    assert payload.context["app_name"] == "Codex"
