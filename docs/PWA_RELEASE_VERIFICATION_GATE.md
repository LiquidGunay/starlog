# PWA Release Verification Gate

Run this gate before every PWA release candidate (including Railway deploys).

## Single command

```bash
./scripts/pwa_release_gate.sh
```

## What it runs

1. `npx pnpm@9.15.0 --filter web exec tsc --noEmit`
2. `cd apps/web && ./node_modules/.bin/next lint`
3. `cd apps/web && ./node_modules/.bin/next build`
4. `./node_modules/.bin/playwright test --config=playwright.web.config.ts`

If any step fails, the gate fails.

## Evidence artifacts

- Gate logs: `.localdata/pwa-release-gate/latest/gate.log`
- Playwright results + screenshots:
  - `.localdata/pwa-release-gate/latest/test-results/`
  - screenshots are captured for each passing test via `playwright.web.config.ts`

`STARLOG_PWA_RELEASE_GATE_ARTIFACT_DIR` is constrained to a path ending in `.localdata/pwa-release-gate/latest`;
the script deletes and recreates only that narrow current evidence directory. Do not point it at
repo roots, `.localdata` roots, worktree parents, `/tmp`, or tracked `artifacts/**` folders.

## Test scope notes

- Playwright suite is rooted at `apps/web/tests`.
- Current gate includes offline-focused regression coverage:
  - `offline-cache.spec.ts`
  - `assistant-voice-queue.spec.ts`
