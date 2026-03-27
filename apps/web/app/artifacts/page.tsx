"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { PaneRestoreStrip, PaneToggleButton } from "../components/pane-controls";
import {
  readEntityCacheScope,
  readEntityCacheValue,
  replaceEntityCacheScope,
  writeEntityCacheEntry,
} from "../lib/entity-cache";
import {
  ENTITY_CACHE_INVALIDATION_EVENT,
  cachePrefixesIntersect,
  clearEntityCachesStale,
  hasStaleEntityCache,
  readEntitySnapshot,
  readEntitySnapshotAsync,
  writeEntitySnapshot,
} from "../lib/entity-snapshot";
import { usePaneCollapsed } from "../lib/pane-state";
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

const ARTIFACT_ITEMS_SNAPSHOT = "artifacts.items";
const ARTIFACT_SELECTED_SNAPSHOT = "artifacts.selected";
const ARTIFACT_GRAPH_SNAPSHOT = "artifacts.graph";
const ARTIFACT_VERSIONS_SNAPSHOT = "artifacts.versions";
const ARTIFACT_CACHE_PREFIXES = ["artifacts."];
const ARTIFACT_ITEMS_ENTITY_SCOPE = "artifacts.items";
const ARTIFACT_GRAPH_ENTITY_SCOPE = "artifacts.graph";
const ARTIFACT_VERSIONS_ENTITY_SCOPE = "artifacts.versions";
const ARTIFACT_NODE_LIMIT = 8;
const ARTIFACT_FILTER_HUD_PANE_SNAPSHOT = "artifacts.pane.filter_hud";
const ARTIFACT_INSPECTOR_PANE_SNAPSHOT = "artifacts.pane.inspector";

function artifactGraphCacheKey(artifactId: string): string {
  return `artifacts.graph:${artifactId}`;
}

function artifactVersionsCacheKey(artifactId: string): string {
  return `artifacts.versions:${artifactId}`;
}

function artifactGraphSearchText(graph: ArtifactGraph): string {
  return [
    graph.artifact.title,
    graph.artifact.source_type,
    ...graph.summaries.map((summary) => summary.content),
    ...graph.cards.map((card) => card.prompt),
    ...graph.tasks.map((task) => `${task.title} ${task.status}`),
    ...graph.notes.map((note) => note.title),
  ]
    .filter(Boolean)
    .join(" ");
}

function artifactVersionsSearchText(versions: ArtifactVersions): string {
  return [
    ...versions.actions.map((action) => `${action.action} ${action.status}`),
    ...versions.summaries.map((summary) => `summary version ${summary.version}`),
    ...versions.card_sets.map((cardSet) => `card set version ${cardSet.version}`),
  ].join(" ");
}

function cacheArtifactItems(items: Artifact[]): void {
  void replaceEntityCacheScope(
    ARTIFACT_ITEMS_ENTITY_SCOPE,
    items.map((artifact) => ({
      id: artifact.id,
      value: artifact,
      updated_at: artifact.created_at,
      search_text: [artifact.title, artifact.source_type].filter(Boolean).join(" "),
    })),
  );
}

function cacheArtifactContext(
  artifactId: string,
  graphPayload: ArtifactGraph,
  versionPayload: ArtifactVersions,
): void {
  void Promise.all([
    writeEntityCacheEntry(ARTIFACT_GRAPH_ENTITY_SCOPE, {
      id: artifactId,
      value: graphPayload,
      updated_at: graphPayload.artifact.created_at,
      search_text: artifactGraphSearchText(graphPayload),
    }),
    writeEntityCacheEntry(ARTIFACT_VERSIONS_ENTITY_SCOPE, {
      id: artifactId,
      value: versionPayload,
      updated_at:
        versionPayload.actions[0]?.created_at ??
        versionPayload.summaries[0]?.created_at ??
        graphPayload.artifact.created_at,
      search_text: artifactVersionsSearchText(versionPayload),
    }),
  ]);
}

type ArtifactCategory = "raw" | "summary" | "task";

