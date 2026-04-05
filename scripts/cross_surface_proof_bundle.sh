#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${1:-$(date -u +"%Y%m%dT%H%M%SZ")}"

if [[ -d "$HOME/.local/bin" ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

BUNDLE_ROOT="${CROSS_SURFACE_PROOF_ROOT:-${VALIDATION_ROOT:-$ROOT_DIR}}"
PWA_ROOT="${PWA_ROOT:-$ROOT_DIR}"
MOBILE_ROOT="${MOBILE_ROOT:-$ROOT_DIR}"
HELPER_ROOT="${HELPER_ROOT:-$ROOT_DIR}"

RUN_HOSTED_PWA_SMOKE="${STARLOG_CROSS_SURFACE_RUN_HOSTED_PWA_SMOKE:-${STARLOG_VALIDATION_RUN_PWA_HOSTED_SMOKE:-1}}"
RUN_PWA_PROOF="${STARLOG_CROSS_SURFACE_RUN_PWA_PROOF:-${STARLOG_VALIDATION_RUN_PWA_PROOF:-0}}"
RUN_DESKTOP_HELPER_SMOKE="${STARLOG_CROSS_SURFACE_RUN_DESKTOP_HELPER_SMOKE:-${STARLOG_VALIDATION_RUN_WINDOWS_HELPER_SMOKE:-1}}"
RUN_WINDOWS_PROBE="${STARLOG_CROSS_SURFACE_RUN_WINDOWS_PROBE:-${STARLOG_VALIDATION_RUN_WINDOWS_PROBE:-1}}"
RUN_DESKTOP_HELPER_SCREENSHOTS="${STARLOG_CROSS_SURFACE_RUN_DESKTOP_HELPER_SCREENSHOTS:-${STARLOG_VALIDATION_RUN_WINDOWS_SCREENSHOTS:-1}}"
RUN_PHONE_SMOKE="${STARLOG_CROSS_SURFACE_RUN_PHONE_SMOKE:-${STARLOG_VALIDATION_RUN_ANDROID_SMOKE:-0}}"
RUN_PHONE_SCREENSHOT="${STARLOG_CROSS_SURFACE_RUN_PHONE_SCREENSHOT:-${STARLOG_VALIDATION_RUN_ANDROID_SCREENSHOT:-0}}"
DRY_RUN="${STARLOG_CROSS_SURFACE_DRY_RUN:-${STARLOG_VALIDATION_DRY_RUN:-0}}"

PHONE_SHOT_NAME="${STARLOG_CROSS_SURFACE_PHONE_SCREENSHOT_NAME:-${STARLOG_VALIDATION_ANDROID_SCREENSHOT_NAME:-phone-capture.png}}"
DESKTOP_HELPER_GREP="${STARLOG_CROSS_SURFACE_DESKTOP_HELPER_GREP:-${STARLOG_VALIDATION_WINDOWS_HELPER_GREP:-quick popup can switch to workspace in browser fallback}}"
METRO_RELAY_LOG="${STARLOG_CROSS_SURFACE_METRO_RELAY_LOG:-${STARLOG_VALIDATION_METRO_RELAY_LOG:-}}"
ADB_WIN="${ADB_WIN:-/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe}"
ADB_PATH="${ADB:-}"
ADB_SERIAL_VALUE="${ADB_SERIAL:-}"

BUNDLE_DIR="$BUNDLE_ROOT/artifacts/cross-surface-proof/$STAMP"
PWA_DIR="$BUNDLE_DIR/hosted-pwa"
PHONE_DIR="$BUNDLE_DIR/phone-app"
DESKTOP_DIR="$BUNDLE_DIR/desktop-helper"
LOG_DIR="$BUNDLE_DIR/logs"
SUMMARY_JSON="$BUNDLE_DIR/run-summary.json"
SUMMARY_MD="$BUNDLE_DIR/RUN_SUMMARY.md"

declare -A STEP_STATUS
declare -A STEP_DETAIL
OVERALL_EXIT_CODE=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [timestamp]

Creates a timestamped cross-surface proof bundle and optionally runs hosted PWA, phone-app, and
desktop-helper evidence lanes into one artifact tree.

Defaults:
  - hosted PWA smoke: enabled
  - desktop helper smoke/probe/screenshots: enabled
  - PWA visual proof: disabled unless STARLOG_CROSS_SURFACE_RUN_PWA_PROOF=1
  - phone-app smoke/screenshot: disabled unless STARLOG_CROSS_SURFACE_RUN_PHONE_SMOKE=1

Useful environment variables:
  CROSS_SURFACE_PROOF_ROOT               Bundle destination root (default: repo root)
  PWA_ROOT                               Root used for hosted PWA smoke/proof commands
  MOBILE_ROOT                            Root used for phone-app smoke
  HELPER_ROOT                            Root used for helper checks
  STARLOG_CROSS_SURFACE_RUN_PWA_PROOF    1 to run cross-surface web proof
  STARLOG_CROSS_SURFACE_API_BASE         API base for PWA proof
  STARLOG_CROSS_SURFACE_TOKEN            Auth token for PWA proof
  STARLOG_CROSS_SURFACE_RUN_PHONE_SMOKE  1 to run Android phone smoke
  STARLOG_CROSS_SURFACE_RUN_PHONE_SCREENSHOT
                                         1 to capture a device screenshot after phone smoke
  STARLOG_CROSS_SURFACE_METRO_RELAY_LOG  Optional path copied into phone-app/metro-relay.txt
  STARLOG_CROSS_SURFACE_DRY_RUN          1 to print commands without running them

Example:
  STARLOG_CROSS_SURFACE_RUN_PWA_PROOF=1 \\
  STARLOG_CROSS_SURFACE_API_BASE=http://127.0.0.1:8011 \\
  STARLOG_CROSS_SURFACE_TOKEN=<token> \\
  ./scripts/cross_surface_proof_bundle.sh
EOF
}

log() {
  printf '[cross-surface-proof] %s\n' "$1"
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
  if [[ "$DRY_RUN" == "1" ]]; then
    record_step "prepare_bundle" "dry-run" "$BUNDLE_DIR"
    return 0
  fi
  local bundle_tmp
  bundle_tmp="$(mktemp)"
  "$ROOT_DIR/scripts/prepare_cross_surface_proof_bundle.sh" "$STAMP" >"$bundle_tmp"
  local bundle_path
  bundle_path="$(cat "$bundle_tmp")"
  rm -f "$bundle_tmp"
  record_step "prepare_bundle" "passed" "$bundle_path"
}

run_hosted_pwa_smoke() {
  if [[ "$RUN_HOSTED_PWA_SMOKE" != "1" ]]; then
    record_step "hosted_pwa_smoke" "skipped" "disabled"
    return 0
  fi

  log "Running hosted PWA smoke from $PWA_ROOT"
  local stdout_log="$LOG_DIR/hosted-pwa-smoke.stdout.log"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] (cd %q && bash ./scripts/pwa_hosted_smoke.sh | tee %q)\n' "$PWA_ROOT" "$stdout_log"
    record_step "hosted_pwa_smoke" "dry-run" "$stdout_log"
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
  {
    printf 'stdout_log=%s\n' "$stdout_log"
    [[ -n "$latest_log" ]] && printf 'hosted_smoke_log=%s\n' "$latest_log"
    [[ -n "$latest_api_log" ]] && printf 'api_log=%s\n' "$latest_api_log"
  } >"$PWA_DIR/hosted-smoke-summary.txt"

  record_step "hosted_pwa_smoke" "passed" "$stdout_log"
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

  log "Running hosted PWA cross-surface proof"
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

run_desktop_helper_smoke() {
  if [[ "$RUN_DESKTOP_HELPER_SMOKE" != "1" ]]; then
    record_step "desktop_helper_smoke" "skipped" "disabled"
    return 0
  fi

  log "Running desktop helper Playwright smoke"
  local stdout_log="$DESKTOP_DIR/helper-playwright.txt"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] (cd %q && ./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep %q | tee %q)\n' "$HELPER_ROOT" "$DESKTOP_HELPER_GREP" "$stdout_log"
    record_step "desktop_helper_smoke" "dry-run" "$stdout_log"
    return 0
  fi

  (
    cd "$HELPER_ROOT"
    ./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep "$DESKTOP_HELPER_GREP"
  ) | tee "$stdout_log"

  record_step "desktop_helper_smoke" "passed" "$stdout_log"
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

  log "Capturing desktop-helper Windows host probes"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %q %q\n' "$ROOT_DIR/scripts/capture_cross_surface_windows_host_probe.sh" "$STAMP"
    record_step "windows_probe" "dry-run" "$DESKTOP_DIR/windows-host-probes.txt"
    return 0
  fi

  "$ROOT_DIR/scripts/capture_cross_surface_windows_host_probe.sh" "$STAMP" >/dev/null
  record_step "windows_probe" "passed" "$DESKTOP_DIR/windows-host-probes.txt"
}

