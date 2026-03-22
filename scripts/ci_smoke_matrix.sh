#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARTIFACT_DIR="$ROOT_DIR/artifacts/ai-validation-smoke"
LOG_PATH="$ARTIFACT_DIR/smoke-${STAMP}.log"

INCLUDE_WATCH=0
INCLUDE_OPENAI_LIVE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-watch)
      INCLUDE_WATCH=1
      ;;
    --include-openai-live)
      INCLUDE_OPENAI_LIVE=1
      ;;
    *)
      echo "[ci-smoke-matrix] unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

mkdir -p "$ARTIFACT_DIR"
touch "$LOG_PATH"

exec > >(tee -a "$LOG_PATH") 2>&1

run_step() {
  local label="$1"
  shift
  echo
  echo "[ci-smoke-matrix] $label"
  "$@"
}

echo "[ci-smoke-matrix] started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[ci-smoke-matrix] repo root: $ROOT_DIR"
echo "[ci-smoke-matrix] log: $LOG_PATH"

run_step "Runtime smoke pytest" \
  bash -lc "cd \"$ROOT_DIR/services/ai-runtime\" && uv run --project . --extra dev pytest -s tests/test_openai_smoke.py tests/test_eval_fixtures.py bridge/tests/test_server.py"

run_step "API conversation smoke" \
  bash -lc "cd \"$ROOT_DIR/services/api\" && uv run --project . --extra dev pytest -s tests/test_conversations.py"

run_step "Web typecheck" \
  bash -lc "cd \"$ROOT_DIR/apps/web\" && ./node_modules/.bin/tsc --noEmit"

run_step "Desktop helper local-bridge smoke" \
  bash -lc "cd \"$ROOT_DIR\" && ./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep 'configured local bridge with bridge auth|discover a reachable localhost bridge'"

if [[ "$INCLUDE_WATCH" -eq 1 ]]; then
  run_step "Watch lane: voice-native API regression" \
    bash -lc "cd \"$ROOT_DIR/services/api\" && uv run --project . --extra dev pytest -s tests/test_voice_native_regression.py"

  echo
  echo "[ci-smoke-matrix] watch lanes for assistant Playwright remain manual until WI-522/WI-523 is recovered on current master."
fi

if [[ "$INCLUDE_OPENAI_LIVE" -eq 1 ]]; then
  run_step "Live OpenAI smoke" \
    bash -lc "cd \"$ROOT_DIR/services/ai-runtime\" && uv run --project . python scripts/openai_smoke.py"
fi

echo
echo "[ci-smoke-matrix] PASS at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[ci-smoke-matrix] log: $LOG_PATH"
