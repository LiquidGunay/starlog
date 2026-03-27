# AGENTS.md — Starlog repo instructions

## Product goal
Build Starlog as a single-user, low-cost, independent system for knowledge management, scheduling, alarms, and learning workflows.

## Locked v1 preferences
- Web-first PWA is the primary workspace.
- Companion mobile app is focused on capture, alarms/offline briefing playback, quick review/triage.
- Full note editing on mobile is done via the PWA.
- iOS share-specific work is out of scope for v1 distribution and must not block v1 release readiness.
- Clipping is first-class: browser clipper + cross-platform desktop helper (Tauri) + mobile share capture.
- Knowledge model uses an artifact graph with explicit provenance links.
- Keep version history for summaries/cards generated from the same artifact.
- Preserve source fidelity: raw + normalized + extracted.
- OCR is strict on-device only.
- STT/TTS is on-device first (local model spin-up allowed).
- LLM flows are manual quick-action driven (suggest-first), with fallback providers.
- Calendar is internal model + two-way Google Calendar sync.
- Include tasks + time blocking.
- Morning alarm + spoken briefing with offline playback on phone.
- Minimize hosting cost; Railway hobby footprint preferred.

## AI provider policy
- Prefer local/on-device providers when available.
- Codex subscription bridge is best-effort/experimental.
- Always keep fallback path (supported API-key provider/local alternative) for availability.

## Repo process rule
When an issue is discovered or a clear user preference appears, append it to this file in logs below.

## Shared workitem locking (`.git` common dir)

Use a shared live lock registry under the common git dir so all worktrees/agents coordinate against the same source of truth.

- Registry root: `$(git rev-parse --git-common-dir)/codex-workitems/`
- Authoritative files:
  - `workitems.json`
  - `locks/<workitem_id>.lock`
  - `audit.jsonl`
  - `.registry.lock` (used for atomic lock operations)
- Lock protocol:
  - claim lock before implementation starts
  - every lock record must include owner identity (`agent_id` plus a human-readable name/id)
  - heartbeat every 2 minutes while actively working
  - stale lock timeout is 10 minutes
  - release lock on completion or handoff
  - forced lock steal requires an explicit reason and must be appended to `audit.jsonl`
- Preferred command helper:
  - Initialize registry: `python3 scripts/workitem_lock.py init`
  - Claim: `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent> --force-steal --reason "<reason>"` (omit `--force-steal` for normal claim)
  - Heartbeat: `python3 scripts/workitem_lock.py heartbeat --workitem-id <id> --agent-id <agent>`
  - Release: `python3 scripts/workitem_lock.py release --workitem-id <id> --agent-id <agent> --status completed`
  - Inspect status: `python3 scripts/workitem_lock.py status [--workitem-id <id>]`
- Required usage flow for every agent:
  1) Identify the `workitem_id` in `workitems.json`, then acquire `.registry.lock` before reading/updating lock state.
  2) On claim, verify `locks/<workitem_id>.lock` is absent or stale (`last_heartbeat_at` older than 10 minutes). If active and not stale, do not proceed.
  3) Write/update `locks/<workitem_id>.lock` with owner metadata (`agent_id`, `agent_name`, `worktree`, `branch`, `claimed_at`, `last_heartbeat_at`), set workitem status/owner in `workitems.json`, and append a `claim` event to `audit.jsonl`.
  4) While working, refresh `last_heartbeat_at` at least every 2 minutes (under `.registry.lock`), and keep `workitems.json` ownership/status aligned.
  5) On completion or handoff, remove the lock file, update `workitems.json` status/owner/handoff fields, append a `release` event to `audit.jsonl`, then drop `.registry.lock`.
  6) Forced steal is allowed only for stale locks; append a `force_steal` event with explicit reason and prior owner context in `audit.jsonl`.
- `docs/CODEX_PARALLEL_WORK_ITEMS.md` is human-readable planning context only; live lock authority is the shared `.git` registry.
- Every claimed agent task must be delivered through a PR to `master`; direct pushes to `master` are not allowed.
- If a task branch is behind `origin/master`, rebase onto latest `origin/master` before final review/merge and rerun relevant validation after the rebase.
- Once a PR is merged, do not add commits to that branch/PR. Start a fresh `codex/*` branch from current `master` and open a new PR for follow-up work.
- Lock timing rationale:
  - 2-minute heartbeat gives near-real-time liveness without overwhelming lock-file churn.
  - 10-minute stale timeout tolerates short command/test pauses but recovers quickly from crashed or abandoned sessions.
  - Checking/refreshing at the 2-minute heartbeat cadence keeps takeover decisions consistent and deterministic.
- Any merge-conflict resolution insight discovered while working must be appended to this file's **Issue log**.

## Shared dependency/build reuse across worktrees

Fresh worktrees should reuse existing dependency installs and compiler caches from the canonical checkout instead of re-running full setup by default.

- Canonical checkout for this host: `/home/ubuntu/starlog`
- Before running installs in a fresh worktree, link shared state:

```bash
cd <your-worktree>
bash scripts/use_shared_worktree_state.sh --source /home/ubuntu/starlog
```

- The helper links these shared paths when they are absent locally:
  - `node_modules`
  - `apps/web/node_modules`
  - `apps/mobile/node_modules`
  - `tools/desktop-helper/node_modules`
  - `services/api/.venv`
  - `apps/mobile/android/.gradle`
  - `tools/desktop-helper/src-tauri/target`
