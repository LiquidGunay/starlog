# KittenTTS Mobile Feasibility (2026-05-11)

## Decision

KittenTTS is the recommended host-side TTS in v1, and Android-native ONNX KittenTTS is the later path for v1.1+.

Practical split:

- **Now (v1):** support KittenTTS through the local Python bridge (`STARLOG_LOCAL_TTS_BACKEND=kitten`) and keep synthesis host-driven.
- **Later:** keep phone playback contract unchanged (`briefing-{date}.wav` + `expo-av`) while adding a native Android KittenTTS ONNX provider after dev-build proof.

This keeps morning briefing playback reliable now while preserving a clean on-device implementation path.

## Why It Is Feasible Later

Official KittenTTS materials describe the runtime as ONNX-based, CPU-oriented, Apache-2.0, and available in small model tiers. The nano int8 artifact is roughly 25 MB on Hugging Face, and ONNX Runtime has a React Native package (`onnxruntime-react-native`). Those facts make native bundling plausible for Android.

The blocker is not model size. The blocker is runtime integration. Starlog mobile is a React Native/Expo app, while the current KittenTTS package path is Python-oriented and uses `kittentts` plus `soundfile`. Shipping it in-app requires a native module or equivalent native service that can run ONNX inference, perform the same text preprocessing/phonemization, write a WAV/PCM file, and fall back cleanly.

## Current Starlog Paths

Current code paths indicate KittenTTS is available as a local host service:

- `services/ai-runtime/bridge/local_tts_server.py` supports `STARLOG_LOCAL_TTS_BACKEND=kitten`.
- `docs/MORNING_BRIEFING_AND_VOICE.md` and `docs/LOCAL_AI_WORKER.md` document the host-side setup.
- `apps/mobile/App.tsx` queues or fetches briefing audio, caches it locally, and plays it with `expo-av` or falls back to `expo-speech`.
- `apps/mobile/src/mobile-support-panel-sections.tsx` can surface runtime status without owning synthesis.

That means KittenTTS can already render briefing audio through a paired laptop/desktop worker without changing the mobile playback model.

## Native Mobile Requirements

A bundled mobile implementation needs a dedicated Android-first slice:

- package the KittenTTS ONNX model and voice assets as app assets or first-run downloadable assets,
- add `onnxruntime-react-native` or a native ONNX Runtime Android module,
- port or embed the required text normalization and phonemization path,
- expose a small JS-facing `synthesizeBriefing(text, voice, outputPath)` API,
- write output to the existing `briefing-{date}.wav` cache path before playback,
- gate usage behind a runtime capability check and feature flag,
- preserve fallback to cached server-rendered audio and `expo-speech`,
- measure cold start, synthesis latency, battery, memory, and APK/AAB size.

The provider should not bypass the existing briefing audio contract. It should produce the same local WAV artifact the app already knows how to play.

## Risks

- **Runtime drift:** Python KittenTTS behavior may not match a native ONNX path unless preprocessing is equivalent.
- **Expo dev-client scope:** this requires native build work, not Expo Go.
- **Background behavior:** alarms and notification-triggered playback need persisted files; live synthesis at alarm fire time is risky.
- **Size and latency:** the model is small for TTS, but runtime libraries and first synthesis cost still need measurement.
- **API stability:** upstream KittenTTS is marked developer preview, so package APIs can change.

## Recommended Workitems

1. Keep KittenTTS host-side for v1 via `local_tts_server.py`.
2. Add a mobile support-panel indicator for whether the current briefing audio came from cached audio, host KittenTTS, or `expo-speech` fallback.
3. Create an Android-only prototype branch that packages the nano int8 ONNX model, runs one synthesis through ONNX Runtime, and writes `briefing-dev.wav`.
4. Promote to product flow only after measuring size, latency, and alarm-time reliability on the physical phone.

## Sources

- KittenTTS GitHub: https://github.com/KittenML/KittenTTS
- KittenTTS nano int8 artifact: https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8
- ONNX Runtime React Native: https://onnxruntime.ai/docs/get-started/with-javascript/react-native.html
