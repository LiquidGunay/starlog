#!/usr/bin/env bash
set -euo pipefail

TARGET_RAW="${1:-$(uname -s)}"
TARGET="$(printf '%s' "${TARGET_RAW}" | tr '[:upper:]' '[:lower:]')"
OUTPUT_PATH="${2:-}"

if [[ "${TARGET}" == "darwin" ]]; then
  TARGET="macos"
elif [[ "${TARGET}" == mingw* || "${TARGET}" == msys* || "${TARGET}" == cygwin* ]]; then
  TARGET="windows"
fi

have_command() {
  command -v "$1" >/dev/null 2>&1
}

join_by_comma() {
  local first=1
  local item
  for item in "$@"; do
    if [ "${first}" -eq 1 ]; then
      printf '%s' "${item}"
      first=0
    else
      printf ',%s' "${item}"
    fi
  done
}

report_lines=()
json_lines=()

append_result() {
  local capability="$1"
  local status="$2"
  local detail="$3"
  report_lines+=("${capability}|${status}|${detail}")
  json_lines+=("  \"${capability}\": {\"status\": \"${status}\", \"detail\": \"${detail//\"/\\\"}\"}")
}

if [ "${TARGET}" = "linux" ]; then
  clipboard_backends=()
  screenshot_backends=()
  window_backends=()

  for cmd in wl-paste xclip xsel; do
    if have_command "${cmd}"; then
      clipboard_backends+=("${cmd}")
    fi
  done

  if have_command grim && have_command slurp; then
    screenshot_backends+=("grim+slurp")
  fi
  for cmd in gnome-screenshot import grim scrot; do
    if have_command "${cmd}"; then
      screenshot_backends+=("${cmd}")
    fi
  done

  for cmd in xdotool hyprctl; do
    if have_command "${cmd}"; then
      window_backends+=("${cmd}")
    fi
  done

  if [ "${#clipboard_backends[@]}" -gt 0 ]; then
    append_result "clipboard" "ready" "backends=$(join_by_comma "${clipboard_backends[@]}")"
  else
    append_result "clipboard" "missing" "install wl-paste, xclip, or xsel"
  fi

  if [ "${#screenshot_backends[@]}" -gt 0 ]; then
    append_result "screenshot" "ready" "backends=$(join_by_comma "${screenshot_backends[@]}")"
  else
    append_result "screenshot" "missing" "install grim+slurp, gnome-screenshot, ImageMagick import, or scrot"
  fi

  if [ "${#window_backends[@]}" -gt 0 ]; then
    append_result "active_window" "ready" "backends=$(join_by_comma "${window_backends[@]}")"
  else
    append_result "active_window" "degraded" "install xdotool (X11) or hyprctl (Hyprland) for richer metadata"
  fi

  if have_command tesseract; then
    append_result "ocr" "ready" "tesseract available"
  else
    append_result "ocr" "degraded" "install tesseract for local OCR"
  fi
elif [ "${TARGET}" = "macos" ]; then
  if have_command pbpaste; then
    append_result "clipboard" "ready" "pbpaste available"
  else
    append_result "clipboard" "missing" "pbpaste is required"
  fi

  if have_command screencapture; then
    append_result "screenshot" "ready" "screencapture available"
  else
    append_result "screenshot" "missing" "screencapture is required"
  fi

  if have_command osascript; then
    append_result "active_window" "ready" "osascript available (requires Automation permission)"
  else
    append_result "active_window" "degraded" "osascript missing; active-window metadata will degrade"
  fi

  if have_command tesseract; then
    append_result "ocr" "ready" "tesseract available"
  else
    append_result "ocr" "degraded" "install tesseract for local OCR"
  fi
elif [ "${TARGET}" = "windows" ]; then
  if have_command powershell.exe || have_command powershell; then
    append_result "clipboard" "ready" "PowerShell available"
    append_result "screenshot" "ready" "PowerShell screenshot backend available"
    append_result "active_window" "ready" "PowerShell user32 probe backend available"
  else
    append_result "clipboard" "missing" "PowerShell is required"
    append_result "screenshot" "missing" "PowerShell is required"
    append_result "active_window" "missing" "PowerShell is required"
  fi

  if have_command tesseract; then
    append_result "ocr" "ready" "tesseract available"
  else
    append_result "ocr" "degraded" "install tesseract on PATH for local OCR"
  fi
else
  echo "Unsupported target '${TARGET_RAW}'. Use linux|macos|windows." >&2
  exit 2
fi

printf '%-16s %-10s %s\n' "Capability" "Status" "Detail"
printf '%-16s %-10s %s\n' "----------" "------" "------"

for line in "${report_lines[@]}"; do
  capability="${line%%|*}"
  rest="${line#*|}"
  status="${rest%%|*}"
  detail="${rest#*|}"
  printf '%-16s %-10s %s\n' "${capability}" "${status}" "${detail}"
done

if [ -n "${OUTPUT_PATH}" ]; then
  mkdir -p "$(dirname "${OUTPUT_PATH}")"
  {
    echo "{"
    echo "  \"generated_at_utc\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
    echo "  \"target\": \"${TARGET}\","
    for i in "${!json_lines[@]}"; do
      line="${json_lines[$i]}"
      if [ "${i}" -lt "$(( ${#json_lines[@]} - 1 ))" ]; then
        echo "${line},"
      else
        echo "${line}"
      fi
    done
    echo "}"
  } > "${OUTPUT_PATH}"
  echo "Wrote ${OUTPUT_PATH}"
fi
