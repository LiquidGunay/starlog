# PWA Go-Live Runbook

## Deployment order

1. Run release gate: `bash ./scripts/pwa_release_gate.sh`
2. Confirm Railway production config checklist:
   - `docs/PWA_RAILWAY_PROD_CONFIG_CHECKLIST.md`
3. Deploy API service (`starlog-api`).
4. Verify API health: `GET /v1/health` returns `env=prod`.
5. Deploy web service (`starlog-web`).
6. Run hosted smoke:
   - production-like local run: `bash ./scripts/pwa_hosted_smoke.sh`
   - Railway manual smoke: `docs/PWA_HOSTED_SMOKE_CHECKLIST.md`
7. Run portability drill: `./scripts/pwa_portability_drill.sh`

## Current release-candidate evidence

- Public web URL: `https://starlog-web-production.up.railway.app`
- Public API URL: `https://starlog-api-production.up.railway.app`
- Verified on 2026-03-22:
  - `curl -I https://starlog-web-production.up.railway.app` -> `HTTP/2 200`
  - `curl https://starlog-api-production.up.railway.app/v1/health` -> `{"status":"ok","env":"prod","users":1}`
  - `bash ./scripts/pwa_release_gate.sh` passed at `2026-03-22T14:18:37Z`
  - `bash ./scripts/pwa_hosted_smoke.sh` passed at `2026-03-22T14:16:56Z`
- Operator note:
  - this shell cannot currently administer Railway because `railway whoami` returns `Unauthorized. Please run railway login again.`
  - public hosted verification is still available, so release-candidate testing can proceed against the generated Railway domains

## Rollback triggers

Rollback immediately if any of the following occur post-deploy:

1. Auth bootstrap/login failures on fresh session.
2. Repeated 5xx responses on `/v1/notes`, `/v1/tasks`, `/v1/calendar/events`, `/v1/capture`.
3. Persistent media write failures under `/v1/capture/voice`.
4. PWA load failures or severe runtime JS errors.
5. Backup endpoint failure (`POST /v1/ops/backup` non-201).

## Rollback procedure

1. Roll back `starlog-web` to previous successful deployment.
2. If API-related regression is confirmed, roll back `starlog-api` to previous successful deployment.
3. Re-run health and smoke checks on rolled-back versions.
4. Freeze new deploys until root cause is documented and release gate is green again.

## Post-release monitoring (first 24h)

1. API:
   - `/v1/health` status and `env`.
   - 5xx error rate for notes/tasks/calendar/capture/backup routes.
2. Web:
   - runtime errors on `/notes`, `/tasks`, `/calendar`, `/artifacts`, `/sync-center`.
3. Queue and media:
   - voice capture uploads landing in media storage.
   - queued jobs progressing from pending/running to completed.
4. Daily safety check:
   - run `POST /v1/ops/backup` and verify backup file path is valid.
