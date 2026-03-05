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

export default function ArtifactsPage() {
  const { apiBase, token } = useSessionConfig();
  const [items, setItems] = useState<Artifact[]>([]);
  const [status, setStatus] = useState("Ready");

  async function loadArtifacts() {
    try {
      const data = await apiRequest<Artifact[]>(apiBase, token, "/v1/artifacts");
      setItems(data);
      setStatus(`Loaded ${data.length} artifacts`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load artifacts");
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
          <div className="button-row">
            <button className="button" type="button" onClick={() => loadArtifacts()}>Refresh</button>
          </div>
          <p className="status">{status}</p>
        </div>
        <div className="panel glass">
          {items.length === 0 ? (
            <p className="console-copy">No artifacts yet.</p>
          ) : (
            <ul>
              {items.map((artifact) => (
                <li key={artifact.id}>
                  <strong>{artifact.title || artifact.id}</strong> - {artifact.source_type} - {artifact.created_at}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
