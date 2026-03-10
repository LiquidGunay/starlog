#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/.local/android}}"
ADB="${ADB:-$ANDROID_SDK_ROOT/platform-tools/adb}"
ADB_SERIAL="${ADB_SERIAL:-}"
DEV_CLIENT_SCHEME="${DEV_CLIENT_SCHEME:-exp+starlog}"
METRO_HOST="${METRO_HOST:-${REACT_NATIVE_PACKAGER_HOSTNAME:-}}"
METRO_PORT="${METRO_PORT:-8081}"
DEV_CLIENT_URL="${DEV_CLIENT_URL:-}"
PRINT_URL_ONLY="${PRINT_URL_ONLY:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Builds and opens the Expo development-client URL for the Starlog Android app.

Environment overrides:
  ANDROID_SDK_ROOT   Android SDK root (default: \$HOME/.local/android)
  ADB                Explicit adb path
  ADB_SERIAL         Explicit adb serial/device id
  DEV_CLIENT_SCHEME  Dev client URL scheme (default: exp+starlog)
  METRO_HOST         Hostname/IP exposed to the phone (required unless DEV_CLIENT_URL is set)
  METRO_PORT         Metro port (default: 8081)
  DEV_CLIENT_URL     Explicit exp+starlog://... URL override
  PRINT_URL_ONLY     Set to 1 to print the URL without opening it
EOF
}

adb_cmd() {
  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB" -s "$ADB_SERIAL" "$@"
    return
  fi
  "$ADB" "$@"
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$ADB" ]] && ! command -v "$ADB" >/dev/null 2>&1; then
  printf 'adb not found: %s\n' "$ADB" >&2
  exit 1
fi

if [[ -z "$DEV_CLIENT_URL" ]]; then
  if [[ -z "$METRO_HOST" ]]; then
    printf 'METRO_HOST or DEV_CLIENT_URL is required.\n' >&2
    exit 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    printf 'python3 is required to encode the development-client URL.\n' >&2
    exit 1
  fi

  DEV_CLIENT_URL="$(
    python3 - "$DEV_CLIENT_SCHEME" "$METRO_HOST" "$METRO_PORT" <<'PY'
import sys
from urllib.parse import quote

scheme, host, port = sys.argv[1:]
url = f"http://{host}:{port}"
print(f"{scheme}://expo-development-client/?url={quote(url, safe='')}")
PY
  )"
fi

printf '%s\n' "$DEV_CLIENT_URL"

if [[ "$PRINT_URL_ONLY" == "1" ]]; then
  exit 0
fi

adb_cmd shell am start -W -a android.intent.action.VIEW -d "$DEV_CLIENT_URL" >/dev/null
