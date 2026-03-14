# Codex Parallel Work Items

Base code baseline for this queue: `de2e08d` on `master`.

Plan source: `docs/STARLOG_ARCHITECTURE_WORKFLOW_PLAN.md` (updated `2026-03-14`).

## Queue reset

- `WI-101` through `WI-106` are retired and should not be claimed.
- This file now tracks the replacement queue derived from the new architecture/workflow plan.

## Working rules

- Create each workstream from `master` at `de2e08d` or a newer fast-forward of it.
- Keep branch names under the required `codex/` prefix.
- Prefer rebasing onto `master` instead of merging other Codex branches together.
- Every claimed workitem must ship through a PR targeting `master` (no direct pushes to `master`).
- Rebase onto latest `origin/master` whenever your branch is behind before requesting final review/merge, then rerun relevant validation.
- Do not stack Codex branches unless the dependency is explicit and recorded here.
- Do not add commits to a branch/PR that is already merged; create a new branch and a new PR.
- Do not deploy from these branches without explicit user approval.
- Update `AGENTS.md` with any newly discovered blocker or preference.

## Claiming and locks

- Live lock authority is the shared `.git` registry under `$(git rev-parse --git-common-dir)/codex-workitems/`.
- This file is a human-readable mirror; authoritative lock state lives in `.git` registry files.
- Before implementation, claim with:
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent>`
- While actively working, heartbeat every 2 minutes:
  - `python3 scripts/workitem_lock.py heartbeat --workitem-id <id> --agent-id <agent>`
- Release on completion/handoff:
  - `python3 scripts/workitem_lock.py release --workitem-id <id> --agent-id <agent> --status completed`
- Stale-lock recovery:
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent> --force-steal --reason "<reason>"`
- Keep the `Lock:` lines in this file updated as a readable mirror for humans after claim/heartbeat/release operations.
- Mirror helper:
  - Write/sync lock lines: `python3 scripts/sync_workitem_mirror.py`
  - Check-only drift detection: `python3 scripts/sync_workitem_mirror.py --check`
- Optional make targets:
  - `make sync-workitem-mirror`
  - `make check-workitem-mirror`
  - `make test-workitem-mirror`

## Active workstreams (new-plan aligned)

### 1. Execution policy convergence

### 7. Lock mirror helper hardening

- Branch: `codex/workitem-mirror-checks-b`
- Workitem ID: `WI-112`
- Lock: `HANDOFF_REVIEW | Workitem: WI-112 | Owner: N/A | Claimed: 2026-03-14T19:00:00Z | Last heartbeat: 2026-03-14T19:02:11Z`
- Goal: make lock-mirror sync verifiable and testable in automation.
- Scope:
  - add `--check` mode to the lock mirror sync helper so CI/agents can fail on drift without rewriting,
  - add focused tests for update mode and check mode behavior,
  - add Makefile convenience targets for sync/check/test commands.
- Out of scope:
  - replacing the shared registry authority model,
  - changing lock claim/release semantics.
- Likely files:
  - `scripts/sync_workitem_mirror.py`
  - `scripts/tests/test_sync_workitem_mirror.py`
  - `Makefile`
  - `docs/CODEX_PARALLEL_WORK_ITEMS.md`
- Concrete work items:
  - implement a non-mutating check path with non-zero exit on lock-line drift,
  - support registry-root override to simplify test harnesses,
  - cover update/check behavior with deterministic temp-dir tests.
- Acceptance:
  - `--check` exits non-zero when mirror drift exists and zero when in sync,
  - tests run locally and pass.
- Validation:
  - `python3 scripts/sync_workitem_mirror.py`
  - `python3 scripts/sync_workitem_mirror.py --check`
  - `make test-workitem-mirror`

## Remaining workstreams

### 1. iOS share extension

- Branch: `codex/ios-share-extension`
- Workitem ID: `WI-101`
- Lock: `COMPLETED | Workitem: WI-101 | Owner: N/A | Claimed: 2026-03-14T17:51:33Z | Last heartbeat: 2026-03-14T17:54:40Z`
- Goal: add the missing iOS native share-target path for the companion app.
- Scope:
  - enforce `llm/stt/tts` target sets as `mobile_bridge -> desktop_bridge -> api`,
  - enforce OCR local-only semantics in policy resolution and UI,
  - normalize route metadata returned to clients.
- Likely files:
  - `services/api/app/services/integrations_service.py`
  - `services/api/app/schemas/integrations.py`
  - `apps/web/app/integrations/page.tsx`
  - `apps/mobile/App.tsx`
- Acceptance:
  - policy targets and route metadata are consistent across API/web/mobile,
  - no legacy target labels remain in active policy resolution paths.
- Validation:
  - API tests covering policy resolution and route metadata
  - web/mobile typecheck for changed routing surfaces

### 2. Worker auth and token lifecycle hardening

