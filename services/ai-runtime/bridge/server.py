from __future__ import annotations

import json
import mimetypes
from pathlib import Path
import subprocess
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest
from urllib.request import urlopen
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from bridge.config import capability_summary, load_bridge_config, parse_static_context
from bridge.schemas import BridgeHealthResponse, ContextResponse, SttRequest, SttResponse, TtsRequest, TtsResponse

app = FastAPI(title="Starlog Desktop Local Bridge", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _run_command(template: str, variables: dict[str, str]) -> str:
    try:
        command = template.format(**variables)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Bridge command is missing variable: {exc.args[0]}") from exc

    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        stderr = result.stderr.strip() or "command failed"
        raise HTTPException(status_code=502, detail=stderr)
    return result.stdout.strip()


def _server_headers(auth_token: str, *, content_type: str | None = None) -> dict[str, str]:
    headers: dict[str, str] = {}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _multipart_body(
    *,
    file_field: str,
    file_path: Path,
    fields: dict[str, str],
) -> tuple[bytes, str]:
    boundary = f"starlog-boundary-{uuid.uuid4().hex}"
    body = bytearray()
    for name, value in fields.items():
        if not value:
            continue
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        body.extend(value.encode("utf-8"))
        body.extend(b"\r\n")

    mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(
        (
            f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode("utf-8")
    )
    body.extend(file_path.read_bytes())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))
    return bytes(body), boundary


def _read_response_payload(response) -> tuple[str, str]:
    content_type = response.headers.get("Content-Type", "")
    payload = response.read().decode("utf-8", errors="replace").strip()
    return content_type, payload


def _extract_transcript(*, payload: str, content_type: str) -> str:
    if "json" in content_type.lower() or payload.startswith("{"):
        parsed = json.loads(payload)
        if isinstance(parsed, dict):
            for key in ("transcript", "text", "output"):
                value = parsed.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return payload.strip()


