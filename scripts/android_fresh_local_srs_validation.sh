#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCALDATA_ROOT="${LOCALDATA_ROOT:-$ROOT_DIR/.localdata/android-local-validation}"
BUILD_ROOT="$LOCALDATA_ROOT/builds"
RUNTIME_ROOT="$LOCALDATA_ROOT/runtime"
CONFIG_DIR="${STARLOG_TEST_CONFIG_DIR:-$HOME/.config/starlog}"
PASSPHRASE_FILE="${STARLOG_TEST_PASSPHRASE_FILE:-$CONFIG_DIR/android-local-srs-passphrase.txt}"

JAVA_HOME="${JAVA_HOME:-$HOME/.local/jdks/temurin-17}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/android}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
ADB="${ADB:-/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe}"
ADB_SERIAL="${ADB_SERIAL:-}"
APP_VARIANT="${APP_VARIANT:-development}"
APP_PACKAGE="${APP_PACKAGE:-com.starlog.app.dev}"
APP_ACTIVITY="${APP_ACTIVITY:-.MainActivity}"
WINDOWS_TEMP_ROOT="${WINDOWS_TEMP_ROOT:-/mnt/c/Temp}"
API_PORT="${API_PORT:-8000}"
API_BASE="${API_BASE:-http://127.0.0.1:${API_PORT}}"
DECK_PATH="${DECK_PATH:-$ROOT_DIR/data/ml_interviews_part_ii_qa_cards.jsonl}"
NEETCODE_SOURCE_PATH="${NEETCODE_SOURCE_PATH:-$ROOT_DIR/data/neetcode_150.json}"
STARLOG_VERSION_NAME="${STARLOG_VERSION_NAME:-0.1.0-april.devtest.$(date -u +%Y%m%dT%H%M%SZ)}"
# Keep versionCode below Android's signed-int max while still encoding UTC freshness.
STARLOG_ANDROID_VERSION_CODE="${STARLOG_ANDROID_VERSION_CODE:-1$(date -u +%y%j%H%M)}"
REACT_NATIVE_ARCHITECTURES="${REACT_NATIVE_ARCHITECTURES:-}"
CLEAN_BUILD="${CLEAN_BUILD:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
EXISTING_APK_PATH="${EXISTING_APK_PATH:-}"
ASSISTANT_COMMAND_TEXT="${ASSISTANT_COMMAND_TEXT:-Ask, capture, plan, review, or move something forward...}"
ASSISTANT_COMMAND="${ASSISTANT_COMMAND:-summarize latest artifact}"
ADB_INSTALL_TIMEOUT_SEC="${ADB_INSTALL_TIMEOUT_SEC:-900}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BUILD_DIR="$BUILD_ROOT/$STAMP"
RUNTIME_DIR="$RUNTIME_ROOT/$STAMP"
SCREENSHOT_DIR="$BUILD_DIR/screens"
API_LOG="$BUILD_DIR/local-api.log"
UI_XML="$BUILD_DIR/window_dump.xml"
BUILD_NAME="starlog-dev-${STAMP}-${STARLOG_ANDROID_VERSION_CODE}.apk"
STAGED_APK="$BUILD_DIR/$BUILD_NAME"
WINDOWS_APK_PATH="$WINDOWS_TEMP_ROOT/$BUILD_NAME"
METADATA_PATH="$BUILD_DIR/latest.json"
LATEST_METADATA_PATH="$BUILD_ROOT/latest.json"
LATEST_APK_PATH="$BUILD_ROOT/latest.apk"
TOP_ACTIVITY_PATH="$BUILD_DIR/top-activity.txt"
WINDOW_POLICY_PATH="$BUILD_DIR/window-policy.txt"
VENV_PYTHON="${VENV_PYTHON:-$ROOT_DIR/services/api/.venv/bin/python}"
API_PID=""
PRESERVED_EXISTING_APK=""
PLANNER_ALARM_CONTROL_DIAGNOSTICS=""
STARLOG_LOCAL_ACCESS_TOKEN=""

usage() {
  cat <<EOF
Usage: $(basename "$0")

Builds a fresh April mobile APK, resets the connected phone's Starlog packages,
bootstraps a fresh local API station with a non-repo test passphrase, imports the
ML Interviews deck, installs the APK through Windows adb, and drives the first
login + SRS review steps on the phone.

Important defaults:
  JAVA_HOME                     $JAVA_HOME
  ANDROID_SDK_ROOT              $ANDROID_SDK_ROOT
  ADB                           $ADB
  API_BASE                      $API_BASE
  PASSPHRASE_FILE               $PASSPHRASE_FILE
  LOCALDATA_ROOT                $LOCALDATA_ROOT

Environment overrides:
  ADB_SERIAL                    explicit Android serial
  APP_VARIANT                   development | preview | production
  APP_PACKAGE                   Android package to install/launch
  APP_ACTIVITY                  Activity class or component; normalized onto APP_PACKAGE
  DECK_PATH                     JSONL deck to import
  STARLOG_VERSION_NAME          explicit Android versionName
  STARLOG_ANDROID_VERSION_CODE  explicit Android versionCode
  REACT_NATIVE_ARCHITECTURES    override ABI list (defaults to connected device ABI)
  CLEAN_BUILD                   1 to force gradlew clean before assembleRelease
  SKIP_BUILD                    1 to reuse an existing APK instead of rebuilding
  EXISTING_APK_PATH             existing APK path to reuse when SKIP_BUILD=1
  ADB_INSTALL_TIMEOUT_SEC       adb install timeout (default 900 seconds)
  API_PORT / API_BASE           local API endpoint for the mobile login flow
  WINDOWS_TEMP_ROOT             Windows-visible APK staging root
EOF
}

log() {
  printf '[android-local-srs] %s\n' "$1"
}

fail() {
  printf '[android-local-srs] %s\n' "$1" >&2
  exit 1
}

