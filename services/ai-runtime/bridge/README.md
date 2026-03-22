# Starlog Desktop Local Bridge

This package is the localhost-facing Python bridge for desktop-local voice and context flows.

## Intended role

- expose a small local HTTP surface for desktop helper and future PWA bridge discovery
- report bridge capability health
- run env-configured local commands for STT, TTS, and desktop-context lookup
- keep the bridge reviewable and separate from the main CRUD API

## Endpoints

- `GET /health`
- `POST /v1/stt/transcribe`
- `POST /v1/tts/speak`
- `GET /v1/context/active`

## Environment

- `STARLOG_BRIDGE_HOST`
- `STARLOG_BRIDGE_PORT`
- `STARLOG_BRIDGE_BASE_URL`
- `STARLOG_BRIDGE_AUTH_TOKEN`
- `STARLOG_BRIDGE_STT_CMD`
- `STARLOG_BRIDGE_TTS_CMD`
- `STARLOG_BRIDGE_CONTEXT_CMD`
- `STARLOG_BRIDGE_CLIP_CMD`
- `STARLOG_BRIDGE_CONTEXT_JSON`

Command templates use Python `str.format(...)` variables:

- STT: `{audio_path}`, `{provider_hint}`, `{text_hint}`
- TTS: `{text}`, `{provider_hint}`, `{output_path}`

If `STARLOG_BRIDGE_AUTH_TOKEN` is set, the bridge expects either:

- `Authorization: Bearer <token>`
- `X-Starlog-Bridge-Token: <token>`

The `/health` endpoint stays discoverable and reports whether auth is required plus whether the
current request was authenticated.

## Example run

```bash
cd /home/ubuntu/starlog/services/ai-runtime
uv run --project . uvicorn bridge.server:app --host 127.0.0.1 --port 8091
```
