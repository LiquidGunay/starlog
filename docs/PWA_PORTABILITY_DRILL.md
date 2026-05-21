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

- drill log: `.localdata/pwa-portability-drill/latest/portability-drill.log`
- export roundtrip output: `.localdata/pwa-portability-drill/latest/export-roundtrip.txt`
- backup response JSON: `.localdata/pwa-portability-drill/latest/backup-response.json`
- API log: `.localdata/pwa-portability-drill/latest/api.log`

`STARLOG_PWA_PORTABILITY_ARTIFACT_DIR` is constrained to a path ending in `.localdata/pwa-portability-drill/latest`;
the drill deletes and recreates only that narrow current evidence directory.

Pass criteria:

1. `make verify-export` succeeds.
2. Backup endpoint returns `201` with non-zero `bytes_written`.
3. `backup_path` from response exists on disk.
