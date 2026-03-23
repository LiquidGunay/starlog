# WI-601 Phone Proof Refresh

Date: 2026-03-23  
Device: OPPO CPH2381 (`9dd62e84`)  
Repo commit under test: `0e967da986b2590af9d497448a03678b7305cc25`  
APK under test: `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`  
Package: `com.starlog.app.preview`  
Launcher activity: `com.starlog.app.preview/com.starlog.app.dev.MainActivity`

## Summary

The current preview RC was installed and launched against the connected phone using the Windows
platform-tools `adb.exe` path from this Codex shell. The smoke pass completed for install, launch,
deep-link capture, and text share.

Fresh proof artifacts from this pass:

- `docs/evidence/mobile/wi-601-assistant-shell.png`
- `docs/evidence/mobile/wi-601-alarms-briefing.png`
- `docs/evidence/mobile/wi-601-smoke-log.txt`

## Notes

- The assistant shell screenshot is the current voice/chat-native landing surface.
- The alarms screenshot confirms the phone reaches the briefing/alarm surface on the installed
  preview package.
- The alarm surface still reports `No offline briefing cached yet` on this specific pass, so the
  proof here is focused on installability, navigation, and hosted connectivity rather than a fresh
  offline audio cache artifact.
- Linux `adb` in this shell still shows no device; the working device path on this host remains the
  Windows platform-tools binary.
