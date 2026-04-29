#!/usr/bin/env python3
"""Queue an Assistant AI job through the Starlog app and launch Codex CLI for it."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


DEFAULT_CODEX_MODEL = "gpt-5.4-mini"
DEFAULT_COMMAND = "create task Starlog Codex app launch smoke due tomorrow priority 2"
DEFAULT_PASSPHRASE = "correct horse battery staple"
DEFAULT_WORKER_ID = "codex-app-launch-smoke"


def default_model() -> str:
    return os.environ.get("STARLOG_CODEX_MODEL", "").strip() or DEFAULT_CODEX_MODEL


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=default_model(), help="Model passed to `codex exec`.")
    parser.add_argument("--command", default=DEFAULT_COMMAND)
    parser.add_argument("--provider-hint", default="desktop_bridge_codex")
    parser.add_argument("--device-target", default="web-pwa")
    parser.add_argument("--worker-id", default=DEFAULT_WORKER_ID)
    parser.add_argument("--timeout-seconds", type=float, default=240.0)
    parser.add_argument("--passphrase", default=DEFAULT_PASSPHRASE)
    parser.add_argument("--db-path", default=None, help="Optional SQLite path. Defaults to a temporary database.")
    parser.add_argument("--execute", action="store_true", help="Execute the AI-planned command; default is dry-run.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.db_path:
            summary = run_smoke(args, db_path=Path(args.db_path))
        else:
            with tempfile.TemporaryDirectory(prefix="starlog-codex-app-smoke-") as temp_dir:
                summary = run_smoke(args, db_path=Path(temp_dir) / "starlog-smoke.db")
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1


def run_smoke(args: argparse.Namespace, *, db_path: Path) -> dict[str, Any]:
    with _build_test_client(db_path) as client:
        headers = _auth_headers(client, args.passphrase)

        queued = client.post(
            "/v1/agent/command/assist",
            headers=headers,
            json={
                "command": args.command,
                "execute": bool(args.execute),
                "device_target": args.device_target,
                "provider_hint": args.provider_hint,
            },
        )
        _require_status(queued.status_code, 201, queued.text)
        queued_job = queued.json()
        if queued_job.get("action") != "assistant_command_ai":
            raise RuntimeError(f"Unexpected queued job action: {queued_job.get('action')!r}")

        claimed = client.post(
            f"/v1/ai/jobs/{queued_job['id']}/claim",
            headers=headers,
            json={"worker_id": args.worker_id},
        )
        _require_status(claimed.status_code, 200, claimed.text)
        claimed_job = claimed.json()

        worker = _load_worker_module()
        provider_used, output = worker._run_job(  # noqa: SLF001 - smoke exercises the actual Codex path.
            claimed_job,
            api_base="http://testserver",
            token="test-token",
            codex_model=args.model,
            whisper_command=None,
            ffmpeg_command="ffmpeg",
            tts_command=None,
            codex_timeout_seconds=args.timeout_seconds,
            whisper_timeout_seconds=120.0,
            tts_timeout_seconds=120.0,
            ffmpeg_timeout_seconds=60.0,
        )

        completed = client.post(
            f"/v1/ai/jobs/{queued_job['id']}/complete",
            headers=headers,
            json={"worker_id": args.worker_id, "provider_used": provider_used, "output": output},
        )
        _require_status(completed.status_code, 200, completed.text)
        completed_job = completed.json()
        assistant_command = _validate_completed_job(completed_job, execute=bool(args.execute))

    return {
        "status": "ok",
        "model": args.model,
        "job_id": completed_job["id"],
        "provider_used": completed_job.get("provider_used"),
        "assistant_command_status": assistant_command.get("status"),
        "matched_intent": assistant_command.get("matched_intent"),
        "tool_names": [step.get("tool_name") for step in assistant_command.get("steps", [])],
        "db_path": str(db_path),
    }


def _build_test_client(db_path: Path):
    repo_root = Path(__file__).resolve().parents[1]
    api_root = repo_root / "services" / "api"
    api_root_text = str(api_root)
    if api_root_text not in sys.path:
        sys.path.insert(0, api_root_text)

    os.environ["STARLOG_DB_PATH"] = str(db_path)

    from fastapi.testclient import TestClient

    from app.core.config import get_settings

    get_settings.cache_clear()
    from app.main import app

    get_settings.cache_clear()
    return TestClient(app)


def _auth_headers(client, passphrase: str) -> dict[str, str]:
    bootstrap = client.post("/v1/auth/bootstrap", json={"passphrase": passphrase})
    if bootstrap.status_code not in {200, 201}:
        raise RuntimeError(f"Bootstrap failed with HTTP {bootstrap.status_code}: {bootstrap.text}")
    login = client.post("/v1/auth/login", json={"passphrase": passphrase})
    _require_status(login.status_code, 200, login.text)
    token = login.json().get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("Login did not return an access token.")
    return {"Authorization": f"Bearer {token}"}


def _load_worker_module():
    repo_root = Path(__file__).resolve().parents[1]
    scripts_root = repo_root / "scripts"
    scripts_root_text = str(scripts_root)
    if scripts_root_text not in sys.path:
        sys.path.insert(0, scripts_root_text)
    import local_ai_worker

    return local_ai_worker


def _validate_completed_job(completed_job: dict[str, Any], *, execute: bool) -> dict[str, Any]:
    if completed_job.get("status") != "completed":
        raise RuntimeError(f"Job was not completed: {completed_job.get('status')!r}")
    if completed_job.get("provider_used") != "codex_local":
        raise RuntimeError(f"Job used unexpected provider: {completed_job.get('provider_used')!r}")
    output = completed_job.get("output")
    if not isinstance(output, dict):
        raise RuntimeError("Completed job output is missing.")
    assistant_command = output.get("assistant_command")
    if not isinstance(assistant_command, dict):
        raise RuntimeError("Completed job output does not include assistant_command.")
    status = assistant_command.get("status")
    expected_statuses = {"executed", "planned"} if execute else {"planned"}
    if status not in expected_statuses:
        raise RuntimeError(
            f"Assistant command status was {status!r}, expected one of {sorted(expected_statuses)!r}."
        )
    steps = assistant_command.get("steps")
    if not isinstance(steps, list) or not steps:
        raise RuntimeError("Assistant command did not include any planned tool steps.")
    if not all(isinstance(step, dict) and step.get("tool_name") for step in steps):
        raise RuntimeError("Assistant command included malformed tool steps.")
    if not any(step.get("tool_name") == "create_task" for step in steps):
        raise RuntimeError("Assistant command did not include the expected create_task tool step.")
    if not execute and not all(step.get("status") == "dry_run" for step in steps):
        raise RuntimeError("Dry-run app launch smoke expected all assistant command steps to be dry_run.")
    if execute and any(step.get("status") == "failed" for step in steps):
        raise RuntimeError("Execute app launch smoke returned a failed assistant command step.")
    return assistant_command


def _require_status(actual: int, expected: int, body: str) -> None:
    if actual != expected:
        raise RuntimeError(f"Expected HTTP {expected}, got HTTP {actual}: {body}")


if __name__ == "__main__":
    raise SystemExit(main())
