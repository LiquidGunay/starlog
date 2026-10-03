# AGENTS.md — Starlog repo instructions

## Product goal
Build Starlog as a single-user, low-cost, independent Life OS and lifelong learning engine.

## Locked v1 preferences
- Voice/chat-first interaction is the canonical operating model; buttons and direct surface interactions are secondary.
- One persistent user chat thread exists across clients, with durable long-term memory and clearable short-term session state.
- Desktop web and the native mobile app are both primary products.
- The mobile PWA is fallback-only and must not absorb primary UX redesign effort.
- iOS share-specific work is out of scope for v1 distribution and must not block v1 release readiness.
- Clipping is first-class: browser clipper + cross-platform desktop helper (Tauri) + mobile share capture.
- The approved user-facing surface taxonomy is `Assistant`, `Library`, `Planner`, and `Review`.
- The desktop helper is a capture-first companion, not a second full assistant client.
- Knowledge model uses an artifact graph with explicit provenance links.
- Keep version history for summaries/cards generated from the same artifact.
- Preserve source fidelity: raw + normalized + extracted.
- OCR is strict on-device only.
- STT/TTS is on-device first (local model spin-up allowed).
- LLM orchestration is OpenAI-primary for v1, with local-first voice runtimes and fallback providers.
- Proactive behavior is limited to preparing suggestions; major writes still require explicit confirmation.
- Calendar is internal model + two-way Google Calendar sync.
- Include tasks + time blocking.
- Morning alarm + spoken briefing with offline playback on phone.
- Daily briefings unify schedule/task guidance with research digest output when relevant.
- Minimize hosting cost; Railway hobby footprint preferred.

## AI provider policy
- Prefer local/on-device providers for voice when available.
- Prefer a separate in-repo Python AI runtime for prompts, orchestration, provider adapters, and evals.
- Use OpenAI as the primary hosted LLM provider for v1 orchestration and summarization flows.
- Codex subscription bridge is best-effort/experimental.
- Always keep fallback path (supported API-key provider/local alternative) for availability.

## Repo process rule
When a recurring preference, reusable guardrail, or durable process rule is discovered, update this file.
Put dated incident history and one-off issue chronology in a dedicated doc under `docs/`, not in `AGENTS.md`.

## Design and architecture sources of truth

Use the repo-local assistant reset documents as the active source of truth for Assistant redesign and assistant stack work.

- Treat [VISION.md](/home/ubuntu/starlog/VISION.md), [starlog_surface_event_and_dynamic_ui_spec.md](/home/ubuntu/starlog/starlog_surface_event_and_dynamic_ui_spec.md), [starlog_assistant_ui_backend_migration_design.md](/home/ubuntu/starlog/starlog_assistant_ui_backend_migration_design.md), [starlog_assistant_ui_contracts_and_api_blueprint.md](/home/ubuntu/starlog/starlog_assistant_ui_contracts_and_api_blueprint.md), and [starlog_assistant_ui_repo_execution_checklist.md](/home/ubuntu/starlog/starlog_assistant_ui_repo_execution_checklist.md) as the active product and implementation basis for assistant work.
- Treat [docs/ASSISTANT_UI_REFERENCE.md](/home/ubuntu/starlog/docs/ASSISTANT_UI_REFERENCE.md) and [apps/web/app/design/assistant-runtime-reference/page.tsx](/home/ubuntu/starlog/apps/web/app/design/assistant-runtime-reference/page.tsx) as the active repo-local UI reference artifacts.
- Treat [artifacts/ui-concept/pwa/EXPLANATION_OF_SCREENS_PWA.md](/home/ubuntu/starlog/artifacts/ui-concept/pwa/EXPLANATION_OF_SCREENS_PWA.md), [artifacts/ui-concept/mobile/EXPLANATION_OF_SCREENS_MOBILE.md](/home/ubuntu/starlog/artifacts/ui-concept/mobile/EXPLANATION_OF_SCREENS_MOBILE.md), and their sibling PNG mockups as active UI implementation references.
- When older docs or UI references conflict with the assistant reset documents, prefer the new assistant reset documents and update or remove the stale references.

## Default execution mode

Keep the canonical checkout at `/home/ubuntu/starlog` on `master` aligned with `origin/master`.
Use it for orientation, status checks, branch cleanup, and worktree management; do not use it as the
place where normal development accumulates.

