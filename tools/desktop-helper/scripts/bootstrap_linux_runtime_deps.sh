#!/usr/bin/env bash
set -euo pipefail

MODE="print"
OUTPUT_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      MODE="install"
      shift
      ;;
    --output-json)
      OUTPUT_PATH="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f /etc/os-release ]]; then
  echo "This bootstrap currently supports Linux hosts with /etc/os-release." >&2
  exit 2
fi

# shellcheck disable=SC1091
source /etc/os-release
DISTRO_ID="${ID:-linux}"
DISTRO_VERSION="${VERSION_ID:-unknown}"
SESSION_HINTS=()
PACKAGES=()

if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
  SESSION_HINTS+=("wayland")
  PACKAGES+=(wl-clipboard grim slurp)
fi
if [[ -n "${DISPLAY:-}" ]]; then
  SESSION_HINTS+=("x11")
  PACKAGES+=(xclip scrot xdotool)
fi
PACKAGES+=(gnome-screenshot imagemagick tesseract-ocr ffmpeg)

seen=" "
UNIQUE_PACKAGES=()
for pkg in "${PACKAGES[@]}"; do
  if [[ "${seen}" != *" ${pkg} "* ]]; then
    UNIQUE_PACKAGES+=("${pkg}")
    seen="${seen}${pkg} "
  fi
done

INSTALL_CMD=""
if [[ "${DISTRO_ID}" =~ ^(ubuntu|debian)$ ]]; then
  INSTALL_CMD="sudo apt-get update && sudo apt-get install -y ${UNIQUE_PACKAGES[*]}"
else
  INSTALL_CMD="Install equivalent clipboard/screenshot/window/OCR/ffmpeg packages for ${DISTRO_ID}."
fi

SUDO_READY="false"
if sudo -n true >/dev/null 2>&1; then
  SUDO_READY="true"
fi

BLOCKER=""
if [[ "${SUDO_READY}" != "true" ]]; then
  BLOCKER="interactive sudo is required on this host to install Linux runtime packages"
fi
if [[ "${MODE}" == "install" ]]; then
  if [[ -n "${BLOCKER}" ]]; then
    echo "${BLOCKER}" >&2
    echo "Run this manually:" >&2
    echo "  ${INSTALL_CMD}" >&2
    exit 1
  fi
  eval "${INSTALL_CMD}"
fi

if [[ -n "${OUTPUT_PATH}" ]]; then
  mkdir -p "$(dirname "${OUTPUT_PATH}")"
  {
    echo "{"
    echo "  \"generated_at_utc\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
    echo "  \"distro_id\": \"${DISTRO_ID}\","
    echo "  \"distro_version\": \"${DISTRO_VERSION}\","
    echo "  \"session_hints\": \"${SESSION_HINTS[*]}\","
    echo "  \"sudo_passwordless\": ${SUDO_READY},"
    echo "  \"install_command\": \"${INSTALL_CMD//\"/\\\"}\","
    if [[ -n "${BLOCKER}" ]]; then
      echo "  \"blocker\": \"${BLOCKER//\"/\\\"}\","
    fi
    echo -n "  \"packages\": ["
    for i in "${!UNIQUE_PACKAGES[@]}"; do
      if [[ "${i}" -gt 0 ]]; then
        echo -n ", "
      fi
      echo -n "\"${UNIQUE_PACKAGES[$i]}\""
    done
    echo "]"
    echo "}"
  } > "${OUTPUT_PATH}"
fi

echo "Linux desktop helper bootstrap"
echo "  distro: ${DISTRO_ID} ${DISTRO_VERSION}"
echo "  sessions: ${SESSION_HINTS[*]:-unknown}"
echo "  passwordless sudo: ${SUDO_READY}"
echo "  install command:"
echo "    ${INSTALL_CMD}"
if [[ -n "${BLOCKER}" ]]; then
  echo "  blocker: ${BLOCKER}"
fi
