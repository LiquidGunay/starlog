chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "STARLOG_CAPTURE_SELECTION") {
    return;
  }

  const selection = window.getSelection()?.toString() ?? "";
  const payload = {
    title: document.title,
    url: window.location.href,
    selection,
    rawHtml: document.documentElement.outerHTML,
  };

  sendResponse({ ok: true, payload });
});
