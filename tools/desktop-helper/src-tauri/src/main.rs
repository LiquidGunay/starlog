#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Serialize;
use std::env;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, PartialEq, Eq, Serialize)]
struct ScreenshotClipResult {
    status: String,
    message: String,
    path: Option<String>,
    text: Option<String>,
    ocr_engine: Option<String>,
    backend: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct ActiveWindowContext {
    app_name: Option<String>,
    window_title: Option<String>,
    platform: String,
    backend: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct RuntimeCapability {
    status: String,
    detail: String,
    preferred_backend: Option<String>,
    available_backends: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct RuntimeDiagnostics {
    runtime: String,
    platform: String,
    clipboard: RuntimeCapability,
    screenshot: RuntimeCapability,
    active_window: RuntimeCapability,
    ocr: RuntimeCapability,
}

#[derive(Debug, PartialEq, Eq)]
struct ScreenshotCaptureAttempt {
    status: &'static str,
    message: String,
    backend: Option<&'static str>,
}

fn captured_screenshot_attempt(message: impl Into<String>, backend: &'static str) -> ScreenshotCaptureAttempt {
    ScreenshotCaptureAttempt {
        status: "captured",
        message: message.into(),
        backend: Some(backend),
    }
}

fn cancelled_screenshot_attempt(message: impl Into<String>, backend: &'static str) -> ScreenshotCaptureAttempt {
    ScreenshotCaptureAttempt {
        status: "cancelled",
        message: message.into(),
        backend: Some(backend),
    }
}

fn failed_screenshot_attempt(
    message: impl Into<String>,
    backend: Option<&'static str>,
) -> ScreenshotCaptureAttempt {
    ScreenshotCaptureAttempt {
        status: "failed",
        message: message.into(),
        backend,
    }
}

fn run_command(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("failed to run {program}: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if stderr.is_empty() {
            if stdout.is_empty() {
                format!("{program} exited with non-zero status")
            } else {
                stdout
            }
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end_matches(|character| character == '\r' || character == '\n')
        .to_string())
}

fn run_tesseract(path: &str) -> Result<String, String> {
    run_command("tesseract", &[path, "stdout", "-l", "eng"])
}

fn temp_screenshot_path(now: u64) -> PathBuf {
    env::temp_dir().join(format!("starlog-screenshot-{now}.png"))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn extract_json_string_field(body: &str, field: &str) -> Option<String> {
    let marker = format!("\"{field}\":\"");
    let start = body.find(&marker)? + marker.len();
    let mut escaped = false;
    let mut output = String::new();

    for ch in body[start..].chars() {
        if escaped {
            output.push(match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' => '"',
                '\\' => '\\',
                other => other,
            });
            escaped = false;
            continue;
        }

        match ch {
            '\\' => escaped = true,
            '"' => return non_empty(output),
            other => output.push(other),
        }
    }

    None
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn command_exists(command: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {command} >/dev/null 2>&1")])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn command_exists(command: &str) -> bool {
    Command::new("where")
        .arg(command)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn command_exists(command: &str) -> bool {
    let _ = command;
    false
}

fn format_backend_list(backends: &[String]) -> String {
    backends.join(", ")
}

fn capability(
    status: &str,
    detail: impl Into<String>,
    preferred_backend: Option<&str>,
    available_backends: Vec<String>,
) -> RuntimeCapability {
    RuntimeCapability {
        status: status.to_string(),
        detail: detail.into(),
        preferred_backend: preferred_backend.map(str::to_string),
        available_backends,
    }
}

fn ocr_runtime_capability() -> RuntimeCapability {
    if command_exists("tesseract") {
        capability(
            "available",
            "OCR is ready via the local tesseract binary.",
            Some("tesseract"),
            vec!["tesseract".to_string()],
        )
    } else {
        capability(
            "degraded",
            "OCR is unavailable until tesseract is installed locally.",
            None,
            Vec::new(),
        )
    }
}

#[cfg(any(target_os = "windows", test))]
fn actionable_windows_error(operation: &str, detail: &str) -> String {
    let normalized = detail.trim();
    if normalized.is_empty() {
        return format!("{operation} failed on Windows.");
    }

    if normalized.contains("failed to run powershell") {
        return format!(
            "{operation} requires PowerShell on Windows and the helper could not launch it. Detail: {normalized}"
        );
    }

    if normalized.contains("CopyFromScreen")
        || normalized.contains("The handle is invalid")
        || normalized.contains("The parameter is not valid")
        || normalized.contains("A generic error occurred in GDI+")
    {
        return format!(
            "{operation} requires an unlocked interactive Windows desktop session. Detail: {normalized}"
        );
    }

    if normalized.contains("GetForegroundWindow")
        || normalized.contains("GetWindowThreadProcessId")
        || normalized.contains("GetWindowText")
        || normalized.contains("Cannot overwrite variable PID")
    {
        return format!(
            "{operation} requires an unlocked interactive Windows desktop session with a focused foreground window. Detail: {normalized}"
        );
    }

    format!("{operation} failed on Windows. Detail: {normalized}")
}

#[cfg(any(target_os = "macos", test))]
fn actionable_macos_error(operation: &str, detail: &str) -> String {
    let normalized = detail.trim();
    if normalized.is_empty() {
        return format!("{operation} failed on macOS.");
    }

    let lower = normalized.to_lowercase();
    if lower.contains("not authorized to send apple events")
        || (lower.contains("system events") && lower.contains("not authorized"))
    {
        return format!(
            "{operation} requires macOS Automation permission for System Events. \
             Allow the helper under System Settings -> Privacy & Security -> Automation. Detail: {normalized}"
        );
    }

    if lower.contains("not allowed assistive access")
        || lower.contains("assistive access")
        || lower.contains("accessibility")
    {
        return format!(
            "{operation} requires macOS Accessibility permission. \
             Allow the helper under System Settings -> Privacy & Security -> Accessibility. Detail: {normalized}"
        );
    }

    if lower.contains("operation not permitted")
        || lower.contains("screen recording")
        || lower.contains("cannot capture screen")
        || lower.contains("failed to capture")
    {
        return format!(
            "{operation} requires macOS Screen Recording permission. \
             Allow the helper under System Settings -> Privacy & Security -> Screen Recording. Detail: {normalized}"
        );
    }

    format!("{operation} failed on macOS. Detail: {normalized}")
}

#[cfg(any(target_os = "windows", test))]
fn windows_active_window_script() -> &'static str {
    r#"
$signature = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@;
Add-Type $signature;
$hwnd = [Win32]::GetForegroundWindow();
$builder = New-Object System.Text.StringBuilder 1024;
[void][Win32]::GetWindowText($hwnd, $builder, $builder.Capacity);
$processIdValue = 0;
[void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$processIdValue);
$app = (Get-Process -Id $processIdValue -ErrorAction SilentlyContinue).ProcessName;
Write-Output $app;
Write-Output $builder.ToString();
"#
}

#[cfg(any(target_os = "windows", test))]
fn windows_screenshot_script(target: &str) -> String {
    let escaped_target = target.replace('\'', "''");
    format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         Add-Type -AssemblyName System.Drawing; \
         $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen; \
         $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; \
         $graphics = [System.Drawing.Graphics]::FromImage($bitmap); \
         $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); \
         $bitmap.Save('{escaped_target}', [System.Drawing.Imaging.ImageFormat]::Png); \
         $graphics.Dispose(); \
         $bitmap.Dispose();"
    )
}

#[cfg(target_os = "windows")]
fn windows_active_window_probe() -> Result<(Option<String>, Option<String>), String> {
    let output = run_command(
        "powershell",
        &["-NoProfile", "-Command", windows_active_window_script()],
    )
    .map_err(|error| actionable_windows_error("Active window metadata", &error))?;
    let mut lines = output.lines();
    let app_name = lines.next().map(str::to_string).and_then(non_empty);
    let window_title = non_empty(lines.collect::<Vec<_>>().join("\n"));
    Ok((app_name, window_title))
}

#[cfg(target_os = "linux")]
fn linux_wayland_session() -> bool {
    matches!(
        env::var("XDG_SESSION_TYPE").ok().as_deref(),
        Some("wayland")
    ) || env::var_os("WAYLAND_DISPLAY").is_some()
}

#[cfg(target_os = "linux")]
fn linux_x11_session() -> bool {
    matches!(env::var("XDG_SESSION_TYPE").ok().as_deref(), Some("x11"))
        || env::var_os("DISPLAY").is_some()
}

#[cfg(target_os = "linux")]
fn linux_clipboard_runtime_capability(
    wayland_session: bool,
    x11_session: bool,
    has_wl_paste: bool,
    has_xclip: bool,
    has_xsel: bool,
) -> RuntimeCapability {
    let mut available_backends = Vec::new();
    if has_wl_paste {
        available_backends.push("wl-paste".to_string());
    }
    if has_xclip {
        available_backends.push("xclip".to_string());
    }
    if has_xsel {
        available_backends.push("xsel".to_string());
    }

    let preferred_backend = if wayland_session && has_wl_paste {
        Some("wl-paste")
    } else if has_xclip {
        Some("xclip")
    } else if has_xsel {
        Some("xsel")
    } else if has_wl_paste {
        Some("wl-paste")
    } else {
        None
    };

    if let Some(preferred_backend) = preferred_backend {
        let detail = if available_backends.len() == 1 {
            format!("Clipboard capture is ready via {preferred_backend}.")
        } else {
            format!(
                "Clipboard capture is ready. Available backends: {}. The helper prefers {preferred_backend}.",
                format_backend_list(&available_backends),
            )
        };
        return capability(
            "available",
            detail,
            Some(preferred_backend),
            available_backends,
        );
    }

    let detail = if wayland_session {
        "Clipboard capture requires wl-paste (wl-clipboard), xclip, or xsel on Linux."
    } else if x11_session {
        "Clipboard capture requires xclip or xsel on Linux."
    } else {
        "Clipboard capture requires wl-paste, xclip, or xsel on Linux."
    };
    capability("unavailable", detail, None, available_backends)
}

#[cfg(target_os = "linux")]
fn linux_screenshot_runtime_capability(
    wayland_session: bool,
    x11_session: bool,
    has_grim: bool,
    has_slurp: bool,
    has_gnome_screenshot: bool,
    has_import: bool,
    has_scrot: bool,
) -> RuntimeCapability {
    let mut available_backends = Vec::new();
    if has_grim && has_slurp {
        available_backends.push("grim+slurp".to_string());
    }
    if has_gnome_screenshot {
        available_backends.push("gnome-screenshot".to_string());
    }
    if has_import {
        available_backends.push("imagemagick-import".to_string());
    }
    if has_grim {
        available_backends.push("grim".to_string());
    }
    if has_scrot {
        available_backends.push("scrot".to_string());
    }

    let preferred_backend = if has_grim && has_slurp {
        Some("grim+slurp")
    } else if has_gnome_screenshot {
        Some("gnome-screenshot")
    } else if has_import {
        Some("imagemagick-import")
    } else if has_grim {
        Some("grim")
    } else if has_scrot {
        Some("scrot")
    } else {
        None
    };

    if let Some(preferred_backend) = preferred_backend {
        let detail = match preferred_backend {
            "grim" => {
                "Full-screen screenshot fallback is ready via grim. Install slurp to restore region picking."
                    .to_string()
            }
            "scrot" => "Full-screen screenshot fallback is ready via scrot.".to_string(),
            _ if available_backends.len() == 1 => {
                format!("Screenshot capture is ready via {preferred_backend}.")
            }
            _ => format!(
                "Screenshot capture is ready. Available backends: {}. The helper prefers {preferred_backend}.",
                format_backend_list(&available_backends),
            ),
        };
        return capability(
            "available",
            detail,
            Some(preferred_backend),
            available_backends,
        );
    }

    let detail = if wayland_session {
        "Screenshot capture requires grim+slurp, gnome-screenshot, ImageMagick import, or grim on Linux."
    } else if x11_session {
        "Screenshot capture requires gnome-screenshot, ImageMagick import, or scrot on Linux."
    } else {
        "Screenshot capture requires grim+slurp, gnome-screenshot, ImageMagick import, grim, or scrot on Linux."
    };
    capability("unavailable", detail, None, available_backends)
}

#[cfg(target_os = "linux")]
fn linux_active_window_runtime_capability() -> RuntimeCapability {
    let mut available_backends = Vec::new();
    if command_exists("hyprctl") {
        available_backends.push("hyprctl".to_string());
    }
    if command_exists("xdotool") {
        available_backends.push("xdotool".to_string());
    }

    let preferred_backend = if linux_wayland_session() && command_exists("hyprctl") {
        Some("hyprctl")
    } else if command_exists("xdotool") {
        Some("xdotool")
    } else if command_exists("hyprctl") {
        Some("hyprctl")
    } else {
        None
    };

    if let Some(preferred_backend) = preferred_backend {
        let detail = if available_backends.len() == 1 {
            format!("Active window metadata is ready via {preferred_backend}.")
        } else {
            format!(
                "Active window metadata is ready. Available backends: {}. The helper prefers {preferred_backend}.",
                format_backend_list(&available_backends),
            )
        };
        return capability(
            "available",
            detail,
            Some(preferred_backend),
            available_backends,
        );
    }

    let detail = if linux_wayland_session() {
        "Active window metadata is best-effort only until a Wayland-compatible backend such as hyprctl is available."
    } else {
        "Active window metadata is best-effort only until xdotool is available."
    };
    capability("degraded", detail, None, available_backends)
}

#[cfg(target_os = "macos")]
fn macos_active_window_probe() -> Result<(Option<String>, Option<String>), String> {
    let app_name = run_command(
        "osascript",
        &[
            "-e",
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        ],
    )
    .map_err(|error| actionable_macos_error("Active window metadata", &error))
    .map(non_empty)?;

    let window_title = match run_command(
        "osascript",
        &[
            "-e",
            "tell application \"System Events\" to tell (first application process whose frontmost is true) to get name of front window",
        ],
    )
    {
        Ok(value) => non_empty(value),
        Err(error) => {
            let lower = error.to_lowercase();
            if lower.contains("can't get window")
                || lower.contains("can't get name of front window")
                || lower.contains("invalid index")
            {
                None
            } else {
                return Err(actionable_macos_error("Active window metadata", &error));
            }
        }
    };

    if app_name.is_none() && window_title.is_none() {
        return Err(
            "Active window metadata probe returned no app/window values. \
             Keep a normal app window focused and confirm Automation/Accessibility permissions for the helper."
                .to_string(),
        );
    }

    Ok((app_name, window_title))
}

#[cfg(target_os = "macos")]
fn runtime_diagnostics() -> RuntimeDiagnostics {
    let active_window_capability = if command_exists("osascript") {
        match macos_active_window_probe() {
            Ok((app_name, window_title)) => {
                let mut detail = "Active window metadata is ready via osascript.".to_string();
                if app_name.is_some() || window_title.is_some() {
                    let app = app_name.unwrap_or_else(|| "Unknown app".to_string());
                    let window = window_title.unwrap_or_else(|| "Unknown window".to_string());
                    detail = format!("Active window metadata is ready via osascript. Probe saw: {app} / {window}.");
                }
                capability(
                    "available",
                    detail,
                    Some("osascript"),
                    vec!["osascript".to_string()],
                )
            }
            Err(error) => capability(
                "degraded",
                error,
                Some("osascript"),
                vec!["osascript".to_string()],
            ),
        }
    } else {
        capability(
            "degraded",
            "Active window metadata is best-effort only until osascript is available.",
            None,
            Vec::new(),
        )
    };

    RuntimeDiagnostics {
        runtime: "tauri".to_string(),
        platform: "macos".to_string(),
        clipboard: if command_exists("pbpaste") {
            capability(
                "available",
                "Clipboard capture is ready via pbpaste. If reads fail, grant clipboard access prompt for the helper.",
                Some("pbpaste"),
                vec!["pbpaste".to_string()],
            )
        } else {
            capability(
                "unavailable",
                "Clipboard capture requires pbpaste on macOS.",
                None,
                Vec::new(),
            )
        },
        screenshot: if command_exists("screencapture") {
            capability(
                "available",
                "Interactive screenshot capture is ready via screencapture. \
                 macOS Screen Recording permission is required if captures keep failing.",
                Some("screencapture"),
                vec!["screencapture".to_string()],
            )
        } else {
            capability(
                "unavailable",
                "Screenshot capture requires screencapture on macOS.",
                None,
                Vec::new(),
            )
        },
        active_window: active_window_capability,
        ocr: ocr_runtime_capability(),
    }
}

#[cfg(target_os = "windows")]
fn runtime_diagnostics() -> RuntimeDiagnostics {
    RuntimeDiagnostics {
        runtime: "tauri".to_string(),
        platform: "windows".to_string(),
        clipboard: if command_exists("powershell") {
            capability(
                "available",
                "Clipboard capture is ready via PowerShell Get-Clipboard on the Windows host.",
                Some("powershell"),
                vec!["powershell".to_string()],
            )
        } else {
            capability(
                "unavailable",
                "Clipboard capture requires PowerShell on Windows.",
                None,
                Vec::new(),
            )
        },
        screenshot: if command_exists("powershell") {
            capability(
                "available",
                "Full-screen screenshot capture is ready via PowerShell when the helper runs in an interactive Windows desktop session.",
                Some("powershell"),
                vec!["powershell".to_string()],
            )
        } else {
            capability(
                "unavailable",
                "Screenshot capture requires PowerShell and an interactive desktop session on Windows.",
                None,
                Vec::new(),
            )
        },
        active_window: if command_exists("powershell") {
            match windows_active_window_probe() {
                Ok((app_name, window_title)) if app_name.is_some() || window_title.is_some() => capability(
                    "available",
                    "Active window metadata is ready via the PowerShell user32 bridge.",
                    Some("powershell-user32"),
                    vec!["powershell-user32".to_string()],
                ),
                Ok(_) => capability(
                    "degraded",
                    "Active window metadata probe ran but did not return a focused app/window. Keep an unlocked Windows window focused when validating.",
                    Some("powershell-user32"),
                    vec!["powershell-user32".to_string()],
                ),
                Err(error) => capability(
                    "degraded",
                    error,
                    Some("powershell-user32"),
                    vec!["powershell-user32".to_string()],
                ),
            }
        } else {
            capability(
                "degraded",
                "Active window metadata is best-effort only until PowerShell is available.",
                None,
                Vec::new(),
            )
        },
        ocr: ocr_runtime_capability(),
    }
}

#[cfg(target_os = "linux")]
fn runtime_diagnostics() -> RuntimeDiagnostics {
    let wayland_session = linux_wayland_session();
    let x11_session = linux_x11_session();
    let has_wl_paste = command_exists("wl-paste");
    let has_xclip = command_exists("xclip");
    let has_xsel = command_exists("xsel");
    let has_grim = command_exists("grim");
    let has_slurp = command_exists("slurp");
    let has_gnome_screenshot = command_exists("gnome-screenshot");
    let has_import = command_exists("import");
    let has_scrot = command_exists("scrot");

    RuntimeDiagnostics {
        runtime: "tauri".to_string(),
        platform: "linux".to_string(),
        clipboard: linux_clipboard_runtime_capability(
            wayland_session,
            x11_session,
            has_wl_paste,
            has_xclip,
            has_xsel,
        ),
        screenshot: linux_screenshot_runtime_capability(
            wayland_session,
            x11_session,
            has_grim,
            has_slurp,
            has_gnome_screenshot,
            has_import,
            has_scrot,
        ),
        active_window: linux_active_window_runtime_capability(),
        ocr: ocr_runtime_capability(),
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn runtime_diagnostics() -> RuntimeDiagnostics {
    RuntimeDiagnostics {
        runtime: "tauri".to_string(),
        platform: env::consts::OS.to_string(),
        clipboard: capability(
            "unavailable",
            "Clipboard capture is not implemented for this platform.",
            None,
            Vec::new(),
        ),
        screenshot: capability(
            "unavailable",
            "Screenshot capture is not implemented for this platform.",
            None,
            Vec::new(),
        ),
        active_window: capability(
            "degraded",
            "Active window metadata is not implemented for this platform.",
            None,
            Vec::new(),
        ),
        ocr: ocr_runtime_capability(),
    }
}

#[cfg(target_os = "macos")]
fn active_window_context() -> ActiveWindowContext {
    match macos_active_window_probe() {
        Ok((app_name, window_title)) => ActiveWindowContext {
            app_name,
            window_title,
            platform: "macos".to_string(),
            backend: Some("osascript".to_string()),
        },
        Err(_) => ActiveWindowContext {
            app_name: None,
            window_title: None,
            platform: "macos".to_string(),
            backend: Some("osascript-error".to_string()),
        },
    }
}

#[cfg(target_os = "windows")]
fn active_window_context() -> ActiveWindowContext {
    let (app_name, window_title, backend) = match windows_active_window_probe() {
        Ok((app_name, window_title)) => (
            app_name,
            window_title,
            Some("powershell-user32".to_string()),
        ),
        Err(_) => (None, None, Some("powershell-user32-error".to_string())),
    };

    ActiveWindowContext {
        app_name,
        window_title,
        platform: "windows".to_string(),
        backend,
    }
}

#[cfg(target_os = "linux")]
fn active_window_context() -> ActiveWindowContext {
    let prefer_hyprctl = linux_wayland_session() && command_exists("hyprctl");

    if prefer_hyprctl {
        if let Ok(output) = run_command("hyprctl", &["activewindow", "-j"]) {
            let app_name = extract_json_string_field(&output, "class");
            let window_title = extract_json_string_field(&output, "title");
            if app_name.is_some() || window_title.is_some() {
                return ActiveWindowContext {
                    app_name,
                    window_title,
                    platform: "linux".to_string(),
                    backend: Some("hyprctl".to_string()),
                };
            }
        }
    }

    if command_exists("xdotool") {
        let window_title = run_command("xdotool", &["getwindowfocus", "getwindowname"])
            .ok()
            .and_then(non_empty);
        let app_name = run_command("xdotool", &["getwindowfocus", "getwindowpid"])
            .ok()
            .and_then(non_empty)
            .and_then(|pid| run_command("ps", &["-p", pid.trim(), "-o", "comm="]).ok())
            .and_then(non_empty);
        if app_name.is_some() || window_title.is_some() {
            return ActiveWindowContext {
                app_name,
                window_title,
                platform: "linux".to_string(),
                backend: Some("xdotool".to_string()),
            };
        }
    }

    if command_exists("hyprctl") {
        if let Ok(output) = run_command("hyprctl", &["activewindow", "-j"]) {
            let app_name = extract_json_string_field(&output, "class");
            let window_title = extract_json_string_field(&output, "title");
            if app_name.is_some() || window_title.is_some() {
                return ActiveWindowContext {
                    app_name,
                    window_title,
                    platform: "linux".to_string(),
                    backend: Some("hyprctl".to_string()),
                };
            }
        }
    }

    ActiveWindowContext {
        app_name: None,
        window_title: None,
        platform: "linux".to_string(),
        backend: None,
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn active_window_context() -> ActiveWindowContext {
    ActiveWindowContext {
        app_name: None,
        window_title: None,
        platform: env::consts::OS.to_string(),
        backend: None,
    }
}

#[tauri::command]
fn clip_clipboard_text() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        return run_command("pbpaste", &[]);
    }

    #[cfg(target_os = "windows")]
    {
        return run_command(
            "powershell",
            &["-NoProfile", "-Command", "Get-Clipboard -Raw"],
        )
        .map_err(|error| actionable_windows_error("Clipboard capture", &error));
    }

    #[cfg(target_os = "linux")]
    {
        let mut candidates: Vec<(&str, &[&str])> = if linux_wayland_session() {
            vec![
                ("wl-paste", &["-n"]),
                ("xclip", &["-selection", "clipboard", "-o"]),
                ("xsel", &["--clipboard", "--output"]),
            ]
        } else {
            vec![
                ("xclip", &["-selection", "clipboard", "-o"]),
                ("xsel", &["--clipboard", "--output"]),
                ("wl-paste", &["-n"]),
            ]
        };

        for (program, args) in candidates.drain(..) {
            if let Ok(text) = run_command(program, args) {
                return Ok(text);
            }
        }

        return Err("Clipboard capture requires wl-paste, xclip, or xsel on Linux".to_string());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Clipboard capture is not implemented for this platform".to_string())
    }
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|error| format!("failed to read {path}: {error}"))?;
    Ok(BASE64_STANDARD.encode(bytes))
}

#[tauri::command]
fn clip_active_window_context() -> ActiveWindowContext {
    active_window_context()
}

#[tauri::command]
fn inspect_runtime_diagnostics() -> RuntimeDiagnostics {
    runtime_diagnostics()
}

#[tauri::command]
fn delete_file_if_exists(path: String) -> Result<(), String> {
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to remove {path}: {error}")),
    }
}

fn capture_screenshot(path: &Path) -> ScreenshotCaptureAttempt {
    let target = path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("screencapture")
            .args(["-i", &target])
            .output()
            .map_err(|error| format!("failed to run screencapture: {error}"));
        return match output {
            Ok(output) if output.status.success() => {
                captured_screenshot_attempt(format!("Screenshot captured: {target}"), "screencapture")
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let detail = if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    String::new()
                };
                let lower = detail.to_lowercase();
                if lower.contains("cancel")
                    || lower.contains("user canceled")
                    || detail.is_empty()
                {
                    cancelled_screenshot_attempt(
                        "Screenshot capture was cancelled or failed",
                        "screencapture",
                    )
                } else {
                    failed_screenshot_attempt(
                        actionable_macos_error("Screenshot capture", &detail),
                        Some("screencapture"),
                    )
                }
            }
            Err(error) => failed_screenshot_attempt(
                actionable_macos_error("Screenshot capture", &error),
                Some("screencapture"),
            ),
        };
    }

