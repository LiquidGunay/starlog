#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/.local/android}}"
DEFAULT_ADB="$ANDROID_SDK_ROOT/platform-tools/adb"
WINDOWS_ADB_CANDIDATE="/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe"

ADB="${ADB:-}"
if [[ -z "$ADB" ]]; then
  if [[ -f "$WINDOWS_ADB_CANDIDATE" ]]; then
    ADB="$WINDOWS_ADB_CANDIDATE"
  else
    ADB="$DEFAULT_ADB"
  fi
fi

ADB_SERIAL="${ADB_SERIAL:-}"
APP_VARIANT="${APP_VARIANT:-development}"
APP_PACKAGE="${APP_PACKAGE:-}"
APP_ACTIVITY="${APP_ACTIVITY:-}"
ASSISTANT_DEEPLINK="${ASSISTANT_DEEPLINK:-starlog://surface?tab=assistant}"
REVIEW_DEEPLINK="${REVIEW_DEEPLINK:-starlog://surface?tab=review}"
PLANNER_DEEPLINK="${PLANNER_DEEPLINK:-starlog://surface?tab=planner}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$ROOT_DIR/.localdata/android-interview-functional/artifacts}"
STAMP="${STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_DIR="${RUN_DIR:-$ARTIFACT_ROOT/$STAMP}"
WAIT_SECONDS="${WAIT_SECONDS:-2}"
ADB_REVERSE_PORTS="${ADB_REVERSE_PORTS:-}"
STARLOG_API_BASE="${STARLOG_API_BASE:-${API_BASE:-}}"
STARLOG_WEB_ORIGIN="${STARLOG_WEB_ORIGIN:-${WEB_ORIGIN:-}}"
STARLOG_ACCESS_TOKEN="${STARLOG_ACCESS_TOKEN:-${STARLOG_TOKEN:-}}"
STARLOG_TEST_USER="${STARLOG_TEST_USER:-}"
STARLOG_INTERVIEW_SEED="${STARLOG_INTERVIEW_SEED:-auto}"
STARLOG_INTERVIEW_SEED_ID="${STARLOG_INTERVIEW_SEED_ID:-android-interview-functional-v1}"
STARLOG_INTERVIEW_SEED_TOPIC_TITLE="${STARLOG_INTERVIEW_SEED_TOPIC_TITLE:-Android Functional Interview Seed}"
STARLOG_INTERVIEW_SEED_MARK_READ="${STARLOG_INTERVIEW_SEED_MARK_READ:-1}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"
DRY_RUN=0
NO_DEVICE=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--dry-run] [--no-device] [--help]

Captures a repeatable native Android evidence bundle for the interview-prep loop.
The harness launches Starlog Assistant/Review/Planner surfaces, keeps the phone
awake, records screenshots + UI hierarchy XML, and pauses for manual checkpoints.

Default artifacts:
  $RUN_DIR

Environment overrides:
  ADB                    Explicit adb path. Defaults to Windows adb.exe when available.
  ADB_SERIAL             Explicit Android serial/device id.
  APP_VARIANT            development | preview | production (default: development).
  APP_PACKAGE            Android package override.
  APP_ACTIVITY           Activity override or full package/activity component.
  ASSISTANT_DEEPLINK     Assistant surface deeplink.
  REVIEW_DEEPLINK        Review surface deeplink.
  PLANNER_DEEPLINK       Planner surface deeplink.
  ARTIFACT_ROOT          Evidence root (default: .localdata/.../artifacts).
  STAMP                  Timestamp folder name override.
  RUN_DIR                Full run output directory override.
  WAIT_SECONDS           Seconds to wait after each launch/capture action.
  ADB_REVERSE_PORTS      Comma-separated ports to adb reverse before launching.
  STARLOG_API_BASE       Optional API origin for state snapshots.
  STARLOG_WEB_ORIGIN     Optional web origin recorded in run metadata.
  STARLOG_ACCESS_TOKEN   Optional bearer token for API snapshots; never printed.
  STARLOG_TEST_USER      Optional label recorded in deterministic seed metadata.
  STARLOG_INTERVIEW_SEED auto | off. auto writes api/interview-prep-seed.json and
                         seeds through the API when API base + token are supplied.
  STARLOG_INTERVIEW_SEED_ID
                         Stable seed id/tag for idempotent due-card reuse.
  STARLOG_INTERVIEW_SEED_TOPIC_TITLE
                         Seeded interview-prep topic title.
  STARLOG_INTERVIEW_SEED_MARK_READ
                         Set to 0 to leave the seeded topic unread.
  NONINTERACTIVE         Set to 1 to skip pause prompts after printing checkpoints.