- Branch: `codex/desktop-helper-macos-validation`
- Workitem ID: `WI-102`
- Lock: `COMPLETED | Workitem: WI-102 | Owner: N/A | Claimed: 2026-03-14T17:56:52Z | Last heartbeat: 2026-03-14T18:06:21Z`
- Goal: finish the remaining real macOS validation path for the desktop helper now that Linux and Windows host paths are covered.
- Scope:
  - tighten short-lived access token behavior and refresh rotation,
  - enforce capability-scoped worker sessions during claim/execute paths,
  - complete audit trail coverage for pairing, refresh, claim/complete, and revoke events.
- Likely files:
  - `services/api/app/services/worker_service.py`
  - `services/api/app/api/routes/workers.py`
  - `services/api/app/api/deps.py`
  - `services/api/app/db/storage.py`
- Acceptance:
  - invalid/expired/revoked worker sessions are rejected deterministically,
  - audit log coverage exists for the full worker session lifecycle.
- Validation:
  - API tests for pairing/refresh/heartbeat/revoke success and failure cases

### 3. Mobile + desktop secure credential storage migration

- Branch: `codex/local-tts-worker-hardening`
- Workitem ID: `WI-103`
- Lock: `HANDOFF_REVIEW | Workitem: WI-103 | Owner: N/A | Claimed: 2026-03-14T18:07:45Z | Last heartbeat: 2026-03-14T18:13:13Z`
- Goal: make the queued TTS path more reliable and easier to operate.
- Scope:
  - mobile token/secret storage via secure platform storage,
  - desktop helper token/secret storage via OS credential mechanism,
  - migration path for existing plaintext-persisted values.
- Likely files:
  - `apps/mobile/App.tsx`
  - `apps/mobile/package.json`
  - `tools/desktop-helper/src/main.js`
  - `tools/desktop-helper/src-tauri/**`
- Acceptance:
  - bearer tokens are no longer stored in plain SQLite/file config,
  - migration preserves user auth state or provides a clear one-time reset path.
- Validation:
  - mobile/desktop manual verification + targeted tests around persistence redaction

### 4. Bridge claim arbitration and routing telemetry

- Branch: `codex/bridge-claim-arbitration-telemetry`
- Workitem ID: `WI-204`
- Lock: `UNCLAIMED | Workitem: WI-204 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: ensure claim arbitration always prefers highest-available target class and exposes clear job routing telemetry.
- Scope:
  - enforce policy-priority + worker-heartbeat-aware claim arbitration,
  - persist selected target / worker class metadata for each AI job,
  - expose clear diagnostics for fallback decisions.
- Likely files:
  - `services/api/app/services/ai_jobs_service.py`
  - `services/api/tests/test_local_ai_worker.py`
  - `docs/LOCAL_AI_WORKER.md`
- Concrete work items:
  - normalize provider selection and probe results into stable job metadata,
  - add clearer timeout, retryable-failure, and terminal-failure classification,
  - improve cancel/retry handling so job lifecycle transitions remain coherent,
  - cover wrapper success/failure/timeout paths in focused tests,
  - document operator-facing debugging and recovery steps for local TTS jobs.
- Acceptance:
  - queued TTS failures are diagnosable,
  - retry/cancel semantics stay coherent,
  - provider wrappers are covered by tests.
- Validation:
  - `uv run --project services/api --extra dev pytest tests/test_local_ai_worker.py -s`
  - `uv run --project services/api --extra dev pytest tests/test_api_flows.py -s`

### 4. Native Codex first-party bridge follow-up

- Branch: `codex/native-codex-first-party-bridge`
- Workitem ID: `WI-104`
- Lock: `COMPLETED | Workitem: WI-104 | Owner: N/A | Claimed: 2026-03-14T17:33:49Z | Last heartbeat: 2026-03-14T17:42:08Z`
- Goal: replace the guarded experimental OpenAI-compatible bridge adapter with a first-party native Codex-subscription/OAuth path if the upstream contract becomes real.
- Scope:
  - inspect whether an official Codex subscription/OAuth contract exists yet,
  - keep the current experimental adapter as the safe fallback until a first-party contract is proven,
  - implement the native auth/health/execute path only if that contract is stable enough to support.
- Out of scope:
  - rewriting the AI provider model,
  - making Codex the only required provider.
- Likely files:
  - `services/api/app/services/ai_service.py`
  - `services/api/app/schemas/ai.py`
  - `services/api/app/services/integrations_service.py`
- Acceptance:
  - mobile/desktop/api fallback order is deterministic under varying worker availability,
  - job records clearly show requested-vs-selected route.
- Validation:
  - API tests simulating worker online/offline/stale scenarios

### 5. PWA offline warmup pack

- Branch: `codex/pwa-offline-cache-followups`
- Workitem ID: `WI-105`
- Lock: `HANDOFF_REVIEW | Workitem: WI-105 | Owner: N/A | Claimed: 2026-03-14T17:20:56Z | Last heartbeat: 2026-03-14T18:15:14Z`
- Goal: extend the new IndexedDB cache layer to the remaining PWA workspaces and add cache-management controls.
- Scope:
  - offline warmup action for main PWA tabs,
  - preload route data snapshots into IndexedDB caches,
  - clear user-facing warmup/sync status.
- Likely files:
  - `apps/web/app/session-provider.tsx`
  - `apps/web/app/sync-center/page.tsx`
  - `apps/web/app/lib/entity-cache.ts`
  - `apps/web/public/sw.js`
- Acceptance:
  - key tabs can open/render offline immediately after warmup,
  - warmup progress and completion state are visible in-app.
- Validation:
  - Playwright offline warmup + reload coverage

### 6. PWA offline voice capture queue

- Branch: `codex/phone-local-llm`
- Workitem ID: `WI-106`
- Lock: `COMPLETED | Workitem: WI-106 | Owner: N/A | Claimed: 2026-03-14T17:44:31Z | Last heartbeat: 2026-03-14T17:50:16Z`
- Goal: explore and land the first viable phone-local LLM execution path behind the shared policy model.
- Scope:
  - persist recorded media blobs locally,
  - queue upload/transcribe jobs when offline,
  - replay and status surfaces when back online.
- Likely files:
  - `apps/web/app/assistant/page.tsx`
  - `apps/web/app/lib/mutation-outbox.ts`
  - `apps/web/app/session-provider.tsx`
  - `apps/web/app/lib/entity-cache.ts`
- Acceptance:
  - offline voice captures survive reload and replay on reconnect,
  - queue and replay state are visible to the user.
- Validation:
  - Playwright coverage for offline voice capture and reconnect replay

### 7. Revisioned conflict lifecycle and merged patch UX

- Branch: `codex/revision-conflict-lifecycle`
- Workitem ID: `WI-207`
- Lock: `UNCLAIMED | Workitem: WI-207 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: enforce revision/base-revision conflict defensibility and align UI resolution actions to `local_wins`, `remote_wins`, `merged_patch`.
- Scope:
  - enforce optimistic concurrency checks on mutation paths,
  - return structured conflicts on revision mismatch,
  - replace any stale `dismiss` UI/action path with `merged_patch` flow.
