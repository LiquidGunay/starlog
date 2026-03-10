# AGENTS.md — Starlog repo instructions

## Product goal
Build Starlog as a single-user, low-cost, independent system for knowledge management, scheduling, alarms, and learning workflows.

## Locked v1 preferences
- Web-first PWA is the primary workspace.
- Companion mobile app is focused on capture, alarms/offline briefing playback, quick review/triage.
- Full note editing on mobile is done via the PWA.
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
