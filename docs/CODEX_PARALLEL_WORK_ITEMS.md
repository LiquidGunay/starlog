# Codex Parallel Work Items

Base code baseline after landing the currently open PRs: `9dadf10` on `master`.

Purpose: break the remaining implementation targets into independent workstreams so multiple Codex runs can keep making progress without stepping on each other.

## Landed on `master`

- `codex/desktop-helper-runtime-validation`
  - Added runtime diagnostics, browser-clipboard fallback, tighter screenshot cleanup, and better helper coverage/docs.
- `codex/pwa-offline-cache`
  - Landed IndexedDB-backed entity caches, offline detail/search improvements, service-worker shell caching, and Playwright offline coverage.
- `codex/android-native-validation`
  - Hardened Android smoke tooling/docs, added a Windows-host fallback runner, and documented fresh-worktree env setup for native validation.

## Working rules

- Create each new workstream from `master` at `9dadf10` or a newer fast-forward of it.
- Keep branch names under the required `codex/` prefix.
- Prefer rebasing onto `master` instead of merging other Codex branches together.
- Do not stack Codex branches unless the dependency is explicit and recorded in this file first.
- Do not deploy from these branches without explicit user approval.
- Update `AGENTS.md` with any new blocker or user preference discovered in the branch.
- Every branch should leave behind:
  - code changes,
  - docs updates for the changed workflow,
  - validation notes or commands that were actually run.

## Remaining workstreams

### 1. iOS share extension

- Branch: `codex/ios-share-extension`
- Goal: add the missing iOS native share-target path for the companion app.
- Scope:
  - implement the iOS share-extension/config-plugin/native plumbing,
  - land shared text/URL capture into Starlog quick capture,
  - keep the existing Android native-share path working.
- Out of scope:
  - new Android-native validation tooling,
  - phone-local STT/LLM execution work.
- Likely files:
  - `apps/mobile/app.config.js`
  - `apps/mobile/App.tsx`
  - `apps/mobile/ios/**` or related plugin files
  - `docs/PHONE_SETUP.md`
- Acceptance:
  - iOS dev build compiles,
  - a shared text or URL payload lands in-app,
  - docs explain the required local build/run flow.
- Validation:
  - `pnpm --filter mobile exec tsc --noEmit`
  - `pnpm --filter mobile ios` or equivalent Xcode/dev-build flow

### 2. Desktop helper host matrix

- Branch: `codex/desktop-helper-host-matrix`
- Goal: use the new diagnostics to validate and tighten the helper across real host environments.
- Scope:
  - confirm clipboard, screenshot, OCR, and shortcut behavior on at least one non-Linux host path,
  - tighten platform-specific error messages and docs where macOS/Windows diverge,
  - keep the current Linux path green.
- Out of scope:
  - turning the helper into a full desktop workspace,
  - major UI redesign.
- Likely files:
  - `tools/desktop-helper/src/main.js`
  - `tools/desktop-helper/src-tauri/src/main.rs`
  - `tools/desktop-helper/tests/helper.spec.ts`
  - `tools/desktop-helper/README.md`
- Acceptance:
  - docs include a real validation matrix,
  - at least one additional host path is validated end to end,
  - diagnostics map failures to actionable setup fixes.
- Validation:
  - `pnpm test:desktop-helper`
  - `cd tools/desktop-helper/src-tauri && cargo check`
  - `pnpm --filter starlog-desktop-helper build`

### 3. Local TTS worker hardening

- Branch: `codex/local-tts-worker-hardening`
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
- Acceptance:
  - queued TTS failures are diagnosable,
  - retry/cancel semantics stay coherent,
  - provider wrappers are covered by tests.
- Validation:
  - `uv run --project services/api --extra dev pytest tests/test_local_ai_worker.py -s`
  - `uv run --project services/api --extra dev pytest tests/test_api_flows.py -s`

### 4. Native Codex bridge adapter

- Branch: `codex/native-codex-bridge`
- Goal: add the real Codex-subscription/OAuth bridge path if the contract is ready, or crisply define the boundary if it is not.
- Scope:
  - inspect the current bridge assumptions,
  - implement auth, health, and execute flow behind a feature flag if viable,
  - otherwise leave a documented adapter contract and safe fallback behavior.
- Out of scope:
  - rewriting the AI provider model,
  - making Codex the only required provider.
- Likely files:
  - `services/api/app/services/ai_service.py`
  - `services/api/app/services/agent_service.py`
  - `services/api/app/api/routes/integrations.py`
  - `apps/web/app/integrations/page.tsx`
  - `docs/IMPLEMENTATION_STATUS.md`
- Acceptance:
  - either a real guarded bridge path exists,
  - or the repo contains an explicit integration contract and no ambiguous half-state.
- Validation:
  - relevant API tests
  - web lint/typecheck for changed surfaces

### 5. PWA offline cache follow-ups

- Branch: `codex/pwa-offline-cache-followups`
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
- Acceptance:
  - remaining key workspaces survive offline reload from IndexedDB,
  - cache state can be inspected and cleared intentionally,
  - replay and invalidation behavior stay testable.
- Validation:
  - `pnpm --filter web exec tsc --noEmit`
  - `pnpm --filter web lint`
  - `pnpm test:web:offline-cache`

### 6. Phone-local STT

- Branch: `codex/phone-local-stt`
- Goal: land a real phone-local STT execution path that honors the shared execution policy.
- Scope:
  - pick a viable Android-first local STT path,
  - wire it into the mobile app and policy routing,
  - keep the queued Whisper path as fallback.
- Out of scope:
  - phone-local LLM execution,
  - removing the existing queued worker path.
- Likely files:
  - `apps/mobile/App.tsx`
  - `services/api/app/api/routes/integrations.py`
  - `apps/web/app/integrations/page.tsx`
  - `docs/PHONE_SETUP.md`
- Acceptance:
  - one real mobile-local STT route exists behind policy resolution,
  - fallback to queued/local-worker still works.
- Validation:
  - `pnpm --filter mobile exec tsc --noEmit`
  - Android device validation for the selected STT path

### 7. Phone-local LLM

- Branch: `codex/phone-local-llm`
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
- Acceptance:
  - the repo either has a real guarded phone-local LLM path,
  - or a documented feasibility boundary with explicit next constraints.
- Validation:
  - `pnpm --filter mobile exec tsc --noEmit`
  - relevant API/web checks for routing changes

## Suggested execution order

- Start immediately:
  - iOS share extension
  - desktop helper host matrix
  - local TTS worker hardening
  - PWA offline cache follow-ups
- Start in parallel if the necessary mobile/runtime tooling is available:
  - phone-local STT
  - phone-local LLM
- Run as a research-heavy branch:
  - native Codex bridge adapter
