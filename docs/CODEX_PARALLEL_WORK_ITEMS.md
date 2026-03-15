# Codex Parallel Work Items

Base code baseline for this queue: `ac536c9` on `master`.

Plan sources:
- `AGENTS.md` (v1 preferences + Android-first + low-cost Railway)
- `docs/STARLOG_V1_PLAN.md`
- `docs/STARLOG_ARCHITECTURE_WORKFLOW_PLAN.md`

Last queue reset: `2026-03-15`.

## Queue reset

- Prior workitems (`WI-101` through `WI-215`) are retired for v1-distribution planning.
- This file now tracks only v1 distribution work split into three categories:
  - Mobile App
  - Desktop App
  - PWA (Railway)

## Working rules

- Branch from latest `origin/master` using `codex/*` branch names only.
- Every claimed workitem must ship via a PR to `master`.
- Rebase onto latest `origin/master` before requesting merge if your branch is behind.
- If a PR is merged, do not push more commits to it. Create a new branch and a new PR.
- Do not deploy from a feature branch without explicit user approval.
- Update `AGENTS.md` issue/preference log for newly discovered blockers/preferences.

## Claiming and locks

- Live lock authority is the shared registry under `$(git rev-parse --git-common-dir)/codex-workitems/`.
- This file is a human-readable mirror of lock state.
- Claim before implementation:
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent-id>`
- Heartbeat every 2 minutes while actively working:
  - `python3 scripts/workitem_lock.py heartbeat --workitem-id <id> --agent-id <agent-id>`
- Release on completion/handoff:
  - `python3 scripts/workitem_lock.py release --workitem-id <id> --agent-id <agent-id> --status completed`
- Stale lock reclaim (TTL 10 minutes):
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent-id> --force-steal --reason "<reason>"`
- Sync mirror lines:
  - `python3 scripts/sync_workitem_mirror.py`

## Mobile App (Android v1 distribution)

### WI-301. Android release signing + versioning hardening
- Branch: `codex/mobile-release-signing-versioning`
- Lock: `UNCLAIMED | Workitem: WI-301 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: make Android release output store-ready (no debug signing/default app id drift).
- Scope:
  - finalize release signing configuration (keystore/alias/password wiring),
  - ensure production package/app id and release versionCode/versionName policy,
  - verify no debug keystore usage in release path.
- Acceptance:
  - release path no longer signs with debug config,
  - production variant identifiers and versions are deterministic/documented.
- Validation:
  - `cd apps/mobile && APP_VARIANT=production npx expo config --json`
  - `cd apps/mobile && APP_VARIANT=production ./node_modules/.bin/tsc --noEmit`

### WI-302. EAS production build pipeline for Android
- Branch: `codex/mobile-eas-production-pipeline`
- Lock: `UNCLAIMED | Workitem: WI-302 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: produce repeatable internal + production Android artifacts (APK/AAB) from the repo.
- Scope:
  - validate `eas.json` production profile inputs,
  - run and document internal preview and production build commands,
  - capture required env/credential prerequisites.
- Acceptance:
  - reproducible commands produce installable preview and production AAB artifacts,
  - release runbook includes required credential/env setup.
- Validation:
  - `cd apps/mobile && npx eas-cli build --platform android --profile preview`
  - `cd apps/mobile && npx eas-cli build --platform android --profile production`

### WI-303. Android release QA matrix (device-first)
- Branch: `codex/mobile-release-qa-matrix`
- Lock: `UNCLAIMED | Workitem: WI-303 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: validate all v1 companion flows on real Android hardware.
- Scope:
  - deep-link capture,
  - Android share-intent (text/url/image/file/audio, multi-file),
  - voice upload queue/retry,
  - alarms + offline briefing playback,
  - quick triage/review sanity.
- Acceptance:
  - all matrix rows pass or have documented blocker with workaround,
  - evidence attached (logs/screenshots) for pass/fail.
- Validation:
  - `pnpm test:android:smoke`
  - `pnpm test:android:smoke:windows`

### WI-304. Mobile ↔ Railway API ↔ local AI worker E2E
- Branch: `codex/mobile-railway-worker-e2e`
- Lock: `UNCLAIMED | Workitem: WI-304 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: prove phone capture and voice-note transcription flows against hosted API.
- Scope:
  - mobile app against Railway API URL,
  - queued voice note upload,
  - local worker pull/process/complete path,
  - transcript visibility back in app/PWA.
