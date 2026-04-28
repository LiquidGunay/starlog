"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AprilWorkspaceShell } from "../components/april-observatory-shell";
import { readEntitySnapshot, writeEntitySnapshot } from "../lib/entity-snapshot";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";
import styles from "./library.module.css";

type CaptureStatus =
  | "unprocessed"
  | "needs_decision"
  | "ready_to_process"
  | "processing"
  | "processed"
  | "archived"
  | "failed";

type ArtifactStatus = "generated" | "user_edited" | "linked" | "stale" | "archived";

type Artifact = {
  id: string;
  source_type: string;
  title?: string | null;
  raw_content?: string | null;
  normalized_content?: string | null;
  extracted_content?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  pending?: boolean;
  pendingLabel?: string;
};

type Note = {
  id: string;
  title: string;
  body_md: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type CountBucket = {
  key: string;
  label: string;
  count: number;
};

type SuggestedActionSummary = {
  action: "summarize" | "cards" | "tasks" | "append_note" | string;
  label: string;
  count: number;
};

type SurfaceArtifactSummary = {
  id: string;
  title?: string | null;
  source_type: string;
  created_at: string;
  updated_at: string;
  summary_count: number;
  card_count: number;
  task_count: number;
  note_count: number;
};

type LibrarySurfaceSummary = {
  status_buckets: CountBucket[];
  source_breakdown: CountBucket[];
  recent_artifacts: SurfaceArtifactSummary[];
  notes: {
    total: number;
    recent_count: number;
    latest_updated_at?: string | null;
  };
  suggested_actions: SuggestedActionSummary[];
  generated_at: string;
};

type ArtifactActionResponse = {
  artifact_id: string;
  action: ArtifactActionKind;
  status: string;
  output_ref?: string | null;
};

type LibraryEntry = {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string | null;
  captureType: string;
  timestamp: string;
  processingState: CaptureStatus | ArtifactStatus;
  summaryCount: number;
  linkedNotes: number;
  linkedTasks: number;
  linkedCards: number;
  kind: "capture" | "artifact";
};

type LibraryAction =
  | "Summarize"
  | "Make cards"
  | "Create task"
  | "Append to note"
  | "Link to project"
  | "Archive";

type ArtifactActionKind = "summarize" | "cards" | "tasks" | "append_note";

const ACTIONS: LibraryAction[] = ["Summarize", "Make cards", "Create task", "Append to note", "Link to project", "Archive"];
const ACTION_TO_ARTIFACT_ACTION: Partial<Record<LibraryAction, ArtifactActionKind>> = {
  Summarize: "summarize",
  "Make cards": "cards",
  "Create task": "tasks",
  "Append to note": "append_note",
};
const ARTIFACTS_SNAPSHOT = "library.artifacts";
const NOTES_SNAPSHOT = "library.notes";
const SUMMARY_SNAPSHOT = "library.summary";

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDate(value: string): string {
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

function noteExcerpt(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Saved note with no body text yet.";
  }
  return compact.length > 150 ? `${compact.slice(0, 150).trimEnd()}...` : compact;
}

function countByKey(summary: LibrarySurfaceSummary | null, key: string): number {
  return summary?.status_buckets.find((bucket) => bucket.key === key)?.count ?? 0;
}

function captureMetadata(artifact: Artifact): Record<string, unknown> {
  const capture = artifact.metadata?.capture;
  return capture && typeof capture === "object" && !Array.isArray(capture) ? capture as Record<string, unknown> : {};
}

function captureSource(artifact: Artifact): string {
  const capture = captureMetadata(artifact);
  const captureSourceValue = capture.capture_source;
  const sourceUrlValue = capture.source_url;
  if (typeof captureSourceValue === "string" && captureSourceValue.trim()) {
    return titleCase(captureSourceValue);
  }
  if (typeof sourceUrlValue === "string" && sourceUrlValue.trim()) {
    return sourceUrlValue;
  }
  return titleCase(artifact.source_type || "capture");
}

function inferCaptureState(artifact: Artifact, summary: SurfaceArtifactSummary | undefined): CaptureStatus | ArtifactStatus {
  if (artifact.pending) {
    return "processing";
  }

  if (summary) {
    const outputCount = summary.summary_count + summary.card_count + summary.task_count + summary.note_count;
    if (outputCount === 0) {
      return "unprocessed";
    }
    if (summary.note_count > 0 || summary.task_count > 0) {
      return "linked";
    }
    return "generated";
  }

  const sourceType = artifact.source_type.toLowerCase();
  if (sourceType.includes("summary") || sourceType.includes("card") || sourceType.includes("task")) {
    return "generated";
  }
  if (sourceType.includes("failed")) {
    return "failed";
  }
  if (sourceType.includes("processed")) {
    return "processed";
  }
  return "unprocessed";
}

function isInboxState(state: CaptureStatus | ArtifactStatus): boolean {
  return ["unprocessed", "needs_decision", "ready_to_process", "processing", "failed"].includes(state);
}

function linkedCount(...counts: Array<number | null | undefined>): number {
  return counts.reduce<number>((total, count) => total + Math.max(0, Number(count || 0)), 0);
}

function artifactToEntry(artifact: Artifact, summary: SurfaceArtifactSummary | undefined): LibraryEntry {
  const sourceType = artifact.source_type || "capture";
  const captureState = inferCaptureState(artifact, summary);
  return {
    id: artifact.id,
    title: artifact.title?.trim() || summary?.title?.trim() || titleCase(sourceType),
    source: captureSource(artifact),
    sourceUrl: typeof captureMetadata(artifact).source_url === "string" ? String(captureMetadata(artifact).source_url) : null,
    captureType: titleCase(sourceType),
    timestamp: artifact.updated_at || artifact.created_at,
    processingState: captureState,
    summaryCount: Math.max(0, Number(summary?.summary_count || 0)),
    linkedNotes: Math.max(0, Number(summary?.note_count || 0)),
    linkedTasks: Math.max(0, Number(summary?.task_count || 0)),
    linkedCards: Math.max(0, Number(summary?.card_count || 0)),
    kind: isInboxState(captureState) ? "capture" : "artifact",
  };
}

function sourceBreakdown(entries: LibraryEntry[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.captureType, (counts.get(entry.captureType) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 5);
}

function recentSources(entries: LibraryEntry[]): Array<{ label: string; detail: string }> {
  const seen = new Set<string>();
  const sources: Array<{ label: string; detail: string }> = [];
  for (const entry of entries) {
    if (seen.has(entry.source)) {
      continue;
    }
    seen.add(entry.source);
    sources.push({ label: entry.source, detail: `${entry.captureType} captured ${formatDate(entry.timestamp)}` });
  }
  return sources.slice(0, 4);
}

function EntryActions({
  entry,
  onAction,
  disabled = false,
}: {
  entry: Pick<LibraryEntry, "id" | "title">;
  onAction: (entry: Pick<LibraryEntry, "id" | "title">, action: ArtifactActionKind, label: LibraryAction) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.actions} aria-label={`Actions for ${entry.title}`}>
      {ACTIONS.map((action) => {
        const artifactAction = ACTION_TO_ARTIFACT_ACTION[action];
        const actionDisabled = disabled || !artifactAction;
        const title = artifactAction ? undefined : `${action} is not wired yet`;
        return (
          <button
            key={action}
            className={styles.actionButton}
            type="button"
            onClick={() => artifactAction ? onAction(entry, artifactAction, action) : undefined}
            disabled={actionDisabled}
            title={title}
          >
            {action}
          </button>
        );
      })}
    </div>
  );
}

function EntryMetadata({ entry }: { entry: LibraryEntry }) {
  const totalLinks = linkedCount(entry.summaryCount, entry.linkedNotes, entry.linkedTasks, entry.linkedCards);
  return (
    <div className={styles.metadata}>
      <span className={styles.typePill}>{entry.captureType}</span>
      <span className={styles.statusPill} data-state={entry.processingState}>{titleCase(entry.processingState)}</span>
      <span className={styles.metaText}>{entry.source}</span>
      <span className={styles.metaText}>{formatDate(entry.timestamp)}</span>
      <span className={styles.metaText}>{totalLinks} linked</span>
    </div>
  );
}

function LibraryPageContent() {
  const { apiBase, token, outbox, mutateWithQueue } = useSessionConfig();
  const [artifacts, setArtifacts] = useState<Artifact[]>(() => readEntitySnapshot<Artifact[]>(ARTIFACTS_SNAPSHOT, []));
  const [notes, setNotes] = useState<Note[]>(() => readEntitySnapshot<Note[]>(NOTES_SNAPSHOT, []));
  const [summary, setSummary] = useState<LibrarySurfaceSummary | null>(() => readEntitySnapshot<LibrarySurfaceSummary | null>(SUMMARY_SNAPSHOT, null));
  const [status, setStatus] = useState("Ready");
  const [searchValue, setSearchValue] = useState("");

  const loadLibrary = useCallback(async () => {
    try {
      const [summaryPayload, artifactPayload, notePayload] = await Promise.all([
        apiRequest<LibrarySurfaceSummary>(apiBase, token, "/v1/surfaces/library/summary"),
        apiRequest<Artifact[]>(apiBase, token, "/v1/artifacts"),
        apiRequest<Note[]>(apiBase, token, "/v1/notes"),
      ]);
      setSummary(summaryPayload);
      setArtifacts(artifactPayload);
      setNotes(notePayload);
      writeEntitySnapshot(SUMMARY_SNAPSHOT, summaryPayload);
      writeEntitySnapshot(ARTIFACTS_SNAPSHOT, artifactPayload);
      writeEntitySnapshot(NOTES_SNAPSHOT, notePayload);
      setStatus(`Loaded ${artifactPayload.length} captures and artifacts`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to load Library";
      setStatus(artifacts.length > 0 || notes.length > 0 ? `Showing cached Library data. ${detail}` : detail);
    }
  }, [apiBase, artifacts.length, notes.length, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    loadLibrary().catch(() => undefined);
  }, [loadLibrary, token]);

  const summaryByArtifactId = useMemo(
    () => new Map((summary?.recent_artifacts || []).map((item) => [item.id, item])),
    [summary],
  );
  const entries = useMemo(
    () => artifacts.map((artifact) => artifactToEntry(artifact, summaryByArtifactId.get(artifact.id))).sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
    [artifacts, summaryByArtifactId],
  );
  const query = searchValue.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!query) {
      return entries;
    }
    return entries.filter((entry) => (
      `${entry.title} ${entry.source} ${entry.captureType} ${entry.processingState}`.toLowerCase().includes(query)
    ));
  }, [entries, query]);
  const filteredNotes = useMemo(() => {
    const sorted = [...notes].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    if (!query) {
      return sorted;
    }
    return sorted.filter((note) => `${note.title} ${note.body_md}`.toLowerCase().includes(query));
  }, [notes, query]);

  const inboxEntries = filteredEntries.filter((entry) => isInboxState(entry.processingState));
  const recentArtifactIds = new Set((summary?.recent_artifacts || []).map((artifact) => artifact.id));
  const recentArtifacts = filteredEntries
    .filter((entry) => !isInboxState(entry.processingState) || recentArtifactIds.has(entry.id))
    .slice(0, 6);
  const notesAndSavedItems = filteredNotes.slice(0, 6);
  const unprocessedCount = summary ? countByKey(summary, "unprocessed_artifacts") : inboxEntries.length;
  const linkedOutputs = countByKey(summary, "summarized_artifacts")
    + countByKey(summary, "card_ready_artifacts")
    + countByKey(summary, "task_linked_artifacts")
    + countByKey(summary, "note_linked_artifacts");
  const breakdown = summary?.source_breakdown.length ? summary.source_breakdown.map((bucket) => ({ label: bucket.label, count: bucket.count })) : sourceBreakdown(inboxEntries);
  const sources = recentSources(entries);
  const nextInbox = inboxEntries[0];

  async function handleArtifactAction(entry: Pick<LibraryEntry, "id" | "title">, action: ArtifactActionKind, label: LibraryAction) {
    try {
      const result = await mutateWithQueue<ArtifactActionResponse>(
        `/v1/artifacts/${entry.id}/actions`,
        {
          method: "POST",
          body: JSON.stringify({ action }),
        },
        {
          label: `Artifact action: ${action}`,
          entity: "artifact_action",
          op: action,
        },
      );
      if (result.queued) {
        setStatus(`${label} queued for replay on ${entry.title}`);
        return;
      }

      await loadLibrary();
      setStatus(`${label} ${result.data?.status || "requested"} for ${entry.title}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} failed for ${entry.title}`);
    }
  }

  return (
    <AprilWorkspaceShell
      activeSurface="knowledge-base"
      brandMeta="Library pipeline"
      statusLabel={status}
      queueLabel={`${outbox.length} queued`}
      ctaLabel="Quick capture"
      searchLabel="Library search"
      searchAriaLabel="Search Library"
      searchPlaceholder="Search captures, artifacts, notes..."
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      railSlot={(
        <>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Pipeline</span>
            <div className="april-rail-link-stack">
              <a href="#library-inbox">Inbox</a>
              <a href="#library-artifacts">Recent artifacts</a>
              <a href="#library-notes">Notes and saved items</a>
            </div>
          </div>
        </>
      )}
    >
      <div className={styles.surface}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Starlog Library</p>
            <h1>Capture pipeline</h1>
            <p>
              Process incoming captures into summaries, cards, tasks, notes, and project links while keeping source context visible.
            </p>
          </div>
          <div className={styles.syncState}>
            <strong>{status}</strong>
            <span>{outbox.length} queued change{outbox.length === 1 ? "" : "s"}</span>
          </div>
        </header>

        <section className={styles.stats} aria-label="Library stats">
          <div className={styles.stat}>
            <strong>{unprocessedCount}</strong>
            <span>Unprocessed captures</span>
          </div>
          <div className={styles.stat}>
            <strong>{summary?.recent_artifacts.length ?? recentArtifacts.length}</strong>
            <span>Recent artifacts</span>
          </div>
          <div className={styles.stat}>
            <strong>{summary?.notes.total ?? notesAndSavedItems.length}</strong>
            <span>Notes and saved items</span>
          </div>
          <div className={styles.stat}>
            <strong>{linkedOutputs}</strong>
            <span>Linked outputs</span>
          </div>
        </section>

        <div className={styles.layout}>
          <div className={styles.main}>
            <section className={styles.section} id="library-inbox" aria-labelledby="library-inbox-title">
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.label}>Inbox</p>
                  <h2 id="library-inbox-title">Unprocessed captures</h2>
                  <p>Captures waiting to be classified, processed, linked, or archived.</p>
                </div>
                <span className={styles.countPill}>{inboxEntries.length} open</span>
              </div>
              <div className={styles.itemList}>
                {inboxEntries.length === 0 ? (
                  <p className={styles.emptyText}>No unprocessed captures match this view.</p>
                ) : inboxEntries.map((entry) => (
                  <article key={entry.id} className={styles.row}>
                    <div>
                      <h3 className={styles.itemTitle}>{entry.title}</h3>
                      <EntryMetadata entry={entry} />
                    </div>
                    <EntryActions entry={entry} onAction={handleArtifactAction} />
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.section} id="library-artifacts" aria-labelledby="library-artifacts-title">
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.label}>Artifacts</p>
                  <h2 id="library-artifacts-title">Recent artifacts</h2>
                  <p>Generated and linked outputs from captured source material.</p>
                </div>
                <span className={styles.countPill}>{recentArtifacts.length} recent</span>
              </div>
              <div className={styles.cardGrid}>
                {recentArtifacts.length === 0 ? (
                  <p className={styles.emptyText}>No processed artifacts match this view.</p>
                ) : recentArtifacts.map((entry) => (
                  <article key={entry.id} className={styles.artifactCard}>
                    <div>
                      <div className={styles.cardTop}>
                        <h3 className={styles.itemTitle}>{entry.title}</h3>
                        <span className={styles.statusPill} data-state={entry.processingState}>{titleCase(entry.processingState)}</span>
                      </div>
                      <EntryMetadata entry={entry} />
                    </div>
                    <EntryActions entry={entry} onAction={handleArtifactAction} />
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.section} id="library-notes" aria-labelledby="library-notes-title">
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.label}>Notes</p>
                  <h2 id="library-notes-title">Notes and saved items</h2>
                  <p>Durable knowledge objects that captures and artifacts can append to or link from.</p>
                </div>
                <span className={styles.countPill}>{notesAndSavedItems.length} visible</span>
              </div>
              <div className={styles.cardGrid}>
                {notesAndSavedItems.length === 0 ? (
                  <p className={styles.emptyText}>No notes or saved items match this view.</p>
                ) : notesAndSavedItems.map((note) => {
                  const entry = {
                    id: note.id,
                    title: note.title,
                  };
                  return (
                    <article key={note.id} className={styles.noteCard}>
                      <div>
                        <div className={styles.cardTop}>
                          <h3 className={styles.itemTitle}>{note.title}</h3>
                          <span className={styles.typePill}>Note v{note.version}</span>
                        </div>
                        <div className={styles.metadata}>
                          <span className={styles.typePill}>Note</span>
                          <span className={styles.statusPill} data-state="linked">Linked</span>
                          <span className={styles.metaText}>Starlog</span>
                          <span className={styles.metaText}>{formatDate(note.updated_at)}</span>
                          <span className={styles.metaText}>Saved item</span>
                        </div>
                      </div>
                      <p className={styles.noteBody}>{noteExcerpt(note.body_md)}</p>
                      <EntryActions entry={entry} onAction={handleArtifactAction} disabled />
                    </article>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className={styles.rail} aria-label="Library context">
            <section className={styles.railCard}>
              <p className={styles.label}>Inbox breakdown</p>
              <h2>Capture types</h2>
              <div className={styles.breakdown}>
                {breakdown.length === 0 ? (
                  <p className={styles.emptyText}>No open captures.</p>
                ) : breakdown.map((item) => (
                  <div key={item.label} className={styles.breakdownRow}>
                    <span>{item.label}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.railCard}>
              <p className={styles.label}>Recent sources</p>
              <h3>Where captures came from</h3>
              <ul className={styles.sourceList}>
                {sources.length === 0 ? (
                  <li>No sources loaded yet.</li>
                ) : sources.map((source) => (
                  <li key={source.label}>
                    <strong>{source.label}</strong>
                    {source.detail}
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.railCard}>
              <p className={styles.label}>Current context</p>
              <h3>{nextInbox ? nextInbox.title : "Pipeline clear"}</h3>
              <p className={styles.contextText}>
                {nextInbox
                  ? `${nextInbox.captureType} from ${nextInbox.source} is ready for ${titleCase(nextInbox.processingState)} handling.`
                  : "New captures will appear here with provenance before conversion."}
              </p>
            </section>

            <section className={styles.railCard}>
              <p className={styles.label}>Suggestions</p>
              <h3>Next conversions</h3>
              <ul className={styles.suggestionList}>
                {(summary?.suggested_actions.length ? summary.suggested_actions : [
                  { action: "summarize", label: "Summarize open sources", count: 0 },
                  { action: "cards", label: "Make cards from stable notes", count: 0 },
                  { action: "tasks", label: "Extract tasks", count: 0 },
                ]).map((suggestion) => (
                  <li key={suggestion.action}>
                    <strong>{suggestion.label}</strong>
                    {suggestion.count} matching item{suggestion.count === 1 ? "" : "s"}.
                  </li>
                ))}
              </ul>
            </section>

            <p className={styles.feedback} aria-live="polite">{status}</p>
          </aside>
        </div>
      </div>
    </AprilWorkspaceShell>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<main className="shell"><section className="observatory-panel glass"><p className="status">Loading Library...</p></section></main>}>
      <LibraryPageContent />
    </Suspense>
  );
}
