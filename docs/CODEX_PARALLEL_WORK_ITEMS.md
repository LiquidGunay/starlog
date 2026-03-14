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
- Keep each `Lock:` line below updated as a readable mirror after claim/heartbeat/release.

## Active workstreams (new-plan aligned)

### 1. Execution policy convergence

## Remaining workstreams

### 1. iOS share extension

- Branch: `codex/ios-share-extension`
- Workitem ID: `WI-101`
- Lock: `UNCLAIMED | Workitem: WI-101 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
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
- Lock: `UNCLAIMED | Workitem: WI-102 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
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
- Lock: `UNCLAIMED | Workitem: WI-103 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
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
- Lock: `UNCLAIMED | Workitem: WI-104 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
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

- Branch: `codex/pwa-offline-warmup-pack`
- Workitem ID: `WI-205`
- Lock: `UNCLAIMED | Workitem: WI-205 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: add an explicit offline warmup flow that preloads critical route bundles and snapshots.
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
- Lock: `UNCLAIMED | Workitem: WI-106 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
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

- `WI-201` (`codex/execution-policy-bridge-convergence`)
- `WI-202` (`codex/worker-auth-lifecycle-hardening`)
- `WI-203` (`codex/client-secure-storage-migration`)
- `WI-204` (`codex/bridge-claim-arbitration-telemetry`)
- `WI-205` (`codex/pwa-offline-warmup-pack`)
- `WI-206` (`codex/pwa-offline-voice-queue`)
- `WI-207` (`codex/revision-conflict-lifecycle`)
- `WI-208` (`codex/shared-lock-registry-hardening`)
- `WI-209` (`codex/screen-design-contract-conformance`)
- `WI-210` (`codex/worker-https-enforcement`)
- `WI-211` (`codex/secrets-redaction-sweep`)
- `WI-212` (`codex/worker-control-plane-ui`)
- `WI-213` (`codex/offline-review-queue-reliability`)
- `WI-214` (`codex/conflict-audit-timeline`)
- `WI-215` (`codex/architecture-regression-harness`)
