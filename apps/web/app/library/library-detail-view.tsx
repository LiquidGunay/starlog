"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AprilWorkspaceShell } from "../components/april-observatory-shell";
import { ApiError, apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";
import styles from "./detail.module.css";

type ArtifactActionKind = "summarize" | "cards" | "tasks" | "append_note";
type DetailActionKind = ArtifactActionKind | "archive" | "link" | string;

type LegacyArtifact = {
  id: string;
  source_type: string;
  title?: string | null;
  raw_content?: string | null;
  normalized_content?: string | null;
  extracted_content?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type DetailLayer = {
  title?: string | null;
  content?: string | null;
  format?: string | null;
  present?: boolean;
  character_count?: number | null;
  checksum_sha256?: string | null;
  source_filename?: string | null;
  updated_at?: string | null;
};

type DetailAction = {
  action: DetailActionKind;
  label: string;
  description?: string | null;
  endpoint?: string | null;
  method?: string | null;
  enabled?: boolean;
  supported?: boolean;
  status?: string | null;
  disabled_reason?: string | null;
};

type DetailConnection = {
  id?: string | null;
  kind: string;
  title: string;
  href?: string | null;
  detail?: string | null;
  status?: string | null;
};

type DetailActivity = {
  id?: string | null;
  kind?: string | null;
  label: string;
  detail?: string | null;
  actor?: string | null;
  created_at: string;
  entity_type?: string | null;
  status?: string | null;
};

type ArtifactDetail = {
  id: string;
  title: string;
  artifact_type: string;
  status?: string | null;
  source?: string | null;
  source_url?: string | null;
  captured_at?: string | null;
  updated_at?: string | null;
  tags?: string[];
  summary?: string | null;
  summary_provenance?: string | null;
  key_ideas?: Array<string | { title?: string | null; detail?: string | null; provenance?: string | null }>;
  quick_note?: string | null;
  provenance?: Record<string, unknown>;
  layers?: {
    raw?: DetailLayer | null;
    normalized?: DetailLayer | null;
    extracted?: DetailLayer | null;
  };
  actions?: DetailAction[];
  connections?: DetailConnection[];
  activity?: DetailActivity[];
};

type ContractArtifact = {
  id: string;
  source_type: string;
  title?: string | null;
  created_at: string;
  updated_at: string;
};

type ContractCapture = {
  source_app?: string | null;
  source_type: string;
  source_url?: string | null;
  source_file?: string | null;
  capture_method?: string | null;
  captured_at: string;
  tags: string[];
};

type ContractSourceLayer = {
  layer: "raw" | "normalized" | "extracted";
  present: boolean;
  preview?: string | null;
  character_count?: number | null;
  mime_type?: string | null;
  checksum_sha256?: string | null;
  source_filename?: string | null;
};

type ContractLatestSummary = {
  id: string;
  version: number;
  provider: string;
  created_at: string;
  preview: string;
  character_count: number;
};

type ContractConnections = {
  summary_version_count: number;
  latest_summary?: ContractLatestSummary | null;
  card_count: number;
  card_set_version_count: number;
  task_count: number;
  note_count: number;
  notes: Array<{ id: string; title: string; version: number }>;
  relation_count: number;
  relations: Array<{
    id: string;
    artifact_id: string;
    relation_type: string;
    target_type: string;
    target_id: string;
    created_at: string;
  }>;
  action_run_count: number;
};

type ContractTimelineEvent = {
  kind: string;
  label: string;
  occurred_at: string;
  entity_type: string;
  entity_id: string;
  status?: string | null;
};

type ContractSuggestedAction = {
  action: DetailActionKind;
  label: string;
  enabled: boolean;
  method?: string | null;
  endpoint?: string | null;
  disabled_reason?: string | null;
};

type ArtifactDetailContract = {
  artifact: ContractArtifact;
  capture: ContractCapture;
  source_layers: ContractSourceLayer[];
  connections: ContractConnections;
  timeline: ContractTimelineEvent[];
  suggested_actions: ContractSuggestedAction[];
};

type ArtifactActionResponse = {
  artifact_id: string;
  action: ArtifactActionKind;
  status: string;
  output_ref?: string | null;
};

type LibraryDetailViewProps = {
  id: string;
  kind: "artifact" | "capture";
};

const DEFAULT_ACTIONS: DetailAction[] = [
  {
    action: "summarize",
    label: "Summarize",
    description: "Generate a concise summary with key points.",
    supported: false,
    enabled: false,
    disabled_reason: "Detail action availability is not recorded.",
  },
  {
    action: "cards",
    label: "Make cards",
    description: "Create atomic review items from stable ideas.",
    supported: false,
    enabled: false,
    disabled_reason: "Detail action availability is not recorded.",
  },
  {
    action: "tasks",
    label: "Create task",
    description: "Turn an insight into an actionable task.",
    supported: false,
    enabled: false,
    disabled_reason: "Detail action availability is not recorded.",
  },
  {
    action: "append_note",
    label: "Append to note",
    description: "Add this artifact to an existing note.",
    supported: false,
    enabled: false,
    disabled_reason: "Detail action availability is not recorded.",
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDate(value?: string | null): string {
  if (!value) {
    return "Unknown time";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function compactText(value?: string | null, fallback = "No preview available yet."): string {
  const compact = (value || "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return fallback;
  }
  return compact.length > 760 ? `${compact.slice(0, 760).trimEnd()}...` : compact;
}

function provenanceValue(provenance: Record<string, unknown>, key: string, fallback = "Not recorded"): string {
  return asString(provenance[key]) || fallback;
}

function captureMetadata(artifact: LegacyArtifact): Record<string, unknown> {
  return asRecord(artifact.metadata?.capture);
}

function fallbackDetailFromArtifact(artifact: LegacyArtifact): ArtifactDetail {
  const capture = captureMetadata(artifact);
  const sourceUrl = asString(capture.source_url);
  const captureSource = asString(capture.capture_source);
  const tags = Array.isArray(capture.tags) ? capture.tags.filter((tag): tag is string => typeof tag === "string") : [];

  return {
    id: artifact.id,
    title: artifact.title?.trim() || titleCase(artifact.source_type || "capture"),
    artifact_type: titleCase(artifact.source_type || "capture"),
    status: "fallback",
    source: captureSource ? titleCase(captureSource) : null,
    source_url: sourceUrl,
    captured_at: artifact.created_at,
    updated_at: artifact.updated_at,
    tags,
    summary: null,
    summary_provenance: null,
    key_ideas: [],
    quick_note: asString(capture.quick_note),
    provenance: {
      source_app: captureSource,
      url: sourceUrl,
      source_file: asString(capture.source_file) || asString(capture.source_filename),
      capture_method: asString(capture.capture_method),
      capture_time: artifact.created_at,
    },
    layers: {
      raw: { title: "Raw layer", content: artifact.raw_content, present: Boolean(artifact.raw_content), format: "source" },
      normalized: { title: "Normalized layer", content: artifact.normalized_content, present: Boolean(artifact.normalized_content), format: "text" },
      extracted: { title: "Extracted layer", content: artifact.extracted_content, present: Boolean(artifact.extracted_content), format: "extracted" },
    },
    actions: DEFAULT_ACTIONS,
    connections: [],
    activity: [],
  };
}

function layerTitle(layer: ContractSourceLayer): string {
  const format = layer.mime_type || layer.source_filename;
  return format ? `${titleCase(layer.layer)} layer (${format})` : `${titleCase(layer.layer)} layer`;
}

function detailActionDescription(action: DetailActionKind): string {
  if (action === "summarize") {
    return "Generate a concise summary with key points.";
  }
  if (action === "cards") {
    return "Create atomic review items from stable ideas.";
  }
  if (action === "tasks") {
    return "Turn an insight into an actionable task.";
  }
  if (action === "append_note") {
    return "Add this artifact to an existing note.";
  }
  return "This action is not available from the artifact action endpoint.";
}

function contractConnectionsToCards(connections: ContractConnections): DetailConnection[] {
  const cards: DetailConnection[] = [];
  if (connections.latest_summary) {
    cards.push({
      id: connections.latest_summary.id,
      kind: "summary",
      title: `Summary v${connections.latest_summary.version}`,
      detail: `${connections.latest_summary.provider} · ${formatDate(connections.latest_summary.created_at)} · ${connections.latest_summary.preview}`,
    });
  }
  if (connections.card_count > 0) {
    cards.push({
      kind: "review",
      title: `${connections.card_count} review card${connections.card_count === 1 ? "" : "s"}`,
      detail: `${connections.card_set_version_count} card set version${connections.card_set_version_count === 1 ? "" : "s"}`,
    });
  }
  if (connections.task_count > 0) {
    cards.push({
      kind: "task",
      title: `${connections.task_count} linked task${connections.task_count === 1 ? "" : "s"}`,
      detail: "Created from this artifact.",
    });
  }
  for (const note of connections.notes) {
    cards.push({
      id: note.id,
      kind: "note",
      title: note.title,
      detail: `Note v${note.version}`,
    });
  }
  for (const relation of connections.relations) {
    cards.push({
      id: relation.id,
      kind: relation.target_type,
      title: titleCase(relation.relation_type),
      detail: `${relation.target_type}: ${relation.target_id}`,
    });
  }
  if (connections.action_run_count > 0) {
    cards.push({
      kind: "action",
      title: `${connections.action_run_count} action run${connections.action_run_count === 1 ? "" : "s"}`,
      detail: "See timeline for status history.",
    });
  }
  return cards;
}

function normalizeContractDetail(payload: ArtifactDetailContract): ArtifactDetail {
  const layers = Object.fromEntries(
    payload.source_layers.map((layer) => [
      layer.layer,
      {
        title: layerTitle(layer),
        content: layer.preview,
        present: layer.present,
        format: layer.mime_type,
        character_count: layer.character_count,
        checksum_sha256: layer.checksum_sha256,
        source_filename: layer.source_filename,
      },
    ]),
  ) as ArtifactDetail["layers"];

  return {
    id: payload.artifact.id,
    title: payload.artifact.title?.trim() || titleCase(payload.artifact.source_type),
    artifact_type: titleCase(payload.artifact.source_type),
    source: payload.capture.source_app ? titleCase(payload.capture.source_app) : null,
    source_url: payload.capture.source_url || null,
    captured_at: payload.capture.captured_at,
    updated_at: payload.artifact.updated_at,
    tags: payload.capture.tags,
    summary: payload.connections.latest_summary?.preview || null,
    summary_provenance: payload.connections.latest_summary
      ? `Summary v${payload.connections.latest_summary.version} · ${payload.connections.latest_summary.provider} · ${formatDate(payload.connections.latest_summary.created_at)}`
      : null,
    key_ideas: [],
    quick_note: null,
    provenance: {
      source_app: payload.capture.source_app,
      source_type: payload.capture.source_type,
      url: payload.capture.source_url,
      source_file: payload.capture.source_file,
      capture_method: payload.capture.capture_method,
      capture_time: payload.capture.captured_at,
      summary_version_count: String(payload.connections.summary_version_count),
      card_count: String(payload.connections.card_count),
      task_count: String(payload.connections.task_count),
      note_count: String(payload.connections.note_count),
      relation_count: String(payload.connections.relation_count),
    },
    layers,
    actions: payload.suggested_actions.map((action) => ({
      action: action.action,
      label: action.label,
      description: detailActionDescription(action.action),
      endpoint: action.endpoint,
      method: action.method,
      enabled: action.enabled,
      supported: action.enabled && action.method === "POST" && Boolean(action.endpoint) && isSupportedPostAction(action.action),
      disabled_reason: action.disabled_reason || null,
    })),
    connections: contractConnectionsToCards(payload.connections),
    activity: payload.timeline.map((event) => ({
      id: event.entity_id,
      kind: event.kind,
      label: event.label,
      created_at: event.occurred_at,
      entity_type: event.entity_type,
      status: event.status,
    })),
  };
}

function isSupportedPostAction(action: DetailActionKind): action is ArtifactActionKind {
  return action === "summarize" || action === "cards" || action === "tasks" || action === "append_note";
}

function mergeActions(actions?: DetailAction[]): DetailAction[] {
  const byAction = new Map(DEFAULT_ACTIONS.map((action) => [action.action, action]));
  for (const action of actions || []) {
    const isSupportedMethod = action.method === "POST";
    byAction.set(action.action, {
      ...byAction.get(action.action),
      ...action,
      supported: Boolean(action.supported || action.enabled) && isSupportedMethod && isSupportedPostAction(action.action) && Boolean(action.endpoint),
    });
  }
  return [...byAction.values()].map((action) => ({
    ...action,
    supported: Boolean(action.supported || action.enabled) && action.method === "POST" && isSupportedPostAction(action.action) && Boolean(action.endpoint),
    disabled_reason: (action.supported || action.enabled) && (action.method !== "POST" || !isSupportedPostAction(action.action))
      ? "This action is not wired to the artifact action endpoint yet."
      : action.disabled_reason,
  }));
}

export function LibraryDetailView({ id, kind }: LibraryDetailViewProps) {
  const { apiBase, token, outbox, mutateWithQueue } = useSessionConfig();
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [status, setStatus] = useState("Loading Library detail...");
  const [actionStatus, setActionStatus] = useState<Record<string, string>>({});

  const loadDetail = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const payload = await apiRequest<ArtifactDetailContract>(
        apiBase,
        token,
        `/v1/artifacts/${id}/detail`,
      );
      setDetail(normalizeContractDetail(payload));
      setStatus("Loaded artifact detail");
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 501)) {
        try {
          const artifacts = await apiRequest<LegacyArtifact[]>(apiBase, token, "/v1/artifacts");
          const artifact = artifacts.find((item) => item.id === id);
          if (!artifact) {
            setStatus("Artifact was not found in Library fallback data.");
            return;
          }
          setDetail(fallbackDetailFromArtifact(artifact));
          setStatus("Showing fallback detail from the artifact list.");
          return;
        } catch (fallbackError) {
          setStatus(fallbackError instanceof Error ? fallbackError.message : "Failed to load fallback artifact data.");
          return;
        }
      }
      setStatus(error instanceof Error ? error.message : "Failed to load artifact detail.");
    }
  }, [apiBase, id, token]);

  useEffect(() => {
    loadDetail().catch(() => undefined);
  }, [loadDetail]);

  const actions = useMemo(() => mergeActions(detail?.actions), [detail?.actions]);
  const provenance = useMemo(() => asRecord(detail?.provenance), [detail?.provenance]);
  const sourceUrl = detail?.source_url || asString(provenance.url);
  const sourceFile = asString(provenance.source_file);
  const layers = detail?.layers || {};
  const connections = detail?.connections || [];
  const activity = detail?.activity || [];
  const tags = detail?.tags || [];

  async function handleAction(action: DetailAction) {
    if (!detail || !isSupportedPostAction(action.action) || !action.supported || !action.endpoint) {
      return;
    }

    setActionStatus((current) => ({ ...current, [action.action]: "Requesting..." }));
    try {
      const result = await mutateWithQueue<ArtifactActionResponse>(
        action.endpoint,
        {
          method: "POST",
          body: JSON.stringify({ action: action.action }),
        },
        {
          label: `Artifact action: ${action.action}`,
          entity: "artifact_action",
          op: action.action,
        },
      );

      if (result.queued) {
        setActionStatus((current) => ({ ...current, [action.action]: "Queued for replay" }));
        setStatus(`${action.label} queued for replay.`);
        return;
      }

      const nextStatus = result.data?.status || "requested";
      setActionStatus((current) => ({ ...current, [action.action]: titleCase(nextStatus) }));
      setStatus(`${action.label} ${nextStatus}.`);
      await loadDetail();
    } catch (error) {
      const message = error instanceof Error ? error.message : `${action.label} failed.`;
      setActionStatus((current) => ({ ...current, [action.action]: message }));
      setStatus(message);
    }
  }

  return (
    <AprilWorkspaceShell
      activeSurface="knowledge-base"
      brandMeta="Library detail"
      statusLabel={status}
      queueLabel={`${outbox.length} queued`}
      ctaLabel="Quick capture"
      searchLabel="Library detail"
      searchAriaLabel="Library detail search"
      searchPlaceholder="Inspect source, layers, outputs..."
      railSlot={(
        <>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Detail board</span>
            <div className="april-rail-link-stack">
              <a href="#artifact-detail">Artifact detail</a>
              <a href="#source-provenance">Source provenance</a>
              <a href="#conversion-actions">Conversions</a>
              <a href="#activity-timeline">Activity</a>
            </div>
          </div>
        </>
      )}
    >
      <div className={styles.surface}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link href="/library">Library</Link>
          <span aria-hidden="true">/</span>
          <span>{kind === "capture" ? "Capture" : "Artifact"}</span>
          <span aria-hidden="true">/</span>
          <strong>{detail?.title || id}</strong>
        </nav>

        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Library detail</p>
            <h1>{detail?.title || "Artifact detail"}</h1>
            <p>
              Inspect source fidelity, generated layers, conversions, connections, and timeline before turning this capture into durable knowledge.
            </p>
          </div>
          <div className={styles.headerActions}>
            {sourceUrl ? (
              <a className={styles.utilityButton} href={sourceUrl} target="_blank" rel="noreferrer">
                Open source
              </a>
            ) : (
              <span className={styles.utilityButton} aria-disabled="true">Open source</span>
            )}
            <span className={styles.utilityButton} aria-disabled="true">More</span>
          </div>
        </header>

        <div className={styles.layout}>
          <div className={styles.main}>
            <section className={styles.panel} id="artifact-detail" aria-labelledby="artifact-detail-title">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.label}>What this is</p>
                  <h2 id="artifact-detail-title">Artifact detail</h2>
                </div>
                {detail?.status ? <span className={styles.statusPill}>{titleCase(detail.status)}</span> : null}
              </div>
              <div className={styles.identityGrid}>
                <div className={styles.fact}>
                  <span>Type</span>
                  <strong>{detail?.artifact_type || "Artifact"}</strong>
                </div>
                <div className={styles.fact}>
                  <span>Source</span>
                  <strong>{detail?.source || provenanceValue(provenance, "source_app")}</strong>
                </div>
                <div className={styles.fact}>
                  <span>Captured</span>
                  <strong>{formatDate(detail?.captured_at || asString(provenance.capture_time))}</strong>
                </div>
                <div className={styles.fact}>
                  <span>File or URL</span>
                  <strong>{sourceUrl || sourceFile || "Not recorded"}</strong>
                </div>
              </div>
              <div className={styles.panelStack}>
                <p className={styles.summary}>{detail?.summary || "No generated summary has been saved for this artifact yet."}</p>
                {detail?.summary ? (
                  <p className={styles.muted}>{detail.summary_provenance || "Summary provenance not recorded."}</p>
                ) : null}
                {tags.length ? (
                  <div className={styles.pillRow} aria-label="Tags">
                    {tags.map((tag) => <span className={styles.pill} key={tag}>{tag}</span>)}
                  </div>
                ) : null}
              </div>
            </section>

            <section className={styles.panel} aria-labelledby="source-preview-title">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.label}>Quick capture</p>
                  <h2 id="source-preview-title">Source preview</h2>
                </div>
              </div>
              <div className={styles.split}>
                <div className={styles.previewBox}>
                  <span className={styles.label}>Raw preview</span>
                  <pre>{compactText(layers.raw?.content, "No raw source preview is available.")}</pre>
                </div>
                <div className={styles.panelStack}>
                  <div className={styles.fact}>
                    <span>Quick note</span>
                    <strong>{detail?.quick_note || "No quick note attached."}</strong>
                  </div>
                  <div className={styles.fact}>
                    <span>Classification</span>
                    <strong>{detail?.artifact_type || "Capture"}</strong>
                  </div>
                  <div className={styles.fact}>
                    <span>Save state</span>
                    <strong>{detail ? "Saved to Library" : "Loading"}</strong>
                  </div>
                </div>
              </div>
            </section>

            <section className={styles.panel} id="source-provenance" aria-labelledby="source-provenance-title">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.label}>Where it came from</p>
                  <h2 id="source-provenance-title">Source and provenance</h2>
                </div>
              </div>
              <div className={styles.provenanceGrid}>
                <div className={styles.fact}><span>Source app</span><strong>{provenanceValue(provenance, "source_app", detail?.source || "Not recorded")}</strong></div>
                <div className={styles.fact}><span>URL or file</span><strong>{sourceUrl || sourceFile || "Not recorded"}</strong></div>
                <div className={styles.fact}><span>Capture method</span><strong>{provenanceValue(provenance, "capture_method")}</strong></div>
                <div className={styles.fact}><span>Source type</span><strong>{provenanceValue(provenance, "source_type")}</strong></div>
                <div className={styles.fact}><span>Source file</span><strong>{sourceFile || "Not recorded"}</strong></div>
                <div className={styles.fact}><span>Summaries</span><strong>{provenanceValue(provenance, "summary_version_count", "0")}</strong></div>
                <div className={styles.fact}><span>Relations</span><strong>{provenanceValue(provenance, "relation_count", "0")}</strong></div>
                <div className={styles.fact}><span>Used in tasks/review</span><strong>{`${provenanceValue(provenance, "task_count", "0")} tasks / ${provenanceValue(provenance, "card_count", "0")} review cards`}</strong></div>
              </div>
            </section>

            <section className={styles.panel} aria-labelledby="layer-previews-title">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.label}>Source fidelity</p>
                  <h2 id="layer-previews-title">Raw, normalized, and extracted layers</h2>
                </div>
              </div>
              <div className={styles.layerGrid}>
                {(["raw", "normalized", "extracted"] as const).map((layerKey) => {
                  const layer = layers[layerKey];
                  return (
                    <article className={styles.layerCard} key={layerKey}>
                      <span>{titleCase(layerKey)}</span>
                      <strong>{layer?.title || `${titleCase(layerKey)} layer`}</strong>
                      <pre>{compactText(layer?.content)}</pre>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className={styles.panel} id="conversion-actions" aria-labelledby="conversion-actions-title">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.label}>What it can turn into</p>
                  <h2 id="conversion-actions-title">Conversion and enrichment actions</h2>
                </div>
              </div>
              <div className={styles.actionGrid}>
                {actions.map((action) => (
                  <button
                    key={action.action}
                    className={styles.actionButton}
                    type="button"
                    disabled={!action.supported}
                    title={!action.supported ? action.disabled_reason || "This action is not available yet." : undefined}
                    onClick={() => handleAction(action)}
                  >
                    <strong>{action.label}</strong>
                    <span>{action.description || action.disabled_reason || "Request this conversion."}</span>
                    <span className={styles.actionStatus}>{actionStatus[action.action] || action.status || (!action.supported ? "Unavailable" : "Ready")}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.panel} aria-labelledby="extracted-ideas-title">
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.label}>What Starlog extracted</p>
                  <h2 id="extracted-ideas-title">Highlights and key ideas</h2>
                </div>
              </div>
              {detail?.key_ideas?.length ? (
                <ul className={styles.ideaList}>
                  {detail.key_ideas.map((idea, index) => {
                    const ideaRecord = typeof idea === "string" ? { title: idea } : idea;
                    return (
                      <li className={styles.ideaItem} key={`${ideaRecord.title || "idea"}-${index}`}>
                        <span>{ideaRecord.provenance || "Extracted near source layers"}</span>
                        <strong>{ideaRecord.title || "Untitled idea"}</strong>
                        {ideaRecord.detail ? <p className={styles.muted}>{ideaRecord.detail}</p> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : layers.extracted?.present && layers.extracted.content ? (
                <ul className={styles.ideaList}>
                  <li className={styles.ideaItem}>
                    <span>Extracted source layer</span>
                    <strong>{layers.extracted.content}</strong>
                  </li>
                </ul>
              ) : (
                <p className={styles.emptyText}>No extracted highlights or generated ideas have been saved yet.</p>
              )}
            </section>
          </div>

          <aside className={styles.rail} aria-label="Artifact context">
            <section className={styles.railCard} aria-labelledby="connections-title">
              <p className={styles.label}>Where connected</p>
              <h2 id="connections-title">Connections</h2>
              <div className={styles.connectionsGrid}>
                {connections.length ? connections.map((connection) => (
                  <div className={styles.connection} key={connection.id || `${connection.kind}-${connection.title}`}>
                    <span>{titleCase(connection.kind)}</span>
                    <strong>{connection.href ? <a className={styles.sourceLink} href={connection.href}>{connection.title}</a> : connection.title}</strong>
                    {connection.detail ? <p className={styles.muted}>{connection.detail}</p> : null}
                  </div>
                )) : <p className={styles.emptyText}>No project, note, task, or review links yet.</p>}
              </div>
            </section>

            <section className={styles.railCard} id="activity-timeline" aria-labelledby="activity-timeline-title">
              <p className={styles.label}>Already happened</p>
              <h2 id="activity-timeline-title">Activity timeline</h2>
              {activity.length ? (
                <ol className={styles.timeline}>
                  {activity.map((event) => (
                    <li className={styles.timelineItem} key={event.id || `${event.label}-${event.created_at}`}>
                      <span>{formatDate(event.created_at)}</span>
                      <strong>{event.label}</strong>
                      {event.detail ? <p className={styles.muted}>{event.detail}</p> : null}
                      {event.actor ? <p className={styles.muted}>{event.actor}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.emptyText}>No activity has been recorded yet.</p>
              )}
            </section>

            <p className={styles.feedback} aria-live="polite">{status}</p>
          </aside>
        </div>
      </div>
    </AprilWorkspaceShell>
  );
}
