"""Process queued Starlog AI jobs with local Codex/Whisper tools."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import shlex
import shutil
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

AI_RUNTIME_ROOT = Path(__file__).resolve().parents[1] / "services" / "ai-runtime"
if str(AI_RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_RUNTIME_ROOT))

from runtime_app.prompt_loader import load_prompt as _load_prompt
from runtime_app.prompt_loader import render_prompt as _render_prompt

LLM_PROVIDER_HINTS = {
    "",
    "codex_local",
    "desktop_bridge_codex",
    "mobile_bridge_codex",
    "desktop_bridge",
    "mobile_bridge",
}
STT_PROVIDER_HINTS = {
    "",
    "whisper_local",
    "desktop_bridge_stt",
    "mobile_bridge_stt",
    "desktop_bridge",
    "mobile_bridge",
}
TTS_PROVIDER_HINTS = {
    "",
    "desktop_bridge_tts",
    "mobile_bridge_tts",
    "desktop_bridge",
    "mobile_bridge",
    "piper_local",
    "say_local",
    "espeak_local",
    "espeak_ng_local",
}
DEFAULT_CODEX_MODEL = "gpt-5.4-mini"


def _default_codex_model() -> str | None:
    if os.environ.get("STARLOG_CODEX_USE_CLI_DEFAULT", "").strip().lower() in {"1", "true", "yes", "on"}:
        return None
    configured = os.environ.get("STARLOG_CODEX_MODEL")
    if configured is not None:
        return configured.strip() or None
    return DEFAULT_CODEX_MODEL


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


def _command_available(command: str) -> bool:
    return bool(shutil.which(command))


def _detect_tts_provider(tts_command: str | None) -> tuple[str | None, str]:
    if tts_command or os.environ.get("STARLOG_TTS_COMMAND", "").strip():
        return "piper_local", "tts_command_template"
    if sys.platform == "darwin" and _command_available("say"):
        return "say_local", "native_say_available"
    if _command_available("espeak-ng"):
        return "espeak_ng_local", "espeak_ng_available"
    if _command_available("espeak"):
        return "espeak_local", "espeak_available"
    return None, "no_local_tts_runtime_detected"


def _resolve_provider(job: dict, *, tts_command: str | None) -> tuple[str, dict[str, Any]]:
    capability = str(job.get("capability") or "")
    requested = str(job.get("provider_hint") or "").strip()
    requested_norm = requested.lower()
    metadata: dict[str, Any] = {
        "requested_provider_hint": requested or None,
        "capability": capability,
    }

    if capability in {"llm_summary", "llm_cards", "llm_tasks", "llm_agent_plan"}:
        if requested_norm in LLM_PROVIDER_HINTS:
            metadata["provider_resolution_reason"] = "llm_bridge_or_local"
            return "codex_local", metadata
        raise RuntimeError(f"Unsupported local LLM provider_hint: {requested or '(empty)'}")

    if capability == "stt":
        if requested_norm in STT_PROVIDER_HINTS:
            metadata["provider_resolution_reason"] = "stt_bridge_or_local"
            return "whisper_local", metadata
        raise RuntimeError(f"Unsupported local STT provider_hint: {requested or '(empty)'}")

    if capability == "tts":
        if requested_norm in {"piper_local", "say_local", "espeak_local", "espeak_ng_local"}:
            metadata["provider_resolution_reason"] = "explicit_local_tts_provider"
            return requested_norm, metadata
        if requested_norm in TTS_PROVIDER_HINTS:
            detected_provider, reason = _detect_tts_provider(tts_command)
            if detected_provider is None:
                raise RuntimeError(
                    "No local TTS runtime available. Configure STARLOG_TTS_COMMAND/--tts-command, "
                    "or install a supported local provider (say/espeak/espeak-ng)."
                )
            metadata["provider_resolution_reason"] = reason
            return detected_provider, metadata
        raise RuntimeError(f"Unsupported local TTS provider_hint: {requested or '(empty)'}")

    raise RuntimeError(f"Unsupported queued capability: {capability}")


def _with_worker_metadata(output: dict, provider_used: str, provider_meta: dict[str, Any]) -> dict:
    return {
        **output,
        "_worker": {
            "provider_used": provider_used,
            **provider_meta,
        },
    }


def _classify_failure(exc: Exception) -> tuple[str, bool]:
    if isinstance(exc, subprocess.TimeoutExpired):
        return "timeout", True

    message = str(exc).lower()
    if "timed out" in message:
        return "timeout", True
    if "failed with http 5" in message:
        return "upstream_5xx", True
    if "failed:" in message and any(token in message for token in ("tempor", "refused", "reset", "timeout", "timed out")):
        return "network", True
    if "unsupported local" in message:
        return "unsupported_provider", False
    if "missing" in message or "no local tts runtime available" in message:
        return "invalid_payload", False
    if "no such file or directory" in message or "not found" in message:
        return "dependency_missing", False
    return "execution_error", False


def _format_failure_message(exc: Exception, *, category: str, retryable: bool, attempt: int, max_attempts: int) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    if len(message) > 1500:
        message = message[:1500] + "..."
    return (
        f"[category={category};retryable={'true' if retryable else 'false'};attempt={attempt}/{max_attempts}] "
        f"{message}"
    )


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
                            "arguments_json": {"type": "string"},
                            "message": {"type": "string"},
                        },
                        "required": ["tool_name", "arguments_json", "message"],
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


def _text_source(payload: dict) -> str:
    return str(payload.get("text") or payload.get("content") or payload.get("text_hint") or "").strip()


def _prompt_parts_for(job: dict) -> tuple[str, str]:
    payload = job.get("payload", {})
    title = str(payload.get("title") or "Untitled")
    text = _text_source(payload)

    if job["capability"] == "llm_summary":
        return (
            _load_prompt("llm_summary.system.txt"),
            _render_prompt("llm_summary.user.txt", title=title, text=text),
        )
    if job["capability"] == "llm_cards":
        return (
            _load_prompt("llm_cards.system.txt"),
            _render_prompt("llm_cards.user.txt", title=title, text=text),
        )
    if job["capability"] == "llm_tasks":
        return (
            _load_prompt("llm_tasks.system.txt"),
            _render_prompt("llm_tasks.user.txt", title=title, text=text),
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
            confirmation_policy = item.get("confirmation_policy")
            confirmation_text = ""
            if isinstance(confirmation_policy, dict):
                mode = str(confirmation_policy.get("mode") or "").strip()
                reason = str(confirmation_policy.get("reason") or "").strip()
                if mode:
                    confirmation_text = f" Confirmation policy: {mode}."
                if reason:
                    confirmation_text = f"{confirmation_text} {reason}".strip()
            tool_lines.append(
                f"- {item.get('name', 'unknown')}: {item.get('description', '')} "
                f"Parameters schema: {json.dumps(item.get('parameters_schema', {}), sort_keys=True)}"
                f"{confirmation_text}"
            )
        return (
            _load_prompt("llm_agent_plan.system.txt"),
            _render_prompt(
                "llm_agent_plan.user.txt",
                current_date=current_date or "unknown",
                command=command or text,
                intent_lines="\n".join(intent_lines) if intent_lines else "- none provided",
                tool_lines="\n".join(tool_lines) if tool_lines else "- none provided",
            ),
        )
    if job["capability"] == "tts":
        return ("", str(payload.get("text") or "").strip())
    raise ValueError(f"Unsupported capability for Codex execution: {job['capability']}")


def _prompt_for(job: dict) -> str:
    system_prompt, user_prompt = _prompt_parts_for(job)
    prompt_parts = [part.strip() for part in (system_prompt, user_prompt) if part and part.strip()]
    if not prompt_parts:
        raise RuntimeError(f"No prompt content resolved for capability {job['capability']}")
    return "\n\n".join(prompt_parts)


def _run_codex(job: dict, model: str | None, timeout_seconds: float) -> dict:
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

        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=timeout_seconds)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Codex exec failed")
        if not output_path.exists():
            raise RuntimeError("Codex exec finished without writing structured output")
        decoded = json.loads(output_path.read_text(encoding="utf-8"))
        if str(job["capability"]) == "llm_agent_plan":
            raw_calls = decoded.get("tool_calls")
            if isinstance(raw_calls, list):
                normalized_calls: list[dict[str, Any]] = []
                for item in raw_calls:
                    if not isinstance(item, dict):
                        continue
                    normalized = dict(item)
                    arguments_json = normalized.pop("arguments_json", None)
                    if isinstance(arguments_json, str):
                        try:
                            arguments = json.loads(arguments_json)
                        except json.JSONDecodeError as exc:
                            raise RuntimeError(
                                f"Planner returned invalid arguments_json for {normalized.get('tool_name')}: {arguments_json}"
                            ) from exc
                        if not isinstance(arguments, dict):
                            raise RuntimeError(
                                f"Planner returned non-object arguments_json for {normalized.get('tool_name')}"
                            )
                        normalized["arguments"] = arguments
                    normalized_calls.append(normalized)
                decoded["tool_calls"] = normalized_calls
        return decoded


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


def _prepare_audio_for_whisper(input_path: Path, ffmpeg_command: str, ffmpeg_timeout_seconds: float) -> Path:
    if input_path.suffix.lower() == ".wav":
        return input_path

    output_path = input_path.with_suffix(".wav")
    result = subprocess.run(
        [ffmpeg_command, "-y", "-i", str(input_path), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(output_path)],
        capture_output=True,
        text=True,
        check=False,
        timeout=ffmpeg_timeout_seconds,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "ffmpeg conversion failed. Install ffmpeg or upload WAV audio. "
            + (result.stderr.strip() or result.stdout.strip())
        )
    return output_path


def _run_whisper(
    job: dict,
    api_base: str,
    token: str,
    whisper_command: str | None,
    ffmpeg_command: str,
    whisper_timeout_seconds: float,
    ffmpeg_timeout_seconds: float,
) -> dict:
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
        input_path = _prepare_audio_for_whisper(source_path, ffmpeg_command, ffmpeg_timeout_seconds)
        output_base = temp_path / "transcript"
        output_path = Path(f"{output_base}.txt")

        command = shlex.split(
            command_template.format(
                input_path=str(input_path),
                output_base=str(output_base),
                output_path=str(output_path),
            )
        )
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=whisper_timeout_seconds,
        )
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


def _maybe_convert_audio_for_upload(
    input_path: Path,
    ffmpeg_command: str | None,
    ffmpeg_timeout_seconds: float,
) -> Path | None:
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
            timeout=ffmpeg_timeout_seconds,
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


def _run_tts_piper(
    job: dict,
    api_base: str,
    token: str,
    tts_command: str | None,
    tts_timeout_seconds: float,
) -> dict:
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
        result = subprocess.run(
            command,
            input=text,
            capture_output=True,
            text=True,
            check=False,
            timeout=tts_timeout_seconds,
        )
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


def _run_tts_say(
    job: dict,
    api_base: str,
    token: str,
    ffmpeg_command: str,
    tts_timeout_seconds: float,
    ffmpeg_timeout_seconds: float,
) -> dict:
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
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=tts_timeout_seconds,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "say command failed")
        if not output_path.exists():
            raise RuntimeError("say completed without writing an audio file")

        upload_path = _maybe_convert_audio_for_upload(output_path, ffmpeg_command, ffmpeg_timeout_seconds) or output_path
        response = _upload_tts_output(api_base, token, upload_path)
        response["source_format"] = "aiff"
        if voice:
            response["voice"] = voice
        if rate is not None:
            response["rate_wpm"] = rate
        return response


def _run_tts_espeak(
    job: dict,
    api_base: str,
    token: str,
    program: str,
    tts_timeout_seconds: float,
) -> dict:
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
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=tts_timeout_seconds,
        )
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


def _run_tts(
    job: dict,
    api_base: str,
    token: str,
    *,
    provider_used: str,
    tts_command: str | None,
    ffmpeg_command: str,
    tts_timeout_seconds: float,
    ffmpeg_timeout_seconds: float,
) -> dict:
    if provider_used == "piper_local":
        return _run_tts_piper(job, api_base, token, tts_command, tts_timeout_seconds)
    if provider_used == "say_local":
        return _run_tts_say(job, api_base, token, ffmpeg_command, tts_timeout_seconds, ffmpeg_timeout_seconds)
    if provider_used == "espeak_local":
        return _run_tts_espeak(job, api_base, token, "espeak", tts_timeout_seconds)
    if provider_used == "espeak_ng_local":
        return _run_tts_espeak(job, api_base, token, "espeak-ng", tts_timeout_seconds)
    raise RuntimeError(f"Unsupported local TTS provider_used: {provider_used}")


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
    codex_timeout_seconds: float,
    whisper_timeout_seconds: float,
    tts_timeout_seconds: float,
    ffmpeg_timeout_seconds: float,
) -> tuple[str, dict]:
    capability = str(job["capability"])
    provider_used, provider_meta = _resolve_provider(job, tts_command=tts_command)
    if capability in {"llm_summary", "llm_cards", "llm_tasks", "llm_agent_plan"}:
        output = _run_codex(job, model=codex_model, timeout_seconds=codex_timeout_seconds)
        return provider_used, _with_worker_metadata(output, provider_used, provider_meta)
    if capability == "stt":
        output = _run_whisper(
            job,
            api_base,
            token,
            whisper_command,
            ffmpeg_command,
            whisper_timeout_seconds,
            ffmpeg_timeout_seconds,
        )
        return provider_used, _with_worker_metadata(output, provider_used, provider_meta)
    if capability == "tts":
        output = _run_tts(
            job,
            api_base,
            token,
            provider_used=provider_used,
            tts_command=tts_command,
            ffmpeg_command=ffmpeg_command,
            tts_timeout_seconds=tts_timeout_seconds,
            ffmpeg_timeout_seconds=ffmpeg_timeout_seconds,
        )
        return provider_used, _with_worker_metadata(output, provider_used, provider_meta)
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
    retryable_attempts: int,
    codex_timeout_seconds: float,
    whisper_timeout_seconds: float,
    tts_timeout_seconds: float,
    ffmpeg_timeout_seconds: float,
    once: bool,
) -> int:
    processed_any = False
    max_attempts = max(1, retryable_attempts)

    while True:
        jobs_by_id: dict[str, dict] = {}
        for provider_hint in provider_hints:
            for job in _pending_jobs(api_base, token, provider_hint=provider_hint, limit=limit):
                jobs_by_id[str(job.get("id") or "")] = job
        jobs = [item for item in jobs_by_id.values() if str(item.get("id") or "").strip()]

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
            attempt = 1
            while True:
                try:
                    provider_used, output = _run_job(
                        claimed,
                        api_base=api_base,
                        token=token,
                        codex_model=codex_model,
                        whisper_command=whisper_command,
                        ffmpeg_command=ffmpeg_command,
                        tts_command=tts_command,
                        codex_timeout_seconds=codex_timeout_seconds,
                        whisper_timeout_seconds=whisper_timeout_seconds,
                        tts_timeout_seconds=tts_timeout_seconds,
                        ffmpeg_timeout_seconds=ffmpeg_timeout_seconds,
                    )
                    _complete(api_base, token, str(claimed["id"]), worker_id, provider_used, output)
                    print(f"Completed {claimed['id']} via {provider_used}")
                    break
                except Exception as exc:  # noqa: BLE001
                    category, retryable = _classify_failure(exc)
                    should_retry = retryable and attempt < max_attempts
                    if should_retry:
                        print(
                            f"Retrying {claimed['id']} after {category} failure "
                            f"(attempt {attempt}/{max_attempts}): {exc}",
                            file=sys.stderr,
                        )
                        attempt += 1
                        time.sleep(min(3.0, poll_seconds))
                        continue

                    try:
                        provider_used, _meta = _resolve_provider(claimed, tts_command=tts_command)
                    except Exception:  # noqa: BLE001
                        provider_used = str(claimed.get("provider_hint") or "local")
                    error_text = _format_failure_message(
                        exc,
                        category=category,
                        retryable=retryable,
                        attempt=attempt,
                        max_attempts=max_attempts,
                    )
                    _fail(
                        api_base,
                        token,
                        str(claimed["id"]),
                        worker_id,
                        error_text,
                        provider_used,
                    )
                    print(f"Failed {claimed['id']}: {error_text}", file=sys.stderr)
                    break

        if once:
            return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument("--token", required=True)
    parser.add_argument(
        "--provider-hints",
        default=(
            "desktop_bridge_codex,mobile_bridge_codex,"
            "desktop_bridge_stt,mobile_bridge_stt,"
            "desktop_bridge_tts,mobile_bridge_tts,"
            "codex_local,whisper_local,piper_local,say_local,espeak_local,espeak_ng_local"
        ),
    )
    parser.add_argument("--worker-id", default=f"local-ai-{socket.gethostname()}")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--poll-seconds", type=float, default=30.0)
    parser.add_argument("--retryable-attempts", type=int, default=2)
    parser.add_argument(
        "--codex-model",
        default=_default_codex_model(),
        help="Model passed to `codex exec` for local LLM jobs. Defaults to gpt-5.4-mini; set STARLOG_CODEX_USE_CLI_DEFAULT=1 or pass --codex-use-cli-default to let the Codex CLI choose.",
    )
    parser.add_argument(
        "--codex-use-cli-default",
        action="store_true",
        help="Omit -m when running `codex exec`. Useful for ChatGPT-account Codex auth modes that do not expose gpt-5.4-mini.",
    )
    parser.add_argument("--codex-timeout-seconds", type=float, default=600.0)
    parser.add_argument("--whisper-command", default=None)
    parser.add_argument("--whisper-timeout-seconds", type=float, default=600.0)
    parser.add_argument("--ffmpeg-command", default="ffmpeg")
    parser.add_argument("--ffmpeg-timeout-seconds", type=float, default=120.0)
    parser.add_argument("--tts-command", default=None)
    parser.add_argument("--tts-timeout-seconds", type=float, default=240.0)
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
            codex_model=None if args.codex_use_cli_default else args.codex_model,
            whisper_command=args.whisper_command,
            ffmpeg_command=args.ffmpeg_command,
            tts_command=args.tts_command,
            retryable_attempts=args.retryable_attempts,
            codex_timeout_seconds=args.codex_timeout_seconds,
            whisper_timeout_seconds=args.whisper_timeout_seconds,
            tts_timeout_seconds=args.tts_timeout_seconds,
            ffmpeg_timeout_seconds=args.ffmpeg_timeout_seconds,
            once=args.once,
        )
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
