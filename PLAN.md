# Starlog Plan: Assistant-First Life OS

`PLAN.md` is the canonical forward-looking product and architecture plan for Starlog.
The repo-local vision and assistant migration documents define the active implementation
basis for this plan:

- [VISION.md](/home/ubuntu/starlog/VISION.md)
- [starlog_surface_event_and_dynamic_ui_spec.md](/home/ubuntu/starlog/starlog_surface_event_and_dynamic_ui_spec.md)
- [starlog_assistant_ui_backend_migration_design.md](/home/ubuntu/starlog/starlog_assistant_ui_backend_migration_design.md)
- [starlog_assistant_ui_contracts_and_api_blueprint.md](/home/ubuntu/starlog/starlog_assistant_ui_contracts_and_api_blueprint.md)
- [starlog_assistant_ui_repo_execution_checklist.md](/home/ubuntu/starlog/starlog_assistant_ui_repo_execution_checklist.md)

## Summary

- Starlog is a single-user Life OS and lifelong learning engine.
- The product is centered on one persistent `Assistant` thread that orchestrates capture,
  planning, execution, review, and adaptation.
- `Library`, `Planner`, and `Review` remain first-class support surfaces, but they feed
  structured state and events back into the Assistant thread instead of behaving like
  isolated apps.
- The near-term product priority is execution support for known goals: capture-to-action,
  dependable planning, review loops, daily briefings, and follow-through.
- The canonical assistant architecture is a Starlog-owned source-of-truth
  thread/run/interrupt/message-part protocol, with a shared dynamic UI registry and
  assistant-ui as the long-term chat runtime across desktop web and native mobile.
- Desktop web and native mobile are both primary assistant surfaces; mobile PWA remains
  a fallback viewport for repeatable checks.
- This is a system overhaul, not a reskin of the existing observatory-era interface.

## Product Model

### Core identity

- Starlog is not primarily a passive archive, generic chatbot, note store, or task board.
- Starlog exists to help one user:
  - capture what matters
  - build durable systems for action and learning
  - follow through consistently
  - review, adapt, and improve over time
- Product decisions should favor progress, learning depth, system quality, and compounding
  long-term usefulness over convenience features that do not materially improve the user.

### Canonical operating loop

- The default Starlog loop is:
  - capture
  - understanding
  - planning
  - execution
  - review
  - adaptation
- The Assistant thread should make this loop feel continuous and personalized rather than
  forcing the user to manually narrate their own activity back into chat.

### Surfaces

- `Assistant`
  - The canonical operating surface and persistent thread.
  - Owns orchestration, structured follow-up, daily guidance, and cross-surface context.
- `Library`
  - Captures, artifacts, notes, provenance, and source fidelity.
- `Planner`
  - Tasks, calendar, time blocks, conflicts, and briefings.
- `Review`
  - Recall, quizzes, drills, grading, and focused reinforcement loops.

### Bounded proactivity

- The assistant should proactively surface useful next steps, missed commitments, due review,
  planner conflicts, and capture follow-up when there is clear value.
- Major writes still require explicit confirmation or explicit user completion of a structured
  interrupt.
- Near-term proactivity is execution-support oriented, not open-ended life coaching.

## Experience Direction

### Thread first

- The Assistant thread is the center of the product.
- Support surfaces should emit structured surface events into the thread so the assistant can
  react to what the user is doing without making them restate it.
- Visible ambient updates should keep the thread aware of cross-surface activity without
  turning every event into a full assistant message.

### Dynamic UI

- Dynamic panels are thread-native structured interactions attached to a turn, card, or
  composer state.
- On desktop they should appear as anchored popups or sidecars tied to the thread context.
- On mobile they should appear as bottom sheets that preserve thread context.
- Both surfaces should consume the same shared dynamic panel registry so panel behavior,
  validation, and telemetry stay aligned across desktop and native clients.
- Panels are for minimal missing structure, quick triage, conflict resolution, and compact
  decisions. They are not a hidden second full workspace.

### Broad UI overhaul

- Do not optimize for preserving observatory-era shell assumptions, stacked card layouts, or
  the old `content + cards + traces` rendering model.
