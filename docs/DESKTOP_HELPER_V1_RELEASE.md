# Desktop Helper v1 Distribution Runbook

Last updated: 2026-03-22

## Workitem coverage

| Workitem | Scope in this pass |
| --- | --- |
| WI-321 | Installer artifact pipeline + normalized artifact naming + host build commands |
| WI-322 | Signing/notarization readiness checks and env-variable runbook |
| WI-323 | Runtime dependency diagnostics hardening via explicit probe script + troubleshooting alignment |
| WI-324 | Desktop QA matrix updates with command evidence and screenshot capture artifacts |
| WI-325 | v1 RC package structure (checksums, manifest, build metadata, install/rollback notes) |
| WI-423 | Main-laptop setup pack, reset flow, install/runbook handoff, and configured daily-use smoke path |
| WI-580 | Local-PC release-candidate rerun with localhost bridge auth/discovery, local voice smoke, real helper upload, and refreshed operator docs |

## Distribution architecture

- Desktop helper distribution is host-native:
  - Linux host builds Linux installers.
  - macOS host builds/notarizes macOS artifacts.
  - Windows host builds/signs Windows artifacts.
- Helper capture flow talks directly to the Starlog API (`/v1/capture`); a deployed PWA is not required to validate helper upload wiring.
- The release scripts are intentionally under `tools/desktop-helper/scripts/` so build/release work is isolated from app/web/mobile workflows.

## Artifact pipeline (WI-321)

### Commands by host

- Linux (Debian/AppImage + binary fallback):
  - `cd tools/desktop-helper && ./scripts/build_release_artifacts.sh`
  - Optional AppImage attempt: `STARLOG_DESKTOP_BUNDLES=deb,appimage ./scripts/build_release_artifacts.sh`
  - Note: AppImage can still stall inside `linuxdeploy` on this host; `.deb` is the deterministic Linux RC path.
- macOS (DMG + `.app` bundle fallback):
  - `cd tools/desktop-helper && STARLOG_DESKTOP_BUNDLES=dmg ./scripts/build_release_artifacts.sh`
- Windows (MSI/NSIS + `.exe` fallback):
  - `cd tools/desktop-helper && STARLOG_DESKTOP_BUNDLES=msi,nsis ./scripts/build_release_artifacts.sh`

### Artifact output contract

- Output root: `artifacts/desktop-helper/v<version>/<arch-os>/`
- Produced metadata:
  - `checksums.sha256`
  - `manifest.tsv`
  - `build-info.txt`
- Naming convention:
  - `starlog-desktop-helper-v<version>-<arch-os>-<normalized-source-file>`

### Latest run evidence (2026-03-22, this host)

- Command:
  - `cd tools/desktop-helper && ./scripts/build_release_artifacts.sh`
- Output folder:
  - `artifacts/desktop-helper/v0.1.0/x86_64-linux/`
