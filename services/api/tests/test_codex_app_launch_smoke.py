from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def _load_smoke_module():
    script_path = Path(__file__).resolve().parents[3] / "scripts" / "codex_app_launch_smoke.py"
    spec = importlib.util.spec_from_file_location("starlog_codex_app_launch_smoke", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load codex_app_launch_smoke.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_codex_app_launch_smoke_defaults_to_gpt_5_4_mini(monkeypatch: pytest.MonkeyPatch) -> None:
    smoke = _load_smoke_module()
    monkeypatch.delenv("STARLOG_CODEX_MODEL", raising=False)

    assert smoke.default_model() == "gpt-5.4-mini"
    assert smoke.parse_args([]).model == "gpt-5.4-mini"


def test_codex_app_launch_smoke_validates_completed_dry_run_job() -> None:
    smoke = _load_smoke_module()

    assistant_command = smoke._validate_completed_job(
        {
            "status": "completed",
            "provider_used": "codex_local",
            "output": {
                "assistant_command": {
                    "status": "planned",
                    "matched_intent": "create_task",
                    "steps": [{"tool_name": "create_task", "status": "dry_run"}],
                }
            },
        },
        execute=False,
    )

    assert assistant_command["matched_intent"] == "create_task"


def test_codex_app_launch_smoke_rejects_missing_assistant_command() -> None:
    smoke = _load_smoke_module()

    with pytest.raises(RuntimeError, match="does not include assistant_command"):
        smoke._validate_completed_job(
            {"status": "completed", "provider_used": "codex_local", "output": {}},
            execute=False,
        )


def test_codex_app_launch_smoke_rejects_non_dry_run_planned_steps() -> None:
    smoke = _load_smoke_module()

    with pytest.raises(RuntimeError, match="expected all assistant command steps to be dry_run"):
        smoke._validate_completed_job(
            {
                "status": "completed",
                "provider_used": "codex_local",
                "output": {
                    "assistant_command": {
                        "status": "planned",
                        "matched_intent": "create_task",
                        "steps": [{"tool_name": "create_task", "status": "ok"}],
                    }
                },
            },
            execute=False,
        )


def test_codex_app_launch_smoke_rejects_wrong_tool_step() -> None:
    smoke = _load_smoke_module()

    with pytest.raises(RuntimeError, match="expected create_task tool step"):
        smoke._validate_completed_job(
            {
                "status": "completed",
                "provider_used": "codex_local",
                "output": {
                    "assistant_command": {
                        "status": "planned",
                        "matched_intent": "summarize",
                        "steps": [{"tool_name": "run_artifact_action", "status": "dry_run"}],
                    }
                },
            },
            execute=False,
        )


def test_codex_app_launch_smoke_rejects_failed_execute_result() -> None:
    smoke = _load_smoke_module()

    with pytest.raises(RuntimeError, match="expected one of"):
        smoke._validate_completed_job(
            {
                "status": "completed",
                "provider_used": "codex_local",
                "output": {
                    "assistant_command": {
                        "status": "failed",
                        "matched_intent": "create_task",
                        "steps": [{"tool_name": "create_task", "status": "failed"}],
                    }
                },
            },
            execute=True,
        )
