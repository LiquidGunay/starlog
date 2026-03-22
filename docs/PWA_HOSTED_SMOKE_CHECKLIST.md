# PWA Hosted Smoke Checklist

Run this against a production-like hosted setup before launch.

## Automated local hosted simulation

```bash
bash ./scripts/pwa_hosted_smoke.sh
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
- latest verified pass in WI-582:
  - run log: `artifacts/pwa-hosted-smoke/hosted-smoke-20260322T141604Z.log`
  - API log: `artifacts/pwa-hosted-smoke/api-20260322T141604Z.log`
  - completed at: `2026-03-22T14:16:56Z`

## Hosted (Railway) manual checks

Hosted URLs currently in use:

- web: `https://starlog-web-production.up.railway.app`
- API: `https://starlog-api-production.up.railway.app`
- API health probe: `https://starlog-api-production.up.railway.app/v1/health`

Latest public checks from this repo pass:

- `curl -I https://starlog-web-production.up.railway.app` -> `HTTP/2 200`
- `curl https://starlog-api-production.up.railway.app/v1/health` -> `{"status":"ok","env":"prod","users":1}`

Manual checklist:

1. PWA loads on `https://starlog-web-production.up.railway.app`.
2. Runtime page shows the current API base and session controls point at the Railway API.
3. Notes: list/create/edit.
4. Tasks: list/create/update status.
5. Calendar: list/create and conflict panel visibility.
6. Artifacts: capture and graph/version detail load.
7. Sync Center: server activity + delta pull visible.
8. Mobile interoperability:
   - `POST /v1/capture` and `POST /v1/capture/voice` accept data against hosted API.
   - queued voice jobs appear under `/ai-jobs` or assistant job lists.