def _call_stt_server(config, payload: SttRequest) -> str:
    if not payload.audio_path:
        raise HTTPException(status_code=400, detail="audio_path is required when STT server mode is enabled")
    audio_path = Path(payload.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=400, detail=f"audio_path does not exist: {audio_path}")

    body, boundary = _multipart_body(
        file_field="file",
        file_path=audio_path,
        fields={
            "response-format": "json",
            "temperature": "0.0",
            "text_hint": payload.text_hint or "",
        },
    )
    request = UrlRequest(
        config.stt_server_url,
        data=body,
        headers=_server_headers(
            config.stt_server_auth_token,
            content_type=f"multipart/form-data; boundary={boundary}",
        ),
        method="POST",
    )
    try:
        with urlopen(request, timeout=120) as response:
            content_type, response_payload = _read_response_payload(response)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip() or exc.reason
        raise HTTPException(status_code=502, detail=f"STT server request failed: {detail}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"STT server is unavailable: {exc.reason}") from exc

    transcript = _extract_transcript(payload=response_payload, content_type=content_type)
    if not transcript:
        raise HTTPException(status_code=502, detail="STT server returned an empty transcript")
    return transcript


def _call_tts_server(config, payload: TtsRequest) -> tuple[str, str]:
    request = UrlRequest(
        config.tts_server_url,
        data=json.dumps(
            {
                "text": payload.text,
                "output_path": payload.output_path,
                "provider_hint": payload.provider_hint,
                "voice_name": payload.voice_name,
                "rate_wpm": payload.rate_wpm,
            }
        ).encode("utf-8"),
        headers=_server_headers(config.tts_server_auth_token, content_type="application/json"),
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            content_type, response_payload = _read_response_payload(response)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip() or exc.reason
        raise HTTPException(status_code=502, detail=f"TTS server request failed: {detail}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"TTS server is unavailable: {exc.reason}") from exc

    if "json" in content_type.lower() or response_payload.startswith("{"):
        parsed = json.loads(response_payload)
        if isinstance(parsed, dict):
            audio_path = str(parsed.get("audio_path") or payload.output_path or "").strip()
            detail = str(parsed.get("detail") or "Bridge rendered speech through the configured local TTS server.").strip()
            if audio_path:
                return audio_path, detail
    rendered_path = response_payload.strip() or (payload.output_path or "")
    if not rendered_path:
        raise HTTPException(status_code=502, detail="TTS server returned an empty audio path")
    return rendered_path, "Bridge rendered speech through the configured local TTS server."


def _provided_bridge_token(request: Request) -> str:
    authorization = request.headers.get("authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return request.headers.get("x-starlog-bridge-token", "").strip()


def _is_authenticated(request: Request, expected_token: str) -> bool:
    if not expected_token:
        return True
    return _provided_bridge_token(request) == expected_token


def _require_authenticated(request: Request, expected_token: str) -> None:
    if not _is_authenticated(request, expected_token):
        raise HTTPException(status_code=401, detail="Bridge authentication failed")


@app.get("/health", response_model=BridgeHealthResponse)
def health(request: Request) -> BridgeHealthResponse:
    config = load_bridge_config()
    return BridgeHealthResponse(
        status="ok",
        service="desktop_local_bridge",
        base_url=config.base_url,
        auth_required=bool(config.auth_token),
        authenticated=_is_authenticated(request, config.auth_token),
        capabilities=capability_summary(config),
    )


@app.post("/v1/stt/transcribe", response_model=SttResponse)
def transcribe(payload: SttRequest, request: Request) -> SttResponse:
    config = load_bridge_config()
    _require_authenticated(request, config.auth_token)

    if payload.debug_transcript and payload.debug_transcript.strip():
        transcript = payload.debug_transcript.strip()
        return SttResponse(
            status="ok",
            provider="debug",
            transcript=transcript,
            detail="Bridge returned the supplied debug transcript without running an external command.",
        )

    if config.stt_server_url:
        transcript = _call_stt_server(config, payload)
        return SttResponse(
            status="ok",
            provider="server",
            transcript=transcript,
            detail="Bridge transcribed audio through the configured local STT server.",
        )

    if not config.stt_command:
        raise HTTPException(status_code=503, detail="STT bridge command is not configured")
    if not payload.audio_path:
        raise HTTPException(status_code=400, detail="audio_path is required when debug_transcript is not supplied")

    transcript = _run_command(
        config.stt_command,
        {
            "audio_path": payload.audio_path,
            "provider_hint": payload.provider_hint or "",
            "text_hint": payload.text_hint or "",
        },
    ).strip()
    if not transcript:
        raise HTTPException(status_code=502, detail="STT bridge command returned an empty transcript")
    return SttResponse(
        status="ok",
        provider="command",
        transcript=transcript,
        detail="Bridge transcribed audio through the configured local STT command.",
    )


@app.post("/v1/tts/speak", response_model=TtsResponse)
def speak(payload: TtsRequest, request: Request) -> TtsResponse:
    config = load_bridge_config()
    _require_authenticated(request, config.auth_token)

    if payload.debug_audio_path and payload.debug_audio_path.strip():
        audio_path = payload.debug_audio_path.strip()
        return TtsResponse(
            status="ok",
            provider="debug",
            audio_path=audio_path,
            detail="Bridge returned the supplied debug audio path without running an external command.",
        )

    if config.tts_server_url:
        rendered_path, detail = _call_tts_server(config, payload)
        return TtsResponse(
            status="ok",
            provider="server",
            audio_path=rendered_path,
            detail=detail,
        )

    if not config.tts_command:
        raise HTTPException(status_code=503, detail="TTS bridge command is not configured")
    if not payload.output_path:
        raise HTTPException(status_code=400, detail="output_path is required when debug_audio_path is not supplied")

    rendered_path = _run_command(
        config.tts_command,
        {
            "text": payload.text,
            "provider_hint": payload.provider_hint or "",
            "output_path": payload.output_path,
            "voice": payload.voice_name or "",
            "rate": str(payload.rate_wpm or ""),
        },
    ).strip() or payload.output_path
    return TtsResponse(
        status="ok",
        provider="command",
        audio_path=rendered_path,
        detail="Bridge rendered speech through the configured local TTS command.",
    )


@app.get("/v1/context/active", response_model=ContextResponse)
def active_context(request: Request) -> ContextResponse:
    config = load_bridge_config()
    _require_authenticated(request, config.auth_token)
    static_context = parse_static_context(config)
    if static_context is not None:
        return ContextResponse(
            status="ok",
            provider="static_json",
            context=static_context,
            detail="Bridge returned static desktop context from STARLOG_BRIDGE_CONTEXT_JSON.",
        )

    if not config.context_command:
        return ContextResponse(
            status="unavailable",
            provider="none",
            context={},
            detail="No desktop context bridge is configured yet.",
        )

    raw = _run_command(config.context_command, {})
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"Context bridge did not return JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="Context bridge returned non-object JSON")
    return ContextResponse(
        status="ok",
        provider="command",
        context=parsed,
        detail="Bridge returned desktop context from the configured command.",
    )
