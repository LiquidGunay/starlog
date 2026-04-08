# AGENTS.md — Starlog repo instructions

## Product goal
Build Starlog as a single-user, low-cost, independent system for knowledge management, scheduling, alarms, and learning workflows.

## Locked v1 preferences
- Voice/chat-first interaction is the canonical operating model; buttons and direct surface interactions are secondary.
- One persistent user chat thread exists across clients, with durable long-term memory and clearable short-term session state.
- Web-first PWA and the mobile app are both primary workspaces.
- iOS share-specific work is out of scope for v1 distribution and must not block v1 release readiness.
- Clipping is first-class: browser clipper + cross-platform desktop helper (Tauri) + mobile share capture.
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

## External design source of truth

Use the April 2026 design pack in `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026` as the only active UI/design source of truth for current observatory work.

- Treat `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/starlog_design_document_design.md` plus the per-surface `code.html` and `screen.png` files in that folder as the authoritative design references.
- When design guidance conflicts across sources, prefer the April 2026 external pack over any older repo-tracked doc or screenshot.

## Default execution mode

Use the canonical checkout at `/home/ubuntu/starlog` for normal single-agent work.

- Work on one task at a time on a fresh `codex/*` branch from current `master`.
- Do not create extra worktrees or claim shared workitem locks unless the task actually involves parallel agents, subagents, isolated recovery, or explicit multi-branch coordination.
- After a PR merges, switch back to `master`, prune stale refs, and start the next task from a fresh branch.
- If a merge-conflict lesson or process failure repeats, distill the durable takeaway into this file and archive the dated incident detail in `docs/ENGINEERING_ISSUE_HISTORY.md`.

For parallel-agent coordination, workitem locks, worktree hygiene, and shared dependency reuse, use [docs/PARALLEL_AGENT_WORKFLOW.md](/home/ubuntu/starlog/docs/PARALLEL_AGENT_WORKFLOW.md).

## Markdown map

This section is the repo-local purpose map for markdown files so agents know which docs are authoritative before opening or editing them.

- `AGENTS.md` — repo instructions, stable product/collaboration preferences, lock protocol, branch hygiene, markdown map, and durable engineering guardrails.
- `PLAN.md` — canonical forward-looking product and architecture direction for Starlog.
- `README.md` — top-level user-facing product README for install, sign-in handoff, release status, and operator entrypoints; keep developer internals and secrets out of it.
- `docs/ANDROID_DEV_BUILD.md` — Android dev-build/native-module path, release-signing policy, and Android validation flow.
- `docs/ANDROID_RELEASE_QA_MATRIX.md` — recorded Android device QA outcomes and evidence links for the current release pass.
- `docs/ANDROID_STORE_DISTRIBUTION_CHECKLIST.md` — Android store metadata, signing, packaging, and submission checklist.
- `docs/CODEX_PARALLEL_WORK_ITEMS.md` — archived human-readable queue snapshot; not the live coordination surface.
- `docs/ENGINEERING_ISSUE_HISTORY.md` — archived dated issue chronology and host-specific debugging history that should not live inline in `AGENTS.md`.
- `docs/PARALLEL_AGENT_WORKFLOW.md` — subagent-only workflow for workitem locking, extra worktrees, branch cleanup, and shared dependency reuse.
- `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md` — daily-use install, prerequisite, config, smoke, and reset handoff for the desktop helper on the main laptop.
- `docs/DESKTOP_HELPER_V1_RELEASE.md` — desktop helper distribution runbook, artifact pipeline, and release packaging notes.
- `docs/FINAL_PREVIEW_SIGNOFF.md` — latest preview release-decision handoff, baseline, and validation evidence for the current signoff pass.
- `docs/IMPLEMENTATION_STATUS.md` — current shipped capability snapshot, validations, and next implementation targets.
- `docs/LOCAL_AI_WORKER.md` — laptop-local AI worker responsibilities, provider routing, and runtime setup.
- `docs/PREVIEW_FEEDBACK_BUNDLE.md` — exact local bundle paths and hosted endpoints for the current user-feedback install pass.
- `docs/PHONE_SETUP.md` — laptop-to-phone local testing and setup guide for PWA/mobile use.
- `docs/RAILWAY_PROJECT_SETUP_STATUS.md` — current real Railway project/service state, generated domains, pending deploy-time config, and cost estimate for WI-443.
- `docs/SEMI_STABLE_RELEASE_CHECKLIST.md` — repeatable preview/semi-stable release checklist spanning docs, validation, artifacts, and signoff.
- `docs/STARLOG_ARCHITECTURE_WORKFLOW_PLAN.md` — docs-scoped companion to `PLAN.md`; keeps the current observatory implementation sequence, system boundaries, and workstream ordering in one execution-focused plan.
- `docs/PWA_GO_LIVE_RUNBOOK.md` — PWA production go-live order, rollback triggers, and monitoring checklist.
- `docs/PWA_HOSTED_SMOKE_CHECKLIST.md` — hosted PWA smoke checks and expected evidence artifacts.
- `docs/PWA_PORTABILITY_DRILL.md` — export/backup portability drill and pass criteria.
- `docs/PWA_RAILWAY_PROD_CONFIG_CHECKLIST.md` — required Railway production config for API/web services.
- `docs/PWA_RELEASE_VERIFICATION_GATE.md` — mandatory pre-release gate for PWA builds/tests.
- `docs/RAILWAY_DEPLOY.md` — recommended Railway deployment model and supporting runbooks.
- `docs/srs/README.md` — SRS deck/bootstrap references and import commands.
- `services/worker/README.md` — placeholder scope note for future dedicated worker-runtime code.
- `tools/browser-extension/README.md` — browser clipper scaffold purpose and local load instructions.
- `tools/desktop-helper/README.md` — desktop helper capabilities, validation matrix, and host evidence.
- `apps/mobile/.expo/README.md` — Expo-generated explanation of local `.expo` state; informational only, not a planning source.
- `services/api/.pytest_cache/README.md` — pytest-generated cache note; informational only, not a planning source.
- Vendor markdown under `services/api/.venv/**` is third-party package/license material and is not part of Starlog repo guidance.
- External markdown under `/home/ubuntu/starlog_extras/starlog_unified_design_april_2026/**` is the current cross-worktree design reference set; it is intentionally outside the repo so design iteration does not churn implementation branches.

