const apiBaseInput = document.getElementById("apiBase");
const tokenInput = document.getElementById("token");
const statusNode = document.getElementById("status");
const captureButton = document.getElementById("capture");

async function loadSettings() {
  const { apiBase, token } = await chrome.storage.local.get(["apiBase", "token"]);
  apiBaseInput.value = apiBase ?? "http://localhost:8000";
  tokenInput.value = token ?? "";
}

function setStatus(message) {
  statusNode.textContent = message;
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiBase: apiBaseInput.value.trim(),
    token: tokenInput.value.trim(),
  });
}

async function captureSelection() {
  setStatus("Capturing...");
  await saveSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab");
    return;
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: "STARLOG_CAPTURE_SELECTION" });
  if (!response?.ok) {
    setStatus("Could not read page selection");
    return;
  }

  const payload = response.payload;
  const request = {
    source_type: "clip_browser",
    title: payload.title,
    raw_content: payload.selection || payload.url,
    normalized_content: payload.selection || payload.url,
    extracted_content: payload.selection,
    metadata: {
      url: payload.url,
      clipped_at: new Date().toISOString(),
    },
  };

  const result = await fetch(`${apiBaseInput.value.trim()}/v1/artifacts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenInput.value.trim()}`,
    },
    body: JSON.stringify(request),
  });

  if (!result.ok) {
    setStatus(`Capture failed (${result.status})`);
    return;
  }

  setStatus("Clip saved to Starlog");
}

captureButton.addEventListener("click", () => {
  captureSelection().catch((error) => {
    console.error(error);
    setStatus("Unexpected error");
  });
});

loadSettings();
