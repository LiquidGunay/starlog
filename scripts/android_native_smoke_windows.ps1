param(
  [string]$AdbPath = $(if (Test-Path "C:\Temp\android-platform-tools\platform-tools\adb.exe") { "C:\Temp\android-platform-tools\platform-tools\adb.exe" } else { "adb.exe" }),
  [string]$Serial = "",
  [string]$ApkPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk"),
  [string]$AppPackage = "com.starlog.app.dev",
  [string]$AppActivity = "com.starlog.app.dev/.MainActivity",
  [string]$DevClientUrl = "",
  [string]$DeepLink = "starlog://capture?title=Smoke%20Clip&text=Hello%20from%20adb",
  [string]$ShareTitle = "Starlog native share",
  [string]$ShareText = "Hello from the Starlog Android smoke script",
  [int]$WaitTimeoutSeconds = 180,
  [int]$InstallTimeoutSeconds = 180,
  [string]$ReversePorts = "",
  [switch]$SkipInstall,
  [switch]$SkipLaunch,
  [switch]$SkipDeepLink,
  [switch]$SkipTextShare
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Log {
  param([string]$Message)
  Write-Host "[android-smoke:windows] $Message"
}

function Require-File {
  param(
    [string]$Path,
    [string]$Label
  )
  if (-not (Test-Path $Path)) {
    throw "$Label not found: $Path"
  }
}

function Require-CommandOrFile {
  param(
    [string]$Value,
    [string]$Label
  )

  if (Test-Path $Value) {
    return
  }

  if (Get-Command $Value -ErrorAction SilentlyContinue) {
    return
  }

  throw "$Label not found: $Value"
}

function Invoke-Adb {
  param([string[]]$Arguments)

  $fullArgs = @()
  if ($Serial) {
    $fullArgs += @("-s", $Serial)
  }
  $fullArgs += $Arguments

  $output = & $AdbPath @fullArgs 2>&1
  $exitCodeVar = Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
  $exitCode = if ($exitCodeVar) { [int]$exitCodeVar.Value } else { 0 }
  [pscustomobject]@{
    Output = (($output | ForEach-Object { "$_" }) -join "`n").Trim()
    ExitCode = $exitCode
  }
}

function Invoke-AdbChecked {
  param([string[]]$Arguments)
  $result = Invoke-Adb -Arguments $Arguments
  if ($result.ExitCode -ne 0) {
    throw "adb failed ($($result.ExitCode)): $($result.Output)"
  }
  return $result
}

function ConvertTo-AndroidShellLiteral {
  param([string]$Value)
  return "'" + ($Value -replace "'", "'\\''") + "'"
}

function Wait-ForRuntime {
  Write-Log "Waiting for adb device"
  $deadline = (Get-Date).AddSeconds($WaitTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $state = Invoke-Adb -Arguments @("get-state")
    if ($state.ExitCode -ne 0 -or $state.Output -ne "device") {
      Start-Sleep -Seconds 2
      continue
    }

    $bootCompleted = (Invoke-Adb -Arguments @("shell", "getprop", "sys.boot_completed")).Output.Replace("`r", "").Trim()
    $serviceList = (Invoke-Adb -Arguments @("shell", "service", "list")).Output
    $activityReady = if ($serviceList) { ([regex]::Matches($serviceList, "activity_task:")).Count } else { 0 }
    $pmCheck = Invoke-Adb -Arguments @("shell", "pm", "path", "android")
    if ($pmCheck.ExitCode -eq 0 -and ($bootCompleted -eq "1" -or $activityReady -gt 0)) {
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "Timed out waiting for Android runtime/package manager after ${WaitTimeoutSeconds}s"
}

function Maybe-ReversePorts {
  if (-not $ReversePorts) {
    return
  }

  foreach ($rawPort in ($ReversePorts -split ",")) {
    $port = $rawPort.Trim()
    if (-not $port) {
      continue
    }
    Write-Log "Reversing tcp:$port"
    Invoke-AdbChecked -Arguments @("reverse", "tcp:$port", "tcp:$port") | Out-Null
  }
}

function Install-Apk {
  Write-Log "Installing debug APK"
  $deadline = (Get-Date).AddSeconds($InstallTimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $result = Invoke-Adb -Arguments @("install", "-r", $ApkPath)
    if ($result.ExitCode -eq 0) {
      return
    }

    if ($result.Output -match "device offline|NullPointerException|freeStorage|Can't find service: package|cmd: Can't find service: package|INSTALL_FAILED_INTERNAL_ERROR") {
      Start-Sleep -Seconds 5
      continue
    }

    throw "APK install failed: $($result.Output)"
  }

  throw "Timed out installing APK after ${InstallTimeoutSeconds}s"
}

function Open-DevClient {
  if (-not $DevClientUrl) {
    return
  }

  Write-Log "Opening dev client URL"
  $command = "am start -W -a android.intent.action.VIEW -d $(ConvertTo-AndroidShellLiteral $DevClientUrl)"
  Invoke-AdbChecked -Arguments @("shell", $command) | Out-Null
  Start-Sleep -Seconds 8
}

Require-CommandOrFile -Value $AdbPath -Label "adb"
if (-not $SkipInstall) {
  Require-File -Path $ApkPath -Label "APK"
}

Wait-ForRuntime
Maybe-ReversePorts
Open-DevClient

if (-not $SkipInstall) {
  Install-Apk
} else {
  Write-Log "Skipping APK install"
}

if (-not $SkipLaunch) {
  if ($DevClientUrl) {
    Write-Log "Skipping initial app launch because DevClientUrl already bootstrapped the dev client"
  } else {
    Write-Log "Launching app"
    Invoke-AdbChecked -Arguments @("shell", "am", "start", "-W", "-n", $AppActivity) | Out-Null
  }
} else {
  Write-Log "Skipping initial app launch"
}

if (-not $SkipDeepLink) {
  Write-Log "Sending deep-link capture"
  $command = "am start -W -a android.intent.action.VIEW -d $(ConvertTo-AndroidShellLiteral $DeepLink) -n $(ConvertTo-AndroidShellLiteral $AppActivity)"
  Invoke-AdbChecked -Arguments @("shell", $command) | Out-Null
} else {
  Write-Log "Skipping deep-link capture"
}

if (-not $SkipTextShare) {
  Write-Log "Sending text share intent"
  $command = @(
    "am start -W -a android.intent.action.SEND -t text/plain",
    "--es android.intent.extra.SUBJECT $(ConvertTo-AndroidShellLiteral $ShareTitle)",
    "--es android.intent.extra.TEXT $(ConvertTo-AndroidShellLiteral $ShareText)",
    "-n $(ConvertTo-AndroidShellLiteral $AppActivity)"
  ) -join " "
  Invoke-AdbChecked -Arguments @("shell", $command) | Out-Null
} else {
  Write-Log "Skipping text share intent"
}

Write-Log "Smoke flow completed. Inspect the device UI to confirm the Starlog quick-capture state."
