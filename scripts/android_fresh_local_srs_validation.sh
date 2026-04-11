#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCALDATA_ROOT="${LOCALDATA_ROOT:-$ROOT_DIR/.localdata/android-local-validation}"
BUILD_ROOT="$LOCALDATA_ROOT/builds"
RUNTIME_ROOT="$LOCALDATA_ROOT/runtime"
CONFIG_DIR="${STARLOG_TEST_CONFIG_DIR:-$HOME/.config/starlog}"
PASSPHRASE_FILE="${STARLOG_TEST_PASSPHRASE_FILE:-$CONFIG_DIR/android-local-srs-passphrase.txt}"

JAVA_HOME="${JAVA_HOME:-$HOME/.local/jdks/temurin-17}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/android}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
ADB="${ADB:-/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe}"
ADB_SERIAL="${ADB_SERIAL:-}"
APP_VARIANT="${APP_VARIANT:-development}"
APP_PACKAGE="${APP_PACKAGE:-com.starlog.app.dev}"
APP_ACTIVITY="${APP_ACTIVITY:-com.starlog.app.dev/.MainActivity}"
WINDOWS_TEMP_ROOT="${WINDOWS_TEMP_ROOT:-/mnt/c/Temp}"
API_PORT="${API_PORT:-8000}"
API_BASE="${API_BASE:-http://127.0.0.1:${API_PORT}}"
DECK_PATH="${DECK_PATH:-$ROOT_DIR/data/ml_interviews_part_ii_qa_cards.jsonl}"
STARLOG_VERSION_NAME="${STARLOG_VERSION_NAME:-0.1.0-april.devtest.$(date -u +%Y%m%dT%H%M%SZ)}"
# Keep versionCode below Android's signed-int max while still encoding UTC freshness.
STARLOG_ANDROID_VERSION_CODE="${STARLOG_ANDROID_VERSION_CODE:-1$(date -u +%y%j%H%M)}"
REACT_NATIVE_ARCHITECTURES="${REACT_NATIVE_ARCHITECTURES:-}"
CLEAN_BUILD="${CLEAN_BUILD:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
EXISTING_APK_PATH="${EXISTING_APK_PATH:-}"
ADB_INSTALL_TIMEOUT_SEC="${ADB_INSTALL_TIMEOUT_SEC:-900}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BUILD_DIR="$BUILD_ROOT/$STAMP"
RUNTIME_DIR="$RUNTIME_ROOT/$STAMP"
SCREENSHOT_DIR="$BUILD_DIR/screens"
API_LOG="$BUILD_DIR/local-api.log"
UI_XML="$BUILD_DIR/window_dump.xml"
BUILD_NAME="starlog-dev-${STAMP}-${STARLOG_ANDROID_VERSION_CODE}.apk"
STAGED_APK="$BUILD_DIR/$BUILD_NAME"
WINDOWS_APK_PATH="$WINDOWS_TEMP_ROOT/$BUILD_NAME"
METADATA_PATH="$BUILD_DIR/latest.json"
LATEST_METADATA_PATH="$BUILD_ROOT/latest.json"
LATEST_APK_PATH="$BUILD_ROOT/latest.apk"
TOP_ACTIVITY_PATH="$BUILD_DIR/top-activity.txt"
WINDOW_POLICY_PATH="$BUILD_DIR/window-policy.txt"
VENV_PYTHON="${VENV_PYTHON:-$ROOT_DIR/services/api/.venv/bin/python}"
API_PID=""
PRESERVED_EXISTING_APK=""

