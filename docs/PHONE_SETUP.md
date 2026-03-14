# Starlog Phone Setup (PWA + Mobile Companion)

Use this guide to run Starlog on your laptop and test progress from your phone.

## 1) Start local services

From repo root:

```bash
pnpm install
uv sync --project services/api --extra dev
make dev-api
```

`make dev-api` already binds API to `0.0.0.0:8000`.

In a second terminal, start web on LAN host:

```bash
make dev-web-lan
```

In a third terminal, if you want queued Codex/Whisper work to complete locally:

```bash
export STARLOG_TOKEN=YOUR_BEARER_TOKEN
export STARLOG_WHISPER_COMMAND='whisper-cli -m /ABS/PATH/ggml-base.en.bin -f {input_path} -otxt -of {output_base}'
export STARLOG_TTS_COMMAND='piper --model /ABS/PATH/en_US-lessac-medium.onnx --output_file {output_path}'

PYTHONPATH=services/api uv run --project services/api \
  python scripts/local_ai_worker.py \
  --api-base http://<LAN_IP>:8000 \
  --token "$STARLOG_TOKEN"
```

## 2) Find your laptop LAN IP

macOS examples:

```bash
ipconfig getifaddr en0
ipconfig getifaddr en1
```

Use the non-empty IP (example: `192.168.1.42`).

## 3) Open the PWA on phone

1. Connect phone and laptop to the same network.
2. On phone browser, open:
   - `http://<LAN_IP>:3000`
3. In Starlog session controls, set:
   - API base: `http://<LAN_IP>:8000`
4. Bootstrap/login from the web console and keep token in session controls.
5. Use `/sync-center` if you want to inspect or manually replay queued PWA mutations after reconnecting, and compare them with recent server-side sync history.
6. Open `/assistant` if you want to test typed commands such as `summarize latest artifact` or `create task Review notes due tomorrow priority 4`.
7. In `/assistant`, you can also use `Queue Codex Plan` / `Queue Codex Execute` for queued LLM-assisted command planning, or browser voice recording (`Start Voice Command` -> `Execute Voice`) to queue a Whisper-backed command without installing the native app.
8. Open `/ai-jobs` if you want to inspect queued local Codex/Whisper/TTS work, retry failed jobs, or cancel work that should not keep running.

## 4) Install PWA to home screen

- iOS (Safari): Share -> Add to Home Screen
- Android (Chrome): Menu -> Install app / Add to Home screen

Once installed, the PWA now exposes a share target route at `/share-target` and keeps a service worker
registered for installability.

## 5) Run mobile companion app

Preferred native Android path:

```bash
pnpm --filter mobile android:local
pnpm --filter mobile start:dev-client
```

Native iOS path (macOS host + Xcode required):

```bash
pnpm --filter mobile ios
pnpm --filter mobile start:dev-client
```

Fallback JS-only path:

```bash
pnpm --filter mobile start
```

1. Install the native dev build on your phone (Android or iOS), or use Expo Go for the fallback path.
2. In app settings fields:
   - API base: `http://<LAN_IP>:8000`
   - Bearer token: paste token from PWA/web login
3. Optional sanity checks in the mobile app:
   - Open the `Execution routing` panel and tap `Refresh Policy` to confirm the phone sees the same policy order as the PWA.
   - In `Assistant command`, try `summarize latest artifact` or `create task Review notes due tomorrow priority 4`.
   - If STT policy resolves to `on_device` and the phone reports Android speech recognition available, use `Listen & Plan` / `Listen & Execute` to run an assistant command without uploading audio to Whisper first.
   - In the same panel, use `Queue Codex Plan` / `Queue Codex Execute` to confirm queued Codex planner jobs reach the API.
   - Record a short voice clip and use `Execute Voice` to queue a Whisper-backed voice command.
   - Capture/Queue a quick text clip.
   - Record a voice note, then upload/queue it.
   - Refresh the artifact inbox, select a recent clip, and trigger `Summarize` or `Create Cards`.
   - Inspect the selected artifact detail block to confirm summary/task/card/note context loads on phone.
   - Use `Speak Locally` in artifact triage to confirm on-device TTS.
   - Load due cards in "Quick review session" and submit a rating.
   - In `Offline Morning Brief Pipeline`, use `Queue Audio Render`, wait for the local worker to process it, then `Cache Briefing` and `Play Cached` to confirm pre-rendered briefing audio works offline.
   - Schedule the daily alarm after caching the briefing package.