- Likely files:
  - `services/api/app/services/conflict_service.py`
  - `services/api/app/schemas/conflicts.py`
  - `services/api/app/api/routes/conflicts.py`
  - `apps/web/app/planner/page.tsx`
  - `apps/web/app/calendar/page.tsx`
- Acceptance:
  - conflicts are explicit and resolvable with the three planned strategies,
  - UI/API strategy labels are consistent end-to-end.
- Validation:
  - API conflict tests + planner/calendar UI resolution regression checks

### 8. Shared lock registry hardening and parity checks

- Branch: `codex/shared-lock-registry-hardening`
- Workitem ID: `WI-208`
- Lock: `UNCLAIMED | Workitem: WI-208 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: harden `.git` shared lock operations for concurrency, stale-reclaim, and audit integrity.
- Scope:
  - add tests around concurrent claim behavior and stale lock reclaim,
  - ensure CLI payload/schema matches AGENTS lock metadata requirements,
  - add guardrails for registry drift between `workitems.json`, lock files, and audit log.
- Likely files:
  - `scripts/workitem_lock.py`
  - `AGENTS.md`
  - `docs/CODEX_PARALLEL_WORK_ITEMS.md`
- Acceptance:
  - lock lifecycle commands are deterministic under concurrency,
  - status outputs and stored metadata are consistent with documented protocol.
- Validation:
  - scripted claim/heartbeat/release/force-steal race checks in a shared worktree setup

### 9. Screen-design contract conformance pass

- Branch: `codex/screen-design-contract-conformance`
- Workitem ID: `WI-209`
- Lock: `UNCLAIMED | Workitem: WI-209 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: align newly added architecture features with the `screen_design` IA and visual contract.
- Scope:
  - ensure offline queue/conflict/worker status surfaces live inside canonical screens,
  - remove style-divergent UI additions where they drift from `screen_design`,
  - document mapping of each new capability to its canonical UI surface.
- Likely files:
  - `apps/web/app/**`
  - `apps/mobile/App.tsx`
  - `docs/STARLOG_ARCHITECTURE_WORKFLOW_PLAN.md`
  - `docs/IMPLEMENTATION_STATUS.md`
- Acceptance:
  - new architecture features are represented as extensions of canonical surfaces,
  - no major surface introduces conflicting IA/visual language.
- Validation:
  - visual/manual regression pass against `screen_design` references

### 10. HTTPS-only worker transport enforcement

