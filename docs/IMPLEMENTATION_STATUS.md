# Starlog Implementation Status

## Completed in this pass

- Monorepo scaffolding (web, mobile, api, contracts, tools).
- FastAPI core with SQLite schema bootstrapping and token auth.
- Core routes:
  - auth (`/v1/auth/*`)
  - sync (`/v1/sync/*`)
  - artifacts + graph + manual quick actions (`/v1/artifacts/*`)
  - clip ingest endpoint with source layers (`/v1/capture`)
  - notes (`/v1/notes`)
  - tasks (`/v1/tasks`)
  - calendar (`/v1/calendar/events`, `/v1/calendar/sync/google/*`)
  - planning blocks (`/v1/planning/blocks/*`)
  - SRS (`/v1/cards/due`, `/v1/reviews`)
  - briefings + alarms (`/v1/briefings/*`, `/v1/alarms`)
  - events + webhook registry (`/v1/events`, `/v1/webhooks`)
  - provider integration config/health (`/v1/integrations/providers/*`)
  - plugin registry API (`/v1/plugins`)
  - markdown import API (`/v1/import/markdown`)
  - ops metrics + backup snapshot (`/v1/ops/metrics`, `/v1/ops/backup`)
  - AI provider routing (`/v1/ai/run`)
  - export (`/v1/export`)
- Browser extension scaffold for clipping.
- Desktop Tauri helper scaffold for non-browser clipping.
- Artifact graph now persists explicit relation edges and exposes version history (`/v1/artifacts/{id}/versions`).
- Browser extension now posts raw/normalized/extracted capture layers to `/v1/capture`.
- Desktop helper now posts captures to `/v1/capture` and attempts strict on-device OCR (`tesseract`) for screenshots.
- Mobile companion now supports quick text capture to `/v1/capture`.
- Google OAuth now supports real token exchange when credentials are configured and exposes OAuth status endpoint (`/v1/calendar/sync/google/oauth/status`).
- Google sync can pull remote events from Google Calendar API into the local mirror when connected in real OAuth mode.
- Web UI refresh with modern "spacy" look and dark/light modes.
- Artifacts workspace now includes graph and version-history panels.
- Mobile companion includes briefing cache + notification alarm pipeline scaffold.
- API tests + lint + type checks passing via `uv` (`10 passed`).
- Web lint + TypeScript checks pass.

## Next implementation targets

1. Persist provider credentials securely (keychain/encrypted storage) and harden health checks.
2. Expand Google API coverage from pull to full push/update/delete parity with conflict resolution policy.
3. Replace desktop helper local hotkey wiring with true global OS shortcuts and complete cross-platform screenshot pipeline.
4. Harden mobile alarm/background behavior for production (permissions UX, retries, edge cases) plus share-sheet capture.
5. Deepen PWA multi-page workspace toward production UX (calendar board, richer review sessions, artifact graph navigation).
