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

- Branch: `codex/execution-policy-bridge-convergence`
- Workitem ID: `WI-201`
- Lock: `UNCLAIMED | Workitem: WI-201 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: converge capability routing to the new policy model and remove remaining legacy target drift.
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

- Branch: `codex/worker-auth-lifecycle-hardening`
- Workitem ID: `WI-202`
- Lock: `UNCLAIMED | Workitem: WI-202 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: harden worker pairing/auth/refresh/revoke semantics to match the security model.
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

- Branch: `codex/client-secure-storage-migration`
- Workitem ID: `WI-203`
- Lock: `UNCLAIMED | Workitem: WI-203 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: move client-side tokens/secrets out of plain persisted state into OS secure storage.
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

- Branch: `codex/pwa-offline-voice-queue`
- Workitem ID: `WI-206`
- Lock: `UNCLAIMED | Workitem: WI-206 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: add browser-side offline voice capture queueing with reconnect upload/transcription replay.
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

### 7. Worker transport HTTPS enforcement

- Branch: `codex/worker-transport-https-enforcement`
- Workitem ID: `WI-108`
- Lock: `HANDOFF (released) in shared registry; this document is a mirror only`
- Goal: enforce worker endpoint transport security in production while keeping Railway/proxy deployments functional.
- Scope:
  - make secure transport checks proxy-aware for HTTPS-terminated deployments,
  - keep localhost HTTP allowed for local development workflows,
  - add focused tests for worker transport behavior in production mode.
- Out of scope:
  - changing non-worker endpoint auth model,
  - infrastructure/network policy changes outside app logic.
- Likely files:
  - `services/api/app/api/deps.py`
  - `services/api/tests/test_api_flows.py` or a dedicated API test module
  - `AGENTS.md`
- Concrete work items:
  - normalize transport checks to consider proxy-forwarded scheme metadata where appropriate,
  - ensure production rejects non-HTTPS worker calls outside localhost,
  - add regression tests for blocked insecure requests and allowed proxied-HTTPS requests,
  - document any discovered proxy/security caveats in `AGENTS.md`.
- Acceptance:
  - production-mode worker endpoints enforce HTTPS semantics correctly,
  - proxied HTTPS requests are not falsely rejected,
  - test coverage verifies both reject and allow paths.
- Validation:
  - `uv run --project services/api --extra dev pytest tests/test_api_flows.py -s`
  - `uv run --project services/api ruff check services/api`
  - `uv run --project services/api mypy services/api/app`

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
- Run as platform-governance follow-ups:
  - `WI-208` shared lock registry hardening
  - `WI-209` screen-design contract conformance

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
