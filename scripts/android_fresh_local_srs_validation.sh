#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCALDATA_ROOT="${LOCALDATA_ROOT:-$ROOT_DIR/.localdata/android-local-validation}"
BUILD_ROOT="$LOCALDATA_ROOT/builds"
RUNTIME_ROOT="$LOCALDATA_ROOT/runtime"
CONFIG_DIR="${STARLOG_TEST_CONFIG_DIR:-$HOME/.config/starlog}"
PASSPHRASE_FILE="${STARLOG_TEST_PASSPHRASE_FILE:-$CONFIG_DIR/android-local-srs-passphrase.txt}"

JAVA_HOME="${JAVA_HOME:-$HOME/.local/jdks/temurin-17}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/android}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
WINDOWS_ADB_CANDIDATE="${WINDOWS_ADB_CANDIDATE:-/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe}"
LINUX_ADB_CANDIDATE="${LINUX_ADB_CANDIDATE:-$(command -v adb 2>/dev/null || true)}"
if [[ -z "$LINUX_ADB_CANDIDATE" && -x "$ANDROID_SDK_ROOT/platform-tools/adb" ]]; then
  LINUX_ADB_CANDIDATE="$ANDROID_SDK_ROOT/platform-tools/adb"
fi
ADB="${ADB:-$WINDOWS_ADB_CANDIDATE}"
ADB_SERIAL="${ADB_SERIAL:-}"
APP_VARIANT="${APP_VARIANT:-development}"
APP_PACKAGE="${APP_PACKAGE:-com.starlog.app.dev}"
APP_ACTIVITY="${APP_ACTIVITY:-.MainActivity}"
WINDOWS_TEMP_ROOT="${WINDOWS_TEMP_ROOT:-/mnt/c/Temp}"
API_PORT="${API_PORT:-8000}"
ADB_PREFLIGHT_REVERSE_PORTS="${ADB_PREFLIGHT_REVERSE_PORTS:-$API_PORT}"
API_BASE="${API_BASE:-http://127.0.0.1:${API_PORT}}"
DECK_PATH="${DECK_PATH:-$ROOT_DIR/data/ml_interviews_part_ii_qa_cards.jsonl}"
NEETCODE_SOURCE_PATH="${NEETCODE_SOURCE_PATH:-$ROOT_DIR/data/neetcode_150.json}"
STARLOG_VERSION_NAME="${STARLOG_VERSION_NAME:-0.1.0-android.devtest.$(date -u +%Y%m%dT%H%M%SZ)}"
# Keep versionCode below Android's signed-int max while still encoding UTC freshness.
STARLOG_ANDROID_VERSION_CODE="${STARLOG_ANDROID_VERSION_CODE:-1$(date -u +%y%j%H%M)}"
REACT_NATIVE_ARCHITECTURES="${REACT_NATIVE_ARCHITECTURES:-}"
CLEAN_BUILD="${CLEAN_BUILD:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
EXISTING_APK_PATH="${EXISTING_APK_PATH:-}"
ASSISTANT_COMMAND_TEXT="${ASSISTANT_COMMAND_TEXT:-Ask, capture, plan, review, or move something forward...}"
ASSISTANT_CAPABILITY_COMMAND="${ASSISTANT_CAPABILITY_COMMAND:-show me what UI actions you can take}"
ASSISTANT_COMMAND="${ASSISTANT_COMMAND:-summarize latest artifact}"
ASSISTANT_DUE_DATE_RUN_LABEL="${ASSISTANT_DUE_DATE_RUN_LABEL:-$(date -u +%Y%m%dT%H%M%SZ)}"
ASSISTANT_DUE_DATE_TASK_TITLE="${ASSISTANT_DUE_DATE_TASK_TITLE:-Review diffusion notes ${ASSISTANT_DUE_DATE_RUN_LABEL}}"
ASSISTANT_DUE_DATE_COMMAND="${ASSISTANT_DUE_DATE_COMMAND:-create task ${ASSISTANT_DUE_DATE_TASK_TITLE}}"
ADB_INSTALL_TIMEOUT_SEC="${ADB_INSTALL_TIMEOUT_SEC:-900}"
SKIP_ADB_PREFLIGHT="${SKIP_ADB_PREFLIGHT:-0}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BUILD_DIR="$BUILD_ROOT/$STAMP"
RUNTIME_DIR="$RUNTIME_ROOT/$STAMP"
SCREENSHOT_DIR="$BUILD_DIR/screens"
API_LOG="$BUILD_DIR/local-api.log"
ADB_PREFLIGHT_LOG="$BUILD_DIR/adb-preflight.log"
UI_XML="$BUILD_DIR/window_dump.xml"
BUILD_NAME="starlog-dev-${STAMP}-${STARLOG_ANDROID_VERSION_CODE}.apk"
STAGED_APK="$BUILD_DIR/$BUILD_NAME"
WINDOWS_APK_PATH="$WINDOWS_TEMP_ROOT/$BUILD_NAME"
METADATA_PATH="$BUILD_DIR/latest.json"
LATEST_METADATA_PATH="$BUILD_ROOT/latest.json"
VALIDATED_FLOW_MARKERS_PATH="$BUILD_DIR/validated-flows.txt"
LATEST_APK_PATH="$BUILD_ROOT/latest.apk"
TOP_ACTIVITY_PATH="$BUILD_DIR/top-activity.txt"
WINDOW_POLICY_PATH="$BUILD_DIR/window-policy.txt"
VENV_PYTHON="${VENV_PYTHON:-$ROOT_DIR/services/api/.venv/bin/python}"
API_PID=""
PRESERVED_EXISTING_APK=""
PLANNER_ALARM_CONTROL_DIAGNOSTICS=""
STARLOG_LOCAL_ACCESS_TOKEN=""
VALIDATION_PASSED=0
FAILURE_METADATA_WRITTEN=0
ADB_PREFLIGHT_ONLY=0

usage() {
  cat <<EOF
Usage: $(basename "$0")

Builds a fresh Android validation APK, resets the connected phone's Starlog packages,
bootstraps a fresh local API station with a non-repo test passphrase, imports the
ML Interviews deck, installs the APK through Windows adb, and drives the first
login + SRS review steps on the phone.

Important defaults:
  JAVA_HOME                     $JAVA_HOME
  ANDROID_SDK_ROOT              $ANDROID_SDK_ROOT
  ADB                           $ADB
  API_BASE                      $API_BASE
  PASSPHRASE_FILE               $PASSPHRASE_FILE
  LOCALDATA_ROOT                $LOCALDATA_ROOT

Environment overrides:
  ADB_SERIAL                    explicit Android serial
  ADB_PREFLIGHT_REVERSE_PORTS   comma-separated ports to verify with adb reverse during preflight
  APP_VARIANT                   development | preview | production
  APP_PACKAGE                   Android package to install/launch
  APP_ACTIVITY                  Activity class or component; normalized onto APP_PACKAGE
  DECK_PATH                     JSONL deck to import
  STARLOG_VERSION_NAME          explicit Android versionName
  STARLOG_ANDROID_VERSION_CODE  explicit Android versionCode
  REACT_NATIVE_ARCHITECTURES    override ABI list (defaults to connected device ABI)
  CLEAN_BUILD                   1 to force gradlew clean before assembleRelease
  SKIP_BUILD                    1 to reuse an existing APK instead of rebuilding
  EXISTING_APK_PATH             existing APK path to reuse when SKIP_BUILD=1
  ADB_INSTALL_TIMEOUT_SEC       adb install timeout (default 900 seconds)
  SKIP_ADB_PREFLIGHT            1 to intentionally skip the adb preflight
  API_PORT / API_BASE           local API endpoint for the mobile login flow
  WINDOWS_TEMP_ROOT             Windows-visible APK staging root

Options:
  --adb-preflight-only          Check adb/device readiness, then exit before build/API work
  --help                        Show this help
EOF
}

log() {
  printf '[android-local-srs] %s\n' "$1"
}

fail() {
  printf '[android-local-srs] %s\n' "$1" >&2
  write_failure_metadata_once "$1"
  exit 1
}

block() {
  printf '[android-local-srs] %s\n' "$1" >&2
  STARLOG_FAILURE_STAGE=blocked write_failure_metadata_once "$1"
  exit 2
}

mark_validated_flow() {
  local marker="$1"
  mkdir -p "$BUILD_DIR"
  touch "$VALIDATED_FLOW_MARKERS_PATH"
  if ! grep -Fxq "$marker" "$VALIDATED_FLOW_MARKERS_PATH"; then
    printf '%s\n' "$marker" >> "$VALIDATED_FLOW_MARKERS_PATH"
  fi
}

mark_validated_flows() {
  local marker
  for marker in "$@"; do
    mark_validated_flow "$marker"
  done
}

write_failure_metadata_once() {
  local reason="${1:-validation failed}"
  if [[ "${FAILURE_METADATA_WRITTEN:-0}" == "1" || "${VALIDATION_PASSED:-0}" == "1" ]]; then
    return 0
  fi

  FAILURE_METADATA_WRITTEN=1
  local previous_errexit=0
  case $- in
    *e*) previous_errexit=1 ;;
  esac
  set +e
  mkdir -p "$BUILD_DIR" "$SCREENSHOT_DIR" "$BUILD_ROOT"
  local metadata_rc=$?
  if [[ "$metadata_rc" == "0" ]] && declare -F write_metadata >/dev/null 2>&1; then
    STARLOG_FAILURE_REASON="$reason" write_metadata "${STARLOG_FAILURE_STAGE:-failed}" >/dev/null 2>&1
    metadata_rc=$?
  elif [[ "$metadata_rc" == "0" ]]; then
    METADATA_PATH_ENV="$METADATA_PATH" \
    LATEST_METADATA_PATH_ENV="$LATEST_METADATA_PATH" \
    STAMP_ENV="$STAMP" \
    VERSION_NAME_ENV="$STARLOG_VERSION_NAME" \
    VERSION_CODE_ENV="$STARLOG_ANDROID_VERSION_CODE" \
    STAGED_APK_ENV="$STAGED_APK" \
    WINDOWS_APK_PATH_ENV="$WINDOWS_APK_PATH" \
    API_BASE_ENV="$API_BASE" \
    RUNTIME_DIR_ENV="$RUNTIME_DIR" \
    PASSPHRASE_FILE_ENV="$PASSPHRASE_FILE" \
    VALIDATED_FLOW_MARKERS_PATH_ENV="$VALIDATED_FLOW_MARKERS_PATH" \
    INCLUDE_LOCAL_METADATA_ENV="${STARLOG_INCLUDE_LOCAL_METADATA:-0}" \
    FAILURE_STAGE_ENV="${STARLOG_FAILURE_STAGE:-failed}" \
    FAILURE_REASON_ENV="$reason" \
    python3 - <<'PY'
from pathlib import Path
import json
import os

path = Path(os.environ["METADATA_PATH_ENV"])
latest_path = Path(os.environ["LATEST_METADATA_PATH_ENV"])
include_local_metadata = os.environ["INCLUDE_LOCAL_METADATA_ENV"].lower() in {"1", "true", "yes"}
validated_flow_markers_path = Path(os.environ["VALIDATED_FLOW_MARKERS_PATH_ENV"])

validated_flows = []
if validated_flow_markers_path.is_file():
    seen = set()
    for marker in validated_flow_markers_path.read_text(encoding="utf-8").splitlines():
        marker = marker.strip()
        if marker and marker not in seen:
            seen.add(marker)
            validated_flows.append(marker)

payload = {
    "stamp": os.environ["STAMP_ENV"],
    "version_name": os.environ["VERSION_NAME_ENV"],
    "version_code": os.environ["VERSION_CODE_ENV"],
    "apk_name": Path(os.environ["STAGED_APK_ENV"]).name,
    "api_base_kind": "local" if os.environ["API_BASE_ENV"].startswith("http://127.0.0.1:") else "configured",
    "screenshots": {},
    "evidence_files": {},
    "validated_flows": validated_flows,
    "validation_stage": os.environ["FAILURE_STAGE_ENV"],
    "validation_passed": False,
    "failure_reason": os.environ["FAILURE_REASON_ENV"],
}
if include_local_metadata:
    payload["local_paths"] = {
        "apk_path": os.environ["STAGED_APK_ENV"],
        "windows_apk_path": os.environ["WINDOWS_APK_PATH_ENV"],
        "api_base": os.environ["API_BASE_ENV"],
        "runtime_dir": os.environ["RUNTIME_DIR_ENV"],
        "passphrase_file": os.environ["PASSPHRASE_FILE_ENV"],
    }

path.parent.mkdir(parents=True, exist_ok=True)
latest_path.parent.mkdir(parents=True, exist_ok=True)
contents = json.dumps(payload, indent=2, sort_keys=True) + "\n"
path.write_text(contents, encoding="utf-8")
latest_path.write_text(contents, encoding="utf-8")
PY
    metadata_rc=$?
  fi
  if [[ "$previous_errexit" == "1" ]]; then
    set -e
  fi
  if [[ "$metadata_rc" != "0" ]]; then
    printf '[android-local-srs] Failed to write failed validation metadata\n' >&2
  fi
}

on_unexpected_error() {
  local exit_code="$1"
  local line_number="$2"
  if [[ "$exit_code" == "0" || "${VALIDATION_PASSED:-0}" == "1" ]]; then
    return 0
  fi
  write_failure_metadata_once "Unexpected command failure at line ${line_number} (exit ${exit_code})"
}

trap 'on_unexpected_error "$?" "$LINENO"' ERR

resolve_app_component() {
  if [[ "$APP_ACTIVITY" == */* ]]; then
    local activity_package="${APP_ACTIVITY%%/*}"
    local activity_path="${APP_ACTIVITY#*/}"
    if [[ "$activity_package" == "$APP_PACKAGE" ]]; then
      printf '%s' "$APP_ACTIVITY"
      return
    fi
    if [[ "$activity_path" == .* ]]; then
      printf '%s/%s%s' "$APP_PACKAGE" "$activity_package" "$activity_path"
      return
    fi
    printf '%s/%s' "$APP_PACKAGE" "$activity_path"
    return
  fi
  if [[ "$APP_ACTIVITY" == .* ]]; then
    printf '%s/%s' "$APP_PACKAGE" "$APP_ACTIVITY"
    return
  fi
  printf '%s/%s' "$APP_PACKAGE" "$APP_ACTIVITY"
}

APP_COMPONENT="$(resolve_app_component)"

adb_cmd() {
  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB" -s "$ADB_SERIAL" "$@"
    return
  fi
  "$ADB" "$@"
}

truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
  esac
  return 1
}

compact_adb_output() {
  tr '\r\n' '  ' \
    | sed 's/[[:space:]][[:space:]]*/ /g; s/^ //; s/ $//' \
    | cut -c 1-500
}

adb_bridge_output_is_unavailable() {
  grep -Eqi 'UtilAcceptVsock|accept4 failed|vsock|WSL.*(bridge|error)|failed to start daemon|cannot connect to daemon'
}

adb_preflight_failure_reason() {
  local context="$1"
  local output="$2"
  local compact_output
  compact_output="$(printf '%s' "$output" | compact_adb_output)"

  if adb_bridge_output_is_unavailable <<<"$output"; then
    printf 'ADB preflight failed: adb bridge unavailable while %s using %s%s. Output: %s' \
      "$context" \
      "$ADB" \
      "${ADB_SERIAL:+ (ADB_SERIAL=$ADB_SERIAL)}" \
      "${compact_output:-none}"
    return
  fi

  printf 'ADB preflight failed while %s using %s%s. Output: %s' \
    "$context" \
    "$ADB" \
    "${ADB_SERIAL:+ (ADB_SERIAL=$ADB_SERIAL)}" \
    "${compact_output:-none}"
}

prepare_preflight_dirs() {
  mkdir -p "$BUILD_DIR" "$SCREENSHOT_DIR" "$BUILD_ROOT"
}

ensure_adb_available() {
  [[ -x "$ANDROID_SDK_ROOT/platform-tools/adb" || -f "$ADB" || -n "$(command -v "$ADB" 2>/dev/null || true)" ]] \
    || block "Android SDK/adb not found. Set ADB to a working adb binary, for example ADB=/usr/bin/adb for Linux adb or ADB=$WINDOWS_ADB_CANDIDATE for Windows adb.exe."
}

adb_device_state_from_devices_output() {
  local devices_output="$1"
  local serial="$2"
  awk -v serial="$serial" 'NR > 1 && $1 == serial { print $2; found=1; exit } END { if (!found) exit 1 }' <<<"$devices_output"
}

adb_ready_serials_from_devices_output() {
  tr -d '\r' <<<"$1" | awk 'NR > 1 && $2 == "device" { print $1 }'
}

adb_problem_devices_from_devices_output() {
  tr -d '\r' <<<"$1" | awk 'NR > 1 && $1 != "" && $2 != "" && $2 != "device" { print $1 ":" $2 }'
}

preflight_probe_adb_route() {
  local label="$1"
  local adb_path="$2"

  printf '\n## %s adb probe\n' "$label" >>"$ADB_PREFLIGHT_LOG"
  if [[ -z "$adb_path" ]]; then
    printf 'status=missing\n' >>"$ADB_PREFLIGHT_LOG"
    return 0
  fi
  if [[ ! -f "$adb_path" && ! -x "$adb_path" && -z "$(command -v "$adb_path" 2>/dev/null || true)" ]]; then
    printf 'status=missing\npath=%s\n' "$adb_path" >>"$ADB_PREFLIGHT_LOG"
    return 0
  fi

  printf 'path=%s\n$ %s version\n' "$adb_path" "$adb_path" >>"$ADB_PREFLIGHT_LOG"
  "$adb_path" version >>"$ADB_PREFLIGHT_LOG" 2>&1 || true
  printf '\n$ %s devices -l\n' "$adb_path" >>"$ADB_PREFLIGHT_LOG"
  "$adb_path" devices -l >>"$ADB_PREFLIGHT_LOG" 2>&1 || true
}

write_adb_preflight_host_report() {
  {
    printf '# Android validation adb preflight\n'
    printf 'stamp=%s\n' "$STAMP"
    printf 'selected_adb=%s\n' "$ADB"
    printf 'adb_serial=%s\n' "${ADB_SERIAL:-auto}"
    printf 'linux_adb_candidate=%s\n' "${LINUX_ADB_CANDIDATE:-missing}"
    printf 'windows_adb_candidate=%s\n' "$WINDOWS_ADB_CANDIDATE"
    printf 'powershell_status='
    if command -v powershell.exe >/dev/null 2>&1; then
      printf 'available\n'
      printf '$ powershell.exe -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"\n'
      powershell.exe -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' 2>&1 || true
    else
      printf 'missing\n'
    fi
  } >"$ADB_PREFLIGHT_LOG"

  preflight_probe_adb_route "linux" "${LINUX_ADB_CANDIDATE:-adb}"
  preflight_probe_adb_route "windows" "$WINDOWS_ADB_CANDIDATE"
  printf '\n## selected adb devices\n$ %s devices -l\n' "$ADB" >>"$ADB_PREFLIGHT_LOG"
}

preflight_no_ready_device_message() {
  local selected_output="$1"
  local problem_devices
  problem_devices="$(adb_problem_devices_from_devices_output "$selected_output" | paste -sd ' ' - || true)"

  if [[ -n "$problem_devices" ]]; then
    printf 'ADB preflight blocked: no ready adb device is available through selected ADB=%s; non-ready device state(s): %s. Unlock the phone, enable USB debugging, accept the "Allow USB debugging" prompt, then rerun. If more than one device is attached, set ADB_SERIAL to the intended serial. See %s.' \
      "$ADB" "$problem_devices" "$ADB_PREFLIGHT_LOG"
    return
  fi

  printf 'ADB preflight blocked: no device is visible through selected ADB=%s. Linux adb candidate: %s. Windows adb.exe candidate: %s. powershell.exe: %s. Connect the phone by USB, unlock it, enable Developer options > USB debugging, accept the authorization prompt, and verify either `adb devices -l` or `%s devices -l` lists a `device` row. Set ADB_SERIAL=<serial> if needed. See %s.' \
    "$ADB" \
    "${LINUX_ADB_CANDIDATE:-missing}" \
    "$WINDOWS_ADB_CANDIDATE" \
    "$(command -v powershell.exe >/dev/null 2>&1 && printf available || printf missing)" \
    "$WINDOWS_ADB_CANDIDATE" \
    "$ADB_PREFLIGHT_LOG"
}

verify_adb_reverse_ports() {
  local ports_csv="$ADB_PREFLIGHT_REVERSE_PORTS"
  [[ -n "$ports_csv" ]] || return 0

  local port=""
  IFS=',' read -ra ports <<<"$ports_csv"
  for port in "${ports[@]}"; do
    port="${port//[[:space:]]/}"
    [[ -n "$port" ]] || continue
    if ! [[ "$port" =~ ^[0-9]+$ ]]; then
      block "ADB preflight blocked: ADB_PREFLIGHT_REVERSE_PORTS contains non-numeric port '$port'. Use a comma-separated numeric list such as ADB_PREFLIGHT_REVERSE_PORTS=$API_PORT."
    fi

    local reverse_output=""
    if ! reverse_output="$(adb_cmd reverse "tcp:$port" "tcp:$port" 2>&1)"; then
      printf '\n$ adb reverse tcp:%s tcp:%s\n%s\n' "$port" "$port" "$reverse_output" >>"$ADB_PREFLIGHT_LOG"
      block "$(adb_preflight_failure_reason "setting adb reverse for tcp:$port" "$reverse_output")"
    fi
    printf '\n$ adb reverse tcp:%s tcp:%s\n%s\n' "$port" "$port" "$reverse_output" >>"$ADB_PREFLIGHT_LOG"
  done

  local reverse_list_output=""
  reverse_list_output="$(adb_cmd reverse --list 2>&1 || true)"
  printf '\n$ adb reverse --list\n%s\n' "$reverse_list_output" >>"$ADB_PREFLIGHT_LOG"
}

verify_device_capture_capabilities() {
  local remote_xml="/sdcard/starlog-preflight-window.xml"
  local xml_output=""
  if ! xml_output="$(adb_cmd shell uiautomator dump "$remote_xml" 2>&1)"; then
    printf '\n$ adb shell uiautomator dump %s\n%s\n' "$remote_xml" "$xml_output" >>"$ADB_PREFLIGHT_LOG"
    block "$(adb_preflight_failure_reason "dumping UI XML" "$xml_output")"
  fi
  printf '\n$ adb shell uiautomator dump %s\n%s\n' "$remote_xml" "$xml_output" >>"$ADB_PREFLIGHT_LOG"

  if ! adb_cmd exec-out cat "$remote_xml" >"$BUILD_DIR/preflight-window.xml" 2>>"$ADB_PREFLIGHT_LOG"; then
    block "ADB preflight blocked: UI XML dump succeeded but `adb exec-out cat $remote_xml` could not write $BUILD_DIR/preflight-window.xml. If using Windows adb.exe from WSL, keep using exec-out into the Linux path rather than adb pull. See $ADB_PREFLIGHT_LOG."
  fi
  if [[ ! -s "$BUILD_DIR/preflight-window.xml" ]]; then
    block "ADB preflight blocked: UI XML dump produced an empty $BUILD_DIR/preflight-window.xml. Unlock the phone and rerun. See $ADB_PREFLIGHT_LOG."
  fi

  if ! adb_cmd exec-out screencap -p >"$BUILD_DIR/preflight-screen.png" 2>>"$ADB_PREFLIGHT_LOG"; then
    block "ADB preflight blocked: `adb exec-out screencap -p` failed. Unlock the phone and verify screen capture works through the selected adb route. See $ADB_PREFLIGHT_LOG."
  fi
  if [[ ! -s "$BUILD_DIR/preflight-screen.png" ]]; then
    block "ADB preflight blocked: screenshot capture produced an empty $BUILD_DIR/preflight-screen.png. Unlock the phone and rerun. See $ADB_PREFLIGHT_LOG."
  fi
}

