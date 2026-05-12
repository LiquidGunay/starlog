# Copy Audit Notes — 2026-05-11

Date: 2026-05-11

## Scope

- Focused on docs copy for:
  - native-first phone UX
  - PWA fallback messaging
  - morning-briefing/voice workflows
  - KittenTTS host-side vs native ONNX split

## Doc updates made

- `docs/MORNING_BRIEFING_AND_VOICE.md`
- `docs/KITTEN_TTS_MOBILE_FEASIBILITY.md`
- `docs/USER_GUIDE.md`
- `docs/ANDROID_DEV_BUILD.md`
- `docs/UI_FUNCTIONAL_TEST_HARNESSES.md`

## Sanity validation

Ran markdown grep to confirm key terms are present in updated files:

```bash
rg -n "native-first|fallback|host-side|ONNX|KittenTTS|phone.*native" docs/MORNING_BRIEFING_AND_VOICE.md docs/KITTEN_TTS_MOBILE_FEASIBILITY.md
```

## Note

- Some documentation files had ownership restrictions in this checkout, so they were
  updated through the same copy-replace workflow used elsewhere in this pass.
