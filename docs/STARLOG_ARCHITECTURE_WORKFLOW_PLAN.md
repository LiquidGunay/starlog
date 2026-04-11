# Starlog Architecture and Workflow Plan

This document is the docs-scoped execution companion to [PLAN.md](/home/ubuntu/starlog/PLAN.md).
`PLAN.md` remains the canonical product and architecture direction. This file exists to keep the
current implementation order, system boundaries, and workstream decomposition in one place under
`docs/`, per the repo contract in `AGENTS.md`.

## Current Direction

- The active user-facing surface model is `Assistant`, `Library`, `Planner`, and `Review`.
- Chat and voice are the canonical interaction model.
- Desktop web is the primary polished web workspace.
- Native mobile is the primary mobile client.
- The mobile PWA remains a functional fallback, not a redesign target.
- The desktop helper is a capture-first companion for clipboard/screenshot intake and handoff.
- The April 2026 design pack in `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026`
  is the only active design source of truth for this implementation pass.

## System Boundaries

### `services/api`

- Owns auth, persistence, sync, calendar/task/review/artifact CRUD, queues, and tool execution.
- Stores the canonical conversation thread, messages, tool traces, and session-state reset data.
- Projects structured assistant cards for web, mobile, and helper surfaces.

### `services/ai-runtime`

- Owns prompt templates, workflow assembly, provider adapters, and eval fixtures.
- Should remain the single source of truth for chat-turn prompt construction and orchestration.
- The API may proxy or fall back to local runtime helpers, but it should not accumulate duplicate
  prompt/workflow logic over time.

### `@starlog/contracts`

- Owns shared Assistant card/action types and durable cross-surface product copy constants.
- Prevents web, mobile, API, and helper surfaces from drifting on labels and card structure.

### Desktop web

- Hosts the canonical desktop `Assistant` conversation surface.
- Hosts the full `Library`, `Planner`, and `Review` workspaces.
- Keeps operator/debug lanes available but subordinate to the transcript and support views.

### Native mobile

- Shares the same primary conversation thread as web.
- Prioritizes mobile-first Assistant use, capture, alarms/briefings, and quick review.
- Should keep per-surface draft state independent so each tab behaves like its own tool.

### Desktop helper

- Prioritizes capture, recent items, and handoff into Assistant/Library.
- Keeps diagnostics and bridge/runtime details available but visually secondary.

## Current Workstream Order

1. Documentation cleanup
   - Remove stale observatory naming and PWA-everywhere guidance from active docs.
   - Align product language around `Assistant / Library / Planner / Review`.
   - Recast the desktop helper docs around capture-first workflows.
2. Shared Assistant contracts
   - Add shared card/action/product-copy contracts in `@starlog/contracts`.
   - Use those contracts across API, web, mobile, and helper surfaces.
3. Assistant orchestration and card projection
   - Keep `/v1/conversations/primary/chat` as the canonical chat execution path.
   - Route actionable turns through the planner/tool catalog.
   - Project primary card kinds server-side with typed actions and legacy-card backfill.
4. Desktop web Assistant rebuild
   - Keep the transcript as the center of the UI.
   - Render cards inline under assistant turns.
   - Default operator/debug lanes to collapsed.
   - Apply plain professional copy while keeping route ids stable.
5. Native mobile rebuild
   - Make `Assistant` the default landing tab.
   - Keep `Library`, `Planner`, and `Review` as mobile-first return points.
   - Remove `Open PWA` from the main flow.
   - Continue extracting surface-specific logic from `App.tsx`.
6. Support-view cleanup
   - Rename navigation, empty states, and support copy across web/mobile/auth flows.
   - Preserve stable route ids and existing deep-work capabilities.
7. Desktop helper repositioning
   - Center the helper on clipboard/screenshot capture, recent captures, and Assistant/Library handoff.
   - Keep diagnostics reachable but not primary.

## Current UI Interaction Rules

- Assistant card actions must do what they say.
  - `navigate` actions open the target support view.
  - `composer` actions prefill the assistant composer without losing thread context.
  - `mutation` actions run through existing write endpoints with optimistic feedback plus thread refresh.
- Desktop web side panes across core surfaces must remain collapsible.
- Mobile tabs must not share lossy composer state.
- Operator and diagnostics controls stay reachable, but they are not the primary visual center.
- Helper recent-item actions must make it obvious whether the user is opening a capture in Library or
  asking Assistant to act on it.

## Immediate Follow-up Work

- Expand the shared card-action model across remaining card kinds and support surfaces.
- Add more eval and fixture coverage for card selection quality and structured-result projection.
- Expand Playwright and screenshot proof for desktop Assistant, support views, mobile tabs, and helper handoff.
- Continue reducing API/runtime duplication after the canonical conversation path is stable.

## Source Hierarchy

When documents disagree, use this order:

1. `PLAN.md`
2. `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/**`
3. This file
4. Current implementation/status/runbook docs
