const statusNode = document.getElementById("status");
const apiBaseInput = document.getElementById("apiBase");
const bridgeBaseInput = document.getElementById("bridgeBase");
const tokenInput = document.getElementById("token");
const clipSelectionButton = document.getElementById("clipSelection");
const clipScreenshotButton = document.getElementById("clipScreenshot");
const refreshDiagnosticsButton = document.getElementById("refreshDiagnostics");
const copyDiagnosticsButton = document.getElementById("copyDiagnostics");
const checkBridgeButton = document.getElementById("checkBridge");
const copySetupChecklistButton = document.getElementById("copySetupChecklist");
const resetLocalStateButton = document.getElementById("resetLocalState");
const quickOpenWorkspaceButton = document.getElementById("quickOpenWorkspace");
const workspaceReturnQuickButton = document.getElementById("workspaceReturnQuick");
const runtimeDiagnosticsNode = document.getElementById("runtimeDiagnostics");
const diagnosticTilesNode = document.getElementById("diagnosticTiles");
const studioHealthBadgeNode = document.getElementById("studioHealthBadge");
const recentCapturesNode = document.getElementById("recentCaptures");
const CONFIG_STORAGE_KEY = "starlog.desktop-helper.config.v1";
const RECENT_CAPTURE_STORAGE_KEY = "starlog.desktop-helper.recent-captures.v1";
const SURFACE_MODE_STORAGE_KEY = "starlog.desktop-helper.surface-mode.v1";
const MAIN_WINDOW_LABEL = "main";
const WORKSPACE_WINDOW_LABEL = "workspace";
const DEFAULT_API_BASE = "http://localhost:8000";
const DEFAULT_BRIDGE_BASE = "http://127.0.0.1:8091";
const MAX_RECENT_CAPTURES = 6;
const SCREENSHOT_PREVIEW_MAX_DIMENSION = 320;
const WORKSPACE_SURFACE_WINDOW = { width: 1120, height: 760, minWidth: 940, minHeight: 620 };
const RUNTIME_DIAGNOSTIC_ITEMS = [
  ["clipboard", "Clipboard"],
  ["screenshot", "Screenshot"],
  ["activeWindow", "Active window"],
  ["ocr", "OCR"],
  ["bridge", "Local bridge"],
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

function hasTauriRuntime() {
  return Boolean(window.__TAURI__);
}

function isValidSurfaceMode(value) {
  return value === "quick" || value === "workspace";
}

function readStoredSurfaceMode() {
  try {
    const raw = window.localStorage.getItem(SURFACE_MODE_STORAGE_KEY);
    return isValidSurfaceMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

function querySurfaceMode() {
  try {
    const mode = new URLSearchParams(window.location.search).get("mode");
    return isValidSurfaceMode(mode) ? mode : null;
  } catch {
    return null;
  }
}

function resolveInitialSurfaceMode() {
  const modeFromQuery = querySurfaceMode();
  if (modeFromQuery) {
    return modeFromQuery;
  }
  if (hasTauriRuntime()) {
    return "quick";
  }
  return readStoredSurfaceMode() || "workspace";
}

let currentSurfaceMode = resolveInitialSurfaceMode();

async function applySurfaceMode(mode, { persist = true } = {}) {
  if (!isValidSurfaceMode(mode)) {
    return;
  }

  currentSurfaceMode = mode;
  document.body.dataset.helperMode = mode;
  if (persist) {
    window.localStorage.setItem(SURFACE_MODE_STORAGE_KEY, mode);
  }
}

async function openWorkspaceSurface() {
  if (!hasTauriRuntime()) {
    await applySurfaceMode("workspace");
    return;
  }

  try {
    const { getAllWindows, WebviewWindow } = await import("@tauri-apps/api/window");
    const existingWorkspace = (await getAllWindows()).find((window) => window.label === WORKSPACE_WINDOW_LABEL);
    if (existingWorkspace) {
      await existingWorkspace.show();
      await existingWorkspace.setFocus();
      return;
    }

    const workspaceWindow = new WebviewWindow(WORKSPACE_WINDOW_LABEL, {
      title: "Starlog Helper Studio",
      url: "index.html?mode=workspace",
      width: WORKSPACE_SURFACE_WINDOW.width,
      height: WORKSPACE_SURFACE_WINDOW.height,
      minWidth: WORKSPACE_SURFACE_WINDOW.minWidth,
      minHeight: WORKSPACE_SURFACE_WINDOW.minHeight,
      resizable: true,
      center: true,
      focus: true,
    });

    workspaceWindow.once("tauri://error", ({ payload }) => {
      const message = typeof payload === "string" ? payload : "Workspace window failed to open";
      setStatus(message);
    });
  } catch (error) {
    setStatus(errorMessage(error, "Workspace window failed to open"));
  }
}

async function returnToQuickSurface() {
  if (!hasTauriRuntime()) {
    await applySurfaceMode("quick");
    return;
  }

  try {
    const { getAllWindows, getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = getCurrentWindow();
    if (currentWindow.label !== WORKSPACE_WINDOW_LABEL) {
      await applySurfaceMode("quick");
      return;
    }

    const mainWindow = (await getAllWindows()).find((window) => window.label === MAIN_WINDOW_LABEL);
    if (mainWindow) {
      await mainWindow.show();
      await mainWindow.setFocus();
    }
    await currentWindow.close();
  } catch (error) {
    setStatus(errorMessage(error, "Quick surface could not be restored"));
  }
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
    bridge: {
      status: "degraded",
      detail: "No localhost bridge probe has completed yet. Set a local bridge base and refresh diagnostics.",
      preferredBackend: "http",
      availableBackends: ["http"],
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
    note: typeof source?.note === "string" && source.note.trim() ? source.note.trim() : "",
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
    bridge: normalizeCapability(
      source?.bridge,
      fallback.bridge.detail,
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
    bridge: patch?.bridge ? { ...base.bridge, ...patch.bridge } : base.bridge,
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

function overallDiagnosticStatus(diagnostics) {
  const statuses = RUNTIME_DIAGNOSTIC_ITEMS.map(([key]) => diagnostics[key]?.status || "unavailable");
  if (statuses.every((status) => status === "available")) {
    return { label: "System Nominal", status: "available" };
  }
  if (statuses.some((status) => status === "unavailable")) {
    return { label: "Needs Attention", status: "unavailable" };
  }
  return { label: "Partial Coverage", status: "degraded" };
}

function renderRuntimeDiagnostics(diagnostics) {
  runtimeDiagnosticsNode.replaceChildren();
  diagnosticTilesNode?.replaceChildren();

  const summary = document.createElement("p");
  summary.className = "help";
  summary.textContent = `${diagnostics.runtime === "tauri" ? "Native Tauri runtime" : "Browser fallback"} · ${diagnostics.platform}`;
  runtimeDiagnosticsNode.appendChild(summary);

  const health = overallDiagnosticStatus(diagnostics);
  if (studioHealthBadgeNode) {
    studioHealthBadgeNode.textContent = health.label;
    studioHealthBadgeNode.className = `section-chip ${health.status === "available" ? "" : health.status}`.trim();
  }

  for (const [key, label] of RUNTIME_DIAGNOSTIC_ITEMS) {
    const item = diagnostics[key];
    if (diagnosticTilesNode) {
      const tile = document.createElement("article");
      tile.className = "diagnostic-tile";

      const tileLabel = document.createElement("p");
      tileLabel.className = "diagnostic-tile-kicker";
      tileLabel.textContent = label;
      tile.appendChild(tileLabel);

      const tileBadge = document.createElement("span");
      tileBadge.className = `diagnostic-tile-badge ${item.status}`;
      tileBadge.textContent = diagnosticStatusLabel(item.status);
      tile.appendChild(tileBadge);

      diagnosticTilesNode.appendChild(tile);
    }

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

    if (item.note) {
      const note = document.createElement("p");
      note.className = "diagnostic-note";
      note.textContent = item.note;
      row.appendChild(note);
    }

    runtimeDiagnosticsNode.appendChild(row);
  }
}

function degradedStatusForCapability(key) {
  return runtimeDiagnostics[key]?.status === "unavailable" ? "unavailable" : "degraded";
}

function updateCapabilityNote(key, note, patch = {}) {
  mergeRuntimeDiagnostics({
    [key]: {
      ...patch,
      note,
    },
  });
}

function appendFixHint(message, hint) {
  if (!hint) {
    return message;
  }
  return message.endsWith(".") ? `${message} ${hint}` : `${message}. ${hint}`;
}

function clipboardFailureHint(message) {
  if (/permission denied|notallowederror|browser clipboard capture failed/i.test(message)) {
    return "Focus the helper window and allow clipboard access, or use the native Tauri runtime.";
  }
  if (message.includes("wl-paste") || message.includes("xclip") || message.includes("xsel")) {
    return "Install wl-paste, xclip, or xsel as indicated by the diagnostics card.";
  }
  if (message.includes("pbpaste")) {
    return "Confirm pbpaste is available on PATH.";
  }
  if (message.includes("PowerShell")) {
    return "Keep PowerShell available on PATH.";
  }
  return "";
}

function screenshotFailureHint(result, message) {
  const backend = typeof result?.backend === "string" ? result.backend : "";
  const status = typeof result?.status === "string" ? result.status : "";

  if (backend === "screencapture") {
    if (/screen recording|not authorized|operation not permitted|cannot capture screen/i.test(message)) {
      return "Grant Screen Recording permission to the helper in macOS Privacy & Security settings, then retry.";
    }
    return status === "cancelled"
      ? "Complete the macOS selection to capture a screenshot, or press Escape intentionally to cancel."
      : "Confirm Screen Recording permission for the helper and that screencapture is available.";
  }
  if (backend === "powershell") {
    return "Run the helper in a logged-in Windows desktop session and keep PowerShell available on PATH.";
  }
  if (backend === "grim+slurp") {
    return status === "cancelled"
      ? "Complete the slurp region selection instead of dismissing it."
      : "Confirm grim and slurp are installed and that the Wayland session allows screenshot capture.";
  }
  if (backend === "gnome-screenshot") {
    return status === "cancelled"
      ? "Complete the GNOME area selection instead of dismissing it."
      : "Confirm gnome-screenshot is installed and the desktop session allows screenshot capture.";
  }
  if (backend === "imagemagick-import") {
    return status === "cancelled"
      ? "Complete the ImageMagick region selection instead of dismissing it."
      : "Confirm ImageMagick import is installed and the X11 session allows screenshot capture.";
  }
  if (backend === "grim") {
    return "Install slurp to restore region picking, or keep using the full-screen grim fallback.";
  }
  if (backend === "scrot") {
    return "Install gnome-screenshot or ImageMagick import for region picking, or keep using the full-screen scrot fallback.";
  }
  if (message.includes("requires") && message.includes("Linux")) {
    return "Install one of grim/slurp, gnome-screenshot, ImageMagick import, grim, or scrot.";
  }
  if (message.includes("requires") && message.includes("Windows")) {
    return "Install PowerShell and run the helper from a Windows desktop session.";
  }
  if (message.includes("requires") && message.includes("macOS")) {
    return "Confirm the built-in screencapture tool is available.";
  }
  return "";
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
      bridge: runtimeDiagnostics.bridge,
      shortcuts: runtimeDiagnostics.shortcuts,
    },
  }, null, 2);
}

function buildSetupChecklistSnapshot() {
  const config = readConfig();
  const lines = [
    "Starlog Desktop Helper Setup Checklist",
    `Captured at: ${new Date().toISOString()}`,
    `Runtime: ${runtimeDiagnostics.runtime}`,
    `Platform: ${runtimeDiagnostics.platform}`,
    `API base: ${config.apiBase}`,
    `Bridge base: ${config.bridgeBase}`,
    `Bearer token configured: ${config.token ? "yes" : "no"}`,
    "",
    "Checklist:",
    "1. Launch the packaged helper on this device.",
    `2. Set API base to ${config.apiBase}.`,
    `3. Set local bridge base to ${config.bridgeBase}.`,
    config.token
      ? "4. Bearer token is configured on this device. Keep using secure storage for daily use."
      : "4. Paste a bearer token into the helper before testing live uploads.",
    "5. Refresh Diagnostics and resolve anything marked Partial or Unavailable.",
    "6. Check Local Bridge to confirm STT/TTS/context routes are reachable on localhost.",
    "7. Trigger Cmd/Ctrl+Shift+C and Cmd/Ctrl+Shift+S to confirm clipboard and screenshot capture.",
    "8. Review Recent Captures to confirm upload IDs, metadata, and screenshot previews render.",
    "",
    "Runtime readiness:",
  ];

  for (const [key, label] of RUNTIME_DIAGNOSTIC_ITEMS) {
    const item = runtimeDiagnostics[key];
    lines.push(`- ${label}: ${diagnosticStatusLabel(item.status)} - ${item.detail}`);
    if (item.note) {
      lines.push(`  Note: ${item.note}`);
    }
  }

  lines.push(
    "",
    "Reset:",
    "Use Reset Local State in the helper studio to clear the local API base, secure/local token, recent captures, and remembered surface mode on this device.",
  );

  return lines.join("\n");
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
  bridgeBaseInput.value = typeof config?.bridgeBase === "string" && config.bridgeBase.trim()
    ? config.bridgeBase
    : DEFAULT_BRIDGE_BASE;
  tokenInput.value = hasTauriRuntime()
    ? ""
    : (typeof config?.token === "string" ? config.token : "");
}

function readConfig() {
  return {
    apiBase: apiBaseInput.value.trim() || DEFAULT_API_BASE,
    bridgeBase: bridgeBaseInput.value.trim() || DEFAULT_BRIDGE_BASE,
    token: tokenInput.value.trim(),
  };
}

function persistConfig() {
  const nextConfig = {
    apiBase: apiBaseInput.value.trim() || DEFAULT_API_BASE,
    bridgeBase: bridgeBaseInput.value.trim() || DEFAULT_BRIDGE_BASE,
  };
  if (!hasTauriRuntime()) {
    nextConfig.token = tokenInput.value.trim();
  }
  window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(nextConfig));
}

async function readSecureToken() {
  if (!hasTauriRuntime()) {
    return "";
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("get_secure_token")) || "";
  } catch {
    return "";
  }
}

async function writeSecureToken(token) {
  const normalized = String(token || "").trim();
  if (!hasTauriRuntime()) {
    return false;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_secure_token", { token: normalized });
    return true;
  } catch (error) {
    setStatus(errorMessage(error, "Failed to update secure token storage"));
    return false;
  }
}

async function persistToken() {
  if (!hasTauriRuntime()) {
    persistConfig();
    return;
  }
  await writeSecureToken(tokenInput.value);
  persistConfig();
}

async function hydrateSecureTokenFromStorage() {
  if (!hasTauriRuntime()) {
    persistConfig();
    return;
  }

  const storedConfig = readStoredConfig();
  const legacyToken = typeof storedConfig?.token === "string" ? storedConfig.token.trim() : "";
  const secureToken = await readSecureToken();

  if (secureToken) {
    tokenInput.value = secureToken;
    persistConfig();
    return;
  }

  if (legacyToken) {
    tokenInput.value = legacyToken;
    await persistToken();
    return;
  }

  tokenInput.value = "";
  persistConfig();
}

function formatCapturedAt(value) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

function renderRecentCaptures(entries) {
  recentCapturesNode.replaceChildren();
  recentCapturesNode.className = "recent-grid";
  if (entries.length === 0) {
    const emptyState = document.createElement("article");
    emptyState.className = "recent-empty-card";

    const emptyLabel = document.createElement("p");
    emptyLabel.className = "help";
    emptyLabel.textContent = "No captures yet.";
    emptyState.appendChild(emptyLabel);

    recentCapturesNode.appendChild(emptyState);
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "recent-card";

    const artifact = document.createElement("span");
    artifact.className = "recent-artifact mono";
    artifact.textContent = entry.artifactId;
    card.appendChild(artifact);

    const title = document.createElement("p");
    title.className = "recent-title";
    title.textContent = entry.title;
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

    if (entry.captureBackend) {
      const backend = document.createElement("p");
      backend.className = "recent-meta";
      backend.textContent = `Capture backend: ${entry.captureBackend}`;
      card.appendChild(backend);
    }

    const tags = document.createElement("div");
    tags.className = "recent-tag-row";
    for (const value of [entry.ocrEngine && `OCR ${entry.ocrEngine}`, entry.platform, entry.contextBackend]) {
      if (!value) {
        continue;
      }
      const tag = document.createElement("span");
      tag.className = "recent-tag mono";
      tag.textContent = value;
      tags.appendChild(tag);
    }
    if (tags.childNodes.length > 0) {
      card.appendChild(tags);
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

async function resetLocalState() {
  apiBaseInput.value = DEFAULT_API_BASE;
  bridgeBaseInput.value = DEFAULT_BRIDGE_BASE;
  tokenInput.value = "";

  try {
    window.localStorage.removeItem(RECENT_CAPTURE_STORAGE_KEY);
    window.localStorage.removeItem(SURFACE_MODE_STORAGE_KEY);
  } catch {
    // Ignore local storage reset issues and still clear the visible state.
  }

  renderRecentCaptures([]);
  await persistToken();
  await applySurfaceMode(hasTauriRuntime() ? "quick" : "workspace");
  setStatus("Local setup reset to defaults");
}

function bridgeSummaryStatus(capabilities) {
  const states = Object.values(capabilities).map((item) => item?.status || "unavailable");
  if (states.every((status) => status === "available")) {
    return "available";
  }
  if (states.some((status) => status === "available" || status === "degraded")) {
    return "degraded";
  }
  return "unavailable";
}

async function loadBridgeDiagnostics() {
  const { bridgeBase } = readConfig();
  if (!bridgeBase) {
    mergeRuntimeDiagnostics({
      bridge: {
        status: "unavailable",
        detail: "Local bridge base is empty. Configure a localhost bridge URL first.",
        preferredBackend: "http",
        availableBackends: ["http"],
      },
    });
    return;
  }

  const normalizedBase = bridgeBase.replace(/\/+$/, "");
  try {
    const response = await fetch(`${normalizedBase}/health`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const capabilities = typeof payload?.capabilities === "object" && payload.capabilities ? payload.capabilities : {};
    const detailParts = [];
    for (const [key, label] of [
      ["stt", "STT"],
      ["tts", "TTS"],
      ["context", "Context"],
      ["clip", "Clip"],
    ]) {
      const item = capabilities[key];
      if (!item) {
        continue;
      }
      const status = typeof item.status === "string" ? item.status : "unknown";
      detailParts.push(`${label}: ${status}`);
    }
    mergeRuntimeDiagnostics({
      bridge: {
        status: bridgeSummaryStatus(capabilities),
        detail: detailParts.length > 0
          ? `Local bridge reachable at ${normalizedBase}. ${detailParts.join(" · ")}.`
          : `Local bridge reachable at ${normalizedBase}.`,
        preferredBackend: "http",
        availableBackends: ["http"],
        note: typeof payload?.service === "string" ? `Service: ${payload.service}` : "",
      },
    });
  } catch (error) {
    mergeRuntimeDiagnostics({
      bridge: {
        status: "unavailable",
        detail: `Local bridge probe failed for ${normalizedBase}.`,
        preferredBackend: "http",
        availableBackends: ["http"],
        note: errorMessage(error, "Bridge unavailable"),
      },
    });
  }
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
    const backend = result?.backend || "tauri";
    if (backend === "osascript-error") {
      updateCapabilityNote(
        "activeWindow",
        "Last active-window probe failed via osascript. Grant Automation and Accessibility permissions for the helper, then retry.",
        {
          status: degradedStatusForCapability("activeWindow"),
        },
      );
    }
    return {
      display: {
        appName: result?.app_name || "Unknown app",
        windowTitle: result?.window_title || "Unknown window",
        contextBackend: backend,
        platform: result?.platform || navigator.platform || "unknown",
        clippedAt,
      },
      metadata: {
        source: "desktop_helper",
        clipped_at: clippedAt,
        active_app: result?.app_name || undefined,
        window_title: result?.window_title || undefined,
        context_backend: backend,
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
      updateCapabilityNote("clipboard", "Last clipboard capture found no text.");
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
      captureBackend: clipboardResult.backend,
      summary: clipSummary(text),
    });
    updateCapabilityNote(
      "clipboard",
      `Last clipboard capture succeeded via ${clipboardResult.backend}.`,
      { status: "available" },
    );
    setStatus(`Clip saved: ${artifactId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clipboard clip failed";
    updateCapabilityNote("clipboard", appendFixHint(
      `Last clipboard capture failed. ${message}`,
      clipboardFailureHint(message),
    ), {
      status: degradedStatusForCapability("clipboard"),
    });
    setStatus(message);
  }
}

async function clipScreenshot() {
  let screenshotPath = "";
  try {
    const tauriGlobal = window.__TAURI__;
    if (!tauriGlobal) {
      updateCapabilityNote(
        "screenshot",
        "Last screenshot attempt failed because the helper is not running in the Tauri runtime.",
        { status: "unavailable" },
      );
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
        captureBackend: result.backend || "",
        summary: clipSummary(extractedText || result.message || fileName),
        previewDataUrl,
      });
      updateCapabilityNote(
        "screenshot",
        `Last screenshot capture succeeded via ${result.backend || "native"}${result.ocr_engine ? ` with ${result.ocr_engine} OCR` : ""}.`,
        { status: "available" },
      );
      setStatus(`Clip saved: ${artifactId}`);
      return;
    }
    const message = typeof result?.message === "string" ? result.message : String(result);
    const backendLabel = typeof result?.backend === "string" && result.backend ? ` via ${result.backend}` : "";
    const attemptState = result?.status === "cancelled" ? "was cancelled" : "failed";
    updateCapabilityNote("screenshot", appendFixHint(
      `Last screenshot attempt ${attemptState}${backendLabel}. ${message}`,
      screenshotFailureHint(result, message),
    ), {
      status: result?.status === "failed" ? degradedStatusForCapability("screenshot") : runtimeDiagnostics.screenshot.status,
    });
    setStatus(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Screenshot capture failed";
    updateCapabilityNote("screenshot", appendFixHint(
      `Last screenshot attempt failed. ${message}`,
      screenshotFailureHint(null, message),
    ), {
      status: degradedStatusForCapability("screenshot"),
    });
    setStatus(message);
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
      updateCapabilityNote("shortcuts", "Last window-local shortcut: CommandOrControl+Shift+C via window-keydown.");
      clipClipboard().catch(() => undefined);
      return;
    }
    if (key === "s") {
      event.preventDefault();
      updateCapabilityNote("shortcuts", "Last window-local shortcut: CommandOrControl+Shift+S via window-keydown.");
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
    await loadBridgeDiagnostics();
    setStatus(window.__TAURI__ ? "Runtime diagnostics refreshed" : "Browser diagnostics refreshed");
  } catch (error) {
    setStatus(errorMessage(error, "Runtime diagnostics refresh failed"));
  }
}

async function checkLocalBridge() {
  setStatus("Checking local bridge...");
  try {
    await loadBridgeDiagnostics();
    setStatus("Local bridge diagnostics refreshed");
  } catch (error) {
    setStatus(errorMessage(error, "Local bridge diagnostics failed"));
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

async function copySetupChecklist() {
  try {
    await copyTextToClipboard(buildSetupChecklistSnapshot());
    setStatus("Setup checklist copied to clipboard");
  } catch (error) {
    setStatus(errorMessage(error, "Setup checklist copy failed"));
  }
}

applyStoredConfig(readStoredConfig());
document.body.dataset.helperMode = currentSurfaceMode;
renderRecentCaptures(readStoredRecentCaptures());
renderRuntimeDiagnostics(runtimeDiagnostics);
apiBaseInput.addEventListener("input", persistConfig);
bridgeBaseInput.addEventListener("input", persistConfig);
tokenInput.addEventListener("input", () => {
  persistToken().catch(() => undefined);
});

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

checkBridgeButton?.addEventListener("click", () => {
  checkLocalBridge().catch(() => undefined);
});

copySetupChecklistButton?.addEventListener("click", () => {
  copySetupChecklist().catch(() => undefined);
});

resetLocalStateButton?.addEventListener("click", () => {
  resetLocalState().catch(() => undefined);
});

quickOpenWorkspaceButton?.addEventListener("click", () => {
  openWorkspaceSurface().catch(() => undefined);
});

workspaceReturnQuickButton?.addEventListener("click", () => {
  returnToQuickSurface().catch(() => undefined);
});

wireWindowShortcuts();
loadRuntimeDiagnostics()
  .then(() => loadBridgeDiagnostics())
  .catch(() => undefined);
wireGlobalShortcuts().catch(() => undefined);
hydrateSecureTokenFromStorage().catch(() => undefined);
applySurfaceMode(currentSurfaceMode, { persist: false }).catch(() => undefined);
