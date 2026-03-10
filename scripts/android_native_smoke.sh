#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/.local/android}}"
ADB="${ADB:-$ANDROID_SDK_ROOT/platform-tools/adb}"
APK_PATH="${APK_PATH:-$ROOT_DIR/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk}"
APP_PACKAGE="${APP_PACKAGE:-com.starlog.app.dev}"
APP_ACTIVITY="${APP_ACTIVITY:-$APP_PACKAGE/.MainActivity}"
DEEP_LINK="${DEEP_LINK:-starlog://capture?title=Smoke%20Clip&text=Hello%20from%20adb}"
SHARE_TITLE="${SHARE_TITLE:-Starlog native share}"
SHARE_TEXT="${SHARE_TEXT:-Hello from the Starlog Android smoke script}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-180}"
INSTALL_TIMEOUT_SECONDS="${INSTALL_TIMEOUT_SECONDS:-180}"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Installs the current Starlog Android debug APK on a connected device/emulator,
launches the app, sends a deep-link capture, and sends a text share intent.

Environment overrides:
  ANDROID_SDK_ROOT       Android SDK root (default: \$HOME/.local/android)
  ADB                    Explicit adb path
  APK_PATH               APK to install
  APP_PACKAGE            Android package name (default: com.starlog.app.dev)
  APP_ACTIVITY           Fully qualified launch activity (default: com.starlog.app.dev/.MainActivity)
  DEEP_LINK              Deep-link payload to open after launch
  SHARE_TITLE            android.intent.extra.SUBJECT for the text share
  SHARE_TEXT             android.intent.extra.TEXT for the text share
  WAIT_TIMEOUT_SECONDS   Boot/package-manager wait timeout (default: 180)
  INSTALL_TIMEOUT_SECONDS  APK install retry timeout (default: 180)
EOF
}

log() {
  printf '[android-smoke] %s\n' "$1"
}

require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "$path" ]]; then
    printf '%s not found: %s\n' "$label" "$path" >&2
    exit 1
  fi
}

adb_cmd() {
  "$ADB" "$@"
}

wait_for_runtime() {
  log "Waiting for adb device"
  local deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    local device_state
    local boot_completed
    local activity_ready
    device_state="$(adb_cmd get-state 2>/dev/null | tr -d '\r' || true)"
    if [[ "$device_state" != "device" ]]; then
      sleep 2
      continue
    fi

    boot_completed="$(adb_cmd shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
    activity_ready="$(adb_cmd shell service list 2>/dev/null | tr -d '\r' | grep -c 'activity_task:' || true)"
    if adb_cmd shell pm path android >/dev/null 2>&1 && [[ "$boot_completed" == "1" || "$activity_ready" != "0" ]]; then
      return 0
    fi
    sleep 2
  done

  printf 'Timed out waiting for Android runtime/package manager after %ss\n' "$WAIT_TIMEOUT_SECONDS" >&2
  exit 1
}

send_deep_link() {
  log "Sending deep-link capture"
  adb_cmd shell am start -W \
    -a android.intent.action.VIEW \
    -d "$DEEP_LINK" \
    -n "$APP_ACTIVITY" >/dev/null
}

send_text_share() {
  log "Sending text share intent"
  adb_cmd shell am start -W \
    -a android.intent.action.SEND \
    -t text/plain \
    --es android.intent.extra.SUBJECT "$SHARE_TITLE" \
    --es android.intent.extra.TEXT "$SHARE_TEXT" \
    -n "$APP_ACTIVITY" >/dev/null
}

install_apk() {
  log "Installing debug APK"
  local deadline=$((SECONDS + INSTALL_TIMEOUT_SECONDS))
  local output=""

  while (( SECONDS < deadline )); do
    if output="$(adb_cmd install -r "$APK_PATH" 2>&1)"; then
      return 0
    fi

    if grep -Eq 'device offline|NullPointerException|freeStorage|Can.t find service: package|cmd: Can.t find service: package|INSTALL_FAILED_INTERNAL_ERROR' <<<"$output"; then
      sleep 5
      continue
    fi

    printf '%s\n' "$output" >&2
    exit 1
  done

  printf 'Timed out installing APK after %ss\nLast adb output:\n%s\n' "$INSTALL_TIMEOUT_SECONDS" "$output" >&2
  exit 1
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_file "$ADB" "adb"
require_file "$APK_PATH" "APK"

wait_for_runtime

log "Installing debug APK"
install_apk

log "Launching app"
adb_cmd shell am start -W -n "$APP_ACTIVITY" >/dev/null

send_deep_link
send_text_share

log "Smoke flow completed. Inspect the device/emulator UI to confirm the Starlog quick-capture state."