usage() {
  cat <<EOF
Usage: $(basename "$0")

Builds a fresh April mobile APK, resets the connected phone's Starlog packages,
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
  APP_VARIANT                   development | preview | production
  APP_PACKAGE                   Android package to install/launch
  APP_ACTIVITY                  Fully qualified launcher activity
  DECK_PATH                     JSONL deck to import
  STARLOG_VERSION_NAME          explicit Android versionName
  STARLOG_ANDROID_VERSION_CODE  explicit Android versionCode
  REACT_NATIVE_ARCHITECTURES    override ABI list (defaults to connected device ABI)
  CLEAN_BUILD                   1 to force gradlew clean before assembleRelease
  SKIP_BUILD                    1 to reuse an existing APK instead of rebuilding
  EXISTING_APK_PATH             existing APK path to reuse when SKIP_BUILD=1
  ADB_INSTALL_TIMEOUT_SEC       adb install timeout (default 900 seconds)
  API_PORT / API_BASE           local API endpoint for the mobile login flow
  WINDOWS_TEMP_ROOT             Windows-visible APK staging root
EOF
}

log() {
  printf '[android-local-srs] %s\n' "$1"
}

fail() {
  printf '[android-local-srs] %s\n' "$1" >&2
  exit 1
}

adb_cmd() {
  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB" -s "$ADB_SERIAL" "$@"
    return
  fi
  "$ADB" "$@"
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
  [[ -x "$ANDROID_SDK_ROOT/platform-tools/adb" || -f "$ADB" ]] || fail "Android SDK/adb not found"
  [[ -x "$VENV_PYTHON" ]] || fail "services/api virtualenv python not found: $VENV_PYTHON"
  [[ -f "$DECK_PATH" ]] || fail "Deck file not found: $DECK_PATH"
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
}

verify_local_review_queue() {
  local token
  token="$(curl -fsS \
    -X POST "$API_BASE/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"passphrase\":\"${STARLOG_TEST_PASSPHRASE}\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"

  curl -fsS "$API_BASE/v1/cards/decks" -H "Authorization: Bearer $token" >"$BUILD_DIR/review-decks.json"
  curl -fsS "$API_BASE/v1/cards/due?limit=20" -H "Authorization: Bearer $token" >"$BUILD_DIR/due-cards.json"
  python3 - "$BUILD_DIR/due-cards.json" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
payload = json.loads(path.read_text())
if isinstance(payload, dict):
    cards = payload.get("cards") or []
elif isinstance(payload, list):
    cards = payload
else:
    cards = []

if not cards:
    raise SystemExit("Fresh local review queue is empty after deck import")
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
  adb_cmd shell dumpsys activity top 2>/dev/null \
    | sed -n 's/^.*ACTIVITY \([^ ]*\) .*$/\1/p' \
    | head -n 1
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
  adb_cmd pull /sdcard/window_dump.xml "$BUILD_DIR/${prefix}.xml" >/dev/null 2>&1 || true
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
  adb_cmd shell uiautomator dump /sdcard/window_dump.xml >/dev/null
  adb_cmd pull /sdcard/window_dump.xml "$UI_XML" >/dev/null
}

ui_has_text() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, needle = sys.argv[1], sys.argv[2].lower()
root = ET.parse(path).getroot()
for node in root.iter("node"):
    text = (node.attrib.get("text") or "").lower()
    desc = (node.attrib.get("content-desc") or "").lower()
    if needle in text or needle in desc:
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

def center(bounds: str) -> str:
    left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
    return f"{(left + right) // 2} {(top + bottom) // 2}"

for node in root.iter("node"):
    text = (node.attrib.get("text") or "").lower()
    desc = (node.attrib.get("content-desc") or "").lower()
    if needle in text or needle in desc:
        print(center(node.attrib["bounds"]))
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

def center(bounds: str) -> str:
    left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
    return f"{(left + right) // 2} {(top + bottom) // 2}"

exact_matches = []
for node in root.iter("node"):
    text = (node.attrib.get("text") or "").strip().lower()
    desc = (node.attrib.get("content-desc") or "").strip().lower()
    if text == needle or desc == needle or desc == f"[{needle}]":
        exact_matches.append(node)

if not exact_matches:
    raise SystemExit(1)

for node in exact_matches:
    if node.attrib.get("clickable") == "true":
        print(center(node.attrib["bounds"]))
        raise SystemExit(0)

print(center(exact_matches[0].attrib["bounds"]))
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

wait_for_ui_text() {
  local needle="$1"
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    dump_ui
    if ui_has_text "$needle"; then
      return 0
    fi
    sleep 1
  done
  fail "Timed out waiting for UI text: $needle"
}

