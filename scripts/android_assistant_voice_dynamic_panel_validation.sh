#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT_DIR/scripts/android_fresh_local_srs_validation.sh" --assistant-voice-dynamic-panel-only "$@"
