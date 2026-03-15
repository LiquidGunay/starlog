# Railway Project Setup Status (WI-443)

Date: 2026-03-15

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

- `starlog-api`
  - status: live
  - health check: `https://starlog-api-production.up.railway.app/v1/health`
  - verified response: `{"status":"ok","env":"prod","users":0}`
- `starlog-web`
  - status: live
  - public URL: `https://starlog-web-production.up.railway.app`
  - verified response: `HTTP 200`

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
  - manual/supervised CLI deploy from repo root
- Applied build/start settings:
  - build command: `pnpm --filter web build`
  - start command: `pnpm --filter web exec next start --hostname 0.0.0.0 --port $PORT`
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

The important missing piece is GitHub source attachment for automatic deploys.

- Current service source for both Starlog services still shows `null` in Railway.
- The live services were deployed successfully via supervised CLI deploys.
- Automatic deploys from `master` are not configured yet and will require Railway service-source connection through the dashboard or GraphQL `serviceConnect`.

## Recommended next step

1. Connect both Starlog services to `LiquidGunay/starlog` so `master` pushes can deploy without supervised CLI pushes.
2. Decide whether to keep the generated Railway domains or add custom Starlog subdomains.
3. If higher-compute AI work is added later, split it into a separate service so the base API can keep sleeping cheaply.