4. If you queued a voice note, confirm the laptop worker is running so the transcript can complete.
5. If you queued a voice command or Codex command, tap `Refresh Jobs` in the assistant panel to inspect the transcript/executed command result after the worker finishes.
6. If you installed a native dev build, share text, a URL, an image/file, or an audio file into Starlog from another app and confirm the companion app prefills quick capture (or the voice upload slot for shared audio).
7. For iOS share-extension validation, run the iOS dev build from Xcode/`expo run:ios`, then use the iOS Share sheet into Starlog and confirm the same quick-capture draft behavior as Android.
8. If you have `adb` access to the Android device/emulator, you can also run `pnpm test:android:smoke` from repo root to install the current debug APK and trigger both a deep-link capture and a plain-text Android share intent automatically.
9. On this host, if WSL `adb shell` is flaky but Windows `adb.exe` can still see the Android phone, use the Windows-host fallback instead:

```powershell
.\scripts\android_native_smoke_windows.ps1 -ReversePorts "8081,8000"
```

   If Windows already shows both the phone and an `ADB Interface` but `adb devices` is still empty, the remaining blocker is usually phone-side authorization: unlock the handset, confirm `USB debugging` is enabled, and accept the `Allow USB debugging` prompt.

10. In fresh Codex worktrees, run `npx pnpm@9.15.0 install` before native validation. The checked-in native project still resolves React Native/Expo packages from workspace `node_modules`.
11. If you validate the Android native project directly with `./gradlew assembleDebug`, export `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT` first.

### WSL physical-device Metro path

For this specific host, the most reliable dev-client path has been LAN Metro through a Windows relay instead of `adb reverse tcp:8081`:

1. Start the Windows-side relay from WSL:

```bash
pnpm android:metro:relay:windows
```

2. Start Expo in LAN mode from `apps/mobile`:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=<WINDOWS_LAN_IP> pnpm start:dev-client:lan
```

3. Keep `adb reverse` for API port `8000`. Do not keep `tcp:8081` reversed once you are using the explicit dev-client URL below; on this host that mixed `localhost` and LAN transport paths and caused misleading `Cannot connect to Metro...` warnings.

4. Launch the dev client with the repo helper:

```bash
ADB=/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe \
ADB_SERIAL=192.168.0.104:5555 \
METRO_HOST=<WINDOWS_LAN_IP> \
pnpm android:open:dev-client
```

Equivalent explicit URL:

```text
exp+starlog://expo-development-client/?url=http://<WINDOWS_LAN_IP>:8081
```

Android on-device STT notes:

- This path is Android-only in the native dev build right now.
- It depends on a working system speech-recognition service on the phone; if the probe says it is unavailable, the assistant voice flow falls back to queued Whisper.
- `Listen & Plan` / `Listen & Execute` only appear as the active path when execution policy keeps `stt` on `on_device` and the phone probe succeeds.

Native Android build details: `docs/ANDROID_DEV_BUILD.md`

## 5b) Test PWA offline queue and cache

1. Open the PWA.
2. While online, open `/notes`, `/tasks`, `/calendar`, or `/artifacts` and load real data.
3. For notes/tasks, select one item so the editor can be restored from the cached entity record after a reload.
4. For artifacts, open one item so the linked graph and version history are fetched into the local cache too.
5. If you refresh `/tasks` under a filtered status, switch back to `All` once before going offline so you can confirm the canonical task cache still contains the broader list.
6. Disconnect from the network or point the API base at an unreachable host.
7. Reload the same workspace and confirm the recent notes/tasks/calendar items or artifact detail panel still render from cache.
8. In `/tasks`, switch between `All` and a filtered status while offline to confirm the local cache, not only the last filtered response, drives the list.
9. Open `/search`, run a query that should match cached note/task text or an artifact summary, and confirm cached results appear even while offline.
10. Create a clip, submit a review, or create a calendar event while offline to confirm the mutation enters the outbox.
11. Reconnect, then use the session panel or `/sync-center` to replay the queued mutations; the affected cache prefix should be marked stale until the workspace refresh clears it.

## 6) Test mobile share capture (deep-link path)

The companion app now supports incoming capture payloads via `starlog://capture?...`.