run_desktop_helper_screenshots() {
  if [[ "$RUN_DESKTOP_HELPER_SCREENSHOTS" != "1" ]]; then
    record_step "desktop_helper_screenshots" "skipped" "disabled"
    return 0
  fi

  log "Capturing desktop helper QA screenshots"
  local stdout_log="$LOG_DIR/desktop-helper-screenshots.stdout.log"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] (cd %q && node ./tools/desktop-helper/scripts/capture_qa_screenshots.mjs %q | tee %q)\n' "$HELPER_ROOT" "$DESKTOP_DIR" "$stdout_log"
    record_step "desktop_helper_screenshots" "dry-run" "$stdout_log"
    return 0
  fi

  (
    cd "$HELPER_ROOT"
    node ./tools/desktop-helper/scripts/capture_qa_screenshots.mjs "$DESKTOP_DIR"
  ) | tee "$stdout_log"

  record_step "desktop_helper_screenshots" "passed" "$stdout_log"
}

capture_phone_screenshot() {
  local screenshot_path="$PHONE_DIR/$PHONE_SHOT_NAME"
  local adb_command="$ADB_PATH"

  if [[ -z "$adb_command" ]]; then
    if [[ -f "$ADB_WIN" ]]; then
      adb_command="$ADB_WIN"
    elif [[ -f "${ANDROID_HOME:-$HOME/.local/android}/platform-tools/adb" ]]; then
      adb_command="${ANDROID_HOME:-$HOME/.local/android}/platform-tools/adb"
    fi
  fi

  if [[ -z "$adb_command" || ! -e "$adb_command" ]]; then
    record_step "phone_screenshot" "skipped" "adb not found"
    return 0
  fi

  local -a adb_prefix=("$adb_command")
  if [[ -n "$ADB_SERIAL_VALUE" ]]; then
    adb_prefix+=("-s" "$ADB_SERIAL_VALUE")
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %s exec-out screencap -p > %q\n' "${adb_prefix[*]}" "$screenshot_path"
    record_step "phone_screenshot" "dry-run" "$screenshot_path"
    return 0
  fi

  "${adb_prefix[@]}" exec-out screencap -p >"$screenshot_path"
  record_step "phone_screenshot" "passed" "$screenshot_path"
}

