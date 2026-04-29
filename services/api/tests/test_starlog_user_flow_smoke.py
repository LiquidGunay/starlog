from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def _load_smoke_module():
    script_path = Path(__file__).resolve().parents[3] / "scripts" / "starlog_user_flow_smoke.py"
    spec = importlib.util.spec_from_file_location("starlog_user_flow_smoke", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load starlog_user_flow_smoke.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_user_flow_smoke_extracts_briefing_audio_job_id() -> None:
    smoke = _load_smoke_module()

    assert (
        smoke._first_job_id(
            {
                "steps": [
                    {
                        "tool_name": "render_briefing_audio",
                        "result": {"job": {"id": "job_briefing_audio_1"}},
                    }
                ]
            }
        )
        == "job_briefing_audio_1"
    )


def test_user_flow_smoke_handles_missing_job_id() -> None:
    smoke = _load_smoke_module()

    assert smoke._first_job_id({"steps": [{"result": {}}]}) is None


def test_user_flow_smoke_parse_args_uses_starlog_token(monkeypatch: pytest.MonkeyPatch) -> None:
    smoke = _load_smoke_module()
    monkeypatch.setenv("STARLOG_TOKEN", "token-from-env")

    args = smoke.parse_args(["--api-base", "http://starlog.local:8000"])

    assert args.token == "token-from-env"
    assert args.api_base == "http://starlog.local:8000"


def test_user_flow_smoke_parse_args_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    smoke = _load_smoke_module()
    monkeypatch.delenv("STARLOG_TOKEN", raising=False)

    with pytest.raises(SystemExit) as exc_info:
        smoke.parse_args([])

    assert exc_info.value.code == 2


def test_user_flow_smoke_validates_expected_semantics() -> None:
    smoke = _load_smoke_module()

    smoke.validate_user_flow(
        [{"name": "generate_briefing"}],
        _agent_response("executed", "generate_briefing", "generate_briefing", "ok"),
        _agent_response(
            "executed",
            "render_briefing_audio",
            "render_briefing_audio",
            "ok",
            {"job": {"id": "job_briefing_audio_1", "action": "briefing_audio"}},
        ),
        _agent_response("planned", "create_task", "create_task", "dry_run"),
        write_task=False,
        codex_job={"id": "job_codex_1", "action": "assistant_command_ai"},
    )


def test_user_flow_smoke_requires_briefing_audio_job() -> None:
    smoke = _load_smoke_module()

    with pytest.raises(RuntimeError, match="did not queue a job"):
        smoke.validate_user_flow(
            [{"name": "generate_briefing"}],
            _agent_response("executed", "generate_briefing", "generate_briefing", "ok"),
            _agent_response("executed", "render_briefing_audio", "render_briefing_audio", "ok"),
            _agent_response("planned", "create_task", "create_task", "dry_run"),
            write_task=False,
        )


def test_user_flow_smoke_requires_planned_task_when_not_writing() -> None:
    smoke = _load_smoke_module()

    with pytest.raises(RuntimeError, match="task command returned status"):
        smoke.validate_user_flow(
            [{"name": "generate_briefing"}],
            _agent_response("executed", "generate_briefing", "generate_briefing", "ok"),
            _agent_response(
                "executed",
                "render_briefing_audio",
                "render_briefing_audio",
                "ok",
                {"job": {"id": "job_briefing_audio_1", "action": "briefing_audio"}},
            ),
            _agent_response("executed", "create_task", "create_task", "ok"),
            write_task=False,
        )


def _agent_response(
    status: str,
    matched_intent: str,
    tool_name: str,
    step_status: str,
    result: dict | None = None,
) -> dict:
    return {
        "status": status,
        "matched_intent": matched_intent,
        "steps": [
            {
                "tool_name": tool_name,
                "status": step_status,
                "result": result or {},
            }
        ],
    }
