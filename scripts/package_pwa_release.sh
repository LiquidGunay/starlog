#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to read web version metadata" >&2
  exit 1
fi

VERSION="${STARLOG_PWA_VERSION_NAME:-$(node -p "require('${WEB_DIR}/package.json').version")}"
ARTIFACT_DIR="${STARLOG_PWA_ARTIFACT_DIR:-$ROOT_DIR/artifacts/pwa/v${VERSION}}"
TARGET_NAME="${STARLOG_PWA_TARGET_NAME:-starlog-pwa-v${VERSION}-standalone.tar.gz}"
TARGET_PATH="${ARTIFACT_DIR}/${TARGET_NAME}"
RUN_BUILD="${STARLOG_PWA_RUN_BUILD:-1}"

if [[ "$RUN_BUILD" == "1" ]]; then
  echo "[pwa-release] Building standalone Next.js output"
  (
    cd "$WEB_DIR"
    ./node_modules/.bin/next build
  )
fi

STANDALONE_DIR="$WEB_DIR/.next/standalone"
STATIC_DIR="$WEB_DIR/.next/static"
PUBLIC_DIR="$WEB_DIR/public"

if [[ ! -d "$STANDALONE_DIR" ]]; then
  echo "Standalone Next.js output not found: $STANDALONE_DIR" >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

BUNDLE_ROOT="$TMP_DIR/starlog-pwa-v${VERSION}"
cp -R "$STANDALONE_DIR" "$BUNDLE_ROOT"

START_COMMAND="node server.js"
if [[ -f "$BUNDLE_ROOT/apps/web/server.js" ]]; then
  mkdir -p "$BUNDLE_ROOT/apps/web/.next"
  cp -R "$STATIC_DIR" "$BUNDLE_ROOT/apps/web/.next/static"
  if [[ -d "$PUBLIC_DIR" ]]; then
    cp -R "$PUBLIC_DIR" "$BUNDLE_ROOT/apps/web/public"
  fi
  START_COMMAND="PORT=3000 HOSTNAME=0.0.0.0 node apps/web/server.js"
elif [[ -f "$BUNDLE_ROOT/server.js" ]]; then
  mkdir -p "$BUNDLE_ROOT/.next"
  cp -R "$STATIC_DIR" "$BUNDLE_ROOT/.next/static"
  if [[ -d "$PUBLIC_DIR" ]]; then
    cp -R "$PUBLIC_DIR" "$BUNDLE_ROOT/public"
  fi
  START_COMMAND="PORT=3000 HOSTNAME=0.0.0.0 node server.js"
else
  echo "Unable to locate the standalone server entrypoint in $BUNDLE_ROOT" >&2
  exit 1
fi

cat >"$BUNDLE_ROOT/README.md" <<EOF
# Starlog PWA Bundle

This bundle was generated from the standalone Next.js output in \`apps/web\`.

## Run

\`\`\`bash
cd "$(basename "$BUNDLE_ROOT")"
$START_COMMAND
\`\`\`

The bundle expects the runtime API base to be configured in the Starlog UI at first launch.
EOF

tar -C "$TMP_DIR" -czf "$TARGET_PATH" "$(basename "$BUNDLE_ROOT")"
sha256sum "$TARGET_PATH" > "${TARGET_PATH}.sha256"

echo "[pwa-release] Bundle: $TARGET_PATH"
echo "[pwa-release] Checksum: ${TARGET_PATH}.sha256"