- Fresh-worktree validation on this host succeeded without reinstalling after running the helper:
  - `npx pnpm@9.15.0 --filter web exec tsc --noEmit`
  - `cd apps/mobile && ./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep "quick popup can switch to workspace in browser fallback"`
- Default rule: reuse shared state for dependencies/caches; only localize a surface if your task changes that surface's dependency or build inputs.
- Localize a surface before reinstall/rebuild if you modify any of:
  - `package.json`
  - `pnpm-lock.yaml`
  - `services/api/pyproject.toml`
  - `services/api/uv.lock`
  - `apps/mobile/android/**`
  - `apps/mobile/app.config.js`
  - `tools/desktop-helper/src-tauri/Cargo.toml`
  - `tools/desktop-helper/src-tauri/Cargo.lock`
- If a worktree needs different state for one surface, keep only that surface local and continue reusing shared state for the rest.
- For long-running Metro/Gradle mobile validation on this host, prefer the canonical checkout if the NTFS worktree path stalls before binding `:8081`.

## Markdown map

This section is the repo-local purpose map for markdown files so agents know which docs are authoritative before opening or editing them.

- `AGENTS.md` — repo instructions, locked v1 preferences, lock protocol, runbooks, markdown map, preference log, and issue log.
- `README.md` — top-level repo overview, workspace layout, quick-start entrypoints, and release entrypoints.
- `docs/ANDROID_DEV_BUILD.md` — Android dev-build/native-module path, release-signing policy, and Android validation flow.
- `docs/ANDROID_RELEASE_QA_MATRIX.md` — recorded Android device QA outcomes and evidence links for the current release pass.
- `docs/ANDROID_STORE_DISTRIBUTION_CHECKLIST.md` — Android store metadata, signing, packaging, and submission checklist.
- `docs/CODEX_PARALLEL_WORK_ITEMS.md` — current human-readable work queue for parallel agent execution.
- `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md` — daily-use install, prerequisite, config, smoke, and reset handoff for the desktop helper on the main laptop.
- `docs/DESKTOP_HELPER_V1_RELEASE.md` — desktop helper distribution runbook, artifact pipeline, and release packaging notes.
- `docs/FINAL_PREVIEW_SIGNOFF.md` — current preview release-decision handoff, including the merged baseline and the remaining phone-proof import needed for full closure.
- `docs/IMPLEMENTATION_STATUS.md` — current shipped capability snapshot, validations, and next implementation targets.
- `docs/LOCAL_AI_WORKER.md` — laptop-local AI worker responsibilities, provider routing, and runtime setup.
- `docs/PREVIEW_FEEDBACK_BUNDLE.md` — exact local bundle paths and hosted endpoints for the current user-feedback install pass.
- `docs/PHONE_SETUP.md` — laptop-to-phone local testing and setup guide for PWA/mobile use.
- `docs/RAILWAY_PROJECT_SETUP_STATUS.md` — current real Railway project/service state, generated domains, pending deploy-time config, and cost estimate for WI-443.
- `docs/PWA_GO_LIVE_RUNBOOK.md` — PWA production go-live order, rollback triggers, and monitoring checklist.
- `docs/PWA_HOSTED_SMOKE_CHECKLIST.md` — hosted PWA smoke checks and expected evidence artifacts.
- `docs/PWA_PORTABILITY_DRILL.md` — export/backup portability drill and pass criteria.
- `docs/PWA_RAILWAY_PROD_CONFIG_CHECKLIST.md` — required Railway production config for API/web services.
- `docs/PWA_RELEASE_VERIFICATION_GATE.md` — mandatory pre-release gate for PWA builds/tests.
- `docs/RAILWAY_DEPLOY.md` — recommended Railway deployment model and supporting runbooks.
- `docs/STARLOG_ARCHITECTURE_WORKFLOW_PLAN.md` — canonical architecture/workflow/design contract for current implementation direction.
- `docs/STARLOG_V1_PLAN.md` — product-scope and architecture plan for Starlog v1.
- `services/worker/README.md` — placeholder scope note for future dedicated worker-runtime code.
- `tools/browser-extension/README.md` — browser clipper scaffold purpose and local load instructions.
- `tools/desktop-helper/README.md` — desktop helper capabilities, validation matrix, and host evidence.
- `apps/mobile/.expo/README.md` — Expo-generated explanation of local `.expo` state; informational only, not a planning source.
- `services/api/.pytest_cache/README.md` — pytest-generated cache note; informational only, not a planning source.
- Vendor markdown under `services/api/.venv/**` is third-party package/license material and is not part of Starlog repo guidance.

## Phone testing runbook (Android, this host)

Use this sequence when validating the native mobile app on the connected Android phone from WSL. The phone must remain unlocked for the full run.

0) Keep the device unlocked for the entire run:

- Do not let the phone lock/sleep during relay setup, deep-link open, smoke flow, or screenshot capture.
- Re-unlock immediately if the device locks; rerun failing step(s) after unlock.

1) Use the newer Windows ADB binary, not `C:\adb\adb.exe`:

```bash
ADB_WIN=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe
"$ADB_WIN" devices -l
```

2) Keep the phone awake and prepare API reverse:

