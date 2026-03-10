const statusNode = document.getElementById("status");
const apiBaseInput = document.getElementById("apiBase");
const tokenInput = document.getElementById("token");
const clipSelectionButton = document.getElementById("clipSelection");
const clipScreenshotButton = document.getElementById("clipScreenshot");
const refreshDiagnosticsButton = document.getElementById("refreshDiagnostics");
const copyDiagnosticsButton = document.getElementById("copyDiagnostics");
const runtimeDiagnosticsNode = document.getElementById("runtimeDiagnostics");
const recentCapturesNode = document.getElementById("recentCaptures");
const CONFIG_STORAGE_KEY = "starlog.desktop-helper.config.v1";
const RECENT_CAPTURE_STORAGE_KEY = "starlog.desktop-helper.recent-captures.v1";
const DEFAULT_API_BASE = "http://localhost:8000";
const MAX_RECENT_CAPTURES = 6;
const SCREENSHOT_PREVIEW_MAX_DIMENSION = 320;
const RUNTIME_DIAGNOSTIC_ITEMS = [
  ["clipboard", "Clipboard"],
  ["screenshot", "Screenshot"],
  ["activeWindow", "Active window"],
  ["ocr", "OCR"],
  ["shortcuts", "Shortcuts"],
];
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

function errorMessage(error, fallbackMessage) {
  return error instanceof Error ? error.message : fallbackMessage;
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

function createBrowserRuntimeDiagnostics() {
  return {
    runtime: "browser",
    platform: navigator.platform || "unknown",
    clipboard: navigator.clipboard?.readText
      ? {
          status: "available",
          detail: "Browser clipboard capture is available while the helper window is focused.",
          preferredBackend: "browser-clipboard",
          availableBackends: ["browser-clipboard"],
        }
      : {
          status: "unavailable",
          detail: "Clipboard capture is unavailable in this browser runtime.",
          preferredBackend: null,
          availableBackends: [],
        },
    screenshot: {
      status: "unavailable",
      detail: "Screenshot capture requires the native Tauri desktop runtime.",
      preferredBackend: null,
      availableBackends: [],
    },
    activeWindow: {
      status: "degraded",
      detail: "Active window metadata falls back to the helper page title in browser mode.",
      preferredBackend: "browser",
      availableBackends: ["browser"],
    },
    ocr: {
      status: "unavailable",
      detail: "OCR runs only after native screenshot capture in the Tauri runtime.",
      preferredBackend: null,
      availableBackends: [],
    },
    shortcuts: {
      status: "pending",
      detail: "Checking shortcut wiring.",
      preferredBackend: "window-keydown",
      availableBackends: ["window-keydown"],
      registrations: [],
    },
  };
}

function normalizeCapability(source, fallbackDetail) {
  const availableBackends = Array.isArray(source?.availableBackends)
    ? source.availableBackends
    : Array.isArray(source?.available_backends)
      ? source.available_backends
      : [];
  const registrations = Array.isArray(source?.registrations) ? source.registrations : [];
  return {
    status: typeof source?.status === "string" ? source.status : "unavailable",
    detail: typeof source?.detail === "string" && source.detail.trim()
      ? source.detail
      : fallbackDetail,
    preferredBackend: typeof source?.preferredBackend === "string"
      ? source.preferredBackend
      : typeof source?.preferred_backend === "string"
        ? source.preferred_backend
        : null,
    availableBackends,
    registrations,
  };
}

function normalizeRuntimeDiagnostics(source) {
  const fallback = createBrowserRuntimeDiagnostics();
  return {
    runtime: typeof source?.runtime === "string" ? source.runtime : fallback.runtime,
    platform: typeof source?.platform === "string" ? source.platform : fallback.platform,
    clipboard: normalizeCapability(
      source?.clipboard,
      fallback.clipboard.detail,
    ),
    screenshot: normalizeCapability(
      source?.screenshot,
      fallback.screenshot.detail,
    ),
    activeWindow: normalizeCapability(
      source?.activeWindow ?? source?.active_window,
      fallback.activeWindow.detail,
    ),
    ocr: normalizeCapability(
      source?.ocr,
      fallback.ocr.detail,
    ),
    shortcuts: normalizeCapability(
      source?.shortcuts,
      fallback.shortcuts.detail,
    ),
  };
}

let runtimeDiagnostics = normalizeRuntimeDiagnostics(createBrowserRuntimeDiagnostics());

function mergeRuntimeDiagnostics(patch) {
  const base = runtimeDiagnostics;
  runtimeDiagnostics = normalizeRuntimeDiagnostics({
    ...base,
    ...patch,
    clipboard: patch?.clipboard ? { ...base.clipboard, ...patch.clipboard } : base.clipboard,
    screenshot: patch?.screenshot ? { ...base.screenshot, ...patch.screenshot } : base.screenshot,
    activeWindow: patch?.activeWindow ? { ...base.activeWindow, ...patch.activeWindow } : base.activeWindow,
    ocr: patch?.ocr ? { ...base.ocr, ...patch.ocr } : base.ocr,
    shortcuts: patch?.shortcuts ? { ...base.shortcuts, ...patch.shortcuts } : base.shortcuts,
  });
  renderRuntimeDiagnostics(runtimeDiagnostics);
}

function diagnosticStatusLabel(status) {
  if (status === "available") {
    return "Ready";
  }
  if (status === "degraded") {
    return "Partial";
  }
  if (status === "pending") {
    return "Checking";
  }
  return "Unavailable";
}

function renderRuntimeDiagnostics(diagnostics) {
  runtimeDiagnosticsNode.replaceChildren();

  const summary = document.createElement("p");
  summary.className = "help";
  summary.textContent = `${diagnostics.runtime === "tauri" ? "Native Tauri runtime" : "Browser fallback"} · ${diagnostics.platform}`;
  runtimeDiagnosticsNode.appendChild(summary);

  for (const [key, label] of RUNTIME_DIAGNOSTIC_ITEMS) {
    const item = diagnostics[key];
    const row = document.createElement("article");
    row.className = "diagnostic-row";

    const heading = document.createElement("div");
    heading.className = "diagnostic-heading";

    const title = document.createElement("p");
    title.className = "diagnostic-title";
    title.textContent = label;
    heading.appendChild(title);

    const badge = document.createElement("span");
    badge.className = `diagnostic-badge ${item.status}`;
    badge.textContent = diagnosticStatusLabel(item.status);
    heading.appendChild(badge);
    row.appendChild(heading);

    if (item.preferredBackend || item.availableBackends.length > 0 || item.registrations.length > 0) {
      const meta = document.createElement("p");
      meta.className = "diagnostic-meta";
      const fragments = [];
      if (item.preferredBackend) {
        fragments.push(`prefers ${item.preferredBackend}`);
      }
      if (item.availableBackends.length > 0) {
        fragments.push(`backends: ${item.availableBackends.join(", ")}`);
      }
      if (item.registrations.length > 0) {
        fragments.push(`shortcuts: ${item.registrations.join(", ")}`);
      }
      meta.textContent = fragments.join(" · ");
      row.appendChild(meta);
    }

    const detail = document.createElement("p");
    detail.className = "diagnostic-detail";
    detail.textContent = item.detail;
    row.appendChild(detail);

    runtimeDiagnosticsNode.appendChild(row);
  }
}

function buildRuntimeDiagnosticsSnapshot() {
  return JSON.stringify({
    capturedAt: new Date().toISOString(),
    apiBase: readConfig().apiBase,
    runtime: runtimeDiagnostics.runtime,
    platform: runtimeDiagnostics.platform,
    diagnostics: {
      clipboard: runtimeDiagnostics.clipboard,
      screenshot: runtimeDiagnostics.screenshot,
      activeWindow: runtimeDiagnostics.activeWindow,
      ocr: runtimeDiagnostics.ocr,
      shortcuts: runtimeDiagnostics.shortcuts,
    },
  }, null, 2);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand?.("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Clipboard write API is unavailable in this runtime");
  }
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
  const errors = [];

  if (tauriGlobal) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const text = await invoke("clip_clipboard_text");
      return {
        text,
        backend: "tauri-native",
      };
    } catch (error) {
      errors.push(errorMessage(error, "Native clipboard capture failed"));
    }
  }

  if (navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      return {
        text,
        backend: "browser-clipboard",
      };
    } catch (error) {
      errors.push(errorMessage(error, "Browser clipboard capture failed"));
    }
  }

  throw new Error(errors.join(" | ") || "Clipboard API is unavailable in this runtime");
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