- Work on one task at a time on a fresh `codex/*` branch from current `origin/master`, checked out
  in an isolated worktree.
- Do not commit directly on local `master`, and do not leave local `master` pointing at old PR bases
  or stale feature work.
- After a PR merges, update the canonical checkout back to `origin/master`, prune stale refs and
  worktrees, delete merged local branches when safe, and start the next task from a fresh worktree.
- If local and remote history appear wildly divergent, check whether the checkout is shallow or has
  grafted boundaries before assuming a bad merge or rewritten history.
- If a merge-conflict lesson or process failure repeats, distill the durable takeaway into this file and archive the dated incident detail in `docs/ENGINEERING_ISSUE_HISTORY.md`.

For parallel-agent coordination, workitem locks, worktree hygiene, and shared dependency reuse, use [docs/PARALLEL_AGENT_WORKFLOW.md](/home/ubuntu/starlog/docs/PARALLEL_AGENT_WORKFLOW.md).

## Supervisor-worker operating model

When the user or supervising agent says the main assistant is supervisor-only, treat that as a
strict operating mode, not a style preference.

- The supervisor defines scope, sequencing, checkpoints, and acceptance criteria.
- Worker agents do repo reading, writing, testing, review, merge-conflict handling, and handoff
  reporting for their assigned lane.
- Supervisors may inspect high-level worker evidence, status, and final handoff material, but should
  not directly edit files, run validation, or resolve conflicts unless the user explicitly overrides
  supervisor-only mode.
- Keep each worker on one `{workitem_id, worktree, branch, role}` lane until handoff. Use role names
  such as `IMPLEMENT`, `VALIDATE`, `REVIEW`, or `CLEANUP` in the workitem title and lock metadata
  when available.
- If a worker is silent, use `wait_agent` or objective evidence before nudging. Do not treat a short
  missing final response, stale heartbeat, or long-running command as failure by itself.
- If supervisor-only mode conflicts with the available tooling or sandbox, stop and ask for a mode
  correction instead of silently falling back to direct edits.

## Artifact and proof retention

Keep repo-tracked artifacts small and current.

- Keep `artifacts/ui-concept/**` as the active visual concept reference until it is intentionally
  replaced.
- Do not accumulate dated screenshot comparisons, old phone captures, stale smoke logs, or generated
  proof bundles in git. Keep generated validation output under `.localdata/`, `/tmp`, ignored
  build/output folders, or a single latest proof path only when a repo-tracked proof is explicitly
  required.
- When refreshing proof for a merge, replace or delete older proof output from the same validation
  lane in the same PR. Historical proof chronology belongs in `docs/ENGINEERING_ISSUE_HISTORY.md` or
  a concise dated note in the relevant runbook, not in committed artifact folders.
- Current works-today/unproven status belongs in `docs/CURRENT_STATE.md`; current UI targets belong
  in `docs/ASSISTANT_UI_REFERENCE.md`, `apps/web/app/design/assistant-runtime-reference/page.tsx`,
  and `artifacts/ui-concept/**`.

## Merge-time doc set

Every PR should check whether the fixed doc set needs an update, but should edit only the docs whose
truth actually changed.

- `AGENTS.md` for durable process, product, artifact-retention, branch, or collaboration rules.
- `PLAN.md` and `VISION.md` for forward-looking product or architecture direction.
- Assistant reset docs (`starlog_surface_event_and_dynamic_ui_spec.md`,
  `starlog_assistant_ui_backend_migration_design.md`,
  `starlog_assistant_ui_contracts_and_api_blueprint.md`, and
  `starlog_assistant_ui_repo_execution_checklist.md`) for assistant protocol/runtime plan changes.
- `docs/architecture/**` for concise architecture source-of-truth summaries and diagrams that bind
  the active product/runtime/deployment docs together.
- `docs/CURRENT_STATE.md` for works-today, unproven, access, and latest evidence status.
- `docs/ASSISTANT_RUNTIME_ARCHITECTURE_DECISION.md`, `docs/ASSISTANT_UI_REFERENCE.md`, and
  `apps/web/app/design/assistant-runtime-reference/page.tsx` for runtime/UI reference changes.
- `docs/USER_GUIDE.md` for user-visible workflow changes.
- The relevant runbook/checklist under `docs/` when commands, validation gates, deployment, Android,
  Railway, desktop helper, or phone setup steps change.
