#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${1:-$(date -u +"%Y%m%dT%H%M%SZ")}"

if [[ -d "$HOME/.local/bin" ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

VALIDATION_ROOT="${VALIDATION_ROOT:-$ROOT_DIR}"
PWA_ROOT="${PWA_ROOT:-$ROOT_DIR}"
MOBILE_ROOT="${MOBILE_ROOT:-$ROOT_DIR}"
HELPER_ROOT="${HELPER_ROOT:-$ROOT_DIR}"

RUN_PWA_HOSTED_SMOKE="${STARLOG_VALIDATION_RUN_PWA_HOSTED_SMOKE:-1}"
RUN_PWA_PROOF="${STARLOG_VALIDATION_RUN_PWA_PROOF:-0}"
RUN_WINDOWS_HELPER_SMOKE="${STARLOG_VALIDATION_RUN_WINDOWS_HELPER_SMOKE:-1}"
RUN_WINDOWS_PROBE="${STARLOG_VALIDATION_RUN_WINDOWS_PROBE:-1}"
RUN_WINDOWS_SCREENSHOTS="${STARLOG_VALIDATION_RUN_WINDOWS_SCREENSHOTS:-1}"
RUN_ANDROID_SMOKE="${STARLOG_VALIDATION_RUN_ANDROID_SMOKE:-0}"
RUN_ANDROID_SCREENSHOT="${STARLOG_VALIDATION_RUN_ANDROID_SCREENSHOT:-0}"
DRY_RUN="${STARLOG_VALIDATION_DRY_RUN:-0}"

ANDROID_SHOT_NAME="${STARLOG_VALIDATION_ANDROID_SCREENSHOT_NAME:-velvet-mobile-capture.png}"
WINDOWS_HELPER_GREP="${STARLOG_VALIDATION_WINDOWS_HELPER_GREP:-quick popup can switch to workspace in browser fallback}"
METRO_RELAY_LOG="${STARLOG_VALIDATION_METRO_RELAY_LOG:-}"
ADB_WIN="${ADB_WIN:-/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe}"
ADB_PATH="${ADB:-}"
ADB_SERIAL_VALUE="${ADB_SERIAL:-}"

BUNDLE_DIR="$VALIDATION_ROOT/artifacts/velvet-validation/$STAMP"
PWA_DIR="$BUNDLE_DIR/pwa-proof"
ANDROID_DIR="$BUNDLE_DIR/android-phone"
WINDOWS_DIR="$BUNDLE_DIR/windows-helper"
LOG_DIR="$BUNDLE_DIR/logs"
SUMMARY_JSON="$BUNDLE_DIR/run-summary.json"
SUMMARY_MD="$BUNDLE_DIR/RUN_SUMMARY.md"

declare -A STEP_STATUS
declare -A STEP_DETAIL
OVERALL_EXIT_CODE=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [timestamp]

Creates a timestamped validation bundle and optionally runs the Velvet validation checks.

Defaults:
  - PWA hosted smoke: enabled
  - Windows helper smoke/probe/screenshots: enabled
  - PWA visual proof: disabled unless STARLOG_VALIDATION_RUN_PWA_PROOF=1
  - Android smoke/screenshot: disabled unless STARLOG_VALIDATION_RUN_ANDROID_SMOKE=1

Useful environment variables:
  VALIDATION_ROOT                         Bundle destination root (default: repo root)
  PWA_ROOT                               Root used for PWA smoke/proof commands
  MOBILE_ROOT                            Root used for Android smoke
  HELPER_ROOT                            Root used for helper checks
  STARLOG_VALIDATION_RUN_PWA_PROOF       1 to run cross-surface web proof
  STARLOG_CROSS_SURFACE_API_BASE         API base for cross-surface proof
  STARLOG_CROSS_SURFACE_TOKEN            Auth token for cross-surface proof
  STARLOG_VALIDATION_RUN_ANDROID_SMOKE   1 to run Android smoke
  STARLOG_VALIDATION_RUN_ANDROID_SCREENSHOT
                                         1 to capture a device screenshot after Android smoke
  STARLOG_VALIDATION_METRO_RELAY_LOG     Optional path copied into android-phone/metro-relay.txt
  STARLOG_VALIDATION_DRY_RUN             1 to print commands without running them

Example:
  STARLOG_VALIDATION_RUN_PWA_PROOF=1 \\
  STARLOG_CROSS_SURFACE_API_BASE=http://127.0.0.1:8011 \\
  STARLOG_CROSS_SURFACE_TOKEN=<token> \\
  ./scripts/velvet_validation_artifacts.sh
EOF
}

log() {
  printf '[velvet-validation] %s\n' "$1"
}

run_or_echo() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

record_step() {
  local step="$1"
  local status="$2"
  local detail="$3"
  STEP_STATUS["$step"]="$status"
  STEP_DETAIL["$step"]="$detail"
}

latest_file() {
  local pattern="$1"
  local root="$2"
  find "$root" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -n1 \
    | cut -d' ' -f2-
}

execute_step() {
  local step="$1"
  shift

  set +e
  "$@"
  local exit_code=$?
  set -e

  if [[ "$exit_code" -ne 0 ]]; then
    OVERALL_EXIT_CODE=1
    local detail="${STEP_DETAIL[$step]:-command failed with exit code $exit_code}"
    record_step "$step" "failed" "$detail"
    log "Step $step failed with exit code $exit_code"
  fi

  return 0
}

prepare_bundle() {
  log "Preparing bundle at $BUNDLE_DIR"
  local bundle_tmp
  bundle_tmp="$(mktemp)"
  run_or_echo "$VALIDATION_ROOT/scripts/prepare_velvet_validation_bundle.sh" "$STAMP" >"$bundle_tmp"
  if [[ "$DRY_RUN" == "1" ]]; then
    record_step "prepare_bundle" "dry-run" "$BUNDLE_DIR"
    rm -f "$bundle_tmp"
    return 0
  fi
  local bundle_path
  bundle_path="$(cat "$bundle_tmp")"
  rm -f "$bundle_tmp"
  record_step "prepare_bundle" "passed" "$bundle_path"
}

run_pwa_hosted_smoke() {
  if [[ "$RUN_PWA_HOSTED_SMOKE" != "1" ]]; then
    record_step "pwa_hosted_smoke" "skipped" "disabled"
    return 0
  fi

  log "Running PWA hosted smoke from $PWA_ROOT"
  local stdout_log="$LOG_DIR/pwa-hosted-smoke.stdout.log"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] (cd %q && bash ./scripts/pwa_hosted_smoke.sh | tee %q)\n' "$PWA_ROOT" "$stdout_log"
    record_step "pwa_hosted_smoke" "dry-run" "$stdout_log"
    return 0
  fi

  (cd "$PWA_ROOT" && bash ./scripts/pwa_hosted_smoke.sh) | tee "$stdout_log"

  local smoke_dir="$PWA_ROOT/artifacts/pwa-hosted-smoke"
  local latest_log
  local latest_api_log
  latest_log="$(latest_file 'hosted-smoke-*.log' "$smoke_dir")"
  latest_api_log="$(latest_file 'api-*.log' "$smoke_dir")"

  [[ -n "$latest_log" ]] && cp "$latest_log" "$LOG_DIR/"
  [[ -n "$latest_api_log" ]] && cp "$latest_api_log" "$LOG_DIR/"
  if [[ -d "$smoke_dir/test-results" ]]; then
    rm -rf "$PWA_DIR/test-results"
    cp -R "$smoke_dir/test-results" "$PWA_DIR/test-results"
  fi

  record_step "pwa_hosted_smoke" "passed" "$stdout_log"
}

