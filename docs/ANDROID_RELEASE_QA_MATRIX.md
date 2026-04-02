# Android Release QA Matrix (WI-303)

Date: 2026-03-15  
Device: OPPO CPH2381 (`9dd62e84`)  
ADB binary: `/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe`

## Runtime setup used

- Metro host runtime: `/home/ubuntu/starlog/apps/mobile`
- Dev-client URL: `exp+starlog://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`
- Port forwarding:
  - `adb reverse tcp:8081 tcp:8081`
  - `adb reverse tcp:8000 tcp:8000`

## Matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| Dev-client app launch on physical phone | PASS | `docs/evidence/mobile/wi-303-smoke-after-reinstall.png` |
| Android smoke script end-to-end (deep-link + text share intents) | PASS | `docs/evidence/mobile/wi-303-smoke-log.txt` |
| Deep-link capture intent delivery (`starlog://capture?...`) | PASS | `docs/evidence/mobile/wi-303-smoke-log.txt` |
| Text share intent delivery (`android.intent.action.SEND`) | PASS | `docs/evidence/mobile/wi-303-smoke-log.txt` |
| App renders companion UI post-install | PASS | `docs/evidence/mobile/wi-303-smoke-final.png` |
| Metro connectivity stability (toast-free) | PARTIAL | `docs/evidence/mobile/wi-303-smoke-final.png` (toast: `Cannot connect to Metro...`) |

## Discovered blockers and mitigations

1. Initial runtime failed with `Cannot find native module 'ExpoSecureStore'` from the previously installed debug APK.
   - Mitigation: rebuilt `apps/mobile/android` with current dependencies (`./gradlew assembleDebug`) and reinstalled APK.
2. On this device/host pair, LAN relay startup can race and produce repeated connection refusals before Metro is actually listening.
   - Mitigation: use localhost dev-client URL + explicit `adb reverse tcp:8081` to make bundling deterministic.
3. Device shell cannot persist `stayon usb` because secure setting writes are restricted.
   - Mitigation: keep phone manually unlocked throughout validation.

## WI-402 installable preview release

Date: 2026-03-16  
Device: OPPO CPH2381 (`9dd62e84`)  
Artifact: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`  
Installed package: `com.starlog.app.preview`  
Launcher component: `com.starlog.app.preview/com.starlog.app.dev.MainActivity`  
Version: `0.1.0-preview.1 (101)`  
SHA-256: `95a2a568be36666b365a342f5651abdd6fdd776199b6da8c43435d57537abfd4`

## WI-402 matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| Preview release APK build (`assembleRelease`) | PASS | `docs/evidence/mobile/wi-402-install-log.txt` |
| Windows-host install of preview release APK | PASS | `docs/evidence/mobile/wi-402-install-log.txt` |
| Cold launch of installed preview package | PASS | `docs/evidence/mobile/wi-402-install-log.txt` |
| App renders real Starlog shell instead of dev-client blocker | PASS | `docs/evidence/mobile/wi-402-preview-launch.png` |
| Resumed foreground activity belongs to preview package | PASS | `docs/evidence/mobile/wi-402-install-log.txt` |

## WI-402 blockers and mitigations

1. `:app:createBundleReleaseJsAndAssets` failed under pnpm until `expo-asset` was declared directly in `apps/mobile/package.json`.
   - Mitigation: add `expo-asset@~10.0.10` as a direct mobile dependency and refresh `pnpm-lock.yaml`.
2. The same release bundling step then failed until `@react-native/assets-registry` was declared directly in `apps/mobile/package.json`.
   - Mitigation: add `@react-native/assets-registry@0.74.87` to the mobile workspace so Expo CLI can resolve it from app root during release bundling.
3. On this host, Windows `adb.exe` can see the phone while WSL `adb` cannot, but Windows `adb.exe` cannot install from a WSL-only APK path.
   - Mitigation: copy the APK into `C:\Temp\...` first, then install via the Windows `adb.exe`.
4. The preview package does not launch at `com.starlog.app.preview/.MainActivity`.
   - Mitigation: resolve and use the actual launcher component reported by package manager: `com.starlog.app.preview/com.starlog.app.dev.MainActivity`.

## WI-403 production integration setup

Date: 2026-03-21
Device: OPPO CPH2381 (`9dd62e84`)
Hosted API: `https://starlog-api-production.up.railway.app`
Hosted PWA: `https://starlog-web-production.up.railway.app`

