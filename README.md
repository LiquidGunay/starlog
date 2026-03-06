# Starlog

Starlog is a single-user, clip-first personal system for knowledge, scheduling, and learning loops.

This repository now includes working backend, web/PWA, mobile companion, and clipping surfaces
(browser extension + desktop helper) for the approved v1 plan.

## Repository layout

- `apps/web` - modern "spacy" PWA workspace shell with light/dark theme.
- `apps/mobile` - companion app shell for capture, alarms, and quick review.
- `services/api` - FastAPI backend with SQLite storage, auth, sync, artifacts, SRS, tasks, calendar, planning, briefings, events, provider integration config, and export.
- `packages/contracts` - shared TypeScript contract package.
- `tools/browser-extension` - MV3 clipper scaffold for browser capture.
- `tools/desktop-helper` - Tauri helper scaffold for non-browser clipping.
- `docs` - plan and product docs.

## Quick start

### Backend

```bash
make bootstrap-api
make dev-api
```

`make bootstrap-api` now uses `uv sync --project services/api --extra dev`.

### Web app

```bash
make bootstrap-web
make dev-web-lan
```

### Mobile app

```bash
pnpm --filter mobile start
```

### Android dev build

The Android native build path is now configured in `apps/mobile` and the local build path is the primary one.

- guide: `docs/ANDROID_DEV_BUILD.md`
- local Android install: `pnpm --filter mobile android:local`
- dev client bundle: `pnpm --filter mobile start:dev-client`
- optional hosted build: `cd apps/mobile && npx eas-cli build --platform android --profile development`

### Local AI worker

Run Codex and Whisper locally on your laptop while Starlog queues jobs through the API:

```bash
export STARLOG_TOKEN=YOUR_BEARER_TOKEN
export STARLOG_WHISPER_COMMAND='whisper-cli -m /ABS/PATH/ggml-base.en.bin -f {input_path} -otxt -of {output_base}'

PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN"
```

Guide: `docs/LOCAL_AI_WORKER.md`

Shortcut target:

```bash
STARLOG_TOKEN=YOUR_BEARER_TOKEN make dev-local-ai
```

### Railway deploy

Guide: `docs/RAILWAY_DEPLOY.md`

## View progress on phone

Use the phone setup guide for both PWA and Expo companion flows:

- `docs/PHONE_SETUP.md`

Mobile companion currently supports SQLite-backed local state, queued text/voice capture retries,
artifact inbox triage, quick SRS review sessions, daily alarm scheduling, local spoken playback, and
deep-link capture prefill via `starlog://capture?...`.

PWA mutations now use a local browser outbox with replay on reconnect, plus a dedicated sync workspace
at `/sync-center` that also surfaces recent server-recorded mutation activity and pull-by-cursor deltas.

The PWA now also exposes an installable manifest/share-target flow so Android/browser shares can land
in `/share-target`, plus a portability workspace for export/restore drills. Voice-note uploads now flow
through `/v1/capture/voice` and queue `whisper_local` STT jobs for the local AI worker.

### Tests

```bash
make test-api
```

### Seed demo data

```bash
make seed-api
```

### Browser extension

Load `tools/browser-extension` as unpacked extension in Chromium.

## API bootstrap flow

1. Create the single user:

```bash
curl -X POST http://localhost:8000/v1/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"passphrase":"correct horse battery staple"}'
```

2. Login and get bearer token:

```bash
curl -X POST http://localhost:8000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"passphrase":"correct horse battery staple"}'
```

3. Use token for protected endpoints.

## Workspace pages

- `/` - launch dashboard + API console
- `/artifacts` - clip inbox viewer + artifact graph/version history
- `/agent-tools` - tool catalog + executor surface for future voice/chat interfaces
- `/notes` - primary note editor with optimistic queued updates
- `/tasks` - task execution workspace with optimistic status/edit flows
- `/calendar` - weekly board with create/update/delete event lifecycle controls
- `/integrations` - provider config, runtime probes, and auth-probe diagnostics workspace
- `/ai-jobs` - queued local AI work (Codex + Whisper) visibility
- `/planner` - time-block generation workspace
- `/portability` - export/download/restore workspace for portability drills
- `/review` - due card review queue
- `/search` - cross-workspace retrieval across artifacts, notes, tasks, and calendar events
- `/share-target` - installable PWA share ingress for browser/system share payloads
- `/sync-center` - queued mutation replay, local replay log, and server sync history
- `/mobile-share` - deep-link generator for mobile capture handoff