Options:
  --dry-run              Print adb/curl commands without requiring a device.
  --no-device            Write the checklist and metadata only, then exit 0.
  --help                 Show this help.
EOF
}

log() {
  printf '[android-interview-functional] %s\n' "$1"
}

fail() {
  printf '[android-interview-functional] %s\n' "$1" >&2
  exit 1
}

resolve_variant_defaults() {
  if [[ -z "$APP_PACKAGE" ]]; then
    case "$APP_VARIANT" in
      production)
        APP_PACKAGE="com.starlog.app"
        ;;
      preview)
        APP_PACKAGE="com.starlog.app.preview"
        ;;
      development)
        APP_PACKAGE="com.starlog.app.dev"
        ;;
      *)
        fail "Unsupported APP_VARIANT: $APP_VARIANT"
        ;;
    esac
  fi

  if [[ -z "$APP_ACTIVITY" ]]; then
    APP_ACTIVITY="com.starlog.app.dev.MainActivity"
  fi
}

resolve_app_component() {
  if [[ "$APP_ACTIVITY" == */* ]]; then
    printf '%s' "$APP_ACTIVITY"
    return
  fi
  if [[ "$APP_ACTIVITY" == .* ]]; then
    printf '%s/%s%s' "$APP_PACKAGE" "$APP_PACKAGE" "$APP_ACTIVITY"
    return
  fi
  printf '%s/%s' "$APP_PACKAGE" "$APP_ACTIVITY"
}

quote_words() {
  local word
  for word in "$@"; do
    printf ' %q' "$word"
  done
  printf '\n'
}

adb_cmd() {
  if [[ "$DRY_RUN" == "1" ]]; then
    if [[ -n "$ADB_SERIAL" ]]; then
      quote_words "$ADB" -s "$ADB_SERIAL" "$@"
    else
      quote_words "$ADB" "$@"
    fi
    return 0
  fi

  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB" -s "$ADB_SERIAL" "$@"
    return
  fi
  "$ADB" "$@"
}

adb_cmd_quiet() {
  if [[ "$DRY_RUN" == "1" ]]; then
    adb_cmd "$@"
    return
  fi
  adb_cmd "$@" >/dev/null
}

require_command_or_file() {
  local value="$1"
  local label="$2"
  if [[ -f "$value" ]] || command -v "$value" >/dev/null 2>&1; then
    return
  fi
  fail "$label not found: $value"
}

write_run_metadata() {
  mkdir -p "$RUN_DIR"
  {
    printf 'stamp=%s\n' "$STAMP"
    printf 'adb=%s\n' "$ADB"
    printf 'adb_serial=%s\n' "${ADB_SERIAL:-auto}"
    printf 'app_variant=%s\n' "$APP_VARIANT"
    printf 'app_package=%s\n' "$APP_PACKAGE"
    printf 'app_component=%s\n' "$APP_COMPONENT"
    printf 'assistant_deeplink=%s\n' "$ASSISTANT_DEEPLINK"
    printf 'review_deeplink=%s\n' "$REVIEW_DEEPLINK"
    printf 'planner_deeplink=%s\n' "$PLANNER_DEEPLINK"
    printf 'starlog_api_base=%s\n' "${STARLOG_API_BASE:-unset}"
    printf 'starlog_web_origin=%s\n' "${STARLOG_WEB_ORIGIN:-unset}"
    printf 'starlog_test_user=%s\n' "${STARLOG_TEST_USER:-unset}"
    printf 'starlog_interview_seed=%s\n' "$STARLOG_INTERVIEW_SEED"
    printf 'starlog_interview_seed_id=%s\n' "$STARLOG_INTERVIEW_SEED_ID"
    printf 'starlog_interview_seed_topic_title=%s\n' "$STARLOG_INTERVIEW_SEED_TOPIC_TITLE"
    printf 'starlog_interview_seed_mark_read=%s\n' "$STARLOG_INTERVIEW_SEED_MARK_READ"
    if [[ -n "$STARLOG_ACCESS_TOKEN" ]]; then
      printf 'starlog_access_token=provided-redacted\n'
    else
      printf 'starlog_access_token=unset\n'
    fi
  } > "$RUN_DIR/run.env"
}

write_manual_checklist() {
  cat > "$RUN_DIR/manual-checkpoints.md" <<EOF
# Android Interview-Prep Functional Checkpoints

Run directory: \`$RUN_DIR\`

## 1. Assistant topic/read context

- Confirm the phone is awake and unlocked.
- On Assistant, verify the interview-prep topic/read context is visible.
- If \`STARLOG_INTERVIEW_SEED_MARK_READ=0\`, mark the seeded topic read before continuing.
- Confirm the screen exposes the active interview topic and no raw protocol labels.
- Press Enter in the terminal to capture \`assistant-after-topic\`.

Expected evidence:
- \`assistant-entry.png\` / \`assistant-entry.xml\`
- \`assistant-after-topic.png\` / \`assistant-after-topic.xml\`

## 2. Review reveal/grade

- On Review, load due cards if needed.
- Reveal the answer for the interview-prep card.
- Submit a grade, preferably \`Good\` for the happy path.
- Confirm the answer and grade controls are user-facing labels, not renderer/tool keys.
- Press Enter in the terminal to capture \`review-after-grade\`.

Expected evidence:
- \`review-entry.png\` / \`review-entry.xml\`
- \`review-after-grade.png\` / \`review-after-grade.xml\`

## 3. Progress/recommendation verification

- Confirm Review progress changed after grading.
- Confirm Assistant or Planner surfaces show recommendation/progress context for what to do next.
- Press Enter in the terminal to capture \`progress-recommendation\`.

Expected evidence:
- \`progress-recommendation.png\` / \`progress-recommendation.xml\`
- Optional API snapshots under \`api/\` when \`STARLOG_API_BASE\` and \`STARLOG_ACCESS_TOKEN\` are set.
EOF
}

run_interview_seed() {
  case "$STARLOG_INTERVIEW_SEED" in
    0|false|False|FALSE|off|OFF|no|NO)
      mkdir -p "$RUN_DIR/api"
      printf '{"status":"skipped","reason":"STARLOG_INTERVIEW_SEED disabled"}\n' \
        > "$RUN_DIR/api/interview-prep-seed.json"
      log "Interview-prep API seed disabled"
      return
      ;;
  esac

  if ! command -v python3 >/dev/null 2>&1; then
    log "python3 not found; skipping interview-prep API seed"
    mkdir -p "$RUN_DIR/api"
    printf '{"status":"skipped","reason":"python3 not found"}\n' \
      > "$RUN_DIR/api/interview-prep-seed.json"
    return
  fi

  mkdir -p "$RUN_DIR/api"
  local args=(
    "$ROOT_DIR/scripts/interview_prep_api_seed.py"
    "--seed-id" "$STARLOG_INTERVIEW_SEED_ID"
    "--topic-title" "$STARLOG_INTERVIEW_SEED_TOPIC_TITLE"
    "--summary-path" "$RUN_DIR/api/interview-prep-seed.json"
  )
  if [[ "$STARLOG_INTERVIEW_SEED_MARK_READ" == "0" || "$STARLOG_INTERVIEW_SEED_MARK_READ" == "false" || "$STARLOG_INTERVIEW_SEED_MARK_READ" == "False" ]]; then
    args+=("--no-mark-read")
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    args+=("--dry-run")
  fi

  log "Preparing deterministic interview-prep due-card seed"
  python3 "${args[@]}" > "$RUN_DIR/api/interview-prep-seed.stdout.json"
}

wait_for_device() {
  log "Waiting for adb device"
  local state
  state="$(adb_cmd get-state 2>/dev/null | tr -d '\r' || true)"
  if [[ "$state" != "device" ]]; then
    fail "No ready adb device found. Set ADB_SERIAL or run with --no-device for checklist-only output."
  fi
}

keep_awake() {
  log "Keeping phone awake"
  if [[ "$DRY_RUN" == "1" ]]; then
    adb_cmd shell input keyevent KEYCODE_WAKEUP
    adb_cmd shell svc power stayon true
    adb_cmd shell svc power stayon usb
    return
  fi
  adb_cmd shell input keyevent KEYCODE_WAKEUP >/dev/null || true
  adb_cmd shell svc power stayon true >/dev/null 2>&1 || adb_cmd shell svc power stayon usb >/dev/null 2>&1 || true
}

maybe_reverse_ports() {
  if [[ -z "$ADB_REVERSE_PORTS" ]]; then
    return
  fi

  local raw_ports="$ADB_REVERSE_PORTS"
  local port
  IFS=',' read -ra ports <<< "$raw_ports"
  for port in "${ports[@]}"; do
    port="${port//[[:space:]]/}"
    if [[ -z "$port" ]]; then
      continue
    fi
    log "Reversing tcp:$port"
    adb_cmd_quiet reverse "tcp:$port" "tcp:$port"
  done
}

launch_component() {
  log "Launching native app component"
  adb_cmd_quiet shell am start -W -n "$APP_COMPONENT"
  sleep "$WAIT_SECONDS"
}

launch_deeplink() {
  local label="$1"
  local deeplink="$2"
  log "Launching $label: $deeplink"
  adb_cmd_quiet shell am start -W -a android.intent.action.VIEW -d "$deeplink" -n "$APP_COMPONENT"
  sleep "$WAIT_SECONDS"
}

capture_state() {
  local label="$1"
  local remote_xml="/sdcard/starlog-${label}.xml"
  log "Capturing $label"

  mkdir -p "$RUN_DIR"
  if [[ "$DRY_RUN" == "1" ]]; then
    adb_cmd shell uiautomator dump "$remote_xml"
    adb_cmd exec-out cat "$remote_xml"
    adb_cmd exec-out screencap -p
    return
  fi

  adb_cmd shell uiautomator dump "$remote_xml" >/dev/null 2>&1 || true
  adb_cmd exec-out cat "$remote_xml" > "$RUN_DIR/${label}.xml" 2>/dev/null || true
  adb_cmd exec-out screencap -p > "$RUN_DIR/${label}.png" 2>/dev/null || true
}

manual_checkpoint() {
  local title="$1"
  local body="$2"
  printf '\n[%s]\n%s\n' "$title" "$body"
  if [[ "$NONINTERACTIVE" == "1" || "$DRY_RUN" == "1" ]]; then
    return
  fi
  read -r -p "Press Enter when this checkpoint is ready to capture. "
}

curl_api_snapshot() {
  local label="$1"
  local path="$2"

  if [[ -z "$STARLOG_API_BASE" || -z "$STARLOG_ACCESS_TOKEN" ]]; then
    return
  fi
  if ! command -v curl >/dev/null 2>&1; then
    log "curl not found; skipping API snapshot $label"
    return
  fi

  mkdir -p "$RUN_DIR/api"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'curl -fsS -H %q %q > %q\n' \
      "Authorization: Bearer <redacted>" \
      "${STARLOG_API_BASE%/}$path" \
      "$RUN_DIR/api/${label}.json"
    return
  fi

  log "Capturing API snapshot $label"
  curl -fsS \
    -H "Authorization: Bearer $STARLOG_ACCESS_TOKEN" \
    "${STARLOG_API_BASE%/}$path" \
    > "$RUN_DIR/api/${label}.json" || true
}

parse_args() {
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        ;;
      --no-device)
        NO_DEVICE=1
        NONINTERACTIVE=1
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
    shift
  done
}

parse_args "$@"
resolve_variant_defaults
APP_COMPONENT="$(resolve_app_component)"
write_run_metadata
write_manual_checklist

log "Evidence directory: $RUN_DIR"

if [[ "$NO_DEVICE" == "1" ]]; then
  log "No-device mode wrote metadata and manual checklist only"
  exit 0
fi

run_interview_seed

require_command_or_file "$ADB" "adb"

if [[ "$DRY_RUN" != "1" ]]; then
  wait_for_device
fi

keep_awake
maybe_reverse_ports
launch_component
capture_state "00-launch"

launch_deeplink "Assistant" "$ASSISTANT_DEEPLINK"
capture_state "assistant-entry"
manual_checkpoint \
  "Checkpoint 1: Assistant topic/read context" \
  "Verify the interview-prep topic/read context and user-facing controls. If STARLOG_INTERVIEW_SEED_MARK_READ=0, mark the seeded topic read before continuing."
capture_state "assistant-after-topic"
curl_api_snapshot "assistant-today-after-topic" "/v1/assistant/today"
curl_api_snapshot "due-cards-after-topic" "/v1/cards/due?limit=20"

launch_deeplink "Review" "$REVIEW_DEEPLINK"
capture_state "review-entry"
manual_checkpoint \
  "Checkpoint 2: Review reveal/grade" \
  "Load due cards if needed, reveal the interview card answer, submit a grade, and verify grade controls are readable."
capture_state "review-after-grade"
curl_api_snapshot "due-cards-after-grade" "/v1/cards/due?limit=20"

launch_deeplink "Planner" "$PLANNER_DEEPLINK"
capture_state "planner-entry"
launch_deeplink "Assistant" "$ASSISTANT_DEEPLINK"
manual_checkpoint \
  "Checkpoint 3: Progress/recommendation verification" \
  "Verify progress changed and Assistant or Planner shows recommendation/progress context for the next study move."
capture_state "progress-recommendation"
curl_api_snapshot "assistant-today-final" "/v1/assistant/today"

log "Capture complete: $RUN_DIR"
