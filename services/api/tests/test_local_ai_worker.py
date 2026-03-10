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

    provider_used, output = worker._run_tts(
        {
            "provider_hint": "piper_local",
            "payload": {"text": "Hello from Piper", "voice": "en_US-lessac-medium", "rate_wpm": 175},
        },
        "http://localhost:8000",
        "token",
        None,
        "ffmpeg",
    )

    assert provider_used == "piper_local"
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

    provider_used, output = worker._run_tts(
        {
            "provider_hint": "say_local",
            "payload": {"text": "Hello from say", "voice": "Samantha", "rate_wpm": 190},
        },
        "http://localhost:8000",
        "token",
        None,
        "",
    )

    assert provider_used == "say_local"
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