- `docs/ENGINEERING_ISSUE_HISTORY.md` for dated incident chronology and repeated process failures.
- `docs/RELEASE_HANDOFF.md` only through the release handoff generator unless intentionally syncing
  generated release metadata.

Avoid duplicate planning/status/comparison docs. If a new doc looks like another source of truth,
update the fixed doc set instead or archive the one-off detail as incident/history.


## Documentation taxonomy

Keep documentation incremental and path-stable. Prefer adding a focused note to the existing fixed
doc set over moving files or creating another source of truth. Move or rename only when the old path
is clearly obsolete, link-safe, and worth the churn.

- **Architecture truth:** `PLAN.md`, `VISION.md`, assistant reset docs, and `docs/architecture/**`.
  Use these for durable product, runtime, protocol, data, and deployment shape.
- **Current state:** `docs/CURRENT_STATE.md`. Use it for what works today, what is unproven, access
  notes, and latest evidence pointers.
- **Runbooks:** operational docs under `docs/` such as Android, Railway, phone setup, desktop helper,
  release handoff, go-live, and portability procedures.
- **Validation:** repeatable smoke matrices, harness docs, and validation scripts. Current proof
  output belongs in `.localdata/`, `/tmp`, ignored build output, or one explicitly current proof path.
- **Release:** `docs/RELEASE_HANDOFF.md`, `docs/RELEASE_HANDOFF_RUNBOOK.md`, and
  `scripts/release_handoff.py`.
- **History:** `docs/ENGINEERING_ISSUE_HISTORY.md` and `docs/IMPLEMENTATION_STATUS.md`. Do not put
  dated incident chronology or stale comparison proof in `AGENTS.md`.

## Markdown map

This section is the repo-local purpose map for markdown files so agents know which docs are authoritative before opening or editing them.