```bash
"$ADB_WIN" -s <SERIAL> shell svc power stayon usb
"$ADB_WIN" -s <SERIAL> reverse tcp:8000 tcp:8000
```

3) Start the Windows relay in a dedicated terminal and keep it running:

```bash
bash -x /home/ubuntu/starlog/scripts/android_windows_metro_relay.sh
```

Expected relay checkpoint:

```text
[android-metro-relay] listening 0.0.0.0:8081 -> <WSL_IP>:8081
```

4) Validate relay reachability from Windows before opening the app:

```bash
powershell.exe -NoProfile -Command 'try { (Invoke-WebRequest -Uri "http://127.0.0.1:8081" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { $_.Exception.Message; exit 1 }'
```

Expected output: `200`

5) Start Metro in LAN mode from `apps/mobile`:

```bash
cd /home/ubuntu/starlog/apps/mobile
APP_VARIANT=development REACT_NATIVE_PACKAGER_HOSTNAME=192.168.0.102 ./node_modules/.bin/expo start --dev-client --host lan --port 8081
```

6) Open the dev client using the explicit Expo dev-launcher URL:

```bash
ADB_WIN=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe
"$ADB_WIN" -s <SERIAL> reverse --remove tcp:8081 || true
"$ADB_WIN" -s <SERIAL> shell am start -W -a android.intent.action.VIEW -d 'expo-dev-launcher://expo-development-client/?url=http%3A%2F%2F192.168.0.102%3A8081'
```

6a) If the dev client shows `Unable to load script` or a blank white screen, keep the same LAN dev-client URL flow, wait for Metro to finish the first bundle, and then rerun step 6. Do not switch to the localhost reverse path on this host:

```bash
ADB_WIN=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe
"$ADB_WIN" -s <SERIAL> shell am force-stop com.starlog.app.dev
"$ADB_WIN" -s <SERIAL> shell am start -W -a android.intent.action.VIEW -d 'expo-dev-launcher://expo-development-client/?url=http%3A%2F%2F192.168.0.102%3A8081'
```

Expected checkpoint in Metro terminal:

```text
Android Bundled ... index.js (...)
```

After that first bundle completes, continue with the same step 6 dev-client URL and the smoke/screenshots.

7) Run the Android smoke flow after the app loads:

```bash
cd /home/ubuntu/starlog
DEV_CLIENT_URL='expo-dev-launcher://expo-development-client/?url=http%3A%2F%2F192.168.0.102%3A8081' \
ADB=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe \
ADB_SERIAL=<SERIAL> \
REVERSE_PORTS=8000 \
SKIP_INSTALL=1 \
./scripts/android_native_smoke.sh
```

8) Capture a screenshot from the phone:

```bash
ADB_WIN=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe
"$ADB_WIN" -s <SERIAL> exec-out screencap -p > /tmp/starlog-phone.png
```

Troubleshooting checklist:
- `failed to connect to /192.168.0.102 (port 8081)`: relay is not reachable; re-check step 3 and step 4.
- `unexpected end of stream on http://127.0.0.1:8081/...`: avoid the localhost reverse path for Metro on this host; use LAN URL flow above.
- `Unable to load script` after opening the dev client: run step 6a once to prebuild the first bundle, wait for `Android Bundled ...`, then reopen step 6 URL.
- White screen for ~20-40s on first open: keep phone unlocked and wait for first bundle compile to finish before retrying.
- `adb devices` empty but phone appears in Device Manager: unlock phone, enable USB debugging, accept authorization prompt.
- `unauthorized` over TCP ADB: reconnect USB once and re-authorize before retrying wireless flow.

