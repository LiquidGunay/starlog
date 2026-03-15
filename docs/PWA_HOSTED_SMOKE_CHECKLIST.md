# PWA Hosted Smoke Checklist

Run this against a production-like hosted setup before launch.

## Automated local hosted simulation

```bash
./scripts/pwa_hosted_smoke.sh
```

What this does:

1. Starts API in `prod` mode on localhost with isolated DB/media paths.
2. Bootstraps auth and logs in.
3. Seeds note/task/calendar/artifact data plus a voice capture upload.
4. Runs Playwright hosted smoke tests against a production `next build && next start` server.

Artifacts:

- run log: `artifacts/pwa-hosted-smoke/hosted-smoke-<timestamp>.log`
- API log: `artifacts/pwa-hosted-smoke/api-<timestamp>.log`
- screenshots: `artifacts/pwa-hosted-smoke/test-results/`

## Hosted (Railway) manual checks

1. PWA loads and session controls point at Railway API.
2. Notes: list/create/edit.
3. Tasks: list/create/update status.
4. Calendar: list/create and conflict panel visibility.
5. Artifacts: capture and graph/version detail load.
6. Sync Center: server activity + delta pull visible.
7. Mobile interoperability:
   - `POST /v1/capture` and `POST /v1/capture/voice` accept data against hosted API.
   - queued voice jobs appear under `/ai-jobs` or assistant job lists.