run_pwa_visual_proof() {
  if [[ "$RUN_PWA_PROOF" != "1" ]]; then
    record_step "pwa_visual_proof" "skipped" "disabled"
    return 0
  fi

  if [[ -z "${STARLOG_CROSS_SURFACE_TOKEN:-}" ]]; then
    record_step "pwa_visual_proof" "skipped" "STARLOG_CROSS_SURFACE_TOKEN is unset"
    return 0
  fi

  log "Running PWA cross-surface proof"
  local stdout_log="$LOG_DIR/pwa-cross-surface-proof.stdout.log"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] (cd %q && node scripts/cross_surface_web_proof.mjs %q | tee %q)\n' "$PWA_ROOT" "$PWA_DIR" "$stdout_log"
    record_step "pwa_visual_proof" "dry-run" "$stdout_log"
    return 0
  fi

  (
    cd "$PWA_ROOT"
    node scripts/cross_surface_web_proof.mjs "$PWA_DIR"
  ) | tee "$stdout_log"

  record_step "pwa_visual_proof" "passed" "$stdout_log"
}

run_windows_helper_smoke() {
  if [[ "$RUN_WINDOWS_HELPER_SMOKE" != "1" ]]; then
    record_step "windows_helper_smoke" "skipped" "disabled"
    return 0
  fi

  log "Running Windows helper Playwright smoke"
  local stdout_log="$WINDOWS_DIR/helper-playwright.txt"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] (cd %q && ./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep %q | tee %q)\n' "$HELPER_ROOT" "$WINDOWS_HELPER_GREP" "$stdout_log"
    record_step "windows_helper_smoke" "dry-run" "$stdout_log"
    return 0
  fi

  (
    cd "$HELPER_ROOT"
    ./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep "$WINDOWS_HELPER_GREP"
  ) | tee "$stdout_log"

  record_step "windows_helper_smoke" "passed" "$stdout_log"
}

