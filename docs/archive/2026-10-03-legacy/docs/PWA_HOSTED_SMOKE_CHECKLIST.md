# PWA Hosted Smoke Checklist

Run this against a production-like hosted setup before launch.

For current confidence and freshness caveats across surfaces, see
[docs/CURRENT_STATE.md](/home/ubuntu/starlog/docs/CURRENT_STATE.md). This checklist keeps the hosted
PWA smoke procedure and historical hosted evidence.

## Automated local hosted simulation

```bash
bash ./scripts/pwa_hosted_smoke.sh
```

What this does:

1. Starts API in `prod` mode on localhost with isolated DB/media paths.
2. Bootstraps auth and logs in.
3. Seeds note/task/calendar/artifact data plus a voice capture upload.
4. Runs Playwright hosted smoke tests against a production `next build && next start` server.

Artifacts should stay out of tracked timestamped `artifacts/**` folders for normal validation. Keep
current generated output in `.localdata/pwa-hosted-smoke/latest/`, another ignored
lane-specific latest path, or a single explicitly requested current proof path, and summarize current confidence in
[docs/CURRENT_STATE.md](/home/ubuntu/starlog/docs/CURRENT_STATE.md).

Current default paths:

- run log: `.localdata/pwa-hosted-smoke/latest/hosted-smoke.log`
- API log: `.localdata/pwa-hosted-smoke/latest/api.log`
- screenshots: `.localdata/pwa-hosted-smoke/latest/test-results/`

`STARLOG_PWA_HOSTED_SMOKE_ARTIFACT_DIR` is intentionally constrained to a path ending in
`.localdata/pwa-hosted-smoke/latest`; the script deletes and recreates only that narrow current
evidence directory. Use `STARLOG_PWA_HOSTED_TEST_RESULTS_DIR` when Playwright output needs a
different test-results location for collection; it must be an absolute path ending in
`.localdata/pwa-hosted-smoke/latest/test-results`.

Historical WI-582 pass:
  - completed at: `2026-03-22T14:16:56Z`
  - dated log paths are historical only; regenerate current evidence under the default latest path above

## Hosted (Railway) manual checks

Hosted URLs currently in use:

- web: `https://starlog-web-production.up.railway.app`
- API: `https://starlog-api-production.up.railway.app`
- API health probe: `https://starlog-api-production.up.railway.app/v1/health`

Historical public checks from this repo pass on 2026-03-22:

- `curl -I https://starlog-web-production.up.railway.app` -> `HTTP/2 200`
- `curl https://starlog-api-production.up.railway.app/v1/health` -> `{"status":"ok","env":"prod","users":1}`

For current hosted access status, use [docs/CURRENT_STATE.md](/home/ubuntu/starlog/docs/CURRENT_STATE.md).

## Hosted passphrase reset

Use this only for the single-user hosted instance when the original passphrase is lost.

1. Deploy API code that includes `POST /v1/auth/reset-passphrase`.
2. Set a temporary secret on the Railway API service:

```text
STARLOG_AUTH_RESET_TOKEN=<long-random-one-time-token>
```

3. Reset the passphrase from a trusted shell:

```bash
curl -fsS -X POST "https://starlog-api-production.up.railway.app/v1/auth/reset-passphrase" \
  -H "Content-Type: application/json" \
  -H "X-Starlog-Reset-Token: $STARLOG_AUTH_RESET_TOKEN" \
  -d '{"passphrase":"<new-single-user-passphrase>","confirmation":"RESET PASSPHRASE"}'
```

4. Verify login with the new passphrase.
5. Remove `STARLOG_AUTH_RESET_TOKEN` from Railway after verification.

The reset endpoint is disabled when `STARLOG_AUTH_RESET_TOKEN` is unset and clears existing
Starlog sessions when it changes the passphrase. Reset tokens are one-time per Starlog database;
if a reset must be retried after a successful call, rotate `STARLOG_AUTH_RESET_TOKEN` first.

Automated hosted probe (recommended, includes the `/assistant` + `/review` + `/decks` regression guard):

```bash
STARLOG_HOSTED_WEB_ORIGIN=https://starlog-web-production.up.railway.app \
STARLOG_HOSTED_API_BASE=https://starlog-api-production.up.railway.app \
STARLOG_VERIFY_RUN_APK=0 \
./scripts/verify_hosted_pwa_and_apk.sh
```

If you want the same command to verify that the hosted deck browser can actually load deck data, add a live bearer token:

```bash
STARLOG_HOSTED_WEB_ORIGIN=https://starlog-web-production.up.railway.app \
STARLOG_HOSTED_API_BASE=https://starlog-api-production.up.railway.app \
STARLOG_VERIFY_TOKEN=YOUR_BEARER_TOKEN \
STARLOG_VERIFY_RUN_APK=0 \
./scripts/verify_hosted_pwa_and_apk.sh
```

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
