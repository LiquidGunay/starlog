#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/.local/android}}"
DEFAULT_ADB="$ANDROID_SDK_ROOT/platform-tools/adb"
WINDOWS_ADB_CANDIDATE="/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe"

ADB="${ADB:-}"
if [[ -z "$ADB" ]]; then
  if [[ -f "$WINDOWS_ADB_CANDIDATE" ]]; then
    ADB="$WINDOWS_ADB_CANDIDATE"
  else
    ADB="$DEFAULT_ADB"
  fi
fi

APK_PATH="${APK_PATH:-}"
APP_PACKAGE="${APP_PACKAGE:-com.starlog.app}"
APP_ACTIVITY="${APP_ACTIVITY:-$APP_PACKAGE/.dev.MainActivity}"
WINDOWS_TEMP_ROOT="${WINDOWS_TEMP_ROOT:-/mnt/c/Temp}"
WINDOWS_APK_PATH="${WINDOWS_APK_PATH:-$WINDOWS_TEMP_ROOT/$(basename "${APK_PATH:-starlog-release.apk}")}"
STAGE_TO_WINDOWS="${STAGE_TO_WINDOWS:-1}"
VERIFY_HERMES="${VERIFY_HERMES:-1}"
PRECHECK_ONLY="${PRECHECK_ONLY:-0}"
SCREENSHOT_PATH="${SCREENSHOT_PATH:-}"
CRASH_LOG_PATH="${CRASH_LOG_PATH:-}"
REVERSE_PORTS="${REVERSE_PORTS:-}"
ADB_SERIAL="${ADB_SERIAL:-}"
INSTALL_TIMEOUT_SECONDS="${INSTALL_TIMEOUT_SECONDS:-180}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-180}"
INSTALL_APK_PATH="$APK_PATH"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Preflights and smoke-tests a sideloadable Starlog Android release APK.

This script rejects the broken bundle-derived APK shape that was missing
Hermes runtime libs and fell back to JSC on device. It stages the APK to a
Windows-visible path when needed, then reuses the standard Android smoke flow
to install and launch the app.

Environment overrides:
  ANDROID_SDK_ROOT       Android SDK root (default: \$HOME/.local/android)
  ADB                    Explicit adb path
  ADB_SERIAL             Explicit adb serial/device id
  APK_PATH               Release APK to test
  APP_PACKAGE            Android package name (default: com.starlog.app)
  APP_ACTIVITY           Launch activity component (default: package/.dev.MainActivity)
  WINDOWS_TEMP_ROOT      Windows-visible temp root for staged APKs (default: /mnt/c/Temp)
  WINDOWS_APK_PATH      Explicit Windows-visible APK path to stage/install
  STAGE_TO_WINDOWS      Set to 0 to skip staging the APK into a Windows-visible path
  VERIFY_HERMES         Set to 0 to skip APK native-lib preflight
  PRECHECK_ONLY         Set to 1 to stop after APK verification/staging
  SCREENSHOT_PATH       Optional path for a post-launch screenshot
  CRASH_LOG_PATH        Optional path for crash-log capture after launch
  REVERSE_PORTS         Comma-separated ports to adb reverse before launch
  INSTALL_TIMEOUT_SECONDS  APK install retry timeout passed to the smoke helper
  WAIT_TIMEOUT_SECONDS   Device/package-manager wait timeout passed to the smoke helper
EOF
}

log() {
  printf '[android-release-smoke] %s\n' "$1"
}

require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "$path" ]]; then
    printf '%s not found: %s\n' "$label" "$path" >&2
    exit 1
  fi
}

