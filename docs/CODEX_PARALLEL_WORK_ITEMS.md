# Codex Parallel Work Items

Queue refresh date: `2026-03-27`

Planning sources:

- `AGENTS.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `PLAN.md` on the current mainline direction for the voice-native Starlog migration

## Queue reset

- Older distribution/setup workitems remain in the live registry for history, but they are not the active queue for this pass.
- This refresh groups the current work around the Velvet redesign plus the supporting docs and PDF/OCR validation tracks requested on `2026-03-27`.
- Live lock state is authoritative under `$(git rev-parse --git-common-dir)/codex-workitems/`; this file is the human-readable mirror only.

## Working rules

- Branch from latest `origin/master` using `codex/*` branch names only.
- Every claimed workitem must ship via a PR to `master`.
- Rebase onto latest `origin/master` before final review if your branch is behind.
- Do not deploy from a feature branch without explicit user approval.
- Before reinstalling dependencies in a fresh worktree, run `bash scripts/use_shared_worktree_state.sh --source /home/ubuntu/starlog`.
- Update `AGENTS.md` when a new blocker, preference, or merge-conflict lesson is discovered.

## Claiming and locks

- Claim before implementation:
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent-id>`
- Heartbeat while active:
  - `python3 scripts/workitem_lock.py heartbeat --workitem-id <id> --agent-id <agent-id>`
- Release on completion or handoff:
  - `python3 scripts/workitem_lock.py release --workitem-id <id> --agent-id <agent-id> --status completed`
- Stale lock reclaim:
  - `python3 scripts/workitem_lock.py claim --workitem-id <id> --agent-id <agent-id> --force-steal --reason "<reason>"`

## Active queue

### WI-610. Velvet PWA Salon Thread

- Branch: `codex/velvet-pwa-salon-thread`
- Lock: `IN_PROGRESS | Workitem: WI-610 | Owner: worker-velvet-pwa | Claimed: 2026-03-27T08:10:32Z | Last heartbeat: 2026-03-27T08:12:40Z`
- Goal: redesign the PWA around the Velvet direction so the thread-first workspace feels editorial, ritualistic, and premium instead of utility-heavy.
- Scope:
  - update the assistant shell and directly related shared PWA styling/components
  - align the main chat surface with the Velvet moodboard and system mockups
  - preserve the thread as the canonical operating surface
- Validation:
  - `cd apps/web && ./node_modules/.bin/tsc --noEmit`
  - `cd apps/web && ./node_modules/.bin/playwright test --config=playwright.web.config.ts`

### WI-611. Velvet Mobile Capture Gesture

- Branch: `codex/velvet-mobile-capture-gesture`
- Lock: `IN_PROGRESS | Workitem: WI-611 | Owner: worker-velvet-mobile | Claimed: 2026-03-27T08:08:32Z | Last heartbeat: 2026-03-27T08:12:32Z`
- Goal: redesign the Android-first mobile companion so capture and briefing flows feel intentional, premium, and phone-native.
- Scope:
  - update the main app shell, capture flow, and briefing-related presentation
  - reduce the compressed-dashboard feel in favor of fewer, stronger surfaces
  - preserve quick capture, alarms, offline playback, and review utility
- Validation:
  - `cd apps/mobile && ./node_modules/.bin/tsc --noEmit`
  - connected-phone screenshot proof using the Android runbook in `AGENTS.md`

### WI-612. Velvet Desktop Helper Instrument

- Branch: `codex/velvet-desktop-helper-instrument`
- Lock: `IN_PROGRESS | Workitem: WI-612 | Owner: worker-velvet-desktop | Claimed: 2026-03-27T08:09:53Z | Last heartbeat: 2026-03-27T08:17:19Z`
- Goal: redesign the desktop helper so the quick popup feels like a polished capture instrument instead of a neutral utility dialog.
- Scope:
  - update the compact quick-capture popup
  - keep the workspace/studio surface coherent but secondary to fast capture
  - align helper styling with the Velvet moodboard and helper system mockup
- Validation:
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts`
  - helper screenshot proof where practical

### WI-613. Velvet Cross-Device Validation Matrix

- Branch: `codex/velvet-cross-device-validation`
- Lock: `COMPLETED | Workitem: WI-613 | Owner: N/A | Claimed: 2026-03-27T08:08:36Z | Last heartbeat: 2026-03-27T08:16:25Z`
- Goal: define and partially execute the validation path for the Velvet rollout across browser, connected Android phone, and Windows helper host.
- Scope:
  - inventory the existing validation scripts/runbooks
  - document pass criteria, commands, and evidence paths for the new UI rollout
  - capture baseline validation evidence where possible before branch integration
- Release note:
  - committed docs update: `2be4584`

### WI-614. Developer Docs And Product README Refresh

- Branch: `codex/dev-docs-product-readme`
- Lock: `IN_PROGRESS | Workitem: WI-614 | Owner: worker-devdocs-readme | Claimed: 2026-03-27T08:09:58Z | Last heartbeat: 2026-03-27T08:17:19Z`
- Goal: add a human-readable developer code map, refresh the README to be product-first, and mirror the new queue in this file.
- Scope:
  - add `docs/CODEBASE_ORGANIZATION.md`
  - rewrite `README.md` around product overview, capabilities, setup, and usage
  - refresh this queue file to match the active Velvet rollout
- Validation:
  - lightweight docs sanity review
  - `git diff --check`

### WI-615. PDF OCR Ingest And Card Smoke

- Branch: `codex/pdf-ocr-card-smoke`
- Lock: `IN_PROGRESS | Workitem: WI-615 | Owner: worker-pdf-ocr-smoke | Claimed: 2026-03-27T08:09:59Z | Last heartbeat: 2026-03-27T08:16:01Z`
- Goal: harden the manual PDF ingest to summary/note/card/quiz path and evaluate an optional desktop-hosted OCR server flow.
- Scope:
  - inspect the current PDF/manual artifact pipeline
  - test summary, note creation, and card/quiz generation using the supplied PDF
  - evaluate liteparse + PaddleOCR as an optional dependency instead of a mandatory global requirement
- Validation:
  - relevant `services/api` and `services/ai-runtime` tests
  - smoke evidence for PDF-backed artifact processing