async function deleteCaptureFile(path) {
  if (!window.__TAURI__ || typeof path !== "string" || !path) {
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_file_if_exists", { path });
  } catch {
    // Temp-file cleanup is best effort and should not hide the capture result.
  }
}

async function clipClipboard() {
  try {
    const [clipboardResult, captureContext] = await Promise.all([readClipboardText(), readCaptureContext()]);
    const text = clipboardResult.text;
    if (!text) {
      setStatus("Clipboard is empty");
      return;
    }

    const artifactId = await sendCapture(text, {
      ...captureContext.metadata,
      clipboard_backend: clipboardResult.backend,
    });
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
  let screenshotPath = "";
  try {
    const tauriGlobal = window.__TAURI__;
    if (!tauriGlobal) {
      setStatus("Screenshot clip requires Tauri runtime");
      return;
    }

    const captureContext = await readCaptureContext();
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("clip_screenshot_stub");
    screenshotPath = typeof result?.path === "string" ? result.path : "";
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
  } finally {
    await deleteCaptureFile(screenshotPath);
  }
}

async function wireGlobalShortcuts() {
  const tauriGlobal = window.__TAURI__;
  if (!tauriGlobal) {
    mergeRuntimeDiagnostics({
      shortcuts: {
        status: "available",
        detail: "Window-local shortcuts are active while the helper window is focused.",
        preferredBackend: "window-keydown",
        availableBackends: ["window-keydown"],
        registrations: GLOBAL_SHORTCUTS.map((shortcut) => shortcut.accelerator),
      },
    });
    setStatus("Window shortcuts ready (focused window only)");
    return;
  }

  try {
    const { isRegistered, register } = await import("@tauri-apps/plugin-global-shortcut");
    const registrations = [];
    const failures = [];

    for (const shortcut of GLOBAL_SHORTCUTS) {
      try {
        if (!(await isRegistered(shortcut.accelerator))) {
          await register(shortcut.accelerator, shortcut.handler);
        }
        registrations.push(shortcut.accelerator);
      } catch (error) {
        failures.push(`${shortcut.accelerator}: ${errorMessage(error, "registration failed")}`);
      }
    }

    if (failures.length > 0) {
      mergeRuntimeDiagnostics({
        shortcuts: {
          status: "degraded",
          detail: `Global shortcut registration is partial. Window-local shortcuts still work while focused. ${failures.join("; ")}`,
          preferredBackend: registrations.length > 0 ? "tauri-global-shortcut" : "window-keydown",
          availableBackends: registrations.length > 0
            ? ["tauri-global-shortcut", "window-keydown"]
            : ["window-keydown"],
          registrations,
        },
      });
      setStatus("Global shortcuts degraded; window shortcuts still work while focused");
      return;
    }

    mergeRuntimeDiagnostics({
      shortcuts: {
        status: "available",
        detail: "Global shortcuts are wired and window-local shortcuts remain available as fallback.",
        preferredBackend: "tauri-global-shortcut",
        availableBackends: ["tauri-global-shortcut", "window-keydown"],
        registrations,
      },
    });
    setStatus("Global shortcuts wired");
  } catch (error) {
    mergeRuntimeDiagnostics({
      shortcuts: {
        status: "degraded",
        detail: `Global shortcut registration failed. Window-local shortcuts still work while focused. ${errorMessage(error, "registration failed")}`,
        preferredBackend: "window-keydown",
        availableBackends: ["window-keydown"],
        registrations: [],
      },
    });
    setStatus("Global shortcuts unavailable; window shortcuts still work while focused");
  }
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

async function loadRuntimeDiagnostics() {
  if (!window.__TAURI__) {
    mergeRuntimeDiagnostics({
      ...createBrowserRuntimeDiagnostics(),
      shortcuts: runtimeDiagnostics.shortcuts,
    });
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const diagnostics = normalizeRuntimeDiagnostics(await invoke("inspect_runtime_diagnostics"));
    diagnostics.shortcuts = runtimeDiagnostics.shortcuts;
    if (diagnostics.clipboard.status !== "available" && navigator.clipboard?.readText) {
      const availableBackends = diagnostics.clipboard.availableBackends.includes("browser-clipboard")
        ? diagnostics.clipboard.availableBackends
        : [...diagnostics.clipboard.availableBackends, "browser-clipboard"];
      diagnostics.clipboard = {
        ...diagnostics.clipboard,
        status: "degraded",
        detail: `${diagnostics.clipboard.detail} A focused-window browser clipboard fallback is also available.`,
        availableBackends,
      };
    }
    mergeRuntimeDiagnostics(diagnostics);
  } catch (error) {
    mergeRuntimeDiagnostics({
      ...createBrowserRuntimeDiagnostics(),
      runtime: "tauri",
      platform: navigator.platform || "unknown",
      shortcuts: {
        status: "degraded",
        detail: `Runtime diagnostics could not be loaded from Tauri. Window-local shortcuts still work while focused. ${errorMessage(error, "diagnostics unavailable")}`,
        preferredBackend: "window-keydown",
        availableBackends: ["window-keydown"],
        registrations: [],
      },
    });
  }
}

async function refreshRuntimeDiagnostics() {
  setStatus("Refreshing diagnostics...");
  try {
    await loadRuntimeDiagnostics();
    setStatus(window.__TAURI__ ? "Runtime diagnostics refreshed" : "Browser diagnostics refreshed");
  } catch (error) {
    setStatus(errorMessage(error, "Runtime diagnostics refresh failed"));
  }
}

async function copyRuntimeDiagnostics() {
  try {
    await copyTextToClipboard(buildRuntimeDiagnosticsSnapshot());
    setStatus("Diagnostics copied to clipboard");
  } catch (error) {
    setStatus(errorMessage(error, "Diagnostics copy failed"));
  }
}

applyStoredConfig(readStoredConfig());
renderRecentCaptures(readStoredRecentCaptures());
renderRuntimeDiagnostics(runtimeDiagnostics);
apiBaseInput.addEventListener("input", persistConfig);
tokenInput.addEventListener("input", persistConfig);

clipSelectionButton.addEventListener("click", () => {
  clipClipboard().catch(() => undefined);
});

clipScreenshotButton.addEventListener("click", () => {
  clipScreenshot().catch(() => undefined);
});

refreshDiagnosticsButton.addEventListener("click", () => {
  refreshRuntimeDiagnostics().catch(() => undefined);
});

copyDiagnosticsButton.addEventListener("click", () => {
  copyRuntimeDiagnostics().catch(() => undefined);
});

wireWindowShortcuts();
loadRuntimeDiagnostics().catch(() => undefined);
wireGlobalShortcuts().catch(() => undefined);
