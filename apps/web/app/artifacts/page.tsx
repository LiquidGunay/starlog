"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { SessionControls } from "../components/session-controls";
import { applyOptimisticArtifacts } from "../lib/optimistic-state";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type Artifact = {
  id: string;
  source_type: string;
  title?: string;
  created_at: string;
  pending?: boolean;
  pendingLabel?: string;
};

type ArtifactGraph = {
  artifact: Artifact;
  summaries: Array<{ id: string; version: number; content: string }>;
  cards: Array<{ id: string; prompt: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  notes: Array<{ id: string; title: string }>;
  relations: Array<{
    id: string;
    relation_type: string;
    target_type: string;
    target_id: string;
  }>;
};

type ArtifactVersions = {
  summaries: Array<{ id: string; version: number; created_at: string }>;
  card_sets: Array<{ id: string; version: number; created_at: string }>;
  actions: Array<{ id: string; action: string; status: string; output_ref?: string | null; created_at: string }>;
};

function ArtifactsPageContent() {
  const searchParams = useSearchParams();
  const { apiBase, token, outbox, mutateWithQueue } = useSessionConfig();
  const [items, setItems] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [graph, setGraph] = useState<ArtifactGraph | null>(null);
  const [versions, setVersions] = useState<ArtifactVersions | null>(null);
  const [status, setStatus] = useState("Ready");
  const [quickTitle, setQuickTitle] = useState("Workspace clip");
  const [quickUrl, setQuickUrl] = useState("");
  const [quickClip, setQuickClip] = useState("Capture from artifact workspace.");
  const [deferAi, setDeferAi] = useState(false);
  const visibleItems = useMemo(() => applyOptimisticArtifacts(items, outbox), [items, outbox]);

  const loadArtifacts = useCallback(async () => {
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
  }, [apiBase, token, selectedId]);

  async function createArtifact() {
    try {
      const result = await mutateWithQueue<{ artifact: Artifact }>(
        "/v1/capture",
        {
          method: "POST",
          body: JSON.stringify({
            source_type: "clip_manual",
            capture_source: "pwa_workspace",
            title: quickTitle || "Workspace clip",
            source_url: quickUrl || undefined,
            raw: { text: quickClip, mime_type: "text/plain" },
            normalized: { text: quickClip, mime_type: "text/plain" },
            extracted: { text: quickClip, mime_type: "text/plain" },
            metadata: { source: "artifacts_page" },
          }),
        },
        {
          label: `Capture artifact: ${quickTitle || "Workspace clip"}`,
          entity: "artifact",
          op: "create",
        },
      );
      if (result.queued || !result.data) {
        setStatus("Capture queued for replay");
        setQuickClip("");
        return;
      }

      setStatus(`Captured artifact ${result.data.artifact.id}`);
      setSelectedId(result.data.artifact.id);
      setQuickClip("");
      await loadArtifacts();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create artifact");
    }
  }

  const loadArtifactContext = useCallback(async (artifactId: string) => {
    try {
      const [graphPayload, versionPayload] = await Promise.all([
        apiRequest<ArtifactGraph>(apiBase, token, `/v1/artifacts/${artifactId}/graph`),
        apiRequest<ArtifactVersions>(apiBase, token, `/v1/artifacts/${artifactId}/versions`),
      ]);
      setGraph(graphPayload);
      setVersions(versionPayload);
      setStatus(`Loaded graph for ${artifactId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load graph");
    }
  }, [apiBase, token]);

  async function runAction(action: "summarize" | "cards" | "tasks" | "append_note") {
    if (!selectedId) {
      setStatus("Select an artifact first");
      return;
    }

    try {
      const result = await mutateWithQueue(
        `/v1/artifacts/${selectedId}/actions`,
        {
          method: "POST",
          body: JSON.stringify({ action, defer: deferAi, provider_hint: deferAi ? "codex_local" : undefined }),
        },
        {
          label: `Artifact action: ${action}`,
          entity: "artifact_action",
          op: action,
        },
      );
      if (result.queued) {
        setStatus(`${action} queued for replay on ${selectedId}`);
        return;
      }

      setStatus(
        deferAi
          ? `${action} queued for Codex batch processing on ${selectedId}`
          : `${action} suggested for ${selectedId}`,
      );
      await loadArtifactContext(selectedId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${action} failed`);
    }
  }

  useEffect(() => {
    if (token) {
      loadArtifacts().catch(() => undefined);
    }
  }, [token, loadArtifacts]);

  useEffect(() => {
    if (selectedId && !selectedId.startsWith("pending:")) {
      loadArtifactContext(selectedId).catch(() => undefined);
    } else {
      setGraph(null);
      setVersions(null);
    }
  }, [selectedId, loadArtifactContext]);

  useEffect(() => {
    const requestedId = searchParams.get("artifact");
    if (!requestedId) {
      if (!selectedId && visibleItems[0]) {
        setSelectedId(visibleItems[0].id);
      }
      return;
    }

    const requestedArtifact = visibleItems.find((artifact) => artifact.id === requestedId);
    if (requestedArtifact) {
      setSelectedId(requestedArtifact.id);
    }
  }, [searchParams, selectedId, visibleItems]);

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Artifacts</p>
          <h1>Clip inbox and references</h1>
          <p className="console-copy">Review everything clipped from browser, desktop helper, and mobile share.</p>
          <label className="label" htmlFor="quick-title">Title</label>
          <input
            id="quick-title"
            className="input"
            value={quickTitle}
            onChange={(event) => setQuickTitle(event.target.value)}
          />
          <label className="label" htmlFor="quick-url">Source URL (optional)</label>
          <input
            id="quick-url"
            className="input"
            value={quickUrl}
            onChange={(event) => setQuickUrl(event.target.value)}
            placeholder="https://..."
          />
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
            <Link className="button" href="/ai-jobs">AI Jobs</Link>
          </div>
          <label className="label" htmlFor="defer-ai">
            <input
              id="defer-ai"
              type="checkbox"
              checked={deferAi}
              onChange={(event) => setDeferAi(event.target.checked)}
            />{" "}
            Queue summarize/cards/tasks for local Codex runner instead of running now
          </label>
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
          {visibleItems.length === 0 ? (
            <p className="console-copy">No artifacts yet.</p>
          ) : (
            <ul>
              {visibleItems.map((artifact) => (
                <li key={artifact.id}>
                  <button className="button" type="button" onClick={() => {
                    setSelectedId(artifact.id);
                  }}>
                    {artifact.title || artifact.id} ({artifact.source_type})
                  </button>
                  {artifact.pending ? (
                    <p className="console-copy">Pending: {artifact.pendingLabel || "queued mutation"}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <h2>Linked graph</h2>
          {selectedId.startsWith("pending:") ? (
            <p className="console-copy">Replay the queued capture before graph data is available.</p>
          ) : !graph ? (
            <p className="console-copy">Select an artifact to inspect graph links.</p>
          ) : (
            <div>
              <p className="console-copy">Summaries: {graph.summaries.length}</p>
              <p className="console-copy">Cards: {graph.cards.length}</p>
              <p className="console-copy">Tasks: {graph.tasks.length}</p>
              <p className="console-copy">Notes: {graph.notes.length}</p>
              <p className="console-copy">Relations: {graph.relations.length}</p>
              {graph.relations.slice(0, 4).map((relation) => (
                <p key={relation.id} className="console-copy">
                  {relation.relation_type} → {relation.target_type} ({relation.target_id})
                </p>
              ))}
            </div>
          )}

          <h2>Version history</h2>
          {selectedId.startsWith("pending:") ? (
            <p className="console-copy">Replay the queued capture before version history is available.</p>
          ) : !versions ? (
            <p className="console-copy">Select an artifact to inspect versions.</p>
          ) : (
            <div>
              <p className="console-copy">Summary versions: {versions.summaries.length}</p>
              <p className="console-copy">Card set versions: {versions.card_sets.length}</p>
              <p className="console-copy">Action runs: {versions.actions.length}</p>
              {versions.actions.slice(0, 5).map((action) => (
                <p key={action.id} className="console-copy">
                  {action.action} [{action.status}]
                </p>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default function ArtifactsPage() {
  return (
    <Suspense fallback={<main className="shell"><section className="workspace glass"><p className="status">Loading artifacts...</p></section></main>}>
      <ArtifactsPageContent />
    </Suspense>
  );
}
