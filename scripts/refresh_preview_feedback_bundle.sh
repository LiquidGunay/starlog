#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ROOT="${BUNDLE_ROOT:-/home/ubuntu/starlog_preview_bundle}"
TARBALL_PATH="${TARBALL_PATH:-/home/ubuntu/starlog-preview-feedback-bundle-$(date -u +%Y%m%d).tar.gz}"
APK_SOURCE="${APK_SOURCE:-}"
APK_TARGET_NAME="${APK_TARGET_NAME:-}"

mkdir -p "${BUNDLE_ROOT}/android" "${BUNDLE_ROOT}/desktop" "${BUNDLE_ROOT}/docs/evidence/mobile" "${BUNDLE_ROOT}/evidence"

if [[ -n "${APK_SOURCE}" ]]; then
  if [[ ! -f "${APK_SOURCE}" ]]; then
    echo "APK_SOURCE not found: ${APK_SOURCE}" >&2
    exit 1
  fi
  if [[ -z "${APK_TARGET_NAME}" ]]; then
    APK_TARGET_NAME="$(basename "${APK_SOURCE}")"
  fi
  install -m 0644 "${APK_SOURCE}" "${BUNDLE_ROOT}/android/${APK_TARGET_NAME}"
fi

CURRENT_APK_PATH=""
if [[ -n "${APK_TARGET_NAME}" && -f "${BUNDLE_ROOT}/android/${APK_TARGET_NAME}" ]]; then
  CURRENT_APK_PATH="${BUNDLE_ROOT}/android/${APK_TARGET_NAME}"
else
  CURRENT_APK_PATH="$(find "${BUNDLE_ROOT}/android" -maxdepth 1 -type f -name 'starlog-preview-*.apk' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
fi

if [[ -z "${CURRENT_APK_PATH}" || ! -f "${CURRENT_APK_PATH}" ]]; then
  echo "No preview APK available under ${BUNDLE_ROOT}/android" >&2
  exit 1
fi

find "${BUNDLE_ROOT}/android" -maxdepth 1 -type f -name 'starlog-preview-*.apk' ! -path "${CURRENT_APK_PATH}" -delete

install -m 0644 "${ROOT_DIR}/README.md" "${BUNDLE_ROOT}/README.md"
install -m 0644 "${ROOT_DIR}/docs/PREVIEW_FEEDBACK_BUNDLE.md" "${BUNDLE_ROOT}/docs/PREVIEW_FEEDBACK_BUNDLE.md"
install -m 0644 "${ROOT_DIR}/docs/FINAL_PREVIEW_SIGNOFF.md" "${BUNDLE_ROOT}/docs/FINAL_PREVIEW_SIGNOFF.md"
install -m 0644 "${ROOT_DIR}/docs/ANDROID_RELEASE_QA_MATRIX.md" "${BUNDLE_ROOT}/docs/ANDROID_RELEASE_QA_MATRIX.md"
install -m 0644 "${ROOT_DIR}/docs/evidence/mobile/wi-601-phone-proof.md" "${BUNDLE_ROOT}/docs/evidence/mobile/wi-601-phone-proof.md"

sha256sum "${CURRENT_APK_PATH}" "${BUNDLE_ROOT}/desktop/"*.deb > "${BUNDLE_ROOT}/checksums.sha256"

tar -czf "${TARBALL_PATH}" -C "$(dirname "${BUNDLE_ROOT}")" "$(basename "${BUNDLE_ROOT}")"

echo "Refreshed preview bundle:"
echo "  bundle: ${BUNDLE_ROOT}"
echo "  apk: ${CURRENT_APK_PATH}"
echo "  tarball: ${TARBALL_PATH}"