## WI-403 matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| Railway production auth bootstrap + bearer login | PASS | manual API verification (`/v1/health` shows `users: 1`) |
| Hosted PWA runtime session reads Railway API base | PASS | `docs/evidence/pwa/wi-403-live-notes.png` |
| Hosted PWA notes list shows seeded production data | PASS | `docs/evidence/pwa/wi-403-live-notes.png` |
| Hosted PWA tasks list shows seeded production data | PASS | `docs/evidence/pwa/wi-403-live-tasks.png` |
| Hosted PWA artifacts surface shows production artifacts | PASS | `docs/evidence/pwa/wi-403-live-artifacts.png` |
| Railway queued `codex_local` summary completes on laptop-local worker | PASS | completed job `job_a7b1283486d447b19720e20dc9c3d3cb` |
| Preview app Railway API/token configured on phone | PASS | `docs/evidence/mobile/wi-403-preview-configured.png` |
| Preview app cold-start deep-link capture (`starlog://capture?...`) prefills capture surface | PASS | `docs/evidence/mobile/wi-403-deeplink-fresh-build.png` |
| Local browser helper fallback (`http://127.0.0.1:4173`) can clip directly to Railway | PASS | CORS allowlist widened in API and validated via merged origin resolution + hosted integration rerun |
| Spoken briefing render / offline playback against Railway | PASS | completed job `job_9b11f48641054fb590f4239fdc5db835`, briefing `brf_cca0f68239ff411683488f7cb7009e05` now has `audio_ref=media://med_1c8c2a34778c4d5cafdb2e3d566405ab` |
| Railway queued `assistant_command_ai` / `llm_agent_plan` completes on laptop-local worker | PASS | completed job `job_3247b776ece04d809089d44fef5cf25a` |

## WI-403 blockers and mitigations

1. Cold-start deep-link validation can still look like a false negative if the proof capture stops at the top hero section.
   - Mitigation: scroll down to the queued capture form before judging whether title/text/source prefill landed.

## WI-581 voice-native release-candidate pass

Date: 2026-03-22
Device target: OPPO CPH2381 (`9dd62e84`)
Worktree: `/tmp/starlog-android-rc-10NdP4`
Branch: `codex/android-release-candidate`
Artifact: `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
Installed package target: `com.starlog.app.preview`
Version: `0.1.0-preview.rc1 (102)`
SHA-256: `01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a`

## WI-581 matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| Preview release APK assembly (`assembleRelease`) | PASS | `docs/evidence/mobile/wi-581-rc-summary.md` |
| Mobile TypeScript compile (`apps/mobile`) | PASS | `docs/evidence/mobile/wi-581-rc-summary.md` |
| Connected-phone install/launch rerun from this Codex shell | BLOCKED | `docs/evidence/mobile/wi-581-rc-summary.md` |
| Preview package cold launch on the connected phone | PASS (prior phone evidence) | `docs/evidence/mobile/wi-402-install-log.txt`, `docs/evidence/mobile/wi-402-preview-launch.png` |
| Deep-link capture prefill on the connected phone | PASS (prior phone evidence) | `docs/evidence/mobile/wi-403-deeplink-fresh-build.png` |
| Preview app configured against Railway on the connected phone | PASS (prior phone evidence) | `docs/evidence/mobile/wi-403-preview-configured.png` |
| Spoken briefing render / offline playback pipeline against Railway | PASS (prior phone evidence) | completed job `job_9b11f48641054fb590f4239fdc5db835`, briefing `brf_cca0f68239ff411683488f7cb7009e05` with `audio_ref=media://med_1c8c2a34778c4d5cafdb2e3d566405ab` |
| Fresh hold-to-talk screenshot evidence on the connected phone | BLOCKED | `docs/evidence/mobile/wi-581-rc-summary.md` |
| Fresh assistant/chat screenshot evidence on the connected phone | BLOCKED | `docs/evidence/mobile/wi-581-rc-summary.md` |

