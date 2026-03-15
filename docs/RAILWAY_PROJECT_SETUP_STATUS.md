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

## Important deployment guardrail

No Starlog deployment was triggered in this pass.

The following were intentionally deferred until explicit deploy approval:

- source repo wiring
- build/start command wiring
- persistent volume attach for `starlog-api`
- production env var writes
- custom domain changes
- first deploy/redeploy

This keeps the existing `perfect-intuition` project stable while reserving the Starlog service slots and default service domains.

## Ready-to-apply deployment config

Apply these only when deploy approval is given.

### `starlog-api`

- Source repo: `LiquidGunay/starlog`
- Branch: current release branch or `master` after merge approval
- Runtime path:
  - repo root remains `starlog`
  - deploy from `services/api`
  - use the existing API Dockerfile path under `services/api/Dockerfile`
- Persistent volume:
  - mount path: `/app/.localdata`
- Required env vars:
  - `STARLOG_ENV=prod`
  - `STARLOG_DB_PATH=/app/.localdata/starlog.db`
  - `STARLOG_MEDIA_DIR=/app/.localdata/media`
  - `STARLOG_SECRETS_MASTER_KEY=<long-random-secret>`
  - `STARLOG_CORS_ALLOW_ORIGINS=https://<your-web-domain>`
- Optional calendar env vars:
  - `STARLOG_GOOGLE_CLIENT_ID`
  - `STARLOG_GOOGLE_CLIENT_SECRET`
  - `STARLOG_GOOGLE_REDIRECT_URI=https://<api-domain>/v1/calendar/sync/google/oauth/callback`

### `starlog-web`

- Source repo: `LiquidGunay/starlog`
- Branch: current release branch or `master` after merge approval
- Build/start settings:
  - build command: `pnpm --filter web build`
  - start command: `pnpm --filter web start -- --hostname 0.0.0.0 --port $PORT`
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

1. Low-touch single-user setup with sleepy web usage.
   - `starlog-api`: roughly `512 MB` RAM average while active, `~0.05 vCPU` average, `~1 GB` actual stored data.
   - `starlog-web`: mostly idle/sleeping or very low usage.
   - Rough Starlog incremental cost: about `$6-$8/month`, plus minor egress.

2. Daily-use single-user setup with both API and web warm much of the month.
   - `starlog-api`: `512 MB` RAM + `~0.05-0.10 vCPU` average + `1-5 GB` stored data.
   - `starlog-web`: `256 MB` RAM + `~0.02-0.05 vCPU` average.
   - Rough Starlog incremental cost: about `$9-$13/month`, plus egress.

3. Practical budget expectation for v1 in this existing project.
   - If the current personal-site usage is low, total workspace cost may still land near the hobby floor plus Starlog's incremental compute.
   - If both Starlog services are kept warm continuously, a realistic combined workspace total is more likely to move into the low-teens per month.

Inference note:
The pricing docs describe billing as plan + resource usage. Since Starlog is being added to an existing project/workspace rather than a separate project, there is no separate flat "Starlog project" fee implied by the docs; the bill impact is the added resource usage from the two Starlog services.

## Recommended next step

Before any first deployment, confirm:

1. which branch should be wired as the initial Railway source,
2. which custom domains, if any, should be added for Starlog,
3. the production `STARLOG_SECRETS_MASTER_KEY`, and
4. whether the first deploy should happen from Railway GitHub source or a manual supervised push.
