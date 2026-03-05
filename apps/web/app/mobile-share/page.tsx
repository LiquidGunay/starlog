"use client";

import { useMemo, useState } from "react";

import { SessionControls } from "../components/session-controls";

function buildCaptureLink(title: string, text: string, sourceUrl: string): string {
  const params = new URLSearchParams();
  if (title.trim()) {
    params.set("title", title.trim());
  }
  if (text.trim()) {
    params.set("text", text.trim());
  }
  if (sourceUrl.trim()) {
    params.set("source_url", sourceUrl.trim());
  }
  return `starlog://capture?${params.toString()}`;
}

export default function MobileSharePage() {
  const [title, setTitle] = useState("Mobile Share Clip");
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState("Ready");

  const deepLink = useMemo(() => buildCaptureLink(title, text, sourceUrl), [title, text, sourceUrl]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(deepLink);
      setStatus("Copied deep-link to clipboard");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Copy failed");
    }
  }

  function openMobileApp() {
    window.location.href = deepLink;
    setStatus("Attempted to open mobile app with deep-link");
  }

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Mobile Share</p>
          <h1>Generate mobile capture deep-links</h1>
          <p className="console-copy">
            This bridges web/PWA workflows with the companion app until native share-extension flows are completed.
          </p>
          <label className="label" htmlFor="mobile-share-title">Title</label>
          <input
            id="mobile-share-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label className="label" htmlFor="mobile-share-text">Capture text</label>
          <textarea
            id="mobile-share-text"
            className="textarea"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <label className="label" htmlFor="mobile-share-url">Source URL</label>
          <input
            id="mobile-share-url"
            className="input"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://..."
          />
          <label className="label" htmlFor="mobile-share-link">Deep-link</label>
          <textarea id="mobile-share-link" className="textarea" value={deepLink} readOnly />
          <div className="button-row">
            <button className="button" type="button" onClick={copyLink}>Copy Deep-Link</button>
            <button className="button" type="button" onClick={openMobileApp}>Open In Mobile App</button>
          </div>
          <p className="status">{status}</p>
        </div>
      </section>
    </main>
  );
}
