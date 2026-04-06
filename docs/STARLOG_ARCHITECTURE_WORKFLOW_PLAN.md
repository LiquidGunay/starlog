# Starlog Architecture and Workflow Plan

This document is the docs-scoped execution companion to [PLAN.md](/home/ubuntu/starlog/PLAN.md).
`PLAN.md` remains the canonical product and architecture direction. This file exists to keep the
current observatory implementation order, system boundaries, and workstream decomposition in one
place under `docs/`, per the repo contract in `AGENTS.md`.

## Current Direction

- The active UX language is `Main Room`, `Knowledge Base`, `SRS Review`, and `Agenda`.
- Chat and voice are the canonical interaction model.
- The PWA is the primary synced workspace.
- Mobile is a focused companion for capture, alarms/offline briefing playback, and quick review.
- The April 2026 design pack in `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026`
  is the only active design source of truth for this implementation pass.

## System Boundaries

### `services/api`

- Owns auth, persistence, sync, calendar/task/review/artifact CRUD, queues, and tool execution.
- Stores the canonical conversation thread, messages, tool traces, and session-state reset data.
- Remains the stable backend contract for current web and mobile clients.

### `services/ai-runtime`

- Owns prompt templates, workflow assembly, provider adapters, and eval fixtures.
- Should remain the single source of truth for chat-turn prompt construction and orchestration.
- The API may proxy or fall back to local runtime helpers, but it should not accumulate duplicate
  prompt/workflow logic over time.

### Web PWA

- Hosts the canonical `Main Room` conversation surface.
- Hosts the full `Knowledge Base`, `SRS Review`, and `Agenda` workspaces.
- Keeps operator/debug lanes available but subordinate to the conversation and support views.

### Mobile Companion

- Shares the same primary conversation thread as web.
- Prioritizes Home chat, quick capture, alarms/briefings, and quick review.
- Should keep per-surface draft state independent so each tab behaves like its own tool.

## Current Workstream Order

1. Runtime boundary cleanup
   - Keep `services/ai-runtime` as the prompt/workflow owner.
   - Reduce API-side duplication and keep fallback loading lazy and deployment-safe.
2. Main Room transcript and tool-detail pattern
   - Conversation first.
   - Inline cards and tool traces stay attached to assistant turns.
   - Navigation-style card actions should route to the correct workspace.
3. Shared observatory component kit
   - Reusable shell, panel, navigation, transcript, and card primitives.
   - Preserve core interaction behaviors like collapsible side panes during redesign.
4. Support-view redesign on stable routes
   - `Knowledge Base` as the graph/editor/explorer workspace.
   - `SRS Review` as a focused review surface with collapsible context.
   - `Agenda` as the time-blocking and briefing workspace with collapsible sidecar context.
5. Mobile decomposition and redesign
   - Keep `Home / Notes / Calendar / Review`.
   - Move shared logic out of `App.tsx` into screen modules over time.
   - Maintain independent state for Home drafts, Notes capture instructions, and operator/debug commands.

## Current UI Interaction Rules

- Main transcript actions must do what they say.
  - Reuse actions may populate the composer.
  - Open actions must navigate to the target surface.
- Side panes across core web surfaces must remain collapsible.
- Mobile tabs must not share lossy composer state.
- Operator and diagnostics controls stay reachable, but they are not the primary visual center.

## Immediate Follow-up Work

- Complete the shared card-action model across more card kinds and surfaces.
- Finish the April visual pass for mobile screens after the structural split.
- Expand Playwright and screenshot proof for Main Room, support views, and mobile tabs.
- Continue reducing API/runtime duplication after the current PR fixes land.

## Source Hierarchy

When documents disagree, use this order:

1. `PLAN.md`
2. `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/**`
3. This file
4. Current implementation/status/runbook docs