## WI-581 blockers and mitigations

1. This Codex Linux shell cannot execute the Windows `adb.exe` that this host uses for the physical phone (`Exec format error`), and local WSL `adb devices -l` reports no attached device.
   - Mitigation: run the final install/smoke/screenshot loop from the Windows-side flow in `docs/ANDROID_DEV_BUILD.md` or `scripts/android_native_smoke_windows.ps1`.
2. Fresh connected-phone screenshot proof for hold-to-talk and assistant/chat is not present in this pass.
   - Mitigation: use the RC APK above with the Windows-host runbook, then capture the phone screenshots into `docs/evidence/mobile/` before calling the build fully distributable.

## WI-584 Android RC phone-proof blocker reduction

Date: 2026-03-22
Device target: OPPO CPH2381 (`9dd62e84`)
Worktree: `/tmp/starlog-wi584-phone-proof`
Branch: `codex/android-phone-proof`
Artifact staged for Windows-host install: `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`
SHA-256: `01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a`

## WI-584 matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| RC APK staged into a Windows-visible path for native-host install | PASS | `docs/evidence/mobile/wi-584-phone-proof-blocker.md` |
| Windows `adb.exe devices -l` invoked from this Codex Linux shell | BLOCKED | `docs/evidence/mobile/wi-584-phone-proof-blocker.md` |
| Windows PowerShell interop invoked from this Codex Linux shell | BLOCKED | `docs/evidence/mobile/wi-584-phone-proof-blocker.md` |
| WSL-local `adb devices -l` device discovery in this shell | BLOCKED | `docs/evidence/mobile/wi-584-phone-proof-blocker.md` |
| Remaining RC phone-proof narrowed to one native Windows smoke + screenshot pass | PASS | `docs/evidence/mobile/wi-584-phone-proof-blocker.md`, `docs/ANDROID_DEV_BUILD.md` |

## WI-584 blocker and narrowest fix

1. This specific Codex Linux subagent shell cannot execute Windows interop binaries at all, so neither `C:\Temp\android-platform-tools\platform-tools\adb.exe` nor `powershell.exe` can be used from here, and WSL-local `adb` is not available on `PATH`.
   - Narrowest fix: from a native Windows shell on this host, run the exact RC install/smoke command now documented in `docs/ANDROID_DEV_BUILD.md`, then capture the two remaining screenshots:
     - hold-to-talk on the installed RC app
     - assistant/chat on the installed RC app

## WI-590 current-master proof refresh

