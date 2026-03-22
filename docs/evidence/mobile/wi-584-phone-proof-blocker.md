# WI-584 Android RC phone-proof blocker reduction

Date: 2026-03-22T14:14:10Z
Worktree: `/tmp/starlog-wi584-phone-proof`
Branch: `codex/android-phone-proof`
Device target: OPPO CPH2381 (`9dd62e84`)

## What was completed in this pass

- Reused the current RC artifact from `/home/ubuntu/starlog/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- Staged that APK into the Windows-visible path `C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk`
- Revalidated that the staged file hash still matches the RC artifact:

```text
01a4dea0fb448e9ae02e5cdce39789c6a80efd5ec6f6c361ec225268743aaa5a  /mnt/c/Temp/starlog-preview-0.1.0-preview.rc1-102.apk
```

## Exact blocker reproduced in this shell

### Windows PowerShell interop cannot be executed from this Codex Linux shell

Command:

```bash
powershell.exe -NoProfile -Command '& "C:\Temp\android-platform-tools\platform-tools\adb.exe" devices -l'
```

Output:

```text
/bin/bash: line 1: /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe: cannot execute binary file: Exec format error
```

### Windows `adb.exe` cannot be executed directly from this Codex Linux shell

Command:

```bash
/mnt/c/Temp/android-platform-tools/platform-tools/adb.exe devices -l
```

Output:

```text
/bin/bash: line 1: /mnt/c/Temp/android-platform-tools/platform-tools/adb.exe: cannot execute binary file: Exec format error
```

### Windows `cmd.exe` interop is blocked for the same reason

Command:

```bash
cmd.exe /c echo interop-ok
```

Output:

```text
/bin/bash: line 1: /mnt/c/Windows/system32/cmd.exe: cannot execute binary file: Exec format error
```

### WSL-local ADB is not available in this shell

Command:

```bash
adb devices -l
```

Output:

```text
/bin/bash: line 1: adb: command not found
```

## Narrowest remaining fix

Run this exact command from a native Windows PowerShell prompt at the repo root:

```powershell
.\scripts\android_native_smoke_windows.ps1 `
  -AdbPath "C:\Temp\android-platform-tools\platform-tools\adb.exe" `
  -Serial 9dd62e84 `
  -ApkPath "C:\Temp\starlog-preview-0.1.0-preview.rc1-102.apk" `
  -AppPackage "com.starlog.app.preview" `
  -AppActivity "com.starlog.app.preview/com.starlog.app.dev.MainActivity" `
  -ReversePorts "8000"
```

After that command succeeds, collect these final proof artifacts into `docs/evidence/mobile/`:

- a hold-to-talk screenshot on the installed RC app
- an assistant/chat screenshot on the installed RC app
- the Windows smoke log for the RC install/run
