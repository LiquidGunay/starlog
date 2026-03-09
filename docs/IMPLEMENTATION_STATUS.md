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
- Mobile companion local state is now backed by Expo SQLite with migration from the earlier JSON-file store.
- Mobile companion capture path now supports retry queue + manual/auto flush for transient network failures.
- Mobile companion now supports local voice-note recording, upload/queue, and Whisper-backed deferred transcription jobs.
- Mobile companion now supports `starlog://capture?...` deep-link ingestion for share-to-app style capture prefill.
- Mobile companion now supports Android native share-intent prefills for shared text/URLs/files/audio when running in the local dev build.
- Android dev-build path is now configured with `expo-dev-client`, variant-aware app config, and EAS build profiles for installable APK builds.
- Mobile alarm flow hardened with daily schedule, clear/re-schedule control, Android channel setup, and fallback playback behavior.
- Mobile companion now supports quick SRS review sessions (load due cards, reveal answer, submit ratings).
- Mobile companion now supports lightweight artifact inbox triage, manual artifact actions, and open-in-PWA handoff.
- Mobile companion now shows selected artifact context (latest summary, related tasks/notes/cards, recent action history) for quick triage on phone.
- Mobile companion can now jump directly from artifact triage into related PWA note/task targets.
- Mobile companion now reads the shared execution policy, shows the resolved mobile route for LLM/STT/TTS, and routes artifact actions toward the batch bridge when that policy target is preferred.
- Mobile companion now includes a typed assistant-command panel backed by `/v1/agent/command`, with example commands and recent result history on phone.
- Mobile companion now supports queued voice commands using the same recording path, with Whisper-backed transcription jobs and assistant-command results visible in the phone UI.
- Mobile companion now also supports queued Codex-assisted command planning/execution jobs and can queue/download offline briefing audio renders from the local TTS worker path.
- Google OAuth now supports real token exchange when credentials are configured and exposes OAuth status endpoint (`/v1/calendar/sync/google/oauth/status`).
- Google sync can pull remote events from Google Calendar API into the local mirror when connected in real OAuth mode.
- Calendar events now support sync-aware soft delete (`DELETE /v1/calendar/events/{id}`) with tombstone tracking.
- Google sync now includes push/update/delete parity paths when connected in real OAuth mode, while retaining mirror-mode fallback.
- Google sync conflicts now support unresolved/resolved views plus API resolution actions (`local_wins` / `remote_wins` / `dismiss`).
- Provider configs now encrypt sensitive values at rest, redact secrets in API responses, and expose richer health checks.
- Execution policy config now exists per capability (`llm`, `stt`, `tts`, `ocr`) so the stack can prioritize on-device, batch-local, server-local, bridge, or API fallback paths in a configurable order.
- Provider health now includes localhost runtime endpoint probes for local-mode providers.
- Provider health now supports auth-level probes for Google OAuth and opt-in remote/API providers via `auth_probe_url`.
- Codex bridge health now derives authenticated model-list probes from the configured bridge URL when explicit probe URLs are not supplied.
- Artifact summarize/cards/tasks actions now flow through the AI provider chain (local -> codex bridge -> API fallback) instead of template-only stubs.
- Google sync run responses now include `run_id`, and conflict details now carry sync run/phase metadata for replay diagnostics.
- Google sync conflicts can now trigger replay runs from the API and planner/calendar UI surfaces.
- Web UI refresh with modern "spacy" look and dark/light modes.
- Artifacts workspace now includes graph and version-history panels.
- Planner workspace now includes day-board timeline view for blocks/events plus richer sync status surfaces.
- Calendar workspace now includes weekly board, event CRUD lifecycle, Google sync trigger, and unresolved conflict visibility.
- Notes workspace now supports direct note fetch/edit flows with optimistic queued updates.
- Tasks workspace now supports optimistic create/update/status flows.
- Search workspace now supports cross-workspace retrieval across artifacts, notes, tasks, and calendar events.
- Integrations workspace now supports provider config edits plus live health/probe inspection.
- PWA now has a browser-side mutation outbox with replay-on-reconnect and manual flush/drop controls.
- Artifacts and calendar workspaces now overlay queued mutations immediately and support deep-link selection from search.
- Sync workspace now exposes queued mutations, local replay history, and server-recorded mutation activity (`/sync-center`).
- Sync workspace now also exposes pull-by-cursor server delta inspection on top of outbox replay history.
- Artifacts, review, planner event creation, calendar CRUD, integrations config, and home console clip/actions now use the outbox-aware mutation path.
- Review workspace now supports focused single-card sessions with live session metrics and queue preview.
- Added `/mobile-share` workspace page to generate and launch `starlog://capture?...` deep-links for phone capture handoff.
- Added installable PWA shell assets (`/manifest.webmanifest`, service worker, icons) plus `/share-target` for browser/PWA share ingress.
- Added `/portability` workspace for export download, restore replay, and roundtrip-verification workflow visibility.
- Added protected media storage/download endpoints plus media export/import payload support for voice-note portability.
- Added queued local AI worker tooling for laptop-local `codex exec`, Codex-assisted command planning, Whisper processing, and optional local TTS rendering (`scripts/local_ai_worker.py`).
- Added `/ai-jobs` workspace for queued local Codex/Whisper job inspection.
- Added an agent-control API/tool catalog (`/v1/agent/tools`, `/v1/agent/execute`) plus a web tester page at `/agent-tools` so future voice/chat surfaces can call Starlog actions without UI clicks.
- Agent tools can now also read/update execution policy so future chat/voice shells can control routing preferences directly.
- Agent tool coverage now spans artifacts, notes, tasks, calendar events, time-block generation, review, briefing/alarm flows, search, and execution-policy management.
- Added `/v1/agent/command`, a deterministic command planner/executor that maps typed commands onto the same tool layer and can either dry-run or execute them.
- Added `GET /v1/agent/intents`, a backend intent/examples catalog so assistant shells can load supported commands without hardcoding them.
- Added `POST /v1/agent/command/assist`, which queues Codex-backed assistant planning/execution jobs against the same tool layer used by deterministic commands.
- Added `POST /v1/agent/command/voice`, which queues STT jobs with `action=assistant_command` and executes the command planner automatically when transcription completes.
- Added `/assistant`, the first chat-style command shell in the PWA, with backend-loaded examples, in-browser voice recording, queued Codex planning/execution jobs, local snapshot-backed history, and recent command/job inspection.
- Integrations workspace now includes editable execution-policy JSON so the same preference ordering can later be honored by phone-local runtimes too.
- Mobile companion includes briefing cache + notification alarm pipeline scaffold.
- Mobile companion now exposes on-device TTS for selected artifact playback.
- Briefings can now queue local TTS audio rendering jobs through `/v1/briefings/{briefing_id}/audio/render`, attach rendered media back onto the package, and be cached/played from pre-rendered audio on phone.
- Key PWA workspaces now keep best-effort local entity snapshots for artifacts, notes, tasks, calendar, and assistant history so recent state remains readable offline.
- Export/import roundtrip restore now covers relation/action/sync/provider tables and includes `make verify-export` drill tooling.
- API tests + lint + type checks passing via `uv` (`24 passed`).
- Web lint + TypeScript checks pass, and production build succeeds.

## Next implementation targets

1. Harden the native share path by validating Android share-intent behavior end to end on device and adding the matching iOS share-extension path.
2. Replace desktop helper local hotkey wiring with true global OS shortcuts and complete cross-platform screenshot pipeline (deprioritized for now).
3. Harden the local TTS worker path with provider-specific wrappers and richer job controls beyond the current queued-audio render flow.
4. Add a real native Codex-subscription/OAuth bridge path if/when the bridge contract is finalized.
5. Deepen PWA local-first caches beyond the current local-snapshot reads (IndexedDB entity snapshots, offline detail/search reads, and cache invalidation rules).
6. Implement actual phone-local STT/LLM backends that honor the shared execution policy instead of routing those capabilities only through the queued/local-server paths.
