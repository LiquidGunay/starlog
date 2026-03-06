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

## Issue log
- 2026-03-04: Initial commit failed due to missing `git user.name/user.email`; used repo-only fallback author config to complete bootstrap commit.
- 2026-03-05: Local `pytest` run failed because Python dependencies (e.g., `fastapi`) are not installed in the current environment yet.
- 2026-03-05: Running `uv` commands required elevated permission because sandbox blocked default access to `~/.cache/uv`.
- 2026-03-05: `corepack pnpm install` failed due to DNS/network resolution (`ENOTFOUND registry.npmjs.org`), so JS dependency-based checks are currently blocked.
- 2026-03-05: Re-running `corepack pnpm install --force` again hit intermittent DNS resolution errors to `registry.npmjs.org`.
- 2026-03-05: `pnpm install` succeeds when run with elevated network permissions; default sandbox networking still intermittently fails for npm registry access.
- 2026-03-05: Rust toolchain (`cargo`) is unavailable in this environment, so desktop-helper Rust compile checks cannot run here.
- 2026-03-06: Shared web API helper assumed all successful responses returned JSON, which broke `204 No Content` mutation flows until the helper was fixed.
