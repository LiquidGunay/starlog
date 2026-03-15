#!/usr/bin/env bash
set -euo pipefail

TARGET_RAW="${1:-$(uname -s)}"
TARGET="$(printf '%s' "${TARGET_RAW}" | tr '[:upper:]' '[:lower:]')"

if [[ "${TARGET}" == "darwin" ]]; then
  TARGET="macos"
elif [[ "${TARGET}" == mingw* || "${TARGET}" == msys* || "${TARGET}" == cygwin* ]]; then
  TARGET="windows"
fi

errors=0

print_status() {
  local status="$1"
  local label="$2"
  local detail="$3"
  printf '[%s] %s: %s\n' "${status}" "${label}" "${detail}"
}

require_env() {
  local var_name="$1"
  if [ -n "${!var_name:-}" ]; then
    print_status "ok" "env:${var_name}" "configured"
  else
    print_status "missing" "env:${var_name}" "not configured"
    errors=$((errors + 1))
  fi
}

check_command() {
  local command_name="$1"
  if command -v "${command_name}" >/dev/null 2>&1; then
    print_status "ok" "cmd:${command_name}" "available"
  else
    print_status "missing" "cmd:${command_name}" "not found on PATH"
    errors=$((errors + 1))
  fi
}

check_macos() {
  echo "Target: macOS signing + notarization"
  require_env APPLE_CERTIFICATE
  require_env APPLE_CERTIFICATE_PASSWORD
  require_env APPLE_API_KEY
  require_env APPLE_API_ISSUER
  require_env APPLE_API_KEY_PATH
  require_env APPLE_TEAM_ID
}

check_windows() {
  echo "Target: Windows code signing"
  check_command signtool

  local has_cert_blob=0
  local has_cert_sha=0

  if [ -n "${WINDOWS_CERTIFICATE:-}" ] && [ -n "${WINDOWS_CERTIFICATE_PASSWORD:-}" ]; then
    has_cert_blob=1
    print_status "ok" "env:WINDOWS_CERTIFICATE + WINDOWS_CERTIFICATE_PASSWORD" "configured"
  fi

  if [ -n "${WINDOWS_CERTIFICATE_SHA1:-}" ]; then
    has_cert_sha=1
    print_status "ok" "env:WINDOWS_CERTIFICATE_SHA1" "configured"
  fi

  if [ "${has_cert_blob}" -eq 0 ] && [ "${has_cert_sha}" -eq 0 ]; then
    print_status "missing" "windows certificate" "set WINDOWS_CERTIFICATE+WINDOWS_CERTIFICATE_PASSWORD or WINDOWS_CERTIFICATE_SHA1"
    errors=$((errors + 1))
  fi
}

check_linux() {
  echo "Target: Linux package signing (optional for personal distribution, recommended for public release)"

  if command -v gpg >/dev/null 2>&1; then
    print_status "ok" "cmd:gpg" "available"
  else
    print_status "warn" "cmd:gpg" "not found; .deb/.rpm signatures cannot be produced"
  fi

  if command -v dpkg-sig >/dev/null 2>&1; then
    print_status "ok" "cmd:dpkg-sig" "available"
  else
    print_status "warn" "cmd:dpkg-sig" "not found; Debian package signing step will be skipped"
  fi

  if command -v rpmsign >/dev/null 2>&1; then
    print_status "ok" "cmd:rpmsign" "available"
  else
    print_status "warn" "cmd:rpmsign" "not found; RPM package signing step will be skipped"
  fi
}

case "${TARGET}" in
  macos)
    check_macos
    ;;
  windows)
    check_windows
    ;;
  linux)
    check_linux
    ;;
  all)
    check_linux
    check_windows
    check_macos
    ;;
  *)
    echo "Unsupported target '${TARGET_RAW}'. Use one of: linux | windows | macos | all." >&2
    exit 2
    ;;
esac

if [ "${errors}" -gt 0 ]; then
  echo "Signing readiness check failed with ${errors} missing requirement(s)." >&2
  exit 1
fi

echo "Signing readiness check completed."
