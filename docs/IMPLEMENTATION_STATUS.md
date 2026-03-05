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
- Mobile companion now persists local runtime state (API base, token, queue, alarm config, briefing cache refs).
- Mobile companion capture path now supports retry queue + manual/auto flush for transient network failures.
- Mobile companion now supports `starlog://capture?...` deep-link ingestion for share-to-app style capture prefill.
- Mobile alarm flow hardened with daily schedule, clear/re-schedule control, Android channel setup, and fallback playback behavior.
- Mobile companion now supports quick SRS review sessions (load due cards, reveal answer, submit ratings).
- Google OAuth now supports real token exchange when credentials are configured and exposes OAuth status endpoint (`/v1/calendar/sync/google/oauth/status`).
- Google sync can pull remote events from Google Calendar API into the local mirror when connected in real OAuth mode.
- Calendar events now support sync-aware soft delete (`DELETE /v1/calendar/events/{id}`) with tombstone tracking.
- Google sync now includes push/update/delete parity paths when connected in real OAuth mode, while retaining mirror-mode fallback.
- Google sync conflicts now support unresolved/resolved views plus API resolution actions (`local_wins` / `remote_wins` / `dismiss`).
- Provider configs now encrypt sensitive values at rest, redact secrets in API responses, and expose richer health checks.
- Web UI refresh with modern "spacy" look and dark/light modes.
- Artifacts workspace now includes graph and version-history panels.
- Planner workspace now includes day-board timeline view for blocks/events plus richer sync status surfaces.
- Calendar workspace now includes weekly board, event CRUD lifecycle, Google sync trigger, and unresolved conflict visibility.
- Review workspace now supports focused single-card sessions with live session metrics and queue preview.
- Added `/mobile-share` workspace page to generate and launch `starlog://capture?...` deep-links for phone capture handoff.
- Mobile companion includes briefing cache + notification alarm pipeline scaffold.
- API tests + lint + type checks passing via `uv` (`12 passed`).
- Web lint + TypeScript checks pass.

## Next implementation targets

1. Add provider-level runtime health probes (local endpoint ping, auth sanity checks) beyond config validation.
2. Harden Google push/update/delete sync behavior with richer conflict diagnostics and replay metadata.
3. Add native share extension path (iOS/Android) to complement current deep-link capture ingress.
4. Add PWA offline mutation queue + replay UX to better align with local-first behavior.
5. Replace desktop helper local hotkey wiring with true global OS shortcuts and complete cross-platform screenshot pipeline (deprioritized for now).
