#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

args=(
  --skip-git-tag
  --bundle-root "${BUNDLE_ROOT:-/home/ubuntu/starlog_preview_bundle}"
  --tarball "${TARBALL_PATH:-/home/ubuntu/starlog-preview-feedback-bundle-$(date -u +%Y%m%d).tar.gz}"
)

if [[ -n "${APK_SOURCE:-}" ]]; then
  args+=(--apk-source "${APK_SOURCE}")
fi
if [[ -n "${APK_TARGET_NAME:-}" ]]; then
  args+=(--apk-target-name "${APK_TARGET_NAME}")
fi
if [[ -n "${DESKTOP_SOURCE:-}" ]]; then
  args+=(--desktop-source "${DESKTOP_SOURCE}")
fi
if [[ -n "${DESKTOP_TARGET_NAME:-}" ]]; then
  args+=(--desktop-target-name "${DESKTOP_TARGET_NAME}")
fi
if [[ -n "${STARLOG_RELEASE_DOC:-}" ]]; then
  args+=(--release-doc "${STARLOG_RELEASE_DOC}")
fi
if [[ -n "${STARLOG_RELEASE_RUNBOOK_DOC:-}" ]]; then
  args+=(--runbook-doc "${STARLOG_RELEASE_RUNBOOK_DOC}")
fi

exec python3 "${ROOT_DIR}/scripts/release_handoff.py" "${args[@]}"