Date: 2026-03-22
Device target: OPPO CPH2381 (`9dd62e84`)
Repo commit: `fbf6c44c8d42e825022d3a5b565860b4e5cbee7f`
Artifact: `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
Staged Windows copy: `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`
SHA-256: `01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a`

## WI-590 matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| Current-master repo state matches canonical release artifact commit | PASS | `docs/evidence/mobile/wi-590-master-proof.md` |
| Current preview APK remains present and hash-stable | PASS | `docs/evidence/mobile/wi-590-master-proof.md` |
| Windows-visible APK staging for host install/run | PASS | `docs/evidence/mobile/wi-590-master-proof.md` |
| Linux-shell execution of Windows ADB path | BLOCKED | `docs/evidence/mobile/wi-590-master-proof.md` |
| Linux ADB visibility of connected physical phone | BLOCKED | `docs/evidence/mobile/wi-590-master-proof.md` |
| Fresh on-phone hold-to-talk / assistant / briefing screenshots from this Codex shell | BLOCKED | `docs/evidence/mobile/wi-590-master-proof.md` |

## WI-590 blocker

1. The current-master Android artifact is ready, but this Codex Linux shell still cannot execute Windows-host binaries (`powershell.exe`, `cmd.exe`, `adb.exe`) and Linux `adb` still sees no connected phone here.
   - Mitigation: run the documented native Windows `scripts/android_native_smoke_windows.ps1` command against the staged `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk` file, then capture the hold-to-talk and assistant/chat screenshots there.

## WI-601 phone-proof import refresh

Date: 2026-03-23
Device target: OPPO CPH2381 (`9dd62e84`)
Repo commit: `0e967da986b2590af9d497448a03678b7305cc25`
Artifact under test: `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`
Installed package: `com.starlog.app.preview`
Launcher component: `com.starlog.app.preview/com.starlog.app.dev.MainActivity`
SHA-256: `01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a`

## WI-601 matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| Windows-host `adb.exe devices -l` from the main Codex shell | PASS | `docs/evidence/mobile/wi-601-smoke-log.txt` |
| RC APK streamed install from the Windows-visible `C:\Temp\...` path | PASS | `docs/evidence/mobile/wi-601-smoke-log.txt` |
| Preview package launch after install | PASS | `docs/evidence/mobile/wi-601-smoke-log.txt` |
| Android smoke script rerun (`launch + deep-link + text share`) | PASS | `docs/evidence/mobile/wi-601-smoke-log.txt` |
| Assistant/chat-native shell on the installed preview package | PASS | `docs/evidence/mobile/wi-601-assistant-shell.png` |
| Alarms / briefing surface on the installed preview package | PASS | `docs/evidence/mobile/wi-601-alarms-briefing.png` |
| Foreground activity belongs to preview package after smoke | PASS | `docs/evidence/mobile/wi-601-smoke-log.txt` |
| Live Railway-hosted deployment remains reachable for feedback use | PASS | `docs/PREVIEW_FEEDBACK_BUNDLE.md` |

## WI-601 notes

1. The working device path on this host is now the Windows platform-tools `adb.exe`, while Linux `adb` still reports no attached device.
   - Mitigation: continue using the Windows ADB binary for physical-phone proof on this host.
2. When the smoke script uses `adb.exe`, installs must target a native Windows path (`C:\Temp\...`), not a WSL path (`/mnt/c/...`).
   - Mitigation: install with the Windows path first, then rerun `./scripts/android_native_smoke.sh` with `SKIP_INSTALL=1` for the scripted launch/deep-link/share flow.
3. The alarms surface currently reports `No offline briefing cached yet` in this specific proof run.
   - Interpretation: the installable preview and hosted integration are ready for feedback, but a fresh offline-audio cache artifact was not part of this evidence import.

## WI-619 semistable release refresh

Date: 2026-03-27
Device target: OPPO CPH2381 (`9dd62e84`)
Artifact under test: `/home/ubuntu/starlog_preview_bundle/android/starlog-preview-0.1.0-preview.rc2-103.apk`
Fresh worktree build source: `/home/ubuntu/starlog-worktrees/validation-artifact-bundle/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
Staged Windows copy: `C:\Temp\starlog-preview-0.1.0-preview.rc2-103.apk`
Version: `0.1.0-preview.rc2 (103)`
SHA-256: `0c9666daee9d4c6b99384de289a84a28b441b9d0a6d4f2271f387f251bdf8741`

## WI-619 matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| Preview RC2 APK assembly (`assembleRelease`) | PASS | local build log on 2026-03-27 |
| Windows-visible APK staging (`C:\Temp\...`) | PASS | staged copy present |
| Windows PnP device visibility (`oppointeraction`, `ADB Interface`) | PASS | PowerShell host probe on 2026-03-27 |
| Windows `adb.exe devices -l` daemon health | BLOCKED | returned `protocol fault (couldn't read status): connection reset` |
| Fresh installed-phone launch/smoke from this host | BLOCKED | blocked behind Windows ADB daemon health |
| Fresh installed-phone screenshot proof from this host | BLOCKED | blocked behind Windows ADB daemon health |

## WI-619 blocker

1. The semistable RC2 APK itself built and staged successfully, but the current Windows ADB daemon on this host is unhealthy.
   - Mitigation: restart/recover the Windows `adb.exe` path outside WSL, then rerun the install/launch/screenshot loop against `C:\Temp\starlog-preview-0.1.0-preview.rc2-103.apk`.

## WI-622 production packaging path