type ArtifactGraphNode = {
  artifact: Artifact;
  category: ArtifactCategory;
  x: number;
  y: number;
};

function resolveArtifactCategory(sourceType: string): ArtifactCategory {
  const normalized = sourceType.toLowerCase();
  if (normalized.includes("summary") || normalized.includes("note")) {
    return "summary";
  }
  if (normalized.includes("task") || normalized.includes("review")) {
    return "task";
  }
  return "raw";
}

function categoryEnabled(category: ArtifactCategory, raw: boolean, summary: boolean, task: boolean): boolean {
  if (category === "raw") {
    return raw;
  }
  if (category === "summary") {
    return summary;
  }
  return task;
}

function categoryColor(category: ArtifactCategory): string {
  if (category === "summary") {
    return "#9c89ff";
  }
  if (category === "task") {
    return "#f59e0b";
  }
  return "#94a3b8";
}

function buildArtifactGraphNodes(artifacts: Artifact[]): ArtifactGraphNode[] {
  if (artifacts.length === 0) {
    return [];
  }
  const radiusX = 34;
  const radiusY = 32;
  const centerX = 44;
  const centerY = 50;
  return artifacts.map((artifact, index) => {
    const angle = (Math.PI * 2 * index) / artifacts.length - Math.PI / 2;
    return {
      artifact,
      category: resolveArtifactCategory(artifact.source_type),
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    };
  });
}

