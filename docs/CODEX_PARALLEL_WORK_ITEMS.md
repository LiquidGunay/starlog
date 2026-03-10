# Codex Parallel Work Items

Base commit for this split: `8601738` on `master`.

Purpose: break the remaining implementation targets into independent workstreams so multiple Codex runs can make progress in parallel without stepping on each other.

## Working rules

- Create each workstream from `master` at `8601738`.
- Keep branch names under the required `codex/` prefix.
- Prefer rebasing onto `master` instead of merging other Codex branches together.
- Do not deploy from these branches without explicit user approval.
- Update `AGENTS.md` with any new blocker or user preference discovered in the branch.
- Every branch should leave behind:
  - code changes,
  - docs updates for the changed workflow,
  - validation notes or commands that were actually run.

## Workstreams

### 1. Android native validation

- Branch: `codex/android-native-validation`
- Goal: finish end-to-end Android native-share validation on a real device or reliable local host path.
- Scope:
  - stabilize install/launch/share testing on the attached Android device,
  - validate text, URL, image/file, and audio share intake,
  - improve scripts/docs for the known WSL-to-Windows `adb` issues if needed.
- Out of scope:
  - iOS share-extension work,
  - backend deployment changes.
- Likely files:
  - `apps/mobile/App.tsx`
  - `scripts/android_native_smoke.sh`
  - `docs/ANDROID_DEV_BUILD.md`
  - `docs/PHONE_SETUP.md`
- Acceptance:
  - current debug APK installs on a real Android device,
  - share-intent validation covers text + file + audio paths,
  - the documented workflow is reproducible on this host.
- Validation:
  - `pnpm --filter mobile exec tsc --noEmit`
  - `cd apps/mobile/android && ./gradlew assembleDebug`
  - `pnpm test:android:smoke` or equivalent documented device flow

### 2. iOS share extension

- Branch: `codex/ios-share-extension`
- Goal: add the missing iOS native share-target path for the companion app.
- Scope:
  - implement the iOS share-extension/config-plugin/native plumbing,
  - land shared text/URL into Starlog quick capture,
  - keep the Android share path working.
- Out of scope:
  - Android device validation,
  - full iOS STT/LLM work.
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

### 3. Desktop helper runtime validation

- Branch: `codex/desktop-helper-runtime-validation`
- Goal: harden the desktop helper beyond “builds on Linux” into a better validated capture tool.
- Scope:
  - improve runtime diagnostics/fallback behavior for clipboard, screenshot, and shortcut flows,
  - tighten platform-specific guards where Linux/macOS/Windows differ,
  - expand automated coverage where possible.
- Out of scope:
  - converting the helper into a full desktop workspace.
- Likely files:
  - `tools/desktop-helper/src/main.js`
  - `tools/desktop-helper/src-tauri/src/main.rs`
  - `tools/desktop-helper/tests/helper.spec.ts`
  - `tools/desktop-helper/README.md`
- Acceptance:
  - Linux runtime remains green,
  - error paths/fallbacks are clearer,
  - docs include a validation matrix for real desktop testing.
- Validation:
  - `pnpm test:desktop-helper`
  - `cd tools/desktop-helper/src-tauri && cargo check`
  - `pnpm --filter starlog-desktop-helper build`

### 4. Local TTS worker hardening

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

### 5. Native Codex bridge adapter

- Branch: `codex/native-codex-bridge`
- Goal: add the real Codex-subscription/OAuth bridge path if the contract is ready, or crisply define the boundary if it is not.
- Scope:
  - inspect the current bridge assumptions,
  - implement auth/health/execute flow behind a feature flag if viable,
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

### 6. PWA offline cache deepening

- Branch: `codex/pwa-offline-cache`
- Goal: move beyond snapshot-only offline support into a more real local-first PWA cache.
- Scope:
  - add IndexedDB-backed entity caches,
  - support offline detail reads for key workspaces,
  - tighten invalidation/replay rules,
  - improve offline search if practical.
- Out of scope:
  - replacing the PWA with a native app.
- Likely files:
  - `apps/web/app/lib/entity-snapshot.ts`
  - `apps/web/app/lib/local-search.ts`
  - `apps/web/app/lib/mutation-outbox.ts`
  - `apps/web/app/artifacts/page.tsx`
  - `apps/web/app/notes/page.tsx`
  - `apps/web/app/tasks/page.tsx`
  - `apps/web/app/calendar/page.tsx`
- Acceptance:
  - recent key entities remain readable offline from a real cache layer,
  - replay/invalidation behavior is documented and testable.
- Validation:
  - `pnpm --filter web exec tsc --noEmit`
  - `pnpm --filter web lint`
  - targeted browser validation for offline reads

### 7. Phone-local STT

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

### 8. Phone-local LLM

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
  - Android native validation
  - desktop helper runtime validation
  - local TTS worker hardening
  - PWA offline cache
- Start in parallel if the necessary host tooling is available:
  - iOS share extension
  - phone-local STT
  - phone-local LLM
- Run as a research-heavy branch:
  - native Codex bridge adapter