Date: 2026-03-30
Worktree: `/home/ubuntu/starlog-worktrees/android-production-release-path`
Branch: `codex/android-production-release-path`
Validated script: `scripts/android_prepare_production_release.sh`
Validation artifact root: `/tmp/wi622-production-artifacts`
Validation version: `0.1.0 (105)`
Validation signing mode: tracked debug keystore under explicit `STARLOG_ALLOW_DEBUG_KEYSTORE_FOR_VALIDATION=1` override

## WI-622 matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| Production Expo config resolves to `Starlog` / `com.starlog.app` without `expo-dev-client` plugin entries | PASS | local `expo config --json` on 2026-03-30 |
| Canonical production packaging script refuses implicit debug-keystore use by default | PASS | script guard in `scripts/android_prepare_production_release.sh` |
| Signed production AAB build (`bundleRelease`) through canonical script | PASS | `/tmp/wi622-production-artifacts/starlog-0.1.0-105.aab` |
| Signed production QA APK build (`assembleRelease`) through canonical script | PASS | `/tmp/wi622-production-artifacts/starlog-0.1.0-105-signed.apk` |
| Smoke helpers resolve the signed-production QA target as `com.starlog.app/com.starlog.app.dev.MainActivity` when `APP_VARIANT=production` / `-AppVariant production` is used | PASS | `PRINT_CONFIG=1 ./scripts/android_native_smoke.sh`, `.\scripts\android_native_smoke_windows.ps1 -AppVariant production -PrintConfig` |
| Production artifact metadata + checksums emitted | PASS | `/tmp/wi622-production-artifacts/starlog-0.1.0-105-release-metadata.json`, `/tmp/wi622-production-artifacts/checksums.sha256` |

## WI-622 notes

1. The production path is now distinct from preview RC packaging:
   - preview remains the sideload feedback APK flow
   - production is the signed Play-upload AAB plus optional signed QA APK flow
2. Production packaging must also validate the final APK label and package from the built artifact, not only the Expo config inputs.
3. The tracked Android `main` manifest no longer carries `SYSTEM_ALERT_WINDOW`, `exp+starlog`, or `DevSettingsActivity`; those remain debug-only.
4. This validation used the repo debug keystore only to exercise the script end-to-end in CI-like local conditions.
   - Real store uploads still require the actual Starlog upload keystore and a fresh signed-QA-APK phone smoke pass.
5. The store checklist for this branch now matches the merged release manifest rather than the source manifest.

## WI-630 latest production APK refresh

Date: 2026-04-02
Device target: OPPO CPH2381 (`9dd62e84`)
Worktree: `/home/ubuntu/starlog-worktrees/latest-apk-release`
Branch: `codex/latest-apk-release`
Artifact under test: `/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-110-signed.apk`
Staged Windows copy: `C:\Temp\starlog-0.1.0-110-signed.apk`
Package: `com.starlog.app`
Launcher component: `com.starlog.app/com.starlog.app.dev.MainActivity`
Version: `0.1.0 (110)`

## WI-630 matrix

| Flow | Result | Evidence |
| --- | --- | --- |
| Production Expo config resolves to hosted Railway defaults | PASS | `APP_VARIANT=production ./node_modules/.bin/expo config --json` |
| Built production APK badging reports `application-label:'Starlog'` | PASS | `aapt dump badging /home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-110-signed.apk` |
| Windows-host streamed install of `110` APK | PASS | `adb install -r C:\Temp\starlog-0.1.0-110-signed.apk` |
| Installed package version is `110` on the connected phone | PASS | `adb shell dumpsys package com.starlog.app` |
| Installed APK renders the latest Velvet capture shell | PASS | `/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-110-release-smoke.png` |
| Installed APK renders the mobile mission-tools assistant surface | PASS | `/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-110-assistant-panel.png` |

## WI-630 notes

1. The previous production-style APK could still ship with the stale native label `Starlog Dev` because the checked-in Android resources had drifted from Expo config.
   - Mitigation: define `app_name` from `APP_VARIANT` in Gradle and make `scripts/android_prepare_production_release.sh` assert the final APK package/version/label with `aapt dump badging`.
2. Google Play Protect still prompts for sideloaded QA APKs on this device.
   - Mitigation: dismiss the prompt once, then continue the validation flow; the prompt now correctly shows `Starlog`, which confirms the label fix made it into the packaged artifact.
