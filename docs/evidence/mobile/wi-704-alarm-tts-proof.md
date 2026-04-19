# WI-704 Android Alarm + TTS Proof

Date: 2026-04-19  
Device: OPPO CPH2381 (`9dd62e84`)  
Artifact: `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`  
Installed package: `com.starlog.app.preview`  
Version: `0.1.0-preview.4 (104)`  
SHA-256: `0b1bf8850bae7e9cb20346d2563a8e0ce039f850b35cbc958c1bac9f92226f1b`

## Scope

Validated the native Android alarm screen plus the local TTS handoff after dismiss.

## Commands and outcomes

1. Built and installed the preview APK on the connected phone with Windows `adb.exe install -r`.
2. Triggered the non-exported alarm activity through the in-app preview deep link path.
3. Verified the foreground activity switched to `com.starlog.app.preview/com.starlog.app.dev.StarlogAlarmActivity`.
4. Captured the rendered alarm screen:
   - [wi-704-alarm-preview.png](/home/ubuntu/starlog/docs/evidence/mobile/wi-704-alarm-preview.png)
5. Tapped `Dismiss + Briefing`.
6. Verified the phone returned to `com.starlog.app.preview/com.starlog.app.dev.MainActivity`.
7. Observed Android logcat entries showing local speech playback through Google TTS after dismiss.

## Log summary

Key runtime evidence from the dismiss pass:

- `TextToSpeech: Successfully bound to com.google.android.tts`
- `TextToSpeechManagerPerUserService: Connected successfully to TTS engine: com.google.android.tts`
- `AudioTrack: start(... stream 3 ...)`
- `AppName#Speech Recognition and Synthesis from Google ... TotalTime#4349`

Interpretation:

- the phone did not just route back into the app UI
- the Android TTS engine was bound and an actual spoken audio session was played locally

## Remaining note

`Snooze 10 Minutes` was tapped once and correctly dismissed the fullscreen alarm back into the app,
but the pass did not wait the full ten minutes to observe the follow-up alarm firing again.
