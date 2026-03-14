from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path


def _load_worker_module():
    worker_path = Path(__file__).resolve().parents[3] / "scripts" / "local_ai_worker.py"
    spec = importlib.util.spec_from_file_location("starlog_local_ai_worker", worker_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load local_ai_worker.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_run_tts_piper_local_expands_voice_and_rate(monkeypatch) -> None:
    worker = _load_worker_module()
    command_log: list[tuple[list[str], str | None]] = []

    def fake_run(command: list[str], input: str | None = None, **_: object) -> subprocess.CompletedProcess[str]:
        command_log.append((command, input))
        output_path = Path(command[command.index("--out") + 1])
        output_path.write_bytes(b"RIFFfakewave")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setenv(
        "STARLOG_TTS_COMMAND",
        "piper --out {output_path} --voice {voice} --rate {rate}",
    )
    monkeypatch.setattr(worker.subprocess, "run", fake_run)
    monkeypatch.setattr(
        worker,
        "_upload_media",
        lambda api_base, token, path, content_type=None: {
            "blob_ref": "media://med_piper",
            "path": str(path),
            "content_type": content_type,
        },
    )

    output = worker._run_tts(
        {
            "provider_hint": "piper_local",
            "payload": {"text": "Hello from Piper", "voice": "en_US-lessac-medium", "rate_wpm": 175},
        },
        "http://localhost:8000",
        "token",
        provider_used="piper_local",
        tts_command=None,
        ffmpeg_command="ffmpeg",
        tts_timeout_seconds=120.0,
        ffmpeg_timeout_seconds=60.0,
    )

    assert command_log[0][0][:3] == ["piper", "--out", command_log[0][0][2]]
    assert "--voice" in command_log[0][0]
    assert "en_US-lessac-medium" in command_log[0][0]
    assert "--rate" in command_log[0][0]
    assert "175" in command_log[0][0]
    assert command_log[0][1] == "Hello from Piper"
    assert output["audio_ref"] == "media://med_piper"
    assert output["voice"] == "en_US-lessac-medium"
    assert output["rate_wpm"] == 175


def test_run_tts_say_local_uses_native_wrapper(monkeypatch) -> None:
    worker = _load_worker_module()
    command_log: list[list[str]] = []

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        command_log.append(command)
        output_path = Path(command[command.index("-o") + 1])
        output_path.write_bytes(b"FORMfakeaiff")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(worker.subprocess, "run", fake_run)
    monkeypatch.setattr(
        worker,
        "_upload_media",
        lambda api_base, token, path, content_type=None: {
            "blob_ref": "media://med_say",
            "path": str(path),
            "content_type": content_type,
        },
    )

    output = worker._run_tts(
        {
            "provider_hint": "say_local",
            "payload": {"text": "Hello from say", "voice": "Samantha", "rate_wpm": 190},
        },
        "http://localhost:8000",
        "token",
        provider_used="say_local",
        tts_command=None,
        ffmpeg_command="",
        tts_timeout_seconds=120.0,
        ffmpeg_timeout_seconds=60.0,
    )

    assert command_log[0][0] == "say"
    assert "-v" in command_log[0]
    assert "Samantha" in command_log[0]
    assert "-r" in command_log[0]
    assert "190" in command_log[0]
    assert command_log[0][-1] == "Hello from say"
    assert output["audio_ref"] == "media://med_say"
    assert output["source_format"] == "aiff"
    assert output["voice"] == "Samantha"
    assert output["rate_wpm"] == 190


def test_resolve_provider_maps_bridge_tts_to_template_runtime(monkeypatch) -> None:
    worker = _load_worker_module()
    monkeypatch.setenv("STARLOG_TTS_COMMAND", "piper --out {output_path}")

    provider, metadata = worker._resolve_provider(
        {"capability": "tts", "provider_hint": "desktop_bridge_tts"},
        tts_command=None,
    )

    assert provider == "piper_local"
    assert metadata["provider_resolution_reason"] == "tts_command_template"


def test_resolve_provider_maps_bridge_tts_to_native_say(monkeypatch) -> None:
    worker = _load_worker_module()
    monkeypatch.delenv("STARLOG_TTS_COMMAND", raising=False)
    monkeypatch.setattr(worker.sys, "platform", "darwin")
    monkeypatch.setattr(worker, "_command_available", lambda command: command == "say")

    provider, metadata = worker._resolve_provider(
        {"capability": "tts", "provider_hint": "desktop_bridge_tts"},
        tts_command=None,
    )

    assert provider == "say_local"
    assert metadata["provider_resolution_reason"] == "native_say_available"


def test_classify_failure_timeout_is_retryable() -> None:
    worker = _load_worker_module()
    category, retryable = worker._classify_failure(
        subprocess.TimeoutExpired(cmd=["codex"], timeout=5.0),
    )
    assert category == "timeout"
    assert retryable is True


def test_classify_failure_unsupported_provider_is_not_retryable() -> None:
    worker = _load_worker_module()
    category, retryable = worker._classify_failure(
        RuntimeError("Unsupported local TTS provider_hint: desktop_bridge_tts"),
    )
    assert category == "unsupported_provider"
    assert retryable is False
