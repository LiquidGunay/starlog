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
STARLOG_MOBILE_CONFIGURE_AUTH="${STARLOG_MOBILE_CONFIGURE_AUTH:-auto}"
STARLOG_MOBILE_AUTH_VERIFY_TIMEOUT="${STARLOG_MOBILE_AUTH_VERIFY_TIMEOUT:-20}"
STARLOG_TEST_USER="${STARLOG_TEST_USER:-}"
STARLOG_INTERVIEW_SEED="${STARLOG_INTERVIEW_SEED:-auto}"
STARLOG_INTERVIEW_SEED_ID="${STARLOG_INTERVIEW_SEED_ID:-android-interview-functional-v1}"
STARLOG_INTERVIEW_SEED_TOPIC_TITLE="${STARLOG_INTERVIEW_SEED_TOPIC_TITLE:-Android Functional Interview Seed}"
STARLOG_INTERVIEW_SEED_MARK_READ="${STARLOG_INTERVIEW_SEED_MARK_READ:-1}"
AUTO_REVIEW_GRADE="${AUTO_REVIEW_GRADE:-0}"
AUTO_REVIEW_UI_XML="${AUTO_REVIEW_UI_XML:-}"
AUTO_REVIEW_DRY_RUN_UI_STAGE="${AUTO_REVIEW_DRY_RUN_UI_STAGE:-0}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"
DRY_RUN=0
NO_DEVICE=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--dry-run] [--no-device] [--auto-review-grade] [--help]

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
  STARLOG_MOBILE_CONFIGURE_AUTH
                         auto | 1 | 0. When API base + token are supplied, write a
                         one-shot test auth config into the app sandbox via run-as.
                         The installed app must be an internal/dev build with
                         EXPO_PUBLIC_STARLOG_ENABLE_TEST_AUTH_CONFIG=1.
  STARLOG_MOBILE_AUTH_VERIFY_TIMEOUT
                         Seconds to wait for the app to write redacted auth ack.
  STARLOG_TEST_USER      Optional label recorded in deterministic seed metadata.
  STARLOG_INTERVIEW_SEED auto | off. auto writes api/interview-prep-seed.json and
                         seeds through the API when API base + token are supplied.
  STARLOG_INTERVIEW_SEED_ID
                         Stable seed id/tag for idempotent due-card reuse.
  STARLOG_INTERVIEW_SEED_TOPIC_TITLE
                         Seeded interview-prep topic title.
  STARLOG_INTERVIEW_SEED_MARK_READ
                         Set to 0 to leave the seeded topic unread.
  AUTO_REVIEW_GRADE      Set to 1 to attempt Review reveal + Good automation (default: 0).
  AUTO_REVIEW_UI_XML     Optional local uiautomator XML used by dry-run automation.
  AUTO_REVIEW_DRY_RUN_UI_STAGE
                        Internal dry-run reveal/grade progression stage (default: 0).
  NONINTERACTIVE         Set to 1 to skip pause prompts after printing checkpoints.

Options:
  --dry-run              Print adb/curl commands without requiring a device.
  --no-device            Write the checklist and metadata only, then exit 0.
  --auto-review-grade    Attempt Review reveal + Good grade automation before manual checkpoint.
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

remote_shell_quote() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

