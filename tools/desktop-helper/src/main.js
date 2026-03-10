const statusNode = document.getElementById("status");
const apiBaseInput = document.getElementById("apiBase");
const tokenInput = document.getElementById("token");
const clipSelectionButton = document.getElementById("clipSelection");
const clipScreenshotButton = document.getElementById("clipScreenshot");
const recentCapturesNode = document.getElementById("recentCaptures");
const CONFIG_STORAGE_KEY = "starlog.desktop-helper.config.v1";
const RECENT_CAPTURE_STORAGE_KEY = "starlog.desktop-helper.recent-captures.v1";
const DEFAULT_API_BASE = "http://localhost:8000";
const MAX_RECENT_CAPTURES = 6;
const SCREENSHOT_PREVIEW_MAX_DIMENSION = 320;
const GLOBAL_SHORTCUTS = [
  {
    accelerator: "CommandOrControl+Shift+C",
    handler: () => clipClipboard().catch(() => undefined),
  },
  {
    accelerator: "CommandOrControl+Shift+S",
    handler: () => clipScreenshot().catch(() => undefined),
  },
];

function setStatus(message) {
  statusNode.textContent = message;
}

function clipSummary(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}

function dataUrlFromBase64(base64, mimeType) {
  return `data:${mimeType};base64,${base64}`;
}

