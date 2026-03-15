"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useSessionConfig } from "../session-provider";

function ShareTargetContent() {
  const searchParams = useSearchParams();
  const { mutateWithQueue } = useSessionConfig();
  const [title, setTitle] = useState("Shared clip");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("Ready");
  const [artifactId, setArtifactId] = useState("");

  useEffect(() => {
    const nextTitle = searchParams.get("title")?.trim();
    const nextText = searchParams.get("text")?.trim();
    const nextUrl = searchParams.get("url")?.trim();

    if (nextTitle) {
      setTitle(nextTitle);
    }
    if (nextText) {
      setText(nextText);
    }
    if (nextUrl) {
      setUrl(nextUrl);
    }
    if (!nextText && !nextUrl) {
      setStatus("Open this page from the installed PWA share target, or paste capture content manually.");
      return;
    }
    setStatus("Share target payload loaded. Review it, then capture it into the inbox.");
  }, [searchParams]);

  async function captureSharedItem() {
    const clipText = text.trim();
    const sourceUrl = url.trim();
    if (!clipText && !sourceUrl) {
      setStatus("Add shared text or a URL before capturing");
      return;
    }

    try {
      const result = await mutateWithQueue<{ artifact: { id: string } }>(
        "/v1/capture",
        {
          method: "POST",
          body: JSON.stringify({
            source_type: sourceUrl ? "clip_share_link" : "clip_share_text",
            capture_source: "pwa_share_target",
            title: title.trim() || "Shared clip",
            source_url: sourceUrl || undefined,
            raw: { text: clipText || sourceUrl, mime_type: "text/plain" },
            normalized: { text: clipText || sourceUrl, mime_type: "text/plain" },
            extracted: clipText ? { text: clipText, mime_type: "text/plain" } : undefined,
            metadata: {
              source: "share_target",
              shared_from: "pwa",
            },
          }),
        },
        {
          label: `Capture shared item: ${title.trim() || "Shared clip"}`,
          entity: "artifact",
          op: "create",
        },
      );

      if (result.queued || !result.data) {
        setArtifactId("");
        setStatus("Share capture queued for replay");
        return;
      }

      setArtifactId(result.data.artifact.id);
      setStatus(`Captured shared item as ${result.data.artifact.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to capture shared item");
    }
  }

  return (
    <main className="shell">
      <section className="workspace glass">
        <div>
          <p className="eyebrow">Command Center</p>
          <h1>PWA share capture</h1>
          <p className="console-copy">
            Installed PWA shares can land here, then you can capture them into the artifact inbox with provenance.
          </p>
          <label className="label" htmlFor="share-target-title">Title</label>
          <input
            id="share-target-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label className="label" htmlFor="share-target-url">Source URL</label>
          <input
            id="share-target-url"
            className="input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
          />
          <label className="label" htmlFor="share-target-text">Shared text</label>
          <textarea
            id="share-target-text"
            className="textarea"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => captureSharedItem()}>Capture to Inbox</button>
            <Link className="button" href={artifactId ? `/artifacts?artifact=${encodeURIComponent(artifactId)}` : "/artifacts"}>
              Open Artifacts
            </Link>
          </div>
          <p className="status">{status}</p>
        </div>
      </section>
    </main>
  );
}

export default function ShareTargetPage() {
  return (
    <Suspense fallback={<main className="shell"><section className="workspace glass"><p className="status">Loading share target...</p></section></main>}>
      <ShareTargetContent />
    </Suspense>
  );
}