- `AGENTS.md` — repo instructions, stable product/collaboration preferences, lock protocol, branch hygiene, markdown map, and durable engineering guardrails.
- `PLAN.md` — canonical forward-looking product and architecture direction for Starlog.
- `VISION.md` — product identity and decision filter for Starlog as a Life OS and lifelong learning engine.
- `starlog_surface_event_and_dynamic_ui_spec.md` — canonical assistant thread event/panel behavior spec.
- `starlog_assistant_ui_backend_migration_design.md` — canonical repo-specific backend migration design for assistant-ui adoption.
- `starlog_assistant_ui_contracts_and_api_blueprint.md` — canonical contracts, API, and storage blueprint for the new assistant protocol.
- `starlog_assistant_ui_repo_execution_checklist.md` — canonical execution-ordered migration checklist for the assistant reset.
- `README.md` — top-level user-facing product README for install, sign-in handoff, release status, and operator entrypoints; keep developer internals and secrets out of it.
- `docs/CURRENT_STATE.md` — concise current-state summary for what works today, what remains unproven, and where the evidence lives.
- `docs/architecture/README.md` — architecture index and taxonomy bridge for source-of-truth architecture notes and diagrams.
- `docs/architecture/assistant-runtime.md` — concise assistant runtime ownership, client, orchestration, and migration architecture.
- `docs/architecture/assistant-protocol.md` — durable assistant protocol, event, message-part, interrupt, and provenance contract summary.
- `docs/architecture/interview-prep-loop.md` — architecture of the study/interview preparation loop across ingest, topic gating, review, and planning.
- `docs/architecture/deployment.md` — deployment topology, secret boundaries, local runtimes, and Railway/mobile/helper responsibilities.
- `docs/ASSISTANT_RUNTIME_ARCHITECTURE_DECISION.md` — assistant runtime option decision record: assistant-ui as strategic web+native chat runtime, Starlog protocol as source of truth, MCP Apps as pattern not dependency, and rejected/deferred alternatives.
- `docs/ASSISTANT_UI_REFERENCE.md` — active repo-local UI reference for the assistant reset.
- `artifacts/ui-concept/pwa/EXPLANATION_OF_SCREENS_PWA.md` — active PWA UI concept reference; use with sibling PNG mockups.
- `artifacts/ui-concept/mobile/EXPLANATION_OF_SCREENS_MOBILE.md` — active mobile UI concept reference; use with sibling PNG mockups.
- `docs/ANDROID_DEV_BUILD.md` — Android dev-build/native-module path, release-signing policy, and Android validation flow.
- `docs/ANDROID_STORE_DISTRIBUTION_CHECKLIST.md` — Android store metadata, signing, packaging, and submission checklist.
- `docs/CODEX_AGENT_PROVIDER_FEASIBILITY.md` — Codex SDK/provider feasibility note, server-side bridge recommendation, and client-secret guardrails for PWA/mobile agent work.
- `docs/ENGINEERING_ISSUE_HISTORY.md` — archived dated issue chronology and host-specific debugging history that should not live inline in `AGENTS.md`.
- `docs/PARALLEL_AGENT_WORKFLOW.md` — subagent-only workflow for workitem locking, extra worktrees, branch cleanup, and shared dependency reuse.
- `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md` — daily-use install, prerequisite, config, smoke, and reset handoff for the desktop helper on the main laptop.
- `docs/DESKTOP_HELPER_V1_RELEASE.md` — desktop helper distribution runbook, artifact pipeline, and release packaging notes.
- `docs/IMPLEMENTATION_STATUS.md` — historical implementation log and validation chronology; prefer `docs/CURRENT_STATE.md` for current works-today/unproven status.
- `docs/LOCAL_AI_WORKER.md` — laptop-local AI worker responsibilities, provider routing, and runtime setup.
- `docs/CODEX_PHONE_PWA_CONNECTION.md` — user-facing guide for connecting phone/PWA Starlog clients to Codex through the API, local worker, or experimental server-side bridge without exposing provider credentials in clients.
- `docs/PHONE_SETUP.md` — laptop-to-phone local testing and setup guide for PWA/mobile use.
- `docs/RAILWAY_PROJECT_SETUP_STATUS.md` — current real Railway project/service state, generated domains, pending deploy-time config, and cost estimate for WI-443.
- `docs/UI_FUNCTIONAL_TEST_HARNESSES.md` — repeatable PWA and mobile-viewport functional smoke commands for assistant dynamic-panel UI validation.
- `docs/USER_GUIDE.md` — current user-facing guide for first run, daily Assistant use, surfaces, phone, local AI worker, and smoke checks.
- `docs/MORNING_BRIEFING_AND_VOICE.md` — user-facing morning briefing, spoken audio, worker, phone cache/playback, and alarm workflow.
- `docs/PWA_GO_LIVE_RUNBOOK.md` — PWA production go-live order, rollback triggers, and monitoring checklist.
- `docs/PWA_HOSTED_SMOKE_CHECKLIST.md` — hosted PWA smoke checks and expected evidence artifacts.
- `docs/PWA_PORTABILITY_DRILL.md` — export/backup portability drill and pass criteria.
- `docs/PWA_RAILWAY_PROD_CONFIG_CHECKLIST.md` — required Railway production config for API/web services.
- `docs/PWA_RELEASE_VERIFICATION_GATE.md` — mandatory pre-release gate for PWA builds/tests.
- `docs/RAILWAY_DEPLOY.md` — recommended Railway deployment model and supporting runbooks.
- `docs/RELEASE_HANDOFF.md` — generated release bundle snapshot from `scripts/release_handoff.py`; do not hand-edit unless intentionally syncing regenerated release metadata.
- `docs/RELEASE_HANDOFF_RUNBOOK.md` — release handoff generation and publication runbook.
- `docs/srs/README.md` — SRS deck/bootstrap references and import commands.
- `services/ai-runtime/prompts/README.md` — prompt pack conventions for user-editable assistant and agent behavior files.
- `services/ai-runtime/prompts/*.md` — canonical assistant/agent behavior and workflow prompt templates; prefer editing these markdown files over changing inline prompt strings in code.
- `services/worker/README.md` — placeholder scope note for future dedicated worker-runtime code.
- `tools/browser-extension/README.md` — browser clipper scaffold purpose and local load instructions.
- `tools/desktop-helper/README.md` — desktop helper capabilities, validation matrix, and host evidence.
- `apps/mobile/.expo/README.md` — Expo-generated explanation of local `.expo` state; informational only, not a planning source.
- `services/api/.pytest_cache/README.md` — pytest-generated cache note; informational only, not a planning source.
- Vendor markdown under `services/api/.venv/**` is third-party package/license material and is not part of Starlog repo guidance.
- External markdown under `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/**` is historical-only design input.

