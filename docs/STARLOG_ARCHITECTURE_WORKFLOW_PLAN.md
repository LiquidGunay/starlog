# Starlog Architecture + Workflow Plan (Security, Offline PWA, Shared Worktree Locking)

Last updated: 2026-03-14

## Summary
- Keep `screen_design` as source of truth for all screens/components it explicitly shows.
- Implement additional functionality (offline notes/voice queue, bridge routing, conflict tooling, proactive features) in the same visual language/tokens/layout style of `screen_design`.
- Keep Railway as canonical control plane (sync, metadata, jobs, audit), with compute prioritized on bridges.
- Adopt secure worker communication and key handling as first-class architecture requirements.
- Replace repo-committed lock coordination with a shared live lock registry under common `.git` for all worktrees.

## Implementation Changes
### Design contract
- Treat `screen_design` IA labels/surfaces as canonical for shown items (`Command Center`, `Artifact Nexus`, `Neural Sync`, `Chronos Matrix`, mobile companion surfaces).
- New capabilities must be added as extensions of those surfaces (panels, cards, drawers, queue indicators), not as style-divergent standalone UIs.

### Execution policy model (capability-specific)
- Replace/extend execution targets for `llm`, `stt`, `tts` to: `mobile_bridge`, `desktop_bridge`, `api` (priority-ordered).
- Keep OCR local-only semantics.
- Default priority: `mobile_bridge -> desktop_bridge -> api`.
- STT/TTS bridge runtimes host local models; LLM on bridges runs Codex integration.
- API fallback remains OpenAI-compatible endpoint with configurable base URL/model.

### Canonical queue + bridge claiming
- All jobs are created and stored in Railway (single source of truth).
- Mobile/desktop workers only claim from Railway; no peer-to-peer queue sync in v1.
- Server claim arbitration uses policy order + worker heartbeat availability so the highest available preferred target claims first.

### Security model
- Production transport: HTTPS-only for worker/API communication (localhost HTTP allowed for local dev only).
- Worker auth flow: one-time pairing -> short-lived access token + refresh token -> periodic heartbeat.
- Worker tokens are capability-scoped and revocable.
- Provider/API keys remain encrypted at rest server-side and redacted in responses/logs.
- Mobile and desktop tokens/secrets move to OS secure storage (not plain SQLite/file persistence).
- Add audit trail for pairing, token refresh, worker claim/complete, and revocation events.

### Offline-first PWA ("full offline prep pack")
- Pre-cache app shell and critical route bundles for all main tabs.
- Add explicit "Offline Warmup" flow to preload route data snapshots.
- Ensure major tabs open/render offline using cached IndexedDB state even when API calls fail.
- Add offline mutation queues for notes create/update and review submissions.
- Add offline voice capture queue in PWA (persist media blob locally; upload/transcribe when online).
- Keep visible sync/queue status per tab.

### Conflict defensibility
- Add optimistic concurrency with entity `revision` and mutation `base_revision`.
- On revision mismatch, return structured conflict (no silent overwrite).
- Provide explicit resolution actions: `local_wins`, `remote_wins`, `merged_patch`.
- Keep full mutation/conflict audit history for traceability.

### Shared multi-agent workitem locking in `.git`
- Canonical coordination root: `$(git rev-parse --git-common-dir)/codex-workitems/`.
- Files:
  - `workitems.json` (authoritative task list/status/owner metadata)
  - `locks/<workitem_id>.lock` (active lock record)
  - `audit.jsonl` (append-only lock lifecycle log)
  - `.registry.lock` (file lock for atomic edits)
- Lock protocol:
  - claim before implementation starts,
  - heartbeat every 2 minutes,
  - stale lock TTL 10 minutes,
  - release on completion/handoff,
  - forced steal only with explicit reason recorded in audit.
- Keep `docs/CODEX_PARALLEL_WORK_ITEMS.md` as human-readable backlog mirror; live lock authority is `.git` registry.

## Public API / Interface Changes
### Execution policy schema
- Update policy targets and `available_targets` to include `mobile_bridge`, `desktop_bridge`, `api`.
- Return resolved route metadata per capability for clients.

### Worker management APIs
- Add worker pairing/auth/refresh/heartbeat/list/revoke endpoints.

### AI jobs
- Add job routing metadata fields: requested target order, selected target, claimed worker class.
- Enforce scoped claims by worker capability/target class.

### Conflict APIs
- Add conflict list/get/resolve endpoints and conflict payload shape.

### Client storage interfaces
- Add secure-token storage abstraction in mobile/desktop clients.
- Extend PWA offline queue schema to support persisted voice media queue items.

## Test Plan
### Security
- Verify HTTPS enforcement in production mode.
- Verify token expiry/refresh/revoke behavior.
- Verify secrets never appear unredacted in logs/UI responses.

### Routing
- Validate policy priority behavior (`mobile_bridge -> desktop_bridge -> api`) under varying worker availability.
- Validate mobile-originated jobs can be processed by desktop bridge when mobile bridge unavailable.

### Offline
- Validate offline warmup enables all key tabs to open offline.
- Validate offline note edits and offline voice capture queue replay successfully after reconnect.
- Validate offline review queue replay for PWA.

### Conflict
- Simulate concurrent mobile/desktop updates to same entity and verify conflict creation + explicit resolution.

### Locking
- Concurrency test: two agents claim same workitem simultaneously; exactly one succeeds.
- TTL/heartbeat test for stale lock reclaim.
- Audit integrity test for claim/release/force-steal lifecycle.

## Assumptions and Defaults
- All concurrent agents/worktrees share the same physical repository common `.git` directory.
- Railway API runs behind HTTPS in production.
- `screen_design` governs UI structure/style for shown surfaces; extra capabilities are integrated without breaking that design language.
- Bridge Codex integration is treated as mandatory for `mobile_bridge` and `desktop_bridge`, with API fallback preserved for availability.
