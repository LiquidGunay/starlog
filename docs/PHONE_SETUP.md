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
pnpm --filter web dev -- --hostname 0.0.0.0 --port 3000
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

## 4) Install PWA to home screen

- iOS (Safari): Share -> Add to Home Screen
- Android (Chrome): Menu -> Install app / Add to Home screen

## 5) Run mobile companion app (Expo Go)

1. Install Expo Go on your phone.
2. From repo root:

```bash
pnpm --filter mobile start
```

3. Scan QR from terminal/Expo DevTools with Expo Go.
4. In app settings fields:
   - API base: `http://<LAN_IP>:8000`
   - Bearer token: paste token from PWA/web login
5. Optional sanity checks in the mobile app:
   - Capture/Queue a quick clip.
   - Refresh the artifact inbox, select a recent clip, and trigger `Summarize` or `Create Cards`.
   - Inspect the selected artifact detail block to confirm summary/task/card/note context loads on phone.
   - Load due cards in "Quick review session" and submit a rating.
   - Cache and play a briefing, then schedule the daily alarm.

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

## Troubleshooting

- If phone cannot reach web/API, check firewall and that both devices are on same network.
- If corporate Wi-Fi blocks LAN traffic, use a personal hotspot.
- If Expo LAN is unstable, switch Expo to Tunnel; keep API base pointing to reachable backend URL.