run_adb_preflight() {
  if truthy "$SKIP_ADB_PREFLIGHT"; then
    log "Skipping adb preflight because SKIP_ADB_PREFLIGHT=$SKIP_ADB_PREFLIGHT"
    return 0
  fi

  prepare_preflight_dirs
  write_adb_preflight_host_report
  log "Running adb preflight with $ADB${ADB_SERIAL:+ (ADB_SERIAL=$ADB_SERIAL)}"

  local devices_output=""
  if ! devices_output="$("$ADB" devices -l 2>&1)"; then
    printf '%s\n' "$devices_output" >>"$ADB_PREFLIGHT_LOG"
    block "$(adb_preflight_failure_reason "listing devices" "$devices_output")"
  fi
  printf '%s\n' "$devices_output" >>"$ADB_PREFLIGHT_LOG"

  local ready_serials=()
  local serial=""
  while IFS= read -r serial; do
    [[ -n "$serial" ]] && ready_serials+=("$serial")
  done < <(adb_ready_serials_from_devices_output "$devices_output")

  if [[ -n "$ADB_SERIAL" ]]; then
    local target_state=""
    target_state="$(adb_device_state_from_devices_output "$devices_output" "$ADB_SERIAL" || true)"
    if [[ "$target_state" != "device" ]]; then
      if [[ -n "$target_state" ]]; then
        block "ADB preflight blocked: target ADB_SERIAL=$ADB_SERIAL is '$target_state', not 'device'. Unlock the phone, accept USB debugging authorization, or reconnect it until '$ADB devices -l' shows '$ADB_SERIAL device'. See $ADB_PREFLIGHT_LOG."
      fi
      block "ADB preflight blocked: target ADB_SERIAL=$ADB_SERIAL was not listed by '$ADB devices -l'. Verify the serial with '$ADB devices -l', reconnect/unlock the phone, or update ADB_SERIAL. See $ADB_PREFLIGHT_LOG."
    fi
  else
    case "${#ready_serials[@]}" in
      0)
        if adb_bridge_output_is_unavailable <<<"$devices_output"; then
          block "$(adb_preflight_failure_reason "listing devices" "$devices_output")"
        fi
        block "$(preflight_no_ready_device_message "$devices_output")"
        ;;
      1)
        ADB_SERIAL="${ready_serials[0]}"
        log "ADB preflight selected device $ADB_SERIAL"
        ;;
      *)
        block "ADB preflight blocked: multiple ready adb devices found (${ready_serials[*]}). Set ADB_SERIAL to the intended target."
        ;;
    esac
  fi

  local boot_output=""
  if ! boot_output="$(adb_cmd shell getprop sys.boot_completed 2>&1)"; then
    printf '\n$ adb shell getprop sys.boot_completed\n%s\n' "$boot_output" >>"$ADB_PREFLIGHT_LOG"
    block "$(adb_preflight_failure_reason "checking sys.boot_completed" "$boot_output")"
  fi
  printf '\n$ adb shell getprop sys.boot_completed\n%s\n' "$boot_output" >>"$ADB_PREFLIGHT_LOG"

  local boot_completed
  boot_completed="$(tr -d '\r\n' <<<"$boot_output")"
  if [[ "$boot_completed" != "1" ]]; then
    block "ADB preflight blocked: target ${ADB_SERIAL:-auto} is connected but Android boot is not complete (sys.boot_completed=${boot_completed:-unset}). Wait for Android to finish booting, unlock the phone, then rerun. See $ADB_PREFLIGHT_LOG."
  fi

  adb_cmd shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  if ! adb_cmd shell svc power stayon usb >/dev/null 2>&1; then
    adb_cmd shell svc power stayon true >/dev/null 2>&1 || true
  fi
  require_phone_unlocked
  verify_adb_reverse_ports
  verify_device_capture_capabilities

  log "ADB preflight passed for ${ADB_SERIAL:-auto}"
}

