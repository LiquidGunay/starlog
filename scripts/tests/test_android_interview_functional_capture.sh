#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/android_interview_functional_capture.sh"
FIXTURE_PATH="$SCRIPT_DIR/fixtures/android-review-due-card-ui.xml"

if [[ ! -x "$SCRIPT_PATH" ]]; then
  echo "[test] missing executable: $SCRIPT_PATH" >&2
  exit 1
fi

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

assert_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if ! grep -Fq "$pattern" "$file"; then
    echo "[test] FAIL: $label" >&2
    echo "[test] expected pattern: $pattern" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if grep -Fq "$pattern" "$file"; then
    echo "[test] FAIL: $label" >&2
    echo "[test] unexpected pattern: $pattern" >&2
    exit 1
  fi
}

run_capture() {
  local label="$1"
  local script_path="$2"
  shift 2
  local out_log="$tmp_root/$label.log"
  local run_dir="$tmp_root/$label/artifacts"
  mkdir -p "$run_dir"

  (
    cd "$REPO_ROOT/.."
    STAMP="$label" \
    RUN_DIR="$run_dir" \
    STARLOG_API_BASE="https://api.example.test" \
    STARLOG_ACCESS_TOKEN="top-secret-token" \
    WAIT_SECONDS="0" \
    AUTO_REVIEW_UI_XML="${AUTO_REVIEW_UI_XML:-}" \
    "$script_path" "$@"
  ) >"$out_log" 2>&1

  echo "$out_log"
}

echo "[test] dry-run command shape"
dry_run_log="$(run_capture dry-run "$SCRIPT_PATH" --dry-run)"
assert_contains "$dry_run_log" "Launching Assistant: starlog://surface?tab=assistant" "assistant deeplink launch command"
assert_contains "$dry_run_log" "curl -fsS -H Authorization:" "api snapshot redaction header"
assert_contains "$dry_run_log" "<redacted>" "api snapshot redaction token"
assert_contains "$dry_run_log" "due-cards-after-grade.json" "due card after-grade snapshot"
assert_not_contains "$dry_run_log" "top-secret-token" "token leak in logs"

echo "[test] no-device mode"
run_capture no-device "$SCRIPT_PATH" --no-device >/dev/null
if [[ ! -f "$tmp_root/no-device/artifacts/manual-checkpoints.md" ]]; then
  echo "[test] FAIL: no-device run did not produce manual-checkpoints.md" >&2
  exit 1
fi
if [[ ! -f "$tmp_root/no-device/artifacts/run.env" ]]; then
  echo "[test] FAIL: no-device run did not produce run.env" >&2
  exit 1
fi

echo "[test] auto-review-grade dry-run mode"
AUTO_REVIEW_UI_XML="$FIXTURE_PATH"
auto_run_log="$(run_capture auto-grade "$SCRIPT_PATH" --auto-review-grade --dry-run)"
AUTO_REVIEW_UI_XML=""
assert_not_contains "$auto_run_log" "top-secret-token" "auto mode token leak"
assert_contains "$auto_run_log" "Attempting automated Review reveal + Good grade flow" "review automation attempt"
assert_contains "$auto_run_log" "Tapped Load due cards at 200 1420" "load due cards tap command"
assert_contains "$auto_run_log" "Tapped Reveal answer at 200 1520" "reveal tap command"
assert_contains "$auto_run_log" "Tapped Good grade at 200 1620" "good tap command"
assert_contains "$auto_run_log" "Automated Review reveal + Good flow completed" "automation completion"
assert_contains "$auto_run_log" "due-cards-before-grade.json" "pre-grade due-card snapshot"
assert_contains "$auto_run_log" "due-cards-after-grade.json" "post-grade due-card snapshot"
assert_not_contains "$auto_run_log" "Automation skipped" "automation was not skipped"

echo "[test] shell harness script tests passed"
