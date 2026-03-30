#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${1:-$(date -u +"%Y%m%dT%H%M%SZ")}"
BUNDLE_ROOT="${CROSS_SURFACE_PROOF_ROOT:-${VALIDATION_ROOT:-$ROOT_DIR}}"
BUNDLE_DIR="$BUNDLE_ROOT/artifacts/cross-surface-proof/$STAMP"
WINDOWS_DIR="$BUNDLE_DIR/desktop-helper"
ADB_WIN="${ADB_WIN:-/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe}"
GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

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
