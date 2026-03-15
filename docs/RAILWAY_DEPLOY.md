# Railway Deploy

Recommended Starlog hosting split:

- Railway API service for metadata, sync, artifacts, jobs, and media files
- Railway web service for the PWA
- laptop-local AI worker for Codex and Whisper

This keeps the hosted footprint small and avoids paying Railway CPU time for long AI jobs.

## Pre-deploy gates

Run these before Railway deploy:

1. `./scripts/pwa_release_gate.sh`
2. `./scripts/pwa_hosted_smoke.sh`
3. `./scripts/pwa_portability_drill.sh`

Supporting runbooks:

- `docs/PWA_RAILWAY_PROD_CONFIG_CHECKLIST.md`
- `docs/PWA_HOSTED_SMOKE_CHECKLIST.md`
- `docs/PWA_PORTABILITY_DRILL.md`
- `docs/PWA_GO_LIVE_RUNBOOK.md`

## Service layout

Create two Railway services from this repo:

1. `starlog-api`
   - root directory: `services/api`
   - deploy from `services/api/Dockerfile`
   - attach a persistent volume mounted at `/app/.localdata`
2. `starlog-web`
   - root directory: repo root
   - build command: `pnpm --filter web build`
   - start command: `pnpm --filter web start -- --hostname 0.0.0.0 --port $PORT`

The API Dockerfile now respects Railway's `PORT`.

## API environment

Set these on Railway for the API service:

```text
STARLOG_ENV=prod
STARLOG_DB_PATH=/app/.localdata/starlog.db
STARLOG_MEDIA_DIR=/app/.localdata/media
STARLOG_SECRETS_MASTER_KEY=<long-random-secret>
STARLOG_CORS_ALLOW_ORIGINS=https://YOUR-WEB-DOMAIN.up.railway.app
```

Optional Google Calendar sync:

```text
STARLOG_GOOGLE_CLIENT_ID=...
STARLOG_GOOGLE_CLIENT_SECRET=...
STARLOG_GOOGLE_REDIRECT_URI=https://YOUR-API-DOMAIN.up.railway.app/v1/calendar/sync/google/oauth/callback
```

## Web environment

Starlog's web app currently stores the API base in the session UI, so you do not need a hardcoded API URL to deploy the PWA.

After deployment:

- open the Railway web URL
- set API base to the Railway API URL in session controls

## Media and voice notes

Voice-note uploads are stored under `STARLOG_MEDIA_DIR`.

Because voice notes now use queued Whisper jobs:

- the phone uploads audio to Railway
- Railway stores the media and queued job
- your laptop worker downloads the audio later and transcribes it locally

## Laptop-local AI worker against Railway

```bash
export STARLOG_TOKEN=YOUR_BEARER_TOKEN
export STARLOG_WHISPER_COMMAND='whisper-cli -m /ABS/PATH/ggml-base.en.bin -f {input_path} -otxt -of {output_base}'

PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base https://YOUR-API-DOMAIN.up.railway.app \
  --token "$STARLOG_TOKEN"
```

You can also run it manually in batches:

```bash
PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base https://YOUR-API-DOMAIN.up.railway.app \
  --token "$STARLOG_TOKEN" \
  --once
```

## What still stays local on phone

- quick capture drafting
- SQLite-backed local mobile state
- queued retry state
- alarm scheduling
- spoken briefing playback via on-device TTS

## First hosted test

1. Deploy API and web.
2. Bootstrap/login on the Railway web app.
3. Install the Android dev build locally.
4. Point the mobile app at the Railway API URL.
5. Record a voice note on phone.
6. Start the laptop AI worker.
7. Confirm the transcript lands back in the artifact detail view.