- Branch: `codex/worker-https-enforcement`
- Workitem ID: `WI-210`
- Lock: `UNCLAIMED | Workitem: WI-210 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: enforce HTTPS-only worker/API transport in non-local modes with explicit localhost dev exceptions.
- Scope:
  - harden secure transport checks for worker auth/pairing/heartbeat paths,
  - block insecure worker traffic outside local development contexts,
  - add clear API error messages for rejected insecure transport.
- Likely files:
  - `services/api/app/api/deps.py`
  - `services/api/app/api/routes/workers.py`
  - `services/api/tests/test_api_flows.py`
- Acceptance:
  - production-like mode rejects non-HTTPS worker auth flows,
  - localhost dev loop remains functional with explicit exception handling.
- Validation:
  - API tests covering HTTPS-required and localhost-allowed cases

### 11. Secrets redaction and at-rest protection sweep

- Branch: `codex/secrets-redaction-sweep`
- Workitem ID: `WI-211`
- Lock: `UNCLAIMED | Workitem: WI-211 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: ensure provider keys and worker/session secrets stay encrypted at rest and redacted in all responses/logs.
- Scope:
  - verify and tighten encryption/redaction paths for integration/provider configs,
  - audit worker/session artifacts for accidental sensitive-field leakage,
  - extend tests for log/response redaction boundaries.
- Likely files:
  - `services/api/app/services/integrations_service.py`
  - `services/api/app/services/worker_service.py`
  - `services/api/tests/test_api_flows.py`
  - `docs/IMPLEMENTATION_STATUS.md`
- Acceptance:
  - no sensitive tokens/keys appear unredacted in API/UI-facing payloads or diagnostics,
  - at-rest storage for sensitive config remains encrypted/hashed consistently.
- Validation:
  - targeted API tests and log/response redaction checks

### 12. Worker control plane UI and operations

- Branch: `codex/worker-control-plane-ui`
- Workitem ID: `WI-212`
- Lock: `UNCLAIMED | Workitem: WI-212 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: expose pairing/session/revocation operations and worker heartbeat health in a first-class PWA surface.
- Scope:
  - add worker list/status/revocation workflows to integrations or sync-center surfaces,
  - expose pairing token lifecycle controls with safe display/expiry behavior,
  - show worker heartbeat recency and capability-class visibility for routing ops.
- Likely files:
  - `apps/web/app/integrations/page.tsx`
  - `apps/web/app/sync-center/page.tsx`
  - `services/api/app/api/routes/workers.py`
  - `services/api/app/schemas/workers.py`
- Acceptance:
  - operators can inspect and revoke worker sessions without direct API calls,
  - worker availability state is visible where routing/triage decisions are made.
- Validation:
  - web lint/typecheck + API integration checks for worker UI flows

### 13. Offline review queue reliability

- Branch: `codex/offline-review-queue-reliability`
- Workitem ID: `WI-213`
- Lock: `UNCLAIMED | Workitem: WI-213 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: harden offline review-submission queueing and replay semantics (beyond current generic mutation outbox behavior).
- Scope:
  - persist and replay review submissions with explicit duplicate/idempotency protections,
  - surface per-review replay outcomes in sync/review UI,
  - verify queue integrity across reloads and offline/online flaps.
- Likely files:
  - `apps/web/app/review/page.tsx`
  - `apps/web/app/session-provider.tsx`
  - `apps/web/app/lib/mutation-outbox.ts`
  - `services/api/app/api/routes/reviews.py`
- Acceptance:
  - offline review events replay correctly and once,
  - users can see replay success/failure per queued review.
- Validation:
  - Playwright offline review queue + reconnect tests

### 14. Conflict audit timeline and merged-patch tooling

- Branch: `codex/conflict-audit-timeline`
- Workitem ID: `WI-214`
- Lock: `UNCLAIMED | Workitem: WI-214 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: expose conflict mutation history and a practical merged-patch authoring/resolution flow.
- Scope:
  - add conflict history/audit timeline view with mutation context,
  - add merged-patch authoring support in UI and API payload handling,
  - keep resolution outcomes traceable for later sync diagnostics.
- Likely files:
  - `services/api/app/services/conflict_service.py`
  - `services/api/app/schemas/conflicts.py`
  - `apps/web/app/planner/page.tsx`
  - `apps/web/app/calendar/page.tsx`
- Acceptance:
  - conflicts show actionable history and support merged-patch resolution,
  - resolution audit data is queryable and human-readable.
- Validation:
  - API conflict tests + planner/calendar conflict-UX regression checks

### 15. Architecture regression harness

- Branch: `codex/architecture-regression-harness`
- Workitem ID: `WI-215`
- Lock: `UNCLAIMED | Workitem: WI-215 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: codify the architecture plan test matrix into repeatable automated checks.
- Scope:
  - add coverage slices for security, routing priority, offline warmup/queues, conflict lifecycle, and lock tooling,
  - provide a single documented command matrix for supervisor validation,
  - include deterministic pass/fail reporting for handoff and merge gating.
