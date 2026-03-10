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


def _upload_media(api_base: str, token: str, path: Path, content_type: str | None = None) -> dict[str, Any]:
    boundary = f"starlog-upload-{os.urandom(8).hex()}"
    detected_content_type = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    file_bytes = path.read_bytes()
    body = b"".join(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode("utf-8"),
            f"Content-Type: {detected_content_type}\r\n\r\n".encode("utf-8"),
            file_bytes,
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    request = Request(
        f"{api_base.rstrip('/')}/v1/media/upload",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=60.0) as response:  # noqa: S310
            payload = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"POST /v1/media/upload failed with HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"POST /v1/media/upload failed: {exc.reason}") from exc

    try:
        decoded = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Media upload returned invalid JSON") from exc
    if not isinstance(decoded, dict):
        raise RuntimeError("Media upload returned unexpected response")
    return decoded


def _schema_for(job: dict) -> dict[str, Any]:
    capability = str(job["capability"])
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
    if capability == "llm_agent_plan":
        payload = job.get("payload", {})
        tool_catalog = payload.get("tool_catalog")
        tool_names: list[str] = []
        if isinstance(tool_catalog, list):
            for item in tool_catalog:
                if isinstance(item, dict) and isinstance(item.get("name"), str):
                    name = str(item["name"]).strip()
                    if name and name not in tool_names:
                        tool_names.append(name)
        tool_name_schema: dict[str, Any] = {"type": "string"}
        if tool_names:
            tool_name_schema["enum"] = tool_names
        return {
            "type": "object",
            "properties": {
                "matched_intent": {"type": "string"},
                "summary": {"type": "string"},
                "tool_calls": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "tool_name": tool_name_schema,
                            "arguments": {"type": "object"},
                            "message": {"type": "string"},
                        },
                        "required": ["tool_name", "arguments"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["matched_intent", "summary", "tool_calls"],
            "additionalProperties": False,
        }
    if capability == "tts":
        return {
            "type": "object",
            "properties": {
                "audio_ref": {"type": "string"},
            },
            "required": ["audio_ref"],
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
    if job["capability"] == "llm_agent_plan":
        command = str(payload.get("command") or "").strip()
        current_date = str(payload.get("current_date") or "").strip()
        intent_lines: list[str] = []
        for item in payload.get("intents", []) if isinstance(payload.get("intents"), list) else []:
            if not isinstance(item, dict):
                continue
            examples = item.get("examples")
            examples_text = ", ".join(str(entry) for entry in examples) if isinstance(examples, list) else ""
            intent_lines.append(
                f"- {item.get('name', 'unknown')}: {item.get('description', '')} Examples: {examples_text}"
            )
        tool_lines: list[str] = []
        for item in payload.get("tool_catalog", []) if isinstance(payload.get("tool_catalog"), list) else []:
            if not isinstance(item, dict):
                continue
            tool_lines.append(
                f"- {item.get('name', 'unknown')}: {item.get('description', '')} Parameters schema: {json.dumps(item.get('parameters_schema', {}), sort_keys=True)}"
            )
        return (
            "You are planning Starlog assistant tool calls for a single-user personal knowledge system. "
            "Return JSON only. Use only the provided tools. "
            "Prefer the smallest set of tool calls that fully satisfies the command. "
            "If a command is ambiguous, choose a safe read-only plan or an empty tool_calls array. "
            "The returned arguments must match each tool schema.\n\n"
            f"Current date: {current_date or 'unknown'}\n"
            f"Command: {command}\n\n"
            "Supported intents:\n"
            + ("\n".join(intent_lines) if intent_lines else "- none provided")
            + "\n\nAvailable tools:\n"
            + ("\n".join(tool_lines) if tool_lines else "- none provided")
        )
    if job["capability"] == "tts":
        return str(payload.get("text") or "").strip()
    raise ValueError(f"Unsupported capability for Codex execution: {job['capability']}")


def _run_codex(job: dict, model: str | None) -> dict:
    with tempfile.TemporaryDirectory(prefix="starlog-codex-job-") as temp_dir:
        temp_path = Path(temp_dir)
        schema_path = temp_path / "schema.json"
        output_path = temp_path / "output.json"
        schema_path.write_text(json.dumps(_schema_for(job), indent=2), encoding="utf-8")

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


def _tts_payload(job: dict) -> tuple[dict[str, Any], str, str | None, int | None]:
    payload = job.get("payload", {})
    text = str(payload.get("text") or "").strip()
    if not text:
        raise RuntimeError("TTS job is missing text")

    voice = str(payload.get("voice") or payload.get("voice_name") or "").strip() or None
    raw_rate = payload.get("rate_wpm", payload.get("rate", payload.get("speaking_rate")))
    rate: int | None = None
    if isinstance(raw_rate, str) and raw_rate.strip():
        try:
            rate = int(float(raw_rate.strip()))
        except ValueError:
            rate = None
    elif isinstance(raw_rate, (int, float)):
        rate = int(raw_rate)
    if rate is not None:
        rate = max(80, min(rate, 360))

    return payload, text, voice, rate


def _maybe_convert_audio_for_upload(input_path: Path, ffmpeg_command: str | None) -> Path | None:
    if not ffmpeg_command:
        return None

    output_path = input_path.with_suffix(".wav")
    try:
        result = subprocess.run(
            [
                ffmpeg_command,
                "-y",
                "-i",
                str(input_path),
                "-ar",
                "22050",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    if result.returncode != 0 or not output_path.exists():
        return None
    return output_path


def _upload_tts_output(api_base: str, token: str, path: Path) -> dict[str, Any]:
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    uploaded = _upload_media(api_base, token, path, content_type=content_type)
    return {
        "audio_ref": uploaded.get("blob_ref", ""),
        "audio_asset": uploaded,
        "content_type": content_type,
    }


def _run_tts_piper(job: dict, api_base: str, token: str, tts_command: str | None) -> dict:
    command_template = tts_command or os.environ.get("STARLOG_TTS_COMMAND", "").strip()
    if not command_template:
        raise RuntimeError("Set --tts-command or STARLOG_TTS_COMMAND for piper_local tts jobs")

    _, text, voice, rate = _tts_payload(job)

    with tempfile.TemporaryDirectory(prefix="starlog-tts-job-") as temp_dir:
        temp_path = Path(temp_dir)
        output_path = temp_path / "tts-output.wav"
        command = shlex.split(
            command_template.format(
                output_path=str(output_path),
                output_base=str(output_path.with_suffix("")),
                voice=voice or "",
                rate=str(rate or ""),
                text=text,
            )
        )
        result = subprocess.run(command, input=text, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "TTS command failed")
        if not output_path.exists():
            raise RuntimeError("TTS command completed without writing an audio file")
        response = _upload_tts_output(api_base, token, output_path)
        if voice:
            response["voice"] = voice
        if rate is not None:
            response["rate_wpm"] = rate
        return response


def _run_tts_say(job: dict, api_base: str, token: str, ffmpeg_command: str) -> dict:
    _, text, voice, rate = _tts_payload(job)

    with tempfile.TemporaryDirectory(prefix="starlog-tts-job-") as temp_dir:
        temp_path = Path(temp_dir)
        output_path = temp_path / "tts-output.aiff"
        command = ["say", "-o", str(output_path)]
        if voice:
            command.extend(["-v", voice])
        if rate is not None:
            command.extend(["-r", str(rate)])
        command.append(text)
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "say command failed")
        if not output_path.exists():
            raise RuntimeError("say completed without writing an audio file")

        upload_path = _maybe_convert_audio_for_upload(output_path, ffmpeg_command) or output_path
        response = _upload_tts_output(api_base, token, upload_path)
        response["source_format"] = "aiff"
        if voice:
            response["voice"] = voice
        if rate is not None:
            response["rate_wpm"] = rate
        return response


def _run_tts_espeak(job: dict, api_base: str, token: str, program: str) -> dict:
    _, text, voice, rate = _tts_payload(job)

    with tempfile.TemporaryDirectory(prefix="starlog-tts-job-") as temp_dir:
        temp_path = Path(temp_dir)
        output_path = temp_path / "tts-output.wav"
        command = [program, "-w", str(output_path)]
        if voice:
            command.extend(["-v", voice])
        if rate is not None:
            command.extend(["-s", str(rate)])
        command.append(text)
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"{program} command failed")
        if not output_path.exists():
            raise RuntimeError(f"{program} completed without writing an audio file")

        response = _upload_tts_output(api_base, token, output_path)
        if voice:
            response["voice"] = voice
        if rate is not None:
            response["rate_wpm"] = rate
        return response


def _run_tts(job: dict, api_base: str, token: str, tts_command: str | None, ffmpeg_command: str) -> tuple[str, dict]:
    provider_hint = str(job.get("provider_hint") or "").strip() or "piper_local"
    if provider_hint == "piper_local":
        return provider_hint, _run_tts_piper(job, api_base, token, tts_command)
    if provider_hint == "say_local":
        return provider_hint, _run_tts_say(job, api_base, token, ffmpeg_command)
    if provider_hint == "espeak_local":
        return provider_hint, _run_tts_espeak(job, api_base, token, "espeak")
    if provider_hint == "espeak_ng_local":
        return provider_hint, _run_tts_espeak(job, api_base, token, "espeak-ng")
    raise RuntimeError(f"Unsupported local TTS provider_hint: {provider_hint}")


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
    tts_command: str | None,
) -> tuple[str, dict]:
    capability = str(job["capability"])
    if capability in {"llm_summary", "llm_cards", "llm_tasks", "llm_agent_plan"}:
        return "codex_local", _run_codex(job, model=codex_model)
    if capability == "stt":
        return "whisper_local", _run_whisper(job, api_base, token, whisper_command, ffmpeg_command)
    if capability == "tts":
        return _run_tts(job, api_base, token, tts_command, ffmpeg_command)
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
    tts_command: str | None,
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
                    tts_command=tts_command,
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
    parser.add_argument("--provider-hints", default="codex_local,whisper_local,piper_local,say_local,espeak_local,espeak_ng_local")
    parser.add_argument("--worker-id", default=f"local-ai-{socket.gethostname()}")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--poll-seconds", type=float, default=30.0)
    parser.add_argument("--codex-model", default=None)
    parser.add_argument("--whisper-command", default=None)
    parser.add_argument("--ffmpeg-command", default="ffmpeg")
    parser.add_argument("--tts-command", default=None)
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
            tts_command=args.tts_command,
            once=args.once,
        )
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
