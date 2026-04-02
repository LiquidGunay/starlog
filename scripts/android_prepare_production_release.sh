#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/apps/mobile"
ANDROID_DIR="${MOBILE_DIR}/android"
ARTIFACT_ROOT="${STARLOG_RELEASE_ARTIFACT_ROOT:-/home/ubuntu/starlog_production_bundle/android}"
BUILD_QA_APK="${STARLOG_BUILD_QA_APK:-1}"
STAGE_WINDOWS_APK="${STARLOG_STAGE_WINDOWS_APK:-0}"
WINDOWS_STAGE_DIR="${STARLOG_WINDOWS_STAGE_DIR:-/mnt/c/Temp}"
ALLOW_DEBUG_KEYSTORE_FOR_VALIDATION="${STARLOG_ALLOW_DEBUG_KEYSTORE_FOR_VALIDATION:-0}"

log() {
  printf '[android-production-release] %s\n' "$*"
}

fail() {
  printf '[android-production-release] %s\n' "$*" >&2
  exit 1
}

require_value() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value}" ]]; then
    fail "Missing required env var: ${name}"
  fi
}

VERSION_NAME="${STARLOG_VERSION_NAME:-${STARLOG_ANDROID_VERSION_NAME:-}}"
VERSION_CODE="${STARLOG_ANDROID_VERSION_CODE:-}"

require_value STARLOG_UPLOAD_STORE_FILE
require_value STARLOG_UPLOAD_STORE_PASSWORD
require_value STARLOG_UPLOAD_KEY_ALIAS
require_value STARLOG_UPLOAD_KEY_PASSWORD

if [[ -z "${VERSION_NAME}" ]]; then
  fail "Set STARLOG_VERSION_NAME or STARLOG_ANDROID_VERSION_NAME."
fi
if [[ -z "${VERSION_CODE}" ]]; then
  fail "Set STARLOG_ANDROID_VERSION_CODE."
fi
if [[ ! "${VERSION_CODE}" =~ ^[0-9]+$ ]] || [[ "${VERSION_CODE}" -lt 1 ]]; then
  fail "STARLOG_ANDROID_VERSION_CODE must be a positive integer."
fi
if [[ ! -f "${STARLOG_UPLOAD_STORE_FILE}" ]]; then
  fail "STARLOG_UPLOAD_STORE_FILE does not exist: ${STARLOG_UPLOAD_STORE_FILE}"
fi
if [[ "${ALLOW_DEBUG_KEYSTORE_FOR_VALIDATION}" != "1" ]]; then
  if [[ "$(basename "${STARLOG_UPLOAD_STORE_FILE}")" == "debug.keystore" ]] || [[ "${STARLOG_UPLOAD_KEY_ALIAS}" == "androiddebugkey" ]]; then
    fail "Refusing to package a production release with the Android debug keystore. Use a real upload keystore, or set STARLOG_ALLOW_DEBUG_KEYSTORE_FOR_VALIDATION=1 only for local validation."
  fi
fi

export JAVA_HOME="${JAVA_HOME:-$HOME/.local/jdks/temurin-17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/android}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME}}"
export NODE_ENV="${NODE_ENV:-production}"
export APP_VARIANT=production
export STARLOG_VERSION_NAME="${VERSION_NAME}"
export STARLOG_ANDROID_VERSION_CODE="${VERSION_CODE}"

mkdir -p "${ARTIFACT_ROOT}"

CONFIG_JSON="${ARTIFACT_ROOT}/expo-config-${VERSION_NAME}-${VERSION_CODE}.json"
METADATA_JSON="${ARTIFACT_ROOT}/starlog-${VERSION_NAME}-${VERSION_CODE}-release-metadata.json"

log "Verifying Expo production config"
(
  cd "${MOBILE_DIR}"
  ./node_modules/.bin/expo config --json > "${CONFIG_JSON}"
)

node - "${CONFIG_JSON}" "${VERSION_NAME}" "${VERSION_CODE}" <<'EOF'
const fs = require("fs");

