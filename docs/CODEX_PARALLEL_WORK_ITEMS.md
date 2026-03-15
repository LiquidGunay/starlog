# Codex Parallel Work Items

Base code baseline for this queue: `ab070a8` on `master`.

Plan sources:
- `AGENTS.md` (v1 preferences, markdown map, shared worktree rules)
- `docs/STARLOG_V1_PLAN.md`
- `docs/STARLOG_ARCHITECTURE_WORKFLOW_PLAN.md`
- post-merge UI audit against `screen_design`

Last queue reset: `2026-03-15`.

## Queue reset

- Prior workitems (`WI-301` through `WI-346`) are retired as completed or superseded by the post-merge UI/setup queue.
- This file now tracks the next v1-distribution pass split into three product categories plus one shared-agent tooling section.
- iOS share-specific work is out of scope for v1 and is not part of this queue.

## Working rules

- Branch from latest `origin/master` using `codex/*` branch names only.
- Every claimed workitem must ship via a PR to `master`.
- Rebase onto latest `origin/master` before requesting merge if your branch is behind.
- If a PR is merged, do not push more commits to it. Create a new branch and a new PR.
- Do not deploy from a feature branch without explicit user approval.
- Update `AGENTS.md` issue/preference log for newly discovered blockers/preferences.
- Before reinstalling dependencies in a fresh worktree, run `bash scripts/use_shared_worktree_state.sh --source /home/ubuntu/starlog` and reuse shared state unless your task changes that surface's dependency/build inputs.

## Claiming and locks

- Live lock authority is the shared registry under `$(git rev-parse --git-common-dir)/codex-workitems/`.
- This file is a human-readable mirror of lock state.
- Claim before implementation:
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent-id>`
- Heartbeat every 2 minutes while actively working:
  - `python3 scripts/workitem_lock.py heartbeat --workitem-id <id> --agent-id <agent-id>`
- Release on completion/handoff:
  - `python3 scripts/workitem_lock.py release --workitem-id <id> --agent-id <agent-id> --status completed`
- Stale lock reclaim (TTL 10 minutes):
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent-id> --force-steal --reason "<reason>"`
- Sync mirror lines:
  - `python3 scripts/sync_workitem_mirror.py`

## Mobile App (Android v1 distribution)

### WI-401. Mobile companion UI dedupe + design cleanup
- Branch: `codex/mobile-ui-dedupe-alignment`
- Lock: `UNCLAIMED | Workitem: WI-401 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: remove the duplicated admin-console feel from the mobile companion while preserving the current capabilities.
- Scope:
  - collapse the advanced capture/review stacks into more compact secondary surfaces,
  - keep the hero/review/alarm shells as the primary UI,
  - preserve command, capture, queue, and triage functionality without forcing them all into the main scroll stack.
- Acceptance:
  - each tab has one clear primary surface aligned to `screen_design`,
  - existing mobile capabilities remain reachable,
  - before/after screenshots are attached for the phone UI.
- Validation:
  - `cd apps/mobile && ./node_modules/.bin/tsc --noEmit`
  - physical-phone screenshots for capture/review/alarms tabs.

### WI-402. Android installable build for the main phone
- Branch: `codex/mobile-main-phone-installable`
- Lock: `UNCLAIMED | Workitem: WI-402 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: produce one installable Android artifact suitable for the user's main phone.
- Scope:
  - choose the correct install path (`preview`/internal vs production-style RC),
  - build the installable artifact,
  - document exact install command/URL and required signing inputs,
  - verify the chosen artifact installs cleanly on the main phone.
- Acceptance:
  - one named Android artifact is selected for daily use on the main phone,
  - install steps are documented and reproducible,
  - install verification evidence is attached.
- Validation:
  - chosen Android build command succeeds,
  - installed app launches on the main phone without dev-only blocker dialogs.

