# Starlog

Starlog is a single-user, voice-native personal system for capture, knowledge management, scheduling,
and learning workflows.

The product is built around one persistent chat thread, with the PWA as the canonical synced workspace,
the phone as the companion for capture and alarms, and the desktop helper as the fast path for clips and
screen context.

This README is product-first: what Starlog does, how the repo is organized, and how to run the main
surfaces locally. For a developer-facing code map, use `docs/CODEBASE_ORGANIZATION.md`.

## What Starlog can do today

- capture text, URLs, files, voice notes, screenshots, and browser clips into artifacts
- preserve artifact provenance across raw, normalized, and extracted content
- generate summaries, cards, and follow-up actions from artifact content
- keep notes, tasks, calendar events, review cards, and briefings in one system
- run a synced web workspace, a native mobile companion, and a desktop helper
- queue local AI jobs for voice transcription, assistant planning, and optional local speech output
- support offline-friendly mobile/PWA flows with cached state and replay

## Product surfaces

### PWA

Primary synced workspace.

- assistant/chat surface
- artifacts and related summaries/cards/history
- notes, tasks, calendar, review, search, sync, and portability

Run it with:

```bash
make bootstrap-web
make dev-web-lan
```

### Mobile companion

Android-first native companion for quick capture, alarms, offline briefing playback, and review.

- quick capture and share intake
- voice note recording and deferred processing
- alarm scheduling and cached briefing playback
- artifact triage and phone-first review actions

Run it with:

```bash
pnpm --filter mobile start
```

Android dev-build docs:

- `docs/ANDROID_DEV_BUILD.md`
- `docs/PHONE_SETUP.md`

### Desktop helper

Cross-platform helper for fast desktop capture and local bridge-assisted workflows.

- clipboard and screenshot capture
- recent capture history and diagnostics
- host-local bridge discovery and helper config

Setup docs:

- `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md`
- `docs/DESKTOP_HELPER_V1_RELEASE.md`

### Browser extension

Chromium MV3 clipper for browser-first capture.

- captures current selection and page metadata
- preserves raw, normalized, and extracted capture layers
- sends captures into the same artifact pipeline as the other surfaces

Local setup:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load the unpacked extension from `tools/browser-extension`.

Reference: `tools/browser-extension/README.md`

## Architecture at a glance

- `apps/web` — installable PWA and current primary workspace
- `apps/mobile` — native mobile companion
- `services/api` — FastAPI system of record for auth, sync, artifacts, notes, tasks, calendar, briefings, review, and tool execution
- `services/ai-runtime` — Python AI runtime for prompts, orchestration, provider adapters, and evaluation-oriented workflows
- `tools/browser-extension` — browser clipping surface
- `tools/desktop-helper` — Tauri-based desktop helper
- `packages/contracts` — shared TypeScript contracts

More detail: `docs/CODEBASE_ORGANIZATION.md`

## Local setup

### API

```bash
make bootstrap-api
make dev-api
```

`make bootstrap-api` uses `uv sync --project services/api --extra dev`.

### AI runtime

```bash
cd services/ai-runtime
uv sync --extra dev
uv run uvicorn runtime_app.main:app --reload --port 8100
```

### Local AI worker

Run local voice/assistant jobs against your API:

```bash
export STARLOG_TOKEN=YOUR_BEARER_TOKEN
export STARLOG_WHISPER_COMMAND='whisper-cli -m /ABS/PATH/ggml-base.en.bin -f {input_path} -otxt -of {output_base}'
export STARLOG_TTS_COMMAND='piper --model /ABS/PATH/en_US-lessac-medium.onnx --output_file {output_path}'

PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://localhost:8000 \
  --token "$STARLOG_TOKEN"
```

Shortcut:

```bash
STARLOG_TOKEN=YOUR_BEARER_TOKEN make dev-local-ai
```

Guide: `docs/LOCAL_AI_WORKER.md`

## Bootstrap the app

1. Create the single user:

```bash
curl -X POST http://localhost:8000/v1/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"passphrase":"correct horse battery staple"}'
```

2. Login and get a bearer token:

```bash
curl -X POST http://localhost:8000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"passphrase":"correct horse battery staple"}'
```

3. Configure that token in the web app, mobile app, or desktop helper.

## Main workflows

### Capture into artifacts

- `POST /v1/capture` ingests raw, normalized, and extracted capture layers
- `POST /v1/capture/voice` ingests voice notes and queues transcription
- browser and desktop helper flows both feed the same artifact system

### Work from the assistant thread

- `/assistant` is the current command/chat surface in the PWA
- `GET /v1/agent/intents` exposes supported assistant intents/examples
- `POST /v1/agent/command` plans or executes deterministic commands
- `POST /v1/agent/command/assist` and `POST /v1/agent/command/voice` queue broader AI-assisted flows

### Review artifacts and derived outputs

- `/artifacts` exposes artifact graphs and version history
- `GET /v1/artifacts/{artifact_id}/graph` shows linked summaries, cards, notes, tasks, and relations
- `GET /v1/artifacts/{artifact_id}/versions` exposes summary/card/action history

### Work across planning surfaces

- `/notes`, `/tasks`, `/calendar`, `/planner`, `/review`, `/search`
- sync and offline behavior surface through `/sync-center`
- portability/export flows live under `/portability`

## Key routes and pages

- `/assistant` — primary assistant/chat workspace
- `/artifacts` — artifact inbox, graph, and versioning
- `/notes` — note editor
- `/tasks` — task workspace
- `/calendar` — calendar workspace
- `/planner` — time-block planning
- `/review` — due card review
- `/search` — cross-workspace retrieval
- `/sync-center` — mutation replay and sync history
- `/portability` — export/restore workflows
- `/share-target` — installable PWA share ingress
- `/ai-jobs` — queued local AI job visibility

## Testing and validation

### API

```bash
make test-api
```

### Fast PR smoke gate

```bash
./scripts/ci_smoke_matrix.sh
```

Guide: `docs/AI_VALIDATION_SMOKE_MATRIX.md`

### PWA release gate

```bash
./scripts/pwa_release_gate.sh
```

### Seed demo data

```bash
make seed-api
```

## High-value docs

- `docs/CODEBASE_ORGANIZATION.md` — developer code map
- `docs/IMPLEMENTATION_STATUS.md` — current shipped snapshot and recent validation state
- `docs/PHONE_SETUP.md` — phone/PWA/mobile setup and testing
- `docs/ANDROID_DEV_BUILD.md` — Android dev-build flow
- `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md` — helper setup handoff
- `docs/RAILWAY_DEPLOY.md` — hosted deployment model
- `docs/PWA_RELEASE_VERIFICATION_GATE.md` — heavier PWA release checklist