- Produced files:
  - `starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
  - `starlog-desktop-helper-v0.1.0-x86_64-linux-starlog_desktop_helper`
  - `checksums.sha256`
  - `manifest.tsv`
  - `build-info.txt`
- Checksums from this run:
  - `.deb`: `2c022ceb315cb214f5da09a81db4a933c02b4720d75a1aa8764546792171cead`
  - raw binary: `bcb87e6989c1ee940b602448bf64fa5dfb5c7b6c46ce5d69ee97ddb8b3318efc`

## Signing/notarization readiness (WI-322)

### Command

- `cd tools/desktop-helper && ./scripts/signing_readiness_check.sh <linux|windows|macos|all>`

### Required env variables

- macOS signing + notarization:
  - `APPLE_CERTIFICATE`
  - `APPLE_CERTIFICATE_PASSWORD`
  - `APPLE_API_KEY`
  - `APPLE_API_ISSUER`
  - `APPLE_API_KEY_PATH`
  - `APPLE_TEAM_ID`
- Windows signing:
  - `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` (or `WINDOWS_CERTIFICATE_SHA1`)
  - `signtool` available on `PATH`
- Linux package signing (recommended for public distribution):
  - `gpg`, `dpkg-sig`, `rpmsign` tooling where applicable

### Secret handling

- Do not commit signing/notarization credentials to repo files.
- Inject secrets via CI/secure shell environment only.
- Keep separate credentials for CI automation vs personal local release validation.

### Latest run evidence (2026-03-22, this host)

- Command:
  - `cd tools/desktop-helper && ./scripts/signing_readiness_check.sh linux`
- Result:
  - `gpg` available.
  - `dpkg-sig` and `rpmsign` missing (warning-level on Linux).

## Runtime dependency + diagnostics hardening (WI-323)

### Command

- `cd tools/desktop-helper && ./scripts/runtime_dependency_probe.sh <linux|windows|macos> [output-json-path]`

### Probe coverage

- Clipboard backend readiness
- Screenshot backend readiness
- Active-window metadata backend readiness
- Local OCR (`tesseract`) readiness

### Why this matters

- The helper already surfaces runtime diagnostics in-app; this probe script gives an operator-visible preflight outside the GUI for release/support workflows.

### Latest run evidence (2026-03-22, this host)

- Command:
  - `cd tools/desktop-helper && ./scripts/runtime_dependency_probe.sh linux ../../artifacts/desktop-helper/v0.1.0/x86_64-linux/runtime-dependency-probe.json`
- Output:
  - `artifacts/desktop-helper/v0.1.0/x86_64-linux/runtime-dependency-probe.json`
- Probe summary:
  - `clipboard`: missing local Linux helper tooling
  - `screenshot`: missing local Linux screenshot tooling
  - `active_window`: degraded (metadata helpers missing)
  - `ocr`: degraded (`tesseract` missing)

## QA matrix + evidence (WI-324)

### Automated checks

- Browser-style helper tests:
  - `./node_modules/.bin/playwright test`
- Rust backend checks:
  - `cd tools/desktop-helper/src-tauri && cargo check`
- Native release build:
  - `cd tools/desktop-helper && ./node_modules/.bin/tauri build`
- Localhost RC smoke:
  - `STARLOG_DESKTOP_HELPER_RC_API_BASE=http://127.0.0.1:8010 STARLOG_DESKTOP_HELPER_RC_BEARER_TOKEN=<token> STARLOG_DESKTOP_HELPER_RC_BRIDGE_TOKEN=<bridge-token> node tools/desktop-helper/scripts/capture_rc_smoke.mjs artifacts/desktop-helper/rc-evidence/<timestamp>`
- QA screenshot capture:
  - `cd tools/desktop-helper && node ./scripts/capture_qa_screenshots.mjs`

### Matrix status

| Surface | Linux (this host) | Windows | macOS |
| --- | --- | --- | --- |
| Clipboard capture | Pass for browser-fallback upload into a real local API; native Linux path still blocked by missing host clipboard binaries | Previously validated on host probes (2026-03-10) | Pending real-host rerun |
| Screenshot capture | Native Linux runtime still blocked by missing screenshot binaries; helper reports the missing-backend state cleanly | Previously validated on host probes (2026-03-10) | Pending real-host rerun |
| Active-window metadata | Pass/degraded-with-guidance paths covered; RC smoke kept browser-context fallback visible | Previously validated on host probes (2026-03-10) | Pending real-host rerun |
| OCR dependency behavior | Pass for dependency detection; `tesseract` remains optional-degraded on this host | Pending rerun on current RC | Pending real-host rerun |
| Shortcut behavior | Pass for browser fallback + plugin wiring checks | Manual-only runtime check still required | Manual-only runtime check still required |
| Local bridge discovery/auth | Pass against a real authenticated bridge on `127.0.0.1:8091` | Pending real-host rerun | Pending real-host rerun |
| Local voice server path | Pass with mock STT + local TTS wrapper on `127.0.0.1:8171/8093` | Pending real-host rerun | Pending real-host rerun |

### Latest run evidence (2026-03-22, this host)