const [, , configPath, expectedVersionName, expectedVersionCode] = process.argv;
const payload = JSON.parse(fs.readFileSync(configPath, "utf8"));
const android = payload?.android ?? {};
if (payload?.name !== "Starlog") {
  console.error(`Expected production expo.name to resolve to "Starlog", got ${payload?.name ?? "<missing>"}`);
  process.exit(1);
}
if (payload?.version !== expectedVersionName) {
  console.error(`Expected expo.version=${expectedVersionName}, got ${payload?.version ?? "<missing>"}`);
  process.exit(1);
}
if (android?.package !== "com.starlog.app") {
  console.error(`Expected android.package=com.starlog.app, got ${android?.package ?? "<missing>"}`);
  process.exit(1);
}
if (String(android?.versionCode ?? "") !== expectedVersionCode) {
  console.error(`Expected android.versionCode=${expectedVersionCode}, got ${android?.versionCode ?? "<missing>"}`);
  process.exit(1);
}
EOF

verify_release_apk_metadata() {
  local apk_path="$1"
  local aapt_bin="${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS_VERSION:-34.0.0}/aapt"
  [[ -x "${aapt_bin}" ]] || fail "Expected aapt at ${aapt_bin}"

  local badging
  badging="$("${aapt_bin}" dump badging "${apk_path}")"
  grep -F "package: name='com.starlog.app'" <<<"${badging}" >/dev/null || fail "Release APK package is not com.starlog.app"
  grep -F "versionCode='${VERSION_CODE}'" <<<"${badging}" >/dev/null || fail "Release APK versionCode drifted from ${VERSION_CODE}"
  grep -F "versionName='${VERSION_NAME}'" <<<"${badging}" >/dev/null || fail "Release APK versionName drifted from ${VERSION_NAME}"
  grep -F "application-label:'Starlog'" <<<"${badging}" >/dev/null || fail "Release APK app label is not Starlog"
}

log "Building signed production app bundle"
(
  cd "${ANDROID_DIR}"
  ./gradlew bundleRelease --console=plain
)

AAB_SOURCE="${ANDROID_DIR}/app/build/outputs/bundle/release/app-release.aab"
AAB_TARGET="${ARTIFACT_ROOT}/starlog-${VERSION_NAME}-${VERSION_CODE}.aab"
[[ -f "${AAB_SOURCE}" ]] || fail "Expected bundle output missing: ${AAB_SOURCE}"
install -m 0644 "${AAB_SOURCE}" "${AAB_TARGET}"

APK_TARGET=""
if [[ "${BUILD_QA_APK}" == "1" ]]; then
  log "Building signed release APK for post-build QA"
  (
    cd "${ANDROID_DIR}"
    ./gradlew assembleRelease --console=plain
  )
  APK_SOURCE="${ANDROID_DIR}/app/build/outputs/apk/release/app-release.apk"
  [[ -f "${APK_SOURCE}" ]] || fail "Expected APK output missing: ${APK_SOURCE}"
  verify_release_apk_metadata "${APK_SOURCE}"
  APK_TARGET="${ARTIFACT_ROOT}/starlog-${VERSION_NAME}-${VERSION_CODE}-signed.apk"
  install -m 0644 "${APK_SOURCE}" "${APK_TARGET}"
  if [[ "${STAGE_WINDOWS_APK}" == "1" ]]; then
    mkdir -p "${WINDOWS_STAGE_DIR}"
    install -m 0644 "${APK_TARGET}" "${WINDOWS_STAGE_DIR}/$(basename "${APK_TARGET}")"
  fi
fi

(
  cd "${ARTIFACT_ROOT}"
  if [[ -n "${APK_TARGET}" ]]; then
    sha256sum "$(basename "${AAB_TARGET}")" "$(basename "${APK_TARGET}")" > checksums.sha256
  else
    sha256sum "$(basename "${AAB_TARGET}")" > checksums.sha256
  fi
)

cat > "${METADATA_JSON}" <<EOF
{
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "app_variant": "production",
  "package": "com.starlog.app",
  "version_name": "${VERSION_NAME}",
  "version_code": ${VERSION_CODE},
  "aab_path": "${AAB_TARGET}"$(if [[ -n "${APK_TARGET}" ]]; then printf ',\n  "signed_apk_path": "%s"' "${APK_TARGET}"; fi)
}
EOF

log "Production artifacts ready"
log "AAB: ${AAB_TARGET}"
if [[ -n "${APK_TARGET}" ]]; then
  log "Signed APK: ${APK_TARGET}"
fi
log "Checksums: ${ARTIFACT_ROOT}/checksums.sha256"
log "Metadata: ${METADATA_JSON}"