run_phone_smoke() {
  if [[ "$RUN_PHONE_SMOKE" != "1" ]]; then
    record_step "phone_smoke" "skipped" "disabled"
    record_step "phone_screenshot" "skipped" "disabled"
    return 0
  fi

  log "Running installed phone-app smoke"
  local stdout_log="$PHONE_DIR/android-smoke.txt"
  local adb_devices_path="$PHONE_DIR/adb-devices.txt"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] (cd %q && ./scripts/android_native_smoke.sh | tee %q)\n' "$MOBILE_ROOT" "$stdout_log"
    record_step "phone_smoke" "dry-run" "$stdout_log"
    if [[ "$RUN_PHONE_SCREENSHOT" == "1" ]]; then
      capture_phone_screenshot
    else
      record_step "phone_screenshot" "skipped" "disabled"
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
    printf 'adb path unavailable for phone-app artifact capture\n' >&2
    return 1
  fi

  (cd "$MOBILE_ROOT" && ./scripts/android_native_smoke.sh) | tee "$stdout_log"

  if [[ -n "$METRO_RELAY_LOG" && -f "$METRO_RELAY_LOG" ]]; then
    cp "$METRO_RELAY_LOG" "$PHONE_DIR/metro-relay.txt"
  fi

  record_step "phone_smoke" "passed" "$stdout_log"

  if [[ "$RUN_PHONE_SCREENSHOT" == "1" ]]; then
    capture_phone_screenshot
  else
    record_step "phone_screenshot" "skipped" "disabled"
  fi
}