run_as_shell_command() {
  local shell_script="$1"
  printf 'run-as '
  remote_shell_quote "$APP_PACKAGE"
  printf ' sh -c '
  remote_shell_quote "$shell_script"
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

adb_cmd_with_stdin() {
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
    printf 'starlog_mobile_configure_auth=%s\n' "$STARLOG_MOBILE_CONFIGURE_AUTH"
    printf 'starlog_mobile_auth_verify_timeout=%s\n' "$STARLOG_MOBILE_AUTH_VERIFY_TIMEOUT"
    printf 'starlog_test_user=%s\n' "${STARLOG_TEST_USER:-unset}"
    printf 'starlog_interview_seed=%s\n' "$STARLOG_INTERVIEW_SEED"
    printf 'starlog_interview_seed_id=%s\n' "$STARLOG_INTERVIEW_SEED_ID"
    printf 'starlog_interview_seed_topic_title=%s\n' "$STARLOG_INTERVIEW_SEED_TOPIC_TITLE"
    printf 'starlog_interview_seed_mark_read=%s\n' "$STARLOG_INTERVIEW_SEED_MARK_READ"
    printf 'auto_review_grade=%s\n' "$AUTO_REVIEW_GRADE"
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
- If \`AUTO_REVIEW_GRADE=1\` is set, the script attempts the reveal + \`Good\` automation first, then falls back to manual.
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

refresh_review_ui() {
  local local_xml
  local_xml="${RUN_DIR}/review-ui.xml"
  mkdir -p "$RUN_DIR"

  if [[ "$DRY_RUN" == "1" ]]; then
    if [[ -n "$AUTO_REVIEW_UI_XML" ]]; then
      if [[ -f "$AUTO_REVIEW_UI_XML" ]]; then
        if [[ "$AUTO_REVIEW_DRY_RUN_UI_STAGE" == "0" || -z "$AUTO_REVIEW_DRY_RUN_UI_STAGE" ]]; then
          cp "$AUTO_REVIEW_UI_XML" "$local_xml"
        else
          dry_run_reveal_grade_xml "$AUTO_REVIEW_UI_XML" "$local_xml" "$AUTO_REVIEW_DRY_RUN_UI_STAGE" || return 1
        fi
        return 0
      fi
      log "AUTO_REVIEW_UI_XML set but not found: $AUTO_REVIEW_UI_XML"
      return 1
    fi
    return 1
  fi

  adb_cmd shell uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1 || return 1
  adb_cmd exec-out cat /sdcard/window_dump.xml >"$local_xml" 2>/dev/null || return 1
  return 0
}

dry_run_reveal_grade_xml() {
  local source_xml="$1"
  local dest_xml="$2"
  local stage="$3"

  if ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi

  python3 - "$source_xml" "$dest_xml" "$stage" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET


source_xml, dest_xml = sys.argv[1], sys.argv[2]
try:
  stage = int(sys.argv[3])
except (TypeError, ValueError):
  stage = 0


def normalize(value: str) -> str:
  return re.sub(r"\s+", " ", (value or "").strip().lower())


def find_parent(root, target):
  for parent in root.iter():
    for node in list(parent):
      if node is target:
        return parent
  return None


def remove_node_if_present(root, should_remove):
  removed = []
  for node in list(root.iter("node")):
    if should_remove(node):
      removed.append(node)
  for node in removed:
    parent = find_parent(root, node)
    if parent is not None:
      parent.remove(node)


root = ET.parse(source_xml).getroot()
has_load_control = any(
  "load_due_cards_button" in normalize(node.attrib.get("resource-id", "")) for node in root.iter("node")
)

if stage >= 1:
  if has_load_control:
    remove_node_if_present(root, lambda node: "load_due_cards_button" in normalize(node.attrib.get("resource-id", "")))
  elif stage == 1:
    for node in root.iter("node"):
      if normalize(node.attrib.get("text", "")) == "reveal answer":
        node.attrib["text"] = "Hide answer"

if stage >= 2:
  remove_node_if_present(root, lambda node: "load_due_cards_button" in normalize(node.attrib.get("resource-id", "")))
  for node in root.iter("node"):
    if normalize(node.attrib.get("text", "")) == "reveal answer":
      node.attrib["text"] = "Hide answer"

if stage >= 3:
  for node in root.iter("node"):
    if normalize(node.attrib.get("text", "")) == "good":
      if "checked" in node.attrib:
        node.attrib["checked"] = "true"
      if "clickable" in node.attrib:
        node.attrib["clickable"] = "false"

ET.ElementTree(root).write(dest_xml, encoding="UTF-8", xml_declaration=True)
PY
}

ui_parse_center() {
  local xml_file="$1"
  local pattern="$2"
  local mode="$3"
  local require_interactable="${4:-1}"
  if ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi
  python3 - "$xml_file" "$pattern" "$mode" "$require_interactable" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

xml_file, pattern = sys.argv[1], (sys.argv[2] or "").strip().lower()
mode = "exact"
if len(sys.argv) > 3:
  mode = (sys.argv[3] or "exact").strip().lower()
require_interactable = len(sys.argv) <= 4 or str(sys.argv[4]).strip().lower() not in {"", "0", "false", "False", "FALSE", "no", "off"}


def normalize(value: str) -> str:
  return re.sub(r"\s+", " ", (value or "").strip().lower())


def bounds_of(node):
  numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
  if len(numbers) != 4:
    return None
  return tuple(numbers)


def center(bounds):
  left, top, right, bottom = bounds
  return f"{(left + right) // 2} {(top + bottom) // 2}"


def node_matches(node):
  if mode == "resource":
    resource_id = (node.attrib.get("resource-id") or "").lower()
    if any(pattern in resource_id for pattern in [p.strip() for p in pattern.split(",") if p.strip()]):
      return True
    return False
  if mode == "contains":
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    return bool(pattern and (pattern in text or pattern in desc))
  text = normalize(node.attrib.get("text") or "")
  desc = normalize(node.attrib.get("content-desc") or "")
  return text == pattern or desc == pattern or desc == f"[{pattern}]"


root = ET.parse(xml_file).getroot()
for node in root.iter("node"):
  if not node_matches(node):
    continue
  if require_interactable:
    if (node.attrib.get("clickable") or "").lower() != "true":
      continue
    if (node.attrib.get("enabled") or "").lower() != "true":
      continue
  coords = bounds_of(node)
  if coords is not None:
    print(center(coords))
    raise SystemExit(0)
raise SystemExit(1)
PY
}

tap_review_ui_control() {
  local label="$1"
  local xml_file="$2"
  local resource_hints_csv="$3"
  local exact_label="$4"
  local contains_label="$5"
  local coords=""

  if [[ -n "$resource_hints_csv" ]]; then
    coords="$(ui_parse_center "$xml_file" "$resource_hints_csv" resource 2>/dev/null || true)"
  fi
  if [[ -z "$coords" ]] && [[ -n "$exact_label" ]]; then
    coords="$(ui_parse_center "$xml_file" "$exact_label" exact 1 2>/dev/null || true)"
  fi
  if [[ -z "$coords" ]] && [[ -n "$contains_label" ]]; then
    coords="$(ui_parse_center "$xml_file" "$contains_label" contains 1 2>/dev/null || true)"
  fi
  if [[ -z "$coords" ]]; then
    return 1
  fi

  adb_cmd shell input tap $coords
  log "Tapped $label at $coords"
  if [[ "$DRY_RUN" == "1" ]]; then
    AUTO_REVIEW_DRY_RUN_UI_STAGE=$((AUTO_REVIEW_DRY_RUN_UI_STAGE + 1))
  fi
  return 0
}

ui_controls_revealed() {
  local xml_file="$1"
  local needle="$2"
  local mode="${3:-exact}"
  python3 - "$xml_file" "$needle" "$mode" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle, mode = sys.argv[1], (sys.argv[2] or "").strip().lower(), (sys.argv[3] or "exact").strip().lower()


def node_matches(node):
  if mode == "resource":
    resource_id = normalize(node.attrib.get("resource-id") or "")
    for candidate in [p.strip() for p in needle.split(",") if p.strip()]:
      if candidate in resource_id:
        return True
    return False
  if mode == "contains":
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    return bool(needle and (needle in text or needle in desc))


def normalize(value: str) -> str:
  return re.sub(r"\s+", " ", (value or "").strip().lower())

root = ET.parse(path).getroot()
for node in root.iter("node"):
  if node_matches(node):
    raise SystemExit(0)
  text = normalize(node.attrib.get("text") or "")
  desc = normalize(node.attrib.get("content-desc") or "")
  if text == needle or desc == needle or desc == f"[{needle}]":
    raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_control_checked() {
  local xml_file="$1"
  local pattern="$2"
  local mode="${3:-exact}"
  python3 - "$xml_file" "$pattern" "$mode" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, pattern = sys.argv[1], (sys.argv[2] or "").strip().lower()
mode = (sys.argv[3] or "exact").strip().lower()


def normalize(value: str) -> str:
  return re.sub(r"\s+", " ", (value or "").strip().lower())


def node_matches(node):
  if mode == "resource":
    resource_id = normalize(node.attrib.get("resource-id") or "")
    for candidate in [p.strip() for p in pattern.split(",") if p.strip()]:
      if candidate in resource_id:
        return True
    return False
  text = normalize(node.attrib.get("text") or "")
  desc = normalize(node.attrib.get("content-desc") or "")
  return text == pattern or desc == pattern or desc == f"[{pattern}]"


def is_checked(node):
  return (node.attrib.get("checked") or "").lower() == "true"


root = ET.parse(path).getroot()
for node in root.iter("node"):
  if node_matches(node) and is_checked(node):
    raise SystemExit(0)
raise SystemExit(1)
PY
}

attempt_review_action() {
  local label="$1"
  local xml_file="$2"
  local resource_hints="$3"
  local exact_label="$4"
  local contains_label="$5"

  local max_tries=3
  local attempt=1
  while (( attempt <= max_tries )); do
    if tap_review_ui_control "$label" "$xml_file" "$resource_hints" "$exact_label" "$contains_label"; then
      return 0
    fi
    (( attempt++ )) || true
    if (( attempt <= max_tries )); then
      sleep 1
      refresh_review_ui >/dev/null 2>&1 || true
      xml_file="$RUN_DIR/review-ui.xml"
    fi
  done
  return 1
}

automate_review_reveal_and_grade() {
  log "Attempting automated Review reveal + Good grade flow"
  if ! refresh_review_ui; then
    log "Automation skipped: could not capture Review UI XML."
    return 1
  fi

  if ui_controls_revealed "$RUN_DIR/review-ui.xml" "Load due cards"; then
    if ! attempt_review_action "Load due cards" "$RUN_DIR/review-ui.xml" "load_due_cards" "Load due cards" "Load"; then
      return 1
    fi
    sleep "$WAIT_SECONDS"
    refresh_review_ui || return 1
  fi

  if ui_controls_revealed "$RUN_DIR/review-ui.xml" "Reveal answer"; then
    if ! attempt_review_action "Reveal answer" "$RUN_DIR/review-ui.xml" "reveal,answer_show,show_answer" "Reveal answer" "Reveal"; then
      return 1
    fi
    sleep "$WAIT_SECONDS"
    refresh_review_ui || return 1
    if ui_controls_revealed "$RUN_DIR/review-ui.xml" "Reveal answer"; then
      log "Automated Reveal action did not change Review state."
      return 1
    fi
  else
    if ui_controls_revealed "$RUN_DIR/review-ui.xml" "Hide answer"; then
      log "Reveal already open; skipping Reveal action."
    else
      log "Automation skipped: could not find Reveal answer control."
      return 1
    fi
  fi

  if ! attempt_review_action "Good grade" "$RUN_DIR/review-ui.xml" "good,keep_in_review,grade_good" "Good" "good"; then
    return 1
  fi
  sleep "$WAIT_SECONDS"
  refresh_review_ui || return 1
  if ui_controls_revealed "$RUN_DIR/review-ui.xml" "Good" exact; then
    if ! ui_control_checked "$RUN_DIR/review-ui.xml" "Good" exact; then
      log "Automated Good action did not change Review state."
      return 1
    fi
  fi
  return 0
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

json_escape() {
  if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 is required to prepare mobile test auth config"
  fi
  python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$1"
}

mobile_auth_config_enabled() {
  case "$STARLOG_MOBILE_CONFIGURE_AUTH" in
    0|false|False|FALSE|off|OFF|no|NO)
      return 1
      ;;
    1|true|True|TRUE|on|ON|yes|YES)
      return 0
      ;;
    auto|AUTO|"")
      [[ -n "$STARLOG_API_BASE" && -n "$STARLOG_ACCESS_TOKEN" ]]
      return
      ;;
    *)
      fail "Unsupported STARLOG_MOBILE_CONFIGURE_AUTH: $STARLOG_MOBILE_CONFIGURE_AUTH"
      ;;
  esac
}

write_mobile_auth_config_json() {
  python3 -c '
import json
import os
import sys

payload = {
    "apiBase": os.environ.get("STARLOG_API_BASE", ""),
    "token": os.environ.get("STARLOG_ACCESS_TOKEN", ""),
    "tab": "assistant",
}
pwa_base = os.environ.get("STARLOG_WEB_ORIGIN", "")
if pwa_base:
    payload["pwaBase"] = pwa_base
sys.stdout.write(json.dumps(payload, separators=(",", ":")))
'
}

write_mobile_auth_config() {
  if ! mobile_auth_config_enabled; then
    log "Mobile test auth config skipped"
    return
  fi
  if [[ -z "$STARLOG_API_BASE" || -z "$STARLOG_ACCESS_TOKEN" ]]; then
    fail "STARLOG_API_BASE and STARLOG_ACCESS_TOKEN are required when STARLOG_MOBILE_CONFIGURE_AUTH is enabled"
  fi

  local redacted_json
  redacted_json="{\"apiBase\":$(json_escape "$STARLOG_API_BASE"),\"token\":\"<redacted>\",\"tab\":\"assistant\""
  if [[ -n "$STARLOG_WEB_ORIGIN" ]]; then
    redacted_json="${redacted_json},\"pwaBase\":$(json_escape "$STARLOG_WEB_ORIGIN")"
  fi
  redacted_json="${redacted_json}}"

  log "Writing mobile test auth config via run-as: $redacted_json"
  local remote_command
  remote_command="$(run_as_shell_command "mkdir -p files && rm -f files/starlog-test-auth-ack.json && cat > files/starlog-test-auth-config.json")"
  if [[ "$DRY_RUN" == "1" ]]; then
    adb_cmd_with_stdin shell "$remote_command"
    return
  fi

  write_mobile_auth_config_json \
    | adb_cmd_with_stdin shell "$remote_command" \
    >/dev/null
}

verify_mobile_auth_config() {
  if ! mobile_auth_config_enabled; then
    return
  fi

  mkdir -p "$RUN_DIR/api"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "Verifying mobile test auth ack via run-as"
    if [[ -n "$ADB_SERIAL" ]]; then
      quote_words "$ADB" -s "$ADB_SERIAL" shell run-as "$APP_PACKAGE" cat files/starlog-test-auth-ack.json
    else
      quote_words "$ADB" shell run-as "$APP_PACKAGE" cat files/starlog-test-auth-ack.json
    fi
    local ack_json
    ack_json="{\"status\":\"accepted\",\"apiBase\":$(json_escape "$STARLOG_API_BASE"),\"hasToken\":true"
    if [[ -n "$STARLOG_WEB_ORIGIN" ]]; then
      ack_json="${ack_json},\"pwaBase\":$(json_escape "$STARLOG_WEB_ORIGIN")"
    fi
    ack_json="${ack_json}}"
    printf '%s\n' "$ack_json" > "$RUN_DIR/api/mobile-test-auth-ack.json"
    return
  fi

  local deadline ack
  deadline=$((SECONDS + STARLOG_MOBILE_AUTH_VERIFY_TIMEOUT))
  while [[ "$SECONDS" -le "$deadline" ]]; do
    ack="$(adb_cmd shell run-as "$APP_PACKAGE" cat files/starlog-test-auth-ack.json 2>/dev/null || true)"
    if [[ -n "$ack" ]]; then
      if ACK_JSON="$ack" python3 - "$STARLOG_API_BASE" "$STARLOG_WEB_ORIGIN" <<'PY'; then
import json
import os
import sys

ack = json.loads(os.environ["ACK_JSON"])
expected_api = sys.argv[1].rstrip("/")
expected_pwa = sys.argv[2].rstrip("/")
if ack.get("status") != "accepted":
    raise SystemExit(1)
if str(ack.get("apiBase", "")).rstrip("/") != expected_api:
    raise SystemExit(1)
if expected_pwa and str(ack.get("pwaBase", "")).rstrip("/") != expected_pwa:
    raise SystemExit(1)
if ack.get("hasToken") is not True:
    raise SystemExit(1)
PY
        printf '%s\n' "$ack" > "$RUN_DIR/api/mobile-test-auth-ack.json"
        log "Mobile test auth config accepted"
        return
      fi
    fi
    sleep 1
  done
  fail "Mobile app did not acknowledge test auth config. Confirm the installed internal/dev build was built with EXPO_PUBLIC_STARLOG_ENABLE_TEST_AUTH_CONFIG=1."
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
      --auto-review-grade)
        AUTO_REVIEW_GRADE=1
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
write_mobile_auth_config
launch_component
verify_mobile_auth_config
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
curl_api_snapshot "due-cards-before-grade" "/v1/cards/due?limit=20"
if [[ "$AUTO_REVIEW_GRADE" == "1" ]]; then
  if automate_review_reveal_and_grade; then
    log "Automated Review reveal + Good flow completed"
  else
    log "Automated review flow failed; using operator-assisted checkpoint."
    manual_checkpoint \
      "Checkpoint 2: Review reveal/grade" \
      "Load due cards if needed, reveal the interview card answer, submit a grade, and verify grade controls are readable."
  fi
else
  manual_checkpoint \
    "Checkpoint 2: Review reveal/grade" \
    "Load due cards if needed, reveal the interview card answer, submit a grade, and verify grade controls are readable."
fi
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
