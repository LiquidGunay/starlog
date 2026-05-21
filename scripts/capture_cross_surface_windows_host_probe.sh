#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${1:-$(date -u +"%Y%m%dT%H%M%SZ")}"
BUNDLE_DIR="${STARLOG_CROSS_SURFACE_PROOF_BUNDLE_DIR:-$ROOT_DIR/.localdata/cross-surface-proof/latest}"
WINDOWS_DIR="$BUNDLE_DIR/desktop-helper"
ADB_WIN="${ADB_WIN:-/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe}"
GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

require_safe_bundle_dir() {
  local path="$1"
  local lane_suffix="/.localdata/cross-surface-proof/latest"
  local worktree_parent
  worktree_parent="$(dirname "$ROOT_DIR")"

  if [[ -z "$path" || "$path" != /* ]]; then
    echo "refusing unsafe cross-surface bundle dir: $path" >&2
    exit 1
  fi
  path="$(realpath -m "$path")"
  if [[ "$path" == "$ROOT_DIR/artifacts" || "$path" == "$ROOT_DIR/artifacts/"* ]]; then
    echo "refusing cross-surface bundle dir under tracked artifacts root: $path" >&2
    exit 1
  fi
  if [[ "$path" == "/" || "$path" == "/tmp" || "$path" == "/tmp/"* || "$path" == "$ROOT_DIR" || "$path" == "$ROOT_DIR/.localdata" || "$path" == "$worktree_parent" ]]; then
    echo "refusing unsafe cross-surface bundle dir: $path" >&2
    exit 1
  fi
  if [[ "$path" != *"$lane_suffix" ]]; then
    echo "cross-surface bundle dir must end with $lane_suffix: $path" >&2
    exit 1
  fi
}

require_safe_bundle_dir "$BUNDLE_DIR"
BUNDLE_DIR="$(realpath -m "$BUNDLE_DIR")"
WINDOWS_DIR="$BUNDLE_DIR/desktop-helper"

mkdir -p "$WINDOWS_DIR"

ADB_OUTPUT="$("$ADB_WIN" devices -l)"
PS_OUTPUT="$(
  powershell.exe -NoProfile -Command '$ver=$PSVersionTable.PSVersion.ToString(); Write-Output ("PS=" + $ver); try { $clip = Get-Clipboard -Raw; Write-Output ("CLIP_LEN=" + $clip.Length) } catch { Write-Output ("CLIP_ERR=" + $_.Exception.Message) } try { $tess = (Get-Command tesseract -ErrorAction Stop).Source; Write-Output ("TESSERACT=" + $tess) } catch { Write-Output ("TESSERACT=missing") }'
)"

printf '%s\n' "$ADB_OUTPUT" >"$WINDOWS_DIR/adb-devices.txt"
printf '%s\n' "$PS_OUTPUT" >"$WINDOWS_DIR/windows-host-probes.txt"

python3 - <<'PY' "$WINDOWS_DIR/windows-host-probes.json" "$GENERATED_AT" "$ADB_OUTPUT" "$PS_OUTPUT"
import json
import sys

output_path, generated_at, adb_output, ps_output = sys.argv[1:5]
payload = {
    "generated_at_utc": generated_at,
    "adb_devices_raw": adb_output.splitlines(),
    "powershell_probe_raw": ps_output.splitlines(),
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")
PY

echo "$WINDOWS_DIR"