## Collaboration preferences

- Ask before any Railway deployment or production-facing environment change.
- Prefer longer implementation passes with meaningful checkpoints over constant small pushes.
- Use Playwright for browser-style validation when validating web UX.
- Keep screenshot proof for mobile validation and other visually sensitive work.
- Prefer Android-first native work before iOS for v1.
- Prefer `uv` for Python dependency and environment workflow.
- Keep `README.md` user-facing and free of committed secret material.
- Use the canonical checkout by default and avoid extra worktrees for normal single-agent work.
- Treat merged PR branches as immutable; follow-up work goes on a fresh branch and fresh PR.

## Validation references

- Android dev-build, physical phone, and fresh local April validation procedures live in [docs/ANDROID_DEV_BUILD.md](/home/ubuntu/starlog/docs/ANDROID_DEV_BUILD.md).
- Android device QA outcomes and evidence belong in [docs/ANDROID_RELEASE_QA_MATRIX.md](/home/ubuntu/starlog/docs/ANDROID_RELEASE_QA_MATRIX.md).
- Dated incident chronology and host-specific debugging history live in [docs/ENGINEERING_ISSUE_HISTORY.md](/home/ubuntu/starlog/docs/ENGINEERING_ISSUE_HISTORY.md).

## Learned guardrails

- Keep this file synchronized with the actual helper scripts and CLIs. If a command shape changes, update the docs immediately.
- Prefer repo-local tool binaries when host-global `pnpm`, `corepack`, `adb`, or similar tools are missing, stale, or inconsistent.
- When reusing shared dependencies across worktrees, verify symlinks, `PYTHONPATH`, and build outputs still point at the active checkout before trusting validation results.
- Prefer exact evidence over optimistic success text: confirm builds, installs, screenshots, and route transitions directly.
- For Android validation from WSL on this host, treat Windows `adb.exe`, Windows-visible APK staging paths, and manual device unlock as the reliable baseline.
- Preserve collapsible side-pane behavior and other explicitly stated interaction contracts when redesigning observatory surfaces.
- Keep docs-scoped workflow plans under `docs/`; replace them with updated versions rather than deleting them when the plan changes.
- Delete stale merged branches and abandoned worktrees promptly; salvage only the pieces that still fit the current plan.
- Use one canonical conversation path for assistant UX and keep debug/operator controls secondary to the main user flow.
