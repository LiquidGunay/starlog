# Starlog

Starlog is a single-user, clip-first personal system for knowledge, scheduling, and learning loops.

This repository now includes an implementation scaffold across backend, web/PWA, mobile companion,
and clipping surfaces (browser extension + desktop helper).

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
make dev-web
```

### Mobile app

```bash
pnpm --filter mobile start
```

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
- `/planner` - time-block generation workspace
- `/review` - due card review queue

## Clip-first API additions

- Ingest capture with raw/normalized/extracted layers: `POST /v1/capture`
- Inspect artifact graph links: `GET /v1/artifacts/{artifact_id}/graph`
- Inspect summary/card/action version history: `GET /v1/artifacts/{artifact_id}/versions`

## Google calendar sync scaffold

- Start OAuth intent: `POST /v1/calendar/sync/google/oauth/start`
- Complete OAuth callback: `POST /v1/calendar/sync/google/oauth/callback`
- Inspect OAuth connection mode/token state: `GET /v1/calendar/sync/google/oauth/status`
- Run two-way delta sync: `POST /v1/calendar/sync/google/run`
- Inspect remote mirror + conflicts:
  - `GET /v1/calendar/sync/google/remote/events`
  - `GET /v1/calendar/sync/google/conflicts`

When `STARLOG_GOOGLE_CLIENT_ID` and `STARLOG_GOOGLE_CLIENT_SECRET` are configured, callback performs a real Google token exchange.

## Extensibility + import

- Register/list plugins: `POST /v1/plugins`, `GET /v1/plugins`
- Import markdown notes: `POST /v1/import/markdown`

## Ops endpoints

- Runtime metrics snapshot: `GET /v1/ops/metrics`
- Local backup snapshot export: `POST /v1/ops/backup`

## Current status

This is an active implementation pass toward the approved v1 plan in `docs/STARLOG_V1_PLAN.md`.