## Preference log
- 2026-03-04: User prefers clip-first workflow with strong provenance/versioning.
- 2026-03-04: User prefers manual AI action buttons over automatic pipelines.
- 2026-03-04: User wants low hosting cost and single-user simplicity.
- 2026-03-04: User wants strong clipping from browser and any desktop app (copy/screenshot flow).
- 2026-03-05: User is open to subagents/worktrees for independent tasks.
- 2026-03-05: User wants Starlog UI to feel modern and \"spacy\" with both dark and light themes.
- 2026-03-05: User prefers `uv` for Python dependency and environment workflow.
- 2026-03-05: User prefers periodic pushes during implementation.
- 2026-03-05: User reprioritized desktop clipper work behind web/mobile/app-core progress.
- 2026-03-06: User now prefers longer stable implementation passes with fewer stage/push checkpoints.
- 2026-03-06: User wants Android-first native app/build work before iOS.
- 2026-03-06: User prefers queued laptop-local Codex/Whisper processing over always-on hosted AI compute.
- 2026-03-06: User wants every major Starlog action exposed as LLM-usable tooling for future chat/voice control.
- 2026-03-06: User wants phone-local AI capability parity where possible, with configurable priority across on-device, local batch/bridge, and API fallback paths.
- 2026-03-06: User is fine with local AI models running as separate local commands/processes instead of being bundled into the app, and does not require real-time execution for most AI features.
- 2026-03-09: User wants Playwright used for browser-style testing when validating changes.
- 2026-03-09: User wants to be asked before any Railway deployment is made.
- 2026-03-10: User wants pending work broken into concrete workitems and run in parallel across separate `codex/*` branches / Codex instances.
- 2026-03-10: User wants parallel agents to claim work items by writing an explicit lock in `docs/CODEX_PARALLEL_WORK_ITEMS.md` before starting implementation.
- 2026-03-14: User wants every lock entry to include a clear owner identity (agent name/id) so lock ownership is unambiguous.
- 2026-03-14: User wants merged PR branches treated as immutable; follow-up changes must go through a new branch and new PR.
- 2026-03-14: User wants shared multi-worktree lock coordination under the common `.git` directory instead of repo-tracked lock state.
- 2026-03-14: User wants merge-conflict resolution insights logged in `AGENTS.md` Issue log whenever discovered.
- 2026-03-14: User wants Android mobile testing runs performed with the physical device kept unlocked throughout execution.
- 2026-03-14: User wants explicit lock claim/heartbeat/release/force-steal usage instructions documented in `AGENTS.md`.
- 2026-03-14: User wants the current architecture/workflow plan kept in a dedicated markdown file under `docs/`.
- 2026-03-14: User wants old parallel workitems discarded and replaced with a fresh queue based on the latest architecture/workflow plan after `master` updates.
- 2026-03-14: User wants additional architecture-plan workitems beyond the first queue refresh so agents can run a larger parallel batch.
- 2026-03-14: User wants it explicit that each agent task must ship via PR and must rebase onto latest `master` when behind.
- 2026-03-15: User wants provider/LLM configuration moved out of individual tabs into one central configurable window.
- 2026-03-15: User wants side panes across the main UI to be collapsible.
- 2026-03-15: User wants the Railway-hosted web service to sleep to effectively zero idle compute usage if Railway allows it.
- 2026-03-15: User wants desktop helper UI aligned to `screen_design` themes and expects a compact quick-capture popup plus a separate larger workspace surface for advanced controls.
- 2026-03-15: User wants the PWA IA and visual language aligned to the `screen_design` references, with canonical surface naming (`Command Center`, `Artifact Nexus`, `Neural Sync`, `Chronos Matrix`).
- 2026-03-15: User wants typography/chat styling to closely match the design HTML references and prefers contextual nav (Notes/Tasks under Command Center) without redundant `Calendar` links alongside `Chronos Matrix`.
- 2026-03-15: User wants mobile implementation/testing runs to include stored screenshots as completion proof.
- 2026-03-15: User clarified that iOS share status is out of scope for v1 and must not block v1 distribution work.
- 2026-03-15: User wants `AGENTS.md` to include a purpose map for repo markdown files.
- 2026-03-15: User wants fresh worktrees to reuse dependency installs/build caches from the canonical checkout unless a task changes that surface's dependency/build inputs.
- 2026-03-15: User wants Starlog Railway services added to the existing Railway project that already hosts the personal website instead of creating a separate Railway project.

