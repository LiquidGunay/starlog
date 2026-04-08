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

## Shared workitem locking (`.git` common dir)

Use a shared live lock registry under the common git dir so all worktrees/agents coordinate against the same source of truth.

- Registry root: `$(git rev-parse --git-common-dir)/codex-workitems/`
- Authoritative files:
  - `workitems.json`
  - `locks/<workitem_id>.lock`
  - `audit.jsonl`
  - `review_backlog.json`
  - `branch_cleanup.json`
  - `design_queue.json`
  - `.registry.lock` (used for atomic lock operations)
- Lock protocol:
  - claim lock before implementation starts
  - every lock record must include owner identity through a stable, human-readable `agent_id`
  - heartbeat every 2 minutes while actively working
  - stale lock timeout is 10 minutes
  - release lock on completion or handoff
  - forced lock steal requires an explicit reason and must be appended to `audit.jsonl`
- Preferred command helper:
  - Initialize registry: `python3 scripts/workitem_lock.py init`
  - Claim: `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent> --title "<short title>" --force-steal --reason "<reason>"` (omit `--force-steal` for normal claim; `--title` is optional but preferred when claiming a new item)
  - Heartbeat: `python3 scripts/workitem_lock.py heartbeat --workitem-id <id> --agent-id <agent>`
  - Release: `python3 scripts/workitem_lock.py release --workitem-id <id> --agent-id <agent> --status completed`
  - Inspect status: `python3 scripts/workitem_lock.py status [--workitem-id <id>]`
- Required usage flow for every agent:
  1) Identify the `workitem_id` in `workitems.json`, then acquire `.registry.lock` before reading/updating lock state.
  2) On claim, verify `locks/<workitem_id>.lock` is absent or stale (`last_heartbeat_at` older than 10 minutes). If active and not stale, do not proceed.
  3) Write/update `locks/<workitem_id>.lock` with owner metadata (`agent_id`, `worktree`, `branch`, `claimed_at`, `last_heartbeat_at`), keep the workitem `title` current when known, set workitem status/owner in `workitems.json`, and append a `claim` event to `audit.jsonl`.
  4) While working, refresh `last_heartbeat_at` at least every 2 minutes (under `.registry.lock`), and keep `workitems.json` ownership/status aligned.
  5) On completion or handoff, remove the lock file, update `workitems.json` status/owner/handoff fields, append a `release` event to `audit.jsonl`, then drop `.registry.lock`.
  6) Forced steal is allowed only for stale locks; append a `force_steal` event with explicit reason and prior owner context in `audit.jsonl`.
- `docs/CODEX_PARALLEL_WORK_ITEMS.md` is archived planning context only; live lock authority and live backlog state live in the shared `.git` registry.
- Every claimed agent task must be delivered through a PR to `master`; direct pushes to `master` are not allowed.
- If a task branch is behind `origin/master`, rebase onto latest `origin/master` before final review/merge and rerun relevant validation after the rebase.
- Once a PR is merged, do not add commits to that branch/PR. Start a fresh `codex/*` branch from current `master` and open a new PR for follow-up work.
- Capture backend/support review findings into `review_backlog.json` before deleting merged PR head branches.
- During branch cleanup, quarantine unmerged or dirty local branches in `branch_cleanup.json` instead of deleting them blindly.
- Run `git fetch --prune` plus merged-branch cleanup at the end of each merge batch so local refs do not accumulate across sessions.
- Lock timing rationale:
  - 2-minute heartbeat gives near-real-time liveness without overwhelming lock-file churn.
  - 10-minute stale timeout tolerates short command/test pauses but recovers quickly from crashed or abandoned sessions.
  - Checking/refreshing at the 2-minute heartbeat cadence keeps takeover decisions consistent and deterministic.
- Any merge-conflict resolution insight discovered while working must be distilled into a durable guardrail here and, if useful for chronology, appended to `docs/ENGINEERING_ISSUE_HISTORY.md`.

## Branch and worktree hygiene

Keep branch/worktree count low enough that `master`, active task branches, and abandoned experiments are easy to distinguish.

- Default to the canonical checkout at `/home/ubuntu/starlog`; do not create a new worktree for normal single-agent work.
- Keep the main agent in the canonical checkout and switch branches there as needed instead of spawning extra local worktrees.
- Additional worktrees are reserved for subagents that need isolated PR branches, risky rebases, or a clearly isolated recovery/salvage pass.
- Before creating a new worktree, inspect `git worktree list --porcelain` and reuse or delete an existing clean detached worktree if it is no longer tied to an active task.
- Keep exactly one active `codex/*` task branch per worktree. Do not park multiple unfinished branches in the same checkout.
- The canonical checkout should own local `master` whenever possible. Do not leave `master` pinned in a side worktree after the recovery or validation task that needed it is done.
- If a branch/worktree falls out of the current plan, prefer deleting it. Only preserve it when it contains unsalvaged work that is still valuable against the current plan.
- If preserved work is not ready to continue, store it as a clearly named stash (`git stash push -u -m "<branch> WIP"`) or record it in `branch_cleanup.json`, then remove the worktree.
- After a branch merges or is intentionally abandoned, remove its worktree, run `git worktree prune`, and delete merged local/remote `codex/*` refs during the same cleanup pass.
- Detached Codex app worktrees with no branch and no important local changes should be treated as disposable and removed during routine cleanup.
- When salvage is needed from a stale branch, cherry-pick or patch-select only the pieces that still fit the current plan; do not revive the entire branch by default.

## Shared dependency/build reuse across worktrees

Fresh worktrees should reuse existing dependency installs and compiler caches from the canonical checkout instead of re-running full setup by default.

- Canonical checkout for this host: `/home/ubuntu/starlog`
- Before running installs in a fresh worktree, link shared state:

```bash
cd <your-worktree>
bash scripts/use_shared_worktree_state.sh --source /home/ubuntu/starlog
```

- The helper links these shared paths when they are absent locally:
  - `node_modules`
  - `apps/web/node_modules`
  - `apps/mobile/node_modules`
  - `tools/desktop-helper/node_modules`
  - `services/api/.venv`
  - `apps/mobile/android/.gradle`
  - `tools/desktop-helper/src-tauri/target`
- Fresh-worktree validation on this host succeeded without reinstalling after running the helper:
  - `npx pnpm@9.15.0 --filter web exec tsc --noEmit`
  - `cd apps/mobile && ./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep "quick popup can switch to workspace in browser fallback"`
- Default rule: reuse shared state for dependencies/caches; only localize a surface if your task changes that surface's dependency or build inputs.
- Localize a surface before reinstall/rebuild if you modify any of:
  - `package.json`
  - `pnpm-lock.yaml`
  - `services/api/pyproject.toml`
  - `services/api/uv.lock`
  - `apps/mobile/android/**`
  - `apps/mobile/app.config.js`
  - `tools/desktop-helper/src-tauri/Cargo.toml`
  - `tools/desktop-helper/src-tauri/Cargo.lock`
- If a worktree needs different state for one surface, keep only that surface local and continue reusing shared state for the rest.
- For long-running Metro/Gradle mobile validation on this host, prefer the canonical checkout if the NTFS worktree path stalls before binding `:8081`.

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