async function createScreenshotPreviewDataUrl(base64, mimeType) {
  const sourceDataUrl = dataUrlFromBase64(base64, mimeType);
  const image = new Image();
  image.decoding = "async";

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = sourceDataUrl;
  }).catch(() => undefined);

  if (!image.naturalWidth || !image.naturalHeight) {
    return sourceDataUrl;
  }

  const scale = Math.min(
    1,
    SCREENSHOT_PREVIEW_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    return sourceDataUrl;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function readStoredConfig() {
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function readStoredRecentCaptures() {
  try {
    const raw = window.localStorage.getItem(RECENT_CAPTURE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function applyStoredConfig(config) {
  apiBaseInput.value = typeof config?.apiBase === "string" && config.apiBase.trim()
    ? config.apiBase
    : DEFAULT_API_BASE;
  tokenInput.value = typeof config?.token === "string" ? config.token : "";
}

function readConfig() {
  return {
    apiBase: apiBaseInput.value.trim() || DEFAULT_API_BASE,
    token: tokenInput.value.trim(),
  };
}

function persistConfig() {
  window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(readConfig()));
}

function formatCapturedAt(value) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

function renderRecentCaptures(entries) {
  recentCapturesNode.replaceChildren();
  if (entries.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "help";
    emptyState.textContent = "No captures yet.";
    recentCapturesNode.appendChild(emptyState);
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "recent-card";

    const title = document.createElement("p");
    title.className = "recent-title";
    title.textContent = `${entry.title} · ${entry.artifactId}`;
    card.appendChild(title);

    const kind = document.createElement("p");
    kind.className = "recent-meta";
    kind.textContent = `${entry.kind} · ${formatCapturedAt(entry.capturedAt)}`;
    card.appendChild(kind);

    const context = document.createElement("p");
    context.className = "recent-meta";
    context.textContent = `${entry.appName || "Unknown app"} · ${entry.windowTitle || "Unknown window"}`;
    card.appendChild(context);

    if (entry.platform || entry.contextBackend) {
      const runtime = document.createElement("p");
      runtime.className = "recent-meta";
      runtime.textContent = `${entry.platform || "unknown platform"} · ${entry.contextBackend || "unknown context"}`;
      card.appendChild(runtime);
    }

    if (entry.ocrEngine) {
      const ocr = document.createElement("p");
      ocr.className = "recent-meta";
      ocr.textContent = `OCR: ${entry.ocrEngine}`;
      card.appendChild(ocr);
    }

    if (entry.summary) {
      const summary = document.createElement("p");
      summary.className = "recent-summary";
      summary.textContent = entry.summary;
      card.appendChild(summary);
    }

    if (entry.previewDataUrl) {
      const preview = document.createElement("img");
      preview.className = "recent-preview-image";
      preview.src = entry.previewDataUrl;
      preview.alt = `${entry.title} preview`;
      preview.loading = "lazy";
      card.appendChild(preview);
    }

    recentCapturesNode.appendChild(card);
  }
}

function persistRecentCaptures(entries) {
  window.localStorage.setItem(RECENT_CAPTURE_STORAGE_KEY, JSON.stringify(entries));
  renderRecentCaptures(entries);
}

function rememberCapture(entry) {
  const nextEntries = [entry, ...readStoredRecentCaptures()].slice(0, MAX_RECENT_CAPTURES);
  persistRecentCaptures(nextEntries);
}

async function sendCapture(rawContent, metadata, sourceType = "clip_desktop_helper") {
  const { apiBase, token } = readConfig();

  if (!token) {
    setStatus("Add bearer token first");
    return null;
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
  return payload.artifact.id;
}

function base64ToBlob(base64, mimeType) {
  const decoded = window.atob(base64);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function fileNameFromPath(path, fallbackName) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || fallbackName;
}

async function sendMediaCapture({ fileBlob, fileName, mimeType, metadata, title, sourceType, normalizedText, extractedText }) {
  const { apiBase, token } = readConfig();

  if (!token) {
    setStatus("Add bearer token first");
    return null;
  }

  const formData = new FormData();
  formData.append("file", new File([fileBlob], fileName, { type: mimeType }));

  const uploadResponse = await fetch(`${apiBase}/v1/media/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Screenshot upload failed: HTTP ${uploadResponse.status}: ${errorText}`);
  }

  const uploaded = await uploadResponse.json();
  const response = await fetch(`${apiBase}/v1/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      source_type: sourceType,
      capture_source: "desktop_helper",
      title,
      raw: {
        blob_ref: uploaded.blob_ref,
        mime_type: uploaded.content_type ?? mimeType,
        checksum_sha256: uploaded.checksum_sha256,
      },
      normalized: {
        text: normalizedText,
        mime_type: "text/plain",
      },
      extracted: extractedText
        ? {
            text: extractedText,
            mime_type: "text/plain",
          }
        : undefined,
      metadata: {
        ...metadata,
        media: {
          id: uploaded.id,
          content_url: uploaded.content_url,
          file_name: fileName,
          mime_type: mimeType,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Screenshot capture failed: HTTP ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  return payload.artifact.id;
}

async function readClipboardText() {
  const tauriGlobal = window.__TAURI__;
  if (tauriGlobal) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("clip_clipboard_text");
  }

  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard API is unavailable in this runtime");
  }

  return navigator.clipboard.readText();
}

async function readCaptureContext() {
  const clippedAt = new Date().toISOString();
  const fallbackContext = {
    appName: "Browser runtime",
    windowTitle: document.title || "Starlog Helper",
    contextBackend: "browser",
    platform: navigator.platform || "unknown",
    clippedAt,
  };

  if (!window.__TAURI__) {
    return {
      display: fallbackContext,
      metadata: {
        source: "desktop_helper",
        clipped_at: clippedAt,
        active_app: fallbackContext.appName,
        window_title: fallbackContext.windowTitle,
        context_backend: fallbackContext.contextBackend,
        platform: fallbackContext.platform,
      },
    };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("clip_active_window_context");
    return {
      display: {
        appName: result?.app_name || "Unknown app",
        windowTitle: result?.window_title || "Unknown window",
        contextBackend: result?.backend || "tauri",
        platform: result?.platform || navigator.platform || "unknown",
        clippedAt,
      },
      metadata: {
        source: "desktop_helper",
        clipped_at: clippedAt,
        active_app: result?.app_name || undefined,
        window_title: result?.window_title || undefined,
        context_backend: result?.backend || "tauri",
        platform: result?.platform || navigator.platform || "unknown",
      },
    };
  } catch {
    return {
      display: fallbackContext,
      metadata: {
        source: "desktop_helper",
        clipped_at: clippedAt,
        active_app: fallbackContext.appName,
        window_title: fallbackContext.windowTitle,
        context_backend: fallbackContext.contextBackend,
        platform: fallbackContext.platform,
      },
    };
  }
}

async function clipClipboard() {
  try {
    const [text, captureContext] = await Promise.all([readClipboardText(), readCaptureContext()]);
    if (!text) {
      setStatus("Clipboard is empty");
      return;
    }

    const artifactId = await sendCapture(text, captureContext.metadata);
    if (!artifactId) {
      return;
    }
    rememberCapture({
      artifactId,
      title: "Desktop clip",
      kind: "clipboard",
      capturedAt: captureContext.display.clippedAt,
      appName: captureContext.display.appName,
      windowTitle: captureContext.display.windowTitle,
      contextBackend: captureContext.display.contextBackend,
      platform: captureContext.display.platform,
      summary: clipSummary(text),
    });
    setStatus(`Clip saved: ${artifactId}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Clipboard clip failed");
  }
}

async function clipScreenshot() {
  try {
    const tauriGlobal = window.__TAURI__;
    if (!tauriGlobal) {
      setStatus("Screenshot clip requires Tauri runtime");
      return;
    }

    const captureContext = await readCaptureContext();
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("clip_screenshot_stub");
    if (result?.status === "captured" && typeof result.path === "string" && result.path) {
      const base64Image = await invoke("read_file_base64", { path: result.path });
      const previewDataUrl = await createScreenshotPreviewDataUrl(base64Image, "image/png");
      const fileName = fileNameFromPath(result.path, "starlog-screenshot.png");
      const extractedText = typeof result.text === "string" ? result.text.trim() : "";
      const artifactId = await sendMediaCapture({
        fileBlob: base64ToBlob(base64Image, "image/png"),
        fileName,
        mimeType: "image/png",
        title: "Desktop screenshot",
        sourceType: "clip_desktop_screenshot",
        normalizedText: extractedText || "Desktop screenshot captured without OCR text.",
        extractedText: extractedText || undefined,
        metadata: {
          ...captureContext.metadata,
          screenshot_path: result.path,
          ocr_engine: result.ocr_engine,
          screenshot_message: result.message,
        },
      });
      if (!artifactId) {
        return;
      }
      rememberCapture({
        artifactId,
        title: "Desktop screenshot",
        kind: "screenshot",
        capturedAt: captureContext.display.clippedAt,
        appName: captureContext.display.appName,
        windowTitle: captureContext.display.windowTitle,
        contextBackend: captureContext.display.contextBackend,
        platform: captureContext.display.platform,
        ocrEngine: result.ocr_engine || "",
        summary: clipSummary(extractedText || result.message || fileName),
        previewDataUrl,
      });
      setStatus(`Clip saved: ${artifactId}`);
      return;
    }
    setStatus(typeof result?.message === "string" ? result.message : String(result));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Screenshot capture failed");
  }
}

async function wireGlobalShortcuts() {
  const tauriGlobal = window.__TAURI__;
  if (!tauriGlobal) {
    setStatus("Window shortcuts ready");
    return;
  }

  const { isRegistered, register } = await import("@tauri-apps/plugin-global-shortcut");
  for (const shortcut of GLOBAL_SHORTCUTS) {
    if (!(await isRegistered(shortcut.accelerator))) {
      await register(shortcut.accelerator, shortcut.handler);
    }
  }
  setStatus("Global shortcuts wired");
}

function isShortcutTarget(target) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    Boolean(target?.isContentEditable);
}

function isPrimaryModifierPressed(event) {
  return navigator.platform.includes("Mac") ? event.metaKey : event.ctrlKey;
}

function wireWindowShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (event.repeat || isShortcutTarget(event.target) || !event.shiftKey || !isPrimaryModifierPressed(event)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "c") {
      event.preventDefault();
      clipClipboard().catch(() => undefined);
      return;
    }
    if (key === "s") {
      event.preventDefault();
      clipScreenshot().catch(() => undefined);
    }
  });
}

applyStoredConfig(readStoredConfig());
renderRecentCaptures(readStoredRecentCaptures());
apiBaseInput.addEventListener("input", persistConfig);
tokenInput.addEventListener("input", persistConfig);

clipSelectionButton.addEventListener("click", () => {
  clipClipboard().catch(() => undefined);
});

clipScreenshotButton.addEventListener("click", () => {
  clipScreenshot().catch(() => undefined);
});

wireWindowShortcuts();
wireGlobalShortcuts().catch(() => undefined);
