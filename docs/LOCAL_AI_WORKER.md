# Local AI Worker

Starlog can now keep AI compute on your laptop while the phone/PWA use either your local API or a hosted API.

The intended split is:

- Railway or local API: stores artifacts, jobs, metadata, and media.
- Laptop-local worker: runs `codex exec` for queued LLM jobs and assistant-command planning, `whisper.cpp` for queued voice-note / voice-command transcription, and optional local TTS for rendered briefing audio.
- Phone/PWA: records voice notes or voice commands, uploads them, and waits for the worker to process the queued jobs.

This keeps Railway costs low because Codex/Whisper execution stays off Railway.

## What the worker processes

- `provider_hint=codex_local` (and `desktop_bridge_codex` / `mobile_bridge_codex`)
  - `llm_summary`
  - `llm_cards`
  - `llm_tasks`
  - `llm_agent_plan`
- `provider_hint=whisper_local` (and `desktop_bridge_stt` / `mobile_bridge_stt`)
  - `stt`
- `provider_hint=piper_local` (and bridge hint `desktop_bridge_tts` / `mobile_bridge_tts` when Piper is configured)
  - `tts`
- `provider_hint=say_local` (and bridge hint `desktop_bridge_tts` / `mobile_bridge_tts` when macOS `say` is selected)
  - `tts`
- `provider_hint=espeak_local` (and bridge hint `desktop_bridge_tts` / `mobile_bridge_tts` when selected)
  - `tts`
- `provider_hint=espeak_ng_local` (and bridge hint `desktop_bridge_tts` / `mobile_bridge_tts` when selected)
  - `tts`

For `stt` jobs with `action=assistant_command`, the transcript is fed back into Starlog's command planner automatically after Whisper finishes.
For `llm_agent_plan` jobs with `action=assistant_command_ai`, Codex returns tool calls that Starlog validates and executes against the same tool layer used by deterministic commands.
For `tts` jobs with `action=briefing_audio`, the worker uploads rendered audio back to Starlog and the briefing package stores that media reference for offline playback.
Queued AI jobs can now also be cancelled or retried from `/ai-jobs` or through the `/v1/ai/jobs/{job_id}/cancel` and `/v1/ai/jobs/{job_id}/retry` APIs.

## Provider normalization + runtime probing

The worker now normalizes bridge-scoped provider hints into concrete local runtimes:

- LLM bridge hints -> `codex_local`
- STT bridge hints -> `whisper_local`
- TTS bridge hints -> one of `piper_local` / `say_local` / `espeak_ng_local` / `espeak_local`

TTS bridge runtime selection order:

1. `--tts-command` or `STARLOG_TTS_COMMAND` configured -> `piper_local`
2. macOS `say` available -> `say_local`
3. `espeak-ng` available -> `espeak_ng_local`
4. `espeak` available -> `espeak_local`

If no compatible local TTS runtime exists, the job fails with a non-retryable classified error so the operator can fix local setup.

## Timeout + retry behavior

The worker classifies failures and retries only retryable categories (for example transient timeout/network/upstream-5xx errors).
Default retry budget is `2` attempts per claimed job.

Useful flags:

- `--retryable-attempts`
- `--codex-timeout-seconds`
- `--whisper-timeout-seconds`
- `--tts-timeout-seconds`
- `--ffmpeg-timeout-seconds`

## Requirements on your laptop

- Codex CLI installed and logged in
- `ffmpeg` installed if uploaded audio is not already WAV
- `whisper.cpp` built locally if you want voice-note transcription

## Resident local voice servers

Starlog now supports a resident local server path through the desktop bridge:

- STT server: `scripts/run_whisper_cpp_server.sh`
- TTS server: `scripts/local_tts_server.py`
- bridge smoke: `scripts/local_voice_runtime_smoke.py`

Recommended bridge env:

```bash
export STARLOG_BRIDGE_STT_SERVER_URL='http://127.0.0.1:8171/inference'
export STARLOG_BRIDGE_TTS_SERVER_URL='http://127.0.0.1:8093/v1/tts/speak'
```

### Whisper server

The preferred STT server path is the official `whisper.cpp` server. A typical launch flow is:

```bash
export STARLOG_LOCAL_WHISPER_MODEL='/ABS/PATH/ggml-base.en.bin'
export STARLOG_LOCAL_WHISPER_GPU_LAYERS=999
bash scripts/run_whisper_cpp_server.sh
```

If your local build uses different flags, override `STARLOG_LOCAL_WHISPER_SERVER_EXTRA_ARGS`.

