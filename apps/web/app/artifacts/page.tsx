"use client";

import { useEffect, useState } from "react";

import { SessionControls } from "../components/session-controls";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type Artifact = {
  id: string;
  source_type: string;
  title?: string;
  created_at: string;
};

type ArtifactGraph = {
  summaries: Array<{ id: string; version: number; content: string }>;
  cards: Array<{ id: string; prompt: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  notes: Array<{ id: string; title: string }>;
};

export default function ArtifactsPage() {
  const { apiBase, token } = useSessionConfig();
  const [items, setItems] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [graph, setGraph] = useState<ArtifactGraph | null>(null);
  const [status, setStatus] = useState("Ready");
  const [quickClip, setQuickClip] = useState("Capture from artifact workspace.");

  async function loadArtifacts() {
    try {
      const data = await apiRequest<Artifact[]>(apiBase, token, "/v1/artifacts");
      setItems(data);
      setStatus(`Loaded ${data.length} artifacts`);
      if (!selectedId && data.length > 0) {
        setSelectedId(data[0].id);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load artifacts");
    }
  }

  async function createArtifact() {
    try {
      const payload = await apiRequest<{ id: string }>(apiBase, token, "/v1/artifacts", {
        method: "POST",
        body: JSON.stringify({
          source_type: "clip_manual",
          title: "Workspace clip",
          raw_content: quickClip,
          normalized_content: quickClip,
          extracted_content: quickClip,
          metadata: { source: "artifacts_page" },
        }),
      });
      setStatus(`Created artifact ${payload.id}`);
      setSelectedId(payload.id);
      await loadArtifacts();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create artifact");
    }
  }

  async function loadGraph(artifactId: string) {
    try {
      const payload = await apiRequest<ArtifactGraph>(apiBase, token, `/v1/artifacts/${artifactId}/graph`);
      setGraph(payload);
      setStatus(`Loaded graph for ${artifactId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load graph");
    }
  }

  async function runAction(action: "summarize" | "cards" | "tasks" | "append_note") {
    if (!selectedId) {
      setStatus("Select an artifact first");
      return;
    }

    try {
      await apiRequest(apiBase, token, `/v1/artifacts/${selectedId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setStatus(`${action} suggested for ${selectedId}`);
      await loadGraph(selectedId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${action} failed`);
    }
  }

  useEffect(() => {
    if (token) {
      loadArtifacts().catch(() => undefined);
    }
  }, [token]);

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Artifacts</p>
          <h1>Clip inbox and references</h1>
          <p className="console-copy">Review everything clipped from browser, desktop helper, and mobile share.</p>
          <label className="label" htmlFor="quick-clip">Quick clip</label>
          <textarea
            id="quick-clip"
            className="textarea"
            value={quickClip}
            onChange={(event) => setQuickClip(event.target.value)}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => createArtifact()}>Create Clip</button>
            <button className="button" type="button" onClick={() => loadArtifacts()}>Refresh</button>
          </div>
          <div className="button-row">
            <button className="button" type="button" onClick={() => runAction("summarize")}>Summarize</button>
            <button className="button" type="button" onClick={() => runAction("cards")}>Create Cards</button>
            <button className="button" type="button" onClick={() => runAction("tasks")}>Suggest Tasks</button>
            <button className="button" type="button" onClick={() => runAction("append_note")}>Append Note</button>
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Inbox</h2>
          {items.length === 0 ? (
            <p className="console-copy">No artifacts yet.</p>
          ) : (
            <ul>
              {items.map((artifact) => (
                <li key={artifact.id}>
                  <button className="button" type="button" onClick={() => {
                    setSelectedId(artifact.id);
                    loadGraph(artifact.id).catch(() => undefined);
                  }}>
                    {artifact.title || artifact.id}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2>Linked outputs</h2>
          {!graph ? (
            <p className="console-copy">Select an artifact to inspect graph links.</p>
          ) : (
            <div>
              <p className="console-copy">Summaries: {graph.summaries.length}</p>
              <p className="console-copy">Cards: {graph.cards.length}</p>
              <p className="console-copy">Tasks: {graph.tasks.length}</p>
              <p className="console-copy">Notes: {graph.notes.length}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
