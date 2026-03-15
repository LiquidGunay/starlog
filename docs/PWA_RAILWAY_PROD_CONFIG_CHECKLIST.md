# PWA Railway Production Config Checklist

Use this checklist before the first Railway production deployment and whenever config changes.

## API service (`starlog-api`)

Required environment values:

```text
STARLOG_ENV=prod
STARLOG_DB_PATH=/app/.localdata/starlog.db
STARLOG_MEDIA_DIR=/app/.localdata/media
STARLOG_SECRETS_MASTER_KEY=<long-random-secret>
STARLOG_CORS_ALLOW_ORIGINS=https://<your-web-domain>
```

Validation checks:

1. Persistent volume is attached and mounted at `/app/.localdata`.
2. `STARLOG_ENV` is `prod`.
3. `STARLOG_SECRETS_MASTER_KEY` is non-empty and high-entropy.
4. `STARLOG_CORS_ALLOW_ORIGINS` is not `*` and points at your real PWA domain.
5. `https://<api-domain>/v1/health` returns `{"status":"ok","env":"prod",...}`.

Optional Google calendar values:

```text
STARLOG_GOOGLE_CLIENT_ID=...
STARLOG_GOOGLE_CLIENT_SECRET=...
STARLOG_GOOGLE_REDIRECT_URI=https://<api-domain>/v1/calendar/sync/google/oauth/callback
```

## Web service (`starlog-web`)

Required service settings:

1. Root directory: repo root.
2. Build command: `pnpm --filter web build`
3. Start command: `pnpm --filter web start -- --hostname 0.0.0.0 --port $PORT`
4. Public domain attached and reachable via HTTPS.

Validation checks:

1. Root URL loads and renders the Starlog home shell.
2. Session controls accept API base set to Railway API URL.
3. No mixed-content warnings in browser console.

## Mandatory pre-deploy gate

Run from repo root:

```bash
./scripts/pwa_release_gate.sh
```

Do not deploy if this gate fails.