run_windows_probe() {
  if [[ "$RUN_WINDOWS_PROBE" != "1" ]]; then
    record_step "windows_probe" "skipped" "disabled"
    return 0
  fi

  if ! command -v powershell.exe >/dev/null 2>&1; then
    record_step "windows_probe" "skipped" "powershell.exe unavailable"
    return 0
  fi

  if [[ ! -x "$ADB_WIN" && ! -f "$ADB_WIN" ]]; then
    record_step "windows_probe" "skipped" "ADB_WIN not found at $ADB_WIN"
    return 0
  fi

  log "Capturing Windows host probes"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %q %q\n' "$VALIDATION_ROOT/scripts/capture_velvet_windows_host_probe.sh" "$STAMP"
    record_step "windows_probe" "dry-run" "$WINDOWS_DIR/windows-host-probes.txt"
    return 0
  fi

  "$VALIDATION_ROOT/scripts/capture_velvet_windows_host_probe.sh" "$STAMP" >/dev/null
  record_step "windows_probe" "passed" "$WINDOWS_DIR/windows-host-probes.txt"
}

run_windows_screenshots() {
  if [[ "$RUN_WINDOWS_SCREENSHOTS" != "1" ]]; then
    record_step "windows_screenshots" "skipped" "disabled"
    return 0
  fi

  log "Capturing helper QA screenshots"
  local stdout_log="$LOG_DIR/windows-helper-screenshots.stdout.log"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] (cd %q && node ./tools/desktop-helper/scripts/capture_qa_screenshots.mjs %q | tee %q)\n' "$HELPER_ROOT" "$WINDOWS_DIR" "$stdout_log"
    record_step "windows_screenshots" "dry-run" "$stdout_log"
    return 0
  fi

  (
    cd "$HELPER_ROOT"
    node ./tools/desktop-helper/scripts/capture_qa_screenshots.mjs "$WINDOWS_DIR"
  ) | tee "$stdout_log"

  record_step "windows_screenshots" "passed" "$stdout_log"
}