- The thread UI should be rebuilt around message parts, tool lifecycle, interrupts, ambient
  updates, and integrated attachments.
- Keep the conversation as the visual and behavioral center. Diagnostics stay reachable but
  secondary.

## Architecture Direction

### Backend protocol

- Starlog must move from:
  - message content string
  - cards array
  - separate tool traces
- To:
  - assistant threads
  - typed messages with typed parts
  - runs and run steps
  - interrupts and resolutions
  - surface events
  - ambient updates
  - card projections as one projection mechanism among several

### Ownership boundaries

- `services/api`
  - Remains the system of record for threads, messages, runs, interrupts, events, tasks,
    artifacts, planner data, review data, and tool execution.
  - Owns legacy compatibility for existing `/v1/conversations/...` clients during migration.
- `services/ai-runtime`
  - Remains the AI orchestration service for prompts, provider adapters, runtime capability
    manifests, tool planning, and evaluation fixtures.
  - Assistant and agent behavior prompts must live as repo-local markdown files under
    `services/ai-runtime/prompts/` so the user can inspect and edit them directly.
  - Must evolve from `response_text + cards` into tool-call / interrupt-aware runtime output.
- `@starlog/contracts`
  - Becomes the shared assistant protocol package for threads, parts, runs, interrupts,
    events, ambient updates, attachments, cards, and legacy adapters.

### API shape

- Introduce a new canonical `/v1/assistant/...` route family for:
  - threads
  - thread snapshots
  - create-message/start-run
  - run status
  - interrupt submit/dismiss
  - surface-event ingestion
  - update feed and SSE stream
- Keep `/v1/conversations/primary/chat` and related legacy endpoints only as compatibility
  projections over the new assistant core while non-primary clients transition.

## Migration Order

1. Source-of-truth reset
   - Align `PLAN.md`, `AGENTS.md`, and repo-local design references to the new assistant
     direction and retire stale April-era guidance.
2. Shared protocol
   - Expand `@starlog/contracts` into the assistant thread/run/interrupt/event protocol while
     keeping legacy exports available.
3. Assistant backend
   - Add assistant storage, schemas, services, and `/v1/assistant` routes.
   - Route deterministic commands and AI turns through one run model.
4. First vertical slices
   - `request_due_date`
   - `resolve_planner_conflict`
   - `triage_capture`
   - ambient surface updates
5. Assistant runtime convergence
   - Replace current Assistant entry surfaces with shared assistant-ui shells backed by the same
     shared protocol + dynamic UI registry, then harden Starlog-specific tool UIs for both
     desktop web and native mobile.
6. Cross-surface convergence
   - Keep desktop web and native mobile on the shared event + interrupt protocol and move
     helper/browser-only paths to this registry-driven flow as adapters as they migrate.

## Initial Tool UI Scope

- `request_due_date`
  - Fill the minimum missing task fields before creating a task.
- `resolve_planner_conflict`
  - Resolve a structured overlap without forcing a full Planner switch.
- `triage_capture`
  - Classify new captures and choose the next action.
- `grade_review_recall`
  - Support compact review grading from the thread when launched there.
- `choose_morning_focus`
  - Select the first bounded move from a briefing.

## Validation Requirements

- Contract tests for new assistant protocol types and legacy adapters.
- Storage/API tests for assistant thread snapshots, runs, interrupts, events, updates, and
  migration-safe additive storage.
- Backend behavior tests showing deterministic command flows can interrupt and resume.
- Cross-surface UI tests for runtime hydration, interrupt rendering, ambient updates, and no duplicate
  transcript state.
- Cross-surface evidence for planner, review, helper, and Library events feeding the thread.

## Defaults and Constraints

- One visible persistent user thread remains the canonical UX.
- Desktop web and native mobile are both primary recipients for the new assistant protocol.
- Mobile PWA remains fallback-only and is validated via viewport smoke checks.
- The first end-to-end acceptance path is interview-prep with native dynamic-panel mutation and grade persistence.
- The April pack and the old chat moodboard are historical references only.
- Support surfaces remain necessary for deep editing; Starlog is assistant-first, not
  assistant-only.
- The desktop helper remains a capture-first companion, not a second full assistant client.
