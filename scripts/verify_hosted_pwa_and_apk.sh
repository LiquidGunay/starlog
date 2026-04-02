#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${1:-$(date -u +"%Y%m%dT%H%M%SZ")}"

ARTIFACT_DIR="${STARLOG_VERIFY_ARTIFACT_DIR:-$ROOT_DIR/artifacts/verify-hosted-pwa-and-apk/$STAMP}"
LOG_PATH="$ARTIFACT_DIR/verify.log"
PWA_DIR="$ARTIFACT_DIR/hosted-pwa"
APK_DIR="$ARTIFACT_DIR/android-apk"

RUN_PWA="${STARLOG_VERIFY_RUN_PWA:-1}"
RUN_APK="${STARLOG_VERIFY_RUN_APK:-1}"
DRY_RUN="${STARLOG_VERIFY_DRY_RUN:-0}"
APK_MODE="${STARLOG_VERIFY_APK_MODE:-precheck}" # precheck | smoke
RUN_BROWSER_PROBE="${STARLOG_VERIFY_BROWSER_PROBE:-1}"

WEB_ORIGIN="${STARLOG_HOSTED_WEB_ORIGIN:-}"
API_BASE="${STARLOG_HOSTED_API_BASE:-}"
VERIFY_TOKEN="${STARLOG_VERIFY_TOKEN:-}"

APK_PATH="${APK_PATH:-${STARLOG_APK_PATH:-}}"
ADB="${ADB:-}"
ADB_SERIAL="${ADB_SERIAL:-}"
APP_VARIANT="${APP_VARIANT:-production}"
REVERSE_PORTS="${REVERSE_PORTS:-}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [timestamp]

Validates (1) a hosted PWA deployment and (2) an Android APK smoke/precheck in one place.

Hosted PWA (curl probes):
  - checks availability for: /assistant, /review, /decks (regression guard)
  - also probes: /runtime, /notes, /tasks, /calendar, /artifacts, /sync-center
  - optional API health probe: \$STARLOG_HOSTED_API_BASE/v1/health
  - optional browser probe verifies the hosted client writes the expected API base to localStorage
    and, when STARLOG_VERIFY_TOKEN is provided, confirms the deck browser loads with deck data

Android APK:
  - mode "precheck": validates required inputs and prints resolved config
  - mode "smoke": runs ./scripts/android_native_smoke.sh (requires connected device/emulator)

Environment variables:
  STARLOG_VERIFY_RUN_PWA        1 to run hosted PWA checks (default: 1)
  STARLOG_VERIFY_RUN_APK        1 to run Android APK checks (default: 1)
  STARLOG_VERIFY_APK_MODE       precheck | smoke (default: precheck)
  STARLOG_VERIFY_DRY_RUN        1 to print commands without running them (default: 0)
  STARLOG_VERIFY_BROWSER_PROBE  1 to run the Playwright-backed browser probe (default: 1)
  STARLOG_VERIFY_ARTIFACT_DIR   output dir override (default: artifacts/verify-hosted-pwa-and-apk/<stamp>/)

  STARLOG_HOSTED_WEB_ORIGIN     required when running PWA checks (example: https://starlog-web-production.up.railway.app)
  STARLOG_HOSTED_API_BASE       optional for API health probe (example: https://starlog-api-production.up.railway.app)
  STARLOG_VERIFY_TOKEN          optional bearer token for authenticated deck-browser verification

  STARLOG_APK_PATH or APK_PATH  required when running APK checks (path to an .apk)
  ADB                           optional; passed through to android_native_smoke.sh
  ADB_SERIAL                    optional; passed through to android_native_smoke.sh
  APP_VARIANT                   optional (default: development)
  REVERSE_PORTS                 optional, comma-separated ports to adb reverse (example: 8000,8081)

Artifacts:
  - log: $LOG_PATH
  - hosted PWA: $PWA_DIR/
  - android APK: $APK_DIR/
EOF
}

log() {
  printf '[verify-hosted] %s\n' "$1"
}

die() {
  printf '[verify-hosted] ERROR: %s\n' "$1" >&2
  exit 1
}

require_nonempty() {
  local value="$1"
  local label="$2"
  if [[ -z "$value" ]]; then
    die "$label is required"
  fi
}

require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "$path" ]]; then
    die "$label not found: $path"
  fi
}

