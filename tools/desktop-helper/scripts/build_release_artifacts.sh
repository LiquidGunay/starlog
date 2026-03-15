#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
HELPER_DIR="${REPO_ROOT}/tools/desktop-helper"
TAURI_RELEASE_DIR="${HELPER_DIR}/src-tauri/target/release"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to read desktop-helper version metadata" >&2
  exit 1
fi

VERSION="$(node -p "require('${HELPER_DIR}/package.json').version")"
UNAME_S="$(uname -s | tr '[:upper:]' '[:lower:]')"
UNAME_M="$(uname -m | tr '[:upper:]' '[:lower:]')"
TARGET_ID="${UNAME_M}-${UNAME_S}"

case "${UNAME_S}" in
  linux)
    DEFAULT_BUNDLES="deb"
    ;;
  darwin)
    DEFAULT_BUNDLES="dmg"
    ;;
  mingw*|msys*|cygwin*)
    DEFAULT_BUNDLES="nsis,msi"
    ;;
  *)
    DEFAULT_BUNDLES=""
    ;;
esac

BUNDLES="${STARLOG_DESKTOP_BUNDLES:-${DEFAULT_BUNDLES}}"
if [ -z "${BUNDLES}" ]; then
  echo "Unable to determine default bundles for host '${UNAME_S}'. Set STARLOG_DESKTOP_BUNDLES explicitly." >&2
  exit 1
fi

ARTIFACT_DIR="${REPO_ROOT}/artifacts/desktop-helper/v${VERSION}/${TARGET_ID}"
mkdir -p "${ARTIFACT_DIR}"

# Refresh generated metadata without deleting historical subfolders.
find "${ARTIFACT_DIR}" -maxdepth 1 -type f \( -name 'starlog-desktop-helper-v*' -o -name 'checksums.sha256' -o -name 'manifest.tsv' -o -name 'build-info.txt' \) -delete

echo "[desktop-helper] Building bundles: ${BUNDLES}"
(
  cd "${HELPER_DIR}"
  ./node_modules/.bin/tauri build --bundles "${BUNDLES}"
)

declare -a SOURCES=()
if [ -d "${TAURI_RELEASE_DIR}/bundle" ]; then
  while IFS= read -r -d '' bundle_file; do
    SOURCES+=("${bundle_file}")
  done < <(find "${TAURI_RELEASE_DIR}/bundle" -type f \( \
    -name '*.deb' -o -name '*.appimage' -o -name '*.AppImage' -o -name '*.dmg' -o -name '*.msi' -o -name '*.exe' -o -name '*.rpm' -o -name '*.pkg' \
  \) -print0)
fi

for raw_bin in "${TAURI_RELEASE_DIR}/starlog_desktop_helper" "${TAURI_RELEASE_DIR}/starlog_desktop_helper.exe"; do
  if [ -f "${raw_bin}" ]; then
    SOURCES+=("${raw_bin}")
  fi
done

if [ "${#SOURCES[@]}" -eq 0 ]; then
  echo "No installer artifacts or helper binary were produced by tauri build." >&2
  exit 1
fi

normalize_name() {
  local input="$1"
  local lowered
  lowered="$(printf '%s' "${input}" | tr '[:upper:]' '[:lower:]')"
  printf '%s' "${lowered}" | sed -E 's/[^a-z0-9._-]+/-/g; s/-+/-/g; s/^-//; s/-$//'
}

file_size_bytes() {
  local file_path="$1"
  if stat -c '%s' "${file_path}" >/dev/null 2>&1; then
    stat -c '%s' "${file_path}"
  else
    stat -f '%z' "${file_path}"
  fi
}

declare -a COPIED_FILES=()
for source_path in "${SOURCES[@]}"; do
  base_name="$(basename "${source_path}")"
  safe_name="$(normalize_name "${base_name}")"
  destination="${ARTIFACT_DIR}/starlog-desktop-helper-v${VERSION}-${TARGET_ID}-${safe_name}"
  cp "${source_path}" "${destination}"
  COPIED_FILES+=("${destination}")
  echo "[desktop-helper] Copied $(basename "${destination}")"
done

CHECKSUM_FILE="${ARTIFACT_DIR}/checksums.sha256"
MANIFEST_FILE="${ARTIFACT_DIR}/manifest.tsv"
BUILD_INFO_FILE="${ARTIFACT_DIR}/build-info.txt"

: > "${CHECKSUM_FILE}"
printf 'file\tbytes\tsha256\n' > "${MANIFEST_FILE}"

for artifact_path in "${COPIED_FILES[@]}"; do
  file_name="$(basename "${artifact_path}")"
  file_hash="$(sha256sum "${artifact_path}" | awk '{print $1}')"
  file_size="$(file_size_bytes "${artifact_path}")"
  printf '%s  %s\n' "${file_hash}" "${file_name}" >> "${CHECKSUM_FILE}"
  printf '%s\t%s\t%s\n' "${file_name}" "${file_size}" "${file_hash}" >> "${MANIFEST_FILE}"
done

cat > "${BUILD_INFO_FILE}" <<INFO
version=${VERSION}
target=${TARGET_ID}
bundles=${BUNDLES}
generated_at_utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
INFO

echo "[desktop-helper] Artifact directory: ${ARTIFACT_DIR}"
echo "[desktop-helper] Checksums: ${CHECKSUM_FILE}"
echo "[desktop-helper] Manifest: ${MANIFEST_FILE}"
