from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import subprocess

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field


DEFAULT_LOCAL_TTS_HOST = "127.0.0.1"
DEFAULT_LOCAL_TTS_PORT = 8093


@dataclass(frozen=True)
class LocalTtsConfig:
    host: str
    port: int
    auth_token: str
    backend: str
    provider_name: str
    command_template: str
    gpu_mode: str
    model_name: str


class LocalTtsHealthResponse(BaseModel):
    status: str
    service: str
    provider: str
    backend: str
    auth_required: bool
    authenticated: bool
    gpu_mode: str
    model_name: str | None = None
    detail: str


class LocalTtsSpeakRequest(BaseModel):
    text: str = Field(min_length=1)
    output_path: str | None = None
    provider_hint: str | None = None
    voice_name: str | None = None
    rate_wpm: int | None = None
    debug_audio_path: str | None = None


class LocalTtsSpeakResponse(BaseModel):
    status: str
    provider: str
    audio_path: str
    detail: str


def _read_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def load_local_tts_config() -> LocalTtsConfig:
    return LocalTtsConfig(
        host=os.getenv("STARLOG_LOCAL_TTS_HOST", DEFAULT_LOCAL_TTS_HOST).strip() or DEFAULT_LOCAL_TTS_HOST,
        port=_read_int("STARLOG_LOCAL_TTS_PORT", DEFAULT_LOCAL_TTS_PORT),
        auth_token=os.getenv("STARLOG_LOCAL_TTS_AUTH_TOKEN", "").strip(),
        backend=os.getenv("STARLOG_LOCAL_TTS_BACKEND", "command").strip() or "command",
        provider_name=os.getenv("STARLOG_LOCAL_TTS_PROVIDER_NAME", "local_tts_server").strip() or "local_tts_server",
        command_template=os.getenv("STARLOG_LOCAL_TTS_COMMAND", "").strip(),
        gpu_mode=os.getenv("STARLOG_LOCAL_TTS_GPU_MODE", "auto").strip() or "auto",
        model_name=os.getenv("STARLOG_LOCAL_TTS_MODEL_NAME", "").strip(),
    )


def _provided_token(request: Request) -> str:
    authorization = request.headers.get("authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return request.headers.get("x-starlog-local-tts-token", "").strip()


def _is_authenticated(request: Request, expected_token: str) -> bool:
    if not expected_token:
        return True
    return _provided_token(request) == expected_token


def _require_authenticated(request: Request, expected_token: str) -> None:
    if not _is_authenticated(request, expected_token):
        raise HTTPException(status_code=401, detail="Local TTS server authentication failed")


def _run_tts_command(template: str, *, output_path: Path, text: str, voice_name: str | None, rate_wpm: int | None) -> str:
    if not template:
        raise HTTPException(status_code=503, detail="STARLOG_LOCAL_TTS_COMMAND is not configured")
    variables = {
        "output_path": str(output_path),
        "output_base": str(output_path.with_suffix("")),
        "text": text,
        "voice": voice_name or "",
        "rate": str(rate_wpm or ""),
    }
    try:
        command = template.format(**variables)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Local TTS command is missing variable: {exc.args[0]}") from exc

    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        detail = result.stderr.strip() or "command failed"
        raise HTTPException(status_code=502, detail=detail)
    rendered_path = result.stdout.strip() or str(output_path)
    if not Path(rendered_path).exists():
        raise HTTPException(status_code=502, detail=f"Local TTS command did not create audio output: {rendered_path}")
    return rendered_path


app = FastAPI(title="Starlog Local TTS Server", version="0.1.0")


@app.get("/health", response_model=LocalTtsHealthResponse)
def health(request: Request) -> LocalTtsHealthResponse:
    config = load_local_tts_config()
    return LocalTtsHealthResponse(
        status="ok",
        service="starlog_local_tts_server",
        provider=config.provider_name,
        backend=config.backend,
        auth_required=bool(config.auth_token),
        authenticated=_is_authenticated(request, config.auth_token),
        gpu_mode=config.gpu_mode,
        model_name=config.model_name or None,
        detail=(
            f"Local TTS server is configured for {config.provider_name} with backend {config.backend}."
            if config.command_template
            else "Configure STARLOG_LOCAL_TTS_COMMAND to enable synthesis."
        ),
    )


@app.post("/v1/tts/speak", response_model=LocalTtsSpeakResponse)
def speak(payload: LocalTtsSpeakRequest, request: Request) -> LocalTtsSpeakResponse:
    config = load_local_tts_config()
    _require_authenticated(request, config.auth_token)

    if payload.debug_audio_path and payload.debug_audio_path.strip():
        return LocalTtsSpeakResponse(
            status="ok",
            provider="debug",
            audio_path=payload.debug_audio_path.strip(),
            detail="Local TTS server returned the supplied debug audio path without running synthesis.",
        )

    output_path = Path(payload.output_path or "/tmp/starlog-local-tts-output.wav")
    rendered_path = _run_tts_command(
        config.command_template,
        output_path=output_path,
        text=payload.text,
        voice_name=payload.voice_name,
        rate_wpm=payload.rate_wpm,
    )
    return LocalTtsSpeakResponse(
        status="ok",
        provider=config.provider_name,
        audio_path=rendered_path,
        detail=f"Local TTS server synthesized audio via {config.provider_name}.",
    )