- Acceptance:
  - hosted E2E path works from phone -> Railway -> worker -> UI,
  - known failure modes and operator steps documented.
- Validation:
  - `PYTHONPATH=services/api uv run --project services/api python scripts/local_ai_worker.py --api-base <railway-api> --token <token> --once`

### WI-305. Android store-distribution package prep
- Branch: `codex/mobile-store-distribution-pack`
- Lock: `UNCLAIMED | Workitem: WI-305 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: prepare non-code artifacts required for v1 Android distribution.
- Scope:
  - release notes template,
  - screenshot/icon set audit,
  - permissions + data-safety inventory from actual app behavior,
  - distribution checklist in docs.
- Acceptance:
  - v1 Android release checklist is complete and actionable,
  - required store metadata assets are enumerated and linked.
- Validation:
  - checklist review against current app config + tested behavior.

### WI-306. Mobile release candidate cut + handoff
- Branch: `codex/mobile-v1-rc-cut`
- Lock: `UNCLAIMED | Workitem: WI-306 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: package mobile release candidate and handoff with rollback notes.
- Scope:
  - RC build selection,
  - changelog update,
  - rollback path documentation.
- Acceptance:
  - one named mobile RC with traceable commit/PR links,
  - rollback/runbook sections are complete.
- Validation:
  - dry-run release checklist execution.

## Desktop App (v1 helper distribution)

### WI-321. Desktop installer artifact pipeline
- Branch: `codex/desktop-installer-artifacts`
- Lock: `UNCLAIMED | Workitem: WI-321 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: produce distributable desktop helper artifacts beyond raw binary output.
- Scope:
  - target packaging outputs for v1 platforms,
  - consistent artifact naming/versioning,
  - build instructions per target host.
- Acceptance:
  - documented commands produce distributable installer artifacts for target platforms.
- Validation:
  - `cd tools/desktop-helper && ./node_modules/.bin/tauri build`

### WI-322. Desktop signing/notarization readiness
- Branch: `codex/desktop-signing-notarization`
- Lock: `UNCLAIMED | Workitem: WI-322 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: ensure desktop binaries can be distributed without trust/security warnings where applicable.
- Scope:
  - signing credential flow per target OS,
  - notarization (where required),
  - docs for secure handling of signing secrets.
- Acceptance:
  - signing/notarization steps documented and test-run on at least one RC artifact.
- Validation:
  - platform-specific signing/notarization verification commands/logs.

### WI-323. Desktop runtime dependency + diagnostics hardening
- Branch: `codex/desktop-runtime-deps-diagnostics`
- Lock: `UNCLAIMED | Workitem: WI-323 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: reduce support risk by validating host dependency behavior and diagnostics quality.
- Scope:
  - confirm runtime behavior with/without OCR dependency,
  - ensure diagnostics guidance is actionable for permission/tooling failures,
  - update docs for host setup and troubleshooting.
- Acceptance:
  - diagnostics clearly surface root causes and remediation steps,
  - docs align with actual runtime checks.
- Validation:
  - desktop helper manual runtime checks per README.

### WI-324. Desktop QA matrix (Windows + macOS focus)
- Branch: `codex/desktop-win-macos-qa`
- Lock: `UNCLAIMED | Workitem: WI-324 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: verify v1 helper flows on target user platforms.
- Scope:
  - clipboard clip,
  - screenshot clip,
  - active window metadata,
  - shortcut behavior,
  - secure token persistence.
- Acceptance:
  - matrix results recorded with evidence,
  - blockers are classified and triaged.
- Validation:
  - `./node_modules/.bin/playwright test`
  - `cd tools/desktop-helper/src-tauri && cargo check`

