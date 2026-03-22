from __future__ import annotations

import json
import subprocess

from fastapi import FastAPI, HTTPException
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


@app.get("/health", response_model=BridgeHealthResponse)
def health() -> BridgeHealthResponse:
    config = load_bridge_config()
    return BridgeHealthResponse(
        status="ok",
        service="desktop_local_bridge",
        base_url=config.base_url,
        capabilities=capability_summary(config),
    )


@app.post("/v1/stt/transcribe", response_model=SttResponse)
def transcribe(payload: SttRequest) -> SttResponse:
    if payload.debug_transcript and payload.debug_transcript.strip():
        transcript = payload.debug_transcript.strip()
        return SttResponse(
            status="ok",
            provider="debug",
            transcript=transcript,
            detail="Bridge returned the supplied debug transcript without running an external command.",
        )

    config = load_bridge_config()
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
def speak(payload: TtsRequest) -> TtsResponse:
    if payload.debug_audio_path and payload.debug_audio_path.strip():
        audio_path = payload.debug_audio_path.strip()
        return TtsResponse(
            status="ok",
            provider="debug",
            audio_path=audio_path,
            detail="Bridge returned the supplied debug audio path without running an external command.",
        )

    config = load_bridge_config()
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
        },
    ).strip() or payload.output_path
    return TtsResponse(
        status="ok",
        provider="command",
        audio_path=rendered_path,
        detail="Bridge rendered speech through the configured local TTS command.",
    )


@app.get("/v1/context/active", response_model=ContextResponse)
def active_context() -> ContextResponse:
    config = load_bridge_config()
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