write_summary() {
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "Dry run summary would be written to $SUMMARY_MD"
    return 0
  fi

  cat >"$SUMMARY_JSON" <<EOF
{
  "generated_at_utc": "$now",
  "stamp": "$STAMP",
  "bundle_dir": "${BUNDLE_DIR#$BUNDLE_ROOT/}",
  "roots": {
    "bundle_root": "$BUNDLE_ROOT",
    "pwa_root": "$PWA_ROOT",
    "mobile_root": "$MOBILE_ROOT",
    "helper_root": "$HELPER_ROOT"
  },
  "steps": {
    "prepare_bundle": {
      "status": "${STEP_STATUS[prepare_bundle]:-unknown}",
      "detail": "${STEP_DETAIL[prepare_bundle]:-}"
    },
    "hosted_pwa_smoke": {
      "status": "${STEP_STATUS[hosted_pwa_smoke]:-unknown}",
      "detail": "${STEP_DETAIL[hosted_pwa_smoke]:-}"
    },
    "pwa_visual_proof": {
      "status": "${STEP_STATUS[pwa_visual_proof]:-unknown}",
      "detail": "${STEP_DETAIL[pwa_visual_proof]:-}"
    },
    "desktop_helper_smoke": {
      "status": "${STEP_STATUS[desktop_helper_smoke]:-unknown}",
      "detail": "${STEP_DETAIL[desktop_helper_smoke]:-}"
    },
    "windows_probe": {
      "status": "${STEP_STATUS[windows_probe]:-unknown}",
      "detail": "${STEP_DETAIL[windows_probe]:-}"
    },
    "desktop_helper_screenshots": {
      "status": "${STEP_STATUS[desktop_helper_screenshots]:-unknown}",
      "detail": "${STEP_DETAIL[desktop_helper_screenshots]:-}"
    },
    "phone_smoke": {
      "status": "${STEP_STATUS[phone_smoke]:-unknown}",
      "detail": "${STEP_DETAIL[phone_smoke]:-}"
    },
    "phone_screenshot": {
      "status": "${STEP_STATUS[phone_screenshot]:-unknown}",
      "detail": "${STEP_DETAIL[phone_screenshot]:-}"
    }
  }
}
EOF

  cat >"$SUMMARY_MD" <<EOF
# Cross-Surface Proof Run Summary

Generated at: \`$now\`
Bundle: \`$BUNDLE_DIR\`

## Steps

- \`prepare_bundle\`: \`${STEP_STATUS[prepare_bundle]:-unknown}\` ${STEP_DETAIL[prepare_bundle]:+"- ${STEP_DETAIL[prepare_bundle]}"}
- \`hosted_pwa_smoke\`: \`${STEP_STATUS[hosted_pwa_smoke]:-unknown}\` ${STEP_DETAIL[hosted_pwa_smoke]:+"- ${STEP_DETAIL[hosted_pwa_smoke]}"}
- \`pwa_visual_proof\`: \`${STEP_STATUS[pwa_visual_proof]:-unknown}\` ${STEP_DETAIL[pwa_visual_proof]:+"- ${STEP_DETAIL[pwa_visual_proof]}"}
- \`desktop_helper_smoke\`: \`${STEP_STATUS[desktop_helper_smoke]:-unknown}\` ${STEP_DETAIL[desktop_helper_smoke]:+"- ${STEP_DETAIL[desktop_helper_smoke]}"}
- \`windows_probe\`: \`${STEP_STATUS[windows_probe]:-unknown}\` ${STEP_DETAIL[windows_probe]:+"- ${STEP_DETAIL[windows_probe]}"}
- \`desktop_helper_screenshots\`: \`${STEP_STATUS[desktop_helper_screenshots]:-unknown}\` ${STEP_DETAIL[desktop_helper_screenshots]:+"- ${STEP_DETAIL[desktop_helper_screenshots]}"}
- \`phone_smoke\`: \`${STEP_STATUS[phone_smoke]:-unknown}\` ${STEP_DETAIL[phone_smoke]:+"- ${STEP_DETAIL[phone_smoke]}"}
- \`phone_screenshot\`: \`${STEP_STATUS[phone_screenshot]:-unknown}\` ${STEP_DETAIL[phone_screenshot]:+"- ${STEP_DETAIL[phone_screenshot]}"}
EOF
}

main() {
  if [[ "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  prepare_bundle
  execute_step "hosted_pwa_smoke" run_hosted_pwa_smoke
  execute_step "pwa_visual_proof" run_pwa_visual_proof
  execute_step "desktop_helper_smoke" run_desktop_helper_smoke
  execute_step "windows_probe" run_windows_probe
  execute_step "desktop_helper_screenshots" run_desktop_helper_screenshots
  execute_step "phone_smoke" run_phone_smoke
  write_summary

  log "Cross-surface proof bundle ready at $BUNDLE_DIR"
  log "Run summary: $SUMMARY_MD"
  return "$OVERALL_EXIT_CODE"
}

main "$@"