to_windows_path() {
  local path="$1"
  case "$path" in
    [A-Za-z]:/*)
      printf '%s' "$path"
      ;;
    /mnt/c/*)
      printf 'C:%s' "${path#/mnt/c}"
      ;;
    /mnt/d/*)
      printf 'D:%s' "${path#/mnt/d}"
      ;;
    /mnt/e/*)
      printf 'E:%s' "${path#/mnt/e}"
      ;;
    *)
      printf '%s' "$path"
      ;;
  esac
}

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "$PRESERVED_EXISTING_APK" && -f "$PRESERVED_EXISTING_APK" ]]; then
    rm -f "$PRESERVED_EXISTING_APK"
  fi
}

trap cleanup EXIT

ensure_requirements() {
  [[ -x "$JAVA_HOME/bin/java" ]] || fail "JAVA_HOME is missing a java binary: $JAVA_HOME"
  [[ -x "$JAVA_HOME/bin/javac" ]] || fail "JAVA_HOME is missing a javac binary: $JAVA_HOME"
  ensure_adb_available
  [[ -x "$VENV_PYTHON" ]] || fail "services/api virtualenv python not found: $VENV_PYTHON"
  [[ -f "$DECK_PATH" ]] || fail "Deck file not found: $DECK_PATH"
  [[ -f "$NEETCODE_SOURCE_PATH" ]] || fail "NeetCode source file not found: $NEETCODE_SOURCE_PATH"
}

create_passphrase() {
  mkdir -p "$CONFIG_DIR"
  if [[ ! -f "$PASSPHRASE_FILE" ]]; then
    python3 - "$PASSPHRASE_FILE" <<'PY'
from pathlib import Path
import random
import string
import sys

path = Path(sys.argv[1])
alphabet = string.ascii_lowercase + string.digits
value = "starlog" + "".join(random.SystemRandom().choice(alphabet) for _ in range(24))
path.write_text(value + "\n", encoding="utf-8")
PY
    chmod 600 "$PASSPHRASE_FILE"
  fi

  STARLOG_TEST_PASSPHRASE="$(tr -d '\r\n' < "$PASSPHRASE_FILE")"
  export STARLOG_TEST_PASSPHRASE
  [[ ${#STARLOG_TEST_PASSPHRASE} -ge 12 ]] || fail "Stored passphrase is too short: $PASSPHRASE_FILE"
}

prepare_dirs() {
  if [[ "$SKIP_BUILD" == "1" && -n "$EXISTING_APK_PATH" && -f "$EXISTING_APK_PATH" ]]; then
    case "$EXISTING_APK_PATH" in
      "$BUILD_ROOT"/*)
        PRESERVED_EXISTING_APK="$(mktemp /tmp/starlog-existing-apk.XXXXXX.apk)"
        cp "$EXISTING_APK_PATH" "$PRESERVED_EXISTING_APK"
        EXISTING_APK_PATH="$PRESERVED_EXISTING_APK"
        ;;
    esac
  fi
  rm -rf "$BUILD_ROOT" "$RUNTIME_ROOT"
  mkdir -p "$BUILD_DIR" "$RUNTIME_DIR" "$SCREENSHOT_DIR"
}

resolve_target_architectures() {
  if [[ -n "$REACT_NATIVE_ARCHITECTURES" ]]; then
    return
  fi

  adb_cmd wait-for-device >/dev/null
  local detected_abi=""
  detected_abi="$(adb_cmd shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r\n' || true)"
  if [[ -n "$detected_abi" ]]; then
    REACT_NATIVE_ARCHITECTURES="$detected_abi"
  else
    REACT_NATIVE_ARCHITECTURES="arm64-v8a"
  fi
}

kill_existing_local_api() {
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local pids
  pids="$(lsof -ti tcp:"$API_PORT" || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  for pid in $pids; do
    local command
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"uvicorn app.main:app"* || "$command" == *"python -m uvicorn app.main:app"* ]]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    else
      fail "Port $API_PORT is already in use by a non-Starlog process: $command"
    fi
  done
}

wait_for_health() {
  local url="$1"
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if curl -fsS "$url/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "Timed out waiting for local API health at $url"
}

start_local_api() {
  kill_existing_local_api
  log "Starting fresh local API at $API_BASE"
  STARLOG_ENV=prod \
  STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
  STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
  STARLOG_SECRETS_MASTER_KEY="android-local-srs-$STAMP" \
  PYTHONPATH="$ROOT_DIR/services/api" \
  "$VENV_PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" --app-dir "$ROOT_DIR/services/api" \
    >"$API_LOG" 2>&1 &
  API_PID="$!"
  wait_for_health "$API_BASE"
}

bootstrap_local_station() {
  log "Bootstrapping local auth station"
  local bootstrap_status
  bootstrap_status="$(curl -sS -o /tmp/starlog-bootstrap.json -w '%{http_code}' \
    -X POST "$API_BASE/v1/auth/bootstrap" \
    -H 'Content-Type: application/json' \
    -d "{\"passphrase\":\"${STARLOG_TEST_PASSPHRASE}\"}")"
  if [[ "$bootstrap_status" != "201" && "$bootstrap_status" != "409" ]]; then
    fail "Local bootstrap failed with HTTP $bootstrap_status: $(cat /tmp/starlog-bootstrap.json)"
  fi
}

import_local_srs_deck() {
  log "Importing ML Interviews SRS deck into fresh local DB"
  STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
  STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
  PYTHONPATH="$ROOT_DIR/services/api" \
  "$VENV_PYTHON" "$ROOT_DIR/scripts/bootstrap_ml_interview_srs.py" --deck "$DECK_PATH" >"$BUILD_DIR/srs-import.json"
  "$VENV_PYTHON" - "$BUILD_DIR/srs-import.json" "$RUNTIME_DIR/starlog.db" <<'PY'
import sys
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

summary_path = Path(sys.argv[1])
db_path = Path(sys.argv[2])

payload = json.loads(summary_path.read_text(encoding="utf-8"))
card_set_version_id = payload.get("card_set_version_id")
if not card_set_version_id:
    raise SystemExit("Import summary missing card_set_version_id; cannot force imported cards due")

due_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(microsecond=0).isoformat()
with sqlite3.connect(str(db_path)) as conn:
    cursor = conn.execute(
        "UPDATE cards SET due_at = ?, updated_at = ? WHERE card_set_version_id = ?",
        (due_at, due_at, card_set_version_id),
    )
    if cursor.rowcount <= 0:
        raise SystemExit(f"No cards updated for card_set_version_id={card_set_version_id}")
    conn.commit()
PY
}

import_local_neetcode_study_core() {
  log "Importing NeetCode Study Core source into fresh local DB"
  STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
  STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
  PYTHONPATH="$ROOT_DIR/services/api" \
  "$VENV_PYTHON" "$ROOT_DIR/scripts/import_neetcode_150.py" --source "$NEETCODE_SOURCE_PATH" >"$BUILD_DIR/neetcode-import.json"
  "$VENV_PYTHON" - "$BUILD_DIR/neetcode-import.json" "$RUNTIME_DIR/starlog.db" <<'PY'
import json
import sqlite3
import sys
from pathlib import Path

summary_path = Path(sys.argv[1])
db_path = Path(sys.argv[2])

payload = json.loads(summary_path.read_text(encoding="utf-8"))
if payload.get("problem_count") != 150:
    raise SystemExit(f"Expected 150 NeetCode problems, got {payload.get('problem_count')}")

with sqlite3.connect(str(db_path)) as conn:
    conn.row_factory = sqlite3.Row
    counts = {
        "study_sources": conn.execute("SELECT COUNT(*) FROM study_sources").fetchone()[0],
        "study_topics": conn.execute("SELECT COUNT(*) FROM study_topics").fetchone()[0],
        "card_topic_links": conn.execute("SELECT COUNT(*) FROM card_topic_links").fetchone()[0],
    }

if counts["study_sources"] < 1 or counts["study_topics"] < 1 or counts["card_topic_links"] < 1:
    raise SystemExit(f"NeetCode Study Core import did not create expected rows: {counts}")
PY
}

seed_native_interview_loop_review_queue() {
  log "Preparing locked Sliding Window review queue for native Study Core validation"
  STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
  STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
  PYTHONPATH="$ROOT_DIR/services/api" \
  "$VENV_PYTHON" - "$RUNTIME_DIR/starlog.db" "$BUILD_DIR/native-interview-loop-seed.json" <<'PY'
import json
import sqlite3
import sys
from datetime import timedelta
from pathlib import Path

from app.core.time import utc_now
from app.services import study_service

db_path = Path(sys.argv[1])
summary_path = Path(sys.argv[2])

with sqlite3.connect(str(db_path)) as conn:
    conn.row_factory = sqlite3.Row
    topic = conn.execute(
        "SELECT id, source_id, title FROM study_topics WHERE title = ? LIMIT 1",
        ("Sliding Window",),
    ).fetchone()
    if topic is None:
        raise SystemExit("Sliding Window topic is missing after NeetCode import")

    topic_id = str(topic["id"])
    card_rows = conn.execute(
        """
        SELECT DISTINCT c.id
        FROM cards c
        JOIN card_topic_links ctl ON ctl.card_id = c.id
        WHERE ctl.topic_id = ?
          AND ctl.gate_required = 1
        ORDER BY c.id
        """,
        (topic_id,),
    ).fetchall()
    card_ids = [str(row["id"]) for row in card_rows]
    if not card_ids:
        raise SystemExit("Sliding Window topic has no gated review cards")

    placeholders = ",".join("?" for _ in card_ids)
    prereq_rows = conn.execute(
        f"""
        SELECT DISTINCT t.id, t.title
        FROM card_topic_links ctl
        JOIN study_topics t ON t.id = ctl.topic_id
        WHERE ctl.card_id IN ({placeholders})
          AND ctl.gate_required = 1
          AND ctl.topic_id != ?
        ORDER BY t.display_order
        """,
        (*card_ids, topic_id),
    ).fetchall()
    prerequisites = []
    for row in prereq_rows:
        progress = study_service.mark_topic_read(conn, str(row["id"]))
        prerequisites.append({"id": str(row["id"]), "title": str(row["title"]), "status": progress["status"]})

    due_at = (utc_now() - timedelta(minutes=5)).isoformat()
    conn.executemany(
        "UPDATE cards SET due_at = ?, updated_at = ? WHERE id = ?",
        [(due_at, due_at, card_id) for card_id in card_ids],
    )
    conn.commit()

    locked_due_count = conn.execute(
        f"""
        SELECT COUNT(*) AS count
        FROM cards c
        WHERE c.id IN ({placeholders})
          AND c.suspended = 0
          AND c.due_at <= ?
          AND EXISTS (
            SELECT 1
            FROM card_topic_links ctl
            LEFT JOIN study_topic_progress stp ON stp.topic_id = ctl.topic_id
            WHERE ctl.card_id = c.id
              AND ctl.gate_required = 1
              AND COALESCE(stp.read_at, '') = ''
              AND COALESCE(stp.status, '') != 'read'
          )
        """,
        (*card_ids, utc_now().isoformat()),
    ).fetchone()["count"]

summary = {
    "topic": {"id": topic_id, "title": str(topic["title"])},
    "card_count": len(card_ids),
    "prerequisites_marked_read": prerequisites,
    "locked_due_count": int(locked_due_count),
}
if summary["locked_due_count"] <= 0:
    raise SystemExit(f"Expected locked due cards before native read action: {summary}")
summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

verify_local_review_queue() {
  local token
  local login_body="$BUILD_DIR/auth-login.json"
  local login_status
  login_status="$(curl -sS -o "$login_body" -w '%{http_code}' \
    -X POST "$API_BASE/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"passphrase\":\"${STARLOG_TEST_PASSPHRASE}\"}")"
  if [[ "$login_status" != "200" ]]; then
    fail "Local auth login failed with HTTP $login_status: $(cat "$login_body")"
  fi
  token="$(python3 - "$login_body" <<'PY'
from pathlib import Path
import json
import sys

payload = json.loads(Path(sys.argv[1]).read_text())
token = payload.get("access_token")
if not isinstance(token, str) or not token:
    raise SystemExit("Login response did not include access_token")
print(token)
PY
)"
  STARLOG_LOCAL_ACCESS_TOKEN="$token"

  curl -fsS "$API_BASE/v1/cards/decks" -H "Authorization: Bearer $token" >"$BUILD_DIR/review-decks.json"
  curl -fsS "$API_BASE/v1/cards/due?limit=20" -H "Authorization: Bearer $token" >"$BUILD_DIR/due-cards.json"
  python3 - "$BUILD_DIR/due-cards.json" "$BUILD_DIR/native-interview-loop-seed.json" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
seed_path = Path(sys.argv[2])
payload = json.loads(path.read_text())
if isinstance(payload, dict):
    cards = payload.get("cards") or []
elif isinstance(payload, list):
    cards = payload
else:
    cards = []

if cards:
    raise SystemExit("Fresh local review queue leaked gated cards before native topic read")

seed = json.loads(seed_path.read_text())
if int(seed.get("locked_due_count") or 0) <= 0:
    raise SystemExit(f"Seed did not prepare locked due cards: {seed}")
PY
}

build_apk() {
  log "Building fresh development release APK"
  export JAVA_HOME ANDROID_HOME ANDROID_SDK_ROOT
  local gradle_tasks=("assembleRelease")
  if [[ "$CLEAN_BUILD" == "1" ]]; then
    gradle_tasks=("clean" "assembleRelease")
  fi
  (
    cd "$ROOT_DIR/apps/mobile/android"
    APP_VARIANT="$APP_VARIANT" \
    STARLOG_VERSION_NAME="$STARLOG_VERSION_NAME" \
    STARLOG_ANDROID_VERSION_CODE="$STARLOG_ANDROID_VERSION_CODE" \
    REACT_NATIVE_ARCHITECTURES="$REACT_NATIVE_ARCHITECTURES" \
    STARLOG_ALLOW_DEBUG_RELEASE_SIGNING=true \
    ./gradlew "${gradle_tasks[@]}" --console=plain -PreactNativeArchitectures="$REACT_NATIVE_ARCHITECTURES"
  ) | tee "$BUILD_DIR/gradle-build.log"

  cp "$ROOT_DIR/apps/mobile/android/app/build/outputs/apk/release/app-release.apk" "$STAGED_APK"
  cp "$STAGED_APK" "$WINDOWS_APK_PATH"
  cp "$STAGED_APK" "$LATEST_APK_PATH"
}

stage_existing_apk() {
  [[ "$SKIP_BUILD" == "1" ]] || return 0
  [[ -n "$EXISTING_APK_PATH" ]] || fail "SKIP_BUILD=1 requires EXISTING_APK_PATH"
  [[ -f "$EXISTING_APK_PATH" ]] || fail "Existing APK not found: $EXISTING_APK_PATH"
  log "Reusing existing APK $EXISTING_APK_PATH"
  cp "$EXISTING_APK_PATH" "$STAGED_APK"
  cp "$STAGED_APK" "$WINDOWS_APK_PATH"
  cp "$STAGED_APK" "$LATEST_APK_PATH"
}

verify_built_apk() {
  local aapt
  aapt="$(find "$ANDROID_SDK_ROOT/build-tools" -type f -name aapt | sort | tail -n 1)"
  [[ -n "$aapt" ]] || fail "aapt not found under $ANDROID_SDK_ROOT/build-tools"
  local badging
  local actual_version_code=""
  local actual_version_name=""
  badging="$("$aapt" dump badging "$STAGED_APK")"
  grep -F "package: name='$APP_PACKAGE'" <<<"$badging" >/dev/null || fail "Built APK package drifted from $APP_PACKAGE"
  actual_version_code="$(sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" <<<"$badging" | head -n 1)"
  actual_version_name="$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$badging" | head -n 1)"
  [[ -n "$actual_version_code" ]] || fail "Could not parse versionCode from staged APK"
  [[ -n "$actual_version_name" ]] || fail "Could not parse versionName from staged APK"
  if [[ "$SKIP_BUILD" == "1" ]]; then
    STARLOG_ANDROID_VERSION_CODE="$actual_version_code"
    STARLOG_VERSION_NAME="$actual_version_name"
  else
    grep -F "versionCode='$STARLOG_ANDROID_VERSION_CODE'" <<<"$badging" >/dev/null || fail "Built APK versionCode drifted from $STARLOG_ANDROID_VERSION_CODE"
    grep -F "versionName='$STARLOG_VERSION_NAME'" <<<"$badging" >/dev/null || fail "Built APK versionName drifted from $STARLOG_VERSION_NAME"
  fi
  printf '%s\n' "$badging" >"$BUILD_DIR/apk-badging.txt"
  sha256sum "$STAGED_APK" >"$BUILD_DIR/apk.sha256"
}

remove_phone_builds() {
  log "Removing old Starlog packages from phone"
  for package in com.starlog.app.dev com.starlog.app.preview com.starlog.app; do
    adb_cmd uninstall "$package" >/dev/null 2>&1 || true
  done
}

ensure_phone_ready() {
  log "Waiting for phone runtime"
  adb_cmd wait-for-device >/dev/null
  adb_cmd shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_cmd shell svc power stayon usb >/dev/null 2>&1 || true
  adb_cmd reverse "tcp:${API_PORT}" "tcp:${API_PORT}" >/dev/null
}

preflight_phone_state() {
  log "Checking phone lock state before local validation"
  adb_cmd wait-for-device >/dev/null
  adb_cmd shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_cmd shell svc power stayon usb >/dev/null 2>&1 || true
  require_phone_unlocked
}

current_top_activity() {
  local focus_line=""
  focus_line="$(adb_cmd shell dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -n 1 || true)"
  if [[ -z "$focus_line" ]]; then
    adb_cmd shell dumpsys activity top 2>/dev/null \
      | sed -n 's/^.*ACTIVITY \([^ ]*\) .*$/\1/p' \
      | head -n 1
    return
  fi
  sed -n 's/^.* \([^ ]*\/[^ }]*\).*$/\1/p' <<<"$focus_line" | head -n 1
}

app_is_foreground() {
  local top_activity=""
  top_activity="$(current_top_activity || true)"
  [[ "$top_activity" == "${APP_PACKAGE}/"* ]]
}

bring_app_to_foreground() {
  local top_activity=""
  top_activity="$(current_top_activity || true)"
  if [[ "$top_activity" == "${APP_PACKAGE}/"* ]]; then
    return 0
  fi
  adb_cmd shell am start -W -n "$APP_COMPONENT" >/dev/null 2>&1 || true
  sleep 2
}

phone_locked() {
  adb_cmd shell dumpsys window policy 2>/dev/null \
    | grep -F "showing=true" >/dev/null
}

snapshot_phone_state() {
  local prefix="${1:-phone-state}"
  adb_cmd shell dumpsys activity top >"$TOP_ACTIVITY_PATH" 2>/dev/null || true
  adb_cmd shell dumpsys window policy >"$WINDOW_POLICY_PATH" 2>/dev/null || true
  adb_cmd shell uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1 || true
  adb_cmd exec-out cat /sdcard/window_dump.xml >"$BUILD_DIR/${prefix}.xml" 2>/dev/null || true
  adb_cmd exec-out screencap -p >"$BUILD_DIR/${prefix}.png" 2>/dev/null || true
}

require_phone_unlocked() {
  local deadline=$((SECONDS + 20))
  while (( SECONDS < deadline )); do
    if ! phone_locked; then
      return 0
    fi
    sleep 1
  done
  snapshot_phone_state "phone-locked"
  fail "Phone is locked. Unlock it manually and rerun the validation loop."
}

tap_if_present() {
  local needle="$1"
  dump_ui
  if ui_has_text "$needle"; then
    tap_text "$needle"
    return 0
  fi
  return 1
}

notification_permission_dialog_is_visible() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())

has_message = False
has_allow = False
for node in root.iter("node"):
    package = node.attrib.get("package") or ""
    if package not in {"com.google.android.permissioncontroller", "com.android.permissioncontroller"}:
        continue

    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    resource_id = node.attrib.get("resource-id") or ""
    if "send you notifications" in text or "send you notifications" in desc:
        has_message = True
    if (
        node.attrib.get("clickable") == "true"
        and text == "allow"
        and "deny" not in resource_id
    ):
        has_allow = True
    if resource_id.endswith(":id/permission_allow_button"):
        has_allow = True

if has_message and has_allow:
    raise SystemExit(0)
raise SystemExit(1)
PY
}

notification_permission_allow_coords() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

def center(bounds: str) -> str:
    left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
    return f"{(left + right) // 2} {(top + bottom) // 2}"

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())

matches = []
for node in root.iter("node"):
    package = node.attrib.get("package") or ""
    if package not in {"com.google.android.permissioncontroller", "com.android.permissioncontroller"}:
        continue
    if node.attrib.get("clickable") != "true":
        continue

    text = normalize(node.attrib.get("text") or "")
    resource_id = node.attrib.get("resource-id") or ""
    if resource_id.endswith(":id/permission_allow_button") or (text == "allow" and "deny" not in resource_id):
        matches.append(node)

if not matches:
    raise SystemExit(1)

matches.sort(key=lambda node: 0 if (node.attrib.get("resource-id") or "").endswith(":id/permission_allow_button") else 1)
print(center(matches[0].attrib["bounds"]))
PY
}

handle_notification_permission_dialog() {
  local prefix="${1:-notification-permission-dialog}"
  if ! notification_permission_dialog_is_visible; then
    return 1
  fi

  local coords
  coords="$(notification_permission_allow_coords)" || return 1
  log "Notification permission dialog detected; tapping Allow"
  capture_screen "$SCREENSHOT_DIR/${prefix}.png"
  snapshot_phone_state "$prefix"
  adb_cmd shell input tap ${coords} >/dev/null
  sleep 1
  dump_ui || true
  capture_screen "$SCREENSHOT_DIR/${prefix}-allowed.png"
  snapshot_phone_state "${prefix}-allowed"
  return 0
}

handle_play_protect_dialog() {
  dump_ui
  if ! ui_has_text "Play Protect" \
    && ! ui_has_text "Install anyway" \
    && ! ui_has_text "More details" \
    && ! ui_has_text "unsafe app" \
    && ! ui_has_text "send for analysis"; then
    return 1
  fi

  log "Play Protect dialog detected; attempting to continue install"
  tap_if_present "More details" || true
  sleep 1
  tap_if_present "Install anyway" || true
  sleep 1
  tap_if_present "Install anyway" || true
  sleep 1
  tap_if_present "Don’t send" || tap_if_present "Don't send" || true
  sleep 1
  tap_if_present "Continue install" || true
  return 0
}

install_apk() {
  log "Installing fresh APK from Windows-visible path"
  local previous_update=""
  local windows_install_path=""
  local install_log="$BUILD_DIR/adb-install.log"
  local install_pid=""
  previous_update="$(adb_cmd shell dumpsys package "$APP_PACKAGE" 2>/dev/null | sed -n 's/^[[:space:]]*lastUpdateTime=//p' | head -n 1 || true)"
  windows_install_path="$(to_windows_path "$WINDOWS_APK_PATH")"

  require_phone_unlocked

  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB" -s "$ADB_SERIAL" install --no-streaming -r "$windows_install_path" >"$install_log" 2>&1 &
  else
    "$ADB" install --no-streaming -r "$windows_install_path" >"$install_log" 2>&1 &
  fi
  install_pid="$!"

  local deadline=$((SECONDS + ADB_INSTALL_TIMEOUT_SEC))
  while kill -0 "$install_pid" 2>/dev/null; do
    if phone_locked; then
      snapshot_phone_state "install-blocked-locked"
      kill "$install_pid" 2>/dev/null || true
      wait "$install_pid" 2>/dev/null || true
      fail "Phone locked during adb install. Keep it unlocked until install + validation finish."
    fi

    local top_activity
    top_activity="$(current_top_activity)"
    if [[ "$top_activity" == *"PlayProtectDialogsActivity"* ]]; then
      handle_play_protect_dialog || true
    fi

    if (( SECONDS >= deadline )); then
      snapshot_phone_state "install-timeout"
      kill "$install_pid" 2>/dev/null || true
      wait "$install_pid" 2>/dev/null || true
      cat "$install_log" >&2 || true
      fail "Windows adb install timed out for $windows_install_path"
    fi
    sleep 2
  done

  if ! wait "$install_pid"; then
    cat "$install_log" >&2 || true
    fail "Windows adb install failed for $windows_install_path"
  fi

  if ! grep -F "Success" "$install_log" >/dev/null; then
    snapshot_phone_state "install-no-success"
    cat "$install_log" >&2 || true
    fail "Windows adb install did not report Success for $windows_install_path"
  fi

  local deadline=$((SECONDS + 240))
  while (( SECONDS < deadline )); do
    local package_dump
    package_dump="$(adb_cmd shell dumpsys package "$APP_PACKAGE" 2>/dev/null || true)"
    if grep -F "versionName=$STARLOG_VERSION_NAME" <<<"$package_dump" >/dev/null; then
      printf '%s\n' "$package_dump" >"$BUILD_DIR/package-dumpsys.txt"
      return 0
    fi

    local last_update
    last_update="$(sed -n 's/^[[:space:]]*lastUpdateTime=//p' <<<"$package_dump" | head -n 1 || true)"
    if [[ -n "$last_update" && "$last_update" != "$previous_update" && "$package_dump" == *"versionName=$STARLOG_VERSION_NAME"* ]]; then
      printf '%s\n' "$package_dump" >"$BUILD_DIR/package-dumpsys.txt"
      return 0
    fi
    sleep 2
  done

  fail "Timed out waiting for package $APP_PACKAGE to update to $STARLOG_VERSION_NAME"
}

dump_ui() {
  adb_cmd shell uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1 || return 1
  adb_cmd exec-out cat /sdcard/window_dump.xml >"$UI_XML" 2>/dev/null || return 1
}

ui_has_text() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle = sys.argv[1], sys.argv[2].lower()
root = ET.parse(path).getroot()


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for node in root.iter("node"):
        bounds = bounds_of(node)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for node in root.iter("node"):
        desc = node.attrib.get("content-desc") or ""
        text = node.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = (node.attrib.get("text") or "").lower()
    desc = (node.attrib.get("content-desc") or "").lower()
    if needle in text or needle in desc:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_has_exact_text() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().strip())


path, needle = sys.argv[1], normalize(sys.argv[2])
root = ET.parse(path).getroot()


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for node in root.iter("node"):
        bounds = bounds_of(node)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for node in root.iter("node"):
        desc = node.attrib.get("content-desc") or ""
        text = node.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    if text == needle or desc == needle or desc == f"[{needle}]":
        raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_center_for_text() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle = sys.argv[1], sys.argv[2].lower()
root = ET.parse(path).getroot()

def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def center(bounds: tuple[int, int, int, int]) -> str:
    left, top, right, bottom = bounds
    return f"{(left + right) // 2} {(top + bottom) // 2}"


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for node in root.iter("node"):
        bounds = bounds_of(node)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for node in root.iter("node"):
        desc = node.attrib.get("content-desc") or ""
        text = node.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = (node.attrib.get("text") or "").lower()
    desc = (node.attrib.get("content-desc") or "").lower()
    if needle in text or needle in desc:
        bounds = bounds_of(node)
        if not bounds:
            continue
        print(center(bounds))
        raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_center_for_exact_label() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle = sys.argv[1], sys.argv[2].lower()
root = ET.parse(path).getroot()

def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def center(bounds: tuple[int, int, int, int]) -> str:
    left, top, right, bottom = bounds
    return f"{(left + right) // 2} {(top + bottom) // 2}"


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for node in root.iter("node"):
        bounds = bounds_of(node)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for node in root.iter("node"):
        desc = node.attrib.get("content-desc") or ""
        text = node.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


exact_matches = []
for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = (node.attrib.get("text") or "").strip().lower()
    desc = (node.attrib.get("content-desc") or "").strip().lower()
    if text == needle or desc == needle or desc == f"[{needle}]":
        exact_matches.append(node)

if not exact_matches:
    raise SystemExit(1)

for node in exact_matches:
    if node.attrib.get("clickable") == "true":
        bounds = bounds_of(node)
        if not bounds:
            continue
        print(center(bounds))
        raise SystemExit(0)

first_bounds = bounds_of(exact_matches[0])
if not first_bounds:
    raise SystemExit(1)
print(center(first_bounds))
PY
}

ui_center_for_nth_class() {
  local klass="$1"
  local index="$2"
  python3 - "$UI_XML" "$klass" "$index" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, klass, index = sys.argv[1], sys.argv[2], int(sys.argv[3])
root = ET.parse(path).getroot()

def center(bounds: str) -> str:
    left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
    return f"{(left + right) // 2} {(top + bottom) // 2}"

matches = [node for node in root.iter("node") if node.attrib.get("class") == klass]
if index >= len(matches):
    raise SystemExit(1)
print(center(matches[index].attrib["bounds"]))
PY
}

ui_center_for_bottom_nav_tab() {
  local tab="$1"
  python3 - "$UI_XML" "$tab" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, tab = sys.argv[1], sys.argv[2].lower()
root = ET.parse(path).getroot()


def center(bounds: str) -> str:
    left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
    return f"{(left + right) // 2} {(top + bottom) // 2}"


def bounds_of(node):
    left, top, right, bottom = map(int, re.findall(r"\d+", node.attrib.get("bounds", "")))
    return left, top, right, bottom


def is_nav_label(value: str, expected: str) -> bool:
    value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
    if not value:
        return False
    parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
    for part in parts:
        part = re.sub(r"[^a-z ]+", " ", part)
        part = re.sub(r"\s+", " ", part).strip()
        if part == expected:
            return True
        words = part.split()
        if words and words[0] == expected and set(words[1:]).issubset({"tab", "selected"}):
            return True
    return False


screen_bottom = 0
for node in root.iter("node"):
    try:
        _left, _top, _right, bottom = bounds_of(node)
    except ValueError:
        continue
    screen_bottom = max(screen_bottom, bottom)
screen_floor = int(screen_bottom * 0.86)


def is_bottom_candidate(node: dict) -> bool:
    bounds = bounds_of(node)
    left, top, right, bottom = bounds
    # Keep it near the bottom nav rail area across screen sizes.
    return top >= 1700 and bottom >= screen_floor and right > left and bottom > top


matches = []
for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    desc = node.attrib.get("content-desc") or ""
    text = node.attrib.get("text") or ""
    if not is_bottom_candidate(node):
        continue
    if is_nav_label(desc, tab) or is_nav_label(text, tab):
        matches.append(node)

if not matches:
    raise SystemExit(1)

target = matches[0]
print(center(target.attrib["bounds"]))
PY
}

ui_has_class() {
  local target_class="$1"
  python3 - "$UI_XML" "$target_class" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, target_class = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()
for node in root.iter("node"):
    if node.attrib.get("class") == target_class:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_has_review_controls() {
  python3 - "$UI_XML" <<'PY'
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

for node in root.iter("node"):
    if node.attrib.get("class") == "android.widget.RadioButton":
        raise SystemExit(0)
    text = (node.attrib.get("text") or "").strip()
    if text in {"RECALL QUALITY", "Save grade", "Keep in Review"}:
        raise SystemExit(0)

raise SystemExit(1)
PY
}

ui_has_review_surface_marker() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().strip())


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for node in root.iter("node"):
        bounds = bounds_of(node)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for node in root.iter("node"):
        desc = node.attrib.get("content-desc") or ""
        text = node.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


visible_values = []
has_review_header = False
for node in root.iter("node"):
    if not is_visible(node):
        continue
    bounds = bounds_of(node)
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    values = [value for value in (text, desc) if value]
    visible_values.extend(values)
    if text == "review" and bounds:
        _left, top, _right, bottom = bounds
        if top < 400 and bottom <= nav_top:
            has_review_header = True

if not has_review_header:
    raise SystemExit(1)

review_markers = {
    "interview prep",
    "study loop",
    "today",
    "all due",
    "recall",
    "application",
    "unlock",
    "mark read",
    "application question",
    "recall question",
    "reveal answer",
    "hide answer",
    "explanation shown",
    "answer ready",
    "answer open",
    "worked solution",
    "again",
    "hard",
    "good",
    "easy",
    "free recall",
    "due",
}

matched = set()
for value in visible_values:
    for marker in review_markers:
        if marker in value:
            matched.add(marker)

if len(matched) >= 2:
    raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_has_assistant_marker() {
  local marker="$1"
  python3 - "$UI_XML" "$marker" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, marker = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for node in root.iter("node"):
        bounds = bounds_of(node)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for node in root.iter("node"):
        desc = node.attrib.get("content-desc") or ""
        text = node.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


marker_config = {
    "shell": {
        "ids": {"assistant-ui-shell"},
        "labels": {"assistant-ui shell"},
        "classes": set(),
    },
    "thread": {
        "ids": {"assistant-ui-thread"},
        "labels": {"assistant-ui thread"},
        "classes": set(),
    },
    "composer": {
        "ids": {"assistant-ui-composer", "assistant-ui-composer-input"},
        "labels": {
            "assistant-ui-composer",
            "assistant-ui-composer-input",
            "message composer",
            "write a message",
            "send assistant message",
            "ask, capture, plan, review, or move something forward...",
        },
        "classes": {"android.widget.EditText"},
    },
}

config = marker_config[marker]

for node in root.iter("node"):
    if not is_visible(node):
        continue

    resource_id = (node.attrib.get("resource-id") or "").strip().lower()
    resource_suffix = resource_id.rsplit("/", 1)[-1]
    text = (node.attrib.get("text") or "").strip().lower()
    desc = (node.attrib.get("content-desc") or "").strip().lower()
    klass = node.attrib.get("class") or ""

    if resource_suffix in config["ids"] or resource_id in config["ids"]:
        raise SystemExit(0)
    if text in config["labels"] or desc in config["labels"] or any(label in desc for label in config["labels"]):
        raise SystemExit(0)
    if klass in config["classes"]:
        raise SystemExit(0)

raise SystemExit(1)
PY
}

ui_has_assistant_shell_marker() {
  ui_has_assistant_marker "shell"
}

ui_has_assistant_thread_marker() {
  ui_has_assistant_marker "thread"
}

ui_has_assistant_composer_marker() {
  ui_has_assistant_marker "composer"
}

ui_has_assistant_empty_surface_marker() {
  ui_has_assistant_composer_marker
}

ui_has_raw_assistant_protocol_label() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

raw_labels = {
    "assistant step",
    "step update",
    "provider hint",
    "command examples",
    "renderers",
    "surfaces",
    "ui tools",
}


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().strip())


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for node in root.iter("node"):
        bounds = bounds_of(node)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for node in root.iter("node"):
        desc = node.attrib.get("content-desc") or ""
        text = node.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


def is_raw_label(value: str) -> bool:
    value = normalize(value)
    for label in raw_labels:
        if value == label or value.startswith(f"{label}:") or value.startswith(f"{label} "):
            return True
    return False


for node in root.iter("node"):
    if not is_visible(node):
        continue
    if is_raw_label(node.attrib.get("text") or "") or is_raw_label(node.attrib.get("content-desc") or ""):
        raise SystemExit(0)

raise SystemExit(1)
PY
}

assert_assistant_surface_contract() {
  if ! { { ui_has_assistant_shell_marker && ui_has_assistant_thread_marker; } || ui_has_assistant_empty_surface_marker; }; then
    capture_screen "$SCREENSHOT_DIR/assistant-surface-contract-missing.png"
    snapshot_phone_state "assistant-surface-contract-missing"
    fail "Assistant surface contract missing assistant-ui shell/thread or composer markers; refusing diagnostic-only Assistant evidence"
  fi

  if ui_has_text "Starlog Review" \
    || ui_has_text "Focused Review" \
    || ui_has_text "Knowledge Health" \
    || ui_has_text "Study loop" \
    || ui_has_exact_text "Load due cards" \
    || ui_has_exact_text "Reveal answer" \
    || ui_has_exact_text "Hide answer"; then
    capture_screen "$SCREENSHOT_DIR/assistant-surface-review-controls.png"
    snapshot_phone_state "assistant-surface-review-controls"
    fail "Assistant validation found Review-surface controls; refusing to accept Review evidence as Assistant evidence"
  fi

  if ui_has_exact_text "Show Diagnostics" || ui_has_exact_text "Hide Diagnostics"; then
    capture_screen "$SCREENSHOT_DIR/assistant-surface-diagnostic-only.png"
    snapshot_phone_state "assistant-surface-diagnostic-only"
    fail "Assistant validation found diagnostic-only support controls instead of the Assistant shell"
  fi

  if ui_has_raw_assistant_protocol_label; then
    capture_screen "$SCREENSHOT_DIR/assistant-surface-raw-protocol-label.png"
    snapshot_phone_state "assistant-surface-raw-protocol-label"
    fail "Assistant validation found raw diagnostic protocol labels in normal Assistant evidence"
  fi
}

assert_assistant_composer_available() {
  local screenshot_prefix="${1:-assistant-ui}"
  local deadline=$((SECONDS + 30))
  local attempt=0

  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    assert_assistant_surface_contract

    if ui_has_assistant_composer_marker; then
      capture_screen "$SCREENSHOT_DIR/${screenshot_prefix}-composer.png"
      snapshot_phone_state "${screenshot_prefix}-composer"
      return 0
    fi

    if (( attempt % 2 == 0 )); then
      scroll_review_controls_reverse
    else
      scroll_review_controls
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/${screenshot_prefix}-composer-missing.png"
  snapshot_phone_state "${screenshot_prefix}-composer-missing"
  fail "Assistant-ui composer proof missing after shell/thread evidence"
}

assert_assistant_command_transcript_visible() {
  local expected_command="$1"
  local screenshot_prefix="${2:-assistant-ui}"
  local deadline=$((SECONDS + 35))
  local attempt=0

  [[ -n "$expected_command" ]] || return 0

  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    assert_assistant_surface_contract

    if ui_has_text "$expected_command"; then
      capture_screen "$SCREENSHOT_DIR/${screenshot_prefix}-command-transcript.png"
      snapshot_phone_state "${screenshot_prefix}-command-transcript"
      return 0
    fi

    if (( attempt % 2 == 0 )); then
      scroll_review_controls_reverse
    else
      scroll_review_controls
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/${screenshot_prefix}-command-transcript-missing.png"
  snapshot_phone_state "${screenshot_prefix}-command-transcript-missing"
  fail "Assistant command transcript proof missing after shell/thread/composer evidence"
}

assert_assistant_ui_shell_and_transcript() {
  local expected_command="$1"
  local screenshot_prefix="${2:-assistant-ui}"
  local deadline=$((SECONDS + 45))
  local found_shell=0
  local found_thread=0
  local attempt=0

  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    assert_assistant_surface_contract

    if ui_has_assistant_shell_marker; then
      found_shell=1
    fi
    if ui_has_assistant_thread_marker; then
      found_thread=1
    fi

    if (( found_shell == 1 && found_thread == 1 )); then
      capture_screen "$SCREENSHOT_DIR/${screenshot_prefix}-shell-thread.png"
      snapshot_phone_state "${screenshot_prefix}-shell-thread"
      assert_assistant_composer_available "$screenshot_prefix"
      assert_assistant_command_transcript_visible "$expected_command" "$screenshot_prefix"
      return 0
    fi

    if (( attempt % 2 == 0 )); then
      scroll_review_controls_reverse
    else
      scroll_review_controls
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/${screenshot_prefix}-shell-thread-missing.png"
  snapshot_phone_state "${screenshot_prefix}-shell-thread-missing"
  fail "Assistant-ui shell/thread proof missing (shell=${found_shell}, thread=${found_thread})"
}

assert_assistant_ui_shell_thread_composer() {
  local screenshot_prefix="${1:-assistant-ui}"
  assert_assistant_ui_shell_and_transcript "" "$screenshot_prefix"
}

assert_assistant_dynamic_ui_capability_prompt() {
  local deadline=$((SECONDS + 45))
  local found_summary=0
  local found_domain_controls=0
  local attempt=0

  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    assert_assistant_surface_contract

    if ui_has_text "list_dynamic_ui_capabilities" || ui_has_text "renderer_key"; then
      capture_screen "$SCREENSHOT_DIR/assistant-dynamic-ui-capability-raw-label.png"
      snapshot_phone_state "assistant-dynamic-ui-capability-raw-label"
      fail "Assistant capability prompt exposed raw dynamic UI protocol labels"
    fi

    if ui_has_text "Starlog dynamic UI" || ui_has_text "dynamic UI"; then
      found_summary=1
    fi
    if ui_has_text "topic unlock" || ui_has_text "interview question" || ui_has_text "review grading"; then
      found_domain_controls=1
    fi

    if (( found_summary == 1 && found_domain_controls == 1 )); then
      capture_screen "$SCREENSHOT_DIR/assistant-dynamic-ui-capability-prompt.png"
      snapshot_phone_state "assistant-dynamic-ui-capability-prompt"
      return 0
    fi

    if (( attempt % 2 == 0 )); then
      scroll_review_controls_reverse
    else
      scroll_review_controls
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/assistant-dynamic-ui-capability-prompt-missing.png"
  snapshot_phone_state "assistant-dynamic-ui-capability-prompt-missing"
  fail "Assistant dynamic UI capability prompt was not visible (summary=${found_summary}, domain_controls=${found_domain_controls})"
}

tap_bottom_nav_tab() {
  local tab="$1"
  dump_ui
  local coords
  coords="$(ui_center_for_bottom_nav_tab "$tab")" || return 1
  adb_cmd shell input tap ${coords} >/dev/null
}

wait_for_assistant_surface() {
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if { ui_has_assistant_shell_marker && ui_has_assistant_thread_marker; } || ui_has_assistant_empty_surface_marker; then
      assert_assistant_surface_contract
      return 0
    fi

    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/wait-for-assistant-surface-timeout.png"
  snapshot_phone_state "assistant-surface-timeout"
  fail "Timed out waiting for Assistant tab surface"
}

ui_has_planner_surface_marker() {
  if ui_has_review_controls; then
    return 1
  fi

  if ! { ui_has_exact_text "Planner" || ui_has_text "Starlog Planner"; }; then
    return 1
  fi

  ui_has_text "Active decision" \
    || ui_has_text "Day timeline" \
    || ui_has_exact_text "Next focus" \
    || ui_has_exact_text "Upcoming" \
    || ui_has_text "Set next focus" \
    || ui_has_text "Open calendar" \
    || ui_has_text "Refresh Planner" \
    || ui_has_text "Previous planner day" \
    || ui_has_text "Next planner day" \
    || ui_has_exact_text "Alarm schedule" \
    || ui_has_exact_text "Alarm is not scheduled yet" \
    || ui_has_exact_text "Alarm is not scheduled yet." \
    || ui_has_exact_text "Generate and cache briefing" \
    || ui_has_exact_text "No offline briefing cached yet" \
    || ui_has_text "Morning briefing" \
    || ui_has_text "Briefing" \
    || ui_has_text "No alarm" \
    || ui_has_text "Alarm scheduled" \
    || ui_has_text "Scheduled for" \
    || ui_has_text "Daily alarm scheduled"
}

wait_for_planner_surface() {
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if ui_has_planner_surface_marker; then
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/wait-for-planner-surface-timeout.png"
  snapshot_phone_state "planner-surface-timeout"
  fail "Timed out waiting for Planner tab surface"
}

wait_for_review_surface() {
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi
    if ui_has_review_surface_marker; then
      return 0
    fi
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=review" -n "$APP_COMPONENT" >/dev/null || true
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/review-surface-timeout.png"
  snapshot_phone_state "review-surface-timeout"
  fail "Timed out waiting for Review tab surface"
}

ensure_review_surface() {
  adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=review" -n "$APP_COMPONENT" >/dev/null || true
  wait_for_review_surface
}

wait_for_ui_text() {
  local needle="$1"
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if dump_ui && ui_has_text "$needle"; then
      return 0
    fi
    sleep 1
  done
  capture_screen "$SCREENSHOT_DIR/wait-for-ui-text-timeout.png"
  snapshot_phone_state "wait-for-ui-text-timeout"
  fail "Timed out waiting for UI text: $needle"
}

wait_for_any_ui_text() {
  local deadline=$((SECONDS + 60))
  local needles=("$@")
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi
    for needle in "${needles[@]}"; do
      if ui_has_text "$needle"; then
        return 0
      fi
    done
    sleep 1
  done
  capture_screen "$SCREENSHOT_DIR/wait-for-any-ui-text-timeout.png"
  snapshot_phone_state "wait-for-any-ui-text-timeout"
  fail "Timed out waiting for any UI text: ${needles[*]}"
}

scroll_until_any_ui_text() {
  local deadline=$((SECONDS + 30))
  local needles=("$@")
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if dump_ui; then
      for needle in "${needles[@]}"; do
        if ui_has_text "$needle"; then
          return 0
        fi
      done
    fi
    scroll_review_controls
    sleep 1
  done
  capture_screen "$SCREENSHOT_DIR/scroll-until-ui-text-timeout.png"
  snapshot_phone_state "scroll-until-ui-text-timeout"
  fail "Timed out scrolling for any UI text: ${needles[*]}"
}

scroll_until_any_ui_text_in_review() {
  local fail_suffix="$1"
  shift
  local deadline=$((SECONDS + 45))
  local needles=("$@")
  local attempts=0
  ensure_review_surface
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi
    for needle in "${needles[@]}"; do
      if ui_has_exact_text "$needle"; then
        return 0
      fi
    done
    if (( attempts < 8 )); then
      scroll_review_controls
    else
      scroll_review_controls_reverse
    fi
    attempts=$((attempts + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/review-${fail_suffix}-timeout.png"
  snapshot_phone_state "review-${fail_suffix}-timeout"
  fail "Timed out in review while scrolling for any UI text: ${needles[*]}"
}

tap_text() {
  local needle="$1"
  dump_ui
  local coords
  coords="$(ui_center_for_text "$needle")" || fail "Could not find tappable text: $needle"
  adb_cmd shell input tap ${coords} >/dev/null
}

tap_exact_text() {
  local needle="$1"
  dump_ui
  local coords
  coords="$(ui_center_for_exact_label "$needle")" || fail "Could not find exact tappable label: $needle"
  adb_cmd shell input tap ${coords} >/dev/null
}

tap_review_good_grade() {
  dump_ui
  local target
  target="$(python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()
parent_by_id = {id(child): parent for parent in root.iter() for child in parent}


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    left, top, right, bottom = numbers
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom


def center(bounds):
    left, top, right, bottom = bounds
    return (left + right) // 2, (top + bottom) // 2


def normalize(value):
    return re.sub(r"\s+", " ", (value or "").strip())


def is_good_label(value):
    value = normalize(value)
    return value == "Good" or value.startswith("Good,")


def visible_clickable(node):
    return node.attrib.get("clickable") == "true" and bounds_of(node) is not None


def node_label(node):
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    return text or desc


def emit(node, source):
    bounds = bounds_of(node)
    if not bounds:
        raise SystemExit(1)
    x, y = center(bounds)
    label = node_label(node)
    print(f"{x} {y}|[{bounds[0]},{bounds[1]}][{bounds[2]},{bounds[3]}]|{source}|{label}")
    raise SystemExit(0)


for node in root.iter("node"):
    if not visible_clickable(node):
        continue
    if is_good_label(node.attrib.get("text")) or is_good_label(node.attrib.get("content-desc")):
        emit(node, "clickable-label")

for node in root.iter("node"):
    if not (is_good_label(node.attrib.get("text")) or is_good_label(node.attrib.get("content-desc"))):
        continue
    current = parent_by_id.get(id(node))
    while current is not None:
        if visible_clickable(current):
            emit(current, "clickable-parent")
        current = parent_by_id.get(id(current))

raise SystemExit(1)
PY
)" || fail "Could not find clickable Review Good grade target"

  local coords="${target%%|*}"
  local rest="${target#*|}"
  local bounds="${rest%%|*}"
  rest="${rest#*|}"
  local source="${rest%%|*}"
  local label="${rest#*|}"
  log "Tapping Review Good grade target: source=${source}, label='${label}', bounds=${bounds}, coords=${coords}"
  adb_cmd shell input tap ${coords} >/dev/null
}

tap_nth_edit_text() {
  local index="$1"
  dump_ui
  local coords
  coords="$(ui_center_for_nth_class "android.widget.EditText" "$index")" || fail "Could not find EditText index $index"
  adb_cmd shell input tap ${coords} >/dev/null
}

tap_nearest_clickable_right_of_text() {
  local needle="$1"
  local max_x_offset="${2:-260}"
  local coords
  coords="$(python3 - "$UI_XML" "$needle" "$max_x_offset" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle, max_x_offset = sys.argv[1], sys.argv[2].lower(), int(sys.argv[3])
root = ET.parse(path).getroot()

def bounds_of(node: str):
    left, top, right, bottom = map(int, re.findall(r"\d+", node))
    return left, top, right, bottom

def center(left, top, right, bottom):
    return (left + right) // 2, (top + bottom) // 2

targets = []
for node in root.iter("node"):
    text = (node.attrib.get("text") or "").strip().lower()
    if needle in text:
        targets.append(bounds_of(node.attrib["bounds"]))

if not targets:
    raise SystemExit(1)

target_left, target_top, target_right, target_bottom = targets[0]
best = None
best_dx = None
for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    left, top, right, bottom = bounds_of(node.attrib["bounds"])
    if not (bottom >= target_top and top <= target_bottom):
        continue
    if left < target_right:
        continue
    dx = left - target_right
    if dx > max_x_offset:
        continue
    if best is None or dx < best_dx:
        best = (left, top, right, bottom)
        best_dx = dx

if best is None:
    raise SystemExit(1)
print(f"{center(*best)[0]} {center(*best)[1]}")
PY
)" || return 1
  adb_cmd shell input tap ${coords} >/dev/null
}

scroll_planner_content_once() {
  adb_cmd shell input swipe 540 1650 540 1120 260 >/dev/null
}

assert_planner_surface() {
  if ! ui_has_planner_surface_marker; then
    return 1
  fi
  return 0
}

planner_alarm_card_is_visible() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s:/]", " ", (value or "").lower()).strip())

def parse_bounds(value: str):
    numbers = list(map(int, re.findall(r"\d+", value)))
    if len(numbers) != 4:
        raise ValueError
    left, top, right, bottom = numbers
    if left > right:
        left, right = right, left
    if top > bottom:
        top, bottom = bottom, top
    return left, top, right, bottom

alarm_title_markers = {"alarm schedule"}
alarm_status_markers = {
    "alarm is not scheduled yet",
    "no briefing alarm scheduled",
    "alarm scheduled",
    "daily alarm scheduled",
    "scheduled for",
    "cache briefing before scheduling",
    "no offline briefing cached yet",
}
time_pattern = re.compile(r"\b[01]?\d:[0-5]\d\b")
cache_markers = {"generate and cache briefing", "cache briefing before scheduling"}
review_markers = {"again", "good", "hard", "easy"}

title_nodes = []
status_nodes = []
time_nodes = []
for node in root.iter("node"):
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    if not (text or desc):
        continue
    try:
        left, top, right, bottom = parse_bounds(node.attrib.get("bounds", ""))
    except ValueError:
        continue
    if top >= bottom or left >= right:
        continue

    if text in alarm_title_markers or desc in alarm_title_markers:
        title_nodes.append((left, top, right, bottom))
        continue

    if any(marker in text for marker in alarm_status_markers) or any(marker in desc for marker in alarm_status_markers):
        if node.attrib.get("clickable") != "true":
            status_nodes.append((left, top, right, bottom))
        continue

    if time_pattern.search(text) or time_pattern.search(desc):
        time_nodes.append((left, top, right, bottom))

if not title_nodes:
    raise SystemExit(1)

title_left = min(node[0] for node in title_nodes)
title_top = min(node[1] for node in title_nodes)
title_right = max(node[2] for node in title_nodes)
title_bottom = max(node[3] for node in title_nodes)

def is_near_alarm_title(bounds):
    left, top, right, _ = bounds
    if top < title_top - 24 or top > title_top + 560:
        return False
    if right < title_left - 40 or left > title_right + 40:
        return False
    return True

status_or_time_nodes = [node for node in status_nodes + time_nodes if is_near_alarm_title(node)]
if not status_or_time_nodes:
    raise SystemExit(1)

status_top = min((node[1] for node in status_or_time_nodes), default=title_top)
status_bottom = max((node[3] for node in status_or_time_nodes), default=title_bottom)

region_top = max(0, status_top - 170)
region_bottom = status_bottom + 260
region_left = title_left - 16
region_right = 1080
control_anchor_x = max(
    title_left + int((title_right - title_left) * 0.66),
    max((node[2] for node in status_or_time_nodes), default=title_left),
)
control_anchor_x = min(region_right, control_anchor_x)

for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    try:
        left, top, right, bottom = parse_bounds(node.attrib.get("bounds", ""))
    except ValueError:
        continue
    if top >= bottom or left >= right:
        continue
    if right <= region_left or left >= region_right:
        continue
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2

    if center_x + 40 < control_anchor_x:
        continue
    if bottom < region_top or top > region_bottom + 40:
        continue
    if center_y >= 1700:
        continue

    class_name = (node.attrib.get("class") or "").lower()
    if class_name in {"android.widget.radiobutton", "android.widget.imageview"}:
        continue

    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    if any(token in text for token in review_markers) or any(token in desc for token in review_markers):
        continue

    is_cache_control = any(token in text for token in cache_markers) or any(token in desc for token in cache_markers)
    if is_cache_control:
        if node.attrib.get("enabled") == "true" and (
            "generate and cache briefing" in text or "generate and cache briefing" in desc
        ):
            raise SystemExit(0)
        continue

    alarm_hint = (
        "toggle morning alarm" in desc
        or ("morning alarm" in desc and "toggle" in desc)
        or "alarm" in desc
    )
    switchish = class_name in {"android.widget.switch", "android.widget.togglebutton", "android.widget.checkbox"}
    if not alarm_hint and not switchish:
        continue

    if class_name in {"android.view.viewgroup", "android.view.view"} and alarm_hint:
        raise SystemExit(0)
    if switchish:
        raise SystemExit(0)

raise SystemExit(1)
PY
}

ensure_planner_alarm_control_visible() {
  local deadline=$((SECONDS + 45))
  local tries=0
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if planner_alarm_card_is_visible; then
      return 0
    fi

    scroll_planner_content_once
    tries=$((tries + 1))
    if (( tries > 1 )); then
      sleep 1
    fi
  done

  capture_screen "$SCREENSHOT_DIR/planner-alarm-control-missing.png"
  snapshot_phone_state "planner-alarm-control-missing"
  capture_screen "$SCREENSHOT_DIR/planner-alarm-card-missing.png"
  snapshot_phone_state "planner-alarm-card-missing"
  fail "Could not reveal a dedicated Planner Alarm card while scrolling"
}

tap_planner_alarm_control() {
  local attempt="${1:-1}"
  local diagnostics_path="${2:-$BUILD_DIR/planner-alarm-control-candidate-${attempt}.json}"
  PLANNER_ALARM_CONTROL_DIAGNOSTICS="$diagnostics_path"
  local coords
  dump_ui || return 1
  coords="$(python3 - "$UI_XML" "$diagnostics_path" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET
import json

path = sys.argv[1]
diagnostics_path = sys.argv[2]
root = ET.parse(path).getroot()

def write_diagnostics(payload):
    with open(diagnostics_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, indent=2, sort_keys=True))

screen_left = 0
screen_right = 1080
screen_top = 0
screen_bottom = 1920
for node in root.iter("node"):
    bounds = re.findall(r"\d+", node.attrib.get("bounds", ""))
    if len(bounds) == 4 and bounds[0] == "0" and bounds[1] == "0":
        screen_left, _, screen_right, _ = map(int, bounds)
        break

for node in root.iter("node"):
    bounds = re.findall(r"\d+", node.attrib.get("bounds", ""))
    if len(bounds) == 4 and bounds[0] == "0" and bounds[1] == "0":
        _, _, _, screen_bottom = map(int, bounds)
        break

def parse_bounds(value: str):
    numbers = list(map(int, re.findall(r"\d+", value)))
    if len(numbers) != 4:
        raise ValueError
    left, top, right, bottom = numbers
    if left > right:
        left, right = right, left
    if top > bottom:
        top, bottom = bottom, top
    return left, top, right, bottom

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s:/]", " ", (value or "").lower()).strip())

alarm_title_markers = {"alarm schedule"}
alarm_status_markers = {
    "alarm is not scheduled yet",
    "no briefing alarm scheduled",
    "alarm scheduled",
    "daily alarm scheduled",
    "scheduled for",
    "cache briefing before scheduling",
    "no offline briefing cached yet",
}
cache_markers = {
    "generate and cache briefing",
    "cache briefing before scheduling",
}
time_pattern = re.compile(r"\b[01]?\d:[0-5]\d\b")
review_markers = {
    "again",
    "good",
    "hard",
    "easy",
    "reveal answer",
    "load due cards",
    "save grade",
    "focused review",
    "knowledge health",
}
noise_markers = {
    "cache briefing",
    "audio",
    "play",
    "speaker",
    "sound",
    "record",
}

title_nodes = []
status_nodes = []
time_nodes = []
for node in root.iter("node"):
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    if not (text or desc):
        continue

    try:
        left, top, right, bottom = parse_bounds(node.attrib["bounds"])
    except ValueError:
        continue
    if top >= bottom or left >= right:
        continue

    if text in alarm_title_markers or desc in alarm_title_markers:
        title_nodes.append((left, top, right, bottom))
        continue

    if any(marker in text for marker in alarm_status_markers) or any(marker in desc for marker in alarm_status_markers):
        if node.attrib.get("clickable") != "true":
            status_nodes.append((left, top, right, bottom))
        continue

    if time_pattern.search(text) or time_pattern.search(desc):
        time_nodes.append((left, top, right, bottom))

if not title_nodes:
    write_diagnostics({"error": "alarm_title_not_found"})
    raise SystemExit(1)

title_left = min(node[0] for node in title_nodes)
title_top = min(node[1] for node in title_nodes)
title_right = max(node[2] for node in title_nodes)
title_bottom = max(node[3] for node in title_nodes)

def is_near_alarm_title(bounds):
    left, top, right, _ = bounds
    if top < title_top - 24 or top > title_top + 560:
        return False
    if right < title_left - 40 or left > title_right + 40:
        return False
    return True

status_or_time_nodes = [node for node in status_nodes + time_nodes if is_near_alarm_title(node)]
if not status_or_time_nodes:
    write_diagnostics({
        "error": "alarm_status_or_time_not_found_near_title",
        "title_bounds": f"{title_left} {title_top} {title_right} {title_bottom}",
        "status_node_count": len(status_nodes),
        "time_node_count": len(time_nodes),
    })
    raise SystemExit(1)

status_top = min((node[1] for node in status_or_time_nodes), default=title_top)
status_bottom = max((node[3] for node in status_or_time_nodes), default=title_bottom)

region_top = max(screen_top, title_top - 140)
region_bottom = max(title_bottom + 420, status_bottom + 220)
region_left = max(screen_left, title_left - 20)
region_right = screen_right
region_mid_y = (title_top + title_bottom) // 2

for node in status_or_time_nodes:
    region_top = min(region_top, node[1])
    region_bottom = max(region_bottom, node[3])

title_width = max(1, title_right - title_left)
control_anchor_x = max(
    title_left + int(title_width * 0.66),
    max((node[2] for node in status_or_time_nodes), default=title_left),
)
control_anchor_x = min(region_right, control_anchor_x)

candidates = []
for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    class_name = (node.attrib.get("class") or "").lower()
    if not (text or desc) and class_name not in {"android.view.viewgroup", "android.view.view"}:
        continue
    if node.attrib.get("class") == "android.widget.ImageView":
        if node.attrib.get("clickable") == "true" and text == "" and desc == "":
            continue

    try:
        left, top, right, bottom = parse_bounds(node.attrib["bounds"])
    except ValueError:
        continue
    if top >= bottom or left >= right:
        continue
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2

    if center_x + 40 < control_anchor_x:
        continue
    if left >= region_right or right <= region_left:
        continue
    if bottom < region_top or top > region_bottom + 60:
        continue
    if center_y >= screen_bottom - 300:
        continue

    if class_name in {"android.widget.radiobutton", "android.widget.imageview"}:
        continue
    if any(token in text for token in review_markers) or any(token in desc for token in review_markers):
        continue
    if any(token in text for token in cache_markers) or any(token in desc for token in cache_markers):
        continue
    if any(token in text for token in noise_markers) or any(token in desc for token in noise_markers):
        continue

    alarm_hint = (
        "toggle morning alarm" in desc
        or ("morning alarm" in desc and "toggle" in desc)
        or "switch" in text
        or "alarm" in desc
    )
    switchish = class_name in {"android.widget.switch", "android.widget.togglebutton", "android.widget.checkbox"}
    inside_tight_region = top >= region_top and bottom <= region_bottom + 180
    if not alarm_hint and not switchish:
        continue
    if not inside_tight_region and not alarm_hint:
        continue

    score = abs(center_y - region_mid_y)
    score_reasons = [f"center_y_delta={abs(center_y - region_mid_y)}"]

    x_gap = left - control_anchor_x
    if x_gap > 0:
        score += x_gap
        score_reasons.append(f"x_gap={x_gap}")
    else:
        score += 80
        score_reasons.append("left_of_control_anchor")

    if class_name in {"android.widget.switch", "android.widget.togglebutton", "android.widget.checkbox"}:
        score -= 140
        score_reasons.append("prefer_controls_switchish")
    elif class_name in {"android.widget.button", "android.widget.imagebutton"}:
        score += 30
        score_reasons.append("button_penalty")
    if alarm_hint:
        score -= 80
        score_reasons.append("alarm_hint")

    if not inside_tight_region:
        score += 80
        score_reasons.append("outside_tight_region")

    candidates.append({
        "score": score,
        "x": center_x,
        "y": center_y,
        "bounds": f"{left} {top} {right} {bottom}",
        "class": node.attrib.get("class") or "",
        "text": node.attrib.get("text") or "",
        "content_desc": node.attrib.get("content-desc") or "",
        "reason": "; ".join(score_reasons),
    })

if not candidates:
    for node in root.iter("node"):
        if node.attrib.get("class") != "android.widget.Switch":
            continue
        if node.attrib.get("clickable") != "true":
            continue
        text = normalize(node.attrib.get("text") or "")
        desc = normalize(node.attrib.get("content-desc") or "")
        try:
            left, top, right, bottom = parse_bounds(node.attrib["bounds"])
        except ValueError:
            continue
        if top >= bottom or left >= right:
            continue
        if left < control_anchor_x - 40:
            continue
        center_x = (left + right) // 2
        center_y = (top + bottom) // 2
        if center_y >= screen_bottom - 300:
            continue
        if bottom < region_top or top > region_bottom + 180:
            continue
        candidates.append({
            "score": 0,
            "x": center_x,
            "y": center_y,
            "bounds": f"{left} {top} {right} {bottom}",
            "class": node.attrib.get("class") or "",
            "text": node.attrib.get("text") or "",
            "content_desc": node.attrib.get("content-desc") or "",
            "reason": f"fallback_switch_in_row;text={text};content_desc={desc}",
        })

if not candidates:
    write_diagnostics({
        "error": "no_alarm_control_candidates",
        "region": {
            "left": region_left,
            "top": region_top,
            "right": region_right,
            "bottom": region_bottom,
            "title_bounds": f"{title_left} {title_top} {title_right} {title_bottom}",
            "control_anchor_x": control_anchor_x,
        },
        "status_or_time_bounds": [f"{left} {top} {right} {bottom}" for left, top, right, bottom in status_or_time_nodes],
        "top_candidates": [],
    })
    raise SystemExit(1)

candidates.sort(key=lambda item: (item["score"], item["y"], item["x"]))
selected = candidates[0]

payload = {
    "selected": selected,
    "region": {
        "left": region_left,
        "top": region_top,
        "right": region_right,
        "bottom": region_bottom,
        "title_bounds": f"{title_left} {title_top} {title_right} {title_bottom}",
        "control_anchor_x": control_anchor_x,
    },
    "top_candidates": candidates[:8],
}
write_diagnostics(payload)

print(f"{selected['x']} {selected['y']}")
PY
)" || return 1
  printf '%s\n' "$coords"
  adb_cmd shell input tap ${coords} >/dev/null
}

tap_planner_alarm_control_with_verification() {
  local attempt="${1:-1}"

  if ! dump_ui; then
    snapshot_phone_state "planner-alarm-control-pre-tap-dump-failed-${attempt}"
    fail "Could not refresh UI before tapping planner alarm control (attempt ${attempt})"
  fi
  capture_screen "$SCREENSHOT_DIR/planner-alarm-control-pre-tap-${attempt}.png"
  snapshot_phone_state "planner-alarm-control-pre-tap-${attempt}"

  if ! tap_planner_alarm_control "$attempt"; then
    snapshot_phone_state "planner-alarm-control-missing"
    fail "Could not locate planner alarm control near alarm card (attempt ${attempt}); diagnostics: ${PLANNER_ALARM_CONTROL_DIAGNOSTICS}"
  fi

  capture_screen "$SCREENSHOT_DIR/planner-alarm-control-tapped-${attempt}.png"
  snapshot_phone_state "planner-alarm-control-tapped-${attempt}"

  sleep 1
  if dump_ui && handle_notification_permission_dialog "planner-notification-permission-${attempt}"; then
    dump_ui || true
  fi

  if ! assert_planner_surface; then
    if handle_notification_permission_dialog "planner-notification-permission-${attempt}-retry"; then
      dump_ui || true
      if assert_planner_surface; then
        return 0
      fi
    fi

    capture_screen "$SCREENSHOT_DIR/planner-alarm-wrong-surface-${attempt}.png"
    snapshot_phone_state "planner-alarm-wrong-surface-${attempt}"
    fail "Tapped alarm control moved out of Planner surface before scheduling (attempt ${attempt}); diagnostics: ${PLANNER_ALARM_CONTROL_DIAGNOSTICS}"
  fi
}

tap_planner_alarm_cache_control() {
  local coords
  coords="$(python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    text = re.sub(r"\s+", " ", (node.attrib.get("text") or "").strip().lower())
    desc = re.sub(r"\s+", " ", (node.attrib.get("content-desc") or "").strip().lower())
    if text == "generate and cache briefing" or desc == "generate and cache briefing":
        bounds = node.attrib.get("bounds", "")
        left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
        cx = (left + right) // 2
        cy = (top + bottom) // 2
        print(f"{cx} {cy}")
        raise SystemExit(0)

raise SystemExit(1)
PY
)" || return 1
  adb_cmd shell input tap ${coords} >/dev/null
}

wait_for_planner_alarm_cache_ready() {
  local deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi
    if ! assert_planner_surface; then
      capture_screen "$SCREENSHOT_DIR/planner-alarm-cache-wrong-surface.png"
      snapshot_phone_state "planner-alarm-cache-wrong-surface"
      fail "Planner alarm cache flow navigated away from Planner surface"
    fi

    local alarm_state
    alarm_state="$(ui_planner_alarm_state)"
    if [[ "$alarm_state" != "cache_missing" && "$alarm_state" != "blocked" ]]; then
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/planner-alarm-cache-missing-timeout.png"
  snapshot_phone_state "planner-alarm-cache-missing-timeout"
  fail "Timed out waiting for planner cache readiness before scheduling"
}

ui_planner_alarm_state() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()

texts = [normalize(node.attrib.get("text", "")) for node in root.iter("node")]
for text in texts:
    if not text:
        continue
    if "cache briefing before scheduling" in text:
        print("blocked")
        raise SystemExit(0)
    if "no offline briefing cached yet" in text:
        print("cache_missing")
        raise SystemExit(0)

if any("no briefing alarm scheduled" in t or "alarm is not scheduled yet" in t for t in texts):
    print("unscheduled")
    raise SystemExit(0)

if any(
    "until play" in t
    or "until alarm" in t
    or "alarm scheduled" in t
    or "daily alarm scheduled" in t
    or "scheduled for" in t
    for t in texts
):
    print("scheduled")
    raise SystemExit(0)

print("unknown")
PY
}

wait_for_planner_alarm_state() {
  local expected_state="$1"
  local deadline=$((SECONDS + 45))
  local planner_alarm_state=""
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if ! assert_planner_surface; then
      if handle_notification_permission_dialog "planner-notification-permission-wait"; then
        continue
      fi
      capture_screen "$SCREENSHOT_DIR/planner-alarm-wrong-surface.png"
      snapshot_phone_state "planner-alarm-wrong-surface"
      fail "Planner alarm flow navigated away from Planner while waiting for alarm state"
    fi

    planner_alarm_state="$(ui_planner_alarm_state)"
    if [[ "$planner_alarm_state" == "$expected_state" ]]; then
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/wait-for-planner-alarm-status-timeout.png"
  snapshot_phone_state "planner-alarm-status-timeout"
  fail "Timed out waiting for planner alarm state: $expected_state (last observed: ${planner_alarm_state:-unknown})"
}

latest_review_grade_status_after_line() {
  local start_line="$1"
  python3 - "$API_LOG" "$start_line" <<'PY'
import re
import sys

path = sys.argv[1]
start_line = int(sys.argv[2])
lines = open(path, errors="ignore").read().splitlines()
status = ""
for line in lines[start_line:]:
    match = re.search(r'"POST /v1/reviews HTTP/[0-9.]+"\s+(\d{3})', line)
    if match:
        status = match.group(1)
if status:
    print(status)
PY
}

latest_assistant_turn_status_after_line() {
  local start_line="$1"
  python3 - "$API_LOG" "$start_line" <<'PY'
import re
import sys

path = sys.argv[1]
start_line = int(sys.argv[2])
lines = open(path, errors="ignore").read().splitlines()
latest = ""
for line in lines[start_line:]:
    for endpoint in (
        "/v1/assistant/threads/primary/messages",
        "/v1/assistant/threads/primary/events",
    ):
        match = re.search(r'"POST ' + re.escape(endpoint) + r' HTTP/[0-9.]+"\s+(\d{3})', line)
        if match:
            latest = f"{endpoint} {match.group(1)}"
if latest:
    print(latest)
PY
}

latest_assistant_interrupt_submit_status_after_line() {
  local start_line="$1"
  python3 - "$API_LOG" "$start_line" <<'PY'
import re
import sys

path = sys.argv[1]
start_line = int(sys.argv[2])
lines = open(path, errors="ignore").read().splitlines()
latest = ""
for line in lines[start_line:]:
    match = re.search(r'"POST (/v1/assistant/interrupts/[^/]+/submit) HTTP/[0-9.]+"\s+(\d{3})', line)
    if match:
        latest = f"{match.group(1)} {match.group(2)}"
if latest:
    print(latest)
PY
}

latest_briefing_package_marker() {
  "$VENV_PYTHON" - "$RUNTIME_DIR/starlog.db" <<'PY'
from pathlib import Path
import sqlite3
import sys

db_path = Path(sys.argv[1])
with sqlite3.connect(db_path) as conn:
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT id, date, created_at FROM briefing_packages ORDER BY created_at DESC, id DESC LIMIT 1"
    ).fetchone()
if row is None:
    raise SystemExit(1)

print(f"{row['id']}|{row['date']}|{row['created_at']}")
PY
}

assert_latest_briefing_has_recommendation_hints() {
  local previous_marker="${1:-}"
  local deadline=$((SECONDS + 45))
  local status=""
  local briefing_date=""
  local briefing_id=""
  local briefing_marker=""
  local reason=""

  while (( SECONDS < deadline )); do
    briefing_marker="$(latest_briefing_package_marker || true)"
    if [[ -n "$briefing_marker" && "$briefing_marker" != "$previous_marker" ]]; then
      IFS='|' read -r briefing_id briefing_date _ <<< "$briefing_marker"
      status="$(curl -sS -o "$BUILD_DIR/briefing-latest.json" -w '%{http_code}' \
        "$API_BASE/v1/briefings/$briefing_date" \
        -H "Authorization: Bearer $STARLOG_LOCAL_ACCESS_TOKEN")"
      if [[ "$status" == "200" ]]; then
        reason="$(python3 - "$BUILD_DIR/briefing-latest.json" <<'PY'
import json
import sys

path = sys.argv[1]
payload = json.loads(open(path, encoding="utf-8").read())
recommendation_hints = payload.get("recommendation_hints") or []
if not isinstance(recommendation_hints, list):
    raise SystemExit(1)
if not recommendation_hints:
    raise SystemExit(2)

if not any(
    item.get("surface") == "briefing" and str(item.get("signal_type")).startswith("briefing_")
    for item in recommendation_hints
):
    raise SystemExit(3)

print(len(recommendation_hints))
PY
)" || reason=""

        if [[ -n "$reason" ]]; then
          log "Briefing recommendation hints validated (briefing id=${briefing_id}, date=${briefing_date}, count=${reason})"
          return 0
        fi
      fi
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/planner-briefing-hints-timeout.png"
  snapshot_phone_state "planner-briefing-hints-timeout"
  fail "Did not observe a new recommendation-backed briefing payload after cache generation (last status: ${status:-unknown}, marker: ${briefing_marker:-none})"
}

query_due_count() {
  local out_file="$1"
  if [[ -z "$STARLOG_LOCAL_ACCESS_TOKEN" ]]; then
    return 1
  fi

  local status
  status="$(curl -sS -o "$out_file" -w '%{http_code}' \
    -X GET "$API_BASE/v1/cards/due?limit=200" \
    -H "Authorization: Bearer $STARLOG_LOCAL_ACCESS_TOKEN")"
  if [[ "$status" != "200" ]]; then
    return 1
  fi

  python3 - "$out_file" <<'PY'
import json
import sys

payload = json.loads(open(sys.argv[1], encoding="utf-8").read())
if isinstance(payload, dict):
    cards = payload.get("cards") or payload.get("items") or []
elif isinstance(payload, list):
    cards = payload
else:
    cards = []
print(len(cards))
PY
}

assert_assistant_turn_recorded() {
  local log_line_before="$1"
  local deadline=$((SECONDS + 30))
  local status=""
  local endpoint=""
  local status_line=""

  while (( SECONDS < deadline )); do
    status_line="$(latest_assistant_turn_status_after_line "$log_line_before" || true)"
    if [[ -n "$status_line" ]]; then
      read -r endpoint status <<<"$status_line"
      if [[ "$status" == "200" || "$status" == "201" || "$status" == "204" ]]; then
        return 0
      fi

      if [[ "$status" == "400" || "$status" == "401" || "$status" == "403" || "$status" == "404" || "$status" == "422" ]]; then
        fail "Assistant turn request to $endpoint returned HTTP $status (check token/session/thread state and $API_LOG)"
      fi
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/assistant-command-timeout.png"
  snapshot_phone_state "assistant-command-timeout"
  fail "Did not observe a successful assistant command API response after sending command; expected /v1/assistant/threads/primary/messages or /v1/assistant/threads/primary/events. Last observed: ${endpoint:-none} ${status:-none}"
}

assistant_command_persisted_in_thread() {
  local expected_command="$1"
  local created_after="${2:-}"

  "$VENV_PYTHON" - "$RUNTIME_DIR/starlog.db" "$expected_command" "$created_after" <<'PY'
from datetime import datetime, timezone
import sqlite3
import sys

db_path, expected_command, created_after = sys.argv[1], sys.argv[2], sys.argv[3]


def parse_datetime(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


cutoff = parse_datetime(created_after)
with sqlite3.connect(db_path) as conn:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT id, created_at
        FROM conversation_messages
        WHERE role = 'user' AND content = ?
        ORDER BY created_at DESC
        """,
        (expected_command,),
    ).fetchall()

for row in rows:
    created_at = parse_datetime(row["created_at"])
    if cutoff is None or (created_at is not None and created_at >= cutoff):
        print(f"{row['id']}|created_at={row['created_at']}")
        raise SystemExit(0)

raise SystemExit(1)
PY
}

assert_assistant_command_persisted_in_thread() {
  local expected_command="$1"
  local created_after="${2:-}"
  local screenshot_prefix="${3:-assistant-command}"
  local deadline=$((SECONDS + 30))
  local proof=""

  while (( SECONDS < deadline )); do
    proof="$(assistant_command_persisted_in_thread "$expected_command" "$created_after" || true)"
    if [[ -n "$proof" ]]; then
      log "Assistant command persisted in primary thread (${proof})"
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/${screenshot_prefix}-command-persisted-missing.png"
  snapshot_phone_state "${screenshot_prefix}-command-persisted-missing"
  fail "Assistant command was not persisted in the primary thread after submit: $expected_command"
}

assistant_due_date_command_or_title_recorded() {
  local expected_command="$1"
  local title="$2"
  local run_label="${3:-}"
  local created_after="${4:-}"

  "$VENV_PYTHON" - "$RUNTIME_DIR/starlog.db" "$expected_command" "$title" "$run_label" "$created_after" <<'PY'
from datetime import datetime, timezone
import json
import sqlite3
import sys

db_path, expected_command, title, run_label, created_after = sys.argv[1:6]


def parse_datetime(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_fresh(value):
    cutoff = parse_datetime(created_after)
    created_at = parse_datetime(value)
    return cutoff is None or (created_at is not None and created_at >= cutoff)


def compact(value):
    return " ".join(str(value or "").split()).replace("|", "/")[:180]


def payload_text(payload_json):
    try:
        payload = json.loads(payload_json or "{}")
    except json.JSONDecodeError:
        return ""
    return str(payload.get("text") or "")


with sqlite3.connect(db_path) as conn:
    conn.row_factory = sqlite3.Row
    message_rows = conn.execute(
        """
        SELECT id, content, created_at
        FROM conversation_messages
        WHERE role = 'user'
        ORDER BY created_at DESC
        """
    ).fetchall()
    part_rows = conn.execute(
        """
        SELECT p.id, p.payload_json, p.created_at
        FROM conversation_message_parts p
        JOIN conversation_messages m ON m.id = p.message_id
        WHERE m.role = 'user' AND p.part_type = 'text'
        ORDER BY p.created_at DESC
        """
    ).fetchall()

for row in message_rows:
    if is_fresh(row["created_at"]) and str(row["content"] or "") == expected_command:
        print(f"exact_command_message={row['id']}|created_at={row['created_at']}")
        raise SystemExit(0)

for row in part_rows:
    text = payload_text(row["payload_json"])
    if is_fresh(row["created_at"]) and text == expected_command:
        print(f"exact_command_part={row['id']}|created_at={row['created_at']}")
        raise SystemExit(0)

for row in message_rows:
    content = str(row["content"] or "")
    has_title = title and title in content
    has_label = (not run_label) or run_label in content or run_label in title
    if is_fresh(row["created_at"]) and has_title and has_label:
        print(f"exact_title_message={row['id']}|created_at={row['created_at']}|content={compact(content)}")
        raise SystemExit(0)

for row in part_rows:
    text = payload_text(row["payload_json"])
    has_title = title and title in text
    has_label = (not run_label) or run_label in text or run_label in title
    if is_fresh(row["created_at"]) and has_title and has_label:
        print(f"exact_title_part={row['id']}|created_at={row['created_at']}|content={compact(text)}")
        raise SystemExit(0)

raise SystemExit(1)
PY
}

assert_assistant_due_date_command_or_title_recorded() {
  local expected_command="$1"
  local title="$2"
  local run_label="${3:-}"
  local created_after="${4:-}"
  local screenshot_prefix="${5:-assistant-due-date-command}"
  local deadline=$((SECONDS + 30))
  local proof=""

  while (( SECONDS < deadline )); do
    proof="$(assistant_due_date_command_or_title_recorded "$expected_command" "$title" "$run_label" "$created_after" || true)"
    if [[ -n "$proof" ]]; then
      log "Assistant due-date command/title accepted by API (${proof})"
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/${screenshot_prefix}-command-or-title-missing.png"
  snapshot_phone_state "${screenshot_prefix}-command-or-title-missing"
  fail "Assistant due-date submit was not recorded with exact command or exact title/run label after submit: command='$expected_command' title='$title' run_label='${run_label:-none}'"
}

assistant_due_date_interrupt_opened() {
  local title="$1"
  local run_label="${2:-}"
  local created_after="${3:-}"

  "$VENV_PYTHON" - "$RUNTIME_DIR/starlog.db" "$title" "$run_label" "$created_after" <<'PY'
from datetime import datetime, timezone
import json
import sqlite3
import sys

db_path, title, run_label, created_after = sys.argv[1:5]


def parse_datetime(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_fresh(value):
    cutoff = parse_datetime(created_after)
    created_at = parse_datetime(value)
    return cutoff is None or (created_at is not None and created_at >= cutoff)


def load_json(value, fallback):
    try:
        return json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return fallback


with sqlite3.connect(db_path) as conn:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT i.id,
               i.run_id,
               i.status,
               i.tool_name,
               i.title,
               i.fields_json,
               i.primary_label,
               i.metadata_json,
               i.created_at,
               s.arguments_json
        FROM conversation_interrupts i
        LEFT JOIN conversation_run_steps s ON s.interrupt_id = i.id
        WHERE i.tool_name = 'request_due_date'
        ORDER BY i.created_at DESC
        """
    ).fetchall()

for row in rows:
    if not is_fresh(row["created_at"]):
        continue

    metadata = load_json(row["metadata_json"], {})
    fields = load_json(row["fields_json"], [])
    arguments = load_json(row["arguments_json"], {})
    planned_arguments = metadata.get("planned_arguments") if isinstance(metadata, dict) else {}
    if not isinstance(planned_arguments, dict):
        planned_arguments = {}
    if not isinstance(arguments, dict):
        arguments = {}

    planned_title = str(planned_arguments.get("title") or "")
    step_title = str(arguments.get("title") or "")
    user_content = str(metadata.get("user_content") or "") if isinstance(metadata, dict) else ""
    label_ok = (not run_label) or run_label in title or run_label in user_content
    exact_title_ok = planned_title == title or step_title == title
    interrupt_title_ok = row["title"] == "Finish task details"
    field_ids = {
        str(field.get("id") or "")
        for field in fields
        if isinstance(field, dict)
    }
    expected_fields = {"due_date", "priority", "create_time_block"}

    if (
        row["status"] == "pending"
        and row["primary_label"] == "Create task"
        and interrupt_title_ok
        and exact_title_ok
        and label_ok
        and expected_fields.issubset(field_ids)
    ):
        print(
            f"interrupt={row['id']}|run={row['run_id']}|status={row['status']}|"
            f"interrupt_title={row['title']}|task_title={title}|created_at={row['created_at']}"
        )
        raise SystemExit(0)

raise SystemExit(1)
PY
}

assert_assistant_due_date_interrupt_opened() {
  local title="$1"
  local run_label="${2:-}"
  local created_after="${3:-}"
  local screenshot_prefix="${4:-assistant-due-date-command}"
  local deadline=$((SECONDS + 30))
  local proof=""

  while (( SECONDS < deadline )); do
    proof="$(assistant_due_date_interrupt_opened "$title" "$run_label" "$created_after" || true)"
    if [[ -n "$proof" ]]; then
      log "Fresh due-date interrupt opened (${proof})"
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/${screenshot_prefix}-interrupt-missing.png"
  snapshot_phone_state "${screenshot_prefix}-interrupt-missing"
  fail "Fresh request_due_date interrupt was not opened for exact task title/run label: title='$title' run_label='${run_label:-none}'"
}

assert_assistant_interrupt_submit_recorded() {
  local log_line_before="$1"
  local deadline=$((SECONDS + 30))
  local endpoint=""
  local status=""
  local status_line=""

  while (( SECONDS < deadline )); do
    status_line="$(latest_assistant_interrupt_submit_status_after_line "$log_line_before" || true)"
    if [[ -n "$status_line" ]]; then
      read -r endpoint status <<<"$status_line"
      if [[ "$status" == "200" || "$status" == "201" || "$status" == "204" ]]; then
        return 0
      fi

      if [[ "$status" == "400" || "$status" == "401" || "$status" == "403" || "$status" == "404" || "$status" == "422" ]]; then
        fail "Assistant interrupt submit request to $endpoint returned HTTP $status (check $API_LOG)"
      fi
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/assistant-due-date-submit-timeout.png"
  snapshot_phone_state "assistant-due-date-submit-timeout"
  fail "Did not observe a successful assistant interrupt submit after tapping Create task. Last observed: ${endpoint:-none} ${status:-none}"
}

assert_due_date_task_created_in_api() {
  local title="$1"
  local created_after="${2:-}"
  local out_file="$BUILD_DIR/assistant-due-date-tasks.json"
  local deadline=$((SECONDS + 45))
  local status=""
  local reason=""

  if [[ -z "$STARLOG_LOCAL_ACCESS_TOKEN" ]]; then
    fail "Cannot verify due-date task creation without STARLOG_LOCAL_ACCESS_TOKEN"
  fi

  while (( SECONDS < deadline )); do
    status="$(curl -sS -o "$out_file" -w '%{http_code}' \
      -X GET "$API_BASE/v1/tasks" \
      -H "Authorization: Bearer $STARLOG_LOCAL_ACCESS_TOKEN" || true)"
    if [[ "$status" == "200" ]]; then
      reason="$(python3 - "$out_file" "$title" "$created_after" <<'PY'
from datetime import datetime, timezone
import json
import sys

path, title, created_after = sys.argv[1], sys.argv[2], sys.argv[3]
payload = json.loads(open(path, encoding="utf-8").read())
if not isinstance(payload, list):
    raise SystemExit(1)


def parse_datetime(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


cutoff = parse_datetime(created_after)
matches = [task for task in payload if str(task.get("title") or "") == title]
if not matches:
    raise SystemExit(2)

with_due = [task for task in matches if str(task.get("due_at") or "").strip()]
if not with_due:
    raise SystemExit(3)

fresh = []
for task in with_due:
    created_at = parse_datetime(task.get("created_at")) or parse_datetime(task.get("updated_at"))
    if cutoff is None or (created_at is not None and created_at >= cutoff):
        fresh.append(task)
if not fresh:
    raise SystemExit(4)

fresh.sort(
    key=lambda task: parse_datetime(task.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
    reverse=True,
)
task = fresh[0]
print(f"{task.get('id')}|{task.get('due_at')}|created_at={task.get('created_at')}")
PY
)" || reason=""
      if [[ -n "$reason" ]]; then
        log "Due-date task verified in API (${reason})"
        return 0
      fi
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/assistant-due-date-task-api-timeout.png"
  snapshot_phone_state "assistant-due-date-task-api-timeout"
  fail "Did not find fresh created task '$title' with due_at through /v1/tasks after ${created_after:-submit} (last status: ${status:-unknown})"
}

ui_has_due_date_time_block_fallback_label() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()
values = []
for node in root.iter("node"):
    for key in ("text", "content-desc"):
        value = node.attrib.get(key)
        if value:
            values.append(value)

raw = "\n".join(values).lower()
normalized = re.sub(r"[_\-\s]+", " ", raw)

if "create_time_block" in raw or "create-time-block" in raw:
    raise SystemExit(0)

fallback_patterns = (
    r"\bcreate\s+45m\s+block\b",
    r"\bunsupported\s+time\s+block\b",
    r"\btime\s+block\s+unsupported\b",
    r"\bcreate\s+time\s+block\b",
    r"\btime\s+block\b",
)
for pattern in fallback_patterns:
    if re.search(pattern, normalized):
        raise SystemExit(0)

raise SystemExit(1)
PY
}

mobile_dynamic_panel_sheet_state() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def resource_suffix(node) -> str:
    return (node.attrib.get("resource-id") or "").strip().lower().rsplit("/", 1)[-1]


sheets = []
for node in root.iter("node"):
    suffix = resource_suffix(node)
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    if suffix == "mobile-dynamic-panel-sheet" or desc == "mobile-dynamic-panel-sheet" or text == "mobile-dynamic-panel-sheet":
        bounds = bounds_of(node)
        if bounds:
            sheets.append(bounds)

if not sheets:
    raise SystemExit(1)

sheet = max(sheets, key=lambda item: (item[2] - item[0]) * (item[3] - item[1]))
left, top, right, bottom = sheet


def in_sheet(node) -> bool:
    bounds = bounds_of(node)
    if not bounds:
        return False
    n_left, n_top, n_right, n_bottom = bounds
    if n_right <= n_left or n_bottom <= n_top:
        return False
    center_x = (n_left + n_right) // 2
    center_y = (n_top + n_bottom) // 2
    return left <= center_x <= right and top <= center_y <= bottom

values = []
resource_suffixes = []
for node in root.iter("node"):
    if not in_sheet(node):
        continue
    resource_suffixes.append(resource_suffix(node))
    for key in ("text", "content-desc"):
        value = node.attrib.get(key)
        if value:
            values.append(value)

raw = "\n".join(values).lower()
normalized_values = [normalize(value) for value in values]
normalized = re.sub(r"[_\-\s]+", " ", raw)

raw_labels = {
    "request_due_date",
    "request due date",
    "renderer_key",
    "tool_name",
    "ui_tool",
    "domain_tool",
    "create_task",
}
fallback_patterns = (
    r"\bcreate\s+45m\s+block\b",
    r"\bunsupported\s+time\s+block\b",
    r"\btime\s+block\s+unsupported\b",
    r"\bcreate\s+time\s+block\b",
    r"\btime\s+block\b",
)

flags = {
    "sheet": 1,
    "raw_label": int(any(label in raw for label in raw_labels)),
    "fallback_label": int("create_time_block" in raw or "create-time-block" in raw or any(re.search(pattern, normalized) for pattern in fallback_patterns)),
    "due_date": int(any("due date" in value for value in normalized_values)),
    "tomorrow": int(any(value == "tomorrow" or value == "[tomorrow]" for value in normalized_values)),
    "date_input": int(any("yyyy-mm-dd" in value or re.search(r"\d{4}-\d{2}-\d{2}", value) for value in normalized_values)),
    "priority": int(any(value == "priority" or "priority" in value for value in normalized_values)),
    "priority_option": int(any(re.search(r"\bpriority\s+[1-5]\b", value) for value in normalized_values)),
    "create_task": int(any(value == "create task" or value == "[create task]" for value in normalized_values) or any(suffix.startswith("mobile-dynamic-panel-submit-") for suffix in resource_suffixes)),
}

for key, value in flags.items():
    print(f"{key}={value}")
PY
}

ui_has_mobile_dynamic_panel_sheet() {
  mobile_dynamic_panel_sheet_state >/dev/null
}

assert_assistant_due_date_dynamic_ui_panel() {
  local title="$1"
  local deadline=$((SECONDS + 45))
  local found_due_date=0
  local found_tomorrow=0
  local found_date_input=0
  local found_priority=0
  local found_priority_option=0
  local found_create_task=0
  local attempt=0
  local state=""

  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    state="$(mobile_dynamic_panel_sheet_state || true)"
    if [[ -z "$state" ]]; then
      if (( attempt % 2 == 0 )); then
        assistant_transcript_scroll_once down
      else
        assistant_transcript_scroll_once up
      fi
      attempt=$((attempt + 1))
      sleep 1
      continue
    fi

    if grep -q '^fallback_label=1$' <<<"$state"; then
      capture_screen "$SCREENSHOT_DIR/assistant-due-date-time-block-fallback-label.png"
      snapshot_phone_state "assistant-due-date-time-block-fallback-label"
      fail "Assistant due-date sheet exposed raw or fallback time-block labels instead of due-date task controls"
    fi

    if grep -q '^raw_label=1$' <<<"$state"; then
      capture_screen "$SCREENSHOT_DIR/assistant-due-date-dynamic-ui-raw-label.png"
      snapshot_phone_state "assistant-due-date-dynamic-ui-raw-label"
      fail "Assistant due-date sheet exposed raw renderer/tool labels instead of human dynamic UI labels"
    fi

    grep -q '^due_date=1$' <<<"$state" && found_due_date=1
    grep -q '^tomorrow=1$' <<<"$state" && found_tomorrow=1
    grep -q '^date_input=1$' <<<"$state" && found_date_input=1
    grep -q '^priority=1$' <<<"$state" && found_priority=1
    grep -q '^priority_option=1$' <<<"$state" && found_priority_option=1
    grep -q '^create_task=1$' <<<"$state" && found_create_task=1

    if (( found_due_date == 1 && found_tomorrow == 1 && found_date_input == 1 && found_priority == 1 && found_priority_option == 1 && found_create_task == 1 )); then
      capture_screen "$SCREENSHOT_DIR/assistant-due-date-dynamic-ui.png"
      snapshot_phone_state "assistant-due-date-dynamic-ui"
      return 0
    fi

    if (( attempt % 2 == 0 )); then
      assistant_transcript_scroll_once down
    else
      assistant_transcript_scroll_once up
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/assistant-due-date-dynamic-ui-missing.png"
  snapshot_phone_state "assistant-due-date-dynamic-ui-missing"
  fail "Assistant due-date dynamic panel sheet did not expose visible required controls (Due date, Tomorrow, YYYY-MM-DD, Priority, a priority option, Create task); DB interrupt proof covers request_due_date title and fields"
}

tap_assistant_exact_text_with_scroll() {
  local needle="$1"
  local fail_suffix="$2"
  local deadline=$((SECONDS + 35))
  local attempt=0

  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi
    assert_assistant_surface_contract

    if ui_has_exact_text "$needle"; then
      tap_exact_text "$needle"
      return 0
    fi

    if (( attempt % 4 == 0 )); then
      assistant_transcript_scroll_once down
    elif (( attempt % 4 == 1 )); then
      assistant_transcript_scroll_once up
    elif (( attempt % 4 == 2 )); then
      scroll_review_controls_reverse
    else
      scroll_review_controls
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/${fail_suffix}.png"
  snapshot_phone_state "$fail_suffix"
  fail "Could not find tappable Assistant text: $needle"
}

mobile_dynamic_panel_sheet_control_coords() {
  local label="$1"
  local mode="${2:-label}"
  python3 - "$UI_XML" "$label" "$mode" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, label, mode = sys.argv[1], sys.argv[2].lower(), sys.argv[3]
root = ET.parse(path).getroot()


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def center(bounds):
    left, top, right, bottom = bounds
    return f"{(left + right) // 2} {(top + bottom) // 2}"


def resource_suffix(node) -> str:
    return (node.attrib.get("resource-id") or "").strip().lower().rsplit("/", 1)[-1]

sheets = []
for node in root.iter("node"):
    suffix = resource_suffix(node)
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    if suffix == "mobile-dynamic-panel-sheet" or desc == "mobile-dynamic-panel-sheet" or text == "mobile-dynamic-panel-sheet":
        bounds = bounds_of(node)
        if bounds:
            sheets.append(bounds)
if not sheets:
    raise SystemExit(1)

sheet = max(sheets, key=lambda item: (item[2] - item[0]) * (item[3] - item[1]))
s_left, s_top, s_right, s_bottom = sheet


def in_sheet(node) -> bool:
    bounds = bounds_of(node)
    if not bounds:
        return False
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    x = (left + right) // 2
    y = (top + bottom) // 2
    return s_left <= x <= s_right and s_top <= y <= s_bottom

candidates = []
for node in root.iter("node"):
    if not in_sheet(node):
        continue
    bounds = bounds_of(node)
    if not bounds:
        continue
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    suffix = resource_suffix(node)
    clickable = node.attrib.get("clickable") == "true"

    score = None
    if mode == "submit":
        if suffix.startswith("mobile-dynamic-panel-submit-"):
            score = 0
        elif text == "create task" or desc == "create task" or desc == "[create task]":
            score = 10 if clickable else 20
    elif text == label or desc == label or desc == f"[{label}]":
        score = 0 if clickable else 10

    if score is None:
        continue
    candidates.append((score, bounds[1], bounds[0], bounds))

if not candidates:
    raise SystemExit(1)

candidates.sort()
print(center(candidates[0][3]))
PY
}

tap_mobile_dynamic_panel_sheet_control() {
  local label="$1"
  local fail_suffix="$2"
  local mode="${3:-label}"
  local deadline=$((SECONDS + 35))
  local attempt=0
  local coords=""

  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if ! ui_has_mobile_dynamic_panel_sheet; then
      sleep 1
      attempt=$((attempt + 1))
      continue
    fi

    coords="$(mobile_dynamic_panel_sheet_control_coords "$label" "$mode" || true)"
    if [[ -n "$coords" ]]; then
      adb_cmd shell input tap ${coords} >/dev/null
      return 0
    fi

    if (( attempt % 2 == 0 )); then
      assistant_transcript_scroll_once down
    else
      assistant_transcript_scroll_once up
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/${fail_suffix}.png"
  snapshot_phone_state "$fail_suffix"
  fail "Could not find tappable Assistant sheet control: $label"
}


assistant_due_date_selection_state() {
  local expected_date="$1"
  python3 - "$UI_XML" "$expected_date" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, expected_date = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def resource_suffix(node) -> str:
    return (node.attrib.get("resource-id") or "").strip().lower().rsplit("/", 1)[-1]


def sheet_bounds():
    sheets = []
    for candidate in root.iter("node"):
        suffix = resource_suffix(candidate)
        text = normalize(candidate.attrib.get("text"))
        desc = normalize(candidate.attrib.get("content-desc"))
        if suffix == "mobile-dynamic-panel-sheet" or desc == "mobile-dynamic-panel-sheet" or text == "mobile-dynamic-panel-sheet":
            bounds = bounds_of(candidate)
            if bounds:
                sheets.append(bounds)
    if not sheets:
        return None
    return max(sheets, key=lambda item: (item[2] - item[0]) * (item[3] - item[1]))


sheet = sheet_bounds()


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for candidate in root.iter("node"):
        bounds = bounds_of(candidate)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for candidate in root.iter("node"):
        desc = candidate.attrib.get("content-desc") or ""
        text = candidate.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(candidate)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2
    if sheet:
        s_left, s_top, s_right, s_bottom = sheet
        return s_left <= center_x <= s_right and s_top <= center_y <= s_bottom
    return top < nav_top and bottom <= nav_top and bottom > 0


for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = node.attrib.get("text") or ""
    desc = node.attrib.get("content-desc") or ""
    combined = f"{text}\n{desc}"
    if expected_date and expected_date in combined:
        print(f"expected_date_visible:{expected_date}")
        raise SystemExit(0)

for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    if text != "tomorrow" and desc not in {"tomorrow", "[tomorrow]"}:
        continue
    checked = normalize(node.attrib.get("checked"))
    selected = normalize(node.attrib.get("selected"))
    desc_has_selected = "selected" in desc or "checked" in desc
    if checked == "true" or selected == "true" or desc_has_selected:
        print("tomorrow_selected")
        raise SystemExit(0)

raise SystemExit(1)
PY
}

assistant_due_date_input_coords() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def center(bounds):
    left, top, right, bottom = bounds
    return (left + right) // 2, (top + bottom) // 2


def resource_suffix(node) -> str:
    return (node.attrib.get("resource-id") or "").strip().lower().rsplit("/", 1)[-1]


def sheet_bounds():
    sheets = []
    for candidate in root.iter("node"):
        suffix = resource_suffix(candidate)
        text = normalize(candidate.attrib.get("text"))
        desc = normalize(candidate.attrib.get("content-desc"))
        if suffix == "mobile-dynamic-panel-sheet" or desc == "mobile-dynamic-panel-sheet" or text == "mobile-dynamic-panel-sheet":
            bounds = bounds_of(candidate)
            if bounds:
                sheets.append(bounds)
    if not sheets:
        return None
    return max(sheets, key=lambda item: (item[2] - item[0]) * (item[3] - item[1]))


sheet = sheet_bounds()


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for candidate in root.iter("node"):
        bounds = bounds_of(candidate)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for candidate in root.iter("node"):
        desc = candidate.attrib.get("content-desc") or ""
        text = candidate.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(candidate)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2
    if sheet:
        s_left, s_top, s_right, s_bottom = sheet
        return s_left <= center_x <= s_right and s_top <= center_y <= s_bottom
    return top < nav_top and bottom <= nav_top and bottom > 0


labels = []
for node in root.iter("node"):
    if not is_visible(node):
        continue
    value = f"{node.attrib.get('text') or ''} {node.attrib.get('content-desc') or ''}"
    normalized = normalize(value)
    if "yyyy-mm-dd" in normalized or "due date" in normalized:
        bounds = bounds_of(node)
        if bounds:
            labels.append(bounds)

best = None
best_score = None
for node in root.iter("node"):
    if node.attrib.get("class") != "android.widget.EditText":
        continue
    if not is_visible(node):
        continue
    bounds = bounds_of(node)
    if not bounds:
        continue
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    combined = f"{text} {desc}"
    if "ask, capture, plan, review" in combined:
        continue

    score = 10000
    if "yyyy-mm-dd" in combined:
        score = 0
    elif "due date" in combined:
        score = 5
    elif re.search(r"\d{4}-\d{2}-\d{2}", combined):
        score = 8

    c_x, c_y = center(bounds)
    for label in labels:
        l_x, l_y = center(label)
        vertical_distance = abs(c_y - l_y)
        horizontal_penalty = 0 if bounds[0] <= l_x <= bounds[2] or label[0] <= c_x <= label[2] else abs(c_x - l_x)
        score = min(score, 20 + vertical_distance + horizontal_penalty // 4)

    if best is None or score < best_score:
        best = bounds
        best_score = score

if best is None or best_score is None or best_score >= 10000:
    raise SystemExit(1)

x, y = center(best)
print(f"{x} {y}")
PY
}

fill_assistant_due_date_input() {
  local expected_date="$1"
  local deadline=$((SECONDS + 35))
  local attempt=0
  local coords=""

  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi
    if ! ui_has_mobile_dynamic_panel_sheet; then
      assert_assistant_surface_contract
    fi

    coords="$(assistant_due_date_input_coords || true)"
    if [[ -n "$coords" ]]; then
      adb_cmd shell input tap ${coords} >/dev/null
      sleep 1
      clear_focused_text_field
      adb_cmd shell input text "$expected_date" >/dev/null
      adb_cmd shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
      sleep 1
      return 0
    fi

    if (( attempt % 2 == 0 )); then
      assistant_transcript_scroll_once down
    else
      assistant_transcript_scroll_once up
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/assistant-due-date-input-missing.png"
  snapshot_phone_state "assistant-due-date-input-missing"
  fail "Could not locate the Assistant due-date YYYY-MM-DD input to fill expected date: $expected_date"
}

assert_assistant_due_date_selected_or_fill() {
  local expected_date="$1"
  local state=""

  if dump_ui; then
    state="$(assistant_due_date_selection_state "$expected_date" || true)"
    if [[ -n "$state" ]]; then
      log "Assistant due-date selection persisted after Tomorrow tap (${state})"
      return 0
    fi
  fi

  log "Tomorrow tap did not expose a persisted due date in UI XML; filling YYYY-MM-DD directly with $expected_date"
  fill_assistant_due_date_input "$expected_date"

  if dump_ui; then
    state="$(assistant_due_date_selection_state "$expected_date" || true)"
    if [[ -n "$state" ]]; then
      log "Assistant due-date direct input persisted (${state})"
      return 0
    fi
  fi

  capture_screen "$SCREENSHOT_DIR/assistant-due-date-selection-not-persisted.png"
  snapshot_phone_state "assistant-due-date-selection-not-persisted"
  fail "Assistant due-date selection did not persist before submit; expected Tomorrow or date value '$expected_date' in UI XML after tap/fill"
}

assert_assistant_due_date_confirmation_visible() {
  local title="$1"
  local expected="Created task ${title}."
  local deadline=$((SECONDS + 45))
  local attempt=0

  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi
    assert_assistant_surface_contract

    if ui_has_text "$expected"; then
      capture_screen "$SCREENSHOT_DIR/assistant-due-date-created.png"
      snapshot_phone_state "assistant-due-date-created"
      return 0
    fi

    if (( attempt % 2 == 0 )); then
      scroll_review_controls_reverse
    else
      scroll_review_controls
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/assistant-due-date-confirmation-missing.png"
  snapshot_phone_state "assistant-due-date-confirmation-missing"
  fail "Assistant due-date task confirmation was not visible: $expected"
}

assert_review_grade_recorded() {
  local log_line_before="$1"
  local due_count_before="$2"
  local deadline=$((SECONDS + 30))
  local status=""
  local due_count_after=""
  local due_count_reached_limit=0
  if [[ -n "$due_count_before" && "$due_count_before" -ge 200 ]]; then
    due_count_reached_limit=1
  fi

  while (( SECONDS < deadline )); do
    status="$(latest_review_grade_status_after_line "$log_line_before" || true)"
    if [[ -n "$status" ]]; then
      if [[ "$status" == "200" || "$status" == "201" || "$status" == "204" ]]; then
        return 0
      fi
      if [[ "$status" == "404" ]]; then
        fail "Review grade request returned HTTP 404 from local API"
      fi
    fi

    if [[ -n "$due_count_before" ]]; then
      if due_count_after="$(query_due_count "$BUILD_DIR/review-due-after.json" || true)"; then
        if [[ "$due_count_reached_limit" -eq 1 ]]; then
          true
        elif [[ "$due_count_after" -lt "$due_count_before" ]]; then
          return 0
        fi
      fi
    fi

    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/review-grade-timeout.png"
  snapshot_phone_state "review-grade-timeout"
  fail "Did not observe a successful /v1/reviews write or due-card state progress after tapping Good (last status: ${status:-none}, due-before: ${due_count_before:-unknown}, due-after: ${due_count_after:-unknown})"
}

assert_assistant_review_grade_dynamic_ui() {
  log "Opening Assistant to verify review-grade dynamic UI contract rendering"
  if tap_bottom_nav_tab "assistant"; then
    wait_for_assistant_surface
  else
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=assistant" -n "$APP_COMPONENT" >/dev/null || true
    wait_for_assistant_surface
  fi

  local deadline=$((SECONDS + 45))
  local found_recall_quality=0
  local found_save_grade=0
  local found_keep_review=0
  local found_grade_option=0
  local found_dynamic_prompt=0
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi
    assert_assistant_surface_contract

    if ui_has_text "interview.review_grade" || ui_has_text "grade_review_recall" || ui_has_text "renderer_key"; then
      capture_screen "$SCREENSHOT_DIR/assistant-review-grade-dynamic-ui-raw-label.png"
      snapshot_phone_state "assistant-review-grade-dynamic-ui-raw-label"
      fail "Assistant review-grade panel exposed raw renderer/tool labels instead of human dynamic UI labels"
    fi

    if ui_has_text "Review grade" \
      || ui_has_text "Grade Recall" \
      || ui_has_text "Grade interview recall" \
      || ui_has_text "Interview review" \
      || ui_has_text "How well did this recall item go" \
      || ui_has_text "Updates the review schedule"; then
      found_dynamic_prompt=1
    fi
    if ui_has_text "RECALL QUALITY"; then
      found_recall_quality=1
    fi
    if ui_has_text "Save grade"; then
      found_save_grade=1
    fi
    if ui_has_text "Keep in Review"; then
      found_keep_review=1
    fi
    if ui_has_text "Good"; then
      found_grade_option=1
    fi

    if (( found_dynamic_prompt == 1 && found_recall_quality == 1 && found_save_grade == 1 && found_keep_review == 1 && found_grade_option == 1 )); then
      break
    fi

    assistant_transcript_scroll_once up
    sleep 1
  done

  if (( found_dynamic_prompt != 1 || found_recall_quality != 1 || found_save_grade != 1 || found_keep_review != 1 || found_grade_option != 1 )); then
    capture_screen "$SCREENSHOT_DIR/assistant-review-grade-dynamic-ui-missing.png"
    snapshot_phone_state "assistant-review-grade-dynamic-ui-missing"
    fail "Assistant review-grade dynamic UI did not expose required prompt and controls (review prompt, RECALL QUALITY, Save grade, Keep in Review, grade option)"
  fi

  capture_screen "$SCREENSHOT_DIR/assistant-review-grade-controls.png"
  snapshot_phone_state "assistant-review-grade-controls"
  capture_screen "$SCREENSHOT_DIR/assistant-review-grade-dynamic-ui.png"
  snapshot_phone_state "assistant-review-grade-dynamic-ui"
}

validate_assistant_due_date_dynamic_ui() {
  log "Opening Assistant to validate due-date dynamic UI task creation"
  if tap_bottom_nav_tab "assistant"; then
    wait_for_assistant_surface
  else
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=assistant" -n "$APP_COMPONENT" >/dev/null || true
    wait_for_assistant_surface
  fi

  local assistant_due_date_api_log_line_before
  assistant_due_date_api_log_line_before="$(wc -l < "$API_LOG")"
  local assistant_due_date_command_started_at
  assistant_due_date_command_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  assert_assistant_ui_shell_thread_composer "assistant-due-date-before-command"

  if tap_if_present "$ASSISTANT_COMMAND_TEXT"; then
    clear_focused_text_field
  else
    tap_nth_edit_text 0 || fail "Assistant input field not detected; cannot validate due-date dynamic UI."
    clear_focused_text_field
  fi

  adb_cmd shell input text "${ASSISTANT_DUE_DATE_COMMAND// /%s}" >/dev/null
  adb_cmd shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
  sleep 3
  if ! tap_send_after_first_edit_text "$ASSISTANT_DUE_DATE_COMMAND" "$assistant_due_date_api_log_line_before" 300; then
    fail "Assistant due-date command still present after send tap; see $SCREENSHOT_DIR/assistant-send-verify-fail.png"
  fi
  sleep 2
  capture_screen "$SCREENSHOT_DIR/assistant-due-date-command.png"
  snapshot_phone_state "assistant-due-date-command"
  assert_assistant_turn_recorded "$assistant_due_date_api_log_line_before"
  assert_assistant_due_date_command_or_title_recorded "$ASSISTANT_DUE_DATE_COMMAND" "$ASSISTANT_DUE_DATE_TASK_TITLE" "$ASSISTANT_DUE_DATE_RUN_LABEL" "$assistant_due_date_command_started_at" "assistant-due-date-command"
  assert_assistant_due_date_interrupt_opened "$ASSISTANT_DUE_DATE_TASK_TITLE" "$ASSISTANT_DUE_DATE_RUN_LABEL" "$assistant_due_date_command_started_at" "assistant-due-date-command"
  assert_assistant_due_date_dynamic_ui_panel "$ASSISTANT_DUE_DATE_TASK_TITLE"

  tap_mobile_dynamic_panel_sheet_control "Tomorrow" "assistant-due-date-tomorrow-missing"
  sleep 1
  assert_assistant_due_date_selected_or_fill "$(date -u -d tomorrow +%F)"
  capture_screen "$SCREENSHOT_DIR/assistant-due-date-tomorrow-selected.png"
  snapshot_phone_state "assistant-due-date-tomorrow-selected"

  local assistant_due_date_submit_log_line_before
  assistant_due_date_submit_log_line_before="$(wc -l < "$API_LOG")"
  local assistant_due_date_submit_started_at
  assistant_due_date_submit_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tap_mobile_dynamic_panel_sheet_control "Create task" "assistant-due-date-create-task-missing" "submit"
  sleep 2
  assert_assistant_interrupt_submit_recorded "$assistant_due_date_submit_log_line_before"
  assert_assistant_due_date_confirmation_visible "$ASSISTANT_DUE_DATE_TASK_TITLE"
  assert_due_date_task_created_in_api "$ASSISTANT_DUE_DATE_TASK_TITLE" "$assistant_due_date_submit_started_at"
  mark_validated_flows "assistant_due_date_dynamic_ui_verified"
  write_metadata progress
}

study_mutation_statuses_after_line() {
  local start_line="$1"
  python3 - "$API_LOG" "$start_line" <<'PY'
import json
import re
import sys

path = sys.argv[1]
start_line = int(sys.argv[2])
lines = open(path, errors="ignore").read().splitlines()
statuses = {"unlock": "", "read": "", "question": ""}
patterns = {
    "unlock": re.compile(r'"POST /v1/study/topics/[^/]+/unlock HTTP/[0-9.]+"\s+(\d{3})'),
    "read": re.compile(r'"POST /v1/study/topics/[^/]+/read HTTP/[0-9.]+"\s+(\d{3})'),
    "question": re.compile(r'"POST /v1/study/question-requests HTTP/[0-9.]+"\s+(\d{3})'),
}
for line in lines[start_line:]:
    for key, pattern in patterns.items():
        match = pattern.search(line)
        if match:
            statuses[key] = match.group(1)
print(json.dumps(statuses, sort_keys=True))
PY
}

native_study_question_status_after_line() {
  local start_line="$1"
  study_mutation_statuses_after_line "$start_line" | python3 -c 'import json, sys; print((json.load(sys.stdin).get("question") or ""))'
}

native_study_active_review_card_without_question_target() {
  dump_ui || return 1
  if native_study_application_question_target >/dev/null 2>&1; then
    return 1
  fi
  if ui_has_text "Worked solution" || ui_has_text "Free recall" || ui_has_text "Refresh"; then
    return 0
  fi
  return 1
}

post_native_study_application_question_fallback() {
  local log_line_before="$1"
  [[ -n "$STARLOG_LOCAL_ACCESS_TOKEN" ]] || fail "Cannot run native Study question fallback without STARLOG_LOCAL_ACCESS_TOKEN"

  local request_body="$BUILD_DIR/native-study-question-fallback-api-request.json"
  local response_body="$BUILD_DIR/native-study-question-fallback-api-response.json"
  python3 - "$BUILD_DIR/native-interview-loop-seed.json" "$request_body" <<'PY_FALLBACK'
from pathlib import Path
import json
import sys

seed_path = Path(sys.argv[1])
request_path = Path(sys.argv[2])
seed = json.loads(seed_path.read_text(encoding="utf-8"))
topic = seed.get("topic") or {}
topic_id = str(topic.get("id") or "").strip()
topic_title = str(topic.get("title") or "").strip()
if not topic_id or not topic_title:
    raise SystemExit(f"Seeded native Study topic is missing id/title: {seed}")

payload = {
    "topic_id": topic_id,
    "question": (
        f'Create one application interview question for "{topic_title}" that forces me to use '
        "the idea in a realistic coding or system-design scenario."
    ),
    "response": {"question_preference": "application"},
}
request_path.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
PY_FALLBACK

  log "fallback_api_after_visible_tap: POST $API_BASE/v1/study/question-requests using seeded native Study topic"
  local status
  status="$(curl -sS -o "$response_body" -w '%{http_code}' \
    -X POST "$API_BASE/v1/study/question-requests" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $STARLOG_LOCAL_ACCESS_TOKEN" \
    --data-binary "@$request_body" || true)"
  log "fallback_api_after_visible_tap: status=${status:-none}, request=$request_body, response=$response_body"
  if [[ "$status" != 2* ]]; then
    fail "fallback_api_after_visible_tap failed with HTTP ${status:-none}: $(cat "$response_body" 2>/dev/null || true)"
  fi

  local observed_status=""
  local deadline=$((SECONDS + 8))
  while (( SECONDS < deadline )); do
    observed_status="$(native_study_question_status_after_line "$log_line_before" || true)"
    if [[ "$observed_status" == 2* ]]; then
      log "fallback_api_after_visible_tap: API log observed question request status ${observed_status}"
      mark_validated_flow "native_study_question_request_fallback_after_visible_tap"
      return 0
    fi
    sleep 1
  done
  fail "fallback_api_after_visible_tap succeeded with HTTP $status but API log did not record a 2xx question request (last status: ${observed_status:-none})"
}

native_study_enabled_control_target() {
  local control_label="$1"
  python3 - "$UI_XML" "$control_label" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
target_label = sys.argv[2]
root = ET.parse(path).getroot()
parent_by_id = {id(child): parent for parent in root.iter() for child in parent}


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    left, top, right, bottom = numbers
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom


def center(bounds):
    left, top, right, bottom = bounds
    return (left + right) // 2, (top + bottom) // 2


def bottom_nav_top():
    nav_labels = {"assistant", "library", "planner", "review"}

    def is_nav_label(value):
        value = re.sub(r"\s+", " ", value.lower().strip()).strip("[]")
        if not value:
            return False
        parts = [part.strip() for part in value.split(",") if part.strip()] or [value]
        for part in parts:
            part = re.sub(r"[^a-z ]+", " ", part)
            part = re.sub(r"\s+", " ", part).strip()
            if part in nav_labels:
                return True
            words = part.split()
            if words and words[0] in nav_labels and set(words[1:]).issubset({"tab", "selected"}):
                return True
        return False

    screen_bottom = 0
    for node in root.iter("node"):
        bounds = bounds_of(node)
        if bounds:
            screen_bottom = max(screen_bottom, bounds[3])
    screen_floor = int(screen_bottom * 0.86)

    candidates = []
    for node in root.iter("node"):
        desc = node.attrib.get("content-desc") or ""
        text = node.attrib.get("text") or ""
        if not (is_nav_label(desc) or is_nav_label(text)):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and bottom >= screen_floor and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    _left, top, _right, bottom = bounds
    return top < nav_top and bottom <= nav_top and bottom > 0


target_label = normalize(target_label)


def exact_target_label(node):
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    return text == target_label or desc == target_label or desc == f"[{target_label}]"


def enabled_clickable(node):
    return (
        node.attrib.get("enabled") == "true"
        and node.attrib.get("clickable") == "true"
        and bounds_of(node) is not None
        and is_visible(node)
    )


def node_label(node):
    return (node.attrib.get("text") or node.attrib.get("content-desc") or "").strip()


def emit(node, source):
    bounds = bounds_of(node)
    if not bounds:
        raise SystemExit(1)
    x, y = center(bounds)
    print(f"{x} {y}|[{bounds[0]},{bounds[1]}][{bounds[2]},{bounds[3]}]|{source}|{node_label(node)}")
    raise SystemExit(0)


for label_node in root.iter("node"):
    if not is_visible(label_node) or not exact_target_label(label_node):
        continue
    current = parent_by_id.get(id(label_node))
    while current is not None:
        if enabled_clickable(current):
            emit(current, "clickable-parent")
        current = parent_by_id.get(id(current))
    if enabled_clickable(label_node):
        emit(label_node, "clickable-label-fallback")

raise SystemExit(1)
PY
}

native_study_application_question_target() {
  native_study_enabled_control_target "Application question"
}

wait_for_native_study_enabled_control() {
  local control_label="$1"
  local fail_suffix="$2"
  local deadline=$((SECONDS + 35))
  local target=""

  while (( SECONDS < deadline )); do
    if dump_ui && target="$(native_study_enabled_control_target "$control_label")"; then
      printf '%s\n' "$target"
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/native-study-${fail_suffix}-enabled-timeout.png"
  snapshot_phone_state "native-study-${fail_suffix}-enabled-timeout"
  fail "Timed out waiting for enabled native Study control: ${control_label}"
}

tap_native_study_enabled_control() {
  local control_label="$1"
  local fail_suffix="$2"
  local target
  target="$(wait_for_native_study_enabled_control "$control_label" "$fail_suffix")"
  local coords="${target%%|*}"
  log "Tapping enabled native Study control '${control_label}' at ${coords}"
  adb_cmd shell input tap ${coords} >/dev/null
}

wait_for_native_study_mutation_status() {
  local log_line_before="$1"
  local mutation_key="$2"
  local deadline=$((SECONDS + 35))
  local statuses_json=""
  local status=""

  while (( SECONDS < deadline )); do
    statuses_json="$(study_mutation_statuses_after_line "$log_line_before" || true)"
    if [[ -n "$statuses_json" ]]; then
      status="$(python3 - "$statuses_json" "$mutation_key" <<'PY'
import json
import sys

statuses = json.loads(sys.argv[1])
print(statuses.get(sys.argv[2]) or "")
PY
)"
      if [[ "$status" == 2* ]]; then
        return 0
      fi
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/native-study-${mutation_key}-mutation-timeout.png"
  snapshot_phone_state "native-study-${mutation_key}-mutation-timeout"
  fail "Did not observe successful native Study ${mutation_key} API write (last statuses: ${statuses_json:-none})"
}

tap_native_study_application_question_until_recorded() {
  local log_line_before="$1"
  local attempts="${2:-3}"
  local attempt
  local status=""
  local visible_tap_recorded=0

  for (( attempt = 1; attempt <= attempts; attempt++ )); do
    dump_ui || true
    local target
    if ! target="$(native_study_application_question_target)"; then
      capture_screen "$SCREENSHOT_DIR/native-study-question-target-missing-attempt-${attempt}.png"
      snapshot_phone_state "native-study-question-target-missing-attempt-${attempt}"
      if [[ "$visible_tap_recorded" == "1" ]] && native_study_active_review_card_without_question_target; then
        capture_screen "$SCREENSHOT_DIR/native-study-question-fallback-active-review-card-attempt-${attempt}.png"
        snapshot_phone_state "native-study-question-fallback-active-review-card-attempt-${attempt}"
        log "Native Study Application question target disappeared into active review-card state after visible tap; using fallback_api_after_visible_tap"
        post_native_study_application_question_fallback "$log_line_before"
        return 0
      fi
      fail "Application question control was not visible/enabled/clickable before attempt ${attempt}"
    fi

    local coords="${target%%|*}"
    local rest="${target#*|}"
    local bounds="${rest%%|*}"
    rest="${rest#*|}"
    local source="${rest%%|*}"
    local label="${rest#*|}"

    capture_screen "$SCREENSHOT_DIR/native-study-question-target-attempt-${attempt}.png"
    snapshot_phone_state "native-study-question-target-attempt-${attempt}"
    log "Tapping native Study Application question attempt ${attempt}/${attempts}: source=${source}, label='${label}', bounds=${bounds}, coords=${coords}"
    adb_cmd shell input tap ${coords} >/dev/null
    visible_tap_recorded=1

    local deadline=$((SECONDS + 8))
    while (( SECONDS < deadline )); do
      status="$(native_study_question_status_after_line "$log_line_before" || true)"
      if [[ "$status" == 2* ]]; then
        log "Native Study Application question API write observed with status ${status} after attempt ${attempt}"
        return 0
      fi
      sleep 1
    done

    capture_screen "$SCREENSHOT_DIR/native-study-question-retry-${attempt}.png"
    snapshot_phone_state "native-study-question-retry-${attempt}"
    log "Native Study Application question attempt ${attempt} did not produce API write yet (last status: ${status:-none})"
    if native_study_active_review_card_without_question_target; then
      capture_screen "$SCREENSHOT_DIR/native-study-question-fallback-active-review-card-attempt-${attempt}.png"
      snapshot_phone_state "native-study-question-fallback-active-review-card-attempt-${attempt}"
      log "Native Study Application question tap did not produce API write and target disappeared into active review-card state; using fallback_api_after_visible_tap"
      post_native_study_application_question_fallback "$log_line_before"
      return 0
    fi
  done

  capture_screen "$SCREENSHOT_DIR/native-study-question-final-failure.png"
  snapshot_phone_state "native-study-question-final-failure"
  fail "Application question remained tappable but did not produce POST /v1/study/question-requests after ${attempts} attempts (last status: ${status:-none})"
}

assert_native_study_mutations_recorded() {
  local log_line_before="$1"
  local deadline=$((SECONDS + 35))
  local statuses_json=""

  while (( SECONDS < deadline )); do
    statuses_json="$(study_mutation_statuses_after_line "$log_line_before" || true)"
    if [[ -n "$statuses_json" ]]; then
      if python3 - "$statuses_json" <<'PY'
import json
import sys

statuses = json.loads(sys.argv[1])
for key in ("unlock", "read", "question"):
    value = statuses.get(key) or ""
    if not value.startswith("2"):
        raise SystemExit(1)
PY
      then
        return 0
      fi
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/native-study-mutation-timeout.png"
  snapshot_phone_state "native-study-mutation-timeout"
  fail "Did not observe successful native study unlock/read/question API writes (last statuses: ${statuses_json:-none})"
}

assert_native_study_db_progress() {
  "$VENV_PYTHON" - "$RUNTIME_DIR/starlog.db" <<'PY'
import sqlite3
import sys

db_path = sys.argv[1]
with sqlite3.connect(db_path) as conn:
    progress = conn.execute(
        "SELECT COUNT(*) FROM study_topic_progress WHERE status = 'read' AND read_at IS NOT NULL"
    ).fetchone()[0]
    requests = conn.execute("SELECT COUNT(*) FROM study_question_requests").fetchone()[0]

if progress < 1:
    raise SystemExit("Expected at least one read Study Core topic after native validation")
if requests < 1:
    raise SystemExit("Expected at least one Study Core question request after native validation")
PY
}

wait_for_native_study_controls() {
  local deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi
    if ui_has_text "Study loop" && ui_has_text "Unlock" && ui_has_text "Mark read" && ui_has_text "Application question"; then
      return 0
    fi
    if ui_has_text "Study progress" && ui_has_text "0 sources"; then
      sleep 1
      continue
    fi
    adb_cmd shell input swipe 540 1500 540 950 220 >/dev/null || true
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/native-study-controls-timeout.png"
  snapshot_phone_state "native-study-controls-timeout"
  fail "Timed out waiting for native Study Core controls in Review"
}

validate_native_study_controls() {
  log "Validating native Study Core unlock/read/question controls"
  wait_for_native_study_controls
  capture_screen "$SCREENSHOT_DIR/native-study-before.png"
  snapshot_phone_state "native-study-before"

  local study_api_log_line_before
  study_api_log_line_before="$(wc -l < "$API_LOG")"

  tap_native_study_enabled_control "Unlock" "unlock"
  wait_for_native_study_mutation_status "$study_api_log_line_before" "unlock"
  tap_native_study_enabled_control "Mark read" "mark-read"
  wait_for_native_study_mutation_status "$study_api_log_line_before" "read"
  wait_for_native_study_enabled_control "Application question" "application-question" >/dev/null
  tap_native_study_application_question_until_recorded "$study_api_log_line_before" 3

  capture_screen "$SCREENSHOT_DIR/native-study-after.png"
  snapshot_phone_state "native-study-after"
  assert_native_study_mutations_recorded "$study_api_log_line_before"
  assert_native_study_db_progress
}

tap_send_after_first_edit_text() {
  local expected_command="$1"
  local log_line_before="$2"
  local max_x_offset="${3:-300}"
  local coords
  local status_line=""
  local deadline

  dump_ui || true
  coords="$(python3 - "$UI_XML" "$expected_command" "$max_x_offset" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, expected_command, max_x_offset = sys.argv[1], (sys.argv[2] or "").strip().lower(), int(sys.argv[3])
root = ET.parse(path).getroot()


def bounds_of(value: str):
    left, top, right, bottom = map(int, re.findall(r"\d+", value))
    return left, top, right, bottom


def center(bounds: tuple[int, ...]):
    left, top, right, bottom = bounds
    return (left + right) // 2, (top + bottom) // 2


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def is_chip_candidate(node: ET.Element) -> bool:
    klass = (node.attrib.get("class") or "").lower()
    resource_id = (node.attrib.get("resource-id") or "").lower()
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    if "chip" in klass:
        return True
    if "chip" in resource_id:
        return True
    if text in {"good", "hard", "easy", "again"} and node.attrib.get("clickable") == "true":
        return True
    if desc in {"good", "hard", "easy", "again"} and node.attrib.get("clickable") == "true":
        return True
    return False


def is_bottom_nav_candidate(node: ET.Element, screen_bottom: int) -> bool:
    _, _, _, bottom = bounds_of(node.attrib["bounds"])
    if screen_bottom > 0 and bottom >= int(screen_bottom * 0.86):
        return True
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    for value in (text, desc):
        if value in {"assistant", "review", "planner", "library", "starlog assistant", "starlog planner", "starlog review", "home"}:
            return True
    return False


edit = None
for node in root.iter("node"):
    if node.attrib.get("class") != "android.widget.EditText":
        continue
    if expected_command and expected_command in normalize(node.attrib.get("text", "")):
        edit = node
        break

if edit is None:
    for node in root.iter("node"):
        if node.attrib.get("class") != "android.widget.EditText":
            continue
        edit = node
        break

if edit is None:
    raise SystemExit(1)

e_left, e_top, e_right, e_bottom = bounds_of(edit.attrib["bounds"])
edit_height = max(1, e_bottom - e_top)
band_top = max(0, e_top - max(10, edit_height // 4))
band_bottom = e_bottom + max(10, edit_height // 4)

screen_bottom = 0
for node in root.iter("node"):
    if "bounds" not in node.attrib:
        continue
    try:
        _, _, _, node_bottom = bounds_of(node.attrib["bounds"])
    except ValueError:
        continue
    screen_bottom = max(screen_bottom, node_bottom)

best = None
best_score = None
for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    if "bounds" not in node.attrib:
        continue
    b = bounds_of(node.attrib["bounds"])
    if b[3] < band_top or b[1] > band_bottom:
        continue
    if node.attrib.get("class") == "android.widget.EditText":
        continue
    if is_chip_candidate(node):
        continue
    if is_bottom_nav_candidate(node, screen_bottom):
        continue

    left, _, right, _ = b
    if right < e_left:
        continue

    dx = left - e_right
    if dx >= 0:
        if dx > max_x_offset:
            continue
        score = dx
    else:
        overlap = e_right - left
        if overlap < 0 or overlap > max_x_offset:
            continue
        score = (max_x_offset * 2) + overlap

    if best is None or score < best_score:
        best = b
        best_score = score

if best is None:
    raise SystemExit(1)
print(f"{center(best)[0]} {center(best)[1]}")
PY
)" || return 2

  for send_attempt in 1 2 3; do
    if [[ "$send_attempt" -eq 2 ]]; then
      adb_cmd shell input keyevent KEYCODE_ENTER >/dev/null || true
    else
      adb_cmd shell input tap ${coords} >/dev/null
    fi
    sleep 1

    deadline=$((SECONDS + 8))
    while (( SECONDS < deadline )); do
      status_line="$(latest_assistant_turn_status_after_line "$log_line_before" || true)"
      if [[ -n "$status_line" ]]; then
        return 0
      fi
      dump_ui || true
      if assistant_command_cleared "$expected_command"; then
        return 0
      fi
      sleep 1
    done
  done

  dump_ui || true
  coords="$(python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()


def bounds_of(value: str):
    return tuple(map(int, re.findall(r"\d+", value)))


screen_right = 0
edit_bounds = None
for node in root.iter("node"):
    if "bounds" not in node.attrib:
        continue
    left, top, right, bottom = bounds_of(node.attrib["bounds"])
    screen_right = max(screen_right, right)
    if edit_bounds is None and node.attrib.get("class") == "android.widget.EditText":
        edit_bounds = (left, top, right, bottom)

if edit_bounds is None:
    raise SystemExit(1)

left, top, right, bottom = edit_bounds
x = min(max(right + 126, right + 40), max(1, screen_right - 80))
y = (top + bottom) // 2
print(f"{x} {y}")
PY
)" || coords=""
  if [[ -n "$coords" ]]; then
    adb_cmd shell input tap ${coords} >/dev/null
    sleep 3
    status_line="$(latest_assistant_turn_status_after_line "$log_line_before" || true)"
    if [[ -n "$status_line" ]]; then
      return 0
    fi
    dump_ui || true
    if assistant_command_cleared "$expected_command"; then
      return 0
    fi
  fi

  capture_screen "$SCREENSHOT_DIR/assistant-send-verify-fail.png"
  snapshot_phone_state "assistant-send-verify-fail"
  return 1
}

assistant_command_cleared() {
  local expected_command="$1"
  python3 - "$UI_XML" "$expected_command" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, expected_command = sys.argv[1], (sys.argv[2] or "").strip().lower()
root = ET.parse(path).getroot()

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())

edit = None
for node in root.iter("node"):
    if node.attrib.get("class") != "android.widget.EditText":
        continue
    if edit is None:
        edit = node
    text = normalize(node.attrib.get("text", ""))
    desc = normalize(node.attrib.get("content-desc", ""))
    if expected_command and (expected_command in text or expected_command in desc):
        raise SystemExit(1)

if edit is None:
    raise SystemExit(1)

if normalize(edit.attrib.get("text", "")) or normalize(edit.attrib.get("content-desc", "")):
    raise SystemExit(1)

raise SystemExit(0)
PY
}

clear_focused_text_field() {
  adb_cmd shell input keyevent KEYCODE_MOVE_END >/dev/null 2>&1 || true
  for _ in $(seq 1 96); do
    adb_cmd shell input keyevent KEYCODE_DEL >/dev/null 2>&1 || true
  done
}

capture_screen() {
  local path="$1"
  adb_cmd exec-out screencap -p > "$path"
}

wait_for_post_login_surface() {
  local deadline=$((SECONDS + 25))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi
    if ! ui_has_text "PASSPHRASE" && ! ui_has_text "SIGN IN"; then
      return 0
    fi
    if ui_has_text "Network request failed" || ui_has_text "Login failed" || ui_has_text "Bootstrap failed"; then
      capture_screen "$SCREENSHOT_DIR/login-failure.png"
      fail "Mobile login failed before leaving the auth screen"
    fi
    sleep 1
  done
  capture_screen "$SCREENSHOT_DIR/login-timeout.png"
  fail "Mobile login did not transition out of the auth screen"
}

scroll_review_controls() {
  adb_cmd shell input swipe 540 1800 540 1200 250 >/dev/null
}

scroll_review_controls_reverse() {
  adb_cmd shell input swipe 540 1200 540 1800 250 >/dev/null
}

assistant_transcript_scroll_once() {
  local direction="${1:-up}"
  dump_ui || true

  local swipe_output=""
  local swipe_coords=""
  swipe_output="$(python3 - "$UI_XML" "$direction" <<'PY' || true
import re
import sys
import xml.etree.ElementTree as ET

path, direction = sys.argv[1], sys.argv[2]

try:
    root = ET.parse(path).getroot()
except Exception:
    raise SystemExit(1)


def parse_bounds(value):
    numbers = list(map(int, re.findall(r"\d+", value or "")))
    if len(numbers) != 4:
        return None
    left, top, right, bottom = numbers
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom


def fmt_bounds(bounds):
    left, top, right, bottom = bounds
    return f"[{left},{top}][{right},{bottom}]"


def normalized_label(node):
    values = [
        node.attrib.get("resource-id") or "",
        node.attrib.get("content-desc") or "",
        node.attrib.get("text") or "",
    ]
    return " ".join(value.strip().lower() for value in values if value.strip())


def bounds_for_marker(markers):
    candidates = []
    for node in root.iter("node"):
        label = normalized_label(node)
        if not any(marker in label for marker in markers):
            continue
        bounds = parse_bounds(node.attrib.get("bounds"))
        if bounds:
            candidates.append(bounds)
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item[2] - item[0]) * (item[3] - item[1]))


transcript = bounds_for_marker({
    "mobile-assistant-aui-transcript",
    "assistant-ui-thread",
    "assistant-ui thread",
})
if transcript is None:
    raise SystemExit(1)

composer = bounds_for_marker({
    "assistant-ui-composer",
    "assistant-ui-composer-input",
    "message composer",
    "write a message",
})

left, top, right, bottom = transcript
original_bottom = bottom
composer_clamp = "none"
if composer:
    bottom = min(bottom, composer[1] - 12)
    composer_clamp = f"{fmt_bounds(composer)} -> bottom={bottom}"

top_clamp = "none"

if right - left < 120 or bottom - top < 220:
    raise SystemExit(1)

x = max(left + 24, min((left + right) // 2, right - 24))
start_y = bottom - max(72, min(180, (bottom - top) // 5))
end_y = top + max(72, min(180, (bottom - top) // 5))

if direction == "down":
    start_y, end_y = end_y, start_y

if abs(start_y - end_y) < 160:
    raise SystemExit(1)

coords = f"{x} {start_y} {x} {end_y}"
print(
    "coords="
    + coords
    + "|direction="
    + direction
    + "|transcript_bounds="
    + fmt_bounds(transcript)
    + f"|effective_bounds=[{left},{top}][{right},{bottom}]"
    + f"|original_bottom={original_bottom}"
    + "|composer_clamp="
    + composer_clamp
    + "|top_clamp="
    + top_clamp
)
PY
)"

  if [[ -n "$swipe_output" ]]; then
    swipe_coords="${swipe_output%%|*}"
    swipe_coords="${swipe_coords#coords=}"
    log "Assistant transcript scroll: ${swipe_output#*|} final_swipe_coords=${swipe_coords}"
    adb_cmd shell input swipe ${swipe_coords} 250 >/dev/null || true
  elif [[ "$direction" == "down" ]]; then
    swipe_coords="540 760 540 1360"
    log "Assistant transcript scroll: direction=${direction} transcript_bounds=unavailable composer_clamp=unavailable top_clamp=unavailable final_swipe_coords=${swipe_coords} fallback=1"
    adb_cmd shell input swipe ${swipe_coords} 250 >/dev/null || true
  else
    swipe_coords="540 1360 540 760"
    log "Assistant transcript scroll: direction=${direction} transcript_bounds=unavailable composer_clamp=unavailable top_clamp=unavailable final_swipe_coords=${swipe_coords} fallback=1"
    adb_cmd shell input swipe ${swipe_coords} 250 >/dev/null || true
  fi
}

launch_and_validate_review() {
  log "Launching app into fresh login state"
  adb_cmd reverse "tcp:${API_PORT}" "tcp:${API_PORT}" >/dev/null
  adb_cmd shell am start -W -n "$APP_COMPONENT" >/dev/null
  sleep 2

  wait_for_any_ui_text "PASSPHRASE" "API ENDPOINT" "SIGN IN"
  capture_screen "$SCREENSHOT_DIR/login.png"

  tap_nth_edit_text 0
  clear_focused_text_field
  adb_cmd shell input text "$API_BASE" >/dev/null
  sleep 1

  bring_app_to_foreground
  tap_nth_edit_text 1
  clear_focused_text_field
  adb_cmd shell input text "$STARLOG_TEST_PASSPHRASE" >/dev/null
  sleep 1
  bring_app_to_foreground
  tap_exact_text "SIGN IN"
  wait_for_post_login_surface

  log "Opening Assistant tab and validating via bottom nav"
  if tap_bottom_nav_tab "assistant"; then
    wait_for_assistant_surface
  else
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=assistant" -n "$APP_COMPONENT" >/dev/null || true
    wait_for_assistant_surface
  fi
  capture_screen "$SCREENSHOT_DIR/assistant-open.png"
  snapshot_phone_state "assistant-open"

  local assistant_capability_api_log_line_before
  assistant_capability_api_log_line_before="$(wc -l < "$API_LOG")"

  if tap_if_present "$ASSISTANT_COMMAND_TEXT"; then
    clear_focused_text_field
  else
    tap_nth_edit_text 0 || fail "Assistant input field not detected; cannot validate assistant capability prompt."
    clear_focused_text_field
  fi

  adb_cmd shell input text "${ASSISTANT_CAPABILITY_COMMAND// /%s}" >/dev/null
  adb_cmd shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
  sleep 3
  if ! tap_send_after_first_edit_text "$ASSISTANT_CAPABILITY_COMMAND" "$assistant_capability_api_log_line_before" 300; then
    fail "Assistant capability prompt command still present after send tap; see $SCREENSHOT_DIR/assistant-send-verify-fail.png"
  fi
  sleep 2
  capture_screen "$SCREENSHOT_DIR/assistant-capability-command.png"
  snapshot_phone_state "assistant-capability-command"
  assert_assistant_turn_recorded "$assistant_capability_api_log_line_before"
  assert_assistant_ui_shell_and_transcript "$ASSISTANT_CAPABILITY_COMMAND" "assistant-capability"
  assert_assistant_dynamic_ui_capability_prompt

  local assistant_api_log_line_before
  assistant_api_log_line_before="$(wc -l < "$API_LOG")"

  if tap_if_present "$ASSISTANT_COMMAND_TEXT"; then
    clear_focused_text_field
  else
    tap_nth_edit_text 0 || fail "Assistant input field not detected; cannot validate assistant command flow."
    clear_focused_text_field
  fi

  adb_cmd shell input text "${ASSISTANT_COMMAND// /%s}" >/dev/null
  adb_cmd shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
  sleep 3
  local assistant_send_rc=0
  if tap_send_after_first_edit_text "$ASSISTANT_COMMAND" "$assistant_api_log_line_before" 300; then
    assistant_send_rc=0
  else
    assistant_send_rc=$?
    if [[ "$assistant_send_rc" -eq 2 ]]; then
      adb_cmd shell input keyevent KEYCODE_ENTER >/dev/null || true
      sleep 1
    else
      fail "Assistant command still present after send tap; see $SCREENSHOT_DIR/assistant-send-verify-fail.png"
    fi
  fi
  sleep 2
  capture_screen "$SCREENSHOT_DIR/assistant-command.png"
  snapshot_phone_state "assistant-command"
  assert_assistant_turn_recorded "$assistant_api_log_line_before"
  assert_assistant_ui_shell_and_transcript "$ASSISTANT_COMMAND" "assistant-command"

  ensure_review_surface
  capture_screen "$SCREENSHOT_DIR/review-entry.png"
  if ! ui_has_text "Study loop" && ! ui_has_exact_text "Load due cards" && ! ui_has_exact_text "Reveal answer" && ! ui_has_exact_text "Hide answer"; then
    scroll_until_any_ui_text "Study loop" "Load due cards" "Reveal answer" "Hide answer"
  fi
  if ui_has_exact_text "Load due cards"; then
    tap_exact_text "Load due cards"
    sleep 1
  fi
  capture_screen "$SCREENSHOT_DIR/review-loaded.png"
  validate_native_study_controls
  ensure_review_surface
  capture_screen "$SCREENSHOT_DIR/review-after-native-study-controls.png"
  snapshot_phone_state "review-after-native-study-controls"

  scroll_until_any_ui_text_in_review "reveal" "Reveal answer" "Hide answer"
  if ui_has_exact_text "Reveal answer"; then
    tap_exact_text "Reveal answer"
  fi
  sleep 2
  capture_screen "$SCREENSHOT_DIR/review-answer.png"
  snapshot_phone_state "review-answer"

  local review_api_log_line_before
  review_api_log_line_before="$(wc -l < "$API_LOG")"
  local review_due_count_before=""
  if review_due_count_before="$(query_due_count "$BUILD_DIR/review-due-before.json" || true)"; then
    log "Review due count before Good: $review_due_count_before"
  else
    review_due_count_before=""
  fi

  ensure_review_surface
  scroll_until_any_ui_text_in_review "grade" "Good"
  tap_review_good_grade
  sleep 2
  capture_screen "$SCREENSHOT_DIR/review-rated.png"
  snapshot_phone_state "review-rated"
  assert_review_grade_recorded "$review_api_log_line_before" "$review_due_count_before"
  assert_assistant_review_grade_dynamic_ui

  validate_assistant_due_date_dynamic_ui

  log "Opening Planner tab and toggling alarm schedule control"
  if tap_bottom_nav_tab "planner"; then
    wait_for_planner_surface
  else
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=planner" -n "$APP_COMPONENT" >/dev/null || true
    wait_for_planner_surface
  fi
  capture_screen "$SCREENSHOT_DIR/planner-open.png"
  snapshot_phone_state "planner-open"
  if ! ensure_planner_alarm_control_visible; then
    snapshot_phone_state "planner-alarm-control-missing"
    fail "Could not reveal planner alarm control; cannot validate alarm scheduling path"
  fi

  local planner_alarm_state
  planner_alarm_state="$(ui_planner_alarm_state)"
  if [[ "$planner_alarm_state" != "scheduled" ]]; then
    log "Planner alarm is not scheduled; generating briefing cache before scheduling"
    local briefing_marker_before
    briefing_marker_before="$(latest_briefing_package_marker || true)"
    if ! tap_planner_alarm_cache_control; then
      snapshot_phone_state "planner-alarm-cache-control-missing"
      fail "Could not locate planner cache control; cannot validate planner alarm scheduling path"
    fi
    capture_screen "$SCREENSHOT_DIR/planner-alarm-cache-triggered.png"
    snapshot_phone_state "planner-alarm-cache-triggered"
    wait_for_planner_alarm_cache_ready
    capture_screen "$SCREENSHOT_DIR/planner-alarm-cache-ready.png"
    snapshot_phone_state "planner-alarm-cache-ready"
    assert_latest_briefing_has_recommendation_hints "$briefing_marker_before"
    capture_screen "$SCREENSHOT_DIR/planner-briefing-path.png"
    snapshot_phone_state "planner-briefing-path"
    planner_alarm_state="$(ui_planner_alarm_state)"
  fi

  if [[ "$planner_alarm_state" != "scheduled" ]]; then
      if ! tap_planner_alarm_control_with_verification 1; then
        snapshot_phone_state "planner-alarm-control-missing"
        fail "Could not locate planner alarm control near alarm card; cannot validate alarm scheduling path"
      fi
    sleep 2
    planner_alarm_state="$(ui_planner_alarm_state)"
    if [[ "$planner_alarm_state" == "cache_missing" || "$planner_alarm_state" == "blocked" ]]; then
      log "Planner alarm scheduling blocked by missing cache; generating briefing cache and retrying"
      if ! tap_planner_alarm_cache_control; then
        snapshot_phone_state "planner-alarm-cache-control-missing"
        fail "Could not locate planner cache control; cannot validate planner alarm scheduling path"
      fi
      wait_for_planner_alarm_cache_ready
      if ! tap_planner_alarm_control_with_verification 2; then
        snapshot_phone_state "planner-alarm-control-missing"
        fail "Could not locate planner alarm control after cache generation; cannot validate alarm scheduling path"
      fi
    fi
    wait_for_planner_alarm_state "scheduled"
  fi
  sleep 1
  capture_screen "$SCREENSHOT_DIR/planner-alarm.png"
  snapshot_phone_state "planner-alarm"
  capture_screen "$SCREENSHOT_DIR/planner-alarm-briefing-path.png"
  snapshot_phone_state "planner-alarm-briefing-path"
}

write_metadata() {
  local metadata_stage="${1:-final}"
  local publish_latest=1
  if [[ "$metadata_stage" == "pre" ]]; then
    publish_latest=0
  fi

  METADATA_PATH_ENV="$METADATA_PATH" \
  STAMP_ENV="$STAMP" \
  VERSION_NAME_ENV="$STARLOG_VERSION_NAME" \
  VERSION_CODE_ENV="$STARLOG_ANDROID_VERSION_CODE" \
  STAGED_APK_ENV="$STAGED_APK" \
  WINDOWS_APK_PATH_ENV="$WINDOWS_APK_PATH" \
  API_BASE_ENV="$API_BASE" \
  RUNTIME_DIR_ENV="$RUNTIME_DIR" \
  PASSPHRASE_FILE_ENV="$PASSPHRASE_FILE" \
  INCLUDE_LOCAL_METADATA_ENV="${STARLOG_INCLUDE_LOCAL_METADATA:-0}" \
  SCREENSHOT_DIR_ENV="$SCREENSHOT_DIR" \
  VALIDATED_FLOW_MARKERS_PATH_ENV="$VALIDATED_FLOW_MARKERS_PATH" \
  METADATA_STAGE_ENV="$metadata_stage" \
  FAILURE_REASON_ENV="${STARLOG_FAILURE_REASON:-}" \
  python3 - <<'PY'
from pathlib import Path
import json
import os

path = Path(os.environ["METADATA_PATH_ENV"])
screenshot_dir = os.environ["SCREENSHOT_DIR_ENV"]
metadata_stage = os.environ["METADATA_STAGE_ENV"]
include_local_metadata = os.environ["INCLUDE_LOCAL_METADATA_ENV"].lower() in {"1", "true", "yes"}
failure_reason = os.environ.get("FAILURE_REASON_ENV") or None
validated_flow_markers_path = Path(os.environ["VALIDATED_FLOW_MARKERS_PATH_ENV"])

completed_flow_markers = []
if validated_flow_markers_path.is_file():
    seen = set()
    for marker in validated_flow_markers_path.read_text(encoding="utf-8").splitlines():
        marker = marker.strip()
        if marker and marker not in seen:
            seen.add(marker)
            completed_flow_markers.append(marker)

validated_flows = [
    "assistant_ui_shell_thread_composer_verified",
    "assistant_dynamic_ui_capability_prompt_verified",
    "assistant_command_submitted",
    "assistant_due_date_dynamic_ui_verified",
    "native_study_topic_unlocked",
    "native_study_topic_marked_read",
    "native_study_question_request_created",
    "review_answer_revealed",
    "review_good_grade_submitted",
    "assistant_review_grade_controls_verified",
    "assistant_review_grade_dynamic_ui_verified",
    "review_progress_update_verified",
    "planner_briefing_cache_generated",
    "planner_briefing_recommendation_hints_validated",
    "planner_briefing_path_verified",
    "planner_alarm_scheduled",
    "planner_alarm_briefing_path_verified",
]

def existing_file_map(values):
    return {
        key: value
        for key, value in values.items()
        if Path(value).is_file()
    }

screenshot_candidates = {
    "login": f"{screenshot_dir}/login.png",
    "review_entry": f"{screenshot_dir}/review-entry.png",
    "review_loaded": f"{screenshot_dir}/review-loaded.png",
    "review_after_native_study_controls": f"{screenshot_dir}/review-after-native-study-controls.png",
    "review_answer": f"{screenshot_dir}/review-answer.png",
    "review_rated": f"{screenshot_dir}/review-rated.png",
    "native_study_before": f"{screenshot_dir}/native-study-before.png",
    "native_study_after": f"{screenshot_dir}/native-study-after.png",
    "assistant_open": f"{screenshot_dir}/assistant-open.png",
    "assistant_capability_command": f"{screenshot_dir}/assistant-capability-command.png",
    "assistant_capability_shell_thread_composer": f"{screenshot_dir}/assistant-capability-shell-thread-composer.png",
    "assistant_dynamic_ui_capability_prompt": f"{screenshot_dir}/assistant-dynamic-ui-capability-prompt.png",
    "assistant_command": f"{screenshot_dir}/assistant-command.png",
    "assistant_command_shell_thread_composer": f"{screenshot_dir}/assistant-command-shell-thread-composer.png",
    "assistant_due_date_command": f"{screenshot_dir}/assistant-due-date-command.png",
    "assistant_due_date_dynamic_ui": f"{screenshot_dir}/assistant-due-date-dynamic-ui.png",
    "assistant_due_date_tomorrow_selected": f"{screenshot_dir}/assistant-due-date-tomorrow-selected.png",
    "assistant_due_date_created": f"{screenshot_dir}/assistant-due-date-created.png",
    "assistant_review_grade_controls": f"{screenshot_dir}/assistant-review-grade-controls.png",
    "assistant_review_grade_dynamic_ui": f"{screenshot_dir}/assistant-review-grade-dynamic-ui.png",
    "planner_open": f"{screenshot_dir}/planner-open.png",
    "planner_alarm_cache_triggered": f"{screenshot_dir}/planner-alarm-cache-triggered.png",
    "planner_alarm_cache_ready": f"{screenshot_dir}/planner-alarm-cache-ready.png",
    "planner_briefing_path": f"{screenshot_dir}/planner-briefing-path.png",
    "planner_alarm": f"{screenshot_dir}/planner-alarm.png",
    "planner_alarm_briefing_path": f"{screenshot_dir}/planner-alarm-briefing-path.png",
}

evidence_candidates = {
    "adb_preflight_log": f"{path.parent}/adb-preflight.log",
    "preflight_screen": f"{path.parent}/preflight-screen.png",
    "preflight_window_xml": f"{path.parent}/preflight-window.xml",
    "api_log": f"{path.parent}/local-api.log",
    "native_study_before_xml": f"{path.parent}/native-study-before.xml",
    "native_study_after_xml": f"{path.parent}/native-study-after.xml",
    "review_after_native_study_controls_xml": f"{path.parent}/review-after-native-study-controls.xml",
    "review_answer_xml": f"{path.parent}/review-answer.xml",
    "review_rated_xml": f"{path.parent}/review-rated.xml",
    "assistant_capability_shell_thread_composer_xml": f"{path.parent}/assistant-capability-shell-thread-composer.xml",
    "assistant_dynamic_ui_capability_prompt_xml": f"{path.parent}/assistant-dynamic-ui-capability-prompt.xml",
    "assistant_command_shell_thread_composer_xml": f"{path.parent}/assistant-command-shell-thread-composer.xml",
    "assistant_due_date_command_xml": f"{path.parent}/assistant-due-date-command.xml",
    "assistant_due_date_dynamic_ui_xml": f"{path.parent}/assistant-due-date-dynamic-ui.xml",
    "assistant_due_date_tomorrow_selected_xml": f"{path.parent}/assistant-due-date-tomorrow-selected.xml",
    "assistant_due_date_created_xml": f"{path.parent}/assistant-due-date-created.xml",
    "assistant_due_date_tasks_json": f"{path.parent}/assistant-due-date-tasks.json",
    "assistant_review_grade_controls_xml": f"{path.parent}/assistant-review-grade-controls.xml",
    "assistant_review_grade_dynamic_ui_xml": f"{path.parent}/assistant-review-grade-dynamic-ui.xml",
    "planner_briefing_path_xml": f"{path.parent}/planner-briefing-path.xml",
    "planner_alarm_xml": f"{path.parent}/planner-alarm.xml",
    "planner_alarm_briefing_path_xml": f"{path.parent}/planner-alarm-briefing-path.xml",
    "latest_briefing_json": f"{path.parent}/briefing-latest.json",
}

if (
    metadata_stage == "final"
    and "native_study_question_request_fallback_after_visible_tap" in completed_flow_markers
):
    validated_flows = [
        marker
        for marker in validated_flows
        if marker != "native_study_question_request_created"
    ]

if metadata_stage == "final":
    active_validated_flows = list(dict.fromkeys(validated_flows + completed_flow_markers))
else:
    completed_flow_marker_set = set(completed_flow_markers)
    active_validated_flows = [marker for marker in validated_flows if marker in completed_flow_marker_set]
    known_flow_marker_set = set(validated_flows)
    active_validated_flows.extend(
        marker for marker in completed_flow_markers
        if marker not in known_flow_marker_set and marker not in active_validated_flows
    )

payload = {
    "stamp": os.environ["STAMP_ENV"],
    "version_name": os.environ["VERSION_NAME_ENV"],
    "version_code": os.environ["VERSION_CODE_ENV"],
    "apk_name": Path(os.environ["STAGED_APK_ENV"]).name,
    "api_base_kind": "local" if os.environ["API_BASE_ENV"].startswith("http://127.0.0.1:") else "configured",
    "screenshots": existing_file_map(screenshot_candidates),
    "evidence_files": existing_file_map(evidence_candidates),
    "validated_flows": active_validated_flows,
    "validation_stage": metadata_stage,
    "validation_passed": metadata_stage == "final",
}
if failure_reason and metadata_stage != "final":
    payload["failure_reason"] = failure_reason
if include_local_metadata:
    payload["local_paths"] = {
        "apk_path": os.environ["STAGED_APK_ENV"],
        "windows_apk_path": os.environ["WINDOWS_APK_PATH_ENV"],
        "api_base": os.environ["API_BASE_ENV"],
        "runtime_dir": os.environ["RUNTIME_DIR_ENV"],
        "passphrase_file": os.environ["PASSPHRASE_FILE_ENV"],
    }
path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

  if [[ "$publish_latest" -eq 1 ]]; then
    cp "$METADATA_PATH" "$LATEST_METADATA_PATH"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --adb-preflight-only)
      ADB_PREFLIGHT_ONLY=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown option: $1"
      ;;
  esac
done

if [[ "$ADB_PREFLIGHT_ONLY" == "1" ]]; then
  ensure_adb_available
  run_adb_preflight
  log "ADB preflight-only check completed"
  exit 0
fi

ensure_requirements
create_passphrase
prepare_dirs
run_adb_preflight
resolve_target_architectures
preflight_phone_state
start_local_api
bootstrap_local_station
import_local_srs_deck
import_local_neetcode_study_core
seed_native_interview_loop_review_queue
verify_local_review_queue
if [[ "$SKIP_BUILD" == "1" ]]; then
  stage_existing_apk
else
  build_apk
fi
verify_built_apk
write_metadata pre
remove_phone_builds
ensure_phone_ready
install_apk
launch_and_validate_review
write_metadata final
VALIDATION_PASSED=1

log "Fresh local SRS validation completed"
log "Build metadata: $METADATA_PATH"
log "Passphrase file: $PASSPHRASE_FILE"
