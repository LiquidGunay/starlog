# Engineering Issue History

This file is the dated incident and debugging archive for Starlog. Keep `AGENTS.md` focused on
stable operating principles and durable guardrails; put one-off incidents, host quirks, and dated
debugging chronology here instead.

## How to use this file

- Append dated entries when the exact chronology matters.
- Distill any repeated lesson back into `AGENTS.md` as a durable guardrail.
- Prefer links to the relevant scripts, docs, PRs, or files when recording an incident.

## Current archived incident families

### Android validation and device quirks

- Windows `adb.exe` from WSL is the reliable phone-control path on this host; Linux `adb` may stay empty even when the phone is connected.
- Windows `adb.exe install` must use a native Windows path like `C:\Temp\...`; WSL-style `/mnt/c/...` paths are unreliable for installs.
- The OPPO validation device must remain manually unlocked, and sideload flows may pause behind Google Play Protect prompts.
- The fresh local Android validation loop now uses device-ABI-only builds, bounded `versionCode`s, and `latest.apk` / `latest.json` pointers to avoid repeated rebuild confusion.

### Shared-worktree and validation environment drift

- Shared `node_modules` or `.venv` reuse can point validation at the wrong checkout unless `PYTHONPATH`, symlinks, and build outputs are checked explicitly.
- This host often requires repo-local tool binaries because global `pnpm`, `corepack`, or other helpers are missing or stale.
- Branch cleanup must happen promptly after merges so stale worktrees, broken symlinks, and ambiguous local state do not accumulate.

### Product and UI regression lessons

- Observatory redesign work must preserve explicit interaction contracts like collapsible side panes.
- Main Room card labels must match actual behavior; navigation-style labels should navigate, not mutate a draft.
- Mobile tabs that represent different surfaces need independent draft state; shared composer state causes lossy UX.

### Docs and process drift

- `AGENTS.md` instructions must match real helper CLIs and current source-of-truth design references.
- Android testing procedures belong in `docs/ANDROID_DEV_BUILD.md`, not inline in `AGENTS.md`.
- When the architecture or implementation plan changes, replace the docs-scoped plan under `docs/` instead of deleting it.
