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

## Issue log
- (empty; add entries as they occur)