### WI-325. Desktop v1 release package + handoff
- Branch: `codex/desktop-v1-release-pack`
- Lock: `UNCLAIMED | Workitem: WI-325 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: publish-ready desktop package definition with checksums/changelog/install notes.
- Scope:
  - RC artifact selection,
  - checksum + provenance notes,
  - install/upgrade notes for users.
- Acceptance:
  - one desktop RC package set with documented install path and rollback guidance.
- Validation:
  - artifact integrity and install smoke checks.

## PWA (Railway v1 distribution)

### WI-341. Unblock web build (planner + sync center)
- Branch: `codex/pwa-build-unblock`
- Lock: `UNCLAIMED | Workitem: WI-341 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: restore passing web typecheck/lint/build on current `master`.
- Scope:
  - resolve duplicate symbol/regression issues in planner,
  - fix broken callback/parser state in sync-center,
  - clear any newly surfaced lint/type failures.
- Acceptance:
  - `web` lint + typecheck + production build all pass.
- Validation:
  - `cd apps/web && ./node_modules/.bin/next lint`
  - `cd apps/web && ./node_modules/.bin/next build`
  - `cd /home/ubuntu/starlog && npx pnpm@9.15.0 --filter web exec tsc --noEmit`

### WI-342. PWA release verification gate
- Branch: `codex/pwa-release-verification-gate`
- Lock: `UNCLAIMED | Workitem: WI-342 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: define a repeatable pre-deploy verification pass for the PWA.
- Scope:
  - codify required checks in one runbook command sequence,
  - include offline-focused Playwright coverage currently used for PWA confidence.
- Acceptance:
  - one documented gate can be run before every release and yields pass/fail outcome.
- Validation:
  - `./node_modules/.bin/playwright test --config=playwright.web.config.ts`

### WI-343. Railway production config hardening
- Branch: `codex/pwa-railway-prod-config`
- Lock: `UNCLAIMED | Workitem: WI-343 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: finalize Railway API + web config for secure/stable v1 operation.
- Scope:
  - validate required env vars (`STARLOG_ENV`, DB/media paths, CORS, secrets master key),
  - verify persistent volume wiring,
  - confirm web start/build commands and domain wiring.
- Acceptance:
  - Railway config checklist is complete and validated against real environment.
- Validation:
  - `docs/RAILWAY_DEPLOY.md` checklist executed end-to-end.

### WI-344. Hosted PWA production smoke + integration checks
- Branch: `codex/pwa-hosted-smoke`
- Lock: `UNCLAIMED | Workitem: WI-344 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: verify critical user flows on hosted Railway deployment.
- Scope:
  - bootstrap/login/session controls,
  - artifact/note/task/calendar happy paths,
  - sync center visibility,
  - mobile companion interoperability against hosted API.
- Acceptance:
  - hosted smoke checklist passes with evidence; open defects are triaged.
- Validation:
  - hosted URL smoke run + targeted API route checks.

### WI-345. Backup/restore + portability drill for hosted v1
- Branch: `codex/pwa-portability-drill`
- Lock: `UNCLAIMED | Workitem: WI-345 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: verify that v1 hosted data can be exported/restored reliably.
- Scope:
  - export snapshot generation,
  - restore rehearsal,
  - roundtrip verification.
- Acceptance:
  - successful roundtrip drill with documented timings and caveats.
- Validation:
  - `make verify-export`
  - `POST /v1/ops/backup` exercised against hosted service.

### WI-346. PWA go-live runbook + rollback/monitoring
- Branch: `codex/pwa-go-live-runbook`
- Lock: `UNCLAIMED | Workitem: WI-346 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: finalize operational readiness for v1 launch.
- Scope:
  - deployment order,
  - smoke/acceptance gate,
  - rollback triggers and rollback procedure,
  - post-release log/health monitoring checklist.
- Acceptance:
  - one operator runbook can be executed by a single supervisor end-to-end.
- Validation:
  - dry-run through runbook against staging/production-like environment.

## Suggested execution order

1. `WI-341` -> `WI-342` -> `WI-343` -> `WI-344` -> `WI-345` -> `WI-346`
2. `WI-301` -> `WI-302` -> `WI-303` -> `WI-304` -> `WI-305` -> `WI-306`
3. `WI-321` -> `WI-322` -> `WI-323` -> `WI-324` -> `WI-325`

Parallel-safe starters right now:
- `WI-341`, `WI-301`, `WI-321`
