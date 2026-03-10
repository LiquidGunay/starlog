#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/.local/android}}"
JAVA_HOME="${JAVA_HOME:-$HOME/.local/jdks/temurin-17}"
EMULATOR="${EMULATOR:-$ANDROID_SDK_ROOT/emulator/emulator}"
AVD_NAME="${AVD_NAME:-}"
XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-$USER}"
EMULATOR_GPU="${EMULATOR_GPU:-swiftshader_indirect}"
EMULATOR_HEADLESS="${EMULATOR_HEADLESS:-1}"
EMULATOR_WIPE_DATA="${EMULATOR_WIPE_DATA:-0}"
EMULATOR_NO_SNAPSHOT="${EMULATOR_NO_SNAPSHOT:-1}"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Launches an Android emulator with the host-side wiring Starlog uses in this repo.

Environment overrides:
  ANDROID_SDK_ROOT       Android SDK root (default: \$HOME/.local/android)
  JAVA_HOME              JDK root for local SDK tools (default: \$HOME/.local/jdks/temurin-17)
  AVD_NAME               Explicit AVD to launch (default: starlog-api34-aosp, else starlog-api34-clean, else starlog-api34)
  XDG_RUNTIME_DIR        Writable runtime dir for emulator gRPC/jwk state
  EMULATOR_GPU           GPU mode (default: swiftshader_indirect)
  EMULATOR_HEADLESS      1 = use -no-window/-no-audio/-no-boot-anim (default), 0 = keep window
  EMULATOR_WIPE_DATA     1 = add -wipe-data for a cold reset
  EMULATOR_NO_SNAPSHOT   1 = add -no-snapshot (default), 0 = allow snapshots
EOF
}

require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -e "$path" ]]; then
    printf '%s not found: %s\n' "$label" "$path" >&2
    exit 1
  fi
}

pick_default_avd() {
  local avds
  mapfile -t avds < <("$EMULATOR" -list-avds 2>/dev/null)
  local candidate
  for candidate in starlog-api34-aosp starlog-api34-clean starlog-api34; do
    local avd
    for avd in "${avds[@]}"; do
      if [[ "$avd" == "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done
  done

  if (( ${#avds[@]} > 0 )); then
    printf '%s\n' "${avds[0]}"
    return 0
  fi

  return 1
}

sanitize_proxy_var() {
  local name="$1"
  local value="${!name-}"
  if [[ -n "$value" ]] && [[ ! "$value" =~ ^[A-Za-z][A-Za-z0-9+.-]*:// ]]; then
    unset "$name"
  fi
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_file "$EMULATOR" "emulator"
require_file "$ANDROID_SDK_ROOT/platform-tools/adb" "adb"
require_file "$JAVA_HOME/bin/java" "java"

sanitize_proxy_var HTTP_PROXY
sanitize_proxy_var HTTPS_PROXY
sanitize_proxy_var ALL_PROXY
sanitize_proxy_var http_proxy
sanitize_proxy_var https_proxy
sanitize_proxy_var all_proxy

mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

if [[ -z "$AVD_NAME" ]]; then
  AVD_NAME="$(pick_default_avd || true)"
fi

if [[ -z "$AVD_NAME" ]]; then
  printf 'No Android Virtual Device found. Create one first with avdmanager.\n' >&2
  exit 1
fi

export ANDROID_SDK_ROOT
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
export XDG_RUNTIME_DIR

args=("@$AVD_NAME" "-gpu" "$EMULATOR_GPU" "-no-metrics")

if [[ "$EMULATOR_HEADLESS" == "1" ]]; then
  args+=("-no-window" "-no-audio" "-no-boot-anim")
fi

if [[ "$EMULATOR_NO_SNAPSHOT" == "1" ]]; then
  args+=("-no-snapshot")
fi

if [[ "$EMULATOR_WIPE_DATA" == "1" ]]; then
  args+=("-wipe-data")
fi

if [[ ! -r /dev/kvm || ! -w /dev/kvm ]]; then
  args+=("-accel" "off")
fi

cd "$ROOT_DIR"
exec "$EMULATOR" "${args[@]}"
