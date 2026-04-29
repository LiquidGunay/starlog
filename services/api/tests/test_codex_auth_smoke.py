from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path


def _load_smoke_module():
    script_path = Path(__file__).resolve().parents[3] / "scripts" / "codex_auth_smoke.py"
    spec = importlib.util.spec_from_file_location("starlog_codex_auth_smoke", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load codex_auth_smoke.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_codex_auth_smoke_defaults_to_gpt_5_4_mini(monkeypatch) -> None:
    smoke = _load_smoke_module()
    monkeypatch.delenv("STARLOG_CODEX_MODEL", raising=False)

    assert smoke.default_model() == "gpt-5.4-mini"
    assert smoke.build_command("gpt-5.4-mini")[:4] == ["codex", "exec", "-m", "gpt-5.4-mini"]


def test_codex_auth_smoke_can_use_cli_default(monkeypatch) -> None:
    smoke = _load_smoke_module()
    calls: list[list[str]] = []

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, stdout="starlog-codex-auth-ok", stderr="")

    monkeypatch.setattr(smoke.shutil, "which", lambda command: "/usr/local/bin/codex" if command == "codex" else None)
    monkeypatch.setattr(smoke.subprocess, "run", fake_run)

    assert smoke.run_smoke(["--use-cli-default"]) == 0
    assert "-m" not in calls[0]


def test_codex_auth_smoke_reports_chatgpt_model_support_error(monkeypatch, capsys) -> None:
    smoke = _load_smoke_module()

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(
            command,
            1,
            stdout="",
            stderr="The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account.",
        )

    monkeypatch.setattr(smoke.shutil, "which", lambda command: "/usr/local/bin/codex" if command == "codex" else None)
    monkeypatch.setattr(smoke.subprocess, "run", fake_run)

    assert smoke.run_smoke([]) == 1
    captured = capsys.readouterr()
    assert "does not expose gpt-5.4-mini" in captured.err
