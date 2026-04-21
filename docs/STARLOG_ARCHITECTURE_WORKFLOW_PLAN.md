# Starlog Architecture and Workflow Plan

This document is the docs-scoped execution companion to [PLAN.md](/home/ubuntu/starlog/PLAN.md).
`PLAN.md` remains the canonical product and architecture direction.

## Current Direction

- Starlog is being reset around the Assistant-first Life OS model in [VISION.md](/home/ubuntu/starlog/VISION.md).
- The active assistant migration references are:
  - [starlog_surface_event_and_dynamic_ui_spec.md](/home/ubuntu/starlog/starlog_surface_event_and_dynamic_ui_spec.md)
  - [starlog_assistant_ui_backend_migration_design.md](/home/ubuntu/starlog/starlog_assistant_ui_backend_migration_design.md)
  - [starlog_assistant_ui_contracts_and_api_blueprint.md](/home/ubuntu/starlog/starlog_assistant_ui_contracts_and_api_blueprint.md)
  - [starlog_assistant_ui_repo_execution_checklist.md](/home/ubuntu/starlog/starlog_assistant_ui_repo_execution_checklist.md)
- Web is the first client moving onto the new assistant protocol.
- Mobile remains functional on the legacy adapter until the new assistant slices are proven.

## System Boundaries

### `services/api`

- Owns assistant threads, messages, runs, interrupts, surface events, legacy compatibility,
  and the existing Starlog domain APIs.
- Preserves old `/v1/conversations/...` behavior while the new `/v1/assistant/...` stack lands.

### `services/ai-runtime`

- Owns prompts, orchestration, runtime capability manifests, tool planning, and eval fixtures.
- Keeps assistant and agent behavior definitions in user-editable markdown prompt files under
  `services/ai-runtime/prompts/`.
- Must emit tool-call and interrupt-aware outputs rather than only `response_text + cards`.

### `@starlog/contracts`

- Owns the shared assistant protocol for threads, message parts, runs, interrupts, events,
  ambient updates, attachments, cards, and legacy adapters.

## Current Workstream Order

1. Source-of-truth reset
   - Align docs and references with the assistant reset.
   - Remove or demote stale April/observatory-era guidance.
2. Shared assistant protocol
   - Land the new contract families in `@starlog/contracts`.
3. Assistant backend core
   - Add storage, schemas, services, and `/v1/assistant/...` routes.
4. Legacy adapter
   - Keep `/v1/conversations/primary/chat` and current clients working over the new core.
5. First vertical slices
   - `request_due_date`
   - `resolve_planner_conflict`
   - `triage_capture`
   - ambient surface updates
6. Web Assistant rebuild
   - Replace the current web assistant page with the new runtime-driven thread surface.
7. Cross-surface migration
   - Move mobile/helper onto the shared event and interrupt model after the web slices settle.

## Source Hierarchy

When documents disagree, use this order:

1. `PLAN.md`
2. `VISION.md`
3. `starlog_surface_event_and_dynamic_ui_spec.md`
4. `starlog_assistant_ui_backend_migration_design.md`
5. `starlog_assistant_ui_contracts_and_api_blueprint.md`
6. `starlog_assistant_ui_repo_execution_checklist.md`
7. `docs/ASSISTANT_UI_REFERENCE.md`
8. Current implementation/status/runbook docs
