"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AprilWorkspaceShell } from "../components/april-observatory-shell";
import { ApiError, apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";
import styles from "./detail.module.css";

type ArtifactActionKind = "summarize" | "cards" | "tasks" | "append_note";
type DetailActionKind = ArtifactActionKind | "extract_highlights" | string;

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
  updated_at?: string | null;
};

type DetailAction = {
  action: DetailActionKind;
  label: string;
  description?: string | null;
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
  label: string;
  detail?: string | null;
  actor?: string | null;
  created_at: string;
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
    supported: true,
  },
  {
    action: "cards",
    label: "Make cards",
    description: "Create atomic review items from stable ideas.",
    supported: true,
  },
  {
    action: "tasks",
    label: "Create task",
    description: "Turn an insight into an actionable task.",
    supported: true,
  },
  {
    action: "append_note",
    label: "Append to note",
    description: "Add this artifact to an existing note.",
    supported: true,
  },
  {
    action: "extract_highlights",
    label: "Extract highlights",
    description: "Find and save key quotes or passages.",
    supported: false,
    disabled_reason: "Highlight extraction is not wired in this build.",
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
  const captureSource = asString(capture.capture_source) || titleCase(artifact.source_type || "capture");
  const tags = Array.isArray(capture.tags) ? capture.tags.filter((tag): tag is string => typeof tag === "string") : [];

  return {
    id: artifact.id,
    title: artifact.title?.trim() || titleCase(artifact.source_type || "capture"),
    artifact_type: titleCase(artifact.source_type || "capture"),
    status: "fallback",
    source: titleCase(captureSource),
    source_url: sourceUrl,
    captured_at: artifact.created_at,
    updated_at: artifact.updated_at,
    tags,
    summary: compactText(artifact.extracted_content || artifact.normalized_content || artifact.raw_content, "Detail read model is not available yet; showing the captured source layers."),
    key_ideas: [],
    quick_note: asString(capture.quick_note),
    provenance: {
      source_app: captureSource,
      url: sourceUrl,
      capture_method: provenanceValue(capture, "capture_method", "Library capture"),
      capture_time: artifact.created_at,
      captured_by: provenanceValue(capture, "captured_by", "Starlog user"),
      device: asString(capture.device),
      location: asString(capture.location),
      linked_project: asString(capture.linked_project),
      linked_notes: asString(capture.linked_notes),
      used_in_tasks: asString(capture.used_in_tasks),
      used_in_review: asString(capture.used_in_review),
    },
    layers: {
      raw: { title: "Raw capture", content: artifact.raw_content, format: "source" },
      normalized: { title: "Normalized text", content: artifact.normalized_content, format: "text" },
      extracted: { title: "Extracted output", content: artifact.extracted_content, format: "generated" },
    },
    actions: DEFAULT_ACTIONS,
    connections: [],
    activity: [
      {
        id: `${artifact.id}-captured`,
        label: "Captured into Library",
        detail: `Source type: ${titleCase(artifact.source_type || "capture")}`,
        actor: "Starlog",
        created_at: artifact.created_at,
      },
    ],
  };
}

function normalizeDetail(payload: Partial<ArtifactDetail> & { artifact?: Partial<ArtifactDetail> }): ArtifactDetail {
  const nested = payload.artifact || {};
  const title = nested.title || payload.title || "Untitled artifact";
  const id = nested.id || payload.id || "unknown";

  return {
    id,
    title,
    artifact_type: nested.artifact_type || payload.artifact_type || "Artifact",
    status: nested.status || payload.status || null,
    source: nested.source || payload.source || null,
    source_url: nested.source_url || payload.source_url || null,
    captured_at: nested.captured_at || payload.captured_at || null,
    updated_at: nested.updated_at || payload.updated_at || null,
    tags: nested.tags || payload.tags || [],
    summary: nested.summary || payload.summary || null,
    key_ideas: nested.key_ideas || payload.key_ideas || [],
    quick_note: nested.quick_note || payload.quick_note || null,
    provenance: payload.provenance || nested.provenance || {},
    layers: payload.layers || nested.layers || {},
    actions: payload.actions || nested.actions || DEFAULT_ACTIONS,
    connections: payload.connections || nested.connections || [],
    activity: payload.activity || nested.activity || [],
  };
}

function isSupportedPostAction(action: DetailActionKind): action is ArtifactActionKind {
  return action === "summarize" || action === "cards" || action === "tasks" || action === "append_note";
}

function mergeActions(actions?: DetailAction[]): DetailAction[] {
  const byAction = new Map(DEFAULT_ACTIONS.map((action) => [action.action, action]));
  for (const action of actions || []) {
    byAction.set(action.action, {
      ...byAction.get(action.action),
      ...action,
      supported: Boolean(action.supported) && isSupportedPostAction(action.action),
    });
  }
  return [...byAction.values()].map((action) => ({
    ...action,
    supported: Boolean(action.supported) && isSupportedPostAction(action.action),
    disabled_reason: action.supported && !isSupportedPostAction(action.action)
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
      const payload = await apiRequest<Partial<ArtifactDetail> & { artifact?: Partial<ArtifactDetail> }>(
        apiBase,
        token,
        `/v1/artifacts/${id}/detail`,
      );
      setDetail(normalizeDetail(payload));
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
  const sourceUrl = detail?.source_url || asString(provenance.url) || asString(provenance.file);
  const layers = detail?.layers || {};
  const connections = detail?.connections || [];
  const activity = detail?.activity || [];
  const tags = detail?.tags || [];

  async function handleAction(action: DetailAction) {
    if (!detail || !isSupportedPostAction(action.action) || !action.supported) {
      return;
    }

    setActionStatus((current) => ({ ...current, [action.action]: "Requesting..." }));
    try {
      const result = await mutateWithQueue<ArtifactActionResponse>(
        `/v1/artifacts/${detail.id}/actions`,
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
                  <strong>{sourceUrl || "Not recorded"}</strong>
                </div>
              </div>
              <div className={styles.panelStack}>
                <p className={styles.summary}>{detail?.summary || "No generated summary has been saved for this artifact yet."}</p>
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
                <div className={styles.fact}><span>URL or file</span><strong>{sourceUrl || "Not recorded"}</strong></div>
                <div className={styles.fact}><span>Capture method</span><strong>{provenanceValue(provenance, "capture_method")}</strong></div>
                <div className={styles.fact}><span>Captured by</span><strong>{provenanceValue(provenance, "captured_by")}</strong></div>
                <div className={styles.fact}><span>Device</span><strong>{provenanceValue(provenance, "device")}</strong></div>
                <div className={styles.fact}><span>Location</span><strong>{provenanceValue(provenance, "location")}</strong></div>
                <div className={styles.fact}><span>Linked project</span><strong>{provenanceValue(provenance, "linked_project")}</strong></div>
                <div className={styles.fact}><span>Used in tasks/review</span><strong>{`${provenanceValue(provenance, "used_in_tasks", "No tasks")} / ${provenanceValue(provenance, "used_in_review", "No review items")}`}</strong></div>
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
