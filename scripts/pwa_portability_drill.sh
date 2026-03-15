#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARTIFACT_DIR="$ROOT_DIR/artifacts/pwa-portability-drill"
RUNTIME_DIR="$ARTIFACT_DIR/runtime"
LOG_PATH="$ARTIFACT_DIR/portability-drill-${STAMP}.log"
API_LOG_PATH="$ARTIFACT_DIR/api-${STAMP}.log"
BACKUP_RESPONSE_PATH="$ARTIFACT_DIR/backup-response-${STAMP}.json"
EXPORT_REPORT_PATH="$ARTIFACT_DIR/export-roundtrip-${STAMP}.txt"
API_PORT="${STARLOG_PORTABILITY_API_PORT:-8010}"
API_BASE="http://127.0.0.1:${API_PORT}"
PASS_PHRASE="${STARLOG_SMOKE_PASSPHRASE:-portability-passphrase-2026}"
TOKEN=""
API_PID=""

mkdir -p "$ARTIFACT_DIR" "$RUNTIME_DIR"
touch "$LOG_PATH" "$API_LOG_PATH"

exec > >(tee -a "$LOG_PATH") 2>&1

cleanup() {
  if [[ -n "$API_PID" ]]; then
    if kill -0 "$API_PID" 2>/dev/null; then
      kill "$API_PID" 2>/dev/null || true
      wait "$API_PID" 2>/dev/null || true
    fi
  fi
}

trap cleanup EXIT

echo "[pwa-portability-drill] started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[pwa-portability-drill] starting API on ${API_BASE}"
STARLOG_ENV=prod \
STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
STARLOG_SECRETS_MASTER_KEY="portability-master-key-${STAMP}" \
STARLOG_CORS_ALLOW_ORIGINS="http://127.0.0.1:3007" \
uv run --project "$ROOT_DIR/services/api" \
  uvicorn app.main:app \
  --host 127.0.0.1 \
  --port "$API_PORT" \
  --app-dir "$ROOT_DIR/services/api" \
  >"$API_LOG_PATH" 2>&1 &
API_PID="$!"

for _ in $(seq 1 60); do
  if curl -fsS "$API_BASE/v1/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$API_BASE/v1/health" >/dev/null

BOOTSTRAP_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "$API_BASE/v1/auth/bootstrap" \
  -H "Content-Type: application/json" \
  -d "{\"passphrase\":\"${PASS_PHRASE}\"}")"
if [[ "$BOOTSTRAP_STATUS" != "201" && "$BOOTSTRAP_STATUS" != "409" ]]; then
  echo "[pwa-portability-drill] bootstrap failed with HTTP ${BOOTSTRAP_STATUS}" >&2
  exit 1
fi

TOKEN="$(curl -fsS \
  -X POST "$API_BASE/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"passphrase\":\"${PASS_PHRASE}\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"

AUTH_HEADER="Authorization: Bearer ${TOKEN}"

curl -fsS -X POST "$API_BASE/v1/notes" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Portability drill note\",\"body_md\":\"Backup drill payload\"}" >/dev/null

echo "[pwa-portability-drill] running verify-export roundtrip"
(
  cd "$ROOT_DIR"
  STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
    uv run --project services/api python -m app.verify_export_roundtrip --db-path "$RUNTIME_DIR/starlog.db"
) | tee "$EXPORT_REPORT_PATH"

curl -fsS -X POST "$API_BASE/v1/ops/backup" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  > "$BACKUP_RESPONSE_PATH"

BACKUP_PATH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["backup_path"])' "$BACKUP_RESPONSE_PATH")"
BYTES_WRITTEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bytes_written"])' "$BACKUP_RESPONSE_PATH")"

if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "[pwa-portability-drill] expected backup file missing: $BACKUP_PATH" >&2
  exit 1
fi

echo "[pwa-portability-drill] backup file: $BACKUP_PATH"
echo "[pwa-portability-drill] bytes written: $BYTES_WRITTEN"
echo "[pwa-portability-drill] backup response JSON: $BACKUP_RESPONSE_PATH"
echo "[pwa-portability-drill] verify-export report: $EXPORT_REPORT_PATH"
echo "[pwa-portability-drill] PASS at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