### WI-403. Main-phone Starlog setup pack
- Branch: `codex/mobile-main-phone-setup-pack`
- Lock: `UNCLAIMED | Workitem: WI-403 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: leave the main phone ready for real use once the installable build exists.
- Scope:
  - set API base/auth in the installed app,
  - verify Android share capture, deep links, alarms, and offline briefing playback,
  - document reset/reinstall steps,
  - capture screenshots for the final configured state.
- Acceptance:
  - main phone can capture/share/review/brief without additional supervisor setup,
  - setup/reset notes are documented for future device replacement.
- Validation:
  - Android smoke flow on the installed build,
  - screenshot proof of configured home/capture/alarm states.

## Desktop App (main-laptop helper distribution)

### WI-421. Desktop helper UI dedupe + studio alignment
- Branch: `codex/desktop-studio-dedupe-alignment`
- Lock: `UNCLAIMED | Workitem: WI-421 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: separate the quick popup from the studio workspace more cleanly so the workspace is not just the popup re-embedded.
- Scope:
  - keep the compact quick surface focused on immediate capture,
  - turn the studio workspace into a more distinct diagnostics/config/history surface,
  - align the workspace layout more closely to the desktop `screen_design` reference.
- Acceptance:
  - quick popup and studio have clearly different responsibilities,
  - duplicated capture-surface UI is reduced,
  - updated screenshots show closer design alignment.
- Validation:
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts`
  - updated QA screenshots under `artifacts/desktop-helper/`.

### WI-422. Desktop installable artifact for the main laptop
- Branch: `codex/desktop-main-laptop-installable`
- Lock: `UNCLAIMED | Workitem: WI-422 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: produce the host-appropriate installer/package that the user can actually install on the main laptop.
- Scope:
  - choose the correct host artifact (`.deb`, `.msi`, `.nsis`, `.dmg`, etc.),
  - build it from the documented release pipeline,
  - record the exact artifact path/checksum/version,
  - verify installability on the target laptop OS.
- Acceptance:
  - one installable desktop artifact is selected for the main laptop,
  - install path and checksum are documented,
  - install smoke check passes on the target host.
- Validation:
  - `cd tools/desktop-helper && ./scripts/build_release_artifacts.sh`
  - host install smoke using the produced installer/package.

### WI-423. Main-laptop helper setup pack
- Branch: `codex/desktop-main-laptop-setup-pack`
- Lock: `UNCLAIMED | Workitem: WI-423 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: leave the main laptop helper fully configured for daily capture.
- Scope:
  - configure API base/token,
  - verify shortcut registration, screenshot path, OCR/tooling requirements, and active-window metadata,
  - document upgrade/uninstall/reset steps,
  - capture evidence from the installed helper.
- Acceptance:
  - the installed helper can clip clipboard/screenshots to Starlog on the main laptop,
  - host-specific prerequisites and reset steps are documented.
- Validation:
  - installed-helper smoke for clipboard + screenshot + metadata,
  - screenshot evidence from the installed helper UI.

## PWA (Railway + main-device setup)

### WI-441. PWA session-controls consolidation
- Branch: `codex/pwa-session-controls-consolidation`
- Lock: `UNCLAIMED | Workitem: WI-441 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: stop repeating the generic session/admin form across the canonical PWA shells.
- Scope:
  - consolidate `SessionControls` into one secondary settings surface/pattern,
  - remove it as a primary repeated card from `assistant`, `artifacts`, `sync-center`, and `planner`,
  - keep the same runtime controls accessible without dominating the UI.
- Acceptance:
  - canonical PWA surfaces match `screen_design` more closely,
  - session/admin controls remain reachable in a consistent secondary place,
  - screenshots show the cleaner shells.
- Validation:
  - `cd /home/ubuntu/starlog && npx pnpm@9.15.0 --filter web exec tsc --noEmit`
  - `cd apps/web && ./node_modules/.bin/next lint`
  - `cd apps/web && ./node_modules/.bin/next build`

