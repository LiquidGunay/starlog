#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_DIR="$(mktemp -d)"
trap 'rm -rf "$RUN_DIR"' EXIT

output="$(
  ADB=/bin/echo \
  ADB_SERIAL=emulator-5554 \
  RUN_DIR="$RUN_DIR" \
  WAIT_SECONDS=0 \
  STARLOG_API_BASE=https://api.example.test \
  STARLOG_ACCESS_TOKEN=test-token \
  STARLOG_INTERVIEW_SEED=off \
  NONINTERACTIVE=1 \
  bash "$ROOT_DIR/scripts/android_interview_functional_capture.sh" --dry-run
)"

write_line="$(printf '%s\n' "$output" | grep 'starlog-test-auth-config.json' | head -n 1)"
if [[ -z "$write_line" ]]; then
  printf 'Expected dry-run output to include the mobile auth config write command.\n' >&2
  printf '%s\n' "$output" >&2
  exit 1
fi

eval "set -- $write_line"
if [[ "$#" -ne 5 || "$4" != "shell" ]]; then
  printf 'Expected adb shell dry-run to preserve one remote command argument.\n' >&2
  printf 'line: %s\n' "$write_line" >&2
  exit 1
fi

expected_remote_command="run-as 'com.starlog.app.dev' sh -c 'mkdir -p files && rm -f files/starlog-test-auth-ack.json && cat > files/starlog-test-auth-config.json'"
if [[ "$5" != "$expected_remote_command" ]]; then
  printf 'Unexpected remote run-as command.\n' >&2
  printf 'expected: %s\n' "$expected_remote_command" >&2
  printf 'actual:   %s\n' "$5" >&2
  exit 1
fi

printf 'android_interview_functional_capture dry-run quoting ok\n'
