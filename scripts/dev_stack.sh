#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAN_MODE=0

for arg in "$@"; do
  case "$arg" in
    --lan)
      LAN_MODE=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: ./scripts/dev_stack.sh [--lan]" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but was not found on PATH." >&2
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
elif [[ -x "$ROOT_DIR/node_modules/.bin/pnpm" ]]; then
  PNPM_CMD=("$ROOT_DIR/node_modules/.bin/pnpm")
elif command -v npx >/dev/null 2>&1; then
  PNPM_CMD=(npx pnpm@9.15.0)
else
  echo "pnpm is required but was not found on PATH, in node_modules/.bin, or through npx." >&2
  exit 1
fi

WEB_URL="http://localhost:3000"
WEB_CMD=("${PNPM_CMD[@]}" --filter web dev)
if [[ "$LAN_MODE" -eq 1 ]]; then
  WEB_URL="http://0.0.0.0:3000"
  WEB_CMD+=("--" "--hostname" "0.0.0.0" "--port" "3000")
fi

API_CMD=(uv run --project services/api uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --app-dir services/api)

echo "[setup] installing workspace dependencies"
"${PNPM_CMD[@]}" install

echo "[setup] syncing API environment"
uv sync --project services/api --extra dev

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  wait "${API_PID:-}" 2>/dev/null || true
  wait "${WEB_PID:-}" 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

echo "[run] starting API on http://0.0.0.0:8000"
"${API_CMD[@]}" \
  > >(sed 's/^/[api] /') \
  2> >(sed 's/^/[api] /' >&2) &
API_PID=$!

echo "[run] starting web on ${WEB_URL}"
"${WEB_CMD[@]}" \
  > >(sed 's/^/[web] /') \
  2> >(sed 's/^/[web] /' >&2) &
WEB_PID=$!

echo "[ready] Starlog local stack is launching"
echo "[ready] Web: ${WEB_URL}"
echo "[ready] API: http://0.0.0.0:8000"
echo "[ready] Press Ctrl-C to stop both services"

wait -n "$API_PID" "$WEB_PID"