## Collaboration preferences

- Ask before any Railway deployment or production-facing environment change.
- Prefer longer implementation passes with meaningful checkpoints over constant small pushes.
- Use Playwright for browser-style validation when validating web UX.
- Keep screenshot proof for mobile validation and other visually sensitive work.
- Prefer Android-first native work before iOS for v1.
- Prefer `uv` for Python dependency and environment workflow.
- Keep `README.md` user-facing and free of committed secret material.
- Keep the canonical checkout clean on `master`; do development in fresh isolated worktrees.
- Treat merged PR branches as immutable; follow-up work goes on a fresh branch and fresh PR.

## Validation references

- Android dev-build, physical phone, and fresh local validation procedures live in [docs/ANDROID_DEV_BUILD.md](/home/ubuntu/starlog/docs/ANDROID_DEV_BUILD.md).
- Current phone/UI proof should be regenerated from the relevant runbook or harness and summarized in
  `docs/CURRENT_STATE.md`; do not keep dated historical screenshot folders in git unless the user
  explicitly asks for a release evidence bundle to be committed.
- Dated incident chronology and host-specific debugging history live in [docs/ENGINEERING_ISSUE_HISTORY.md](/home/ubuntu/starlog/docs/ENGINEERING_ISSUE_HISTORY.md).

## Learned guardrails

- Keep this file synchronized with the actual helper scripts and CLIs. If a command shape changes, update the docs immediately.
- Prefer repo-local tool binaries when host-global `pnpm`, `corepack`, `adb`, or similar tools are missing, stale, or inconsistent.
- When reusing shared dependencies across worktrees, verify symlinks, `PYTHONPATH`, and build outputs still point at the active checkout before trusting validation results.
- Prefer exact evidence over optimistic success text: confirm builds, installs, screenshots, and route transitions directly.
- For Android validation from WSL on this host, treat Windows `adb.exe`, Windows-visible APK staging paths, and manual device unlock as the reliable baseline.
- When Windows `adb.exe` is driven from WSL, stream device files through `adb exec-out ... > /home/ubuntu/...` instead of `adb pull ... /home/ubuntu/...`; Windows `adb pull` cannot create Linux-side paths.
- Preserve explicitly stated interaction contracts when redesigning assistant and support surfaces.
- For major UI overhauls, refresh the repo-local reference artifact before changing shared components.
- Major UI work must compare against `artifacts/ui-concept` mockups, rebuild the UX rather than reskin old components, and validate responsive mobile behavior so text does not wrap awkwardly or collide.
- Keep assistant and agent behavior prompts in repo-local `.md` files under `services/ai-runtime/prompts/` so users can inspect and edit them directly; do not bury canonical prompt behavior in code literals.
- Keep OpenAI/Codex credentials out of PWA and mobile clients; route agent work through the API, AI runtime, desktop helper, or paired worker with server-side/worker-local secret handling.
- Treat `/library` as the canonical Library route. References to `/notes` or `/artifacts` as user-facing Library routes are stale unless explicitly marked as legacy compatibility or API endpoints.
- Avoid duplicate planning docs. Keep `PLAN.md`, `VISION.md`, assistant reset docs, active UI reference docs, and `artifacts/ui-concept/**` authoritative, and remove stale plans when they no longer match direction.
- Delete stale merged branches and abandoned worktrees promptly; salvage only the pieces that still fit the current plan.
- Use one canonical conversation path for assistant UX and keep debug/operator controls secondary to the main user flow.
- For subagent supervision, do not treat a missing final response after a short wait as a hang. Define reusable
  roles by task lane (`IMPLEMENT`, `VALIDATE`, `REVIEW`, `CLEANUP`) and keep a worker on one
  `{workitem_id, worktree, branch}` lane until handoff; include role/lane intent in the workitem title and
  lock metadata because `agent_objective_evidence.py` reports branch/worktree context, not explicit lane/PR target
  fields. Supervisors should use `wait_agent`, then objective evidence (`python3 scripts/agent_objective_evidence.py`)
  before nudging. A stale heartbeat is progress evidence, not an automatic lease expiry. Close/restart only on
  explicit completion or an explicit supervisor force-release/force-claim with a human-readable reason (preferably
  after one status nudge plus an additional objective evidence poll showing no useful progress).
