#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
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

fn run_tesseract(path: &str) -> Result<String, String> {
    let output = Command::new("tesseract")
        .args([path, "stdout", "-l", "eng"])
        .output()
        .map_err(|error| format!("failed to run tesseract: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "tesseract exited with non-zero status".to_string()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn clip_screenshot_stub() -> Result<ScreenshotClipResult, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("clock error: {error}"))?
        .as_secs();

    let path = format!("/tmp/starlog-screenshot-{now}.png");

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("screencapture")
            .args(["-i", &path])
            .status()
            .map_err(|error| format!("failed to run screencapture: {error}"))?;

        if status.success() {
            let ocr_attempt = run_tesseract(&path);
            let mut message = format!("Screenshot captured: {path}");
            let mut text = None;
            let mut ocr_engine = None;

            if let Ok(extracted) = ocr_attempt {
                if !extracted.is_empty() {
                    message = format!("Screenshot captured + OCR extracted {} chars", extracted.len());
                    text = Some(extracted);
                    ocr_engine = Some("tesseract".to_string());
                }
            }

            return Ok(ScreenshotClipResult {
                status: "captured".to_string(),
                message,
                path: Some(path),
                text,
                ocr_engine,
            });
        }
        return Ok(ScreenshotClipResult {
            status: "cancelled".to_string(),
            message: "Screenshot capture was cancelled or failed".to_string(),
            path: None,
            text: None,
            ocr_engine: None,
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(ScreenshotClipResult {
            status: "placeholder".to_string(),
            message: format!(
                "Screenshot capture placeholder. Integrate platform screenshot command. Intended path: {path}"
            ),
            path: Some(path),
            text: None,
            ocr_engine: None,
        })
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![clip_screenshot_stub])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
