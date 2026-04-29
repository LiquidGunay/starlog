#!/usr/bin/env python3
"""Exercise the user-facing Assistant, briefing, audio, and optional Codex job paths."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _today() -> str:
    return dt.datetime.now(dt.timezone.utc).date().isoformat()


def _tomorrow() -> str:
    return (dt.datetime.now(dt.timezone.utc).date() + dt.timedelta(days=1)).isoformat()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument("--token", default=os.environ.get("STARLOG_TOKEN"), help="Bearer token. Defaults to STARLOG_TOKEN.")
    parser.add_argument("--date", default=_today())
    parser.add_argument("--device-target", default="web-pwa")
    parser.add_argument("--write-task", action="store_true", help="Create the smoke task instead of planning it.")
    parser.add_argument("--queue-codex", action="store_true", help="Queue one Codex-assisted command-planning job.")
    parser.add_argument("--codex-provider-hint", default="desktop_bridge_codex")
    args = parser.parse_args(argv)
    if not args.token:
        parser.error("--token is required or set STARLOG_TOKEN")
    return args


def request_json(api_base: str, token: str, path: str, *, method: str = "GET", payload: dict | None = None) -> dict | list:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        f"{api_base.rstrip('/')}{path}",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urlopen(request, timeout=30.0) as response:  # noqa: S310
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"{method} {path} failed with HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"{method} {path} failed: {exc.reason}") from exc
    return json.loads(body) if body.strip() else {}


def agent_command(api_base: str, token: str, *, command: str, execute: bool, device_target: str) -> dict:
    payload = request_json(
        api_base,
        token,
        "/v1/agent/command",
        method="POST",
        payload={"command": command, "execute": execute, "device_target": device_target},
    )
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected agent command response for {command}")
    return payload


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        intents = request_json(args.api_base, args.token, "/v1/agent/intents")
        generate_briefing = agent_command(
            args.api_base,
            args.token,
            command=f"generate briefing for {args.date}",
            execute=True,
            device_target=args.device_target,
        )
        render_audio = agent_command(
            args.api_base,
            args.token,
            command=f"render briefing audio for {args.date}",
            execute=True,
            device_target=args.device_target,
        )
        task_command = agent_command(
            args.api_base,
            args.token,
            command=f"create task Starlog assistant smoke due {_tomorrow()} priority 2",
            execute=args.write_task,
            device_target=args.device_target,
        )

        codex_job: dict | None = None
        if args.queue_codex:
            queued = request_json(
                args.api_base,
                args.token,
                "/v1/agent/command/assist",
                method="POST",
                payload={
                    "command": f"create task Starlog Codex smoke due {_tomorrow()} priority 2",
                    "execute": False,
                    "device_target": args.device_target,
                    "provider_hint": args.codex_provider_hint,
                },
            )
            if not isinstance(queued, dict):
                raise RuntimeError("Unexpected queued Codex command response")
            codex_job = queued

        validate_user_flow(
            intents,
            generate_briefing,
            render_audio,
            task_command,
            write_task=args.write_task,
            codex_job=codex_job,
        )

        summary = {
            "status": "ok",
            "intent_count": len(intents) if isinstance(intents, list) else None,
            "briefing_status": generate_briefing.get("status"),
            "briefing_audio_status": render_audio.get("status"),
            "briefing_audio_job": _first_job_id(render_audio),
            "task_command_status": task_command.get("status"),
            "task_written": bool(args.write_task),
            "codex_job_id": codex_job.get("id") if codex_job else None,
            "codex_provider_hint": codex_job.get("provider_hint") if codex_job else None,
        }
        print(json.dumps(summary, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1


def validate_user_flow(
    intents: dict | list,
    generate_briefing: dict,
    render_audio: dict,
    task_command: dict,
    *,
    write_task: bool,
    codex_job: dict | None = None,
) -> None:
    if not isinstance(intents, list) or not intents:
        raise RuntimeError("Agent intents endpoint returned no intents.")

    _require_agent_response(
        "briefing command",
        generate_briefing,
        status="executed",
        matched_intent="generate_briefing",
        first_tool_name="generate_briefing",
        first_step_status="ok",
    )
    _require_agent_response(
        "briefing audio command",
        render_audio,
        status="executed",
        matched_intent="render_briefing_audio",
        first_tool_name="render_briefing_audio",
        first_step_status="ok",
    )
    job = _first_job(render_audio)
    if job is None:
        raise RuntimeError("Briefing audio command did not queue a job.")
    if job.get("action") != "briefing_audio":
        raise RuntimeError(f"Briefing audio command queued unexpected job action: {job.get('action')!r}")

    _require_agent_response(
        "task command",
        task_command,
        status="executed" if write_task else "planned",
        matched_intent="create_task",
        first_tool_name="create_task",
        first_step_status="ok" if write_task else "dry_run",
    )

    if codex_job is not None:
        if not isinstance(codex_job.get("id"), str) or not codex_job["id"].strip():
            raise RuntimeError("Codex assist command did not return a job id.")
        if codex_job.get("action") != "assistant_command_ai":
            raise RuntimeError(f"Codex assist command queued unexpected job action: {codex_job.get('action')!r}")


def _require_agent_response(
    label: str,
    response: dict,
    *,
    status: str,
    matched_intent: str,
    first_tool_name: str,
    first_step_status: str,
) -> None:
    if response.get("status") != status:
        raise RuntimeError(f"{label} returned status {response.get('status')!r}, expected {status!r}.")
    if response.get("matched_intent") != matched_intent:
        raise RuntimeError(
            f"{label} matched intent {response.get('matched_intent')!r}, expected {matched_intent!r}."
        )
    steps = response.get("steps")
    if not isinstance(steps, list) or not steps or not isinstance(steps[0], dict):
        raise RuntimeError(f"{label} returned no command steps.")
    first_step = steps[0]
    if first_step.get("tool_name") != first_tool_name:
        raise RuntimeError(
            f"{label} first tool was {first_step.get('tool_name')!r}, expected {first_tool_name!r}."
        )
    if first_step.get("status") != first_step_status:
        raise RuntimeError(
            f"{label} first step status was {first_step.get('status')!r}, expected {first_step_status!r}."
        )


def _first_job_id(command_response: dict) -> str | None:
    job = _first_job(command_response)
    return job["id"] if job is not None and isinstance(job.get("id"), str) else None


def _first_job(command_response: dict) -> dict | None:
    steps = command_response.get("steps")
    if not isinstance(steps, list):
        return None
    for step in steps:
        if not isinstance(step, dict):
            continue
        result = step.get("result")
        if isinstance(result, dict):
            job = result.get("job")
            if isinstance(job, dict):
                return job
    return None


if __name__ == "__main__":
    raise SystemExit(main())