wait_for_any_ui_text() {
  local deadline=$((SECONDS + 60))
  local needles=("$@")
  while (( SECONDS < deadline )); do
    dump_ui
    for needle in "${needles[@]}"; do
      if ui_has_text "$needle"; then
        return 0
      fi
    done
    sleep 1
  done
  fail "Timed out waiting for any UI text: ${needles[*]}"
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

tap_nth_edit_text() {
  local index="$1"
  dump_ui
  local coords
  coords="$(ui_center_for_nth_class "android.widget.EditText" "$index")" || fail "Could not find EditText index $index"
  adb_cmd shell input tap ${coords} >/dev/null
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
    dump_ui
    if ! ui_has_text "Observer Identity"; then
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

launch_and_validate_review() {
  log "Launching app into fresh login state"
  adb_cmd shell am start -W -n "$APP_ACTIVITY" >/dev/null

  wait_for_ui_text "Observer Identity"
  capture_screen "$SCREENSHOT_DIR/login.png"

  tap_nth_edit_text 1
  clear_focused_text_field
  adb_cmd shell input text "$STARLOG_TEST_PASSPHRASE" >/dev/null
  adb_cmd shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
  sleep 1
  tap_exact_text "Initiate Neural Sync"
  wait_for_post_login_surface

  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    sleep 2
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=review" -n "$APP_ACTIVITY" >/dev/null || true
    dump_ui
    if ui_has_text "Knowledge Health" || ui_has_text "Load due cards" || ui_has_text "Focused Review"; then
      break
    fi
  done

  capture_screen "$SCREENSHOT_DIR/review-entry.png"
  if ui_has_text "Load due cards"; then
    scroll_review_controls
    sleep 1
    tap_exact_text "Load due cards"
  fi
  wait_for_any_ui_text "Focused Review" "Reveal answer" "Hide answer"
  capture_screen "$SCREENSHOT_DIR/review-loaded.png"

  scroll_review_controls
  sleep 1
  tap_exact_text "Reveal answer"
  sleep 2
  capture_screen "$SCREENSHOT_DIR/review-answer.png"

  tap_exact_text "Good"
  sleep 2
  capture_screen "$SCREENSHOT_DIR/review-rated.png"
}

write_metadata() {
  python3 - "$METADATA_PATH" <<PY
from pathlib import Path
import json

path = Path(r"$METADATA_PATH")
payload = {
    "stamp": "$STAMP",
    "version_name": "$STARLOG_VERSION_NAME",
    "version_code": "$STARLOG_ANDROID_VERSION_CODE",
    "apk_path": "$STAGED_APK",
    "windows_apk_path": "$WINDOWS_APK_PATH",
    "api_base": "$API_BASE",
    "runtime_dir": "$RUNTIME_DIR",
    "passphrase_file": "$PASSPHRASE_FILE",
    "screenshots": {
        "login": "$SCREENSHOT_DIR/login.png",
        "review_entry": "$SCREENSHOT_DIR/review-entry.png",
        "review_loaded": "$SCREENSHOT_DIR/review-loaded.png",
        "review_answer": "$SCREENSHOT_DIR/review-answer.png",
        "review_rated": "$SCREENSHOT_DIR/review-rated.png",
    },
}
path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\\n", encoding="utf-8")
PY
  cp "$METADATA_PATH" "$LATEST_METADATA_PATH"
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ensure_requirements
create_passphrase
prepare_dirs
resolve_target_architectures
preflight_phone_state
start_local_api
bootstrap_local_station
import_local_srs_deck
verify_local_review_queue
if [[ "$SKIP_BUILD" == "1" ]]; then
  stage_existing_apk
else
  build_apk
fi
verify_built_apk
write_metadata
remove_phone_builds
ensure_phone_ready
install_apk
launch_and_validate_review
write_metadata

log "Fresh local SRS validation completed"
log "Build metadata: $METADATA_PATH"
log "Passphrase file: $PASSPHRASE_FILE"
