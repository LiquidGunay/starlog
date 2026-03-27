# Codex Parallel Work Items

Queue refresh date: `2026-03-27`

Planning sources:

- `AGENTS.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `PLAN.md` on the current mainline direction for the voice-native Starlog migration

## Queue reset

- The Velvet redesign workitems (`WI-610` through `WI-615`) landed on `master` and are no longer the active queue.
- This refresh groups the next release-prep work around turning the new `master` state into a semi-stable user-testable release.
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

### WI-619. Semi-Stable Release Bundle Refresh

- Branch: `codex/semi-stable-release-bundle`
- Lock: `PENDING`
- Goal: produce a fresh user-testable release bundle from current `master` so the updated PWA and Android app can be downloaded and judged as one release pass.
- Scope:
  - build a fresh Android installable artifact from current `master`
  - refresh the operator handoff doc with current commit, artifact paths, and install guidance
  - record checksums and bundle locations for the downloadable surfaces
- Validation:
  - `cd apps/mobile/android && ./gradlew assembleRelease`
  - confirm the bundle paths in `docs/VNEXT_TEST_BUNDLE.md`

### WI-617. Semi-Stable Cross-Surface Validation Pass

- Branch: `codex/semi-stable-validation-pass`
- Lock: `PENDING`
- Goal: rerun the release evidence on current `master` so the semi-stable bundle has current UI proof instead of mixed older evidence.
- Scope:
  - rerun `./scripts/pwa_release_gate.sh`
  - rerun `./scripts/velvet_validation_artifacts.sh` with PWA, Android phone, and Windows helper coverage enabled
  - store an authoritative artifact bundle and mark superseded bundles explicitly
- Validation:
  - `./scripts/pwa_release_gate.sh`
  - `./scripts/velvet_validation_artifacts.sh`

### WI-618. Release Docs And Plan Alignment

- Branch: `codex/release-docs-plan-alignment`
- Lock: `PENDING`
- Goal: align release-facing docs with the current `master` snapshot and remove plan-doc drift before the next semi-stable handoff.
- Scope:
  - refresh `docs/IMPLEMENTATION_STATUS.md` and `docs/VNEXT_TEST_BUNDLE.md`
  - ensure the canonical root `PLAN.md` exists on the release branch and does not conflict with older forward-looking docs
  - keep `README.md`, release docs, and validation docs aligned with the same release snapshot
- Validation:
  - `git diff --check`
  - manual docs sanity review against current `master`