function ArtifactsPageContent() {
  const searchParams = useSearchParams();
  const { apiBase, token, outbox, mutateWithQueue } = useSessionConfig();
  const filterHudPane = usePaneCollapsed(ARTIFACT_FILTER_HUD_PANE_SNAPSHOT);
  const inspectorPane = usePaneCollapsed(ARTIFACT_INSPECTOR_PANE_SNAPSHOT);
  const [items, setItems] = useState<Artifact[]>(() => readEntitySnapshot<Artifact[]>(ARTIFACT_ITEMS_SNAPSHOT, []));
  const [selectedId, setSelectedId] = useState<string>(() => readEntitySnapshot<string>(ARTIFACT_SELECTED_SNAPSHOT, ""));
  const [graph, setGraph] = useState<ArtifactGraph | null>(() => readEntitySnapshot<ArtifactGraph | null>(ARTIFACT_GRAPH_SNAPSHOT, null));
  const [versions, setVersions] = useState<ArtifactVersions | null>(() => readEntitySnapshot<ArtifactVersions | null>(ARTIFACT_VERSIONS_SNAPSHOT, null));
  const [status, setStatus] = useState("Ready");
  const [quickTitle, setQuickTitle] = useState("Workspace clip");
  const [quickUrl, setQuickUrl] = useState("");
  const [quickClip, setQuickClip] = useState("Capture from artifact workspace.");
  const [deferAi, setDeferAi] = useState(false);
  const [showRaw, setShowRaw] = useState(true);
  const [showSummary, setShowSummary] = useState(true);
  const [showTask, setShowTask] = useState(true);
  const visibleItems = useMemo(() => applyOptimisticArtifacts(items, outbox), [items, outbox]);
  const filteredArtifacts = useMemo(
    () => visibleItems.filter((artifact) => categoryEnabled(resolveArtifactCategory(artifact.source_type), showRaw, showSummary, showTask)),
    [showRaw, showSummary, showTask, visibleItems],
  );
  const selectedArtifact = useMemo(
    () => visibleItems.find((artifact) => artifact.id === selectedId) || graph?.artifact || null,
    [graph?.artifact, selectedId, visibleItems],
  );
  const selectedGraphRelations = graph?.relations.slice(0, 3) ?? [];
  const graphNodes = useMemo(() => {
    const limited = filteredArtifacts.slice(0, ARTIFACT_NODE_LIMIT);
    if (selectedArtifact && !limited.some((artifact) => artifact.id === selectedArtifact.id)) {
      limited[0] = selectedArtifact;
    }
    return buildArtifactGraphNodes(limited);
  }, [filteredArtifacts, selectedArtifact]);

  useEffect(() => {
    setItems((previous) => previous.length > 0 ? previous : readEntitySnapshot<Artifact[]>(ARTIFACT_ITEMS_SNAPSHOT, []));
    setSelectedId((previous) => previous || readEntitySnapshot<string>(ARTIFACT_SELECTED_SNAPSHOT, ""));
    setGraph((previous) => previous ?? readEntitySnapshot<ArtifactGraph | null>(ARTIFACT_GRAPH_SNAPSHOT, null));
    setVersions((previous) => previous ?? readEntitySnapshot<ArtifactVersions | null>(ARTIFACT_VERSIONS_SNAPSHOT, null));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const cachedSelectedId = await readEntitySnapshotAsync<string>(ARTIFACT_SELECTED_SNAPSHOT, "");
      const [entityItems, bootstrapItems, bootstrapGraph, bootstrapVersions, cachedGraph, cachedVersions] =
        await Promise.all([
          readEntityCacheScope<Artifact>(ARTIFACT_ITEMS_ENTITY_SCOPE),
          readEntitySnapshotAsync<Artifact[]>(ARTIFACT_ITEMS_SNAPSHOT, []),
          readEntitySnapshotAsync<ArtifactGraph | null>(ARTIFACT_GRAPH_SNAPSHOT, null),
          readEntitySnapshotAsync<ArtifactVersions | null>(ARTIFACT_VERSIONS_SNAPSHOT, null),
          cachedSelectedId
            ? readEntityCacheValue<ArtifactGraph | null>(ARTIFACT_GRAPH_ENTITY_SCOPE, cachedSelectedId, null)
            : Promise.resolve(null),
          cachedSelectedId
            ? readEntityCacheValue<ArtifactVersions | null>(
                ARTIFACT_VERSIONS_ENTITY_SCOPE,
                cachedSelectedId,
                null,
              )
            : Promise.resolve(null),
        ]);

      if (cancelled) {
        return;
      }

      const cachedItems = entityItems.length > 0 ? entityItems : bootstrapItems;
      if (cachedItems.length > 0) {
        setItems(cachedItems);
      }
      if (cachedSelectedId) {
        setSelectedId((previous) => previous || cachedSelectedId);
      }
      const graphFallback =
        cachedGraph ??
        (!cachedSelectedId || bootstrapGraph?.artifact.id === cachedSelectedId ? bootstrapGraph : null);
      const versionsFallback =
        cachedVersions ??
        (!cachedSelectedId || bootstrapGraph?.artifact.id === cachedSelectedId ? bootstrapVersions : null);
      if (graphFallback) {
        setGraph(graphFallback);
      }
      if (versionsFallback) {
        setVersions(versionsFallback);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadArtifacts = useCallback(async () => {
    try {
      const data = await apiRequest<Artifact[]>(apiBase, token, "/v1/artifacts");
      setItems(data);
      writeEntitySnapshot(ARTIFACT_ITEMS_SNAPSHOT, data);
      cacheArtifactItems(data);
      clearEntityCachesStale(ARTIFACT_CACHE_PREFIXES);
      setStatus(`Loaded ${data.length} artifacts`);
      if (!selectedId && data.length > 0) {
        setSelectedId(data[0].id);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to load artifacts";
      setStatus(items.length > 0 ? `Loaded cached artifacts. ${detail}` : detail);
    }
  }, [apiBase, items.length, token, selectedId]);

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
      writeEntitySnapshot(ARTIFACT_GRAPH_SNAPSHOT, graphPayload);
      writeEntitySnapshot(ARTIFACT_VERSIONS_SNAPSHOT, versionPayload);
      writeEntitySnapshot(artifactGraphCacheKey(artifactId), graphPayload, { persistBootstrap: false });
      writeEntitySnapshot(artifactVersionsCacheKey(artifactId), versionPayload, { persistBootstrap: false });
      cacheArtifactContext(artifactId, graphPayload, versionPayload);
      clearEntityCachesStale(ARTIFACT_CACHE_PREFIXES);
      setStatus(`Loaded graph for ${artifactId}`);
    } catch (error) {
      const sharedBootstrapGraph = readEntitySnapshot<ArtifactGraph | null>(ARTIFACT_GRAPH_SNAPSHOT, null);
      const sharedBootstrapVersions = readEntitySnapshot<ArtifactVersions | null>(ARTIFACT_VERSIONS_SNAPSHOT, null);
      const [cachedGraph, cachedVersions, bootstrapGraph, bootstrapVersions] = await Promise.all([
        readEntityCacheValue<ArtifactGraph | null>(ARTIFACT_GRAPH_ENTITY_SCOPE, artifactId, null),
        readEntityCacheValue<ArtifactVersions | null>(ARTIFACT_VERSIONS_ENTITY_SCOPE, artifactId, null),
        readEntitySnapshotAsync<ArtifactGraph | null>(artifactGraphCacheKey(artifactId), null),
        readEntitySnapshotAsync<ArtifactVersions | null>(artifactVersionsCacheKey(artifactId), null),
      ]);
      const graphFallback =
        cachedGraph ??
        bootstrapGraph ??
        (sharedBootstrapGraph?.artifact.id === artifactId ? sharedBootstrapGraph : null);
      const versionsFallback =
        cachedVersions ??
        bootstrapVersions ??
        (sharedBootstrapGraph?.artifact.id === artifactId ? sharedBootstrapVersions : null);

      setGraph(graphFallback);
      setVersions(versionsFallback);

      const detail = error instanceof Error ? error.message : "Failed to load graph";
      setStatus(graphFallback || versionsFallback ? `Loaded cached graph. ${detail}` : detail);
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
    if (!selectedId || selectedId.startsWith("pending:")) {
      setGraph(null);
      setVersions(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const bootstrapGraph = readEntitySnapshot<ArtifactGraph | null>(ARTIFACT_GRAPH_SNAPSHOT, null);
      const bootstrapVersions = readEntitySnapshot<ArtifactVersions | null>(ARTIFACT_VERSIONS_SNAPSHOT, null);
      const [cachedGraph, cachedVersions] = await Promise.all([
        readEntityCacheValue<ArtifactGraph | null>(ARTIFACT_GRAPH_ENTITY_SCOPE, selectedId, null),
        readEntityCacheValue<ArtifactVersions | null>(ARTIFACT_VERSIONS_ENTITY_SCOPE, selectedId, null),
      ]);

      if (cancelled) {
        return;
      }

      setGraph(cachedGraph ?? (bootstrapGraph?.artifact.id === selectedId ? bootstrapGraph : null));
      setVersions(
        cachedVersions ?? (bootstrapGraph?.artifact.id === selectedId ? bootstrapVersions : null),
      );

      if (cancelled) {
        return;
      }

      void loadArtifactContext(selectedId);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, loadArtifactContext]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const refreshIfStale = () => {
      if (!window.navigator.onLine || !hasStaleEntityCache(ARTIFACT_CACHE_PREFIXES)) {
        return;
      }
      loadArtifacts().catch(() => undefined);
      if (selectedId && !selectedId.startsWith("pending:")) {
        loadArtifactContext(selectedId).catch(() => undefined);
      }
    };

    refreshIfStale();

    const onInvalidation = (event: Event) => {
      const detail = (event as CustomEvent<{ prefixes: string[] }>).detail;
      if (detail && cachePrefixesIntersect(detail.prefixes, ARTIFACT_CACHE_PREFIXES)) {
        refreshIfStale();
      }
    };

    window.addEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    return () => {
      window.removeEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    };
  }, [loadArtifactContext, loadArtifacts, selectedId, token]);

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

  useEffect(() => {
    writeEntitySnapshot(ARTIFACT_SELECTED_SNAPSHOT, selectedId);
  }, [selectedId]);

  return (
    <main className="artifact-nexus-shell">
      <section className="artifact-nexus-canvas">
        <PaneRestoreStrip
          className="pane-restore-strip-floating"
          actions={[
            ...(filterHudPane.collapsed ? [{ id: "filters", label: "Show filter HUD", onClick: filterHudPane.expand }] : []),
            ...(inspectorPane.collapsed ? [{ id: "inspector", label: "Show inspector", onClick: inspectorPane.expand }] : []),
          ]}
        />

        {!filterHudPane.collapsed ? <aside className="artifact-filter-hud">
          <div className="artifact-pane-head">
            <h2>Reading Filters</h2>
            <PaneToggleButton label="Hide pane" onClick={filterHudPane.collapse} />
          </div>
          <label htmlFor="filter-raw">
            <input id="filter-raw" type="checkbox" checked={showRaw} onChange={(event) => setShowRaw(event.target.checked)} />
            Raw Clips
          </label>
          <label htmlFor="filter-summary">
            <input id="filter-summary" type="checkbox" checked={showSummary} onChange={(event) => setShowSummary(event.target.checked)} />
            Summaries
          </label>
          <label htmlFor="filter-task">
            <input id="filter-task" type="checkbox" checked={showTask} onChange={(event) => setShowTask(event.target.checked)} />
            Extracted Tasks
          </label>
          <div className="artifact-filter-stats">
            <span>Visible nodes: {graphNodes.length}</span>
            <span>Inbox: {visibleItems.length}</span>
          </div>
        </aside> : null}

        <div className="artifact-graph" aria-hidden="true">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            {graphNodes.map((node, index) => {
              const next = graphNodes[(index + 1) % graphNodes.length];
              if (!next || index === graphNodes.length - 1) {
                return null;
              }
              return (
                <line
                  key={`edge-${node.artifact.id}-${next.artifact.id}`}
                  x1={node.x}
                  y1={node.y}
                  x2={next.x}
                  y2={next.y}
                  stroke="rgba(148,163,184,0.28)"
                  strokeWidth="0.24"
                />
              );
            })}
            {graphNodes.map((node) => {
              const active = node.artifact.id === selectedId;
              const label = (node.artifact.title || node.artifact.id).slice(0, 12);
              return (
                <g
                  key={node.artifact.id}
                  className={active ? "artifact-node active" : "artifact-node"}
                  onClick={() => {
                    setSelectedId(node.artifact.id);
                  }}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={active ? 2.15 : 1.7}
                    fill="rgba(16, 11, 31, 0.92)"
                    stroke={categoryColor(node.category)}
                    strokeWidth={active ? 0.55 : 0.3}
                  />
                  <text
                    x={node.x}
                    y={node.y + 4.1}
                    fill="#94a3b8"
                    textAnchor="middle"
                    fontFamily="JetBrains Mono"
                    fontSize="1.2"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <section className={selectedArtifact ? "artifact-scene-card" : "artifact-scene-card empty"}>
          <div className="artifact-scene-meta">
            <span className="artifact-scene-tag">{selectedArtifact ? selectedArtifact.source_type : "graph.idle"}</span>
            <span>{selectedArtifact ? selectedArtifact.id : "Awaiting first clip"}</span>
          </div>
          <h2>{selectedArtifact?.title || "Enter the reading room"}</h2>
          <p className="artifact-scene-copy">
            {selectedArtifact
              ? "Keep the raw source intact, let the distilled answer rise to the front, and preserve the lineage around it."
              : "Create a clip or select an artifact to populate the room with source history, versions, and extraction lineage."}
          </p>
          {selectedArtifact ? (
            <div className="artifact-scene-stats">
              <span>Summaries {graph?.summaries.length ?? 0}</span>
              <span>Cards {graph?.cards.length ?? 0}</span>
              <span>Versions {versions?.actions.length ?? 0}</span>
            </div>
          ) : (
            <div className="artifact-scene-actions">
              <button className="button" type="button" onClick={() => createArtifact()}>
                Create Clip
              </button>
              <button className="button" type="button" onClick={() => loadArtifacts()}>
                Refresh Room
              </button>
            </div>
          )}
          {selectedGraphRelations.length > 0 ? (
            <div className="artifact-scene-links">
              {selectedGraphRelations.map((relation) => (
                <span key={relation.id}>
                  {relation.relation_type} {"->"} {relation.target_type}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {!inspectorPane.collapsed ? <aside className="artifact-inspector">
          <header className="artifact-inspector-header">
            <div className="artifact-pane-head">
              <div>
                <p className="eyebrow">Artifact Nexus</p>
                <h1>Reading room and lineage</h1>
                <p className="status">{status}</p>
              </div>
              <PaneToggleButton label="Hide pane" onClick={inspectorPane.collapse} />
            </div>
          </header>

          <div className="artifact-inspector-body">
            <article className="artifact-card">
              <h2>Reading Stack</h2>
              {visibleItems.length === 0 ? (
                <p className="console-copy">No artifacts in the room yet.</p>
              ) : (
                <ul className="artifact-inbox-list">
                  {visibleItems.map((artifact) => (
                    <li key={artifact.id}>
                      <button
                        className={artifact.id === selectedId ? "button artifact-inbox-button active" : "button artifact-inbox-button"}
                        type="button"
                        onClick={() => {
                          setSelectedId(artifact.id);
                        }}
                      >
                        {artifact.title || artifact.id} ({artifact.source_type})
                      </button>
                      {artifact.pending ? (
                        <p className="console-copy">Pending: {artifact.pendingLabel || "queued mutation"}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="artifact-card">
              <h2>Source Notes</h2>
              {!selectedArtifact ? (
                <p className="console-copy">Select an artifact to inspect source notes.</p>
              ) : (
                <dl className="artifact-metadata-grid">
                  <dt>Artifact</dt>
                  <dd>{selectedArtifact.title || selectedArtifact.id}</dd>
                  <dt>Source</dt>
                  <dd>{selectedArtifact.source_type}</dd>
                  <dt>Created</dt>
                  <dd>{new Date(selectedArtifact.created_at).toLocaleString()}</dd>
                  <dt>Status</dt>
                  <dd>{selectedArtifact.pending ? "queued" : "captured"}</dd>
                </dl>
              )}
            </article>

            <article className="artifact-card">
              <h2>Lineage</h2>
              {selectedId.startsWith("pending:") ? (
                <p className="console-copy">Replay the queued capture before lineage is available.</p>
              ) : !graph ? (
                <p className="console-copy">Select an artifact to inspect linked lineage.</p>
              ) : (
                <>
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
                </>
              )}
            </article>

            <article className="artifact-card">
              <h2>Version History</h2>
              {selectedId.startsWith("pending:") ? (
                <p className="console-copy">Replay the queued capture before version history is available.</p>
              ) : !versions ? (
                <p className="console-copy">Select an artifact to inspect versions.</p>
              ) : (
                <>
                  <p className="console-copy">Summary versions: {versions.summaries.length}</p>
                  <p className="console-copy">Card set versions: {versions.card_sets.length}</p>
                  <p className="console-copy">Action runs: {versions.actions.length}</p>
                  <div className="artifact-version-list">
                    {versions.actions.slice(0, 5).map((action) => (
                      <p key={action.id} className="console-copy">
                        {action.action} [{action.status}]
                      </p>
                    ))}
                  </div>
                </>
              )}
            </article>

            <article className="artifact-card">
              <h2>Curated Actions</h2>
              <div className="button-row">
                <button className="button" type="button" onClick={() => runAction("summarize")}>Distill Summary</button>
                <button className="button" type="button" onClick={() => runAction("cards")}>Make Cards</button>
                <button className="button" type="button" onClick={() => runAction("tasks")}>Suggest Tasks</button>
                <button className="button" type="button" onClick={() => runAction("append_note")}>Create Note</button>
                <Link className="button" href="/ai-jobs">AI Jobs</Link>
              </div>
              <label className="label" htmlFor="defer-ai">
                <input
                  id="defer-ai"
                  type="checkbox"
                  checked={deferAi}
                  onChange={(event) => setDeferAi(event.target.checked)}
                />{" "}
                Queue summarize/cards/tasks for the local Codex runner instead of running now
              </label>
            </article>

            <details className="artifact-quick-capture" open>
              <summary>Quick capture</summary>
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
              </div>
            </details>
          </div>
        </aside> : null}
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