capture_android_screenshot() {
  local screenshot_path="$ANDROID_DIR/$ANDROID_SHOT_NAME"
  local adb_command="$ADB_PATH"

  if [[ -z "$adb_command" ]]; then
    if [[ -f "$ADB_WIN" ]]; then
      adb_command="$ADB_WIN"
    elif [[ -f "${ANDROID_HOME:-$HOME/.local/android}/platform-tools/adb" ]]; then
      adb_command="${ANDROID_HOME:-$HOME/.local/android}/platform-tools/adb"
    fi
  fi

  if [[ -z "$adb_command" || ! -e "$adb_command" ]]; then
    record_step "android_screenshot" "skipped" "adb not found"
    return 0
  fi

  local -a adb_prefix=("$adb_command")
  if [[ -n "$ADB_SERIAL_VALUE" ]]; then
    adb_prefix+=("-s" "$ADB_SERIAL_VALUE")
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %s exec-out screencap -p > %q\n' "${adb_prefix[*]}" "$screenshot_path"
    record_step "android_screenshot" "dry-run" "$screenshot_path"
    return 0
  fi

  "${adb_prefix[@]}" exec-out screencap -p >"$screenshot_path"
  record_step "android_screenshot" "passed" "$screenshot_path"
}

run_android_smoke() {
  if [[ "$RUN_ANDROID_SMOKE" != "1" ]]; then
    record_step "android_smoke" "skipped" "disabled"
    record_step "android_screenshot" "skipped" "disabled"
    return 0
  fi

  log "Running Android smoke"
  local stdout_log="$ANDROID_DIR/android-smoke.txt"
  local adb_devices_path="$ANDROID_DIR/adb-devices.txt"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] (cd %q && ./scripts/android_native_smoke.sh | tee %q)\n' "$MOBILE_ROOT" "$stdout_log"
    record_step "android_smoke" "dry-run" "$stdout_log"
    if [[ "$RUN_ANDROID_SCREENSHOT" == "1" ]]; then
      capture_android_screenshot
    else
      record_step "android_screenshot" "skipped" "disabled"
    fi
    return 0
  fi

  if [[ -n "$ADB_PATH" && -e "$ADB_PATH" ]]; then
    if [[ -n "$ADB_SERIAL_VALUE" ]]; then
      "$ADB_PATH" -s "$ADB_SERIAL_VALUE" devices -l >"$adb_devices_path"
    else
      "$ADB_PATH" devices -l >"$adb_devices_path"
    fi
  elif [[ -f "$ADB_WIN" ]]; then
    "$ADB_WIN" devices -l >"$adb_devices_path"
  else
    printf 'adb path unavailable for Android artifact capture\n' >&2
    return 1
  fi

  (cd "$MOBILE_ROOT" && ./scripts/android_native_smoke.sh) | tee "$stdout_log"

  if [[ -n "$METRO_RELAY_LOG" && -f "$METRO_RELAY_LOG" ]]; then
    cp "$METRO_RELAY_LOG" "$ANDROID_DIR/metro-relay.txt"
  fi

  record_step "android_smoke" "passed" "$stdout_log"

  if [[ "$RUN_ANDROID_SCREENSHOT" == "1" ]]; then
    capture_android_screenshot
  else
    record_step "android_screenshot" "skipped" "disabled"
  fi
}

