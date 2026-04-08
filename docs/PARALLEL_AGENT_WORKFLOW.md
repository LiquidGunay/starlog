# Parallel Agent Workflow

Use this doc only when the task genuinely needs parallel agents, subagents, isolated recovery, or
multiple worktrees. For normal single-agent work, stay in the canonical checkout and follow
[AGENTS.md](/home/ubuntu/starlog/AGENTS.md).

## Shared workitem locking (`.git` common dir)

Use a shared live lock registry under the common git dir so parallel agents coordinate against the
same source of truth.

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
- Required usage flow:
  1. Identify the `workitem_id` in `workitems.json`, then acquire `.registry.lock` before reading/updating lock state.
  2. On claim, verify `locks/<workitem_id>.lock` is absent or stale (`last_heartbeat_at` older than 10 minutes). If active and not stale, do not proceed.
  3. Write/update `locks/<workitem_id>.lock` with owner metadata (`agent_id`, `worktree`, `branch`, `claimed_at`, `last_heartbeat_at`), keep the workitem `title` current when known, set workitem status/owner in `workitems.json`, and append a `claim` event to `audit.jsonl`.
  4. While working, refresh `last_heartbeat_at` at least every 2 minutes under `.registry.lock`, and keep `workitems.json` ownership/status aligned.
  5. On completion or handoff, remove the lock file, update `workitems.json` status/owner/handoff fields, append a `release` event to `audit.jsonl`, then drop `.registry.lock`.
  6. Forced steal is allowed only for stale locks; append a `force_steal` event with explicit reason and prior owner context in `audit.jsonl`.
- `docs/CODEX_PARALLEL_WORK_ITEMS.md` is archived planning context only; live lock authority and live backlog state live in the shared `.git` registry.

## Branch and worktree hygiene

Keep branch/worktree count low enough that `master`, active task branches, and abandoned
experiments are easy to distinguish.

- Default to the canonical checkout at `/home/ubuntu/starlog`; create an extra worktree only when the task genuinely benefits from isolation.
- Keep exactly one active `codex/*` task branch per worktree.
- The canonical checkout should own local `master` whenever possible. Do not leave `master` pinned in a side worktree after the recovery or validation task that needed it is done.
- If a branch/worktree falls out of the current plan, prefer deleting it. Only preserve it when it contains unsalvaged work that is still valuable against the current plan.
- If preserved work is not ready to continue, store it as a clearly named stash (`git stash push -u -m "<branch> WIP"`) or record it in `branch_cleanup.json`, then remove the worktree.
- After a branch merges or is intentionally abandoned, remove its worktree, run `git worktree prune`, and delete merged local/remote `codex/*` refs during the same cleanup pass.
- Detached Codex app worktrees with no branch and no important local changes should be treated as disposable and removed during routine cleanup.
- When salvage is needed from a stale branch, cherry-pick or patch-select only the pieces that still fit the current plan; do not revive the entire branch by default.
- Every claimed agent task must be delivered through a PR to `master`; direct pushes to `master` are not allowed.
- If a task branch is behind `origin/master`, rebase onto latest `origin/master` before final review and rerun relevant validation after the rebase.
- Once a PR is merged, do not add commits to that branch/PR. Start a fresh `codex/*` branch from current `master` for follow-up work.
- Capture backend/support review findings into `review_backlog.json` before deleting merged PR head branches.
- During branch cleanup, quarantine unmerged or dirty local branches in `branch_cleanup.json` instead of deleting them blindly.
- Run `git fetch --prune` plus merged-branch cleanup at the end of each merge batch so local refs do not accumulate across sessions.

## Shared dependency/build reuse across worktrees

Fresh worktrees should reuse existing dependency installs and compiler caches from the canonical
checkout instead of re-running full setup by default.

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
- Default rule: reuse shared state for dependencies/caches; only localize a surface if the task changes that surface's dependency or build inputs.
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
