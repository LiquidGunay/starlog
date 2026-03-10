#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
struct ScreenshotClipResult {
    status: String,
    message: String,
    path: Option<String>,
    text: Option<String>,
    ocr_engine: Option<String>,
}

#[derive(Serialize)]
struct ActiveWindowContext {
    app_name: Option<String>,
    window_title: Option<String>,
    platform: String,
    backend: Option<String>,
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

#[cfg(target_os = "linux")]
fn linux_command_exists(command: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {command} >/dev/null 2>&1")])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn active_window_context() -> ActiveWindowContext {
    ActiveWindowContext {
        app_name: run_command(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\" to get name of first application process whose frontmost is true",
            ],
        )
        .ok()
        .and_then(non_empty),
        window_title: run_command(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\" to tell (first application process whose frontmost is true) to get name of front window",
            ],
        )
        .ok()
        .and_then(non_empty),
        platform: "macos".to_string(),
        backend: Some("osascript".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn active_window_context() -> ActiveWindowContext {
    let script = r#"
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
$pid = 0;
[void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid);
$app = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName;
Write-Output $app;
Write-Output $builder.ToString();
"#;

    let output = run_command("powershell", &["-NoProfile", "-Command", script]).ok();
    let (app_name, window_title) = if let Some(output) = output {
        let mut lines = output.lines();
        let app_name = lines.next().map(str::to_string).and_then(non_empty);
        let window_title = non_empty(lines.collect::<Vec<_>>().join("\n"));
        (app_name, window_title)
    } else {
        (None, None)
    };

    ActiveWindowContext {
        app_name,
        window_title,
        platform: "windows".to_string(),
        backend: Some("powershell-user32".to_string()),
    }
}

#[cfg(target_os = "linux")]
fn active_window_context() -> ActiveWindowContext {
    if linux_command_exists("xdotool") {
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

    if linux_command_exists("hyprctl") {
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
        return run_command("powershell", &["-NoProfile", "-Command", "Get-Clipboard -Raw"]);
    }

    #[cfg(target_os = "linux")]
    {
        let candidates: [(&str, &[&str]); 3] = [
            ("wl-paste", &["-n"]),
            ("xclip", &["-selection", "clipboard", "-o"]),
            ("xsel", &["--clipboard", "--output"]),
        ];

        for (program, args) in candidates {
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

fn capture_screenshot(path: &Path) -> Result<String, String> {
    let target = path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("screencapture")
            .args(["-i", &target])
            .status()
            .map_err(|error| format!("failed to run screencapture: {error}"))?;
        if status.success() {
            return Ok(format!("Screenshot captured: {target}"));
        }
        return Err("Screenshot capture was cancelled or failed".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let escaped_target = target.replace('\'', "''");
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             Add-Type -AssemblyName System.Drawing; \
             $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen; \
             $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; \
             $graphics = [System.Drawing.Graphics]::FromImage($bitmap); \
             $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); \
             $bitmap.Save('{escaped_target}', [System.Drawing.Imaging.ImageFormat]::Png); \
             $graphics.Dispose(); \
             $bitmap.Dispose();"
        );
        let status = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .status()
            .map_err(|error| format!("failed to run PowerShell screenshot capture: {error}"))?;
        if status.success() {
            return Ok(format!("Full-screen screenshot captured: {target}"));
        }
        return Err("PowerShell screenshot capture failed".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        if linux_command_exists("grim") && linux_command_exists("slurp") {
            let status = Command::new("sh")
                .args(["-c", &format!("grim -g \"$(slurp)\" {}", shell_quote(&target))])
                .status()
                .map_err(|error| format!("failed to run grim/slurp: {error}"))?;
            if status.success() {
                return Ok(format!("Screenshot captured with grim/slurp: {target}"));
            }
            return Err("grim/slurp screenshot capture was cancelled or failed".to_string());
        }

        if linux_command_exists("gnome-screenshot") {
            let status = Command::new("gnome-screenshot")
                .args(["-a", "-f", &target])
                .status()
                .map_err(|error| format!("failed to run gnome-screenshot: {error}"))?;
            if status.success() {
                return Ok(format!("Screenshot captured with gnome-screenshot: {target}"));
            }
            return Err("gnome-screenshot capture was cancelled or failed".to_string());
        }

        if linux_command_exists("import") {
            let status = Command::new("import")
                .arg(&target)
                .status()
                .map_err(|error| format!("failed to run import: {error}"))?;
            if status.success() {
                return Ok(format!("Screenshot captured with import: {target}"));
            }
            return Err("ImageMagick import capture was cancelled or failed".to_string());
        }

        return Err(
            "Screenshot capture requires grim/slurp, gnome-screenshot, or ImageMagick import on Linux"
                .to_string(),
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Screenshot capture is not implemented for this platform".to_string())
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

    match capture_screenshot(&path) {
        Ok(base_message) => {
            if !path.exists() {
                return Ok(ScreenshotClipResult {
                    status: "cancelled".to_string(),
                    message: "Screenshot capture was cancelled or failed".to_string(),
                    path: None,
                    text: None,
                    ocr_engine: None,
                });
            }

            let ocr_attempt = run_tesseract(&path_label);
            let mut message = base_message;
            let mut text = None;
            let mut ocr_engine = None;

            if let Ok(extracted) = ocr_attempt {
                if !extracted.is_empty() {
                    message = format!("{} + OCR extracted {} chars", message, extracted.len());
                    text = Some(extracted);
                    ocr_engine = Some("tesseract".to_string());
                }
            }

            Ok(ScreenshotClipResult {
                status: "captured".to_string(),
                message,
                path: Some(path_label),
                text,
                ocr_engine,
            })
        }
        Err(message) => Ok(ScreenshotClipResult {
            status: "cancelled".to_string(),
            message,
            path: Some(path_label),
            text: None,
            ocr_engine: None,
        }),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            clip_clipboard_text,
            clip_active_window_context,
            read_file_base64,
            clip_screenshot_stub
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