curl_probe() {
  local name="$1"
  local url="$2"
  local out_dir="$3"

  mkdir -p "$out_dir"
  local headers_path="$out_dir/${name}.headers.txt"
  local body_path="$out_dir/${name}.body.html"

  log "PWA probe: $url"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] curl -fsSL -D %q -o %q %q\n' "$headers_path" "$body_path" "$url"
    return 0
  fi

  # Follow redirects (Railway -> HTTPS or canonical host) and keep a body sample for debugging.
  curl -fsSL -D "$headers_path" -o "$body_path" "$url"

  if ! grep -Eq 'id="__next"|__NEXT_DATA__|/_next/static/|<title>Starlog</title>' "$body_path"; then
    die "unexpected HTML for $url (missing expected app markers); see $body_path"
  fi
}

run_hosted_pwa_checks() {
  if [[ "$RUN_PWA" != "1" ]]; then
    log "Hosted PWA checks: skipped (STARLOG_VERIFY_RUN_PWA=$RUN_PWA)"
    return 0
  fi

  require_nonempty "$WEB_ORIGIN" "STARLOG_HOSTED_WEB_ORIGIN"
  mkdir -p "$PWA_DIR"

  local origin="${WEB_ORIGIN%/}"

  # Regression guard: these routes have recently regressed in deploys.
  curl_probe "assistant" "$origin/assistant" "$PWA_DIR"
  curl_probe "review" "$origin/review" "$PWA_DIR"
  curl_probe "review-decks" "$origin/review/decks" "$PWA_DIR"

  # Core surfaces.
  curl_probe "runtime" "$origin/runtime" "$PWA_DIR"
  curl_probe "notes" "$origin/notes" "$PWA_DIR"
  curl_probe "tasks" "$origin/tasks" "$PWA_DIR"
  curl_probe "calendar" "$origin/calendar" "$PWA_DIR"
  curl_probe "artifacts" "$origin/artifacts" "$PWA_DIR"
  curl_probe "sync-center" "$origin/sync-center" "$PWA_DIR"

  if [[ -n "$API_BASE" ]]; then
    log "API health probe: $API_BASE/v1/health"
    if [[ "$DRY_RUN" == "1" ]]; then
      printf '[dry-run] curl -fsSL %q\n' "$API_BASE/v1/health"
    else
      curl -fsSL "$API_BASE/v1/health" | tee "$PWA_DIR/api-health.json" >/dev/null
      if ! grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "$PWA_DIR/api-health.json"; then
        die "API health probe did not include status=ok; see $PWA_DIR/api-health.json"
      fi
    fi
  else
    log "API health probe: skipped (STARLOG_HOSTED_API_BASE unset)"
  fi

  run_hosted_browser_probe "$origin"
}

run_hosted_browser_probe() {
  local origin="$1"

  if [[ "$RUN_BROWSER_PROBE" != "1" ]]; then
    log "Hosted browser probe: skipped (STARLOG_VERIFY_BROWSER_PROBE=$RUN_BROWSER_PROBE)"
    return 0
  fi

  local probe_json="$PWA_DIR/browser-probe.json"
  local screenshot_path="$PWA_DIR/browser-probe-review-decks.png"

  log "Hosted browser probe: $origin"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] node Playwright probe -> %q and %q\n' "$probe_json" "$screenshot_path"
    return 0
  fi

  WEB_ORIGIN="$origin" \
  API_BASE="$API_BASE" \
  VERIFY_TOKEN="$VERIFY_TOKEN" \
  PROBE_JSON="$probe_json" \
  PROBE_SCREENSHOT="$screenshot_path" \
  node <<'EOF'
const fs = require("fs");
const { chromium } = require("@playwright/test");

