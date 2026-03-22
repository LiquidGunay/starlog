# Railway Project Setup Status (WI-443)

Date: 2026-03-22

## Current linked project

- Workspace: `liquidgunay's Projects`
- Railway project: `perfect-intuition`
- Reason for using this project: Starlog is being added alongside the existing personal website services instead of using a separate Railway project.

## Existing project services before Starlog setup

- `web`
- `personal-feed`

## Starlog services created in Railway

- `starlog-api`
  - service id: `9c951e1e-45d3-4817-9e18-a059c3c39800`
  - generated Railway domain: `https://starlog-api-production.up.railway.app`
- `starlog-web`
  - service id: `c55d2d8a-5adb-4a0c-a5fe-623dc3f25478`
  - generated Railway domain: `https://starlog-web-production.up.railway.app`

## Live deployment status

Deploy approval was given and the first supervised production deployments are live on the existing `perfect-intuition` project.

On 2026-03-15, `master` was updated to include the `next@15.0.7` security fix so GitHub-based Railway builds against `master` no longer hit the prior `next@15.0.0` vulnerability gate.

On 2026-03-22, the public Railway endpoints were re-checked as part of WI-582 to make the hosted PWA path concrete for user testing.

- `starlog-api`
  - status: live
  - health check: `https://starlog-api-production.up.railway.app/v1/health`
  - verified response on 2026-03-22: `{"status":"ok","env":"prod","users":1}`
- `starlog-web`
  - status: live
  - public URL: `https://starlog-web-production.up.railway.app`
  - verified response on 2026-03-22: `HTTP/2 200`
  - current edge headers confirm Railway + Next.js are serving the app (`server: railway-edge`, `x-powered-by: Next.js`)
  - GitHub deploy status on 2026-03-15: source hook is active, but one deploy failed because the live Railway start command still used the old `pnpm --filter web start -- --hostname ...` form.
  - repo release evidence on 2026-03-22:
    - local production-style release gate completed successfully when run in isolation
    - `bash ./scripts/pwa_hosted_smoke.sh` passed end-to-end at `2026-03-22T14:09:08Z`
    - hosted smoke artifacts: `artifacts/pwa-hosted-smoke/hosted-smoke-20260322T140804Z.log`

## Railway access note for this environment

- Public hosted verification works from this shell.
- Railway CLI administration is currently blocked here because `railway whoami` returns `Unauthorized. Please run railway login again.`
- Result: this WI verified live public URLs and release readiness, but did not mutate live Railway config from this environment.

## Applied deployment config

### `starlog-api`

- Current deploy path:
  - manual/supervised CLI deploy from repo root
  - Dockerfile path: `services/api/Dockerfile.railway`
- Persistent volume:
  - mount path: `/app/.localdata`
- Applied env vars:
  - `STARLOG_ENV=prod`
  - `STARLOG_DB_PATH=/app/.localdata/starlog.db`
  - `STARLOG_MEDIA_DIR=/app/.localdata/media`
  - `STARLOG_SECRETS_MASTER_KEY=<configured>`
  - `STARLOG_CORS_ALLOW_ORIGINS=https://starlog-web-production.up.railway.app`
- Optional calendar env vars:
  - `STARLOG_GOOGLE_CLIENT_ID`
  - `STARLOG_GOOGLE_CLIENT_SECRET`
  - `STARLOG_GOOGLE_REDIRECT_URI=https://<api-domain>/v1/calendar/sync/google/oauth/callback`
- Watch paths:
  - `/services/api/**`
  - `/pnpm-lock.yaml`

### `starlog-web`

- Current deploy path:
  - GitHub-connected deploys from `master`
- Applied build/start settings:
  - build command: `pnpm --filter web build`
  - start command: `pnpm --filter web exec next start --hostname 0.0.0.0 --port $PORT`
- Compatibility note:
  - the web workspace now strips a stray leading `--` in its package `start` wrapper so the current misconfigured Railway command can still boot until the dashboard value is corrected
- The web service does not need a persistent volume.
- The PWA can initially use the generated Railway domain until a custom Starlog domain/subdomain is chosen.

## Suggested Starlog domains

These are optional and should not replace the existing personal-site domains unless that change is intentional.

- API: `starlog-api.<your-domain>` or `api.starlog.<your-domain>`
- Web: `starlog.<your-domain>`

## Cost estimate

Reference pricing used for this estimate:

- Hobby plan minimum: `$5/month`
- RAM: `$10/GB-month`
- vCPU: `$20/vCPU-month`
- Volume usage: `$0.15/GB-month`
- Network egress: `$0.05/GB`

Official docs:

- `https://docs.railway.com/reference/pricing`
- `https://docs.railway.com/guides/volumes`

### Rough incremental Starlog cost scenarios

These are estimates, not invoices. They assume the existing personal-site services remain in the same workspace/project and that Starlog adds incremental usage on top of the current hobby setup.

1. Low-touch single-user setup with app sleeping enabled.
   - Railway docs say sleeping services incur no compute charges while asleep.
   - With `sleepApplication=true` on both Starlog services and bursty personal use, the realistic incremental cost should sit near the hobby floor plus storage/egress.
   - Rough Starlog incremental cost: about `$5-$6/month`, plus volume and minor egress.

2. Daily-use single-user setup with regular wake-ups across the day.
   - `starlog-api`: `512 MB` RAM + low CPU while active + small persistent volume.
   - `starlog-web`: mostly sleeping between sessions, waking on access.
   - Rough Starlog incremental cost: about `$6-$8/month`, plus egress.

3. Higher-activity setup or later split services.
   - If the API stays warm much more often, or higher-compute jobs are split into dedicated services later, the incremental cost will rise with active compute time rather than from a fixed second-project fee.
   - That is the point where separating low-compute and high-compute services becomes cost-relevant.

Inference note:
The pricing docs describe usage-based compute plus the plan floor. Since Starlog is being added to an existing project/workspace rather than a separate project, the bill impact should mainly be incremental resource usage from the two Starlog services, not a second per-project flat fee.

## Remaining setup gap

The main hosted-admin gap is still direct Railway dashboard/CLI confirmation of the live web start command.

- GitHub source attachment is active; prior commit statuses on `master` showed Railway receiving and acting on repo updates.
- Repo docs and package-level compatibility fallback both point to the preferred live setting:
  - `pnpm --filter web exec next start --hostname 0.0.0.0 --port $PORT`
- This shell could not confirm or update that dashboard value directly because Railway CLI auth is missing.

## Recommended next step

1. Re-authenticate Railway CLI or inspect the Railway dashboard, then confirm `starlog-web` is using `pnpm --filter web exec next start --hostname 0.0.0.0 --port $PORT`.
2. If the live dashboard still differs, update it and re-trigger a GitHub deploy from `master`.
3. Re-run `bash ./scripts/pwa_hosted_smoke.sh` and the hosted manual checklist after that config confirmation.
4. Decide whether to keep the generated Railway domains or add custom Starlog subdomains.
