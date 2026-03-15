# Codex Parallel Work Items

Base code baseline after landing the current PR set: `0adba3a` on `master`.

Purpose: break the remaining implementation targets into independent workstreams so multiple Codex runs can keep making progress without stepping on each other.

## Landed on `master`

- `codex/desktop-helper-runtime-validation`
  - Added runtime diagnostics, browser-clipboard fallback, tighter screenshot cleanup, and better helper coverage/docs.
- `codex/pwa-offline-cache`
  - Landed IndexedDB-backed entity caches, offline detail/search improvements, service-worker shell caching, and Playwright offline coverage.
- `codex/android-native-validation`
  - Hardened Android smoke tooling/docs, added a Windows-host fallback runner, and documented fresh-worktree env setup for native validation.
- `codex/native-codex-bridge`
  - Added the guarded experimental Codex bridge adapter contract, explicit opt-in/health handling, fallback behavior, and API/UI coverage around that boundary.
- `codex/desktop-helper-host-matrix`
  - Extended the helper validation matrix with real Windows PowerShell host checks, fixed the Windows active-window probe, and tightened host-specific diagnostics/docs.
- `codex/phone-local-stt`
  - Added an Android `SpeechRecognizer` local STT route with capability probing, mobile integration, and queued Whisper fallback when on-device STT is unavailable.

## Working rules

- Create each new workstream from `master` at `0adba3a` or a newer fast-forward of it.
- Keep branch names under the required `codex/` prefix.
- Prefer rebasing onto `master` instead of merging other Codex branches together.
- Do not stack Codex branches unless the dependency is explicit and recorded in this file first.
- Do not add commits to a branch/PR that is already merged; create a new `codex/*` branch from current `master` and open a new PR.
- Do not deploy from these branches without explicit user approval.
- Update `AGENTS.md` with any new blocker or user preference discovered in the branch.
- Every branch should leave behind:
  - code changes,
  - docs updates for the changed workflow,
  - validation notes or commands that were actually run.

## Claiming and locks

- Live lock authority is the shared `.git` registry under `$(git rev-parse --git-common-dir)/codex-workitems/`; this file is a human-readable mirror only.
- Before starting work, pick exactly one workstream whose `Lock:` line starts with `UNCLAIMED`.
- Each workstream has a required `Workitem ID`; every lock entry must include both `Workitem ID` and `Owner: Agent <name-or-id>`.
- Claim the workitem in the shared registry (not in this file) using:
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent>`
- While actively working, heartbeat every 2 minutes:
  - `python3 scripts/workitem_lock.py heartbeat --workitem-id <id> --agent-id <agent>`
- On completion or handoff, release the shared lock:
  - `python3 scripts/workitem_lock.py release --workitem-id <id> --agent-id <agent> --status completed`
- Forced steal is allowed only for stale locks and must include explicit reason:
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent> --force-steal --reason "<reason>"`
- Keep the `Lock:` lines in this file updated as a readable mirror for humans after claim/heartbeat/release operations.

### Timeout/check rationale

- A `2 minute` heartbeat gives fast visibility into active ownership without heavy coordination overhead.
- A `10 minute` timeout tolerates short test/build pauses while quickly recovering from crashed or abandoned agent sessions.

## Remaining workstreams

### 1. iOS share extension

