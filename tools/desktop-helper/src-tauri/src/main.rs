#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
fn clip_screenshot_stub() -> Result<String, String> {
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
            return Ok(format!("Screenshot captured: {path}"));
        }
        return Err("Screenshot capture was cancelled or failed".to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(format!(
            "Screenshot capture placeholder. Integrate platform screenshot command. Intended path: {path}"
        ))
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![clip_screenshot_stub])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
