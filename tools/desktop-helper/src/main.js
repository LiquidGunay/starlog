const statusNode = document.getElementById("status");
const apiBaseInput = document.getElementById("apiBase");
const tokenInput = document.getElementById("token");
const clipSelectionButton = document.getElementById("clipSelection");
const clipScreenshotButton = document.getElementById("clipScreenshot");

function setStatus(message) {
  statusNode.textContent = message;
}

function readConfig() {
  return {
    apiBase: apiBaseInput.value.trim(),
    token: tokenInput.value.trim(),
  };
}

async function sendCapture(rawContent, metadata, sourceType = "clip_desktop_helper") {
  const { apiBase, token } = readConfig();

  if (!token) {
    setStatus("Add bearer token first");
    return;
  }

  const response = await fetch(`${apiBase}/v1/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      source_type: sourceType,
      capture_source: "desktop_helper",
      title: "Desktop clip",
      raw: { text: rawContent, mime_type: "text/plain" },
      normalized: { text: rawContent, mime_type: "text/plain" },
      extracted: { text: rawContent, mime_type: "text/plain" },
      metadata,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  setStatus(`Clip saved: ${payload.artifact.id}`);
}

async function clipClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      setStatus("Clipboard is empty");
      return;
    }

    await sendCapture(text, {
      source: "desktop_helper",
      clipped_at: new Date().toISOString(),
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Clipboard clip failed");
  }
}

async function clipScreenshotStub() {
  try {
    const tauriGlobal = window.__TAURI__;
    if (!tauriGlobal) {
      setStatus("Screenshot clip requires Tauri runtime");
      return;
    }

    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("clip_screenshot_stub");
    if (result?.status === "captured" && typeof result.text === "string" && result.text.trim().length > 0) {
      await sendCapture(result.text, {
        source: "desktop_helper",
        screenshot_path: result.path,
        ocr_engine: result.ocr_engine,
        clipped_at: new Date().toISOString(),
      }, "clip_desktop_screenshot");
      return;
    }
    setStatus(typeof result?.message === "string" ? result.message : String(result));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Screenshot stub failed");
  }
}

async function wireGlobalShortcuts() {
  const tauriGlobal = window.__TAURI__;
  if (!tauriGlobal) {
    return;
  }

  const { listen } = await import("@tauri-apps/api/event");
  await listen("starlog://clip-clipboard", () => {
    clipClipboard().catch(() => undefined);
  });
  await listen("starlog://clip-screenshot", () => {
    clipScreenshotStub().catch(() => undefined);
  });
  setStatus("Global shortcuts wired");
}

clipSelectionButton.addEventListener("click", () => {
  clipClipboard().catch(() => undefined);
});

clipScreenshotButton.addEventListener("click", () => {
  clipScreenshotStub().catch(() => undefined);
});

wireGlobalShortcuts().catch(() => undefined);
