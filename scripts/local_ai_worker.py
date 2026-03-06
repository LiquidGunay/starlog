"""Process queued Starlog AI jobs with local Codex/Whisper tools."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import shlex
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _request_json(url: str, token: str, method: str = "GET", payload: dict | None = None) -> dict | list:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(url, data=data, headers=_headers(token), method=method)
    try:
        with urlopen(request, timeout=30.0) as response:  # noqa: S310
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"{method} {url} failed: {exc.reason}") from exc

    if not raw.strip():
        return {}
    return json.loads(raw)


def _download_bytes(url: str, token: str) -> tuple[bytes, str | None]:
    request = Request(url, headers={"Authorization": f"Bearer {token}"}, method="GET")
    try:
        with urlopen(request, timeout=60.0) as response:  # noqa: S310
            return response.read(), response.headers.get_content_type()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"GET {url} failed with HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"GET {url} failed: {exc.reason}") from exc


def _schema_for(capability: str) -> dict[str, Any]:
    if capability == "llm_summary":
        return {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
            },
            "required": ["summary"],
            "additionalProperties": False,
        }
    if capability == "llm_cards":
        return {
            "type": "object",
            "properties": {
                "cards": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "prompt": {"type": "string"},
                            "answer": {"type": "string"},
                            "card_type": {"type": "string"},
                        },
                        "required": ["prompt", "answer"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["cards"],
            "additionalProperties": False,
        }
    if capability == "llm_tasks":
        return {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "estimate_min": {"type": "integer"},
                            "priority": {"type": "integer"},
                        },
                        "required": ["title"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["tasks"],
            "additionalProperties": False,
        }
    raise ValueError(f"Unsupported capability for Codex execution: {capability}")


def _prompt_for(job: dict) -> str:
    payload = job.get("payload", {})
    title = str(payload.get("title") or "Untitled")
    text = str(payload.get("text") or payload.get("content") or "").strip()

    if job["capability"] == "llm_summary":
        return (
            "Summarize the source for a personal knowledge system. Return JSON only.\n\n"
            f"Title: {title}\n\nSource:\n{text}"
        )
    if job["capability"] == "llm_cards":
        return (
            "Create concise study cards from the source. Return JSON only.\n\n"
            f"Title: {title}\n\nSource:\n{text}"
        )
    if job["capability"] == "llm_tasks":
        return (
            "Create concrete next-step tasks from the source. Return JSON only.\n\n"
            f"Title: {title}\n\nSource:\n{text}"
        )
    raise ValueError(f"Unsupported capability for Codex execution: {job['capability']}")


def _run_codex(job: dict, model: str | None) -> dict:
    with tempfile.TemporaryDirectory(prefix="starlog-codex-job-") as temp_dir:
        temp_path = Path(temp_dir)
        schema_path = temp_path / "schema.json"
        output_path = temp_path / "output.json"
        schema_path.write_text(json.dumps(_schema_for(str(job["capability"])), indent=2), encoding="utf-8")

        command = [
            "codex",
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--output-schema",
            str(schema_path),
            "-o",
            str(output_path),
            _prompt_for(job),
        ]
        if model:
            command[2:2] = ["-m", model]

        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Codex exec failed")
        if not output_path.exists():
            raise RuntimeError("Codex exec finished without writing structured output")
        return json.loads(output_path.read_text(encoding="utf-8"))


def _blob_url(api_base: str, blob_ref: str) -> str:
    if blob_ref.startswith("media://"):
        media_id = blob_ref.removeprefix("media://").strip()
        if not media_id:
            raise RuntimeError("media:// blob_ref is missing the media id")
        return f"{api_base.rstrip('/')}/v1/media/{media_id}/content"
    parsed = urlparse(blob_ref)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return blob_ref
    raise RuntimeError(f"Unsupported blob_ref: {blob_ref}")


def _download_blob(api_base: str, token: str, blob_ref: str, temp_path: Path) -> Path:
    url = _blob_url(api_base, blob_ref)
    payload, content_type = _download_bytes(url, token)
    suffix = Path(urlparse(url).path).suffix or mimetypes.guess_extension(content_type or "") or ".bin"
    destination = temp_path / f"input{suffix}"
    destination.write_bytes(payload)
    return destination


def _prepare_audio_for_whisper(input_path: Path, ffmpeg_command: str) -> Path:
    if input_path.suffix.lower() == ".wav":
        return input_path

    output_path = input_path.with_suffix(".wav")
    result = subprocess.run(
        [ffmpeg_command, "-y", "-i", str(input_path), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(output_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "ffmpeg conversion failed. Install ffmpeg or upload WAV audio. "
            + (result.stderr.strip() or result.stdout.strip())
        )
    return output_path


def _run_whisper(job: dict, api_base: str, token: str, whisper_command: str | None, ffmpeg_command: str) -> dict:
    command_template = whisper_command or os.environ.get("STARLOG_WHISPER_COMMAND", "").strip()
    if not command_template:
        raise RuntimeError("Set --whisper-command or STARLOG_WHISPER_COMMAND for whisper_local jobs")

    payload = job.get("payload", {})
    blob_ref = str(payload.get("blob_ref") or "").strip()
    if not blob_ref:
        raise RuntimeError("STT job is missing blob_ref")

    with tempfile.TemporaryDirectory(prefix="starlog-whisper-job-") as temp_dir:
        temp_path = Path(temp_dir)
        source_path = _download_blob(api_base, token, blob_ref, temp_path)
        input_path = _prepare_audio_for_whisper(source_path, ffmpeg_command)
        output_base = temp_path / "transcript"
        output_path = Path(f"{output_base}.txt")

        command = shlex.split(
            command_template.format(
                input_path=str(input_path),
                output_base=str(output_base),
                output_path=str(output_path),
            )
        )
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Whisper command failed")

        transcript = ""
        if output_path.exists():
            transcript = output_path.read_text(encoding="utf-8").strip()
        if not transcript:
            transcript = result.stdout.strip()
        if not transcript:
            raise RuntimeError("Whisper command completed without transcript output")
        return {"transcript": transcript}


def _pending_jobs(api_base: str, token: str, provider_hint: str, limit: int) -> list[dict]:
    payload = _request_json(
        f"{api_base.rstrip('/')}/v1/ai/jobs?status=pending&provider_hint={provider_hint}&limit={limit}",
        token,
    )
    if not isinstance(payload, list):
        raise RuntimeError("Unexpected AI job list response")
    return payload


def _claim(api_base: str, token: str, job_id: str, worker_id: str) -> dict:
    payload = _request_json(
        f"{api_base.rstrip('/')}/v1/ai/jobs/{job_id}/claim",
        token,
        method="POST",
        payload={"worker_id": worker_id},
    )
    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected AI job claim response")
    return payload


def _complete(api_base: str, token: str, job_id: str, worker_id: str, provider_used: str, output: dict) -> None:
    _request_json(
        f"{api_base.rstrip('/')}/v1/ai/jobs/{job_id}/complete",
        token,
        method="POST",
        payload={
            "worker_id": worker_id,
            "provider_used": provider_used,
            "output": output,
        },
    )


def _fail(api_base: str, token: str, job_id: str, worker_id: str, error_text: str, provider_used: str) -> None:
    _request_json(
        f"{api_base.rstrip('/')}/v1/ai/jobs/{job_id}/fail",
        token,
        method="POST",
        payload={
            "worker_id": worker_id,
            "provider_used": provider_used,
            "error_text": error_text,
        },
    )


def _run_job(
    job: dict,
    *,
    api_base: str,
    token: str,
    codex_model: str | None,
    whisper_command: str | None,
    ffmpeg_command: str,
) -> tuple[str, dict]:
    capability = str(job["capability"])
    if capability in {"llm_summary", "llm_cards", "llm_tasks"}:
        return "codex_local", _run_codex(job, model=codex_model)
    if capability == "stt":
        return "whisper_local", _run_whisper(job, api_base, token, whisper_command, ffmpeg_command)
    raise RuntimeError(f"Unsupported queued capability: {capability}")


def run_loop(
    api_base: str,
    token: str,
    provider_hints: list[str],
    worker_id: str,
    limit: int,
    poll_seconds: float,
    codex_model: str | None,
    whisper_command: str | None,
    ffmpeg_command: str,
    once: bool,
) -> int:
    processed_any = False

    while True:
        jobs: list[dict] = []
        for provider_hint in provider_hints:
            jobs.extend(_pending_jobs(api_base, token, provider_hint=provider_hint, limit=limit))

        if not jobs:
            if once:
                print("No pending AI jobs.")
                return 0
            if not processed_any:
                print("No pending AI jobs. Waiting...")
            time.sleep(poll_seconds)
            continue

        processed_any = True
        for job in jobs[:limit]:
            try:
                claimed = _claim(api_base, token, str(job["id"]), worker_id)
            except RuntimeError:
                continue

            print(f"Claimed {claimed['id']} ({claimed['capability']})")
            try:
                provider_used, output = _run_job(
                    claimed,
                    api_base=api_base,
                    token=token,
                    codex_model=codex_model,
                    whisper_command=whisper_command,
                    ffmpeg_command=ffmpeg_command,
                )
                _complete(api_base, token, str(claimed["id"]), worker_id, provider_used, output)
                print(f"Completed {claimed['id']}")
            except Exception as exc:  # noqa: BLE001
                _fail(api_base, token, str(claimed["id"]), worker_id, str(exc), str(claimed.get("provider_hint") or "local"))
                print(f"Failed {claimed['id']}: {exc}", file=sys.stderr)

        if once:
            return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument("--token", required=True)
    parser.add_argument("--provider-hints", default="codex_local,whisper_local")
    parser.add_argument("--worker-id", default=f"local-ai-{socket.gethostname()}")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--poll-seconds", type=float, default=30.0)
    parser.add_argument("--codex-model", default=None)
    parser.add_argument("--whisper-command", default=None)
    parser.add_argument("--ffmpeg-command", default="ffmpeg")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)

    provider_hints = [item.strip() for item in args.provider_hints.split(",") if item.strip()]
    if not provider_hints:
        raise RuntimeError("At least one provider hint is required")

    try:
        return run_loop(
            api_base=args.api_base,
            token=args.token,
            provider_hints=provider_hints,
            worker_id=args.worker_id,
            limit=args.limit,
            poll_seconds=args.poll_seconds,
            codex_model=args.codex_model,
            whisper_command=args.whisper_command,
            ffmpeg_command=args.ffmpeg_command,
            once=args.once,
        )
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
