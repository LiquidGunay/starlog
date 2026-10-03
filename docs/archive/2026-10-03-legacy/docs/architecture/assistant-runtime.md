# Assistant Runtime Architecture

Starlog's Assistant is a server-owned, cross-client runtime with one persistent user thread. Web and
native clients render the thread and submit user intent; they do not own the canonical run state.

## Ownership

- `services/api` is the system of record for threads, messages, runs, run steps, interrupts, tool
  execution state, surface events, attachments, and durable Starlog domain state.
- `services/ai-runtime` owns prompts, orchestration policies, provider adapters, local/hosted model
  routing, and eval-oriented AI logic.
- `packages/contracts` carries shared client/server TypeScript contracts where frontend and backend
  agreement is needed.
- Web and native clients adapt server snapshots into assistant-ui-compatible views while preserving
  the Starlog protocol as the canonical contract.

## Client Boundaries

- Desktop web and native mobile are primary clients.
- Mobile PWA is fallback-only and useful for browser/viewport validation, not the primary phone UX.
- The desktop helper is capture-first. It can hand off context to the Assistant, but it is not a
  second full assistant client.
- Browser clipper, desktop helper, and mobile capture create artifacts and surface events that feed
  the same persistent Assistant thread.

## Runtime Flow

1. A client submits text, voice transcript, capture context, or a guarded action confirmation.
2. `services/api` appends the user event/message and creates or resumes a run.
3. `services/ai-runtime` chooses hosted/local providers, prompts, tools, and fallback behavior.
4. Tool calls and interrupts are persisted as run steps with typed payloads.
5. Clients render streamed or polled snapshots as typed message parts, panels, and surface events.
6. Major writes stay pending until explicit user confirmation.

See [diagrams/assistant-runtime-sequence.mmd](diagrams/assistant-runtime-sequence.mmd).

## Migration Boundary

assistant-ui is the strategic web+native chat runtime. The Starlog assistant protocol remains the
source of truth. Compatibility projections can stay during migration, but new runtime work should
move toward typed message parts, tool lifecycle, interrupts, and durable surface events.

Current evidence and unproven gaps remain in [../CURRENT_STATE.md](../CURRENT_STATE.md).