    #[cfg(target_os = "windows")]
    {
        let script = windows_screenshot_script(&target);
        return match run_command("powershell", &["-NoProfile", "-Command", &script]) {
            Ok(_) => captured_screenshot_attempt(
                format!("Full-screen screenshot captured: {target}"),
                "powershell",
            ),
            Err(error) => failed_screenshot_attempt(
                actionable_windows_error("Screenshot capture", &error),
                Some("powershell"),
            ),
        };
    }

    #[cfg(target_os = "linux")]
    {
        if command_exists("grim") && command_exists("slurp") {
            let status = Command::new("sh")
                .args([
                    "-c",
                    &format!("grim -g \"$(slurp)\" {}", shell_quote(&target)),
                ])
                .status()
                .map_err(|error| format!("failed to run grim/slurp: {error}"));
            return match status {
                Ok(status) if status.success() => captured_screenshot_attempt(
                    format!("Screenshot captured with grim/slurp: {target}"),
                    "grim+slurp",
                ),
                Ok(_) => cancelled_screenshot_attempt(
                    "grim/slurp screenshot capture was cancelled or failed",
                    "grim+slurp",
                ),
                Err(error) => failed_screenshot_attempt(error, Some("grim+slurp")),
            };
        }

        if command_exists("gnome-screenshot") {
            let status = Command::new("gnome-screenshot")
                .args(["-a", "-f", &target])
                .status()
                .map_err(|error| format!("failed to run gnome-screenshot: {error}"));
            return match status {
                Ok(status) if status.success() => captured_screenshot_attempt(
                    format!("Screenshot captured with gnome-screenshot: {target}"),
                    "gnome-screenshot",
                ),
                Ok(_) => cancelled_screenshot_attempt(
                    "gnome-screenshot capture was cancelled or failed",
                    "gnome-screenshot",
                ),
                Err(error) => failed_screenshot_attempt(error, Some("gnome-screenshot")),
            };
        }

        if command_exists("import") {
            let status = Command::new("import")
                .arg(&target)
                .status()
                .map_err(|error| format!("failed to run import: {error}"));
            return match status {
                Ok(status) if status.success() => captured_screenshot_attempt(
                    format!("Screenshot captured with import: {target}"),
                    "imagemagick-import",
                ),
                Ok(_) => cancelled_screenshot_attempt(
                    "ImageMagick import capture was cancelled or failed",
                    "imagemagick-import",
                ),
                Err(error) => failed_screenshot_attempt(error, Some("imagemagick-import")),
            };
        }

        if command_exists("grim") {
            let status = Command::new("grim")
                .arg(&target)
                .status()
                .map_err(|error| format!("failed to run grim: {error}"));
            return match status {
                Ok(status) if status.success() => captured_screenshot_attempt(
                    format!("Full-screen screenshot captured with grim: {target}"),
                    "grim",
                ),
                Ok(_) => failed_screenshot_attempt("grim full-screen screenshot failed", Some("grim")),
                Err(error) => failed_screenshot_attempt(error, Some("grim")),
            };
        }

        if command_exists("scrot") {
            let status = Command::new("scrot")
                .arg(&target)
                .status()
                .map_err(|error| format!("failed to run scrot: {error}"));
            return match status {
                Ok(status) if status.success() => captured_screenshot_attempt(
                    format!("Full-screen screenshot captured with scrot: {target}"),
                    "scrot",
                ),
                Ok(_) => failed_screenshot_attempt("scrot screenshot capture failed", Some("scrot")),
                Err(error) => failed_screenshot_attempt(error, Some("scrot")),
            };
        }

        return failed_screenshot_attempt(
            "Screenshot capture requires grim/slurp, gnome-screenshot, ImageMagick import, grim, or scrot on Linux"
                .to_string(),
            None,
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        failed_screenshot_attempt(
            "Screenshot capture is not implemented for this platform",
            None,
        )
    }
}

#[tauri::command]
fn clip_screenshot_stub() -> Result<ScreenshotClipResult, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("clock error: {error}"))?
        .as_secs();
    let path = temp_screenshot_path(now);
    let path_label = path.to_string_lossy().to_string();

    let capture = capture_screenshot(&path);
    if capture.status == "captured" {
        if !path.exists() {
            return Ok(ScreenshotClipResult {
                status: "failed".to_string(),
                message: "Screenshot capture did not produce a file".to_string(),
                path: None,
                text: None,
                ocr_engine: None,
                backend: capture.backend.map(str::to_string),
            });
        }

        let ocr_attempt = run_tesseract(&path_label);
        let mut message = capture.message;
        let mut text = None;
        let mut ocr_engine = None;

        if let Ok(extracted) = ocr_attempt {
            if !extracted.is_empty() {
                message = format!("{} + OCR extracted {} chars", message, extracted.len());
                text = Some(extracted);
                ocr_engine = Some("tesseract".to_string());
            }
        }

        return Ok(ScreenshotClipResult {
            status: "captured".to_string(),
            message,
            path: Some(path_label),
            text,
            ocr_engine,
            backend: capture.backend.map(str::to_string),
        });
    }

    Ok(ScreenshotClipResult {
        status: capture.status.to_string(),
        message: capture.message,
        path: Some(path_label),
        text: None,
        ocr_engine: None,
        backend: capture.backend.map(str::to_string),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            clip_clipboard_text,
            clip_active_window_context,
            inspect_runtime_diagnostics,
            read_file_base64,
            delete_file_if_exists,
            clip_screenshot_stub
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_clipboard_prefers_wayland_backend_when_available() {
        let capability = linux_clipboard_runtime_capability(true, false, true, true, false);

        assert_eq!(capability.status, "available");
        assert_eq!(capability.preferred_backend.as_deref(), Some("wl-paste"));
        assert_eq!(
            capability.available_backends,
            vec!["wl-paste".to_string(), "xclip".to_string()]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_screenshot_uses_full_screen_fallback_when_only_grim_exists() {
        let capability =
            linux_screenshot_runtime_capability(true, false, true, false, false, false, false);

        assert_eq!(capability.status, "available");
        assert_eq!(capability.preferred_backend.as_deref(), Some("grim"));
        assert!(capability
            .detail
            .contains("Full-screen screenshot fallback"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_screenshot_requires_tools_when_no_backend_exists() {
        let capability =
            linux_screenshot_runtime_capability(false, true, false, false, false, false, false);

        assert_eq!(capability.status, "unavailable");
        assert_eq!(capability.preferred_backend, None);
        assert!(capability.detail.contains("gnome-screenshot"));
    }

    #[test]
    fn windows_active_window_script_uses_process_id_variable() {
        let script = windows_active_window_script();

        assert!(script.contains("$processIdValue = 0;"));
        assert!(!script.contains("$pid = 0;"));
    }

    #[test]
    fn actionable_windows_error_flags_interactive_session_requirement() {
        let detail = actionable_windows_error(
            "Screenshot capture",
            "Exception calling \"CopyFromScreen\" with \"3\" argument(s): \"The handle is invalid.\"",
        );

        assert!(detail.contains("interactive Windows desktop session"));
    }

    #[test]
    fn actionable_windows_error_flags_foreground_window_requirement() {
        let detail = actionable_windows_error(
            "Active window metadata",
            "Cannot overwrite variable PID because it is read-only or constant.",
        );

        assert!(detail.contains("focused foreground window"));
    }

    #[test]
    fn actionable_macos_error_flags_automation_permission_requirement() {
        let detail = actionable_macos_error(
            "Active window metadata",
            "System Events got an error: Not authorized to send Apple events to System Events.",
        );

        assert!(detail.contains("Automation permission"));
    }

    #[test]
    fn actionable_macos_error_flags_screen_recording_permission_requirement() {
        let detail = actionable_macos_error(
            "Screenshot capture",
            "screencapture: cannot capture screen while operation not permitted",
        );

        assert!(detail.contains("Screen Recording permission"));
    }

    #[test]
    fn windows_screenshot_script_escapes_single_quotes() {
        let script =
            windows_screenshot_script("C:\\Users\\bossg\\AppData\\Local\\Temp\\starlog'shot.png");

        assert!(script.contains("starlog''shot.png"));
    }
}