- Likely files:
  - `services/api/tests/test_api_flows.py`
  - `apps/web/tests/offline-cache.spec.ts`
  - `scripts/workitem_lock.py`
  - `docs/STARLOG_ARCHITECTURE_WORKFLOW_PLAN.md`
  - `docs/IMPLEMENTATION_STATUS.md`
- Acceptance:
  - architecture-critical regressions are covered by repeatable checks,
  - validation commands are documented and usable by parallel agents.
- Validation:
  - API + Playwright + lock-tooling checks wired into a documented runbook

### 7. PWA cache eviction policy follow-up

- Branch: `codex/pwa-cache-eviction-policy-b`
- Workitem ID: `WI-107`
- Lock: `HANDOFF_REVIEW | Workitem: WI-107 | Owner: N/A | Claimed: 2026-03-14T18:20:57Z | Last heartbeat: 2026-03-14T18:35:37Z`
- Goal: add per-prefix cache eviction actions and quota-pressure guidance on top of the existing local cache model.
- Scope:
  - add utility APIs for cache scope summaries and targeted/all-record eviction,
  - expose cache policy controls in the shared session controls UI,
  - provide user-visible quota-pressure guidance from browser storage estimates.
- Out of scope:
  - redesigning PWA workspace layouts,
  - replacing IndexedDB with a different cache backend.
- Likely files:
  - `apps/web/app/lib/entity-cache.ts`
  - `apps/web/app/lib/entity-snapshot.ts`
  - `apps/web/app/components/session-controls.tsx`
  - `docs/IMPLEMENTATION_STATUS.md`
- Concrete work items:
  - add entity cache scope summary and scope/all clear APIs,
  - add snapshot summary, prefix clear, and full clear APIs,
  - add UI controls for evicting a selected prefix, clearing stale markers, and clearing all cache data,
  - add quota-pressure status text (`healthy`/`elevated`/`critical`) from `navigator.storage.estimate`.
- Acceptance:
  - selected cache prefixes can be cleared without full cache reset,
  - users can inspect storage pressure and stale markers before evicting,
  - existing PWA offline cache tests remain green.
- Validation:
  - `pnpm --filter web exec tsc --noEmit`
  - `pnpm --filter web lint`
  - `pnpm test:web:offline-cache`

### 7. Mobile secure token storage

- Branch: `codex/phone-local-llm`
- Workitem ID: `WI-106`
- Lock: `COMPLETED | Workitem: WI-106 | Owner: N/A | Claimed: 2026-03-14T17:44:31Z | Last heartbeat: 2026-03-14T17:50:16Z`
- Goal: explore and land the first viable phone-local LLM execution path behind the shared policy model.
- Scope:
  - add a secure token storage abstraction in the mobile companion,
  - migrate legacy persisted tokens into secure storage on startup,
  - stop writing bearer token values into SQLite/file-backed persisted app state.
- Out of scope:
  - changing API auth protocol/token format,
  - desktop secure storage migration.
- Likely files:
  - `apps/mobile/App.tsx`
  - `apps/mobile/package.json`
  - `AGENTS.md`
- Concrete work items:
  - wire `expo-secure-store` read/write helpers for mobile bearer token storage,
  - keep backward compatibility by migrating existing persisted plaintext token once,
  - sanitize persisted state writes so `token` is no longer stored in SQLite payloads,
  - document the migration/security caveats in `AGENTS.md`.
- Acceptance:
  - mobile app restores/stores token via secure storage,
  - persisted app state no longer contains bearer token values.
- Validation:
  - `pnpm --filter mobile exec tsc --noEmit`
  - `cd services/api && uv run --project . --extra dev pytest tests/test_api_flows.py -s`

### 7. PWA automatic cache retention policy

- Branch: `codex/pwa-cache-retention-policy-b`
- Workitem ID: `WI-109`
- Lock: `HANDOFF_REVIEW | Workitem: WI-109 | Owner: N/A | Claimed: 2026-03-14T18:36:40Z | Last heartbeat: 2026-03-14T18:54:25Z`
- Goal: proactively prune cache records by prefix/scope retention rules instead of relying only on manual clears.
- Scope:
  - add per-scope IndexedDB entity retention caps with pressure-aware tightening,
  - add per-prefix snapshot max-record and max-age pruning with pressure-aware tightening,
  - run retention automatically on writes and expose explicit sweep controls in the shared session controls UI.
- Out of scope:
  - changing cache data models,
  - replacing IndexedDB with another storage backend.
- Likely files:
  - `apps/web/app/lib/entity-cache.ts`
  - `apps/web/app/lib/entity-snapshot.ts`
  - `apps/web/app/components/session-controls.tsx`
  - `docs/IMPLEMENTATION_STATUS.md`
- Concrete work items:
  - add scope/prefix retention policy maps and pressure-based limit multipliers,
  - enforce retention in background after cache writes,
  - expose manual retention sweep controls/status for operators,
  - confirm offline cache tests remain stable.
- Acceptance:
  - cache writes trigger automatic retention pruning by policy,
  - retention behavior can be triggered manually from the PWA session controls,
  - web typecheck/lint and offline cache tests pass.
