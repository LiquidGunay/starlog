from __future__ import annotations

from io import BytesIO
from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bridge import local_stt_server


def clear_local_stt_env(monkeypatch) -> None:
    for name in (
        "STARLOG_LOCAL_STT_HOST",
        "STARLOG_LOCAL_STT_PORT",
        "STARLOG_LOCAL_STT_AUTH_TOKEN",
        "STARLOG_LOCAL_STT_PROVIDER_NAME",
        "STARLOG_LOCAL_STT_MODEL",
        "STARLOG_LOCAL_STT_LANGUAGE",
        "STARLOG_LOCAL_STT_BEAM_SIZE",
        "STARLOG_LOCAL_STT_DEVICE",
        "STARLOG_LOCAL_STT_COMPUTE_TYPE",
    ):
        monkeypatch.delenv(name, raising=False)


def test_local_stt_health_reports_configuration(monkeypatch) -> None:
    clear_local_stt_env(monkeypatch)
    client = TestClient(local_stt_server.app)

    response = client.get("/health")
    payload = response.json()

    assert response.status_code == 200
    assert payload["status"] == "ok"
    assert payload["model_name"] == "tiny.en"
    assert payload["provider"] == "faster_whisper_local"


def test_local_stt_inference_uses_cached_runtime(monkeypatch) -> None:
    clear_local_stt_env(monkeypatch)
    client = TestClient(local_stt_server.app)

    class _Segment:
        def __init__(self, text: str) -> None:
            self.text = text

    class _FakeModel:
        def transcribe(self, _audio_path: str, **_kwargs):
            return [_Segment("hello"), _Segment("starlog")], {"language": "en"}

    monkeypatch.setattr(
        local_stt_server.MODEL_RUNTIME,
        "get",
        lambda _config: (_FakeModel(), "cpu", "int8"),
    )

    response = client.post(
        "/inference",
        files={"file": ("sample.wav", BytesIO(b"RIFFfakewav"), "audio/wav")},
        data={"response-format": "json", "text_hint": "greeting"},
    )
    payload = response.json()

    assert response.status_code == 200
    assert payload["transcript"] == "hello starlog"
    assert payload["device"] == "cpu"
    assert payload["compute_type"] == "int8"


def test_local_stt_inference_requires_auth(monkeypatch) -> None:
    clear_local_stt_env(monkeypatch)
    monkeypatch.setenv("STARLOG_LOCAL_STT_AUTH_TOKEN", "secret")
    client = TestClient(local_stt_server.app)

    response = client.post(
        "/inference",
        files={"file": ("sample.wav", BytesIO(b"RIFFfakewav"), "audio/wav")},
    )

    assert response.status_code == 401


def test_local_stt_inference_falls_back_from_cuda_to_cpu(monkeypatch) -> None:
    clear_local_stt_env(monkeypatch)
    client = TestClient(local_stt_server.app)

    class _Segment:
        def __init__(self, text: str) -> None:
            self.text = text

    class _CudaModel:
        def transcribe(self, _audio_path: str, **_kwargs):
            raise RuntimeError("Library libcublas.so.12 is not found or cannot be loaded")

    class _CpuModel:
        def transcribe(self, _audio_path: str, **_kwargs):
            return [_Segment("fallback"), _Segment("worked")], {"language": "en"}

    calls: list[str] = []

    def fake_get(config):
        calls.append(config.device)
        if config.device == "cpu":
            return _CpuModel(), "cpu", "int8"
        return _CudaModel(), "cuda", "float16"

    monkeypatch.setattr(local_stt_server.MODEL_RUNTIME, "get", fake_get)
    monkeypatch.setattr(local_stt_server.MODEL_RUNTIME, "reset", lambda: None)

    response = client.post(
        "/inference",
        files={"file": ("sample.wav", BytesIO(b"RIFFfakewav"), "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["transcript"] == "fallback worked"
    assert calls == ["auto", "cpu"]