## Issue log
- 2026-03-04: Initial commit failed due to missing `git user.name/user.email`; used repo-only fallback author config to complete bootstrap commit.
- 2026-03-05: Local `pytest` run failed because Python dependencies (e.g., `fastapi`) are not installed in the current environment yet.
- 2026-03-05: Running `uv` commands required elevated permission because sandbox blocked default access to `~/.cache/uv`.
- 2026-03-05: `corepack pnpm install` failed due to DNS/network resolution (`ENOTFOUND registry.npmjs.org`), so JS dependency-based checks are currently blocked.
- 2026-03-05: Re-running `corepack pnpm install --force` again hit intermittent DNS resolution errors to `registry.npmjs.org`.
- 2026-03-05: `pnpm install` succeeds when run with elevated network permissions; default sandbox networking still intermittently fails for npm registry access.
- 2026-03-05: Rust toolchain (`cargo`) is unavailable in this environment, so desktop-helper Rust compile checks cannot run here.
- 2026-03-06: Shared web API helper assumed all successful responses returned JSON, which broke `204 No Content` mutation flows until the helper was fixed.
- 2026-03-06: Native mobile share extension work is blocked in the current Expo-managed app because the repo does not yet include a share-intent native module/config plugin; deep-link and installed-PWA share-target capture are the active fallbacks.
- 2026-03-06: Mobile SQLite persistence upgrade is blocked until an Expo SQLite dependency is added to the mobile app workspace.
- 2026-03-06: Mobile SQLite persistence blocker resolved after adding `expo-sqlite` and migrating state into a local SQLite store.
- 2026-03-06: In-app native STT package work was intentionally dropped in favor of a queued Whisper sidecar pattern so phone and laptop can share the same local transcription path.
- 2026-03-06: `whisper_local` processing depends on a working local `whisper.cpp` command template and `ffmpeg` for non-WAV audio conversion.
- 2026-03-08: First-pass PWA offline entity snapshots are localStorage-backed; fuller IndexedDB cache invalidation/search support is still pending.
- 2026-03-08: Android native share-intent path now depends on `expo-share-intent` and therefore requires a custom dev build; Expo Go remains fallback-only and iOS share-extension patching is still pending.
- 2026-03-09: `expo-share-intent` needed to be constrained to Android-only mode because the repo does not yet include the pending iOS share-extension patch flow, and the mobile workspace had drifted from Expo 51's recommended `@types/react`/`typescript` versions.
- 2026-03-09: Android shared images/files were previously reduced to placeholder text in quick capture until the mobile app was updated to upload them as media-backed artifacts.
- 2026-03-09: Desktop helper now has native global shortcut and platform capture wiring in code, and local Rust/GTK/WebKit setup now allows native Linux Tauri release builds in this environment.
- 2026-03-09: Mobile asset placeholders in `apps/mobile/assets` had broken PNG CRCs, which blocked Expo Android prebuild and icon generation until valid tracked PNGs replaced them.
- 2026-03-09: Expo Android prebuild under pnpm needed a direct `@react-native/gradle-plugin` dependency in `apps/mobile` because the generated Gradle settings file assumes direct Node resolution from the mobile workspace.
- 2026-03-09: Root `.gitignore` had been ignoring every `android/` directory, which would have hidden the now-active `apps/mobile/android` native project until an explicit unignore was added.
- 2026-03-09: Android share-intent handling in the mobile companion originally consumed only the first shared file; the app now keeps multiple shared files together in quick capture so a single Android share action is not partially dropped.
- 2026-03-09: Desktop helper capture metadata was previously limited to timestamps/source tags; it now attempts active app/window metadata per clip and keeps recent capture history in the helper UI.
- 2026-03-09: Android share-intent drafts originally depended on transient incoming URIs and in-memory state; the app now copies shared files/audio into app-owned storage and persists those drafts so routine restarts are less likely to drop native-share intake.
- 2026-03-09: Desktop helper screenshot history was previously text-only; it now stores thumbnail previews alongside OCR/context metadata for recent screenshot clips.
- 2026-03-09: Local Android SDK tools in this environment live under `~/.local/android`, and `adb` is not on the default shell `PATH` unless that SDK location is wired explicitly.
- 2026-03-09: Local AI jobs previously had no cancel/retry lifecycle controls, and the laptop worker's default provider-hint list skipped queued TTS jobs until the worker/API/UI were updated.
- 2026-03-10: Web typechecking in `apps/web/app` hit mixed React type identities when files used `React.ReactNode`; importing `type ReactNode` from `react` resolved the remaining provider/layout drift.
- 2026-03-10: Android emulator launch in this environment fails early if it tries to write gRPC/JWK runtime state under `/run/user/1000/avd`; redirecting `XDG_RUNTIME_DIR` to a writable path like `/tmp/runtime-$USER` avoids that host-side crash.
- 2026-03-10: Android SDK CLI calls in this environment choke on malformed proxy env vars; the repo now sanitizes those before invoking local emulator/SDK tooling.
- 2026-03-10: The Google APIs API 34 x86_64 emulator can spend a very long first boot on stub decompression/dexopt under software emulation; a local AOSP API 34 x86_64 fallback AVD is a more practical validation target here.
- 2026-03-10: On the local software-emulated Android runtime, `pm path android` and package services can become usable before `sys.boot_completed`, and first APK installs may transiently fail inside `PackageInstallerSession` until package/storage services finish stabilizing; the smoke script now treats those as retryable startup-state errors.
- 2026-03-10: Physical-device testing against a connected Android 14 phone exposed a missing direct `@babel/runtime` dependency in `apps/mobile`; Metro now bundles the custom `index.js` entry cleanly under pnpm once that dependency is present.
- 2026-03-10: On this host, the newer Windows `adb` platform-tools can see the phone and set `adb reverse`, but WSL-driven `adb shell`/dev-client streaming is still flaky; the most promising local path is a Windows-side TCP relay to Metro plus `adb reverse`, or running the final device commands from a native Windows shell instead of WSL.
- 2026-03-10: Real Windows helper validation from WSL showed the PowerShell foreground-window probe was incorrectly using `$pid`, which collides with PowerShell's read-only `$PID` variable; switching that script to a different variable restored Windows active-window metadata capture.
- 2026-03-10: This host currently has repo `node_modules` populated but no global `pnpm` or `corepack` on `PATH`, so local web validation had to invoke `node_modules/.bin/*` tooling directly.
- 2026-03-10: Filtered task refreshes in the PWA were previously overwriting the shared cached task snapshot with only the active status subset; offline task/search caches now need merged writes when refreshing non-`all` task filters.
- 2026-03-10: This shell image has Node and repo `node_modules`, but `pnpm`/`corepack` are not on the default `PATH`; helper validation here used `./node_modules/.bin/playwright` and workspace-local `./node_modules/.bin/tauri` instead of bare `pnpm` commands.
- 2026-03-10: Fresh Codex worktrees do not inherit the repo's JS install state; Android native validation in a new worktree needs `npx pnpm@9.15.0 install` before `tsc` or Gradle's Node-based package resolution will work.
- 2026-03-10: Direct `apps/mobile/android/gradlew assembleDebug` validation in a fresh worktree also needs `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT` exported explicitly in this environment; otherwise Expo module configuration fails before APK assembly.
- 2026-03-10: The open PR stack was not fully independent: `codex/pwa-offline-cache` already contained `codex/desktop-helper-runtime-validation`, so merge order mattered when integrating the outstanding PRs onto `master`.
- 2026-03-10: In this shared multi-agent checkout, the currently checked-out `codex/*` branch can drift between runs; pushing the intended branch ref directly may be safer than relying on the active worktree branch when opening PRs.
- 2026-03-10: The repo still has no first-party native Codex subscription/OAuth handshake contract; `codex_bridge` is now intentionally limited to an explicit experimental OpenAI-compatible bridge adapter plus fallback providers until that upstream contract exists.
- 2026-03-10: Windows host validation from WSL confirmed `Get-Clipboard` and the PowerShell screenshot backend work, but running `.ps1` probes across the `\\wsl$` path required `-ExecutionPolicy Bypass`, and Windows-side OCR stayed unavailable because `tesseract` was not on that host `PATH`.
- 2026-03-10: Android phone-local STT now uses the platform `SpeechRecognizer`; it only becomes an executable `on_device` route when the phone exposes a working speech-recognition service, so the mobile app must probe availability and fall back to queued Whisper when that service is absent or unauthorized.
- 2026-03-10: On the local Windows host, Device Manager can already show both the phone and an `ADB Interface` while `adb devices` is still empty; in that state, the remaining blocker is usually phone-side USB-debugging authorization rather than a missing Windows driver.
- 2026-03-10: On this WSL + physical-phone setup, Expo dev-client transport is more reliable when Metro runs in LAN mode and a Windows-side TCP relay exposes `0.0.0.0:8081 -> <WSL_IP>:8081`; keeping `adb reverse tcp:8081` at the same time can trigger misleading mixed `localhost`/LAN Metro warnings even after the app renders.
- 2026-03-10: Android `adb shell am start` deep links that include `&source_url=...` need remote-shell quoting; the repo smoke helpers now escape those payloads so Android does not split the URI at `&`.
- 2026-03-10: This Windows host still had an obsolete `C:\adb\adb.exe` (ADB `1.0.31`) ahead of the newer platform-tools build; reliable Android phone validation here needs the newer `C:\Temp\android-platform-tools\platform-tools\adb.exe` to avoid daemon/version conflicts.
- 2026-03-10: Physical-phone Expo dev-client validation is cleanest on this host when Metro runs in LAN mode behind the Windows relay, only `tcp:8000` is reversed for the API, and the phone is opened via the explicit `expo-dev-launcher://expo-development-client/?url=http://<WINDOWS_LAN_IP>:8081` URL instead of relying on the Dev Launcher home screen.
- 2026-03-14: Added a concrete Android phone testing runbook in this file (ADB binary, relay validation, Metro LAN launch, explicit dev-client URL open, smoke command, screenshot capture) to make physical-device validation deterministic without repeated experimentation.
- 2026-03-14: Running dependent `git checkout`/branch-creation commands in parallel can race and leave the worktree on `master`; branch-switch operations should be run sequentially to avoid accidental commits to local `master`.
- 2026-03-15: `scripts/use_shared_worktree_state.sh` initially failed in linked git worktrees because `git rev-parse --git-common-dir` can return a relative `.git` path for the canonical checkout; resolve each common dir relative to its repo root before comparing.
- 2026-03-15: Fresh-worktree reuse was validated on this host without reinstalling dependencies by linking shared state, then running one web typecheck, one mobile typecheck, and one desktop helper Playwright test from the new worktree.
- 2026-03-15: Railway GitHub deploy statuses confirmed the repo source hook is connected for both Starlog services; a doc-only merge produced `No deployment needed - watched paths not modified`, while a watched-path merge triggered real deploys.
- 2026-03-15: The live Railway `starlog-web` service was still configured with `pnpm --filter web start -- --hostname ...`, which fails because `pnpm` forwards a literal leading `--` into `next start`; the preferred fix is `pnpm --filter web exec next start --hostname 0.0.0.0 --port $PORT`, and the web workspace now strips a stray leading `--` in its `start` wrapper as a compatibility fallback.
- 2026-03-15: Railway web deploy initially crashed because `pnpm --filter web start -- --hostname ...` passed `--` through to `next start` as an invalid project directory; `pnpm --filter web exec next start --hostname 0.0.0.0 --port $PORT` works on Railway.
- 2026-03-15: Railway blocked repo-root Starlog API deploys on a critical `next@15.0.0` advisory from the root `pnpm-lock.yaml`; bumping the web app to `next@15.0.7` cleared the security gate.
- 2026-03-15: Railway `environment edit` applied build/deploy/variable settings for Starlog services but did not attach GitHub source metadata; service source still shows `null`, so automatic deploy wiring needs a separate service-source connection step.
- 2026-03-15: Railway `up` respects watch-pattern diffs when deciding whether to deploy; repo-root API deploys needed the root lockfile included in watch paths because that file can block builds via Railway's security scan.
- 2026-03-15: The desktop-helper release scripts were repo-tracked without execute bits, so the documented `./scripts/...` commands failed until the script modes were restored to executable.
- 2026-03-15: Linux `tauri build --bundles appimage` initially panicked (`couldn't find a square icon to use as AppImage icon`) until explicit bundle icon paths were added in `tools/desktop-helper/src-tauri/tauri.conf.json`.
- 2026-03-15: On this host, Linux `tauri build --bundles deb,appimage` can stall inside `linuxdeploy` after producing the `.deb`; the deterministic release pipeline now defaults to `deb` and keeps AppImage as an explicit optional attempt.
- 2026-03-15: Rebuilding the Linux `.deb` without source changes still changed the package checksum on this host, so RC handoff must use the final staged `checksums.sha256` from the last packaging run rather than assuming byte-for-byte reproducibility.
- 2026-03-15: Unprivileged `dpkg --dry-run -i` can still emit a `/var/log/dpkg.log` permission warning even while confirming the package metadata and unpack plan; pair it with `dpkg-deb -I/-x` for non-destructive install smoke in this environment.
- 2026-03-15: Adding hosted-only Playwright smoke specs to `apps/web/tests` can unintentionally affect the general PWA release gate unless `playwright.web.config.ts` explicitly ignores hosted smoke tests.
- 2026-03-15: PWA screenshot capture on this host can silently reuse a stale local `next start` listener on `127.0.0.1:3005`; kill the existing listener before visual validation so screenshots reflect the current build.
- 2026-03-15: `make verify-export` assumes `.localdata/starlog.db`; portability drills in clean worktrees need an isolated seeded DB path (for example, by setting `STARLOG_DB_PATH`) before running export roundtrip verification.
- 2026-03-15: Assistant voice queue Playwright checks rely on `voice-job-*` being visible; moving job lists into collapsed `<details>` causes false regressions unless those sections are open by default or tests expand them.
- 2026-03-15: On this phone, `adb shell svc power stayon usb` does not persist because secure-setting writes are restricted (`mStayOnWhilePluggedInSetting` remains `0`), so testers must keep the device manually unlocked.
- 2026-03-15: A stale local debug APK triggered `Cannot find native module 'ExpoSecureStore'`; rebuilding `apps/mobile/android` and reinstalling `app-debug.apk` resolved the native-module mismatch.
- 2026-03-15: Metro startup from this NTFS worktree can stall before binding `:8081`; using `/home/ubuntu/starlog` for long-running Metro/Gradle validation avoided the startup stall while edits remained in the worktree.
- 2026-03-15: This host/phone pairing can still show a transient `Cannot connect to Metro...` toast even when localhost reverse transport (`tcp:8081`) bundles successfully; capture/test flows can proceed with that warning as a known dev-client transport quirk.
- 2026-03-15: After separating the desktop helper popup from the studio workspace, browser tests that exercise capture buttons need to open `index.html?mode=quick`; the default workspace route no longer exposes popup-only capture controls.
- 2026-03-15: First dev-client open on this host can fail with `Unable to load script` until Metro finishes an initial bundle compile; once `Android Bundled ...` appears, reopen the same LAN `expo-dev-launcher://expo-development-client/?url=http://<LAN_IP>:8081` URL instead of switching launcher schemes.
- 2026-03-15: Mobile design-alignment pass introduced icon usage from `@expo/vector-icons`; the `apps/mobile` workspace must include that dependency (and lockfile update) or Metro fails with `Unable to resolve "@expo/vector-icons" from "App.tsx"`.
- 2026-03-15: Post-merge UI audit found `SessionControls` repeated as a primary panel across canonical PWA surfaces; follow-up should consolidate session/admin controls into a secondary settings surface to stay aligned with `screen_design`.
- 2026-03-15: Post-merge mobile UI audit found the advanced capture/review panels duplicate the focused companion shell with a second admin-console layer; follow-up should collapse those controls into more compact secondary surfaces.
- 2026-03-15: Post-merge desktop UI audit found the helper workspace reuses the quick-popup capture console instead of a more distinct studio config surface, creating redundant UI relative to the desktop design reference.
- 2026-03-15: Fresh worktrees can now reuse shared dependency and cache state through `scripts/use_shared_worktree_state.sh`; only surfaces with changed dependency/build inputs should localize and rerun setup.
- 2026-03-15: Railway setup for WI-443 is now linked to the existing `perfect-intuition` project, with empty `starlog-api` and `starlog-web` services created plus Railway-provided domains reserved; source/build/start/env wiring is intentionally deferred until deploy approval.
- 2026-03-15: The desktop-helper QA screenshot script had drifted behind the popup/workspace split and still tried to click capture buttons from the workspace route; it now captures config in the workspace and capture actions in the quick popup.
- 2026-03-15: Main-laptop helper readiness on this Linux host still depends on installing clipboard, screenshot, active-window, and OCR helper packages; the setup-pack doc now records the concrete `apt-get` path plus built-in helper reset controls.
- 2026-03-15: Mobile capture deep links previously loaded quick-capture content without forcing the companion back to the capture tab, so shared content could open while the user still saw review or alarms; deep-link capture handling now switches the active tab to `capture`.
- 2026-03-15: The mobile next-briefing countdown was previously memoized only on alarm time changes, so it could sit stale on screen; it now re-ticks on a timer instead of waiting for unrelated state updates.
- 2026-03-27: On the connected Android device, the installed dev build resolves correctly through `expo-dev-launcher://expo-development-client/?url=...`; direct `starlog://` and `exp+starlog://` opens fell through to the Android resolver, so launcher-based validation on this host should use the Expo dev-launcher scheme.
- 2026-03-16: Android `assembleRelease` bundling under Expo + pnpm failed until `apps/mobile` declared `expo-asset` and `@react-native/assets-registry` directly; Expo CLI resolved both from the app root during `:app:createBundleReleaseJsAndAssets` instead of only through transitive dependencies.
- 2026-03-16: On this host, Windows `adb.exe` can see the physical Android phone while WSL `adb` cannot, but Windows `adb.exe` also cannot install an APK from a WSL-only path; copy the APK into a Windows-visible path like `C:\Temp\...` before `adb install`.
- 2026-03-16: Preview Android installs keep the launcher component class `com.starlog.app.dev.MainActivity` even when the installed package id is `com.starlog.app.preview`; resolve the launcher component from package manager instead of assuming `<package>/.MainActivity`.
- 2026-03-16: The current Railway production CORS allowlist rejects helper-browser preflights from `http://127.0.0.1:4173` with `Disallowed CORS origin`, so local browser fallback validation cannot hit Railway unless `STARLOG_CORS_ALLOW_ORIGINS` is widened.
- 2026-03-16: On the preview Android build, cold-start `starlog://capture?...` intents reached the explicit activity component but the expected prefilled capture state did not surface in the UI, so preview deep-link capture still needs follow-up.
- 2026-03-16: Railway-backed queued `codex_local` summary jobs completed from this desktop, but a larger `assistant_command_ai` / `llm_agent_plan` job failed on the same local worker even though direct `codex exec` succeeded, so the assistant-planning runtime path needs separate debugging.
- 2026-03-16: Manual Android deep-link probes from `adb shell am start ... -d ...` can produce false negatives when `&text=` / `&source_url=` are not preserved by the remote shell; quote the full remote command so the URI reaches the app intact before judging deep-link behavior.
- 2026-03-16: Preview Android deep-link capture now resolves through React initial props for cold starts plus a native `StarlogAppLink` device event for warm starts, which avoided the earlier startup timing gap between `MainActivity` and JS deep-link state hydration.
- 2026-03-21: Fresh preview-build validation on the physical phone confirmed that `starlog://capture?...` prefill lands in the queued capture form, but the populated title/source/text fields sit below the initial hero section; scroll the capture surface before treating a top-of-screen dump as a deep-link failure.
- 2026-03-22: The official `microsoft/VibeVoice` repository is back online, but the maintainers note that the TTS code was removed after September 2025; the practical Starlog integration path is therefore a stable local TTS server abstraction with an explicit community/fallback backend instead of assuming first-party VibeVoice server support exists on every host.
- 2026-03-22: In Codex Linux subagent shells on this host, the connected-phone Android RC path still requires the Windows `adb.exe`; this shell cannot execute that binary (`Exec format error`), while local WSL `adb devices -l` can remain empty even though prior Windows-host phone validation succeeds.
- 2026-03-22: Clean-master desktop-helper proof on this Linux host now passes browser-fallback helper upload plus authenticated localhost bridge/local-STT smoke, and the remaining blocker is reduced to one host issue: native Linux clipboard/screenshot/OCR packages are still missing and `sudo -n true` returns `sudo: a password is required`, so the generated `apt-get` command must be run interactively before native screenshot/OCR validation can complete.
- 2026-03-22: `scripts/pwa_hosted_smoke.sh` assumes `127.0.0.1:8000` is free; if another API is already bound there, the isolated smoke API fails to start and the hosted smoke can silently target the wrong local API unless `STARLOG_HOSTED_SMOKE_API_PORT` is overridden.
- 2026-03-22: In the WI-593 isolated API proof, the built PWA artifact surface rendered the helper-uploaded `Desktop clip`, but the assistant surface did not render the seeded persistent-thread marker in the saved proof run even though `/v1/conversations/primary` returned it, so host-local cross-surface thread proof currently relies on API evidence plus PWA shell/artifact evidence rather than the assistant transcript UI alone.
- 2026-03-23: Replaying stale doc-only proof PRs onto current `origin/master` can conflict in shared handoff docs like `AGENTS.md` and `docs/VNEXT_TEST_BUNDLE.md`; preserve the newer release-handoff baseline on `master` and reapply only the still-relevant proof references.
- 2026-03-23: On this host, the main Codex shell can again execute the Windows platform-tools `adb.exe` and reach the physical phone, but `android_native_smoke.sh` still cannot install through a WSL-style `/mnt/c/...` APK path when using `adb.exe`; use a native Windows path like `C:\Temp\...` for installs, then rerun the smoke script with `SKIP_INSTALL=1`.
- 2026-03-27: WI-612 review follow-up exposed two quick-mode regressions in the desktop helper: the status-pill hide rule was too broad and the runtime health badge lost its mono class on refresh; the quick-size regression test now documents the viewport budget it actually measures.
- 2026-03-27: The primary mobile capture shell had a save action wired to text/shared-file capture even when a voice memo existed; the hero submit path now routes recorded voice notes correctly and exposes an explicit save button in the surface.
- 2026-03-27: The Android phone-testing runbook now keeps the same LAN Expo dev-client URL through initial open and bundle-prime recovery so it no longer contradicts the working launcher scheme with a localhost reverse fallback.
- 2026-03-27: Hosted smoke exposed a SQLite thread-affinity crash in the API artifact versions path; request-scoped SQLite connections now disable `check_same_thread` to match FastAPI's sync threading model.
- 2026-03-27: Manual PDF ingest must prefer the best readable fallback when OCR returns noise and a later provider returns short-but-human text; preserve that extracted text instead of dropping it just because it misses the full usability threshold.
- 2026-03-27: Rebase conflict resolution: keep the newer master AGENTS baseline and reapply branch-specific PDF ingest notes without dropping the mobile runbook updates.
