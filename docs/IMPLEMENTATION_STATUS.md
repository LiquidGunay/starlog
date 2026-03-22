# Starlog Implementation Status

`PLAN.md` is the canonical forward-looking spec. For the shortest current install/test handoff across desktop,
phone, and PWA, use `docs/VNEXT_TEST_BUNDLE.md`.

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
  - worker pairing/auth/session management (`/v1/workers/*`)
  - export (`/v1/export`)
- Browser extension scaffold for clipping.
- Desktop Tauri helper for non-browser clipping.
- Artifact graph now persists explicit relation edges and exposes version history (`/v1/artifacts/{id}/versions`).
- Browser extension now posts raw/normalized/extracted capture layers to `/v1/capture`.
- Desktop helper now posts captures to `/v1/capture` and attempts strict on-device OCR (`tesseract`) for screenshots.
- Desktop helper now persists API-base config while storing bearer tokens in OS secure storage on Tauri hosts, registers native global shortcuts in Tauri runtime, uses native clipboard reads, and attempts platform screenshot capture beyond the earlier placeholder path.
- Desktop helper now captures best-effort active app/window metadata and keeps recent clip history in the helper UI.
- Desktop helper recent screenshot history now also keeps thumbnail previews so screenshot clips are visually inspectable in-app instead of being text-only.
- Desktop helper now builds successfully as a native Tauri release app on Linux (`tools/desktop-helper/src-tauri/target/release/starlog_desktop_helper`).
- Desktop helper now exposes runtime diagnostics for clipboard/screenshot/OCR/shortcut state, includes refresh/copy controls for redacted bug-report snapshots, falls back to browser clipboard reads when native access is unavailable, and cleans up temporary screenshot files after upload attempts.
- Desktop helper diagnostics now keep latest-attempt notes with actionable fix hints, recent captures now show the backend that produced them, and the helper docs now include a real Linux/Windows host validation matrix.
- Desktop helper host-matrix follow-up also validated the Windows PowerShell host path, fixed the Windows active-window probe (`$PID` collision), and maps Windows screenshot/window failures to actionable interactive-session guidance.
- Desktop helper now also maps common macOS `screencapture`/`osascript` failures to explicit Screen Recording / Automation / Accessibility guidance, and runtime diagnostics now run a best-effort macOS active-window probe to surface permission issues early.
- Desktop helper RC follow-up on 2026-03-22 rebuilt the Linux `.deb`/binary artifacts, validated authenticated localhost bridge discovery on `127.0.0.1:8091`, exercised the merged local voice server path through `scripts/local_voice_runtime_smoke.py`, and captured one real helper clipboard upload into a local API (`art_b40fadfafc55444897413ec4bdc59593`) with evidence under `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/`.
- This host still lacks the Linux clipboard/screenshot/OCR binaries (`wl-paste`/`xclip`, screenshot tooling, `tesseract`), so the current desktop RC is distributable for bridge/upload feedback but native Linux screenshot/OCR remains a host-setup blocker, not a helper-code blocker.
- Mobile companion now supports quick text capture to `/v1/capture`.
- Mobile companion now persists local runtime state (API base, token, queue, alarm config, briefing cache refs).
- Mobile companion local state is now backed by Expo SQLite with migration from the earlier JSON-file store.
- Mobile companion capture path now supports retry queue + manual/auto flush for transient network failures.
- Mobile companion now supports local voice-note recording, upload/queue, and Whisper-backed deferred transcription jobs.
- Mobile companion now supports `starlog://capture?...` deep-link ingestion for share-to-app style capture prefill.
- Mobile companion now supports native share-intent prefills for shared text/URLs/files/audio in dev builds, with Android validated end-to-end; any iOS extension intake remains outside the current v1 distribution scope.
- Mobile companion now uploads shared Android images/files as media-backed artifacts instead of reducing them to placeholder text.
- Mobile companion now keeps multiple shared Android files together in the quick-capture screen instead of dropping everything after the first file.
- Mobile companion now materializes shared Android files/audio into app-owned storage and persists shared draft state so native share intake survives routine app/background restarts more reliably.
- Android dev-build path is now configured with `expo-dev-client`, variant-aware app config, and EAS build profiles for installable APK builds.
- Native Android project now lives under `apps/mobile/android`, and the local debug build path validates with `./gradlew assembleDebug`.
- Repo now includes an `adb`-driven Android smoke script (`pnpm test:android:smoke`) to install the debug APK and trigger deep-link plus plain-text share-intent checks on attached devices/emulators.
- Repo now also includes a Windows-host Android smoke helper (`scripts/android_native_smoke_windows.ps1` / `pnpm test:android:smoke:windows`) because this host's WSL `adb shell` path can be flaky even when Windows `adb.exe` still sees the connected phone.
- Repo now includes a WSL-to-Windows Metro relay helper (`scripts/android_windows_metro_relay.sh` plus `scripts/tcp_relay.py`) so a physical Android phone can reach the WSL Metro server over the Windows LAN IP instead of relying only on `adb reverse tcp:8081`.
- Repo now includes an Android dev-client opener helper (`scripts/android_open_dev_client.sh` / `pnpm android:open:dev-client`) so a physical phone can jump straight into the Expo dev build over the LAN relay without depending on the Dev Launcher home screen.
- Physical Android validation now confirms two live-device fixes on the connected Android 14 phone: deep-link smoke payloads with `&source_url=...` survive remote-shell quoting correctly, and the cleanest Metro path on this host is LAN Metro plus the explicit `exp+starlog://expo-development-client/?url=http://<WINDOWS_LAN_IP>:8081` open flow with only API port `8000` reversed.
- `expo-share-intent` may still expose iOS activation rules in app config, but iOS share certification is outside the current v1 distribution scope.
- Mobile alarm flow hardened with daily schedule, clear/re-schedule control, Android channel setup, and fallback playback behavior.
- Mobile companion now supports quick SRS review sessions (load due cards, reveal answer, submit ratings).
- Mobile companion now supports lightweight artifact inbox triage, manual artifact actions, and open-in-PWA handoff.
- Mobile companion now shows selected artifact context (latest summary, related tasks/notes/cards, recent action history) for quick triage on phone.
- Mobile companion can now jump directly from artifact triage into related PWA note/task targets.
- Mobile companion now reads the shared execution policy, shows the resolved mobile route for LLM/STT/TTS, and routes artifact actions toward the batch bridge when that policy target is preferred.
- Mobile companion now includes a typed assistant-command panel backed by `/v1/agent/command`, with example commands and recent result history on phone.
- Mobile companion now supports Android on-device STT for assistant voice commands via the platform speech recognizer when the shared policy resolves STT to `on_device`; queued Whisper upload remains the fallback path.
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
- Codex bridge now also exposes an explicit contract endpoint in the API/UI, requires `experimental_enabled=true` plus `adapter_kind=openai_compatible` before execution, and falls back safely when the bridge is not explicitly opted in.
- Codex bridge contract now also reports explicit first-party-native status (`unavailable`), blocker list, verified timestamp, and recommended runtime mode (`experimental_openai_compatible_bridge` vs `api_fallback`) so the UI can clearly explain why native OAuth remains blocked.
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
- Local AI worker now defaults to picking up queued TTS jobs too, supports provider-specific local TTS wrappers (`piper_local`, `say_local`, `espeak_local`, `espeak_ng_local`), and carries voice/rate metadata through the render result.
- Added `/ai-jobs` workspace for queued local Codex/Whisper job inspection.
- `/ai-jobs` now supports filtering by status/capability/provider/action plus manual cancel/retry controls for queued or failed local AI jobs.
- Added `docs/AI_VALIDATION_SMOKE_MATRIX.md` plus `scripts/ci_smoke_matrix.sh` to define the fast PR smoke gate across runtime, API, web, and local bridge surfaces, while keeping currently red/unstable watch lanes explicit instead of silently dropping them.
- Worker auth lifecycle coverage now verifies pairing, access-token rotation on refresh, stale-token rejection, revocation enforcement, and revoked-worker visibility via `/v1/workers?include_revoked=true`.
- Added an agent-control API/tool catalog (`/v1/agent/tools`, `/v1/agent/execute`) plus a web tester page at `/agent-tools` so future voice/chat surfaces can call Starlog actions without UI clicks.
- Agent tools can now also read/update execution policy so future chat/voice shells can control routing preferences directly.
- Agent tool coverage now spans artifacts, notes, tasks, calendar events, time-block generation, review, briefing/alarm flows, search, and execution-policy management.
- Added `/v1/agent/command`, a deterministic command planner/executor that maps typed commands onto the same tool layer and can either dry-run or execute them.
- Added `GET /v1/agent/intents`, a backend intent/examples catalog so assistant shells can load supported commands without hardcoding them.
- Added `POST /v1/agent/command/assist`, which queues Codex-backed assistant planning/execution jobs against the same tool layer used by deterministic commands.
- Added `POST /v1/agent/command/voice`, which queues STT jobs with `action=assistant_command` and executes the command planner automatically when transcription completes.
- Added `/assistant`, the first chat-style command shell in the PWA, with backend-loaded examples, in-browser voice recording, queued Codex planning/execution jobs, local snapshot-backed history, and recent command/job inspection.
- Agent command execution-policy controls now normalize both canonical and legacy target tokens onto `mobile_bridge`/`desktop_bridge`/`api`, so `set ... policy` commands and tool-execution flows align with the current bridge-first routing model.
- Integrations workspace now includes editable execution-policy JSON so the same preference ordering can later be honored by phone-local runtimes too.
- Added a guarded phone-local LLM contract endpoint (`/v1/integrations/providers/mobile_llm/contract`) plus Integrations UI visibility for runtime state, capability checks, blockers, and explicit fallback guidance (`mobile_bridge -> desktop_bridge -> api`).
- Mobile companion includes briefing cache + notification alarm pipeline scaffold.
- Mobile companion now exposes on-device TTS for selected artifact playback.
- Briefings can now queue local TTS audio rendering jobs through `/v1/briefings/{briefing_id}/audio/render`, attach rendered media back onto the package, and be cached/played from pre-rendered audio on phone.
- Key PWA workspaces now persist IndexedDB-backed local caches for artifacts, per-artifact graph/version detail, notes, tasks, calendar, search results, and assistant history, with localStorage retained only as a bootstrap fallback.
- Key PWA workspaces now also keep per-entity IndexedDB records for notes, tasks, calendar events, artifact lists, and artifact detail, so offline reloads can restore selected editors/details from a real entity cache instead of only coarse snapshot blobs.
- PWA offline search now reads the IndexedDB cache, reuses cached artifact graph detail, and overlays queued note/task/calendar/artifact mutations so offline retrieval stays useful after local edits.
- Filtered task refreshes now merge back into the canonical local task cache, so switching filters or reloading offline does not collapse the offline task/search view down to only the most recently fetched subset.
- PWA mutation replay now marks affected cache scopes stale, key workspaces auto-refresh those scopes on reconnect, and the service worker now caches core app-shell routes/assets so offline reloads can reach the cached entity data.
- AI jobs and portability pages now restore cached local snapshot state (job list/filter controls and export/import payload buffers) so those workflows remain useful across offline reloads.
- Export/import roundtrip restore now covers relation/action/sync/provider tables and includes `make verify-export` drill tooling.
- API tests + lint + type checks passing via `uv` (`24 passed`).
- Web lint + TypeScript checks pass, and production build succeeds.
- Physical Android validation on the attached phone now confirms: the dev client can render the companion UI through the Windows LAN relay path, the previous `unexpected end of stream on http://127.0.0.1:8081/...` failure is avoidable with Expo LAN mode plus relay, and the remaining toast-level Metro warning is tied to mixed `localhost`/LAN Dev Launcher endpoints rather than a blank-screen app failure.
- Railway-hosted PWA release-candidate path is now concrete enough for user testing:
  - public web URL: `https://starlog-web-production.up.railway.app`
  - public API health: `https://starlog-api-production.up.railway.app/v1/health`
  - release gate passed via `bash ./scripts/pwa_release_gate.sh` on `2026-03-22T14:18:37Z`
  - production-style hosted smoke passed via `bash ./scripts/pwa_hosted_smoke.sh` on `2026-03-22T14:16:56Z`
  - release gate build passes when run in isolation; a prior `Unexpected end of JSON input` failure came from overlapping Next builds during concurrent gate/smoke execution rather than a persistent app defect

