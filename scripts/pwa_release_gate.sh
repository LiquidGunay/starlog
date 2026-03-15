#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARTIFACT_DIR="$ROOT_DIR/artifacts/pwa-release-gate"
LOG_PATH="$ARTIFACT_DIR/gate-${STAMP}.log"

mkdir -p "$ARTIFACT_DIR"
touch "$LOG_PATH"

exec > >(tee -a "$LOG_PATH") 2>&1

run_step() {
  local label="$1"
  shift
  echo
  echo "[pwa-release-gate] $label"
  "$@"
}

echo "[pwa-release-gate] started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[pwa-release-gate] repo root: $ROOT_DIR"
echo "[pwa-release-gate] log: $LOG_PATH"

run_step "Typecheck web workspace" \
  bash -lc "cd \"$ROOT_DIR\" && npx pnpm@9.15.0 --filter web exec tsc --noEmit"

run_step "Lint web workspace" \
  bash -lc "cd \"$ROOT_DIR/apps/web\" && ./node_modules/.bin/next lint"

run_step "Build web workspace" \
  bash -lc "cd \"$ROOT_DIR/apps/web\" && ./node_modules/.bin/next build"

run_step "Run offline-focused Playwright suite" \
  bash -lc "cd \"$ROOT_DIR\" && ./node_modules/.bin/playwright test --config=playwright.web.config.ts"

echo
echo "[pwa-release-gate] PASS at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[pwa-release-gate] screenshots: $ARTIFACT_DIR/test-results"