async function main() {
  const origin = process.env.WEB_ORIGIN;
  const expectedApiBase = process.env.API_BASE || "";
  const token = process.env.VERIFY_TOKEN || "";
  const outPath = process.env.PROBE_JSON;
  const screenshotPath = process.env.PROBE_SCREENSHOT;
  if (!origin || !outPath || !screenshotPath) {
    throw new Error("Browser probe missing required env");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(({ token }) => {
    window.localStorage.removeItem("starlog-api-base");
    if (token) {
      window.localStorage.setItem("starlog-token", token);
    } else {
      window.localStorage.removeItem("starlog-token");
    }
  }, { token });

  const reviewPage = await context.newPage();
  await reviewPage.goto(`${origin}/review`, { waitUntil: "domcontentloaded" });
  await reviewPage.waitForTimeout(1500);
  const storedApiBase = await reviewPage.evaluate(() => window.localStorage.getItem("starlog-api-base") || "");
  const reviewText = await reviewPage.textContent("body");

  const decksPage = await context.newPage();
  await decksPage.goto(`${origin}/review/decks`, { waitUntil: "domcontentloaded" });
  await decksPage.waitForTimeout(2500);
  await decksPage.screenshot({ path: screenshotPath, fullPage: true });
  const decksText = await decksPage.textContent("body");

  const result = {
    storedApiBase,
    expectedApiBase,
    tokenProvided: Boolean(token),
    reviewContainsNeuralSync: Boolean(reviewText && reviewText.includes("Neural Sync")),
    reviewContainsMissingToken: Boolean(reviewText && reviewText.includes("Bearer token missing")),
    decksContainsBrowser: Boolean(decksText && decksText.includes("Deck Browser")),
    decksContainsInbox: Boolean(decksText && decksText.includes("Inbox")),
    decksContainsConnectPrompt: Boolean(decksText && decksText.includes("Connect to the API")),
  };
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  const failures = [];
  if (expectedApiBase && storedApiBase !== expectedApiBase) {
    failures.push(`expected hosted api base ${expectedApiBase} but browser stored ${storedApiBase || "<empty>"}`);
  }
  if (!result.decksContainsBrowser) {
    failures.push("review/decks did not render the Deck Browser shell");
  }
  if (token && !result.decksContainsInbox) {
    failures.push("authenticated browser probe did not show deck data");
  }

  await browser.close();

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
EOF
}

run_android_apk_checks() {
  if [[ "$RUN_APK" != "1" ]]; then
    log "Android APK checks: skipped (STARLOG_VERIFY_RUN_APK=$RUN_APK)"
    return 0
  fi

  require_nonempty "${APK_PATH:-}" "STARLOG_APK_PATH or APK_PATH"
  require_file "$APK_PATH" "APK"
  mkdir -p "$APK_DIR"

  case "$APK_MODE" in
    precheck)
      log "Android APK checks: precheck (PRINT_CONFIG=1)"
      if [[ "$DRY_RUN" == "1" ]]; then
        printf '[dry-run] (cd %q && PRINT_CONFIG=1 APK_PATH=%q APP_VARIANT=%q ADB=%q ADB_SERIAL=%q REVERSE_PORTS=%q ./scripts/android_native_smoke.sh)\n' \
          "$ROOT_DIR" "$APK_PATH" "$APP_VARIANT" "${ADB:-}" "${ADB_SERIAL:-}" "${REVERSE_PORTS:-}"
        return 0
      fi

      (
        cd "$ROOT_DIR"
        PRINT_CONFIG=1 \
        APK_PATH="$APK_PATH" \
        APP_VARIANT="$APP_VARIANT" \
        ADB="${ADB:-}" \
        ADB_SERIAL="${ADB_SERIAL:-}" \
        REVERSE_PORTS="${REVERSE_PORTS:-}" \
        ./scripts/android_native_smoke.sh
      ) | tee "$APK_DIR/precheck.txt"
      ;;
    smoke)
      log "Android APK checks: smoke"
      if [[ "$DRY_RUN" == "1" ]]; then
        printf '[dry-run] (cd %q && APK_PATH=%q APP_VARIANT=%q ADB=%q ADB_SERIAL=%q REVERSE_PORTS=%q ./scripts/android_native_smoke.sh | tee %q)\n' \
          "$ROOT_DIR" "$APK_PATH" "$APP_VARIANT" "${ADB:-}" "${ADB_SERIAL:-}" "${REVERSE_PORTS:-}" "$APK_DIR/smoke.txt"
        return 0
      fi

      (
        cd "$ROOT_DIR"
        APK_PATH="$APK_PATH" \
        APP_VARIANT="$APP_VARIANT" \
        ADB="${ADB:-}" \
        ADB_SERIAL="${ADB_SERIAL:-}" \
        REVERSE_PORTS="${REVERSE_PORTS:-}" \
        ./scripts/android_native_smoke.sh
      ) | tee "$APK_DIR/smoke.txt"
      ;;
    *)
      die "Unsupported STARLOG_VERIFY_APK_MODE: $APK_MODE (expected precheck|smoke)"
      ;;
  esac
}

main() {
  if [[ "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  mkdir -p "$ARTIFACT_DIR"
  touch "$LOG_PATH"
  exec > >(tee -a "$LOG_PATH") 2>&1

  log "started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  log "repo root: $ROOT_DIR"
  log "stamp: $STAMP"
  log "artifacts: $ARTIFACT_DIR"

  run_hosted_pwa_checks
  run_android_apk_checks

  log "PASS"
  log "hosted PWA artifacts: $PWA_DIR"
  log "android APK artifacts: $APK_DIR"
}

main "$@"
