# Assistant UI Reference

This document is the active repo-local interface reference for the Starlog assistant reset.
Use it with the assistant reset docs and the current concept pack when changing Assistant UI.

Reference implementation:
- [apps/web/app/design/assistant-runtime-reference/page.tsx](/home/ubuntu/starlog/apps/web/app/design/assistant-runtime-reference/page.tsx)

Primary architecture sources:
- [VISION.md](/home/ubuntu/starlog/VISION.md)
- [starlog_surface_event_and_dynamic_ui_spec.md](/home/ubuntu/starlog/starlog_surface_event_and_dynamic_ui_spec.md)
- [starlog_assistant_ui_backend_migration_design.md](/home/ubuntu/starlog/starlog_assistant_ui_backend_migration_design.md)
- [starlog_assistant_ui_contracts_and_api_blueprint.md](/home/ubuntu/starlog/starlog_assistant_ui_contracts_and_api_blueprint.md)
- [starlog_assistant_ui_repo_execution_checklist.md](/home/ubuntu/starlog/starlog_assistant_ui_repo_execution_checklist.md)

## What This Reference Must Optimize For

- The thread is the main operating surface.
- The assistant knows about support-surface activity through structured events.
- Dynamic panels are anchored, small, and consequential.
- Cards are summaries and follow-up affordances, not the main interaction primitive.
- The UI must feel like one continuous operational surface rather than stacked chat bubbles.

## Core Layout Model

- Main transcript column
  - Persistent thread with message clusters, ambient updates, run state, and integrated
    attachments.
- Active context rail
  - Focus entity, open interrupt, recent surface events, and relevant suggestions.
- Composer dock
  - Voice and text entry remain explicit, persistent, and visually primary at rest.

## Message Part Hierarchy

- `text`
  - Natural-language guidance or confirmation.
- `ambient_update`
  - Compact activity rows from Library, Planner, Review, desktop helper, or system routines.
- `tool_call`
  - Visible run state and named tool execution.
- `interrupt_request`
  - Thread-native structured input request.
- `interrupt_resolution`
  - Compact record of the user’s submitted resolution.
- `card`
  - Result summary, queue snapshot, or follow-up action block.
- `attachment`
  - Artifact, image, audio, file, or citation references tied to the turn.

## Dynamic Panel Rules

- Panels ask only for the minimum missing structure.
- Panels are dismissible and must degrade to plain thread/card actions if rich UI is not
  available.
- Panels are appropriate for:
  - task due date completion
  - planner conflict choice
  - capture triage
  - review grading
  - morning-focus selection
- Panels are not appropriate for deep document editing or full planner workflows.

## Visual Guardrails

- Do not preserve observatory-era naming or shell composition for its own sake.
- Avoid stacked generic cards, decorative dashboards, or debug panes competing with the thread.
- The thread should look operational, calm, and serious, with clear status changes and strong
  hierarchy.
- Mobile and web should share one system language, with ergonomics adapting by layout rather
  than by divergent themes.
