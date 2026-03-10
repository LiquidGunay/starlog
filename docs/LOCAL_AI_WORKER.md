# Local AI Worker

Starlog can now keep AI compute on your laptop while the phone/PWA use either your local API or a hosted API.

The intended split is:

- Railway or local API: stores artifacts, jobs, metadata, and media.
- Laptop-local worker: runs `codex exec` for queued LLM jobs and assistant-command planning, `whisper.cpp` for queued voice-note / voice-command transcription, and optional local TTS for rendered briefing audio.
- Phone/PWA: records voice notes or voice commands, uploads them, and waits for the worker to process the queued jobs.

This keeps Railway costs low because Codex/Whisper execution stays off Railway.

## What the worker processes

- `provider_hint=codex_local`
  - `llm_summary`
  - `llm_cards`
  - `llm_tasks`
  - `llm_agent_plan`
- `provider_hint=whisper_local`
  - `stt`
- `provider_hint=piper_local`
  - `tts`
- `provider_hint=say_local`
  - `tts`
- `provider_hint=espeak_local`
  - `tts`
- `provider_hint=espeak_ng_local`
  - `tts`

For `stt` jobs with `action=assistant_command`, the transcript is fed back into Starlog's command planner automatically after Whisper finishes.
For `llm_agent_plan` jobs with `action=assistant_command_ai`, Codex returns tool calls that Starlog validates and executes against the same tool layer used by deterministic commands.
For `tts` jobs with `action=briefing_audio`, the worker uploads rendered audio back to Starlog and the briefing package stores that media reference for offline playback.
Queued AI jobs can now also be cancelled or retried from `/ai-jobs` or through the `/v1/ai/jobs/{job_id}/cancel` and `/v1/ai/jobs/{job_id}/retry` APIs.

## Requirements on your laptop

- Codex CLI installed and logged in
- `ffmpeg` installed if uploaded audio is not already WAV
- `whisper.cpp` built locally if you want voice-note transcription

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

The default worker provider hints now include TTS providers as well:

```text
codex_local,whisper_local,piper_local,say_local,espeak_local,espeak_ng_local
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
