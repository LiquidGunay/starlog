# WI-590 current-master Android phone proof attempt

Date: 2026-03-22

Repo state:

- validation worktree commit: `fbf6c44c8d42e825022d3a5b565860b4e5cbee7f`
- canonical checkout commit: `fbf6c44c8d42e825022d3a5b565860b4e5cbee7f`

Artifact state:

- current preview APK path:
  - `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- SHA-256:
  - `01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a`
- staged Windows-visible copy:
  - `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`
- staged copy SHA-256:
  - `01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a`

Attempted host-side proof commands:

```bash
~/.local/android/platform-tools/adb devices -l
powershell.exe -NoProfile -Command "& 'C:\\Temp\\android-platform-tools\\platform-tools\\adb.exe' devices -l"
cmd.exe /C echo hello
```

Observed results:

- Linux `adb` returned an empty device list.
- `powershell.exe` failed immediately with `Exec format error`.
- `cmd.exe` failed immediately with `Exec format error`.

Conclusion:

- The current-master Android artifact is ready and staged, but this Codex Linux shell cannot execute the Windows-host ADB path and the Linux-host ADB path cannot see the physical phone.
- The remaining proof step is therefore one native Windows-shell run on the host machine:

```powershell
.\scripts\android_native_smoke_windows.ps1 `
  -AdbPath "C:\Temp\android-platform-tools\platform-tools\adb.exe" `
  -Serial 9dd62e84 `
  -ApkPath "C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk" `
  -AppPackage "com.starlog.app.preview" `
  -AppActivity "com.starlog.app.preview/com.starlog.app.dev.MainActivity" `
  -ReversePorts "8000"
```

Expected evidence to capture on the host:

- hold-to-talk screenshot on the current preview APK
- assistant/chat screenshot on the current preview APK
- Windows smoke log from the command above
