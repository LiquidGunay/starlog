# Desktop Helper v1 Distribution Runbook

Last updated: 2026-03-15

## Workitem coverage

| Workitem | Scope in this pass |
| --- | --- |
| WI-321 | Installer artifact pipeline + normalized artifact naming + host build commands |
| WI-322 | Signing/notarization readiness checks and env-variable runbook |
| WI-323 | Runtime dependency diagnostics hardening via explicit probe script + troubleshooting alignment |
| WI-324 | Desktop QA matrix updates with command evidence and screenshot capture artifacts |
| WI-325 | v1 RC package structure (checksums, manifest, build metadata, install/rollback notes) |
| WI-423 | Main-laptop setup pack, reset flow, install/runbook handoff, and configured daily-use smoke path |

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

### Latest run evidence (2026-03-15, this host)

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
  - `.deb`: `71acab0501593cb42167b171aa68a95dfafdad4b7b42d542db89c4a117f49892`
  - raw binary: `ebbe89fb7de09b4be6beaec3f8945efed48e519937c46f0888cacc5474885584`

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

### Latest run evidence (2026-03-15, this host)

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

### Latest run evidence (2026-03-15, this host)

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
- QA screenshot capture:
  - `cd tools/desktop-helper && node ./scripts/capture_qa_screenshots.mjs`

### Matrix status

| Surface | Linux (this host) | Windows | macOS |
| --- | --- | --- | --- |
| Clipboard capture | Pass in browser-fallback QA + pass in local API smoke upload | Previously validated on host probes (2026-03-10) | Pending real-host rerun |
| Screenshot capture | Browser fallback path pass; native Linux runtime depends on host screenshot binaries from runtime probe | Previously validated on host probes (2026-03-10) | Pending real-host rerun |
| Active-window metadata | Pass/degraded-with-guidance paths covered | Previously validated on host probes (2026-03-10) | Pending real-host rerun |
| OCR dependency behavior | Pass for dependency detection; `tesseract` remains optional-degraded | Pending rerun on current RC | Pending rerun on current RC |
| Shortcut behavior | Pass for browser fallback + plugin wiring checks | Manual-only runtime check still required | Manual-only runtime check still required |

### Latest run evidence (2026-03-15, this host)

- Automated command results:
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts` -> `13 passed`
  - `cd tools/desktop-helper && ./node_modules/.bin/tauri build --bundles deb` -> passed
- Screenshots:
  - `artifacts/desktop-helper/qa/2026-03-15T18-58-51-736Z/desktop-helper-workspace-config.png`
  - `artifacts/desktop-helper/qa/2026-03-15T18-58-51-736Z/desktop-helper-workspace-diagnostics.png`
  - `artifacts/desktop-helper/qa/2026-03-15T18-58-51-736Z/desktop-helper-quick-popup.png`
  - `artifacts/desktop-helper/qa/2026-03-15T18-58-51-736Z/screenshots.json`

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

### Current RC candidate (2026-03-15)

- Candidate id:
  - `v0.1.0-x86_64-linux-rc3`
- Artifact folder:
  - `artifacts/desktop-helper/v0.1.0/x86_64-linux/`
- Checksums:
  - `.deb`: `71acab0501593cb42167b171aa68a95dfafdad4b7b42d542db89c4a117f49892`
  - binary: `ebbe89fb7de09b4be6beaec3f8945efed48e519937c46f0888cacc5474885584`
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