resolve_app_component() {
  if [[ "$APP_ACTIVITY" == */* ]]; then
    local activity_package="${APP_ACTIVITY%%/*}"
    local activity_path="${APP_ACTIVITY#*/}"
    if [[ "$activity_package" == "$APP_PACKAGE" ]]; then
      printf '%s' "$APP_ACTIVITY"
      return
    fi
    if [[ "$activity_path" == .* ]]; then
      printf '%s/%s%s' "$APP_PACKAGE" "$activity_package" "$activity_path"
      return
    fi
    printf '%s/%s' "$APP_PACKAGE" "$activity_path"
    return
  fi
  if [[ "$APP_ACTIVITY" == .* ]]; then
    printf '%s/%s' "$APP_PACKAGE" "$APP_ACTIVITY"
    return
  fi
  printf '%s/%s' "$APP_PACKAGE" "$APP_ACTIVITY"
}

APP_COMPONENT="$(resolve_app_component)"

adb_cmd() {
  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB" -s "$ADB_SERIAL" "$@"
    return
  fi
  "$ADB" "$@"
}

to_windows_path() {
  local path="$1"
  case "$path" in
    [A-Za-z]:/*)
      printf '%s' "$path"
      ;;
    /mnt/c/*)
      printf 'C:%s' "${path#/mnt/c}"
      ;;
    /mnt/d/*)
      printf 'D:%s' "${path#/mnt/d}"
      ;;
    /mnt/e/*)
      printf 'E:%s' "${path#/mnt/e}"
      ;;
    *)
      printf '%s' "$path"
      ;;
  esac
}

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "$PRESERVED_EXISTING_APK" && -f "$PRESERVED_EXISTING_APK" ]]; then
    rm -f "$PRESERVED_EXISTING_APK"
  fi
}

trap cleanup EXIT

ensure_requirements() {
  [[ -x "$JAVA_HOME/bin/java" ]] || fail "JAVA_HOME is missing a java binary: $JAVA_HOME"
  [[ -x "$JAVA_HOME/bin/javac" ]] || fail "JAVA_HOME is missing a javac binary: $JAVA_HOME"
  [[ -x "$ANDROID_SDK_ROOT/platform-tools/adb" || -f "$ADB" ]] || fail "Android SDK/adb not found"
  [[ -x "$VENV_PYTHON" ]] || fail "services/api virtualenv python not found: $VENV_PYTHON"
  [[ -f "$DECK_PATH" ]] || fail "Deck file not found: $DECK_PATH"
  [[ -f "$NEETCODE_SOURCE_PATH" ]] || fail "NeetCode source file not found: $NEETCODE_SOURCE_PATH"
}

create_passphrase() {
  mkdir -p "$CONFIG_DIR"
  if [[ ! -f "$PASSPHRASE_FILE" ]]; then
    python3 - "$PASSPHRASE_FILE" <<'PY'
from pathlib import Path
import random
import string
import sys

path = Path(sys.argv[1])
alphabet = string.ascii_lowercase + string.digits
value = "starlog" + "".join(random.SystemRandom().choice(alphabet) for _ in range(24))
path.write_text(value + "\n", encoding="utf-8")
PY
    chmod 600 "$PASSPHRASE_FILE"
  fi

  STARLOG_TEST_PASSPHRASE="$(tr -d '\r\n' < "$PASSPHRASE_FILE")"
  export STARLOG_TEST_PASSPHRASE
  [[ ${#STARLOG_TEST_PASSPHRASE} -ge 12 ]] || fail "Stored passphrase is too short: $PASSPHRASE_FILE"
}

prepare_dirs() {
  if [[ "$SKIP_BUILD" == "1" && -n "$EXISTING_APK_PATH" && -f "$EXISTING_APK_PATH" ]]; then
    case "$EXISTING_APK_PATH" in
      "$BUILD_ROOT"/*)
        PRESERVED_EXISTING_APK="$(mktemp /tmp/starlog-existing-apk.XXXXXX.apk)"
        cp "$EXISTING_APK_PATH" "$PRESERVED_EXISTING_APK"
        EXISTING_APK_PATH="$PRESERVED_EXISTING_APK"
        ;;
    esac
  fi
  rm -rf "$BUILD_ROOT" "$RUNTIME_ROOT"
  mkdir -p "$BUILD_DIR" "$RUNTIME_DIR" "$SCREENSHOT_DIR"
}

resolve_target_architectures() {
  if [[ -n "$REACT_NATIVE_ARCHITECTURES" ]]; then
    return
  fi

  adb_cmd wait-for-device >/dev/null
  local detected_abi=""
  detected_abi="$(adb_cmd shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r\n' || true)"
  if [[ -n "$detected_abi" ]]; then
    REACT_NATIVE_ARCHITECTURES="$detected_abi"
  else
    REACT_NATIVE_ARCHITECTURES="arm64-v8a"
  fi
}

kill_existing_local_api() {
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local pids
  pids="$(lsof -ti tcp:"$API_PORT" || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  for pid in $pids; do
    local command
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"uvicorn app.main:app"* || "$command" == *"python -m uvicorn app.main:app"* ]]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    else
      fail "Port $API_PORT is already in use by a non-Starlog process: $command"
    fi
  done
}

wait_for_health() {
  local url="$1"
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if curl -fsS "$url/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "Timed out waiting for local API health at $url"
}

start_local_api() {
  kill_existing_local_api
  log "Starting fresh local API at $API_BASE"
  STARLOG_ENV=prod \
  STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
  STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
  STARLOG_SECRETS_MASTER_KEY="android-local-srs-$STAMP" \
  PYTHONPATH="$ROOT_DIR/services/api" \
  "$VENV_PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" --app-dir "$ROOT_DIR/services/api" \
    >"$API_LOG" 2>&1 &
  API_PID="$!"
  wait_for_health "$API_BASE"
}

bootstrap_local_station() {
  log "Bootstrapping local auth station"
  local bootstrap_status
  bootstrap_status="$(curl -sS -o /tmp/starlog-bootstrap.json -w '%{http_code}' \
    -X POST "$API_BASE/v1/auth/bootstrap" \
    -H 'Content-Type: application/json' \
    -d "{\"passphrase\":\"${STARLOG_TEST_PASSPHRASE}\"}")"
  if [[ "$bootstrap_status" != "201" && "$bootstrap_status" != "409" ]]; then
    fail "Local bootstrap failed with HTTP $bootstrap_status: $(cat /tmp/starlog-bootstrap.json)"
  fi
}

import_local_srs_deck() {
  log "Importing ML Interviews SRS deck into fresh local DB"
  STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
  STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
  PYTHONPATH="$ROOT_DIR/services/api" \
  "$VENV_PYTHON" "$ROOT_DIR/scripts/bootstrap_ml_interview_srs.py" --deck "$DECK_PATH" >"$BUILD_DIR/srs-import.json"
  "$VENV_PYTHON" - "$BUILD_DIR/srs-import.json" "$RUNTIME_DIR/starlog.db" <<'PY'
import sys
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

summary_path = Path(sys.argv[1])
db_path = Path(sys.argv[2])

payload = json.loads(summary_path.read_text(encoding="utf-8"))
card_set_version_id = payload.get("card_set_version_id")
if not card_set_version_id:
    raise SystemExit("Import summary missing card_set_version_id; cannot force imported cards due")

due_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(microsecond=0).isoformat()
with sqlite3.connect(str(db_path)) as conn:
    cursor = conn.execute(
        "UPDATE cards SET due_at = ?, updated_at = ? WHERE card_set_version_id = ?",
        (due_at, due_at, card_set_version_id),
    )
    if cursor.rowcount <= 0:
        raise SystemExit(f"No cards updated for card_set_version_id={card_set_version_id}")
    conn.commit()
PY
}

import_local_neetcode_study_core() {
  log "Importing NeetCode Study Core source into fresh local DB"
  STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
  STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
  PYTHONPATH="$ROOT_DIR/services/api" \
  "$VENV_PYTHON" "$ROOT_DIR/scripts/import_neetcode_150.py" --source "$NEETCODE_SOURCE_PATH" >"$BUILD_DIR/neetcode-import.json"
  "$VENV_PYTHON" - "$BUILD_DIR/neetcode-import.json" "$RUNTIME_DIR/starlog.db" <<'PY'
import json
import sqlite3
import sys
from pathlib import Path

summary_path = Path(sys.argv[1])
db_path = Path(sys.argv[2])

payload = json.loads(summary_path.read_text(encoding="utf-8"))
if payload.get("problem_count") != 150:
    raise SystemExit(f"Expected 150 NeetCode problems, got {payload.get('problem_count')}")

with sqlite3.connect(str(db_path)) as conn:
    conn.row_factory = sqlite3.Row
    counts = {
        "study_sources": conn.execute("SELECT COUNT(*) FROM study_sources").fetchone()[0],
        "study_topics": conn.execute("SELECT COUNT(*) FROM study_topics").fetchone()[0],
        "card_topic_links": conn.execute("SELECT COUNT(*) FROM card_topic_links").fetchone()[0],
    }

if counts["study_sources"] < 1 or counts["study_topics"] < 1 or counts["card_topic_links"] < 1:
    raise SystemExit(f"NeetCode Study Core import did not create expected rows: {counts}")
PY
}

seed_native_interview_loop_review_queue() {
  log "Preparing locked Sliding Window review queue for native Study Core validation"
  STARLOG_DB_PATH="$RUNTIME_DIR/starlog.db" \
  STARLOG_MEDIA_DIR="$RUNTIME_DIR/media" \
  PYTHONPATH="$ROOT_DIR/services/api" \
  "$VENV_PYTHON" - "$RUNTIME_DIR/starlog.db" "$BUILD_DIR/native-interview-loop-seed.json" <<'PY'
import json
import sqlite3
import sys
from datetime import timedelta
from pathlib import Path

from app.core.time import utc_now
from app.services import study_service

db_path = Path(sys.argv[1])
summary_path = Path(sys.argv[2])

with sqlite3.connect(str(db_path)) as conn:
    conn.row_factory = sqlite3.Row
    topic = conn.execute(
        "SELECT id, source_id, title FROM study_topics WHERE title = ? LIMIT 1",
        ("Sliding Window",),
    ).fetchone()
    if topic is None:
        raise SystemExit("Sliding Window topic is missing after NeetCode import")

    topic_id = str(topic["id"])
    card_rows = conn.execute(
        """
        SELECT DISTINCT c.id
        FROM cards c
        JOIN card_topic_links ctl ON ctl.card_id = c.id
        WHERE ctl.topic_id = ?
          AND ctl.gate_required = 1
        ORDER BY c.id
        """,
        (topic_id,),
    ).fetchall()
    card_ids = [str(row["id"]) for row in card_rows]
    if not card_ids:
        raise SystemExit("Sliding Window topic has no gated review cards")

    placeholders = ",".join("?" for _ in card_ids)
    prereq_rows = conn.execute(
        f"""
        SELECT DISTINCT t.id, t.title
        FROM card_topic_links ctl
        JOIN study_topics t ON t.id = ctl.topic_id
        WHERE ctl.card_id IN ({placeholders})
          AND ctl.gate_required = 1
          AND ctl.topic_id != ?
        ORDER BY t.display_order
        """,
        (*card_ids, topic_id),
    ).fetchall()
    prerequisites = []
    for row in prereq_rows:
        progress = study_service.mark_topic_read(conn, str(row["id"]))
        prerequisites.append({"id": str(row["id"]), "title": str(row["title"]), "status": progress["status"]})

    due_at = (utc_now() - timedelta(minutes=5)).isoformat()
    conn.executemany(
        "UPDATE cards SET due_at = ?, updated_at = ? WHERE id = ?",
        [(due_at, due_at, card_id) for card_id in card_ids],
    )
    conn.commit()

    locked_due_count = conn.execute(
        f"""
        SELECT COUNT(*) AS count
        FROM cards c
        WHERE c.id IN ({placeholders})
          AND c.suspended = 0
          AND c.due_at <= ?
          AND EXISTS (
            SELECT 1
            FROM card_topic_links ctl
            LEFT JOIN study_topic_progress stp ON stp.topic_id = ctl.topic_id
            WHERE ctl.card_id = c.id
              AND ctl.gate_required = 1
              AND COALESCE(stp.read_at, '') = ''
              AND COALESCE(stp.status, '') != 'read'
          )
        """,
        (*card_ids, utc_now().isoformat()),
    ).fetchone()["count"]

summary = {
    "topic": {"id": topic_id, "title": str(topic["title"])},
    "card_count": len(card_ids),
    "prerequisites_marked_read": prerequisites,
    "locked_due_count": int(locked_due_count),
}
if summary["locked_due_count"] <= 0:
    raise SystemExit(f"Expected locked due cards before native read action: {summary}")
summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

verify_local_review_queue() {
  local token
  local login_body="$BUILD_DIR/auth-login.json"
  local login_status
  login_status="$(curl -sS -o "$login_body" -w '%{http_code}' \
    -X POST "$API_BASE/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"passphrase\":\"${STARLOG_TEST_PASSPHRASE}\"}")"
  if [[ "$login_status" != "200" ]]; then
    fail "Local auth login failed with HTTP $login_status: $(cat "$login_body")"
  fi
  token="$(python3 - "$login_body" <<'PY'
from pathlib import Path
import json
import sys

payload = json.loads(Path(sys.argv[1]).read_text())
token = payload.get("access_token")
if not isinstance(token, str) or not token:
    raise SystemExit("Login response did not include access_token")
print(token)
PY
)"
  STARLOG_LOCAL_ACCESS_TOKEN="$token"

  curl -fsS "$API_BASE/v1/cards/decks" -H "Authorization: Bearer $token" >"$BUILD_DIR/review-decks.json"
  curl -fsS "$API_BASE/v1/cards/due?limit=20" -H "Authorization: Bearer $token" >"$BUILD_DIR/due-cards.json"
  python3 - "$BUILD_DIR/due-cards.json" "$BUILD_DIR/native-interview-loop-seed.json" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
seed_path = Path(sys.argv[2])
payload = json.loads(path.read_text())
if isinstance(payload, dict):
    cards = payload.get("cards") or []
elif isinstance(payload, list):
    cards = payload
else:
    cards = []

if cards:
    raise SystemExit("Fresh local review queue leaked gated cards before native topic read")

seed = json.loads(seed_path.read_text())
if int(seed.get("locked_due_count") or 0) <= 0:
    raise SystemExit(f"Seed did not prepare locked due cards: {seed}")
PY
}

build_apk() {
  log "Building fresh development release APK"
  export JAVA_HOME ANDROID_HOME ANDROID_SDK_ROOT
  local gradle_tasks=("assembleRelease")
  if [[ "$CLEAN_BUILD" == "1" ]]; then
    gradle_tasks=("clean" "assembleRelease")
  fi
  (
    cd "$ROOT_DIR/apps/mobile/android"
    APP_VARIANT="$APP_VARIANT" \
    STARLOG_VERSION_NAME="$STARLOG_VERSION_NAME" \
    STARLOG_ANDROID_VERSION_CODE="$STARLOG_ANDROID_VERSION_CODE" \
    REACT_NATIVE_ARCHITECTURES="$REACT_NATIVE_ARCHITECTURES" \
    STARLOG_ALLOW_DEBUG_RELEASE_SIGNING=true \
    ./gradlew "${gradle_tasks[@]}" --console=plain -PreactNativeArchitectures="$REACT_NATIVE_ARCHITECTURES"
  ) | tee "$BUILD_DIR/gradle-build.log"

  cp "$ROOT_DIR/apps/mobile/android/app/build/outputs/apk/release/app-release.apk" "$STAGED_APK"
  cp "$STAGED_APK" "$WINDOWS_APK_PATH"
  cp "$STAGED_APK" "$LATEST_APK_PATH"
}

stage_existing_apk() {
  [[ "$SKIP_BUILD" == "1" ]] || return 0
  [[ -n "$EXISTING_APK_PATH" ]] || fail "SKIP_BUILD=1 requires EXISTING_APK_PATH"
  [[ -f "$EXISTING_APK_PATH" ]] || fail "Existing APK not found: $EXISTING_APK_PATH"
  log "Reusing existing APK $EXISTING_APK_PATH"
  cp "$EXISTING_APK_PATH" "$STAGED_APK"
  cp "$STAGED_APK" "$WINDOWS_APK_PATH"
  cp "$STAGED_APK" "$LATEST_APK_PATH"
}

verify_built_apk() {
  local aapt
  aapt="$(find "$ANDROID_SDK_ROOT/build-tools" -type f -name aapt | sort | tail -n 1)"
  [[ -n "$aapt" ]] || fail "aapt not found under $ANDROID_SDK_ROOT/build-tools"
  local badging
  local actual_version_code=""
  local actual_version_name=""
  badging="$("$aapt" dump badging "$STAGED_APK")"
  grep -F "package: name='$APP_PACKAGE'" <<<"$badging" >/dev/null || fail "Built APK package drifted from $APP_PACKAGE"
  actual_version_code="$(sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" <<<"$badging" | head -n 1)"
  actual_version_name="$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$badging" | head -n 1)"
  [[ -n "$actual_version_code" ]] || fail "Could not parse versionCode from staged APK"
  [[ -n "$actual_version_name" ]] || fail "Could not parse versionName from staged APK"
  if [[ "$SKIP_BUILD" == "1" ]]; then
    STARLOG_ANDROID_VERSION_CODE="$actual_version_code"
    STARLOG_VERSION_NAME="$actual_version_name"
  else
    grep -F "versionCode='$STARLOG_ANDROID_VERSION_CODE'" <<<"$badging" >/dev/null || fail "Built APK versionCode drifted from $STARLOG_ANDROID_VERSION_CODE"
    grep -F "versionName='$STARLOG_VERSION_NAME'" <<<"$badging" >/dev/null || fail "Built APK versionName drifted from $STARLOG_VERSION_NAME"
  fi
  printf '%s\n' "$badging" >"$BUILD_DIR/apk-badging.txt"
  sha256sum "$STAGED_APK" >"$BUILD_DIR/apk.sha256"
}

remove_phone_builds() {
  log "Removing old Starlog packages from phone"
  for package in com.starlog.app.dev com.starlog.app.preview com.starlog.app; do
    adb_cmd uninstall "$package" >/dev/null 2>&1 || true
  done
}

ensure_phone_ready() {
  log "Waiting for phone runtime"
  adb_cmd wait-for-device >/dev/null
  adb_cmd shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_cmd shell svc power stayon usb >/dev/null 2>&1 || true
  adb_cmd reverse "tcp:${API_PORT}" "tcp:${API_PORT}" >/dev/null
}

preflight_phone_state() {
  log "Checking phone lock state before local validation"
  adb_cmd wait-for-device >/dev/null
  adb_cmd shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_cmd shell svc power stayon usb >/dev/null 2>&1 || true
  require_phone_unlocked
}

current_top_activity() {
  local focus_line=""
  focus_line="$(adb_cmd shell dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -n 1 || true)"
  if [[ -z "$focus_line" ]]; then
    adb_cmd shell dumpsys activity top 2>/dev/null \
      | sed -n 's/^.*ACTIVITY \([^ ]*\) .*$/\1/p' \
      | head -n 1
    return
  fi
  sed -n 's/^.* \([^ ]*\/[^ }]*\).*$/\1/p' <<<"$focus_line" | head -n 1
}

app_is_foreground() {
  local top_activity=""
  top_activity="$(current_top_activity || true)"
  [[ "$top_activity" == "${APP_PACKAGE}/"* ]]
}

bring_app_to_foreground() {
  local top_activity=""
  top_activity="$(current_top_activity || true)"
  if [[ "$top_activity" == "${APP_PACKAGE}/"* ]]; then
    return 0
  fi
  adb_cmd shell am start -W -n "$APP_COMPONENT" >/dev/null 2>&1 || true
  sleep 2
}

phone_locked() {
  adb_cmd shell dumpsys window policy 2>/dev/null \
    | grep -F "showing=true" >/dev/null
}

snapshot_phone_state() {
  local prefix="${1:-phone-state}"
  adb_cmd shell dumpsys activity top >"$TOP_ACTIVITY_PATH" 2>/dev/null || true
  adb_cmd shell dumpsys window policy >"$WINDOW_POLICY_PATH" 2>/dev/null || true
  adb_cmd shell uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1 || true
  adb_cmd exec-out cat /sdcard/window_dump.xml >"$BUILD_DIR/${prefix}.xml" 2>/dev/null || true
  adb_cmd exec-out screencap -p >"$BUILD_DIR/${prefix}.png" 2>/dev/null || true
}

require_phone_unlocked() {
  local deadline=$((SECONDS + 20))
  while (( SECONDS < deadline )); do
    if ! phone_locked; then
      return 0
    fi
    sleep 1
  done
  snapshot_phone_state "phone-locked"
  fail "Phone is locked. Unlock it manually and rerun the validation loop."
}

tap_if_present() {
  local needle="$1"
  dump_ui
  if ui_has_text "$needle"; then
    tap_text "$needle"
    return 0
  fi
  return 1
}

notification_permission_dialog_is_visible() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())

has_message = False
has_allow = False
for node in root.iter("node"):
    package = node.attrib.get("package") or ""
    if package not in {"com.google.android.permissioncontroller", "com.android.permissioncontroller"}:
        continue

    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    resource_id = node.attrib.get("resource-id") or ""
    if "send you notifications" in text or "send you notifications" in desc:
        has_message = True
    if (
        node.attrib.get("clickable") == "true"
        and text == "allow"
        and "deny" not in resource_id
    ):
        has_allow = True
    if resource_id.endswith(":id/permission_allow_button"):
        has_allow = True

if has_message and has_allow:
    raise SystemExit(0)
raise SystemExit(1)
PY
}

notification_permission_allow_coords() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

def center(bounds: str) -> str:
    left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
    return f"{(left + right) // 2} {(top + bottom) // 2}"

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())

matches = []
for node in root.iter("node"):
    package = node.attrib.get("package") or ""
    if package not in {"com.google.android.permissioncontroller", "com.android.permissioncontroller"}:
        continue
    if node.attrib.get("clickable") != "true":
        continue

    text = normalize(node.attrib.get("text") or "")
    resource_id = node.attrib.get("resource-id") or ""
    if resource_id.endswith(":id/permission_allow_button") or (text == "allow" and "deny" not in resource_id):
        matches.append(node)

if not matches:
    raise SystemExit(1)

matches.sort(key=lambda node: 0 if (node.attrib.get("resource-id") or "").endswith(":id/permission_allow_button") else 1)
print(center(matches[0].attrib["bounds"]))
PY
}

handle_notification_permission_dialog() {
  local prefix="${1:-notification-permission-dialog}"
  if ! notification_permission_dialog_is_visible; then
    return 1
  fi

  local coords
  coords="$(notification_permission_allow_coords)" || return 1
  log "Notification permission dialog detected; tapping Allow"
  capture_screen "$SCREENSHOT_DIR/${prefix}.png"
  snapshot_phone_state "$prefix"
  adb_cmd shell input tap ${coords} >/dev/null
  sleep 1
  dump_ui || true
  capture_screen "$SCREENSHOT_DIR/${prefix}-allowed.png"
  snapshot_phone_state "${prefix}-allowed"
  return 0
}

handle_play_protect_dialog() {
  dump_ui
  if ! ui_has_text "Play Protect" \
    && ! ui_has_text "Install anyway" \
    && ! ui_has_text "More details" \
    && ! ui_has_text "unsafe app" \
    && ! ui_has_text "send for analysis"; then
    return 1
  fi

  log "Play Protect dialog detected; attempting to continue install"
  tap_if_present "More details" || true
  sleep 1
  tap_if_present "Install anyway" || true
  sleep 1
  tap_if_present "Install anyway" || true
  sleep 1
  tap_if_present "Don’t send" || tap_if_present "Don't send" || true
  sleep 1
  tap_if_present "Continue install" || true
  return 0
}

install_apk() {
  log "Installing fresh APK from Windows-visible path"
  local previous_update=""
  local windows_install_path=""
  local install_log="$BUILD_DIR/adb-install.log"
  local install_pid=""
  previous_update="$(adb_cmd shell dumpsys package "$APP_PACKAGE" 2>/dev/null | sed -n 's/^[[:space:]]*lastUpdateTime=//p' | head -n 1 || true)"
  windows_install_path="$(to_windows_path "$WINDOWS_APK_PATH")"

  require_phone_unlocked

  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB" -s "$ADB_SERIAL" install --no-streaming -r "$windows_install_path" >"$install_log" 2>&1 &
  else
    "$ADB" install --no-streaming -r "$windows_install_path" >"$install_log" 2>&1 &
  fi
  install_pid="$!"

  local deadline=$((SECONDS + ADB_INSTALL_TIMEOUT_SEC))
  while kill -0 "$install_pid" 2>/dev/null; do
    if phone_locked; then
      snapshot_phone_state "install-blocked-locked"
      kill "$install_pid" 2>/dev/null || true
      wait "$install_pid" 2>/dev/null || true
      fail "Phone locked during adb install. Keep it unlocked until install + validation finish."
    fi

    local top_activity
    top_activity="$(current_top_activity)"
    if [[ "$top_activity" == *"PlayProtectDialogsActivity"* ]]; then
      handle_play_protect_dialog || true
    fi

    if (( SECONDS >= deadline )); then
      snapshot_phone_state "install-timeout"
      kill "$install_pid" 2>/dev/null || true
      wait "$install_pid" 2>/dev/null || true
      cat "$install_log" >&2 || true
      fail "Windows adb install timed out for $windows_install_path"
    fi
    sleep 2
  done

  if ! wait "$install_pid"; then
    cat "$install_log" >&2 || true
    fail "Windows adb install failed for $windows_install_path"
  fi

  if ! grep -F "Success" "$install_log" >/dev/null; then
    snapshot_phone_state "install-no-success"
    cat "$install_log" >&2 || true
    fail "Windows adb install did not report Success for $windows_install_path"
  fi

  local deadline=$((SECONDS + 240))
  while (( SECONDS < deadline )); do
    local package_dump
    package_dump="$(adb_cmd shell dumpsys package "$APP_PACKAGE" 2>/dev/null || true)"
    if grep -F "versionName=$STARLOG_VERSION_NAME" <<<"$package_dump" >/dev/null; then
      printf '%s\n' "$package_dump" >"$BUILD_DIR/package-dumpsys.txt"
      return 0
    fi

    local last_update
    last_update="$(sed -n 's/^[[:space:]]*lastUpdateTime=//p' <<<"$package_dump" | head -n 1 || true)"
    if [[ -n "$last_update" && "$last_update" != "$previous_update" && "$package_dump" == *"versionName=$STARLOG_VERSION_NAME"* ]]; then
      printf '%s\n' "$package_dump" >"$BUILD_DIR/package-dumpsys.txt"
      return 0
    fi
    sleep 2
  done

  fail "Timed out waiting for package $APP_PACKAGE to update to $STARLOG_VERSION_NAME"
}

dump_ui() {
  adb_cmd shell uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1 || return 1
  adb_cmd exec-out cat /sdcard/window_dump.xml >"$UI_XML" 2>/dev/null || return 1
}

ui_has_text() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle = sys.argv[1], sys.argv[2].lower()
root = ET.parse(path).getroot()


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def bottom_nav_top():
    candidates = []
    for node in root.iter("node"):
        desc = (node.attrib.get("content-desc") or "").lower()
        if not any(tab in desc for tab in ("assistant", "library", "planner", "review")):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = (node.attrib.get("text") or "").lower()
    desc = (node.attrib.get("content-desc") or "").lower()
    if needle in text or needle in desc:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_has_exact_text() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().strip())


path, needle = sys.argv[1], normalize(sys.argv[2])
root = ET.parse(path).getroot()


def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def bottom_nav_top():
    candidates = []
    for node in root.iter("node"):
        desc = (node.attrib.get("content-desc") or "").lower()
        if not any(tab in desc for tab in ("assistant", "library", "planner", "review")):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    if text == needle or desc == needle or desc == f"[{needle}]":
        raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_center_for_text() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle = sys.argv[1], sys.argv[2].lower()
root = ET.parse(path).getroot()

def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def center(bounds: tuple[int, int, int, int]) -> str:
    left, top, right, bottom = bounds
    return f"{(left + right) // 2} {(top + bottom) // 2}"


def bottom_nav_top():
    candidates = []
    for node in root.iter("node"):
        desc = (node.attrib.get("content-desc") or "").lower()
        if not any(tab in desc for tab in ("assistant", "library", "planner", "review")):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = (node.attrib.get("text") or "").lower()
    desc = (node.attrib.get("content-desc") or "").lower()
    if needle in text or needle in desc:
        bounds = bounds_of(node)
        if not bounds:
            continue
        print(center(bounds))
        raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_center_for_exact_label() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle = sys.argv[1], sys.argv[2].lower()
root = ET.parse(path).getroot()

def bounds_of(node):
    numbers = list(map(int, re.findall(r"\d+", node.attrib.get("bounds", ""))))
    if len(numbers) != 4:
        return None
    return tuple(numbers)


def center(bounds: tuple[int, int, int, int]) -> str:
    left, top, right, bottom = bounds
    return f"{(left + right) // 2} {(top + bottom) // 2}"


def bottom_nav_top():
    candidates = []
    for node in root.iter("node"):
        desc = (node.attrib.get("content-desc") or "").lower()
        if not any(tab in desc for tab in ("assistant", "library", "planner", "review")):
            continue
        bounds = bounds_of(node)
        if not bounds:
            continue
        left, top, right, bottom = bounds
        if top >= 1600 and right > left and bottom > top:
            candidates.append(top)
    return min(candidates) if candidates else 10**9


nav_top = bottom_nav_top()


def is_visible(node):
    bounds = bounds_of(node)
    if not bounds:
        return True
    left, top, right, bottom = bounds
    if right <= left or bottom <= top:
        return False
    return top < nav_top and bottom <= nav_top and bottom > 0


exact_matches = []
for node in root.iter("node"):
    if not is_visible(node):
        continue
    text = (node.attrib.get("text") or "").strip().lower()
    desc = (node.attrib.get("content-desc") or "").strip().lower()
    if text == needle or desc == needle or desc == f"[{needle}]":
        exact_matches.append(node)

if not exact_matches:
    raise SystemExit(1)

for node in exact_matches:
    if node.attrib.get("clickable") == "true":
        bounds = bounds_of(node)
        if not bounds:
            continue
        print(center(bounds))
        raise SystemExit(0)

first_bounds = bounds_of(exact_matches[0])
if not first_bounds:
    raise SystemExit(1)
print(center(first_bounds))
PY
}

ui_center_for_nth_class() {
  local klass="$1"
  local index="$2"
  python3 - "$UI_XML" "$klass" "$index" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, klass, index = sys.argv[1], sys.argv[2], int(sys.argv[3])
root = ET.parse(path).getroot()

def center(bounds: str) -> str:
    left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
    return f"{(left + right) // 2} {(top + bottom) // 2}"

matches = [node for node in root.iter("node") if node.attrib.get("class") == klass]
if index >= len(matches):
    raise SystemExit(1)
print(center(matches[index].attrib["bounds"]))
PY
}

ui_center_for_bottom_nav_tab() {
  local tab="$1"
  python3 - "$UI_XML" "$tab" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, tab = sys.argv[1], sys.argv[2].lower()
root = ET.parse(path).getroot()


def center(bounds: str) -> str:
    left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
    return f"{(left + right) // 2} {(top + bottom) // 2}"


def bounds_of(node):
    left, top, right, bottom = map(int, re.findall(r"\d+", node.attrib.get("bounds", "")))
    return left, top, right, bottom


def is_bottom_candidate(node: dict) -> bool:
    bounds = bounds_of(node)
    left, top, right, bottom = bounds
    # Keep it near the bottom nav rail area across screen sizes.
    return top >= 1700 and bottom > top


matches = []
for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    desc = (node.attrib.get("content-desc") or "").strip().lower()
    text = (node.attrib.get("text") or "").strip().lower()
    if not is_bottom_candidate(node):
        continue
    if tab in desc or f", {tab}" in desc or f"{tab}," in desc or tab in text:
        matches.append(node)

if not matches:
    raise SystemExit(1)

target = matches[0]
print(center(target.attrib["bounds"]))
PY
}

ui_has_class() {
  local target_class="$1"
  python3 - "$UI_XML" "$target_class" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, target_class = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()
for node in root.iter("node"):
    if node.attrib.get("class") == target_class:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

ui_has_review_controls() {
  python3 - "$UI_XML" <<'PY'
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

for node in root.iter("node"):
    if node.attrib.get("class") == "android.widget.RadioButton":
        raise SystemExit(0)
    text = (node.attrib.get("text") or "").strip()
    if text in {"RECALL QUALITY", "Save grade", "Keep in Review"}:
        raise SystemExit(0)

raise SystemExit(1)
PY
}

tap_bottom_nav_tab() {
  local tab="$1"
  dump_ui
  local coords
  coords="$(ui_center_for_bottom_nav_tab "$tab")" || return 1
  adb_cmd shell input tap ${coords} >/dev/null
}

wait_for_assistant_surface() {
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if ui_has_class "android.widget.EditText"; then
      if ui_has_text "Starlog Assistant" \
        || ui_has_text "Session active" \
        || ui_has_text "$ASSISTANT_COMMAND_TEXT" \
        || ui_has_text "Send assistant message"; then
        return 0
      fi

    fi

    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/wait-for-assistant-surface-timeout.png"
  snapshot_phone_state "assistant-surface-timeout"
  fail "Timed out waiting for Assistant tab surface"
}

wait_for_planner_surface() {
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if ! ui_has_review_controls \
      && (ui_has_text "Starlog Planner" || ui_has_exact_text "Alarm schedule" || ui_has_text "Morning briefing" || ui_has_text "Briefing" || ui_has_text "No alarm"); then
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/wait-for-planner-surface-timeout.png"
  snapshot_phone_state "planner-surface-timeout"
  fail "Timed out waiting for Planner tab surface"
}

wait_for_review_surface() {
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi
    if ui_has_text "Starlog Review" || ui_has_text "Focused Review" || ui_has_text "Knowledge Health" || ui_has_text "Load due cards" || ui_has_text "Reveal answer" || ui_has_text "Hide answer" || ui_has_text "Study progress" || ui_has_text "Recall review"; then
      return 0
    fi
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=review" -n "$APP_COMPONENT" >/dev/null || true
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/review-surface-timeout.png"
  snapshot_phone_state "review-surface-timeout"
  fail "Timed out waiting for Review tab surface"
}

ensure_review_surface() {
  adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=review" -n "$APP_COMPONENT" >/dev/null || true
  wait_for_review_surface
}

wait_for_ui_text() {
  local needle="$1"
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if dump_ui && ui_has_text "$needle"; then
      return 0
    fi
    sleep 1
  done
  capture_screen "$SCREENSHOT_DIR/wait-for-ui-text-timeout.png"
  snapshot_phone_state "wait-for-ui-text-timeout"
  fail "Timed out waiting for UI text: $needle"
}

wait_for_any_ui_text() {
  local deadline=$((SECONDS + 60))
  local needles=("$@")
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi
    for needle in "${needles[@]}"; do
      if ui_has_text "$needle"; then
        return 0
      fi
    done
    sleep 1
  done
  capture_screen "$SCREENSHOT_DIR/wait-for-any-ui-text-timeout.png"
  snapshot_phone_state "wait-for-any-ui-text-timeout"
  fail "Timed out waiting for any UI text: ${needles[*]}"
}

scroll_until_any_ui_text() {
  local deadline=$((SECONDS + 30))
  local needles=("$@")
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if dump_ui; then
      for needle in "${needles[@]}"; do
        if ui_has_text "$needle"; then
          return 0
        fi
      done
    fi
    scroll_review_controls
    sleep 1
  done
  capture_screen "$SCREENSHOT_DIR/scroll-until-ui-text-timeout.png"
  snapshot_phone_state "scroll-until-ui-text-timeout"
  fail "Timed out scrolling for any UI text: ${needles[*]}"
}

scroll_until_any_ui_text_in_review() {
  local fail_suffix="$1"
  shift
  local deadline=$((SECONDS + 45))
  local needles=("$@")
  local attempts=0
  ensure_review_surface
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi
    for needle in "${needles[@]}"; do
      if ui_has_exact_text "$needle"; then
        return 0
      fi
    done
    if (( attempts < 8 )); then
      scroll_review_controls
    else
      scroll_review_controls_reverse
    fi
    attempts=$((attempts + 1))
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/review-${fail_suffix}-timeout.png"
  snapshot_phone_state "review-${fail_suffix}-timeout"
  fail "Timed out in review while scrolling for any UI text: ${needles[*]}"
}

tap_text() {
  local needle="$1"
  dump_ui
  local coords
  coords="$(ui_center_for_text "$needle")" || fail "Could not find tappable text: $needle"
  adb_cmd shell input tap ${coords} >/dev/null
}

tap_exact_text() {
  local needle="$1"
  dump_ui
  local coords
  coords="$(ui_center_for_exact_label "$needle")" || fail "Could not find exact tappable label: $needle"
  adb_cmd shell input tap ${coords} >/dev/null
}

tap_nth_edit_text() {
  local index="$1"
  dump_ui
  local coords
  coords="$(ui_center_for_nth_class "android.widget.EditText" "$index")" || fail "Could not find EditText index $index"
  adb_cmd shell input tap ${coords} >/dev/null
}

tap_nearest_clickable_right_of_text() {
  local needle="$1"
  local max_x_offset="${2:-260}"
  local coords
  coords="$(python3 - "$UI_XML" "$needle" "$max_x_offset" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle, max_x_offset = sys.argv[1], sys.argv[2].lower(), int(sys.argv[3])
root = ET.parse(path).getroot()

def bounds_of(node: str):
    left, top, right, bottom = map(int, re.findall(r"\d+", node))
    return left, top, right, bottom

def center(left, top, right, bottom):
    return (left + right) // 2, (top + bottom) // 2

targets = []
for node in root.iter("node"):
    text = (node.attrib.get("text") or "").strip().lower()
    if needle in text:
        targets.append(bounds_of(node.attrib["bounds"]))

if not targets:
    raise SystemExit(1)

target_left, target_top, target_right, target_bottom = targets[0]
best = None
best_dx = None
for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    left, top, right, bottom = bounds_of(node.attrib["bounds"])
    if not (bottom >= target_top and top <= target_bottom):
        continue
    if left < target_right:
        continue
    dx = left - target_right
    if dx > max_x_offset:
        continue
    if best is None or dx < best_dx:
        best = (left, top, right, bottom)
        best_dx = dx

if best is None:
    raise SystemExit(1)
print(f"{center(*best)[0]} {center(*best)[1]}")
PY
)" || return 1
  adb_cmd shell input tap ${coords} >/dev/null
}

scroll_planner_content_once() {
  adb_cmd shell input swipe 540 1650 540 1120 260 >/dev/null
}

assert_planner_surface() {
  if ! (
    ui_has_text "Starlog Planner" \
    || ui_has_exact_text "Alarm schedule" \
    || ui_has_exact_text "Alarm is not scheduled yet" \
    || ui_has_exact_text "Alarm is not scheduled yet." \
    || ui_has_exact_text "Generate and cache briefing" \
    || ui_has_exact_text "No offline briefing cached yet" \
    || ui_has_text "Alarm scheduled" \
    || ui_has_text "Scheduled for" \
    || ui_has_text "Daily alarm scheduled"
  ) || ui_has_review_controls; then
    return 1
  fi
  return 0
}

planner_alarm_card_is_visible() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s:/]", " ", (value or "").lower()).strip())

def parse_bounds(value: str):
    numbers = list(map(int, re.findall(r"\d+", value)))
    if len(numbers) != 4:
        raise ValueError
    left, top, right, bottom = numbers
    if left > right:
        left, right = right, left
    if top > bottom:
        top, bottom = bottom, top
    return left, top, right, bottom

alarm_title_markers = {"alarm schedule"}
alarm_status_markers = {
    "alarm is not scheduled yet",
    "no briefing alarm scheduled",
    "alarm scheduled",
    "daily alarm scheduled",
    "scheduled for",
    "cache briefing before scheduling",
    "no offline briefing cached yet",
}
time_pattern = re.compile(r"\b[01]?\d:[0-5]\d\b")
cache_markers = {"generate and cache briefing", "cache briefing before scheduling"}
review_markers = {"again", "good", "hard", "easy"}

title_nodes = []
status_nodes = []
time_nodes = []
for node in root.iter("node"):
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    if not (text or desc):
        continue
    try:
        left, top, right, bottom = parse_bounds(node.attrib.get("bounds", ""))
    except ValueError:
        continue
    if top >= bottom or left >= right:
        continue

    if text in alarm_title_markers or desc in alarm_title_markers:
        title_nodes.append((left, top, right, bottom))
        continue

    if any(marker in text for marker in alarm_status_markers) or any(marker in desc for marker in alarm_status_markers):
        status_nodes.append((left, top, right, bottom))
        continue

    if time_pattern.search(text) or time_pattern.search(desc):
        time_nodes.append((left, top, right, bottom))

if not title_nodes:
    raise SystemExit(1)

title_left = min(node[0] for node in title_nodes)
title_top = min(node[1] for node in title_nodes)
title_right = max(node[2] for node in title_nodes)
title_bottom = max(node[3] for node in title_nodes)
status_or_time_nodes = status_nodes + time_nodes
if not status_or_time_nodes:
    raise SystemExit(1)

status_top = min((node[1] for node in status_or_time_nodes), default=title_top)
status_bottom = max((node[3] for node in status_or_time_nodes), default=title_bottom)

region_top = max(0, status_top - 170)
region_bottom = status_bottom + 260
region_left = title_left - 16
region_right = 1080
control_anchor_x = max(
    title_left + int((title_right - title_left) * 0.66),
    max((node[2] for node in status_or_time_nodes), default=title_left),
)
control_anchor_x = min(region_right, control_anchor_x)

for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    try:
        left, top, right, bottom = parse_bounds(node.attrib.get("bounds", ""))
    except ValueError:
        continue
    if top >= bottom or left >= right:
        continue
    if right <= region_left or left >= region_right:
        continue
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2

    if center_x + 40 < control_anchor_x:
        continue
    if bottom < region_top or top > region_bottom + 40:
        continue
    if center_y >= 1700:
        continue

    class_name = (node.attrib.get("class") or "").lower()
    if class_name in {"android.widget.radiobutton", "android.widget.imageview"}:
        continue

    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    if any(token in text for token in review_markers) or any(token in desc for token in review_markers):
        continue
    if any(token in text for token in cache_markers) or any(token in desc for token in cache_markers):
        continue

    if class_name in {"android.view.viewgroup", "android.view.view"}:
        raise SystemExit(0)
    if class_name in {"android.widget.switch", "android.widget.togglebutton", "android.widget.checkbox"}:
        raise SystemExit(0)

raise SystemExit(1)
PY
}

ensure_planner_alarm_control_visible() {
  local deadline=$((SECONDS + 45))
  local tries=0
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if planner_alarm_card_is_visible; then
      return 0
    fi

    scroll_planner_content_once
    tries=$((tries + 1))
    if (( tries > 1 )); then
      sleep 1
    fi
  done

  capture_screen "$SCREENSHOT_DIR/planner-alarm-control-missing.png"
  snapshot_phone_state "planner-alarm-control-missing"
  capture_screen "$SCREENSHOT_DIR/planner-alarm-card-missing.png"
  snapshot_phone_state "planner-alarm-card-missing"
  fail "Could not reveal a dedicated Planner Alarm card while scrolling"
}

tap_planner_alarm_control() {
  local attempt="${1:-1}"
  local diagnostics_path="${2:-$BUILD_DIR/planner-alarm-control-candidate-${attempt}.json}"
  PLANNER_ALARM_CONTROL_DIAGNOSTICS="$diagnostics_path"
  local coords
  coords="$(python3 - "$UI_XML" "$diagnostics_path" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET
import json

path = sys.argv[1]
diagnostics_path = sys.argv[2]
root = ET.parse(path).getroot()

screen_left = 0
screen_right = 1080
screen_top = 0
screen_bottom = 1920
for node in root.iter("node"):
    bounds = re.findall(r"\d+", node.attrib.get("bounds", ""))
    if len(bounds) == 4 and bounds[0] == "0" and bounds[1] == "0":
        screen_left, _, screen_right, _ = map(int, bounds)
        break

for node in root.iter("node"):
    bounds = re.findall(r"\d+", node.attrib.get("bounds", ""))
    if len(bounds) == 4 and bounds[0] == "0" and bounds[1] == "0":
        _, _, _, screen_bottom = map(int, bounds)
        break

def parse_bounds(value: str):
    numbers = list(map(int, re.findall(r"\d+", value)))
    if len(numbers) != 4:
        raise ValueError
    left, top, right, bottom = numbers
    if left > right:
        left, right = right, left
    if top > bottom:
        top, bottom = bottom, top
    return left, top, right, bottom

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s:/]", " ", (value or "").lower()).strip())

alarm_title_markers = {"alarm schedule"}
alarm_status_markers = {
    "alarm is not scheduled yet",
    "no briefing alarm scheduled",
    "alarm scheduled",
    "daily alarm scheduled",
    "scheduled for",
    "cache briefing before scheduling",
    "no offline briefing cached yet",
}
cache_markers = {
    "generate and cache briefing",
    "cache briefing before scheduling",
}
time_pattern = re.compile(r"\b[01]?\d:[0-5]\d\b")
review_markers = {
    "again",
    "good",
    "hard",
    "easy",
    "reveal answer",
    "load due cards",
    "save grade",
    "focused review",
    "knowledge health",
}
noise_markers = {
    "cache briefing",
    "audio",
    "play",
    "speaker",
    "sound",
    "record",
}

title_nodes = []
status_nodes = []
time_nodes = []
for node in root.iter("node"):
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    if not (text or desc):
        continue

    try:
        left, top, right, bottom = parse_bounds(node.attrib["bounds"])
    except ValueError:
        continue
    if top >= bottom or left >= right:
        continue

    if text in alarm_title_markers or desc in alarm_title_markers:
        title_nodes.append((left, top, right, bottom))
        continue

    if any(marker in text for marker in alarm_status_markers) or any(marker in desc for marker in alarm_status_markers):
        status_nodes.append((left, top, right, bottom))
        continue

    if time_pattern.search(text) or time_pattern.search(desc):
        time_nodes.append((left, top, right, bottom))

if not title_nodes:
    raise SystemExit(1)

status_or_time_nodes = status_nodes + time_nodes
if not status_or_time_nodes:
    raise SystemExit(1)

title_left = min(node[0] for node in title_nodes)
title_top = min(node[1] for node in title_nodes)
title_right = max(node[2] for node in title_nodes)
title_bottom = max(node[3] for node in title_nodes)
status_top = min((node[1] for node in status_or_time_nodes), default=title_top)
status_bottom = max((node[3] for node in status_or_time_nodes), default=title_bottom)

region_top = max(screen_top, title_top - 140)
region_bottom = max(title_bottom + 420, status_bottom + 220)
region_left = max(screen_left, title_left - 20)
region_right = screen_right
region_mid_y = (title_top + title_bottom) // 2

for node in status_or_time_nodes:
    region_top = min(region_top, node[1])
    region_bottom = max(region_bottom, node[3])

title_width = max(1, title_right - title_left)
control_anchor_x = max(
    title_left + int(title_width * 0.66),
    max((node[2] for node in status_or_time_nodes), default=title_left),
)
control_anchor_x = min(region_right, control_anchor_x)

candidates = []
for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    text = normalize(node.attrib.get("text") or "")
    desc = normalize(node.attrib.get("content-desc") or "")
    class_name = (node.attrib.get("class") or "").lower()
    if not (text or desc) and class_name not in {"android.view.viewgroup", "android.view.view"}:
        continue
    if node.attrib.get("class") == "android.widget.ImageView":
        if node.attrib.get("clickable") == "true" and text == "" and desc == "":
            continue

    try:
        left, top, right, bottom = parse_bounds(node.attrib["bounds"])
    except ValueError:
        continue
    if top >= bottom or left >= right:
        continue
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2

    if center_x + 40 < control_anchor_x:
        continue
    if left >= region_right or right <= region_left:
        continue
    if bottom < region_top or top > region_bottom + 60:
        continue
    if center_y >= screen_bottom - 300:
        continue

    if class_name in {"android.widget.radiobutton", "android.widget.imageview"}:
        continue
    if any(token in text for token in review_markers) or any(token in desc for token in review_markers):
        continue
    if any(token in text for token in cache_markers) or any(token in desc for token in cache_markers):
        continue
    if any(token in text for token in noise_markers) or any(token in desc for token in noise_markers):
        continue

    alarm_hint = (
        "toggle" in desc
        or "switch" in text
        or "morning alarm" in desc
        or "alarm" in desc
    )
    inside_tight_region = top >= region_top and bottom <= region_bottom + 180
    if not inside_tight_region and not alarm_hint:
        continue

    score = abs(center_y - region_mid_y)
    score_reasons = [f"center_y_delta={abs(center_y - region_mid_y)}"]

    x_gap = left - control_anchor_x
    if x_gap > 0:
        score += x_gap
        score_reasons.append(f"x_gap={x_gap}")
    else:
        score += 80
        score_reasons.append("left_of_control_anchor")

    if class_name in {"android.widget.switch", "android.widget.togglebutton", "android.widget.checkbox"}:
        score -= 140
        score_reasons.append("prefer_controls_switchish")
    elif class_name in {"android.widget.button", "android.widget.imagebutton"}:
        score += 30
        score_reasons.append("button_penalty")
    if alarm_hint:
        score -= 80
        score_reasons.append("alarm_hint")

    if not inside_tight_region:
        score += 80
        score_reasons.append("outside_tight_region")

    candidates.append({
        "score": score,
        "x": center_x,
        "y": center_y,
        "bounds": f"{left} {top} {right} {bottom}",
        "class": node.attrib.get("class") or "",
        "text": node.attrib.get("text") or "",
        "content_desc": node.attrib.get("content-desc") or "",
        "reason": "; ".join(score_reasons),
    })

if not candidates:
    for node in root.iter("node"):
        if node.attrib.get("class") != "android.widget.Switch":
            continue
        if node.attrib.get("clickable") != "true":
            continue
        text = normalize(node.attrib.get("text") or "")
        desc = normalize(node.attrib.get("content-desc") or "")
        try:
            left, top, right, bottom = parse_bounds(node.attrib["bounds"])
        except ValueError:
            continue
        if top >= bottom or left >= right:
            continue
        if left < control_anchor_x - 40:
            continue
        center_x = (left + right) // 2
        center_y = (top + bottom) // 2
        if center_y >= screen_bottom - 300:
            continue
        if bottom < region_top or top > region_bottom + 180:
            continue
        candidates.append({
            "score": 0,
            "x": center_x,
            "y": center_y,
            "bounds": f"{left} {top} {right} {bottom}",
            "class": node.attrib.get("class") or "",
            "text": node.attrib.get("text") or "",
            "content_desc": node.attrib.get("content-desc") or "",
            "reason": f"fallback_switch_in_row;text={text};content_desc={desc}",
        })

if not candidates:
    raise SystemExit(1)

candidates.sort(key=lambda item: (item["score"], item["y"], item["x"]))
selected = candidates[0]

payload = {
    "selected": selected,
    "region": {
        "left": region_left,
        "top": region_top,
        "right": region_right,
        "bottom": region_bottom,
        "title_bounds": f"{title_left} {title_top} {title_right} {title_bottom}",
        "control_anchor_x": control_anchor_x,
    },
    "top_candidates": candidates[:8],
}
with open(diagnostics_path, "w", encoding="utf-8") as handle:
    handle.write(json.dumps(payload, indent=2, sort_keys=True))

print(f"{selected['x']} {selected['y']}")
PY
)" || return 1
  printf '%s\n' "$coords"
  adb_cmd shell input tap ${coords} >/dev/null
}

tap_planner_alarm_control_with_verification() {
  local attempt="${1:-1}"

  capture_screen "$SCREENSHOT_DIR/planner-alarm-control-pre-tap-${attempt}.png"
  snapshot_phone_state "planner-alarm-control-pre-tap-${attempt}"

  if ! tap_planner_alarm_control "$attempt"; then
    snapshot_phone_state "planner-alarm-control-missing"
    fail "Could not locate planner alarm control near alarm card (attempt ${attempt}); diagnostics: ${PLANNER_ALARM_CONTROL_DIAGNOSTICS}"
  fi

  capture_screen "$SCREENSHOT_DIR/planner-alarm-control-tapped-${attempt}.png"
  snapshot_phone_state "planner-alarm-control-tapped-${attempt}"

  sleep 1
  if dump_ui && handle_notification_permission_dialog "planner-notification-permission-${attempt}"; then
    dump_ui || true
  fi

  if ! assert_planner_surface; then
    if handle_notification_permission_dialog "planner-notification-permission-${attempt}-retry"; then
      dump_ui || true
      if assert_planner_surface; then
        return 0
      fi
    fi

    capture_screen "$SCREENSHOT_DIR/planner-alarm-wrong-surface-${attempt}.png"
    snapshot_phone_state "planner-alarm-wrong-surface-${attempt}"
    fail "Tapped alarm control moved out of Planner surface before scheduling (attempt ${attempt}); diagnostics: ${PLANNER_ALARM_CONTROL_DIAGNOSTICS}"
  fi
}

tap_planner_alarm_cache_control() {
  local coords
  coords="$(python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    text = re.sub(r"\s+", " ", (node.attrib.get("text") or "").strip().lower())
    desc = re.sub(r"\s+", " ", (node.attrib.get("content-desc") or "").strip().lower())
    if text == "generate and cache briefing" or desc == "generate and cache briefing":
        bounds = node.attrib.get("bounds", "")
        left, top, right, bottom = map(int, re.findall(r"\d+", bounds))
        cx = (left + right) // 2
        cy = (top + bottom) // 2
        print(f"{cx} {cy}")
        raise SystemExit(0)

raise SystemExit(1)
PY
)" || return 1
  adb_cmd shell input tap ${coords} >/dev/null
}

wait_for_planner_alarm_cache_ready() {
  local deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi
    if ! assert_planner_surface; then
      capture_screen "$SCREENSHOT_DIR/planner-alarm-cache-wrong-surface.png"
      snapshot_phone_state "planner-alarm-cache-wrong-surface"
      fail "Planner alarm cache flow navigated away from Planner surface"
    fi

    local alarm_state
    alarm_state="$(ui_planner_alarm_state)"
    if [[ "$alarm_state" != "cache_missing" && "$alarm_state" != "blocked" ]]; then
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/planner-alarm-cache-missing-timeout.png"
  snapshot_phone_state "planner-alarm-cache-missing-timeout"
  fail "Timed out waiting for planner cache readiness before scheduling"
}

ui_planner_alarm_state() {
  python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
root = ET.parse(path).getroot()

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()

texts = [normalize(node.attrib.get("text", "")) for node in root.iter("node")]
for text in texts:
    if not text:
        continue
    if "cache briefing before scheduling" in text:
        print("blocked")
        raise SystemExit(0)
    if "no offline briefing cached yet" in text:
        print("cache_missing")
        raise SystemExit(0)

if any("no briefing alarm scheduled" in t or "alarm is not scheduled yet" in t for t in texts):
    print("unscheduled")
    raise SystemExit(0)

if any(
    "until play" in t
    or "until alarm" in t
    or "alarm scheduled" in t
    or "daily alarm scheduled" in t
    or "scheduled for" in t
    for t in texts
):
    print("scheduled")
    raise SystemExit(0)

print("unknown")
PY
}

wait_for_planner_alarm_state() {
  local expected_state="$1"
  local deadline=$((SECONDS + 45))
  local planner_alarm_state=""
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if ! assert_planner_surface; then
      if handle_notification_permission_dialog "planner-notification-permission-wait"; then
        continue
      fi
      capture_screen "$SCREENSHOT_DIR/planner-alarm-wrong-surface.png"
      snapshot_phone_state "planner-alarm-wrong-surface"
      fail "Planner alarm flow navigated away from Planner while waiting for alarm state"
    fi

    planner_alarm_state="$(ui_planner_alarm_state)"
    if [[ "$planner_alarm_state" == "$expected_state" ]]; then
      return 0
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/wait-for-planner-alarm-status-timeout.png"
  snapshot_phone_state "planner-alarm-status-timeout"
  fail "Timed out waiting for planner alarm state: $expected_state (last observed: ${planner_alarm_state:-unknown})"
}

latest_review_grade_status_after_line() {
  local start_line="$1"
  python3 - "$API_LOG" "$start_line" <<'PY'
import re
import sys

path = sys.argv[1]
start_line = int(sys.argv[2])
lines = open(path, errors="ignore").read().splitlines()
status = ""
for line in lines[start_line:]:
    match = re.search(r'"POST /v1/reviews HTTP/[0-9.]+"\s+(\d{3})', line)
    if match:
        status = match.group(1)
if status:
    print(status)
PY
}

latest_assistant_turn_status_after_line() {
  local start_line="$1"
  python3 - "$API_LOG" "$start_line" <<'PY'
import re
import sys

path = sys.argv[1]
start_line = int(sys.argv[2])
lines = open(path, errors="ignore").read().splitlines()
latest = ""
for line in lines[start_line:]:
    for endpoint in (
        "/v1/assistant/threads/primary/messages",
        "/v1/assistant/threads/primary/events",
    ):
        match = re.search(r'"POST ' + re.escape(endpoint) + r' HTTP/[0-9.]+"\s+(\d{3})', line)
        if match:
            latest = f"{endpoint} {match.group(1)}"
if latest:
    print(latest)
PY
}

latest_briefing_package_marker() {
  "$VENV_PYTHON" - "$RUNTIME_DIR/starlog.db" <<'PY'
from pathlib import Path
import sqlite3
import sys

db_path = Path(sys.argv[1])
with sqlite3.connect(db_path) as conn:
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT id, date, created_at FROM briefing_packages ORDER BY created_at DESC, id DESC LIMIT 1"
    ).fetchone()
if row is None:
    raise SystemExit(1)

print(f"{row['id']}|{row['date']}|{row['created_at']}")
PY
}

assert_latest_briefing_has_recommendation_hints() {
  local previous_marker="${1:-}"
  local deadline=$((SECONDS + 45))
  local status=""
  local briefing_date=""
  local briefing_id=""
  local briefing_marker=""
  local reason=""

  while (( SECONDS < deadline )); do
    briefing_marker="$(latest_briefing_package_marker || true)"
    if [[ -n "$briefing_marker" && "$briefing_marker" != "$previous_marker" ]]; then
      IFS='|' read -r briefing_id briefing_date _ <<< "$briefing_marker"
      status="$(curl -sS -o "$BUILD_DIR/briefing-latest.json" -w '%{http_code}' \
        "$API_BASE/v1/briefings/$briefing_date" \
        -H "Authorization: Bearer $STARLOG_LOCAL_ACCESS_TOKEN")"
      if [[ "$status" == "200" ]]; then
        reason="$(python3 - "$BUILD_DIR/briefing-latest.json" <<'PY'
import json
import sys

path = sys.argv[1]
payload = json.loads(open(path, encoding="utf-8").read())
recommendation_hints = payload.get("recommendation_hints") or []
if not isinstance(recommendation_hints, list):
    raise SystemExit(1)
if not recommendation_hints:
    raise SystemExit(2)

if not any(
    item.get("surface") == "briefing" and str(item.get("signal_type")).startswith("briefing_")
    for item in recommendation_hints
):
    raise SystemExit(3)

print(len(recommendation_hints))
PY
)" || reason=""

        if [[ -n "$reason" ]]; then
          log "Briefing recommendation hints validated (briefing id=${briefing_id}, date=${briefing_date}, count=${reason})"
          return 0
        fi
      fi
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/planner-briefing-hints-timeout.png"
  snapshot_phone_state "planner-briefing-hints-timeout"
  fail "Did not observe a new recommendation-backed briefing payload after cache generation (last status: ${status:-unknown}, marker: ${briefing_marker:-none})"
}

query_due_count() {
  local out_file="$1"
  if [[ -z "$STARLOG_LOCAL_ACCESS_TOKEN" ]]; then
    return 1
  fi

  local status
  status="$(curl -sS -o "$out_file" -w '%{http_code}' \
    -X GET "$API_BASE/v1/cards/due?limit=200" \
    -H "Authorization: Bearer $STARLOG_LOCAL_ACCESS_TOKEN")"
  if [[ "$status" != "200" ]]; then
    return 1
  fi

  python3 - "$out_file" <<'PY'
import json
import sys

payload = json.loads(open(sys.argv[1], encoding="utf-8").read())
if isinstance(payload, dict):
    cards = payload.get("cards") or payload.get("items") or []
elif isinstance(payload, list):
    cards = payload
else:
    cards = []
print(len(cards))
PY
}

assert_assistant_turn_recorded() {
  local log_line_before="$1"
  local deadline=$((SECONDS + 30))
  local status=""
  local endpoint=""
  local status_line=""

  while (( SECONDS < deadline )); do
    status_line="$(latest_assistant_turn_status_after_line "$log_line_before" || true)"
    if [[ -n "$status_line" ]]; then
      read -r endpoint status <<<"$status_line"
      if [[ "$status" == "200" || "$status" == "201" || "$status" == "204" ]]; then
        return 0
      fi

      if [[ "$status" == "400" || "$status" == "401" || "$status" == "403" || "$status" == "404" || "$status" == "422" ]]; then
        fail "Assistant turn request to $endpoint returned HTTP $status (check token/session/thread state and $API_LOG)"
      fi
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/assistant-command-timeout.png"
  snapshot_phone_state "assistant-command-timeout"
  fail "Did not observe a successful assistant command API response after sending command; expected /v1/assistant/threads/primary/messages or /v1/assistant/threads/primary/events. Last observed: ${endpoint:-none} ${status:-none}"
}

assert_review_grade_recorded() {
  local log_line_before="$1"
  local due_count_before="$2"
  local deadline=$((SECONDS + 30))
  local status=""
  local due_count_after=""
  local due_count_reached_limit=0
  if [[ -n "$due_count_before" && "$due_count_before" -ge 200 ]]; then
    due_count_reached_limit=1
  fi

  while (( SECONDS < deadline )); do
    status="$(latest_review_grade_status_after_line "$log_line_before" || true)"
    if [[ -n "$status" ]]; then
      if [[ "$status" == "200" || "$status" == "201" || "$status" == "204" ]]; then
        return 0
      fi
      if [[ "$status" == "404" ]]; then
        fail "Review grade request returned HTTP 404 from local API"
      fi
    fi

    if [[ -n "$due_count_before" ]]; then
      if due_count_after="$(query_due_count "$BUILD_DIR/review-due-after.json" || true)"; then
        if [[ "$due_count_reached_limit" -eq 1 ]]; then
          true
        elif [[ "$due_count_after" -lt "$due_count_before" ]]; then
          return 0
        fi
      fi
    fi

    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/review-grade-timeout.png"
  snapshot_phone_state "review-grade-timeout"
  fail "Did not observe a successful /v1/reviews write or due-card state progress after tapping Good (last status: ${status:-none}, due-before: ${due_count_before:-unknown}, due-after: ${due_count_after:-unknown})"
}

assert_assistant_review_grade_dynamic_ui() {
  log "Opening Assistant to verify review-grade dynamic UI contract rendering"
  if tap_bottom_nav_tab "assistant"; then
    wait_for_assistant_surface
  else
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=assistant" -n "$APP_COMPONENT" >/dev/null || true
    wait_for_assistant_surface
  fi

  local deadline=$((SECONDS + 45))
  local found_recall_quality=0
  local found_save_grade=0
  local found_keep_review=0
  local found_grade_option=0
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi

    if ui_has_text "interview.review_grade" || ui_has_text "grade_review_recall"; then
      capture_screen "$SCREENSHOT_DIR/assistant-review-grade-dynamic-ui-raw-label.png"
      snapshot_phone_state "assistant-review-grade-dynamic-ui-raw-label"
      fail "Assistant review-grade panel exposed raw renderer/tool labels instead of human dynamic UI labels"
    fi

    if ui_has_text "RECALL QUALITY"; then
      found_recall_quality=1
    fi
    if ui_has_text "Save grade"; then
      found_save_grade=1
    fi
    if ui_has_text "Keep in Review"; then
      found_keep_review=1
    fi
    if ui_has_text "Good"; then
      found_grade_option=1
    fi

    if (( found_recall_quality == 1 && found_save_grade == 1 && found_keep_review == 1 && found_grade_option == 1 )); then
      break
    fi

    scroll_review_controls
    sleep 1
  done

  if (( found_recall_quality != 1 || found_save_grade != 1 || found_keep_review != 1 || found_grade_option != 1 )); then
    capture_screen "$SCREENSHOT_DIR/assistant-review-grade-dynamic-ui-missing.png"
    snapshot_phone_state "assistant-review-grade-dynamic-ui-missing"
    fail "Assistant review-grade dynamic UI did not expose required controls (RECALL QUALITY, Save grade, Keep in Review, grade option)"
  fi

  capture_screen "$SCREENSHOT_DIR/assistant-review-grade-dynamic-ui.png"
  snapshot_phone_state "assistant-review-grade-dynamic-ui"
}

study_mutation_statuses_after_line() {
  local start_line="$1"
  python3 - "$API_LOG" "$start_line" <<'PY'
import json
import re
import sys

path = sys.argv[1]
start_line = int(sys.argv[2])
lines = open(path, errors="ignore").read().splitlines()
statuses = {"unlock": "", "read": "", "question": ""}
patterns = {
    "unlock": re.compile(r'"POST /v1/study/topics/[^/]+/unlock HTTP/[0-9.]+"\s+(\d{3})'),
    "read": re.compile(r'"POST /v1/study/topics/[^/]+/read HTTP/[0-9.]+"\s+(\d{3})'),
    "question": re.compile(r'"POST /v1/study/question-requests HTTP/[0-9.]+"\s+(\d{3})'),
}
for line in lines[start_line:]:
    for key, pattern in patterns.items():
        match = pattern.search(line)
        if match:
            statuses[key] = match.group(1)
print(json.dumps(statuses, sort_keys=True))
PY
}

assert_native_study_mutations_recorded() {
  local log_line_before="$1"
  local deadline=$((SECONDS + 35))
  local statuses_json=""

  while (( SECONDS < deadline )); do
    statuses_json="$(study_mutation_statuses_after_line "$log_line_before" || true)"
    if [[ -n "$statuses_json" ]]; then
      if python3 - "$statuses_json" <<'PY'
import json
import sys

statuses = json.loads(sys.argv[1])
for key in ("unlock", "read", "question"):
    value = statuses.get(key) or ""
    if not value.startswith("2"):
        raise SystemExit(1)
PY
      then
        return 0
      fi
    fi
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/native-study-mutation-timeout.png"
  snapshot_phone_state "native-study-mutation-timeout"
  fail "Did not observe successful native study unlock/read/question API writes (last statuses: ${statuses_json:-none})"
}

assert_native_study_db_progress() {
  "$VENV_PYTHON" - "$RUNTIME_DIR/starlog.db" <<'PY'
import sqlite3
import sys

db_path = sys.argv[1]
with sqlite3.connect(db_path) as conn:
    progress = conn.execute(
        "SELECT COUNT(*) FROM study_topic_progress WHERE status = 'read' AND read_at IS NOT NULL"
    ).fetchone()[0]
    requests = conn.execute("SELECT COUNT(*) FROM study_question_requests").fetchone()[0]

if progress < 1:
    raise SystemExit("Expected at least one read Study Core topic after native validation")
if requests < 1:
    raise SystemExit("Expected at least one Study Core question request after native validation")
PY
}

wait_for_native_study_controls() {
  local deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    if ! dump_ui; then
      sleep 1
      continue
    fi
    if ui_has_text "Study loop" && ui_has_text "Unlock" && ui_has_text "Mark read" && ui_has_text "Application question"; then
      return 0
    fi
    if ui_has_text "Study progress" && ui_has_text "0 sources"; then
      sleep 1
      continue
    fi
    adb_cmd shell input swipe 540 1500 540 950 220 >/dev/null || true
    sleep 1
  done

  capture_screen "$SCREENSHOT_DIR/native-study-controls-timeout.png"
  snapshot_phone_state "native-study-controls-timeout"
  fail "Timed out waiting for native Study Core controls in Review"
}

validate_native_study_controls() {
  log "Validating native Study Core unlock/read/question controls"
  wait_for_native_study_controls
  capture_screen "$SCREENSHOT_DIR/native-study-before.png"
  snapshot_phone_state "native-study-before"

  local study_api_log_line_before
  study_api_log_line_before="$(wc -l < "$API_LOG")"

  tap_exact_text "Unlock"
  sleep 2
  wait_for_any_ui_text "Mark read" "Application question"
  tap_exact_text "Mark read"
  sleep 2
  wait_for_any_ui_text "Study loop" "Application question"
  tap_exact_text "Application question"
  sleep 2

  capture_screen "$SCREENSHOT_DIR/native-study-after.png"
  snapshot_phone_state "native-study-after"
  assert_native_study_mutations_recorded "$study_api_log_line_before"
  assert_native_study_db_progress
}

tap_send_after_first_edit_text() {
  local expected_command="$1"
  local log_line_before="$2"
  local max_x_offset="${3:-300}"
  local coords
  local status_line=""
  local deadline

  dump_ui || true
  coords="$(python3 - "$UI_XML" "$expected_command" "$max_x_offset" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, expected_command, max_x_offset = sys.argv[1], (sys.argv[2] or "").strip().lower(), int(sys.argv[3])
root = ET.parse(path).getroot()


def bounds_of(value: str):
    left, top, right, bottom = map(int, re.findall(r"\d+", value))
    return left, top, right, bottom


def center(bounds: tuple[int, ...]):
    left, top, right, bottom = bounds
    return (left + right) // 2, (top + bottom) // 2


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def is_chip_candidate(node: ET.Element) -> bool:
    klass = (node.attrib.get("class") or "").lower()
    resource_id = (node.attrib.get("resource-id") or "").lower()
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    if "chip" in klass:
        return True
    if "chip" in resource_id:
        return True
    if text in {"good", "hard", "easy", "again"} and node.attrib.get("clickable") == "true":
        return True
    if desc in {"good", "hard", "easy", "again"} and node.attrib.get("clickable") == "true":
        return True
    return False


def is_bottom_nav_candidate(node: ET.Element, screen_bottom: int) -> bool:
    _, _, _, bottom = bounds_of(node.attrib["bounds"])
    if screen_bottom > 0 and bottom >= int(screen_bottom * 0.86):
        return True
    text = normalize(node.attrib.get("text"))
    desc = normalize(node.attrib.get("content-desc"))
    for value in (text, desc):
        if value in {"assistant", "review", "planner", "library", "starlog assistant", "starlog planner", "starlog review", "home"}:
            return True
    return False


edit = None
for node in root.iter("node"):
    if node.attrib.get("class") != "android.widget.EditText":
        continue
    if expected_command and expected_command in normalize(node.attrib.get("text", "")):
        edit = node
        break

if edit is None:
    for node in root.iter("node"):
        if node.attrib.get("class") != "android.widget.EditText":
            continue
        edit = node
        break

if edit is None:
    raise SystemExit(1)

e_left, e_top, e_right, e_bottom = bounds_of(edit.attrib["bounds"])
edit_height = max(1, e_bottom - e_top)
band_top = max(0, e_top - max(10, edit_height // 4))
band_bottom = e_bottom + max(10, edit_height // 4)

screen_bottom = 0
for node in root.iter("node"):
    if "bounds" not in node.attrib:
        continue
    try:
        _, _, _, node_bottom = bounds_of(node.attrib["bounds"])
    except ValueError:
        continue
    screen_bottom = max(screen_bottom, node_bottom)

best = None
best_score = None
for node in root.iter("node"):
    if node.attrib.get("clickable") != "true":
        continue
    if "bounds" not in node.attrib:
        continue
    b = bounds_of(node.attrib["bounds"])
    if b[3] < band_top or b[1] > band_bottom:
        continue
    if node.attrib.get("class") == "android.widget.EditText":
        continue
    if is_chip_candidate(node):
        continue
    if is_bottom_nav_candidate(node, screen_bottom):
        continue

    left, _, right, _ = b
    if right < e_left:
        continue

    dx = left - e_right
    if dx >= 0:
        if dx > max_x_offset:
            continue
        score = dx
    else:
        overlap = e_right - left
        if overlap < 0 or overlap > max_x_offset:
            continue
        score = (max_x_offset * 2) + overlap

    if best is None or score < best_score:
        best = b
        best_score = score

if best is None:
    raise SystemExit(1)
print(f"{center(best)[0]} {center(best)[1]}")
PY
)" || return 2

  for send_attempt in 1 2 3; do
    if [[ "$send_attempt" -eq 2 ]]; then
      adb_cmd shell input keyevent KEYCODE_ENTER >/dev/null || true
    else
      adb_cmd shell input tap ${coords} >/dev/null
    fi
    sleep 1

    deadline=$((SECONDS + 8))
    while (( SECONDS < deadline )); do
      status_line="$(latest_assistant_turn_status_after_line "$log_line_before" || true)"
      if [[ -n "$status_line" ]]; then
        return 0
      fi
      dump_ui || true
      if assistant_command_cleared "$expected_command"; then
        return 0
      fi
      sleep 1
    done
  done

  dump_ui || true
  coords="$(python3 - "$UI_XML" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()


def bounds_of(value: str):
    return tuple(map(int, re.findall(r"\d+", value)))


screen_right = 0
edit_bounds = None
for node in root.iter("node"):
    if "bounds" not in node.attrib:
        continue
    left, top, right, bottom = bounds_of(node.attrib["bounds"])
    screen_right = max(screen_right, right)
    if edit_bounds is None and node.attrib.get("class") == "android.widget.EditText":
        edit_bounds = (left, top, right, bottom)

if edit_bounds is None:
    raise SystemExit(1)

left, top, right, bottom = edit_bounds
x = min(max(right + 126, right + 40), max(1, screen_right - 80))
y = (top + bottom) // 2
print(f"{x} {y}")
PY
)" || coords=""
  if [[ -n "$coords" ]]; then
    adb_cmd shell input tap ${coords} >/dev/null
    sleep 3
    status_line="$(latest_assistant_turn_status_after_line "$log_line_before" || true)"
    if [[ -n "$status_line" ]]; then
      return 0
    fi
    dump_ui || true
    if assistant_command_cleared "$expected_command"; then
      return 0
    fi
  fi

  capture_screen "$SCREENSHOT_DIR/assistant-send-verify-fail.png"
  snapshot_phone_state "assistant-send-verify-fail"
  return 1
}

assistant_command_cleared() {
  local expected_command="$1"
  python3 - "$UI_XML" "$expected_command" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, expected_command = sys.argv[1], (sys.argv[2] or "").strip().lower()
root = ET.parse(path).getroot()

def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())

edit = None
for node in root.iter("node"):
    if node.attrib.get("class") != "android.widget.EditText":
        continue
    if edit is None:
        edit = node
    text = normalize(node.attrib.get("text", ""))
    desc = normalize(node.attrib.get("content-desc", ""))
    if expected_command and (expected_command in text or expected_command in desc):
        raise SystemExit(1)

if edit is None:
    raise SystemExit(1)

if normalize(edit.attrib.get("text", "")) or normalize(edit.attrib.get("content-desc", "")):
    raise SystemExit(1)

raise SystemExit(0)
PY
}

clear_focused_text_field() {
  adb_cmd shell input keyevent KEYCODE_MOVE_END >/dev/null 2>&1 || true
  for _ in $(seq 1 96); do
    adb_cmd shell input keyevent KEYCODE_DEL >/dev/null 2>&1 || true
  done
}

capture_screen() {
  local path="$1"
  adb_cmd exec-out screencap -p > "$path"
}

wait_for_post_login_surface() {
  local deadline=$((SECONDS + 25))
  while (( SECONDS < deadline )); do
    if ! app_is_foreground; then
      bring_app_to_foreground
    fi
    if ! dump_ui; then
      sleep 1
      continue
    fi
    if ! ui_has_text "PASSPHRASE" && ! ui_has_text "SIGN IN"; then
      return 0
    fi
    if ui_has_text "Network request failed" || ui_has_text "Login failed" || ui_has_text "Bootstrap failed"; then
      capture_screen "$SCREENSHOT_DIR/login-failure.png"
      fail "Mobile login failed before leaving the auth screen"
    fi
    sleep 1
  done
  capture_screen "$SCREENSHOT_DIR/login-timeout.png"
  fail "Mobile login did not transition out of the auth screen"
}

scroll_review_controls() {
  adb_cmd shell input swipe 540 1800 540 1200 250 >/dev/null
}

scroll_review_controls_reverse() {
  adb_cmd shell input swipe 540 1200 540 1800 250 >/dev/null
}

launch_and_validate_review() {
  log "Launching app into fresh login state"
  adb_cmd reverse "tcp:${API_PORT}" "tcp:${API_PORT}" >/dev/null
  adb_cmd shell am start -W -n "$APP_COMPONENT" >/dev/null
  sleep 2

  wait_for_any_ui_text "PASSPHRASE" "API ENDPOINT" "SIGN IN"
  capture_screen "$SCREENSHOT_DIR/login.png"

  tap_nth_edit_text 0
  clear_focused_text_field
  adb_cmd shell input text "$API_BASE" >/dev/null
  sleep 1

  bring_app_to_foreground
  tap_nth_edit_text 1
  clear_focused_text_field
  adb_cmd shell input text "$STARLOG_TEST_PASSPHRASE" >/dev/null
  sleep 1
  bring_app_to_foreground
  tap_exact_text "SIGN IN"
  wait_for_post_login_surface

  log "Opening Assistant tab and validating via bottom nav"
  if tap_bottom_nav_tab "assistant"; then
    wait_for_assistant_surface
  else
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=assistant" -n "$APP_COMPONENT" >/dev/null || true
    wait_for_assistant_surface
  fi
  capture_screen "$SCREENSHOT_DIR/assistant-open.png"
  snapshot_phone_state "assistant-open"

  local assistant_api_log_line_before
  assistant_api_log_line_before="$(wc -l < "$API_LOG")"

  if tap_if_present "$ASSISTANT_COMMAND_TEXT"; then
    clear_focused_text_field
  else
    tap_nth_edit_text 0 || fail "Assistant input field not detected; cannot validate assistant command flow."
    clear_focused_text_field
  fi

  adb_cmd shell input text "${ASSISTANT_COMMAND// /%s}" >/dev/null
  adb_cmd shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
  sleep 3
  local assistant_send_rc=0
  if tap_send_after_first_edit_text "$ASSISTANT_COMMAND" "$assistant_api_log_line_before" 300; then
    assistant_send_rc=0
  else
    assistant_send_rc=$?
    if [[ "$assistant_send_rc" -eq 2 ]]; then
      adb_cmd shell input keyevent KEYCODE_ENTER >/dev/null || true
      sleep 1
    else
      fail "Assistant command still present after send tap; see $SCREENSHOT_DIR/assistant-send-verify-fail.png"
    fi
  fi
  sleep 2
  capture_screen "$SCREENSHOT_DIR/assistant-command.png"
  snapshot_phone_state "assistant-command"
  assert_assistant_turn_recorded "$assistant_api_log_line_before"

  ensure_review_surface
  capture_screen "$SCREENSHOT_DIR/review-entry.png"
  if ! ui_has_text "Study loop" && ! ui_has_exact_text "Load due cards" && ! ui_has_exact_text "Reveal answer" && ! ui_has_exact_text "Hide answer"; then
    scroll_until_any_ui_text "Study loop" "Load due cards" "Reveal answer" "Hide answer"
  fi
  if ui_has_exact_text "Load due cards"; then
    tap_exact_text "Load due cards"
    sleep 1
  fi
  capture_screen "$SCREENSHOT_DIR/review-loaded.png"
  validate_native_study_controls
  ensure_review_surface
  capture_screen "$SCREENSHOT_DIR/review-after-native-study-controls.png"
  snapshot_phone_state "review-after-native-study-controls"

  scroll_until_any_ui_text_in_review "reveal" "Reveal answer" "Hide answer"
  if ui_has_exact_text "Reveal answer"; then
    tap_exact_text "Reveal answer"
  fi
  sleep 2
  capture_screen "$SCREENSHOT_DIR/review-answer.png"
  snapshot_phone_state "review-answer"

  local review_api_log_line_before
  review_api_log_line_before="$(wc -l < "$API_LOG")"
  local review_due_count_before=""
  if review_due_count_before="$(query_due_count "$BUILD_DIR/review-due-before.json" || true)"; then
    log "Review due count before Good: $review_due_count_before"
  else
    review_due_count_before=""
  fi

  ensure_review_surface
  scroll_until_any_ui_text_in_review "grade" "Good"
  tap_exact_text "Good"
  sleep 2
  capture_screen "$SCREENSHOT_DIR/review-rated.png"
  snapshot_phone_state "review-rated"
  assert_review_grade_recorded "$review_api_log_line_before" "$review_due_count_before"
  assert_assistant_review_grade_dynamic_ui

  log "Opening Planner tab and toggling alarm schedule control"
  if tap_bottom_nav_tab "planner"; then
    wait_for_planner_surface
  else
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "starlog://surface?tab=planner" -n "$APP_COMPONENT" >/dev/null || true
    wait_for_planner_surface
  fi
  capture_screen "$SCREENSHOT_DIR/planner-open.png"
  snapshot_phone_state "planner-open"
  if ! ensure_planner_alarm_control_visible; then
    snapshot_phone_state "planner-alarm-control-missing"
    fail "Could not reveal planner alarm control; cannot validate alarm scheduling path"
  fi

  local planner_alarm_state
  planner_alarm_state="$(ui_planner_alarm_state)"
  if [[ "$planner_alarm_state" != "scheduled" ]]; then
    log "Planner alarm is not scheduled; generating briefing cache before scheduling"
    local briefing_marker_before
    briefing_marker_before="$(latest_briefing_package_marker || true)"
    if ! tap_planner_alarm_cache_control; then
      snapshot_phone_state "planner-alarm-cache-control-missing"
      fail "Could not locate planner cache control; cannot validate planner alarm scheduling path"
    fi
    capture_screen "$SCREENSHOT_DIR/planner-alarm-cache-triggered.png"
    snapshot_phone_state "planner-alarm-cache-triggered"
    wait_for_planner_alarm_cache_ready
    capture_screen "$SCREENSHOT_DIR/planner-alarm-cache-ready.png"
    snapshot_phone_state "planner-alarm-cache-ready"
    assert_latest_briefing_has_recommendation_hints "$briefing_marker_before"
    planner_alarm_state="$(ui_planner_alarm_state)"
  fi

  if [[ "$planner_alarm_state" != "scheduled" ]]; then
      if ! tap_planner_alarm_control_with_verification 1; then
        snapshot_phone_state "planner-alarm-control-missing"
        fail "Could not locate planner alarm control near alarm card; cannot validate alarm scheduling path"
      fi
    sleep 2
    planner_alarm_state="$(ui_planner_alarm_state)"
    if [[ "$planner_alarm_state" == "cache_missing" || "$planner_alarm_state" == "blocked" ]]; then
      log "Planner alarm scheduling blocked by missing cache; generating briefing cache and retrying"
      if ! tap_planner_alarm_cache_control; then
        snapshot_phone_state "planner-alarm-cache-control-missing"
        fail "Could not locate planner cache control; cannot validate planner alarm scheduling path"
      fi
      wait_for_planner_alarm_cache_ready
      if ! tap_planner_alarm_control_with_verification 2; then
        snapshot_phone_state "planner-alarm-control-missing"
        fail "Could not locate planner alarm control after cache generation; cannot validate alarm scheduling path"
      fi
    fi
    wait_for_planner_alarm_state "scheduled"
  fi
  sleep 1
  capture_screen "$SCREENSHOT_DIR/planner-alarm.png"
  snapshot_phone_state "planner-alarm"
}

write_metadata() {
  local metadata_stage="${1:-final}"
  local publish_latest=1
  if [[ "$metadata_stage" == "pre" ]]; then
    publish_latest=0
  fi

  METADATA_PATH_ENV="$METADATA_PATH" \
  STAMP_ENV="$STAMP" \
  VERSION_NAME_ENV="$STARLOG_VERSION_NAME" \
  VERSION_CODE_ENV="$STARLOG_ANDROID_VERSION_CODE" \
  STAGED_APK_ENV="$STAGED_APK" \
  WINDOWS_APK_PATH_ENV="$WINDOWS_APK_PATH" \
  API_BASE_ENV="$API_BASE" \
  RUNTIME_DIR_ENV="$RUNTIME_DIR" \
  PASSPHRASE_FILE_ENV="$PASSPHRASE_FILE" \
  INCLUDE_LOCAL_METADATA_ENV="${STARLOG_INCLUDE_LOCAL_METADATA:-0}" \
  SCREENSHOT_DIR_ENV="$SCREENSHOT_DIR" \
  METADATA_STAGE_ENV="$metadata_stage" \
  python3 - <<'PY'
from pathlib import Path
import json
import os

path = Path(os.environ["METADATA_PATH_ENV"])
screenshot_dir = os.environ["SCREENSHOT_DIR_ENV"]
metadata_stage = os.environ["METADATA_STAGE_ENV"]
include_local_metadata = os.environ["INCLUDE_LOCAL_METADATA_ENV"].lower() in {"1", "true", "yes"}

validated_flows = [
    "assistant_command_submitted",
    "native_study_topic_unlocked",
    "native_study_topic_marked_read",
    "native_study_question_request_created",
    "review_answer_revealed",
    "review_good_grade_submitted",
    "assistant_review_grade_dynamic_ui_verified",
    "planner_briefing_cache_generated",
    "planner_briefing_recommendation_hints_validated",
    "planner_alarm_scheduled",
]

def existing_file_map(values):
    return {
        key: value
        for key, value in values.items()
        if Path(value).is_file()
    }

screenshot_candidates = {
    "login": f"{screenshot_dir}/login.png",
    "review_entry": f"{screenshot_dir}/review-entry.png",
    "review_loaded": f"{screenshot_dir}/review-loaded.png",
    "review_after_native_study_controls": f"{screenshot_dir}/review-after-native-study-controls.png",
    "review_answer": f"{screenshot_dir}/review-answer.png",
    "review_rated": f"{screenshot_dir}/review-rated.png",
    "native_study_before": f"{screenshot_dir}/native-study-before.png",
    "native_study_after": f"{screenshot_dir}/native-study-after.png",
    "assistant_open": f"{screenshot_dir}/assistant-open.png",
    "assistant_command": f"{screenshot_dir}/assistant-command.png",
    "assistant_review_grade_dynamic_ui": f"{screenshot_dir}/assistant-review-grade-dynamic-ui.png",
    "planner_open": f"{screenshot_dir}/planner-open.png",
    "planner_alarm_cache_triggered": f"{screenshot_dir}/planner-alarm-cache-triggered.png",
    "planner_alarm_cache_ready": f"{screenshot_dir}/planner-alarm-cache-ready.png",
    "planner_alarm": f"{screenshot_dir}/planner-alarm.png",
}

evidence_candidates = {
    "api_log": f"{path.parent}/local-api.log",
    "native_study_before_xml": f"{path.parent}/native-study-before.xml",
    "native_study_after_xml": f"{path.parent}/native-study-after.xml",
    "review_after_native_study_controls_xml": f"{path.parent}/review-after-native-study-controls.xml",
    "review_answer_xml": f"{path.parent}/review-answer.xml",
    "review_rated_xml": f"{path.parent}/review-rated.xml",
    "assistant_review_grade_dynamic_ui_xml": f"{path.parent}/assistant-review-grade-dynamic-ui.xml",
    "planner_alarm_xml": f"{path.parent}/planner-alarm.xml",
    "latest_briefing_json": f"{path.parent}/briefing-latest.json",
}

payload = {
    "stamp": os.environ["STAMP_ENV"],
    "version_name": os.environ["VERSION_NAME_ENV"],
    "version_code": os.environ["VERSION_CODE_ENV"],
    "apk_name": Path(os.environ["STAGED_APK_ENV"]).name,
    "api_base_kind": "local" if os.environ["API_BASE_ENV"].startswith("http://127.0.0.1:") else "configured",
    "screenshots": existing_file_map(screenshot_candidates),
    "evidence_files": existing_file_map(evidence_candidates),
    "validated_flows": validated_flows if metadata_stage == "final" else [],
    "validation_stage": metadata_stage,
    "validation_passed": metadata_stage == "final",
}
if include_local_metadata:
    payload["local_paths"] = {
        "apk_path": os.environ["STAGED_APK_ENV"],
        "windows_apk_path": os.environ["WINDOWS_APK_PATH_ENV"],
        "api_base": os.environ["API_BASE_ENV"],
        "runtime_dir": os.environ["RUNTIME_DIR_ENV"],
        "passphrase_file": os.environ["PASSPHRASE_FILE_ENV"],
    }
path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

  if [[ "$publish_latest" -eq 1 ]]; then
    cp "$METADATA_PATH" "$LATEST_METADATA_PATH"
  fi
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ensure_requirements
create_passphrase
prepare_dirs
resolve_target_architectures
preflight_phone_state
start_local_api
bootstrap_local_station
import_local_srs_deck
import_local_neetcode_study_core
seed_native_interview_loop_review_queue
verify_local_review_queue
if [[ "$SKIP_BUILD" == "1" ]]; then
  stage_existing_apk
else
  build_apk
fi
verify_built_apk
write_metadata pre
remove_phone_builds
ensure_phone_ready
install_apk
launch_and_validate_review
write_metadata final

log "Fresh local SRS validation completed"
log "Build metadata: $METADATA_PATH"
log "Passphrase file: $PASSPHRASE_FILE"