### TTS server

Starlog ships a small local TTS server wrapper:

```bash
export STARLOG_LOCAL_TTS_PROVIDER_NAME='vibevoice_community_fallback'
export STARLOG_LOCAL_TTS_GPU_MODE='gpu'
export STARLOG_LOCAL_TTS_COMMAND='piper --model /ABS/PATH/en_US-lessac-medium.onnx --output_file {output_path}'

PYTHONPATH=services/ai-runtime uv run --project services/ai-runtime \
  python scripts/local_tts_server.py
```

The official Microsoft `VibeVoice` repo is back online, but the TTS code was removed after September 2025. If you have a working community or internal VibeVoice command path, point `STARLOG_LOCAL_TTS_COMMAND` at it and set `STARLOG_LOCAL_TTS_PROVIDER_NAME` accordingly. Otherwise, use Piper or another local TTS command as the closest viable fallback while keeping the bridge on the same server abstraction.

## Run against a local API

```bash
export STARLOG_TOKEN=YOUR_BEARER_TOKEN
export STARLOG_WHISPER_COMMAND='whisper-cli -m /ABS/PATH/ggml-base.en.bin -f {input_path} -otxt -of {output_base}'
export STARLOG_TTS_COMMAND='piper --model /ABS/PATH/en_US-lessac-medium.onnx --output_file {output_path}'

PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN"
```

If you only want Codex jobs:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/codex_queue_runner.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN"
```

## Run against Railway

Point the worker at your public Railway API URL instead:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base https://YOUR-STARLOG-API.up.railway.app \
  --token "$STARLOG_TOKEN"
```

This is the low-cost hosted mode:

- phone/PWA can hit Railway all day
- laptop worker only needs to run when you want queued AI jobs processed

## Whisper command contract

The worker expects a command template that can interpolate:

- `{input_path}` - prepared local audio file path
- `{output_base}` - output prefix without extension
- `{output_path}` - expected `.txt` transcript path

Recommended `whisper.cpp` pattern:

```bash
export STARLOG_WHISPER_COMMAND='whisper-cli -m /ABS/PATH/ggml-base.en.bin -f {input_path} -otxt -of {output_base}'
```

If the uploaded audio is not WAV, the worker first converts it with:

```bash
ffmpeg -y -i INPUT -ar 16000 -ac 1 -c:a pcm_s16le OUTPUT.wav
```

## TTS command contract

The worker expects a TTS command template that can interpolate:

- `{output_path}` - expected audio output file path
- `{output_base}` - output prefix without extension

The command receives the briefing text on stdin. A typical `piper` example is:

```bash
export STARLOG_TTS_COMMAND='piper --model /ABS/PATH/en_US-lessac-medium.onnx --output_file {output_path}'
```

After synthesis, the worker uploads the audio file to `/v1/media/upload` and completes the queued `tts` job with the resulting `media://...` blob ref.

The default worker provider hints now include bridge + local hints:

```text
desktop_bridge_codex,mobile_bridge_codex,desktop_bridge_stt,mobile_bridge_stt,desktop_bridge_tts,mobile_bridge_tts,codex_local,whisper_local,piper_local,say_local,espeak_local,espeak_ng_local
```

Built-in local TTS wrappers:

- `piper_local`
  - uses `--tts-command` or `STARLOG_TTS_COMMAND`
  - exposes `{output_path}`, `{output_base}`, `{voice}`, `{rate}`, and `{text}` placeholders to the command template
- `say_local`
  - uses the native macOS `say` command directly
  - supports optional `voice` / `voice_name` and `rate_wpm` payload fields
  - uploads AIFF output directly, or WAV if `ffmpeg` is available for conversion
- `espeak_local`
  - uses `espeak -w ...`
  - supports optional `voice` / `voice_name` and `rate_wpm`
- `espeak_ng_local`
  - uses `espeak-ng -w ...`
  - supports optional `voice` / `voice_name` and `rate_wpm`

Example one-shot worker focused on macOS `say` jobs:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN" \
  --provider-hints say_local \
  --once
```

## One-shot batch run

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN" \
  --once
```

Use this if you want manual batch processing instead of a continuously running worker.

## Env-gated bridge smoke

Once the bridge and local voice servers are up, run:

```bash
PYTHONPATH=services/ai-runtime uv run --project services/ai-runtime \
  python scripts/local_voice_runtime_smoke.py
```

Set `STARLOG_LOCAL_VOICE_SMOKE_AUDIO_PATH` if you want the smoke to exercise STT in addition to TTS.
