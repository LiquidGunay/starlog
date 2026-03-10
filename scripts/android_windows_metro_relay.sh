#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LISTEN_HOST="${LISTEN_HOST:-0.0.0.0}"
LISTEN_PORT="${LISTEN_PORT:-8081}"
TARGET_HOST="${TARGET_HOST:-}"
TARGET_PORT="${TARGET_PORT:-8081}"
RELAY_LABEL="${RELAY_LABEL:-android-metro-relay}"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Starts a Windows-side TCP relay from a WSL checkout so Android devices on the
same LAN can reach the WSL Metro server reliably.

Environment overrides:
  LISTEN_HOST   Windows bind host (default: 0.0.0.0)
  LISTEN_PORT   Windows bind port (default: 8081)
  TARGET_HOST   WSL target host (default: current WSL interface IP)
  TARGET_PORT   WSL target port (default: 8081)
  RELAY_LABEL   Log label (default: android-metro-relay)
EOF
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v cmd.exe >/dev/null 2>&1; then
  printf 'cmd.exe is required for the Windows relay helper.\n' >&2
  exit 1
fi

if ! command -v wslpath >/dev/null 2>&1; then
  printf 'wslpath is required for the Windows relay helper.\n' >&2
  exit 1
fi

if [[ -z "$TARGET_HOST" ]]; then
  TARGET_HOST="$(ip route get 1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
fi

if [[ -z "$TARGET_HOST" ]]; then
  printf 'Unable to determine WSL target host. Set TARGET_HOST explicitly.\n' >&2
  exit 1
fi

WINDOWS_PYTHON_RAW="$(cmd.exe /d /c where python 2>NUL | tr -d '\r' | head -n 1)"
if [[ -z "$WINDOWS_PYTHON_RAW" ]]; then
  printf 'Windows python was not found. Install Python on Windows or set up an equivalent relay manually.\n' >&2
  exit 1
fi

WINDOWS_PYTHON="$(wslpath -u "$WINDOWS_PYTHON_RAW")"
RELAY_SCRIPT_WIN="$(wslpath -w "$ROOT_DIR/scripts/tcp_relay.py" | tr -d '\r')"

exec "$WINDOWS_PYTHON" "$RELAY_SCRIPT_WIN" \
  --listen-host "$LISTEN_HOST" \
  --listen-port "$LISTEN_PORT" \
  --target-host "$TARGET_HOST" \
  --target-port "$TARGET_PORT" \
  --label "$RELAY_LABEL"
