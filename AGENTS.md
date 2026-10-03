# AGENTS.md — Starlog working instructions

## Start here

Read [PLAN.md](PLAN.md) first. It is the only canonical product plan and includes the accepted direction, first iteration, mature vision, open preferences, and next architecture decisions.

The existing application is legacy. Product implementation is not authorized by the planning reset. Do not assume its code, data model, routes, prompts, native clients, or deployment are the starting architecture.

Read [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) only for actual implementation evidence and [docs/PARALLEL_AGENT_WORKFLOW.md](docs/PARALLEL_AGENT_WORKFLOW.md) when its process applies.

## Context boundary

- Do not automatically read, summarize, index, or search docs/archive/ during normal planning or implementation.
- Earlier VISION, NEWPLAN, assistant reset documents, mockups, runbooks, and legacy status are archived there. They are historical evidence, not active requirements.
- Consult a specific archived file only for an explicit historical question or a concrete maintenance dependency. Read the minimum needed and identify any proposed reuse.
- Source-adjacent READMEs and services/ai-runtime/prompts/ describe the legacy implementation. They cannot override PLAN.md.
- The old apps/web/app/design reference pages are legacy code, not the new visual specification.
- .rgignore excludes archived context and legacy runtime prompts from ordinary ripgrep discovery. Use explicit paths or --no-ignore only when historical inspection is intended.
- Do not bulk-load every Markdown file. New work should need this file, PLAN.md, and narrowly relevant implementation files.

## Documentation ownership

- PLAN.md owns product scope, terminology, priorities, architecture decisions as they are made, and open questions. Update it in place.
- AGENTS.md owns durable engineering, collaboration, and context-loading rules. Keep product detail in PLAN.md.
- docs/CURRENT_STATE.md records what is implemented, tested, unproven, and the latest useful evidence.
- docs/PARALLEL_AGENT_WORKFLOW.md owns workitem locks and coordination.
- Detailed technical references and work tickets may be added when needed, but must link to the plan and not duplicate its vision or roadmap.
- Do not create another VISION.md, NEWPLAN.md, independent product PRD, or competing plan.
- When using third-party planning skills, write agreed product changes into PLAN.md. Their default document layout does not supersede the user's single-plan preference.
- Dated incident history belongs in docs/ENGINEERING_ISSUE_HISTORY.md when new history needs recording, not in this file.
- The archive preserves original bytes and paths in a manifest. Do not edit historical snapshots to make them look current.

## Repository workflow

Keep the canonical checkout at /home/ubuntu/starlog on master aligned with origin/master. Use it for orientation, status, and worktree management.

- Develop on a fresh codex/* branch from current origin/master in an isolated worktree.
- Do not commit directly to master or accumulate normal development in the canonical checkout.
- Use a suitable existing task worktree when already attached; do not create redundant worktrees.
- Follow the workitem lock protocol for implementation lanes. Deliver claimed work through a PR.
- Do not modify unrelated worktrees, user changes, or untracked files. Preserve explicitly archived untracked planning material before removing its old entrypoint.
- After an authorized merge, update canonical master, prune stale refs, and clean up the merged task worktree and branch when safe.
- Treat merged branches as immutable. Follow-ups use a fresh branch and PR.
- If history looks unexpectedly divergent, check shallow/grafted boundaries before assuming corruption.
- Ask before Railway deployment or production-facing changes. A merge that triggers Railway deployment is covered by this rule.
- Prefer longer coherent implementation passes with meaningful checkpoints.

## Collaboration

- Use subagents only when the user or applicable instructions explicitly request delegation.
- Supervisor-only mode is strict when explicitly selected: the supervisor scopes and reviews; workers read, edit, test, and handle conflicts. If tooling prevents this, ask for a mode correction.
- Keep a worker on one workitem/worktree/branch/role lane until handoff.
- Wait for progress and inspect objective evidence before treating silence as a problem. A stale heartbeat does not automatically expire a lock.

## Implementation guardrails

- Keep provider credentials in trusted server or worker storage, out of browser clients and committed artifacts.
- Keep model behavior in inspectable, versioned text alongside useful evaluation examples. The new location is an architecture decision; do not inherit the legacy prompt package by default.
- Prefer uv for Python environments if Python is selected.
- Prefer repo-local tool binaries when host-global tools are missing or inconsistent.
- Verify dependency links, environment paths, and generated outputs before trusting shared worktree state.
- Validate changed behavior with appropriate checks; use Playwright for web UX and retain current screenshot proof for visually sensitive changes.
- Refresh an approved visual reference before a major UI overhaul once the new reference exists. Archived mockups impose no design requirements.
- Report exact evidence and limitations; do not infer live provider, hosted, or phone success from mocks.
- Keep generated proof under ignored .localdata/, temporary, or build-output paths. Do not accumulate dated screenshot and log bundles in Git.
- Keep README.md user-facing and free of secrets. Keep active docs concise and path-stable.
