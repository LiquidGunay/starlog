from __future__ import annotations

from dataclasses import dataclass, replace
import os
from pathlib import Path
import tempfile
from threading import Lock

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel


DEFAULT_LOCAL_STT_HOST = "127.0.0.1"
DEFAULT_LOCAL_STT_PORT = 8171


@dataclass(frozen=True)
class LocalSttConfig:
    host: str
    port: int
    auth_token: str
    provider_name: str
    model_name: str
    language: str
    beam_size: int
    device: str
    compute_type: str


class LocalSttHealthResponse(BaseModel):
    status: str
    service: str
    provider: str
    auth_required: bool
    authenticated: bool
    model_name: str
    language: str
    device: str
    compute_type: str
    detail: str


class LocalSttInferenceResponse(BaseModel):
    status: str
    provider: str
    transcript: str
    text: str
    model_name: str
    device: str
    compute_type: str
    detail: str


def _read_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def load_local_stt_config() -> LocalSttConfig:
    return LocalSttConfig(
        host=os.getenv("STARLOG_LOCAL_STT_HOST", DEFAULT_LOCAL_STT_HOST).strip() or DEFAULT_LOCAL_STT_HOST,
        port=_read_int("STARLOG_LOCAL_STT_PORT", DEFAULT_LOCAL_STT_PORT),
        auth_token=os.getenv("STARLOG_LOCAL_STT_AUTH_TOKEN", "").strip(),
        provider_name=os.getenv("STARLOG_LOCAL_STT_PROVIDER_NAME", "faster_whisper_local").strip()
        or "faster_whisper_local",
        model_name=os.getenv("STARLOG_LOCAL_STT_MODEL", "tiny.en").strip() or "tiny.en",
        language=os.getenv("STARLOG_LOCAL_STT_LANGUAGE", "en").strip() or "en",
        beam_size=_read_int("STARLOG_LOCAL_STT_BEAM_SIZE", 1),
        device=os.getenv("STARLOG_LOCAL_STT_DEVICE", "auto").strip() or "auto",
        compute_type=os.getenv("STARLOG_LOCAL_STT_COMPUTE_TYPE", "auto").strip() or "auto",
    )


def _provided_token(request: Request) -> str:
    authorization = request.headers.get("authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return request.headers.get("x-starlog-local-stt-token", "").strip()


def _is_authenticated(request: Request, expected_token: str) -> bool:
    if not expected_token:
        return True
    return _provided_token(request) == expected_token


def _require_authenticated(request: Request, expected_token: str) -> None:
    if not _is_authenticated(request, expected_token):
        raise HTTPException(status_code=401, detail="Local STT server authentication failed")


class _ModelRuntime:
    def __init__(self) -> None:
        self._lock = Lock()
        self._cached_signature: tuple[str, str, str] | None = None
        self._cached_model = None
        self._cached_device = ""
        self._cached_compute_type = ""

    def get(self, config: LocalSttConfig):
        signature = (config.model_name, config.device, config.compute_type)
        with self._lock:
            if self._cached_signature == signature and self._cached_model is not None:
                return self._cached_model, self._cached_device, self._cached_compute_type
            model, device, compute_type = _load_whisper_model(config)
            self._cached_signature = signature
            self._cached_model = model
            self._cached_device = device
            self._cached_compute_type = compute_type
            return model, device, compute_type

    def reset(self) -> None:
        with self._lock:
            self._cached_signature = None
            self._cached_model = None
            self._cached_device = ""
            self._cached_compute_type = ""


def _load_whisper_model(config: LocalSttConfig):
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - guarded by docs/tests
        raise HTTPException(
            status_code=503,
            detail=(
                "Install the local-voice extra before starting the STT server: "
                "uv run --project services/ai-runtime --extra local-voice ..."
            ),
        ) from exc

    requested_device = config.device
    requested_compute = config.compute_type
    attempts: list[tuple[str, str]] = []
    if requested_device == "auto":
        attempts.extend(
            [
                ("cuda", "float16" if requested_compute == "auto" else requested_compute),
                ("cpu", "int8" if requested_compute == "auto" else requested_compute),
            ]
        )
    else:
        attempts.append((requested_device, "float16" if requested_compute == "auto" and requested_device == "cuda" else requested_compute))
        if requested_device != "cpu":
            attempts.append(("cpu", "int8" if requested_compute == "auto" else requested_compute))

    last_error: Exception | None = None
    for device, compute_type in attempts:
        try:
            model = WhisperModel(config.model_name, device=device, compute_type=compute_type)
            return model, device, compute_type
        except Exception as exc:  # pragma: no cover - exercised in live smoke
            last_error = exc
    raise HTTPException(status_code=503, detail=f"Unable to load local STT model: {last_error}") from last_error


MODEL_RUNTIME = _ModelRuntime()
app = FastAPI(title="Starlog Local STT Server", version="0.1.0")


@app.get("/health", response_model=LocalSttHealthResponse)
def health(request: Request) -> LocalSttHealthResponse:
    config = load_local_stt_config()
    return LocalSttHealthResponse(
        status="ok",
        service="starlog_local_stt_server",
        provider=config.provider_name,
        auth_required=bool(config.auth_token),
        authenticated=_is_authenticated(request, config.auth_token),
        model_name=config.model_name,
        language=config.language,
        device=config.device,
        compute_type=config.compute_type,
        detail=(
            "Local STT server is configured. The model will be loaded on first inference request."
            if config.model_name
            else "Set STARLOG_LOCAL_STT_MODEL before running inference."
        ),
    )


@app.post("/inference", response_model=LocalSttInferenceResponse)
async def inference(
    request: Request,
    file: UploadFile = File(...),
    response_format: str = Form("json", alias="response-format"),
    text_hint: str = Form(""),
    temperature: str = Form("0.0"),
) -> LocalSttInferenceResponse:
    del temperature
    config = load_local_stt_config()
    _require_authenticated(request, config.auth_token)

    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(prefix="starlog-local-stt-", suffix=suffix, delete=False) as handle:
        audio_path = Path(handle.name)
        handle.write(await file.read())

    try:
        model, actual_device, actual_compute_type = MODEL_RUNTIME.get(config)
        try:
            segments, _info = model.transcribe(
                str(audio_path),
                language=config.language or None,
                beam_size=max(1, config.beam_size),
                initial_prompt=text_hint or None,
            )
            transcript = " ".join(segment.text.strip() for segment in segments).strip()
        except RuntimeError as exc:
            if actual_device != "cuda":
                raise
            if "libcublas" not in str(exc).lower() and "cuda" not in str(exc).lower():
                raise
            fallback_config = replace(config, device="cpu", compute_type="int8")
            MODEL_RUNTIME.reset()
            model, actual_device, actual_compute_type = MODEL_RUNTIME.get(fallback_config)
            segments, _info = model.transcribe(
                str(audio_path),
                language=fallback_config.language or None,
                beam_size=max(1, fallback_config.beam_size),
                initial_prompt=text_hint or None,
            )
            transcript = " ".join(segment.text.strip() for segment in segments).strip()
        if not transcript:
            raise HTTPException(status_code=502, detail="Local STT server returned an empty transcript")
        payload = LocalSttInferenceResponse(
            status="ok",
            provider=config.provider_name,
            transcript=transcript,
            text=transcript,
            model_name=config.model_name,
            device=actual_device,
            compute_type=actual_compute_type,
            detail=f"Local STT server transcribed audio with model {config.model_name}.",
        )
        if response_format.lower() == "json":
            return payload
        return payload
    finally:
        try:
            audio_path.unlink()
        except FileNotFoundError:
            pass
