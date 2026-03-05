const statusNode = document.getElementById("status");
const clipSelectionButton = document.getElementById("clipSelection");
const clipScreenshotButton = document.getElementById("clipScreenshot");

clipSelectionButton.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    statusNode.textContent = text
      ? `Clipboard captured (${Math.min(text.length, 120)} chars)`
      : "Clipboard is empty";
  } catch (_error) {
    statusNode.textContent = "Clipboard read not available in this environment";
  }
});

clipScreenshotButton.addEventListener("click", () => {
  statusNode.textContent = "Screenshot capture wiring comes in next implementation pass.";
});