write_summary() {
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  cat >"$SUMMARY_JSON" <<EOF
{
  "generated_at_utc": "$now",
  "stamp": "$STAMP",
  "bundle_dir": "${BUNDLE_DIR#$VALIDATION_ROOT/}",
  "roots": {
    "validation_root": "$VALIDATION_ROOT",
    "pwa_root": "$PWA_ROOT",
    "mobile_root": "$MOBILE_ROOT",
    "helper_root": "$HELPER_ROOT"
  },
  "steps": {
    "prepare_bundle": {
      "status": "${STEP_STATUS[prepare_bundle]:-unknown}",
      "detail": "${STEP_DETAIL[prepare_bundle]:-}"
    },
    "pwa_hosted_smoke": {
      "status": "${STEP_STATUS[pwa_hosted_smoke]:-unknown}",
      "detail": "${STEP_DETAIL[pwa_hosted_smoke]:-}"
    },
    "pwa_visual_proof": {
      "status": "${STEP_STATUS[pwa_visual_proof]:-unknown}",
      "detail": "${STEP_DETAIL[pwa_visual_proof]:-}"
    },
    "windows_helper_smoke": {
      "status": "${STEP_STATUS[windows_helper_smoke]:-unknown}",
      "detail": "${STEP_DETAIL[windows_helper_smoke]:-}"
    },
    "windows_probe": {
      "status": "${STEP_STATUS[windows_probe]:-unknown}",
      "detail": "${STEP_DETAIL[windows_probe]:-}"
    },
    "windows_screenshots": {
      "status": "${STEP_STATUS[windows_screenshots]:-unknown}",
      "detail": "${STEP_DETAIL[windows_screenshots]:-}"
    },
    "android_smoke": {
      "status": "${STEP_STATUS[android_smoke]:-unknown}",
      "detail": "${STEP_DETAIL[android_smoke]:-}"
    },
    "android_screenshot": {
      "status": "${STEP_STATUS[android_screenshot]:-unknown}",
      "detail": "${STEP_DETAIL[android_screenshot]:-}"
    }
  }
}
EOF

  cat >"$SUMMARY_MD" <<EOF
# Velvet Validation Run Summary

Generated at: \`$now\`
Bundle: \`$BUNDLE_DIR\`

## Steps

- \`prepare_bundle\`: \`${STEP_STATUS[prepare_bundle]:-unknown}\` ${STEP_DETAIL[prepare_bundle]:+"- ${STEP_DETAIL[prepare_bundle]}"}
- \`pwa_hosted_smoke\`: \`${STEP_STATUS[pwa_hosted_smoke]:-unknown}\` ${STEP_DETAIL[pwa_hosted_smoke]:+"- ${STEP_DETAIL[pwa_hosted_smoke]}"}
- \`pwa_visual_proof\`: \`${STEP_STATUS[pwa_visual_proof]:-unknown}\` ${STEP_DETAIL[pwa_visual_proof]:+"- ${STEP_DETAIL[pwa_visual_proof]}"}
- \`windows_helper_smoke\`: \`${STEP_STATUS[windows_helper_smoke]:-unknown}\` ${STEP_DETAIL[windows_helper_smoke]:+"- ${STEP_DETAIL[windows_helper_smoke]}"}
- \`windows_probe\`: \`${STEP_STATUS[windows_probe]:-unknown}\` ${STEP_DETAIL[windows_probe]:+"- ${STEP_DETAIL[windows_probe]}"}
- \`windows_screenshots\`: \`${STEP_STATUS[windows_screenshots]:-unknown}\` ${STEP_DETAIL[windows_screenshots]:+"- ${STEP_DETAIL[windows_screenshots]}"}
- \`android_smoke\`: \`${STEP_STATUS[android_smoke]:-unknown}\` ${STEP_DETAIL[android_smoke]:+"- ${STEP_DETAIL[android_smoke]}"}
- \`android_screenshot\`: \`${STEP_STATUS[android_screenshot]:-unknown}\` ${STEP_DETAIL[android_screenshot]:+"- ${STEP_DETAIL[android_screenshot]}"}
EOF
}

main() {
  if [[ "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  prepare_bundle
  execute_step "pwa_hosted_smoke" run_pwa_hosted_smoke
  execute_step "pwa_visual_proof" run_pwa_visual_proof
  execute_step "windows_helper_smoke" run_windows_helper_smoke
  execute_step "windows_probe" run_windows_probe
  execute_step "windows_screenshots" run_windows_screenshots
  execute_step "android_smoke" run_android_smoke
  write_summary

  log "Validation bundle ready at $BUNDLE_DIR"
  log "Run summary: $SUMMARY_MD"
  return "$OVERALL_EXIT_CODE"
}

main "$@"