## Clip-first API additions

- Ingest capture with raw/normalized/extracted layers: `POST /v1/capture`
- Ingest voice note + queue Whisper transcription: `POST /v1/capture/voice`
- Upload/download protected media assets: `POST /v1/media/upload`, `GET /v1/media/{media_id}/content`
- Discover/execute agent tool contracts: `GET /v1/agent/tools`, `POST /v1/agent/execute`
- Inspect artifact graph links: `GET /v1/artifacts/{artifact_id}/graph`
- Inspect summary/card/action version history: `GET /v1/artifacts/{artifact_id}/versions`
- Edit/fetch notes: `GET /v1/notes/{note_id}`, `PATCH /v1/notes/{note_id}`
- Search across workspaces: `GET /v1/search?q=...`
- Pull/upload sync state: `GET /v1/sync/pull`, `POST /v1/sync/push`
- Inspect/upload sync activity history: `GET /v1/sync/activity`, `POST /v1/sync/activity`

## Google calendar sync scaffold

- Start OAuth intent: `POST /v1/calendar/sync/google/oauth/start`
- Complete OAuth callback: `POST /v1/calendar/sync/google/oauth/callback`
- Inspect OAuth connection mode/token state: `GET /v1/calendar/sync/google/oauth/status`
- Run two-way delta sync: `POST /v1/calendar/sync/google/run`
- Inspect remote mirror + conflicts:
  - `GET /v1/calendar/sync/google/remote/events`
  - `GET /v1/calendar/sync/google/conflicts`
  - `POST /v1/calendar/sync/google/conflicts/{conflict_id}/resolve`
  - `POST /v1/calendar/sync/google/conflicts/{conflict_id}/replay`

Sync responses now include a `run_id` for conflict diagnostics correlation.

When `STARLOG_GOOGLE_CLIENT_ID` and `STARLOG_GOOGLE_CLIENT_SECRET` are configured, callback performs a real Google token exchange and sync can pull/push/update/delete events against Google Calendar.

## Calendar event lifecycle

- Create event: `POST /v1/calendar/events`
- Update event: `PATCH /v1/calendar/events/{event_id}`
- Soft-delete event (sync-aware): `DELETE /v1/calendar/events/{event_id}`
- List active events: `GET /v1/calendar/events`

## Extensibility + import

- Register/list plugins: `POST /v1/plugins`, `GET /v1/plugins`
- Import markdown notes: `POST /v1/import/markdown`
- Restore exported snapshot: `POST /v1/import/export`
- Verify roundtrip portability locally: `make verify-export`

## Provider config security

- Sensitive provider fields (`api_key`, `token`, `secret`, etc.) are encrypted at rest.
- API responses redact sensitive values as `__redacted__`.
- Local-mode providers with `endpoint`/`base_url` now run localhost runtime probes.
- Remote/API providers can opt into auth probes with `auth_probe_url`, Google OAuth health now performs a real Calendar API auth probe, and Codex bridge health derives `/v1/models` probes from configured bridge URLs.
- Artifact summarize/cards/tasks actions now use the provider chain (`local_llm` -> `codex_bridge` -> `api_llm`) when those providers are configured.
- Queued local AI work now supports laptop-local `codex exec` and `whisper.cpp` processing through `scripts/local_ai_worker.py`.
- Set `STARLOG_SECRETS_MASTER_KEY` in production to avoid fallback insecure key mode.

## Ops endpoints

- Runtime metrics snapshot: `GET /v1/ops/metrics`
- Local backup snapshot export: `POST /v1/ops/backup`

## Current status

This is an active implementation pass toward the approved v1 plan in `docs/STARLOG_V1_PLAN.md`.
