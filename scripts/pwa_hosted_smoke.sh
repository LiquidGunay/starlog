#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARTIFACT_DIR="${STARLOG_PWA_HOSTED_SMOKE_ARTIFACT_DIR:-$ROOT_DIR/.localdata/pwa-hosted-smoke/latest}"
RUNTIME_DIR="$ARTIFACT_DIR/runtime"
LOG_PATH="$ARTIFACT_DIR/hosted-smoke.log"
API_LOG_PATH="$ARTIFACT_DIR/api.log"
TEST_RESULTS_DIR="${STARLOG_PWA_HOSTED_TEST_RESULTS_DIR:-$ARTIFACT_DIR/test-results}"
API_PORT="${STARLOG_HOSTED_SMOKE_API_PORT:-8000}"
API_BASE="http://127.0.0.1:${API_PORT}"
PASS_PHRASE="${STARLOG_SMOKE_PASSPHRASE:-hosted-smoke-passphrase-2026}"
SMOKE_LABEL="Hosted Smoke ${STAMP}"
TOKEN=""
API_PID=""

require_safe_latest_artifact_dir() {
  local path="$1"
  local lane_suffix="/.localdata/pwa-hosted-smoke/latest"
  local worktree_parent
  worktree_parent="$(dirname "$ROOT_DIR")"

  if [[ -z "$path" || "$path" != /* ]]; then
    echo "refusing unsafe artifact dir: $path" >&2
    exit 1
  fi
  path="$(realpath -m "$path")"
  if [[ "$path" == "$ROOT_DIR/artifacts" || "$path" == "$ROOT_DIR/artifacts/"* ]]; then
    echo "refusing artifact dir under tracked artifacts root: $path" >&2
    exit 1
  fi
  if [[ "$path" == "/" || "$path" == "/tmp" || "$path" == "/tmp/"* || "$path" == "$ROOT_DIR" || "$path" == "$ROOT_DIR/.localdata" || "$path" == "$worktree_parent" ]]; then
    echo "refusing unsafe artifact dir: $path" >&2
    exit 1
  fi
  if [[ "$path" != *"$lane_suffix" ]]; then
    echo "artifact dir must end with $lane_suffix: $path" >&2
    exit 1
  fi
}

require_safe_latest_artifact_dir "$ARTIFACT_DIR"

require_safe_test_results_dir() {
  local path="$1"
  local lane_suffix="/.localdata/pwa-hosted-smoke/latest/test-results"
  local worktree_parent
  worktree_parent="$(dirname "$ROOT_DIR")"

  if [[ -z "$path" || "$path" != /* ]]; then
    echo "refusing unsafe Playwright test-results dir: $path" >&2
    exit 1
  fi
  path="$(realpath -m "$path")"
  if [[ "$path" == "$ROOT_DIR/artifacts" || "$path" == "$ROOT_DIR/artifacts/"* ]]; then
    echo "refusing Playwright test-results dir under tracked artifacts root: $path" >&2
    exit 1
  fi
  if [[ "$path" == "/" || "$path" == "/tmp" || "$path" == "/tmp/"* || "$path" == "$ROOT_DIR" || "$path" == "$ROOT_DIR/.localdata" || "$path" == "$worktree_parent" ]]; then
    echo "refusing unsafe Playwright test-results dir: $path" >&2
    exit 1
  fi
  if [[ "$path" != *"$lane_suffix" ]]; then
    echo "Playwright test-results dir must end with $lane_suffix: $path" >&2
    exit 1
  fi
}

require_safe_test_results_dir "$TEST_RESULTS_DIR"
TEST_RESULTS_DIR="$(realpath -m "$TEST_RESULTS_DIR")"

rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR" "$RUNTIME_DIR"
: >"$LOG_PATH"
: >"$API_LOG_PATH"

export STARLOG_PWA_HOSTED_SMOKE_ARTIFACT_DIR="$ARTIFACT_DIR"
export STARLOG_PWA_HOSTED_TEST_RESULTS_DIR="$TEST_RESULTS_DIR"

exec > >(tee "$LOG_PATH") 2>&1

cleanup() {
  if [[ -n "$API_PID" ]]; then
    if kill -0 "$API_PID" 2>/dev/null; then
      kill "$API_PID" 2>/dev/null || true
      wait "$API_PID" 2>/dev/null || true
    fi
  fi
}

trap cleanup EXIT

echo "[pwa-hosted-smoke] started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[pwa-hosted-smoke] repo root: $ROOT_DIR"
echo "[pwa-hosted-smoke] log: $LOG_PATH"

echo "[pwa-hosted-smoke] starting API on ${API_BASE}"
STARLOG_ENV=prod \
STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
STARLOG_SECRETS_MASTER_KEY="hosted-smoke-master-key-${STAMP}" \
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
  echo "[pwa-hosted-smoke] bootstrap failed with HTTP ${BOOTSTRAP_STATUS}" >&2
  exit 1
fi

TOKEN="$(curl -fsS \
  -X POST "$API_BASE/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"passphrase\":\"${PASS_PHRASE}\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"

AUTH_HEADER="Authorization: Bearer ${TOKEN}"
NOW="$(date -u +"%Y-%m-%d")"

curl -fsS -X POST "$API_BASE/v1/notes" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"${SMOKE_LABEL} Note\",\"body_md\":\"Railway hosted smoke note\"}" >/dev/null

curl -fsS -X POST "$API_BASE/v1/tasks" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"${SMOKE_LABEL} Task\",\"status\":\"todo\",\"priority\":3}" >/dev/null

curl -fsS -X POST "$API_BASE/v1/calendar/events" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"${SMOKE_LABEL} Event\",\"starts_at\":\"${NOW}T09:00:00Z\",\"ends_at\":\"${NOW}T10:00:00Z\",\"source\":\"internal\"}" >/dev/null

curl -fsS -X POST "$API_BASE/v1/capture" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"source_type\":\"clip_manual\",\"capture_source\":\"hosted_smoke\",\"title\":\"${SMOKE_LABEL} Artifact\",\"raw\":{\"text\":\"Hosted smoke raw\",\"mime_type\":\"text/plain\"},\"normalized\":{\"text\":\"Hosted smoke raw\",\"mime_type\":\"text/plain\"},\"extracted\":{\"text\":\"Hosted smoke raw\",\"mime_type\":\"text/plain\"},\"metadata\":{\"origin\":\"hosted_smoke\"}}" >/dev/null

VOICE_SAMPLE="$ARTIFACT_DIR/voice-sample.wav"
printf "RIFFSMOKEWAVE" > "$VOICE_SAMPLE"
curl -fsS -X POST "$API_BASE/v1/capture/voice" \
  -H "$AUTH_HEADER" \
  -F "title=${SMOKE_LABEL} Voice" \
  -F "provider_hint=whisper_local" \
  -F "file=@${VOICE_SAMPLE};type=audio/wav" >/dev/null

curl -fsS "$API_BASE/v1/notes" -H "$AUTH_HEADER" >/dev/null
curl -fsS "$API_BASE/v1/tasks" -H "$AUTH_HEADER" >/dev/null
curl -fsS "$API_BASE/v1/calendar/events" -H "$AUTH_HEADER" >/dev/null
curl -fsS "$API_BASE/v1/artifacts" -H "$AUTH_HEADER" >/dev/null
curl -fsS "$API_BASE/v1/sync/activity?limit=5" -H "$AUTH_HEADER" >/dev/null

echo "[pwa-hosted-smoke] running hosted smoke Playwright suite"
STARLOG_E2E_API_BASE="$API_BASE" \
STARLOG_E2E_TOKEN="$TOKEN" \
STARLOG_SMOKE_LABEL="$SMOKE_LABEL" \
./node_modules/.bin/playwright test --config=playwright.hosted.config.ts

echo "[pwa-hosted-smoke] PASS at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[pwa-hosted-smoke] playwright screenshots: $TEST_RESULTS_DIR"
echo "[pwa-hosted-smoke] api log: $API_LOG_PATH"
