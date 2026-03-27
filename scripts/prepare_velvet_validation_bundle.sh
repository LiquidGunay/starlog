#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${1:-$(date -u +"%Y%m%dT%H%M%SZ")}"
BUNDLE_DIR="$ROOT_DIR/artifacts/velvet-validation/$STAMP"
BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

mkdir -p \
  "$BUNDLE_DIR/pwa-proof" \
  "$BUNDLE_DIR/android-phone" \
  "$BUNDLE_DIR/windows-helper" \
  "$BUNDLE_DIR/logs"

cat >"$BUNDLE_DIR/manifest.json" <<EOF
{
  "generated_at_utc": "$GENERATED_AT",
  "workitem_id": "WI-613",
  "branch": "$BRANCH",
  "bundle_dir": "${BUNDLE_DIR#$ROOT_DIR/}",
  "targets": [
    {
      "id": "pwa-proof",
      "path": "${BUNDLE_DIR#$ROOT_DIR/}/pwa-proof",
      "expected_files": [
        "pwa-assistant-thread.png",
        "pwa-artifacts-desktop-clip.png",
        "pwa-proof.json"
      ]
    },
    {
      "id": "android-phone",
      "path": "${BUNDLE_DIR#$ROOT_DIR/}/android-phone",
      "expected_files": [
        "adb-devices.txt",
        "metro-relay.txt",
        "android-smoke.txt",
        "velvet-mobile-capture.png",
        "velvet-mobile-briefing.png"
      ]
    },
    {
      "id": "windows-helper",
      "path": "${BUNDLE_DIR#$ROOT_DIR/}/windows-helper",
      "expected_files": [
        "adb-devices.txt",
        "windows-host-probes.txt",
        "windows-host-probes.json",
        "helper-playwright.txt",
        "helper-popup.png",
        "helper-workspace.png"
      ]
    }
  ]
}
EOF

cat >"$BUNDLE_DIR/README.md" <<EOF
# Velvet Validation Bundle

Generated at: \`$GENERATED_AT\`
Workitem: \`WI-613\`
Branch: \`$BRANCH\`

This folder is the evidence container for one Velvet rollout validation pass.

## Subfolders

- \`pwa-proof/\` for PWA screenshots and proof JSON
- \`android-phone/\` for connected-phone relay logs, smoke logs, and screenshots
- \`windows-helper/\` for Windows host probes, helper Playwright output, and helper screenshots
- \`logs/\` for any extra supervisor notes or merged command logs

The canonical runbook for populating this bundle is:

- \`docs/VELVET_VALIDATION_MATRIX.md\`
EOF

echo "$BUNDLE_DIR"
