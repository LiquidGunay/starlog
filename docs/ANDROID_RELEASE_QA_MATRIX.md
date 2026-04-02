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

## Production sideload guard

When validating a production APK on a phone, do not treat a signed APK as good just because it installs.
The broken `bundleRelease`-derived APK shape dropped the Hermes runtime libs and fell back to JSC on device,
which crashed with `Unexpected token '?'`.

- Use the direct `assembleRelease` APK for sideload QA.
- Run `pnpm test:android:release-smoke` before sharing the APK with testers.
- If the smoke script reports missing `libhermes.so` or `libhermes_executor.so`, rebuild the APK and do not sideload it.

## 2026-04-02 release smoke pass

Artifact: `/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-108.apk`
Device: OPPO CPH2381 (`9dd62e84`)

| Flow | Result | Evidence |
| --- | --- | --- |
| Hermes preflight on broken `bundleRelease` APK | FAIL as expected | `scripts/android_release_phone_smoke.sh` precheck rejected `/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-107-signed.apk` because `libhermes.so` and `libhermes_executor.so` were missing |
| Hermes preflight on direct `assembleRelease` APK | PASS | `scripts/android_release_phone_smoke.sh` precheck accepted `/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-108.apk` |
| Windows-path install + launch smoke | PASS | `/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-108-release-smoke.png` |
| Crash buffer after launch | PASS | `/home/ubuntu/starlog_production_bundle/android/starlog-0.1.0-108-release-crash.log` (empty) |
