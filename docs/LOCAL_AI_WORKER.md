# Local AI Worker

Starlog can now keep AI compute on your laptop while the phone/PWA use either your local API or a hosted API.

The intended split is:

- Railway or local API: stores artifacts, jobs, metadata, and media.
- Laptop-local worker: runs `codex exec` for queued LLM jobs and `whisper.cpp` for queued voice-note transcription.
- Phone: records voice notes, uploads them, and waits for the worker to process the queued jobs.

This keeps Railway costs low because Codex/Whisper execution stays off Railway.

## What the worker processes

- `provider_hint=codex_local`
  - `llm_summary`
  - `llm_cards`
  - `llm_tasks`
- `provider_hint=whisper_local`
  - `stt`

## Requirements on your laptop

- Codex CLI installed and logged in
- `ffmpeg` installed if uploaded audio is not already WAV
- `whisper.cpp` built locally if you want voice-note transcription

## Run against a local API

```bash
export STARLOG_TOKEN=YOUR_BEARER_TOKEN
export STARLOG_WHISPER_COMMAND='whisper-cli -m /ABS/PATH/ggml-base.en.bin -f {input_path} -otxt -of {output_base}'

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

## One-shot batch run

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN" \
  --once
```

Use this if you want manual batch processing instead of a continuously running worker.
