# Codex Parallel Work Items

Queue refresh date: `2026-04-02`

Planning sources:

- `AGENTS.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `PLAN.md` on the current mainline direction for the voice-native Starlog migration

## Queue reset

- The Velvet redesign workitems (`WI-610` through `WI-615`) landed on `master` and are no longer the active queue.
- The semi-stable release-prep workitems from the prior refresh are complete; the active queue now focuses on the remaining v1 product gaps.
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

### WI-627. Dynamic Conversation Cards And Live Thread Projections

- Branch: `codex/dynamic-chat-card-projections`
- Lock: `PENDING`
- Goal: make the canonical chat render cards that update with thread state changes instead of behaving like static snapshots.
- Scope:
  - versioned card payload updates from the server-backed thread
  - inline expand/collapse and drill-down for card detail
  - sync visible card state across PWA and mobile thread views
- Validation:
  - `cd services/api && uv run --project . --extra dev pytest -s tests/test_conversations.py tests/test_api_flows.py`
  - `cd apps/web && ./node_modules/.bin/playwright test --config=playwright.web.config.ts --grep "assistant|cards"`

### WI-628. ML Interview Question Bank SRS Bootstrap Deck

- Branch: `codex/ml-interview-srs-bootstrap`
- Lock: `PENDING`
- Goal: scrape the ML interviews book part II question list and turn each question into a reviewable QA card deck that can seed Starlog SRS.
- Scope:
  - scrape the question list with explicit source provenance
  - generate concise paraphrased answers for each question
  - store the deck in machine-readable form and, if practical, add a tiny seed/loader path for the current SRS tables
- Validation:
- Acceptance:
  - one QA card exists per source question
  - the deck is reviewable and importable
  - provenance points back to the source URL and question section
- Validation:
  - deck generation or import script runs against the source page
  - output parses cleanly and matches the current SRS card shape