require_command_or_file() {
  local value="$1"
  local label="$2"
  if [[ -f "$value" ]] || command -v "$value" >/dev/null 2>&1; then
    return
  fi
  printf '%s not found: %s\n' "$label" "$value" >&2
  exit 1
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

adb_cmd() {
  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB" -s "$ADB_SERIAL" "$@"
    return
  fi
  "$ADB" "$@"
}

stage_apk_to_windows() {
  if [[ "$STAGE_TO_WINDOWS" == "0" ]]; then
    return
  fi

  if [[ "$APK_PATH" == /mnt/c/* || "$APK_PATH" == /mnt/d/* || "$APK_PATH" == /mnt/e/* ]]; then
    return
  fi

  mkdir -p "$(dirname "$WINDOWS_APK_PATH")"
  cp "$APK_PATH" "$WINDOWS_APK_PATH"
  log "Staged APK to $WINDOWS_APK_PATH"
  APK_PATH="$WINDOWS_APK_PATH"
}

verify_hermes_runtime() {
  if [[ "$VERIFY_HERMES" == "0" ]]; then
    return
  fi

  python3 - "$APK_PATH" <<'PY'
import sys
import zipfile

apk_path = sys.argv[1]
required = ("libhermes.so", "libhermes_executor.so")

with zipfile.ZipFile(apk_path) as apk:
    names = set(apk.namelist())

missing = []
for lib in required:
    if not any(name.startswith("lib/") and name.endswith(f"/{lib}") for name in names):
        missing.append(lib)

if missing:
    print(
        "Missing Hermes runtime libs: " + ", ".join(missing),
        file=sys.stderr,
    )
    print(
        "This APK matches the broken bundleRelease/signed sideload shape and should not be installed.",
        file=sys.stderr,
    )
    sys.exit(1)

print("[android-release-smoke] APK contains Hermes runtime libs")
PY
}

resolve_install_apk_path() {
  if [[ "$ADB" == *.exe ]]; then
    to_windows_path "$APK_PATH"
    return
  fi
  printf '%s' "$APK_PATH"
}

capture_crash_log() {
  local crash_log
  crash_log="$(adb_cmd logcat -d -b crash -v time 2>/dev/null || true)"
  if [[ -n "$CRASH_LOG_PATH" ]]; then
    mkdir -p "$(dirname "$CRASH_LOG_PATH")"
    printf '%s\n' "$crash_log" > "$CRASH_LOG_PATH"
  fi

  if [[ -z "$crash_log" ]]; then
    return
  fi

  if grep -Eq 'FATAL EXCEPTION|JavascriptException|com\.starlog\.app' <<<"$crash_log"; then
    printf '%s\n' "$crash_log" >&2
    printf 'Release smoke detected a crash after launch.\n' >&2
    exit 1
  fi
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$APK_PATH" ]]; then
  printf 'APK_PATH is required.\n' >&2
  usage >&2
  exit 1
fi

require_file "$APK_PATH" "APK"
require_command_or_file "$ADB" "adb"
verify_hermes_runtime
stage_apk_to_windows
INSTALL_APK_PATH="$(resolve_install_apk_path)"

if [[ "$PRECHECK_ONLY" == "1" ]]; then
  log "Precheck only requested; skipping install and launch"
  exit 0
fi

if [[ -n "$CRASH_LOG_PATH" ]]; then
  mkdir -p "$(dirname "$CRASH_LOG_PATH")"
fi

log "Clearing old crash buffer"
adb_cmd logcat -c >/dev/null 2>&1 || true

log "Installing and launching release APK"
APP_PACKAGE="$APP_PACKAGE" \
APP_ACTIVITY="$APP_ACTIVITY" \
APK_PATH="$INSTALL_APK_PATH" \
ADB="$ADB" \
ADB_SERIAL="$ADB_SERIAL" \
INSTALL_TIMEOUT_SECONDS="$INSTALL_TIMEOUT_SECONDS" \
REVERSE_PORTS="$REVERSE_PORTS" \
SKIP_DEEP_LINK=1 \
SKIP_TEXT_SHARE=1 \
WAIT_TIMEOUT_SECONDS="$WAIT_TIMEOUT_SECONDS" \
"$ROOT_DIR/scripts/android_native_smoke.sh"

capture_crash_log

if [[ -n "$SCREENSHOT_PATH" ]]; then
  mkdir -p "$(dirname "$SCREENSHOT_PATH")"
  adb_cmd exec-out screencap -p > "$SCREENSHOT_PATH"
  log "Captured screenshot to $SCREENSHOT_PATH"
fi

log "Release smoke completed"