### WI-442. PWA surface polish against `screen_design`
- Branch: `codex/pwa-surface-polish`
- Lock: `UNCLAIMED | Workitem: WI-442 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: finish the stylistic cleanup after session-control consolidation.
- Scope:
  - tighten assistant/artifact/sync/planner spacing, empty states, and panel hierarchy,
  - remove any remaining generic utility-panel feel from canonical surfaces,
  - capture updated desktop/mobile screenshots for review.
- Acceptance:
  - the four canonical PWA surfaces look intentionally related to the design references,
  - duplicate or off-plan utility components are no longer visually dominant.
- Validation:
  - `./node_modules/.bin/playwright test --config=playwright.web.config.ts`
  - updated screenshots for the four canonical PWA pages.

### WI-443. Railway project/service setup
- Branch: `codex/railway-project-service-setup`
- Lock: `IN_PROGRESS | Workitem: WI-443 | Owner: Agent codex-supervisor | Claimed: 2026-03-15T13:25:12Z | Last heartbeat: 2026-03-15T13:34:14Z`
- Goal: prepare the actual Railway project so deployment can happen cleanly when approved.
- Scope:
  - create/select the correct Railway project,
  - create/configure `starlog-api` and `starlog-web` services,
  - wire required env vars, persistent volume, domains, and secrets,
  - document anything still needed from the supervisor before first deploy.
- Acceptance:
  - Railway project state is ready for deployment,
  - required secrets/inputs are clearly enumerated,
  - no deploy is executed without explicit user approval.
- Validation:
  - `docs/PWA_RAILWAY_PROD_CONFIG_CHECKLIST.md` completed against the real Railway project,
  - service/project status captured for handoff.

### WI-444. PWA install/setup on the main laptop and phone
- Branch: `codex/pwa-main-device-setup`
- Lock: `UNCLAIMED | Workitem: WI-444 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: leave Starlog usable as an installed PWA on the user's daily devices.
- Scope:
  - install the PWA on the main laptop browser and the main phone browser,
  - configure API base/auth,
  - run offline warmup and confirm key routes open from the installed PWA,
  - document reinstall/reset steps for both devices.
- Acceptance:
  - installed PWAs work on the main laptop and phone,
  - offline warmup/setup steps are documented for repeat use.
- Validation:
  - installed-PWA smoke on both devices,
  - offline route-open proof after warmup.

## Shared Agent Tooling

### WI-461. Shared worktree dependency + build-cache reuse bootstrap
- Branch: `codex/shared-worktree-bootstrap`
- Lock: `UNCLAIMED | Workitem: WI-461 | Owner: N/A | Claimed: N/A | Last heartbeat: N/A`
- Goal: make fresh worktrees reuse the canonical checkout's dependency installs and compiler caches by default.
- Scope:
  - document the reuse rules in `AGENTS.md`,
  - maintain the shared-state helper script,
  - validate that a fresh worktree can link existing installs/caches instead of re-running full setup,
  - document when a task must break out a local surface-specific install/build.
- Acceptance:
  - agents can start from shared deps/caches without unnecessary reinstalls,
  - only changed surfaces need local setup,
  - reuse instructions are explicit and reproducible.
- Validation:
  - run `bash scripts/use_shared_worktree_state.sh --source /home/ubuntu/starlog` in a fresh worktree,
  - confirm linked state is sufficient for at least one web/mobile/desktop validation command without reinstalling everything.

## Suggested execution order

1. `WI-461` -> `WI-443`
2. `WI-441` -> `WI-442`
3. `WI-401` -> `WI-402` -> `WI-403`
4. `WI-421` -> `WI-422` -> `WI-423`
5. `WI-444` after the chosen hosted/local setup path is confirmed.

Parallel-safe starters right now:
- `WI-461`
- `WI-401`
- `WI-421`
- `WI-443`

Recommended immediate next workitem:
- `WI-443` (Railway project/service setup)