- Validation:
  - `pnpm --filter web exec tsc --noEmit`
  - `pnpm --filter web lint`
  - `pnpm test:web:offline-cache`

### 7. Lock mirror automation

- Branch: `codex/workitem-mirror-sync-b`
- Workitem ID: `WI-110`
- Lock: `HANDOFF_REVIEW | Workitem: WI-110 | Owner: N/A | Claimed: 2026-03-14T18:55:13Z | Last heartbeat: 2026-03-14T18:56:52Z`
- Goal: keep this doc's `Lock:` mirror lines aligned with shared `.git` registry state automatically.
- Scope:
  - add a script that reads shared registry lock/workitem state and rewrites `Lock:` lines in this doc,
  - keep formatting deterministic so repeated runs are idempotent,
  - document the helper command in the lock workflow section.
- Out of scope:
  - replacing the authoritative `.git` lock registry,
  - changing lock claim/release semantics.
- Likely files:
  - `scripts/sync_workitem_mirror.py`
  - `docs/CODEX_PARALLEL_WORK_ITEMS.md`
- Concrete work items:
  - parse lock lines by workitem id and update state/owner/timestamps from registry,
  - support active lock, handoff, completed, open, and unclaimed states,
  - run the helper once so existing mirror lines are refreshed in this branch.
- Acceptance:
  - one command updates all `Lock:` lines from shared registry truth,
  - command is safe to rerun and produces stable output.
- Validation:
  - `python3 scripts/sync_workitem_mirror.py`

### 7. Desktop helper secure token storage

- Branch: `codex/desktop-helper-secure-token`
- Workitem ID: `WI-111`
- Lock: `HANDOFF in shared registry (no active lock); released 2026-03-14 with note: PR #26 opened`
- Goal: move desktop helper bearer-token persistence from plaintext localStorage to OS secure storage in Tauri runtime.
- Scope:
  - add Tauri secure-token commands backed by OS keyring/credential store,
  - migrate legacy localStorage token into secure storage on first launch in Tauri,
  - keep browser-only fallback behavior for non-Tauri helper tests/runs.
- Out of scope:
  - API auth protocol changes,
  - redesigning helper capture UI.
- Likely files:
  - `tools/desktop-helper/src/main.js`
  - `tools/desktop-helper/src-tauri/src/main.rs`
  - `tools/desktop-helper/src-tauri/Cargo.toml`
  - `tools/desktop-helper/README.md`
  - `AGENTS.md`
- Concrete work items:
  - wire `get_secure_token` / `set_secure_token` Tauri commands,
  - update helper config persistence so Tauri no longer writes bearer token to localStorage,
  - migrate existing localStorage token into secure storage once and redact local config afterwards,
  - keep browser-runtime tests green with the existing local-storage token fallback outside Tauri.
- Acceptance:
  - Tauri runtime stores token in OS secure storage, not localStorage,
  - helper still restores API base and retains expected browser fallback behavior.
- Validation:
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts`
  - `cd tools/desktop-helper/src-tauri && cargo check`

### 7. PWA cache snapshots for planner/integrations/sync center

- Branch: `codex/pwa-cache-synccenter-followup-b`
- Workitem ID: `WI-114`
- Lock: `HANDOFF_REVIEW | Workitem: WI-114 | Owner: N/A | Claimed: 2026-03-14T19:05:52Z | Last heartbeat: 2026-03-14T19:21:05Z`
- Goal: extend IndexedDB/local snapshot coverage to planner, integrations, and sync-center views so these pages remain useful after offline reload.
- Scope:
  - add snapshot keys and local bootstrap for planner timelines, integration/provider state, and sync-center history/cursor,
  - persist successful refresh results and restore from cache before network loads,
  - keep stale marking aligned with existing replay/invalidation behavior.
- Out of scope:
  - replacing existing cache primitives,
  - redesigning these pages.
- Likely files:
  - `apps/web/app/planner/page.tsx`
  - `apps/web/app/integrations/page.tsx`
  - `apps/web/app/sync-center/page.tsx`
  - `apps/web/app/lib/entity-cache.ts`
  - `apps/web/app/lib/entity-snapshot.ts`
  - `docs/IMPLEMENTATION_STATUS.md`
- Concrete work items:
  - define stable snapshot keys for planner/integrations/sync-center state,
  - hydrate state from snapshots on boot and async restore,
  - write snapshots on successful loads/mutations,
  - ensure sync-center pull cursor/history are retained across reloads.
- Acceptance:
  - planner, integrations, and sync-center show cached data on offline reload when prior data exists,
  - pages continue to refresh correctly when back online.
- Validation:
  - `pnpm --filter web exec tsc --noEmit`
  - `pnpm --filter web lint`
  - `pnpm test:web:offline-cache`

### 7. PWA offline voice capture replay queue

- Branch: `codex/pwa-offline-voice-queue`
- Workitem ID: `WI-113`
- Lock: `HANDOFF in shared registry (no active lock); released 2026-03-14 with note: PR #29 opened`
- Goal: persist captured assistant voice clips locally and replay uploads after reconnect.
- Scope:
  - store assistant voice upload queue entries with media blobs in IndexedDB-backed snapshots,
  - add explicit queue visibility and replay controls in the assistant tab,
  - auto-replay queued uploads when online/token are available.
