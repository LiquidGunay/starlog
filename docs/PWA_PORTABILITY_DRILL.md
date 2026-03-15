# PWA Portability Drill

Run this drill before go-live and periodically after launch.

## One-command drill

```bash
./scripts/pwa_portability_drill.sh
```

The drill covers:

1. Export/import roundtrip verification (`make verify-export`).
2. Auth bootstrap/login against prod-mode API runtime.
3. `POST /v1/ops/backup` execution and backup file existence check.

Artifacts:

- drill log: `artifacts/pwa-portability-drill/portability-drill-<timestamp>.log`
- export roundtrip output: `artifacts/pwa-portability-drill/export-roundtrip-<timestamp>.txt`
- backup response JSON: `artifacts/pwa-portability-drill/backup-response-<timestamp>.json`
- API log: `artifacts/pwa-portability-drill/api-<timestamp>.log`

Pass criteria:

1. `make verify-export` succeeds.
2. Backup endpoint returns `201` with non-zero `bytes_written`.
3. `backup_path` from response exists on disk.