You can also generate deep-links from the web workspace at `/mobile-share`.

Example payload format:

```text
starlog://capture?title=Clip&text=Remember%20this&source_url=https%3A%2F%2Fexample.com
```

Ways to trigger:
- iOS: open the URL from Notes/Safari/Shortcuts.
- Android: `adb shell am start -a android.intent.action.VIEW -d "starlog://capture?title=Clip&text=Hello"` (when testing with emulator/device + debug tools).
- Android shell note: if the URI includes `&source_url=...`, use the repo smoke helpers or quote/escape the remote shell command so Android does not split the deep link at `&`.

When opened, the app pre-fills the capture form so you can submit immediately or queue offline.

## 6b) Test Android native share intent

This requires the Android dev build from `docs/ANDROID_DEV_BUILD.md`; it does not work in Expo Go.

1. Install the Android dev build.
2. From another Android app, use the system Share action on:
   - selected text
   - a URL
   - one or more images/files
   - an audio file or recording
3. Choose Starlog from the share sheet.
4. Confirm the companion app opens with:
   - quick capture title/text/source URL prefilled for text/URL shares
   - shared images/files listed in quick capture, including multi-file shares
   - `voiceClipUri` preloaded for shared audio so `Upload / Queue Voice` can send it to the API
   - shared media still present if the app backgrounds/restarts before you submit
5. Submit or queue the capture normally inside Starlog.
6. Expected validation outcomes:
   - text/URL shares prefill quick capture fields,
   - file/image shares show one or more shared drafts and later upload as media-backed artifacts,
   - audio shares populate the `Voice clip` slot without re-recording,
   - drafts survive brief app backgrounding/restart before submit.

## 7) Test installed PWA share target

This works best on Android/Chromium where installed PWAs support the Web Share Target API.

1. Install the PWA to the phone home screen.
2. From Chrome (or another app that supports web sharing), choose Share on a page or selected text.
3. Pick the installed Starlog app from the share sheet.
4. Starlog opens `/share-target` with the shared title/text/url prefilled.
5. Tap `Capture to Inbox`, then open `/artifacts` to confirm the new artifact exists.

If your browser does not show Starlog in the share sheet, open `/share-target` directly and paste the
content manually; iOS browser support for PWA share targets is still limited.

## 8) Test portability workflow

1. Open `/portability` in the PWA.
2. Tap `Load Export` to fetch the current JSON snapshot.
3. Tap `Download JSON` to save a copy locally.
4. To drill restore behavior, paste an export payload back into the textarea and tap `Restore Snapshot`.
5. On your laptop, you can also run:

```bash
make verify-export
```

## Troubleshooting

- If phone cannot reach web/API, check firewall and that both devices are on same network.
- If corporate Wi-Fi blocks LAN traffic, use a personal hotspot.
- If Expo LAN is unstable, switch Expo to Tunnel; keep API base pointing to reachable backend URL.
- If voice-note transcription stays queued, confirm the laptop worker is running and `STARLOG_WHISPER_COMMAND` points to a working `whisper.cpp` command.