- Out of scope:
  - changing assistant server-side job contracts,
  - redesigning assistant UI structure outside the existing screen design language.
- Likely files:
  - `apps/web/app/assistant/page.tsx`
  - `apps/web/tests/assistant-voice-queue.spec.ts`
  - `docs/IMPLEMENTATION_STATUS.md`
  - `AGENTS.md`
- Concrete work items:
  - queue voice uploads instead of dropping offline/unauthenticated captures,
  - persist queue entries with blob payloads in IndexedDB (not localStorage bootstrap),
  - add manual retry/drop controls plus queue status copy,
  - add Playwright coverage for queued replay.
- Acceptance:
  - voice captures made offline are not lost and can be replayed later,
  - assistant tab clearly shows queued voice upload state.
- Validation:
  - `pnpm test:web:offline-cache --grep "assistant voice uploads"`

### 7. PWA offline warmup flow

- Branch: `codex/pwa-offline-warmup-flow`
- Workitem ID: `WI-116`
- Lock: `HANDOFF in shared registry (no active lock); released 2026-03-14 with note: PR #32 opened`
- Goal: add an explicit “Offline Warmup” action that preloads route snapshots before the user goes offline.
- Scope:
  - add a warmup action in Sync Center,
  - preload key route snapshots (artifacts, notes, tasks, calendar, assistant jobs/intents),
  - expose per-step warmup status and failure visibility.
- Out of scope:
  - replacing service-worker shell caching,
  - redesigning sync-center layout.
- Likely files:
  - `apps/web/app/lib/offline-warmup.ts`
  - `apps/web/app/sync-center/page.tsx`
  - `apps/web/tests/offline-cache.spec.ts`
  - `docs/IMPLEMENTATION_STATUS.md`
  - `AGENTS.md`
- Concrete work items:
  - implement reusable warmup runner that writes snapshot keys used by offline-first tabs,
  - add Sync Center “Offline Warmup” CTA + report panel,
  - add browser coverage proving warmup allows opening Notes offline without loading Notes online first.
- Acceptance:
  - users can run a single warmup action before losing connectivity,
  - warmup updates snapshots and reports which step(s) succeeded/failed.
- Validation:
  - `./node_modules/.bin/playwright test --config=/tmp/playwright.web.noserver.config.ts apps/web/tests/offline-cache.spec.ts --grep "offline warmup"`
  - `cd apps/web && ./node_modules/.bin/tsc --noEmit`

### 7. Note revision-conflict enforcement

- Branch: `codex/note-revision-conflict-api`
- Workitem ID: `WI-117`
- Lock: `HANDOFF in shared registry (no active lock); released 2026-03-14 with note: PR #33 opened`
- Goal: enforce structured revision-conflict handling for note updates and harden conflict-resolution payload validation.
- Scope:
  - allow note update requests to carry `base_revision`,
  - emit structured `409` revision conflict responses when stale revisions are submitted,
  - enforce `merged_patch` payload requirements on conflict resolution endpoint,
  - add API tests for conflict create/list/get/resolve flow.
- Out of scope:
  - full optimistic-concurrency rollout across every entity type,
  - UI conflict resolution tooling.
- Likely files:
  - `services/api/app/schemas/notes.py`
  - `services/api/app/services/notes_service.py`
  - `services/api/app/api/routes/notes.py`
  - `services/api/app/schemas/conflicts.py`
  - `services/api/tests/test_api_flows.py`
  - `docs/IMPLEMENTATION_STATUS.md`
  - `AGENTS.md`
- Concrete work items:
  - add `base_revision` to note updates,
  - create and return `entity_conflicts` records on mismatch,
  - validate `merged_patch` requires `merged_payload`, and other strategies reject it,
  - test stale write -> conflict -> resolution path.
- Acceptance:
  - stale note write is rejected with structured conflict payload,
  - conflict APIs enforce explicit resolution payload semantics.
- Validation:
  - `uv run --project services/api --extra dev pytest tests/test_api_flows.py -k \"revision_conflict\" -s`

### 7. Task revision-conflict enforcement

- Branch: `codex/task-revision-conflict-api`
- Workitem ID: `WI-118`
- Lock: `HANDOFF in shared registry (no active lock); released 2026-03-14 with note: PR #34 opened`
- Goal: enforce structured revision-conflict handling for task updates using the existing `tasks.revision` column.
- Scope:
  - allow task update requests to carry `base_revision`,
  - reject stale task writes with structured `409 revision_conflict` payloads,
  - persist task conflicts into `entity_conflicts`,
  - add API tests for stale write and explicit resolution flow.
