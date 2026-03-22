# vNext Test Bundle

This is the shortest realistic handoff for testing the current voice-native Starlog slice without rereading the full plan.

## What exists on current `master`

- Voice-native PWA assistant thread with persistent server-backed conversation and stabilized hold-to-talk behavior.
- Desktop helper bridge diagnostics plus local voice-server bridge paths for Whisper-style STT and local TTS.
- Android companion with capture, assistant voice flows, and offline briefing playback scaffolding.
- Image-backed design comps for the target PWA, mobile, and desktop-helper look.
- Fast cross-surface smoke gate via `./scripts/ci_smoke_matrix.sh`.

## What to test right now

### PWA

- Primary surface: `/assistant`
- Also inspect:
  - `/artifacts`
  - `/integrations`
  - `/ai-jobs`
- Read first:
  - `README.md`
  - `docs/AI_VALIDATION_SMOKE_MATRIX.md`
- Feedback to capture:
  - whether the assistant thread feels like the primary operating surface,
  - whether hold-to-talk start/stop feels reliable,
  - whether cards and recent voice turns stay readable.

### Phone

- Use:
  - `docs/ANDROID_DEV_BUILD.md`
  - `docs/PHONE_SETUP.md`
  - the Android phone-testing runbook in `AGENTS.md`
- Core smoke to run:
  - launch the current dev build/dev client,
  - record one voice turn,
  - verify assistant/chat response path,
  - verify one briefing playback path,
  - capture screenshots as evidence.
- Feedback to capture:
  - STT responsiveness,
  - playback quality,
  - whether the phone flow feels like quick capture/triage rather than a cramped full editor.

### Desktop helper

- Use:
  - `docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md`
  - `docs/DESKTOP_HELPER_V1_RELEASE.md`
  - `docs/LOCAL_AI_WORKER.md`
- Core smoke to run:
  - launch helper popup/studio,
  - verify local bridge health/discovery,
  - verify one local capture path,
  - verify local voice diagnostics if Whisper/TTS servers are available.
- Feedback to capture:
  - whether the helper is fast enough for capture-first usage,
  - whether bridge diagnostics are understandable without reading code,
  - whether local voice setup feels manageable.

## Visual references

- `docs/design/IMAGE_ASSETS.md`
- `docs/design/assets/voice_native_moodboard_board.png`
- `docs/design/assets/voice_native_pwa_chat_comp.png`
- `docs/design/assets/voice_native_mobile_voice_comp.png`
- `docs/design/assets/voice_native_desktop_helper_comp.png`

## Fast verification before handing the build to a human

```bash
./scripts/ci_smoke_matrix.sh
```

If the change is web-heavy, also run the heavier PWA/web checks already documented in `README.md` and `docs/AI_VALIDATION_SMOKE_MATRIX.md`.

## Known blockers before calling this a clean distributable candidate

- `WI-580`: local-PC desktop-helper release-candidate pass still needs a fresh host-validated run on current master.
- `WI-581`: connected-phone Android release-candidate pass still needs a fresh device-validated run on current master.
- `WI-582`: hosted/Railway PWA release-candidate pass still needs a current-master readiness or deployment verification.

## Feedback to ask for

- Did chat/voice feel like the main control surface?
- Where did the flow still feel like a debug tool instead of a product?
- Which of desktop, phone, or PWA felt closest to daily use?
- Which failures were confusing enough that the docs or diagnostics need another pass?
