from __future__ import annotations

from pathlib import Path
import sys
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bridge.server import active_context, health, speak, transcribe
from bridge.schemas import SttRequest, TtsRequest


def request_with_headers(headers: dict[str, str] | None = None) -> Request:
    encoded_headers = [
        (key.lower().encode("utf-8"), value.encode("utf-8"))
        for key, value in (headers or {}).items()
    ]
    return Request({"type": "http", "headers": encoded_headers})


def clear_bridge_env(monkeypatch) -> None:
    for name in (
        "STARLOG_BRIDGE_HOST",
        "STARLOG_BRIDGE_PORT",
        "STARLOG_BRIDGE_BASE_URL",
        "STARLOG_BRIDGE_AUTH_TOKEN",
        "STARLOG_BRIDGE_STT_CMD",
        "STARLOG_BRIDGE_STT_SERVER_URL",
        "STARLOG_BRIDGE_STT_SERVER_AUTH_TOKEN",
        "STARLOG_BRIDGE_TTS_CMD",
        "STARLOG_BRIDGE_TTS_SERVER_URL",
        "STARLOG_BRIDGE_TTS_SERVER_AUTH_TOKEN",
        "STARLOG_BRIDGE_CONTEXT_CMD",
        "STARLOG_BRIDGE_CLIP_CMD",
        "STARLOG_BRIDGE_CONTEXT_JSON",
    ):
        monkeypatch.delenv(name, raising=False)


def test_health_reports_unconfigured_bridge(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)

    payload = health(request_with_headers())
    assert payload.status == "ok"
    assert payload.service == "desktop_local_bridge"
    assert payload.auth_required is False
    assert payload.authenticated is True
    assert payload.capabilities["stt"].status == "unavailable"
    assert payload.capabilities["context"].status == "degraded"


def test_health_reports_configured_bridge(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)
    monkeypatch.setenv("STARLOG_BRIDGE_STT_SERVER_URL", "http://127.0.0.1:8171/inference")
    monkeypatch.setenv("STARLOG_BRIDGE_TTS_SERVER_URL", "http://127.0.0.1:8093/v1/tts/speak")
    monkeypatch.setenv("STARLOG_BRIDGE_CONTEXT_JSON", '{"app":"Codex"}')

    payload = health(request_with_headers())
    assert payload.capabilities["stt"].status == "available"
    assert payload.capabilities["tts"].status == "available"
    assert payload.capabilities["stt"].preferred_backend == "http"
    assert payload.capabilities["context"].preferred_backend == "static_json"


def test_stt_debug_transcript(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)

    payload = transcribe(SttRequest(debug_transcript="hello starlog"), request_with_headers())
    assert payload.provider == "debug"
    assert payload.transcript == "hello starlog"


def test_tts_requires_configuration_without_debug(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        speak(TtsRequest(text="hello", output_path="/tmp/out.wav"), request_with_headers())
    assert exc.value.status_code == 503


class _FakeResponse:
    def __init__(self, payload: str, content_type: str = "application/json") -> None:
        self._payload = payload.encode("utf-8")
        self.headers = {"Content-Type": content_type}

    def read(self) -> bytes:
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def test_stt_server_mode(monkeypatch, tmp_path) -> None:
    clear_bridge_env(monkeypatch)
    monkeypatch.setenv("STARLOG_BRIDGE_STT_SERVER_URL", "http://127.0.0.1:8171/inference")
    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"fake-wav")

    with patch("bridge.server.urlopen", return_value=_FakeResponse('{"text":"hello from server"}')):
        payload = transcribe(SttRequest(audio_path=str(audio_path)), request_with_headers())

    assert payload.provider == "server"
    assert payload.transcript == "hello from server"


def test_tts_server_mode(monkeypatch, tmp_path) -> None:
    clear_bridge_env(monkeypatch)
    monkeypatch.setenv("STARLOG_BRIDGE_TTS_SERVER_URL", "http://127.0.0.1:8093/v1/tts/speak")
    output_path = tmp_path / "speech.wav"

    with patch(
        "bridge.server.urlopen",
        return_value=_FakeResponse('{"audio_path":"/tmp/server.wav","detail":"server ok"}'),
    ):
        payload = speak(TtsRequest(text="hello", output_path=str(output_path), voice_name="Emma"), request_with_headers())

    assert payload.provider == "server"
    assert payload.audio_path == "/tmp/server.wav"
    assert payload.detail == "server ok"


def test_context_supports_static_json(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)
    monkeypatch.setenv("STARLOG_BRIDGE_CONTEXT_JSON", '{"app_name":"Codex","window_title":"Starlog"}')

    payload = active_context(request_with_headers())
    assert payload.status == "ok"
    assert payload.provider == "static_json"
    assert payload.context["app_name"] == "Codex"


def test_health_reports_auth_requirement(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)
    monkeypatch.setenv("STARLOG_BRIDGE_AUTH_TOKEN", "secret-bridge")

    anonymous = health(request_with_headers())
    assert anonymous.auth_required is True
    assert anonymous.authenticated is False

    authenticated = health(request_with_headers({"Authorization": "Bearer secret-bridge"}))
    assert authenticated.authenticated is True


def test_context_requires_auth_when_configured(monkeypatch) -> None:
    clear_bridge_env(monkeypatch)
    monkeypatch.setenv("STARLOG_BRIDGE_AUTH_TOKEN", "secret-bridge")
    monkeypatch.setenv("STARLOG_BRIDGE_CONTEXT_JSON", '{"app_name":"Codex"}')

    with pytest.raises(HTTPException) as exc:
        active_context(request_with_headers())
    assert exc.value.status_code == 401

    payload = active_context(request_with_headers({"X-Starlog-Bridge-Token": "secret-bridge"}))
    assert payload.status == "ok"