- Out of scope:
  - UI conflict tooling,
  - full conflict rollout for all entity types.
- Likely files:
  - `services/api/app/schemas/tasks.py`
  - `services/api/app/services/tasks_service.py`
  - `services/api/app/api/routes/tasks.py`
  - `services/api/tests/test_api_flows.py`
  - `docs/IMPLEMENTATION_STATUS.md`
  - `AGENTS.md`
- Concrete work items:
  - add `base_revision` in task update schema and expose `revision` in task responses,
  - compare `base_revision` against current task revision in service layer,
  - create conflict row and return structured `409` on mismatch,
  - verify conflict list + resolve path in tests.
- Acceptance:
  - stale task updates are rejected with conflict metadata (no silent overwrite),
  - resolution flow remains explicit via `/v1/conflicts`.
- Validation:
  - `uv run --project services/api --extra dev pytest tests/test_api_flows.py -k \"task_revision_conflict\" -s`
  - `uv run --project services/api --extra dev pytest tests/test_api_flows.py -k \"notes_edit_and_search or task_revision_conflict\" -s`

### 7. Calendar event revision-conflict enforcement

- Branch: `codex/calendar-revision-conflict-api`
- Workitem ID: `WI-119`
- Lock: `HELD in shared registry (.git/codex-workitems/locks/WI-119.lock); this document is a mirror only`
- Goal: enforce structured revision-conflict handling for calendar event updates using the existing `calendar_events.revision` column.
- Scope:
  - allow calendar event update requests to carry `base_revision`,
  - reject stale calendar writes with structured `409 revision_conflict` payloads,
  - persist calendar conflicts into `entity_conflicts`,
  - add API tests for stale write and explicit resolution flow.
- Out of scope:
  - UI conflict tooling,
  - full conflict rollout for all entity types.
- Likely files:
  - `services/api/app/schemas/calendar.py`
  - `services/api/app/services/calendar_service.py`
  - `services/api/app/api/routes/calendar.py`
  - `services/api/tests/test_api_flows.py`
  - `docs/IMPLEMENTATION_STATUS.md`
  - `AGENTS.md`
- Concrete work items:
  - add `base_revision` in calendar update schema and expose `revision` in calendar responses,
  - compare `base_revision` against current calendar revision in service layer,
  - create conflict row and return structured `409` on mismatch,
  - verify conflict list + resolve path in tests.
- Acceptance:
  - stale calendar event updates are rejected with conflict metadata (no silent overwrite),
  - resolution flow remains explicit via `/v1/conflicts`.
- Validation:
  - `uv run --project services/api --extra dev pytest services/api/tests/test_api_flows.py -k "calendar_event_revision_conflict" -s`
  - `uv run --project services/api --extra dev pytest services/api/tests/test_api_flows.py -k "review_calendar_briefing_export or calendar_event_revision_conflict" -s`

## Suggested execution order

- Start immediately:
  - `WI-201` execution policy convergence
  - `WI-202` worker auth and token lifecycle hardening
  - `WI-205` PWA offline warmup pack
  - `WI-207` revisioned conflict lifecycle
- Start after foundational APIs stabilize:
  - `WI-203` client secure storage migration
  - `WI-204` bridge claim arbitration and routing telemetry
  - `WI-206` PWA offline voice queue
  - `WI-210` HTTPS-only worker transport enforcement
  - `WI-211` secrets redaction and at-rest protection sweep
  - `WI-212` worker control plane UI and operations
  - `WI-213` offline review queue reliability
  - `WI-214` conflict audit timeline and merged-patch tooling
- Run as platform-governance follow-ups:
  - `WI-208` shared lock registry hardening
  - `WI-209` screen-design contract conformance
  - `WI-215` architecture regression harness

## Supervisor dispatch list (2026-03-14)

- `WI-101` (`codex/ios-share-extension`): ship iOS share-extension capture into quick-capture drafts with Android regression safety.
- `WI-102` (`codex/desktop-helper-macos-validation`): validate macOS clipboard/screenshot/window paths and tighten permission diagnostics.
- `WI-103` (`codex/local-tts-worker-hardening`): harden queued TTS timeout/retry/cancel lifecycle plus worker/API tests.
- `WI-104` (`codex/native-codex-first-party-bridge`): verify first-party Codex bridge viability and either implement guarded path or document boundary.
- `WI-105` (`codex/pwa-offline-cache-followups`): extend IndexedDB caching to remaining PWA workspaces with cache inspection/clear controls.
- `WI-106` (`codex/phone-local-llm`): implement or bound the first practical phone-local LLM routing path with policy diagnostics.
- `WI-119` (`codex/calendar-revision-conflict-api`): enforce calendar stale-write conflicts with `base_revision` + explicit `/v1/conflicts` resolution.
