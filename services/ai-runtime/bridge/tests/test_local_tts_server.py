from __future__ import annotations

from pathlib import Path
import sys

import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bridge.local_tts_server import health, load_local_tts_config, speak, LocalTtsSpeakRequest


def request_with_headers(headers: dict[str, str] | None = None) -> Request:
    encoded_headers = [
        (key.lower().encode("utf-8"), value.encode("utf-8"))
        for key, value in (headers or {}).items()
    ]
    return Request({"type": "http", "headers": encoded_headers})


def clear_local_tts_env(monkeypatch) -> None:
    for name in (
        "STARLOG_LOCAL_TTS_HOST",
        "STARLOG_LOCAL_TTS_PORT",
        "STARLOG_LOCAL_TTS_AUTH_TOKEN",
        "STARLOG_LOCAL_TTS_BACKEND",
        "STARLOG_LOCAL_TTS_PROVIDER_NAME",
        "STARLOG_LOCAL_TTS_COMMAND",
        "STARLOG_LOCAL_TTS_GPU_MODE",
        "STARLOG_LOCAL_TTS_MODEL_NAME",
    ):
        monkeypatch.delenv(name, raising=False)


def test_local_tts_health_reports_configuration(monkeypatch) -> None:
    clear_local_tts_env(monkeypatch)
    monkeypatch.setenv("STARLOG_LOCAL_TTS_PROVIDER_NAME", "vibevoice_community")
    monkeypatch.setenv("STARLOG_LOCAL_TTS_COMMAND", "echo {output_path}")
    monkeypatch.setenv("STARLOG_LOCAL_TTS_GPU_MODE", "gpu")

    payload = health(request_with_headers())
    assert payload.provider == "vibevoice_community"
    assert payload.gpu_mode == "gpu"
    assert payload.auth_required is False


def test_local_tts_requires_auth_when_configured(monkeypatch) -> None:
    clear_local_tts_env(monkeypatch)
    monkeypatch.setenv("STARLOG_LOCAL_TTS_AUTH_TOKEN", "secret")
    monkeypatch.setenv("STARLOG_LOCAL_TTS_COMMAND", "echo {output_path}")

    payload = health(request_with_headers())
    assert payload.auth_required is True
    assert payload.authenticated is False


def test_local_tts_speak_supports_debug_path(monkeypatch) -> None:
    clear_local_tts_env(monkeypatch)

    payload = speak(LocalTtsSpeakRequest(text="hello", debug_audio_path="/tmp/debug.wav"), request_with_headers())
    assert payload.provider == "debug"
    assert payload.audio_path == "/tmp/debug.wav"


def test_local_tts_speak_requires_command_when_not_debug(monkeypatch) -> None:
    clear_local_tts_env(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        speak(LocalTtsSpeakRequest(text="hello"), request_with_headers())
    assert exc.value.status_code == 503


def test_load_local_tts_config_defaults(monkeypatch) -> None:
    clear_local_tts_env(monkeypatch)

    config = load_local_tts_config()
    assert config.provider_name == "local_tts_server"
    assert config.gpu_mode == "auto"
