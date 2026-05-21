#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${1:-$(date -u +"%Y%m%dT%H%M%SZ")}"
BUNDLE_DIR="${STARLOG_CROSS_SURFACE_PROOF_BUNDLE_DIR:-$ROOT_DIR/.localdata/cross-surface-proof/latest}"
BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
WORKITEM_ID="${STARLOG_CROSS_SURFACE_WORKITEM_ID:-cross-surface-proof}"

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

rm -rf "$BUNDLE_DIR"

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
  "bundle_dir": "$BUNDLE_DIR",
  "targets": [
    {
      "id": "hosted-pwa",
      "path": "$BUNDLE_DIR/hosted-pwa",
      "expected_files": [
        "hosted-smoke-summary.txt",
        "pwa-proof.json",
        "pwa-assistant-thread.png",
        "pwa-artifacts-desktop-clip.png"
      ]
    },
    {
      "id": "phone-app",
      "path": "$BUNDLE_DIR/phone-app",
      "expected_files": [
        "adb-devices.txt",
        "metro-relay.txt",
        "android-smoke.txt",
        "phone-capture.png"
      ]
    },
    {
      "id": "desktop-helper",
      "path": "$BUNDLE_DIR/desktop-helper",
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