## Validation run for this pass

- `cd /home/ubuntu/starlog/services/api && uv run --project services/api --extra dev pytest tests/test_api_flows.py -k 'provider_config_and_webhooks or execution_policy_controls_ai_routing or codex_bridge_requires_explicit_opt_in_for_execution' -s`
- `cd /home/ubuntu/starlog/apps/web && ./node_modules/.bin/tsc --noEmit`
- `cd /home/ubuntu/starlog/apps/web && ./node_modules/.bin/next lint`
- `cd /home/ubuntu/starlog && ./node_modules/.bin/playwright test --config=playwright.web.config.ts`
- `cd /home/ubuntu/starlog && npx pnpm@9.15.0 --filter web exec tsc --noEmit`
- `cd /home/ubuntu/starlog && npx pnpm@9.15.0 --filter web lint`

## Next implementation targets

1. Finish `WI-580`, `WI-581`, and `WI-582` so the local PC helper path, connected-phone Android path, and hosted PWA path each have a current-master release-candidate pass.
2. Recover the chat-surface assistant Playwright lanes so `apps/web/tests/assistant-*.spec.ts` can move back into the default PR smoke matrix.
3. Fix the currently red `services/api/tests/test_voice_native_regression.py` expectation drift and move that lane back into the default smoke gate.
4. Finish the remaining real macOS helper validation path now that Linux and a real Windows PowerShell host path have been checked against the diagnostics matrix.
5. Harden the local TTS worker path further with deeper provider validation, retries/timeouts, and richer failure metadata beyond the current local wrapper set plus cancel/retry controls.
6. Re-authenticate Railway CLI in the operator environment so live dashboard/start-command verification can be completed without falling back to public URL checks only.
7. Replace the guarded experimental Codex bridge contract with a first-party native Codex-subscription/OAuth path if/when that upstream contract is finalized.
