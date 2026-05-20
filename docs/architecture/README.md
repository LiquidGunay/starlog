# Starlog Architecture

This directory is the concise architecture source-of-truth layer for Starlog. It does not replace
the product plan, current-state evidence, or operational runbooks. It binds them together so design
and implementation work has a small set of stable architecture references.

## Read Order

1. [assistant-runtime.md](assistant-runtime.md) - assistant runtime ownership and client/runtime boundaries.
2. [assistant-protocol.md](assistant-protocol.md) - durable assistant event, message, interrupt, and provenance contracts.
3. [interview-prep-loop.md](interview-prep-loop.md) - learning loop architecture from ingest through review and planning.
4. [deployment.md](deployment.md) - deployment topology, local runtime, and secret boundaries.

## Diagrams

Mermaid source diagrams live under [diagrams/](diagrams/). They are intentionally compact and should
change only when the durable architecture changes.

- [system-context.mmd](diagrams/system-context.mmd) - product surfaces, services, and external systems.
- [assistant-runtime-sequence.mmd](diagrams/assistant-runtime-sequence.mmd) - assistant request/run/event flow.
- [interview-prep-loop.mmd](diagrams/interview-prep-loop.mmd) - ingest, topic gating, review, and planner loop.
- [data-provenance.mmd](diagrams/data-provenance.mmd) - raw, normalized, extracted, generated, and versioned data chain.
- [deployment-topology.mmd](diagrams/deployment-topology.mmd) - Railway, local, device, and helper deployment shape.

## Relationship To Other Docs

- Product direction remains in [../../PLAN.md](../../PLAN.md) and [../../VISION.md](../../VISION.md).
- Assistant reset implementation detail remains in the root assistant reset docs:
  [../../starlog_surface_event_and_dynamic_ui_spec.md](../../starlog_surface_event_and_dynamic_ui_spec.md),
  [../../starlog_assistant_ui_backend_migration_design.md](../../starlog_assistant_ui_backend_migration_design.md),
  [../../starlog_assistant_ui_contracts_and_api_blueprint.md](../../starlog_assistant_ui_contracts_and_api_blueprint.md), and
  [../../starlog_assistant_ui_repo_execution_checklist.md](../../starlog_assistant_ui_repo_execution_checklist.md).
- Current works-today status remains in [../CURRENT_STATE.md](../CURRENT_STATE.md).
- Operational procedures remain in the relevant runbooks under [../](../).

## Maintenance Rule

Keep these files terse. Add architecture facts here when they are stable enough to guide multiple
implementation tasks. Put dated validation results in current-state or runbook evidence sections,
and put incident history in [../ENGINEERING_ISSUE_HISTORY.md](../ENGINEERING_ISSUE_HISTORY.md).
