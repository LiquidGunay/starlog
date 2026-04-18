function readMeta(selectors) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const content = node?.getAttribute("content")?.trim();
    if (content) {
      return content;
    }
  }
  return "";
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function selectionPayload() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return {
      text: "",
      html: "",
      context: "",
      highlights: [],
    };
  }

  const text = normalizeText(selection.toString());
  if (!text) {
    return {
      text: "",
      html: "",
      context: "",
      highlights: [],
    };
  }

  const range = selection.getRangeAt(0).cloneRange();
  const wrapper = document.createElement("div");
  wrapper.appendChild(range.cloneContents());
  const html = wrapper.innerHTML;
  const anchorNode = range.startContainer?.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer?.parentElement;
  const block = anchorNode?.closest?.("article, section, main, p, li, blockquote, div") || document.body;
  const blockText = normalizeText(block?.innerText || "");

  return {
    text,
    html,
    context: blockText.slice(0, 800),
    highlights: [
      {
        quote: text,
        context: blockText.slice(0, 800),
        start_offset: range.startOffset,
        end_offset: range.endOffset,
      },
    ],
  };
}

function bestContentCandidate() {
  const explicit = document.querySelector("article, main, [role='main']");
  if (explicit && normalizeText(explicit.innerText).length > 200) {
    return explicit;
  }

  let winner = document.body;
  let winnerScore = 0;
  for (const node of Array.from(document.querySelectorAll("article, section, div"))) {
    const text = normalizeText(node.innerText || "");
    if (text.length < 200) {
      continue;
    }
    const paragraphs = node.querySelectorAll("p").length;
    const score = text.length + (paragraphs * 120);
    if (score > winnerScore) {
      winner = node;
      winnerScore = score;
    }
  }
  return winner;
}

function clipPayload() {
  const selection = selectionPayload();
  const mainNode = bestContentCandidate();
  const articleText = normalizeText(mainNode?.innerText || document.body?.innerText || "");
  const title = normalizeText(document.title || readMeta(["meta[property='og:title']", "meta[name='twitter:title']"])) || "Untitled page";
  const canonicalUrl = document.querySelector("link[rel='canonical']")?.getAttribute("href") || window.location.href;
  const siteName = readMeta(["meta[property='og:site_name']", "meta[name='application-name']"]) || window.location.hostname;
  const faviconUrl = document.querySelector("link[rel='icon'], link[rel='shortcut icon']")?.getAttribute("href") || "";
  const leadImageUrl = readMeta(["meta[property='og:image']", "meta[name='twitter:image']"]);
  const publishedAt = readMeta(["meta[property='article:published_time']", "meta[name='article:published_time']", "meta[name='date']"]);
  const byline = readMeta(["meta[name='author']", "meta[property='article:author']"]);
  const language = document.documentElement.lang || "";
  const extractionMethod = mainNode?.matches("article") ? "article" : mainNode?.matches("main, [role='main']") ? "main" : "largest_block";
  const normalizedContent = selection.text || articleText || window.location.href;
  const extractedSnippet = selection.text || articleText.slice(0, 1200) || title;

  return {
    title,
    url: window.location.href,
    canonicalUrl,
    rawHtml: document.documentElement.outerHTML,
    articleText,
    normalizedContent,
    extractedSnippet,
    selection,
    clip: {
      source_url: window.location.href,
      canonical_url: canonicalUrl,
      page_title: title,
      site_name: siteName,
      byline,
      published_at: publishedAt,
      language,
      favicon_url: faviconUrl,
      lead_image_url: leadImageUrl,
      extraction_method: extractionMethod,
      readability_confidence: articleText.length > 1200 ? 0.86 : articleText.length > 500 ? 0.72 : 0.48,
    },
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "STARLOG_CAPTURE_SELECTION") {
    return;
  }

  sendResponse({ ok: true, payload: clipPayload() });
});
