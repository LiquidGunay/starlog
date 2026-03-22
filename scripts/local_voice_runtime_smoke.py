#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = os.getenv("STARLOG_LOCAL_BRIDGE_AUTH_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _call_json(url: str, *, payload: dict | None = None) -> dict:
    request = Request(
        url,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers=_headers(),
        method="GET" if payload is None else "POST",
    )
    with urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    base_url = os.getenv("STARLOG_LOCAL_BRIDGE_BASE_URL", "http://127.0.0.1:8091").rstrip("/")
    health = _call_json(f"{base_url}/health")
    result: dict[str, object] = {"health": health}

    audio_path = os.getenv("STARLOG_LOCAL_VOICE_SMOKE_AUDIO_PATH", "").strip()
    if audio_path:
        result["stt"] = _call_json(
            f"{base_url}/v1/stt/transcribe",
            payload={"audio_path": audio_path, "text_hint": os.getenv("STARLOG_LOCAL_VOICE_SMOKE_TEXT_HINT", "")},
        )
    else:
        result["stt"] = {"status": "skipped", "detail": "Set STARLOG_LOCAL_VOICE_SMOKE_AUDIO_PATH to exercise STT."}

    with tempfile.TemporaryDirectory(prefix="starlog-local-voice-smoke-") as temp_dir:
        output_path = Path(temp_dir) / "tts-output.wav"
        result["tts"] = _call_json(
            f"{base_url}/v1/tts/speak",
            payload={
                "text": os.getenv("STARLOG_LOCAL_VOICE_SMOKE_TEXT", "Starlog local voice runtime smoke test."),
                "output_path": str(output_path),
                "voice_name": os.getenv("STARLOG_LOCAL_VOICE_SMOKE_VOICE", "") or None,
                "rate_wpm": int(os.getenv("STARLOG_LOCAL_VOICE_SMOKE_RATE_WPM", "0") or "0") or None,
            },
        )
        result["tts_output_exists"] = output_path.exists()

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (HTTPError, URLError) as exc:
        raise SystemExit(f"Local voice smoke failed: {exc}") from exc
