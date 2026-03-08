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
7. In `/assistant`, you can also use browser voice recording (`Start Voice Command` -> `Execute Voice`) to queue a Whisper-backed command without installing the native app.

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

Fallback JS-only path:

```bash
pnpm --filter mobile start
```

1. Install the Android dev build on your phone, or use Expo Go for the fallback path.
2. In app settings fields:
   - API base: `http://<LAN_IP>:8000`
   - Bearer token: paste token from PWA/web login
3. Optional sanity checks in the mobile app:
   - Open the `Execution routing` panel and tap `Refresh Policy` to confirm the phone sees the same policy order as the PWA.
   - In `Assistant command`, try `summarize latest artifact` or `create task Review notes due tomorrow priority 4`.
   - In the same panel, record a short voice clip and use `Execute Voice` to queue a Whisper-backed voice command.
   - Capture/Queue a quick text clip.
   - Record a voice note, then upload/queue it.
   - Refresh the artifact inbox, select a recent clip, and trigger `Summarize` or `Create Cards`.
   - Inspect the selected artifact detail block to confirm summary/task/card/note context loads on phone.
   - Use `Speak Locally` in artifact triage to confirm on-device TTS.
   - Load due cards in "Quick review session" and submit a rating.
   - Cache and play a briefing, then schedule the daily alarm.
4. If you queued a voice note, confirm the laptop worker is running so the transcript can complete.
5. If you queued a voice command, tap `Refresh Voice Jobs` in the assistant panel to inspect the transcript and executed command result after the worker finishes.

Native Android build details: `docs/ANDROID_DEV_BUILD.md`

## 5b) Test PWA offline queue

1. Open the PWA.
2. Disconnect from the network or point the API base at an unreachable host.
3. Create a clip, submit a review, or create a calendar event.
4. Reconnect, then use the session panel or `/sync-center` to replay the queued mutations.

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

When opened, the app pre-fills the capture form so you can submit immediately or queue offline.

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
