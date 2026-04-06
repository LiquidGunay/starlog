# Codex Parallel Work Items

This file is archived planning context only.

Live multi-agent coordination moved to the shared git-common registry under:

- `$(git rev-parse --git-common-dir)/codex-workitems/workitems.json`
- `$(git rev-parse --git-common-dir)/codex-workitems/review_backlog.json`
- `$(git rev-parse --git-common-dir)/codex-workitems/branch_cleanup.json`
- `$(git rev-parse --git-common-dir)/codex-workitems/design_queue.json`

Use this markdown only when you need historical context about an older queue refresh. Do not treat it as the current source of truth for locks, branch cleanup, review findings, or April observatory work planning.

Current policy:

- branch from latest `origin/master`
- claim work in the shared registry before implementation
- deliver every claimed task through a PR to `master`
- rebase onto latest `origin/master` before final review when behind
- keep volatile work coordination out of repo-tracked markdown
