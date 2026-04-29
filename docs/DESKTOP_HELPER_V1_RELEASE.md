# Desktop Helper v1 Distribution Runbook

Last updated: 2026-04-08

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
| WI-591 | Current-master desktop helper proof on the target laptop with one exact remaining host blocker |

## Distribution architecture

- Desktop helper distribution is host-native:
  - Linux host builds Linux installers.
  - macOS host builds/notarizes macOS artifacts.
  - Windows host builds/signs Windows artifacts.
- Helper capture flow talks directly to the Starlog API (`/v1/capture`); a deployed desktop web app is not required to validate helper upload wiring.
- The release scripts are intentionally under `tools/desktop-helper/scripts/` so build/release work is isolated from app/web/mobile workflows.
- The helper is a capture-first companion. Release validation should prioritize capture speed, recent-item UX, and Assistant/Library handoff ahead of diagnostics polish.

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

### Evidence

Old committed RC packages were removed from the repo. Generate fresh packages with
`tools/desktop-helper/scripts/build_release_artifacts.sh` and keep release-specific artifacts outside
the long-lived source tree unless they are needed for an active handoff.

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
- `cd tools/desktop-helper && ./scripts/bootstrap_linux_runtime_deps.sh [--output-json <path>]`

### Probe coverage

- Clipboard backend readiness
- Screenshot backend readiness
- Active-window metadata backend readiness
- Local OCR (`tesseract`) readiness

### Why this matters

- The helper already surfaces runtime diagnostics in-app; this probe script gives an operator-visible preflight outside the GUI for release/support workflows.
- Diagnostics are still secondary to the main capture workflow, so probe output should explain blockers without obscuring the primary capture path.

### Host probe note

- Command:
  - `cd tools/desktop-helper && ./scripts/runtime_dependency_probe.sh linux <output-json-path>`
  - `cd tools/desktop-helper && ./scripts/bootstrap_linux_runtime_deps.sh --output-json <output-json-path>`
- Probe summary:
  - `clipboard`: missing local Linux helper tooling
  - `screenshot`: missing local Linux screenshot tooling
  - `active_window`: degraded (metadata helpers missing)
  - `ocr`: degraded (`tesseract` missing)
  - bootstrap status: exact Ubuntu install command captured; package installation still requires interactive `sudo` on this host

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
| Recent capture actions | Pending rerun on the current Assistant/Library handoff build | Pending real-host rerun | Pending real-host rerun |
| Shortcut behavior | Pass for browser fallback + plugin wiring checks | Manual-only runtime check still required | Manual-only runtime check still required |
| Local bridge discovery/auth | Pass against a real authenticated bridge on `127.0.0.1:8091` | Pending real-host rerun | Pending real-host rerun |
| Local voice server path | Pass for real rootless STT on `127.0.0.1:8171`; TTS remains optional/unconfigured on this host | Pending real-host rerun | Pending real-host rerun |

### Evidence

Old committed RC screenshots and smoke summaries were removed from the repo. For a current release
candidate, regenerate QA evidence with:

- `node tools/desktop-helper/scripts/capture_rc_smoke.mjs artifacts/desktop-helper/rc-evidence/<timestamp>`
- `cd tools/desktop-helper && node ./scripts/capture_qa_screenshots.mjs`
- `./scripts/cross_surface_proof_bundle.sh`

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

### Current RC candidate

Generate a fresh RC candidate from the current branch. The build command writes the candidate under
`artifacts/desktop-helper/v<version>/<arch-os>/` with `checksums.sha256`, `manifest.tsv`, and
`build-info.txt`.

### Host install smoke (non-destructive, this host)

- Package metadata inspection:
  - `dpkg-deb -I artifacts/desktop-helper/v<version>/<arch-os>/<package>.deb`
- Dry-run install:
  - `dpkg --dry-run -i artifacts/desktop-helper/v<version>/<arch-os>/<package>.deb`
- Payload extraction check:
  - `dpkg-deb -x ... <tmpdir>`
- Binary linkage check:
  - `ldd artifacts/desktop-helper/v<version>/<arch-os>/<binary>`

- Smoke results:
  - Debian package metadata is correct: package `starlog-desktop-helper`, version `0.1.0`, architecture `amd64`.
  - Declared package dependencies match the runtime: `libwebkit2gtk-4.1-0`, `libgtk-3-0`.
  - Extracted payload contains `/usr/bin/starlog_desktop_helper` and `/usr/share/applications/Starlog Desktop Helper.desktop`.
  - Raw staged binary links successfully against the expected GTK/WebKit libraries on this host.
  - Helper browser-fallback smoke uploaded a real clipboard capture into a local API while discovering and authenticating against the local bridge.
  - Native Linux screenshot/OCR smoke is still blocked on missing host packages (`wl-paste`/`xclip`, screenshot tooling, `tesseract`), and the concrete remaining operator step is to run the generated `apt-get` command with interactive `sudo`.
  - The exact host-side blocker is now reduced to one issue with command evidence: `sudo -n true` still returns `sudo: a password is required` on this machine, so package installation cannot be completed from this shell alone.

### Release notes template

1. RC identifier (`v<version>-<arch-os>-rcN`)
2. Source commit + PR link
3. Included artifacts + checksums reference
4. Signed/notarized status by OS
5. Known blockers and operator workarounds

### Rollback notes

- Keep prior RC artifact folders intact outside source-control cleanup until the new RC is accepted.
- If a new RC regresses runtime behavior, redistribute previous checksum-verified artifact set and keep API compatibility unchanged (helper uploads via stable `/v1/capture`).

## Main-laptop setup pack (WI-423)

- Daily-use setup handoff for the Linux laptop is tracked in:
  - `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md`
- Production API base verified for this pass:
  - `https://starlog-api-production.up.railway.app`
- The helper workspace now includes:
  - `Copy Setup Checklist` for a redacted setup summary,
  - `Reset Local State` for upgrade/uninstall/device-handoff cleanup.
