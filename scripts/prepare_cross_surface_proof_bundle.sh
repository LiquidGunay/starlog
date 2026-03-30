#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${1:-$(date -u +"%Y%m%dT%H%M%SZ")}"
BUNDLE_ROOT="${CROSS_SURFACE_PROOF_ROOT:-${VALIDATION_ROOT:-$ROOT_DIR}}"
BUNDLE_DIR="$BUNDLE_ROOT/artifacts/cross-surface-proof/$STAMP"
BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
WORKITEM_ID="${STARLOG_CROSS_SURFACE_WORKITEM_ID:-cross-surface-proof}"

mkdir -p \
  "$BUNDLE_DIR/hosted-pwa" \
  "$BUNDLE_DIR/phone-app" \
  "$BUNDLE_DIR/desktop-helper" \
  "$BUNDLE_DIR/logs"

cat >"$BUNDLE_DIR/manifest.json" <<EOF
{
  "generated_at_utc": "$GENERATED_AT",
  "workitem_id": "$WORKITEM_ID",
  "branch": "$BRANCH",
  "bundle_dir": "${BUNDLE_DIR#$BUNDLE_ROOT/}",
  "targets": [
    {
      "id": "hosted-pwa",
      "path": "${BUNDLE_DIR#$BUNDLE_ROOT/}/hosted-pwa",
      "expected_files": [
        "hosted-smoke-summary.txt",
        "pwa-proof.json",
        "pwa-assistant-thread.png",
        "pwa-artifacts-desktop-clip.png"
      ]
    },
    {
      "id": "phone-app",
      "path": "${BUNDLE_DIR#$BUNDLE_ROOT/}/phone-app",
      "expected_files": [
        "adb-devices.txt",
        "metro-relay.txt",
        "android-smoke.txt",
        "phone-capture.png"
      ]
    },
    {
      "id": "desktop-helper",
      "path": "${BUNDLE_DIR#$BUNDLE_ROOT/}/desktop-helper",
      "expected_files": [
        "adb-devices.txt",
        "windows-host-probes.txt",
        "windows-host-probes.json",
        "helper-playwright.txt",
        "desktop-helper-workspace-config.png",
        "desktop-helper-quick-popup.png",
        "desktop-helper-workspace-diagnostics.png",
        "screenshots.json"
      ]
    }
  ]
}
EOF

cat >"$BUNDLE_DIR/README.md" <<EOF
# Cross-Surface Proof Bundle

Generated at: \`$GENERATED_AT\`
Workitem: \`$WORKITEM_ID\`
Branch: \`$BRANCH\`

This folder is the evidence container for one repeatable Starlog cross-surface proof pass across:

- hosted PWA
- installed Android phone app
- desktop helper

## Subfolders

- \`hosted-pwa/\` for hosted smoke logs, Playwright screenshots, and cross-surface PWA proof output
- \`phone-app/\` for Android smoke logs, relay logs, and phone screenshots
- \`desktop-helper/\` for helper smoke output, Windows host probes, and helper screenshots
- \`logs/\` for any supervisor notes or merged command logs

The canonical runbook for populating this bundle is:

- \`docs/CROSS_SURFACE_PROOF.md\`
EOF

echo "$BUNDLE_DIR"
