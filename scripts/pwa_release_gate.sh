#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARTIFACT_DIR="${STARLOG_PWA_RELEASE_GATE_ARTIFACT_DIR:-$ROOT_DIR/.localdata/pwa-release-gate/latest}"
LOG_PATH="$ARTIFACT_DIR/gate.log"
TEST_RESULTS_DIR="${STARLOG_PWA_RELEASE_GATE_TEST_RESULTS_DIR:-$ARTIFACT_DIR/test-results}"

require_safe_latest_artifact_dir() {
  local path="$1"
  local lane_suffix="/.localdata/pwa-release-gate/latest"
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
  local lane_suffix="/.localdata/pwa-release-gate/latest/test-results"
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
mkdir -p "$ARTIFACT_DIR"
: >"$LOG_PATH"

export STARLOG_PWA_RELEASE_GATE_ARTIFACT_DIR="$ARTIFACT_DIR"
export STARLOG_PWA_RELEASE_GATE_TEST_RESULTS_DIR="$TEST_RESULTS_DIR"

exec > >(tee "$LOG_PATH") 2>&1

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
echo "[pwa-release-gate] screenshots: $TEST_RESULTS_DIR"