- Automated command results:
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts --grep 'configured local bridge with bridge auth|discover a reachable localhost bridge|window shortcut clips clipboard text'` -> `3 passed`
  - `cd tools/desktop-helper && ./scripts/build_release_artifacts.sh` -> passed
  - `PYTHONPATH=services/ai-runtime uv run --project services/ai-runtime python scripts/local_voice_runtime_smoke.py` -> passed against the authenticated bridge
- Screenshots and smoke summary:
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/desktop-helper-rc-config.png`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/desktop-helper-rc-diagnostics.png`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/desktop-helper-rc-quick-popup.png`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/rc-smoke.json`
  - `artifacts/desktop-helper/rc-evidence/2026-03-22T14-06-24Z/local-voice-smoke.json`
- Real capture confirmation:
  - helper upload artifact id `art_b40fadfafc55444897413ec4bdc59593`
  - `GET /v1/artifacts?limit=5` on the local API returned the stored helper capture with browser-clipboard metadata

## RC package + handoff (WI-325)

### RC structure

- RC candidate is the artifact folder under:
  - `artifacts/desktop-helper/v<version>/<arch-os>/`
- Required files for handoff:
  - staged installers/binaries,
  - `checksums.sha256`,
  - `manifest.tsv`,
  - `build-info.txt`,
  - this runbook + helper README commands.

### Current RC candidate (2026-03-22)

- Candidate id:
  - `v0.1.0-x86_64-linux-rc4`
- Artifact folder:
  - `artifacts/desktop-helper/v0.1.0/x86_64-linux/`
- Checksums:
  - `.deb`: `2c022ceb315cb214f5da09a81db4a933c02b4720d75a1aa8764546792171cead`
  - binary: `bcb87e6989c1ee940b602448bf64fa5dfb5c7b6c46ce5d69ee97ddb8b3318efc`
- Exact staged artifacts:
  - `artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
  - `artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog_desktop_helper`

### Host install smoke (non-destructive, this host)

- Package metadata inspection:
  - `dpkg-deb -I artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
- Dry-run install:
  - `dpkg --dry-run -i artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
- Payload extraction check:
  - `dpkg-deb -x ... <tmpdir>`
- Binary linkage check:
  - `ldd artifacts/desktop-helper/v0.1.0/x86_64-linux/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog_desktop_helper`

- Smoke results:
  - Debian package metadata is correct: package `starlog-desktop-helper`, version `0.1.0`, architecture `amd64`.
  - Declared package dependencies match the runtime: `libwebkit2gtk-4.1-0`, `libgtk-3-0`.
  - Extracted payload contains `/usr/bin/starlog_desktop_helper` and `/usr/share/applications/Starlog Desktop Helper.desktop`.
  - Raw staged binary links successfully against the expected GTK/WebKit libraries on this host.
  - Helper browser-fallback smoke uploaded a real clipboard capture into a local API while discovering and authenticating against the local bridge.
  - Native Linux screenshot/OCR smoke is still blocked on missing host packages (`wl-paste`/`xclip`, screenshot tooling, `tesseract`) rather than packaging or helper upload code.

### Release notes template

1. RC identifier (`v<version>-<arch-os>-rcN`)
2. Source commit + PR link
3. Included artifacts + checksums reference
4. Signed/notarized status by OS
5. Known blockers and operator workarounds

### Rollback notes

- Keep prior RC artifact folder intact under `artifacts/desktop-helper/`.
- If a new RC regresses runtime behavior, redistribute previous checksum-verified artifact set and keep API compatibility unchanged (helper uploads via stable `/v1/capture`).

## Main-laptop setup pack (WI-423)

- Daily-use setup handoff for the Linux laptop is tracked in:
  - `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md`
- Production API base verified for this pass:
  - `https://starlog-api-production.up.railway.app`
- The helper workspace now includes:
  - `Copy Setup Checklist` for a redacted setup summary,
  - `Reset Local State` for upgrade/uninstall/device-handoff cleanup.