- Branch: `codex/ios-share-extension`
- Workitem ID: `WI-101`
- Lock: `UNCLAIMED | Workitem: WI-101 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: add the missing iOS native share-target path for the companion app.
- Scope:
  - implement the iOS share-extension/config-plugin/native plumbing,
  - land shared text/URL capture into Starlog quick capture,
  - keep the existing Android native-share path working.
- Out of scope:
  - new Android-native validation tooling,
  - phone-local LLM execution work.
- Likely files:
  - `apps/mobile/app.config.js`
  - `apps/mobile/App.tsx`
  - `apps/mobile/ios/**` or related plugin files
  - `docs/PHONE_SETUP.md`
- Concrete work items:
  - choose and wire the iOS share-extension/config-plugin path that fits the current Expo/native setup,
  - map incoming iOS shared text/URL payloads into the same quick-capture draft path used on Android,
  - make app launch/resume handling idempotent so repeated share callbacks do not duplicate drafts,
  - regression-check that Android share-intent plumbing still works after any shared mobile-state changes,
  - document the exact local build/run/manual-test steps for iOS share validation.
- Acceptance:
  - iOS dev build compiles,
  - a shared text or URL payload lands in-app,
  - docs explain the required local build/run flow.
- Validation:
  - `pnpm --filter mobile exec tsc --noEmit`
  - `pnpm --filter mobile ios` or equivalent Xcode/dev-build flow

### 2. Desktop helper macOS validation

- Branch: `codex/desktop-helper-macos-validation`
- Workitem ID: `WI-102`
- Lock: `UNCLAIMED | Workitem: WI-102 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: finish the remaining real macOS validation path for the desktop helper now that Linux and Windows host paths are covered.
- Scope:
  - validate clipboard, screenshot, active-window, OCR, and shortcut behavior on a real macOS host,
  - tighten macOS-specific diagnostics and permission guidance where Screen Recording/Accessibility checks are still assumed,
  - keep the current Linux and Windows paths green.
- Out of scope:
  - turning the helper into a full desktop workspace,
  - major UI redesign.
- Likely files:
  - `tools/desktop-helper/src/main.js`
  - `tools/desktop-helper/src-tauri/src/main.rs`
  - `tools/desktop-helper/tests/helper.spec.ts`
  - `tools/desktop-helper/README.md`
- Concrete work items:
  - validate the current `pbpaste`, `screencapture -i`, and `osascript` paths on a real macOS desktop session,
  - capture missing Screen Recording / Accessibility / clipboard permission failure modes and turn them into actionable diagnostics,
  - add or update tests for any fallback or error messaging that changes while fixing the macOS path,
  - expand the README with the validated macOS matrix and troubleshooting steps.
- Acceptance:
  - macOS is validated end to end,
  - docs include a full Linux/macOS/Windows validation matrix,
  - diagnostics map failures to actionable setup fixes.
- Validation:
  - `pnpm test:desktop-helper`
  - `cd tools/desktop-helper/src-tauri && cargo check`
  - `pnpm --filter starlog-desktop-helper build`

### 3. Local TTS worker hardening

- Branch: `codex/local-tts-worker-hardening`
- Workitem ID: `WI-103`
- Lock: `RELEASED | Workitem: WI-103 | Owner: Agent Implementer-A | Released: 2026-03-14 17:32 UTC | Reason: PR #14 opened (handoff to review)`
- Goal: make the queued TTS path more reliable and easier to operate.
- Scope:
  - improve provider detection, timeouts, retries, and job metadata,
  - make failure reporting and recovery clearer,
  - deepen tests around the local wrapper providers.
- Out of scope:
  - phone-local on-device TTS playback, which already exists.
- Likely files:
  - `scripts/local_ai_worker.py`
  - `services/api/app/api/routes/ai.py`
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
  - `services/api/app/services/agent_service.py`
  - `services/api/app/api/routes/integrations.py`
  - `apps/web/app/integrations/page.tsx`
  - `docs/IMPLEMENTATION_STATUS.md`
- Concrete work items:
  - verify whether a first-party native Codex contract now exists beyond the current experimental adapter boundary,
  - design the migration path so existing OpenAI-compatible bridge configs still fall back safely,
  - implement the native auth/health/execute flow behind explicit feature gating if viable,
  - surface first-party-vs-experimental status clearly in the integrations UI/docs,
  - add tests around the native path and the preserved fallback path.
- Acceptance:
  - either a real guarded first-party bridge path exists,
  - or the repo keeps the current experimental boundary and documents why the native contract is still unavailable.
- Validation:
  - relevant API tests
  - web lint/typecheck for changed surfaces

### 5. PWA offline cache follow-ups

- Branch: `codex/pwa-offline-cache-followups`
- Workitem ID: `WI-105`
- Lock: `HANDOFF_REVIEW | Workitem: WI-105 | Owner: N/A | Claimed: 2026-03-14T17:20:56Z | Last heartbeat: 2026-03-14T18:19:20Z`
- Goal: extend the new IndexedDB cache layer to the remaining PWA workspaces and add cache-management controls.
- Scope:
  - cache planner, sync-center, integrations, and richer assistant surfaces,
  - add stale-prefix, quota, and clear-cache controls users can inspect,
  - deepen offline browser coverage beyond the current notes/tasks/calendar/artifacts/search set.
- Out of scope:
  - replacing the current cache foundation,
  - rewriting the app into a native-first client.
- Likely files:
  - `apps/web/app/lib/entity-cache.ts`
  - `apps/web/app/lib/entity-snapshot.ts`
  - `apps/web/app/lib/local-search.ts`
  - `apps/web/app/planner/**`
  - `apps/web/app/integrations/**`
  - `apps/web/app/assistant/**`
  - `apps/web/tests/offline-cache.spec.ts`
- Concrete work items:
  - extend cache persistence to planner blocks/events, sync-center data, integrations/provider health, and richer assistant history,
  - add visible cache status, stale-prefix inspection, quota, and clear-cache controls,
  - tighten invalidation rules so replayed mutations refresh the right cached scopes without nuking everything,
  - expand offline search/restore behavior where those new caches should participate,
  - add Playwright coverage for offline reload and reconnect behavior on the newly cached workspaces.
- Acceptance:
  - remaining key workspaces survive offline reload from IndexedDB,
  - cache state can be inspected and cleared intentionally,
  - replay and invalidation behavior stay testable.
- Validation:
  - `pnpm --filter web exec tsc --noEmit`
  - `pnpm --filter web lint`
  - `pnpm test:web:offline-cache`

### 6. Phone-local LLM

- Branch: `codex/phone-local-llm`
- Workitem ID: `WI-106`
- Lock: `UNCLAIMED | Workitem: WI-106 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: explore and land the first viable phone-local LLM execution path behind the shared policy model.
- Scope:
  - choose a realistic constrained local-LLM strategy,
  - integrate it as an optional policy target,
  - preserve existing batch/server/API fallbacks.
- Out of scope:
  - making phone-local LLM the default for every action.
- Likely files:
  - `apps/mobile/App.tsx`
  - `services/api/app/services/ai_service.py`
  - `apps/web/app/integrations/page.tsx`
  - `docs/IMPLEMENTATION_STATUS.md`
- Concrete work items:
  - define the feasible model/runtime envelope for phone-local LLM work on the target Android-first setup,
  - decide which narrow action surface should be supported first instead of attempting full parity immediately,
  - add guarded policy routing for that local LLM path while keeping existing batch/API fallbacks intact,
  - expose enough diagnostics in UI/docs to explain why the local path is or is not selected,
  - write down explicit feasibility limits if the branch proves the path is not yet practical.
- Acceptance:
  - the repo either has a real guarded phone-local LLM path,
  - or a documented feasibility boundary with explicit next constraints.
- Validation:
  - `pnpm --filter mobile exec tsc --noEmit`
  - relevant API/web checks for routing changes

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
  - iOS share extension
  - desktop helper macOS validation
  - local TTS worker hardening
  - PWA offline cache follow-ups
- Start in parallel if the necessary mobile/runtime tooling is available:
  - phone-local LLM
- Run as a research-heavy branch:
  - native Codex first-party bridge follow-up

## Supervisor dispatch list (2026-03-14)

- `WI-101` (`codex/ios-share-extension`): ship iOS share-extension capture into quick-capture drafts with Android regression safety.
- `WI-102` (`codex/desktop-helper-macos-validation`): validate macOS clipboard/screenshot/window paths and tighten permission diagnostics.
- `WI-103` (`codex/local-tts-worker-hardening`): harden queued TTS timeout/retry/cancel lifecycle plus worker/API tests.
- `WI-104` (`codex/native-codex-first-party-bridge`): verify first-party Codex bridge viability and either implement guarded path or document boundary.
- `WI-105` (`codex/pwa-offline-cache-followups`): extend IndexedDB caching to remaining PWA workspaces with cache inspection/clear controls.
- `WI-106` (`codex/phone-local-llm`): implement or bound the first practical phone-local LLM routing path with policy diagnostics.
- `WI-108` (`codex/worker-transport-https-enforcement`): harden worker transport checks for production HTTPS semantics and proxy-aware routing safety.
