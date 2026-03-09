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
