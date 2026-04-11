"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AprilWorkspaceShell } from "../components/april-observatory-shell";
import { readEntityCacheScope, replaceEntityCacheScope } from "../lib/entity-cache";
import {
  ENTITY_CACHE_INVALIDATION_EVENT,
  cachePrefixesIntersect,
  clearEntityCachesStale,
  hasStaleEntityCache,
  readEntitySnapshot,
  readEntitySnapshotAsync,
  writeEntitySnapshot,
} from "../lib/entity-snapshot";
import { applyOptimisticNotes } from "../lib/optimistic-state";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type Note = {
  id: string;
  title: string;
  body_md: string;
  version: number;
  created_at: string;
  updated_at: string;
  pending?: boolean;
  pendingLabel?: string;
};

const NOTES_SNAPSHOT = "notes.items";
const NOTE_SELECTED_SNAPSHOT = "notes.selected";
const NOTE_CACHE_PREFIXES = ["notes."];
const NOTES_ENTITY_SCOPE = "notes.items";

function cacheNotes(notes: Note[]): void {
  void replaceEntityCacheScope(
    NOTES_ENTITY_SCOPE,
    notes.map((note) => ({
      id: note.id,
      value: note,
      updated_at: note.updated_at,
      search_text: `${note.title} ${note.body_md}`,
    })),
  );
}

function excerptNote(body: string, limit = 180): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "No body text yet.";
  }
  return compact.length <= limit ? compact : `${compact.slice(0, limit).trimEnd()}…`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readMinutes(text: string): string {
  return `${Math.max(1, Math.ceil(countWords(text) / 180))}m`;
}

function noteKeywords(note: Note): string[] {
  return `${note.title} ${note.body_md}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 32);
}

function relatedNoteScore(source: Note, candidate: Note): number {
  const keywords = new Set(noteKeywords(source));
  let score = 0;
  for (const token of noteKeywords(candidate)) {
    if (keywords.has(token)) {
      score += 1;
    }
  }
  return score;
}

function NotesPageContent() {
  const searchParams = useSearchParams();
  const { apiBase, token, outbox, mutateWithQueue } = useSessionConfig();
  const [notes, setNotes] = useState<Note[]>(() => readEntitySnapshot<Note[]>(NOTES_SNAPSHOT, []));
  const [selectedId, setSelectedId] = useState(() => readEntitySnapshot<string>(NOTE_SELECTED_SNAPSHOT, ""));
  const [title, setTitle] = useState("New note");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("Ready");
  const [editorSeedId, setEditorSeedId] = useState("");
  const [searchValue, setSearchValue] = useState("");

  const visibleNotes = useMemo(() => applyOptimisticNotes(notes, outbox), [notes, outbox]);
  const selectedNote = visibleNotes.find((note) => note.id === selectedId) ?? null;
  const filteredNotes = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return visibleNotes;
    }
    return visibleNotes.filter((note) => (
      `${note.title}\n${note.body_md}`.toLowerCase().includes(query)
    ));
  }, [searchValue, visibleNotes]);
  const relatedNotes = useMemo(() => {
    if (!selectedNote) {
      return visibleNotes.slice(0, 3);
    }

    const ranked = visibleNotes
      .filter((note) => note.id !== selectedNote.id)
      .map((note) => ({ note, score: relatedNoteScore(selectedNote, note) }))
      .sort((left, right) => right.score - left.score || right.note.updated_at.localeCompare(left.note.updated_at));

    const strongest = ranked.filter((entry) => entry.score > 0).slice(0, 3).map((entry) => entry.note);
    if (strongest.length > 0) {
      return strongest;
    }
    return ranked.slice(0, 3).map((entry) => entry.note);
  }, [selectedNote, visibleNotes]);
  const graphNodes = useMemo(() => {
    const seeds = selectedNote ? [selectedNote, ...relatedNotes] : filteredNotes.slice(0, 4);
    const positions = [
      { top: "50%", left: "50%", active: true },
      { top: "24%", left: "30%" },
      { top: "38%", left: "76%" },
      { top: "74%", left: "58%" },
    ];
    return seeds.slice(0, 4).map((note, index) => ({
      note,
      ...positions[index],
    }));
  }, [filteredNotes, relatedNotes, selectedNote]);
  const selectedWordCount = countWords(body);
  const latestUpdatedAt = filteredNotes[0]?.updated_at ?? visibleNotes[0]?.updated_at ?? "";
  const recentNotes = useMemo(
    () => [...visibleNotes].sort((left, right) => right.updated_at.localeCompare(left.updated_at)).slice(0, 3),
    [visibleNotes],
  );
  const archiveNotes = useMemo(
    () => [...visibleNotes].sort((left, right) => left.updated_at.localeCompare(right.updated_at)).slice(0, 2),
    [visibleNotes],
  );

  useEffect(() => {
    setNotes((previous) => previous.length > 0 ? previous : readEntitySnapshot<Note[]>(NOTES_SNAPSHOT, []));
    setSelectedId((previous) => previous || readEntitySnapshot<string>(NOTE_SELECTED_SNAPSHOT, ""));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [entityNotes, bootstrapNotes, cachedSelectedId] = await Promise.all([
        readEntityCacheScope<Note>(NOTES_ENTITY_SCOPE),
        readEntitySnapshotAsync<Note[]>(NOTES_SNAPSHOT, []),
        readEntitySnapshotAsync<string>(NOTE_SELECTED_SNAPSHOT, ""),
      ]);

      if (cancelled) {
        return;
      }

      const cachedNotes = entityNotes.length > 0 ? entityNotes : bootstrapNotes;
      if (cachedNotes.length > 0) {
        setNotes(cachedNotes);
      }
      if (cachedSelectedId) {
        setSelectedId((previous) => previous || cachedSelectedId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      const payload = await apiRequest<Note[]>(apiBase, token, "/v1/notes");
      setNotes(payload);
      writeEntitySnapshot(NOTES_SNAPSHOT, payload);
      cacheNotes(payload);
      clearEntityCachesStale(NOTE_CACHE_PREFIXES);
      setStatus(`Loaded ${payload.length} notes`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to load notes";
      setStatus(notes.length > 0 ? `Loaded cached notes. ${detail}` : detail);
    }
  }, [apiBase, notes.length, token]);

  function selectNote(note: Note) {
    setSelectedId(note.id);
    setTitle(note.title);
    setBody(note.body_md);
    setEditorSeedId(note.id);
  }

  function clearEditor() {
    setSelectedId("");
    setTitle("New note");
    setBody("");
    setEditorSeedId("");
  }

  async function createNote() {
    try {
      const result = await mutateWithQueue<Note>(
        "/v1/notes",
        {
          method: "POST",
          body: JSON.stringify({
            title: title.trim() || "New note",
            body_md: body,
          }),
        },
        {
          label: `Create note: ${title.trim() || "New note"}`,
          entity: "note",
          op: "create",
        },
      );
      if (result.queued || !result.data) {
        clearEditor();
        setStatus("Note creation queued for replay");
        return;
      }

      setStatus(`Created note ${result.data.id}`);
      await loadNotes();
      selectNote(result.data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create note");
    }
  }

  async function saveNote() {
    if (!selectedNote) {
      setStatus("Select an existing note or create a new one");
      return;
    }
    if (selectedNote.id.startsWith("pending:")) {
      setStatus("Replay queued note creation before editing it again");
      return;
    }

    try {
      const result = await mutateWithQueue<Note>(
        `/v1/notes/${selectedNote.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: title.trim() || selectedNote.title,
            body_md: body,
          }),
        },
        {
          label: `Update note: ${selectedNote.title}`,
          entity: "note",
          op: "update",
        },
      );
      if (result.queued || !result.data) {
        setStatus("Note update queued for replay");
        return;
      }

      setStatus(`Saved note ${result.data.id}`);
      await loadNotes();
      selectNote(result.data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save note");
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    loadNotes().catch(() => undefined);
  }, [loadNotes, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const refreshIfStale = () => {
      if (!window.navigator.onLine || !hasStaleEntityCache(NOTE_CACHE_PREFIXES)) {
        return;
      }
      loadNotes().catch(() => undefined);
    };

    refreshIfStale();

    const onInvalidation = (event: Event) => {
      const detail = (event as CustomEvent<{ prefixes: string[] }>).detail;
      if (detail && cachePrefixesIntersect(detail.prefixes, NOTE_CACHE_PREFIXES)) {
        refreshIfStale();
      }
    };

    window.addEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    return () => {
      window.removeEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    };
  }, [loadNotes, token]);

  useEffect(() => {
    if (!selectedNote || selectedNote.id === editorSeedId) {
      return;
    }

    setTitle(selectedNote.title);
    setBody(selectedNote.body_md);
    setEditorSeedId(selectedNote.id);
  }, [editorSeedId, selectedNote]);

  useEffect(() => {
    const requestedId = searchParams.get("note");
    if (!requestedId) {
      if (!selectedId && visibleNotes[0]) {
        selectNote(visibleNotes[0]);
      }
      return;
    }

    const requestedNote = visibleNotes.find((note) => note.id === requestedId);
    if (requestedNote) {
      selectNote(requestedNote);
    }
  }, [searchParams, selectedId, visibleNotes]);

  useEffect(() => {
    writeEntitySnapshot(NOTE_SELECTED_SNAPSHOT, selectedId);
  }, [selectedId]);

  return (
    <AprilWorkspaceShell
      activeSurface="knowledge-base"
      statusLabel={selectedNote ? `Editing v${selectedNote.version}` : "Draft ready"}
      queueLabel={`${outbox.length} queued`}
      searchPlaceholder="Search archive..."
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      railSlot={(
        <>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Vault explorer</span>
            <div className="april-rail-metric-stack">
              <div className="april-rail-metric-card">
                <strong>{visibleNotes.length}</strong>
                <span>Indexed notes</span>
              </div>
              <div className="april-rail-metric-card">
                <strong>{outbox.length}</strong>
                <span>Queued mutations</span>
              </div>
            </div>
          </div>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Return points</span>
            <div className="april-rail-link-stack">
              <a href="#knowledge-editor">Editor</a>
              <a href="#knowledge-graph">Graph</a>
              <Link href="/assistant">Assistant</Link>
            </div>
          </div>
        </>
      )}
    >
      <section className="knowledge-base-station">
        <aside className="knowledge-base-explorer">
          <div className="knowledge-base-pane-head">
            <div>
              <span className="knowledge-base-kicker">Vault Explorer</span>
              <h2>Living archive</h2>
            </div>
            <button className="button" type="button" onClick={() => loadNotes()}>Refresh</button>
          </div>
          <div className="knowledge-base-constellation-note">
            <span>Search horizon</span>
            <strong>{searchValue.trim() ? `${filteredNotes.length} matched notes` : `${visibleNotes.length} indexed notes`}</strong>
          </div>
          <div className="knowledge-base-folder-stack">
            <section className="knowledge-base-folder-group">
              <div className="knowledge-base-folder-head">
                <span className="knowledge-base-folder-glyph">⌂</span>
                <div>
                  <strong>Research</strong>
                  <small>Primary vault</small>
                </div>
              </div>
              {filteredNotes.length === 0 ? (
                <p className="console-copy">No notes yet.</p>
              ) : (
                <div className="knowledge-base-note-tree">
                  {filteredNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      className={note.id === selectedId ? "knowledge-base-tree-item active" : "knowledge-base-tree-item"}
                      onClick={() => selectNote(note)}
                    >
                      <strong>{note.title}</strong>
                      <span>v{note.version} · {new Date(note.updated_at).toLocaleDateString()}</span>
                      <p>{excerptNote(note.body_md, 72)}</p>
                      {note.pending ? <small>{note.pendingLabel || "queued mutation"}</small> : null}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="knowledge-base-folder-group compact">
              <div className="knowledge-base-folder-head">
                <span className="knowledge-base-folder-glyph">◌</span>
                <div>
                  <strong>Recent echoes</strong>
                  <small>Last touched notes</small>
                </div>
              </div>
              <div className="knowledge-base-mini-list">
                {recentNotes.map((note) => (
                  <button key={note.id} type="button" className="knowledge-base-mini-item" onClick={() => selectNote(note)}>
                    <strong>{note.title}</strong>
                    <span>{new Date(note.updated_at).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="knowledge-base-folder-group compact">
              <div className="knowledge-base-folder-head">
                <span className="knowledge-base-folder-glyph">◇</span>
                <div>
                  <strong>Archive drift</strong>
                  <small>Earlier records</small>
                </div>
              </div>
              <div className="knowledge-base-mini-list">
                {archiveNotes.map((note) => (
                  <button key={note.id} type="button" className="knowledge-base-mini-item" onClick={() => selectNote(note)}>
                    <strong>{note.title}</strong>
                    <span>v{note.version}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
          <div className="knowledge-base-explorer-footer">
            <p>Disk usage: {visibleNotes.length} note objects</p>
            <p>Sync queue: {outbox.length} pending</p>
          </div>
        </aside>

        <main className="knowledge-base-editor-pane" id="knowledge-editor">
          <div className="knowledge-base-editor-head">
            <div className="knowledge-base-editor-hero">
              <div className="knowledge-base-editor-tags">
                <span>{selectedNote ? "Research" : "Draft"}</span>
                <span>{selectedNote ? "Tracked" : "Fresh Entry"}</span>
              </div>
              <h1>{title || "Untitled note"}</h1>
              <p className="knowledge-base-editor-quote">
                {selectedNote
                  ? `"${excerptNote(body, 150)}"`
                  : "\"The archive stays alive when every note remains connected to its wider constellation.\""}
              </p>
              <p>
                {selectedNote
                  ? "Shape the current entry as an editorial knowledge artifact, then let the graph and backlinks stay legible around it."
                  : "Shape a living note with provenance, linked context, and a graph-ready structure."}
              </p>
            </div>
            <div className="button-row">
              <button className="button" type="button" onClick={() => clearEditor()}>New entry</button>
              <button className="button" type="button" onClick={() => createNote()}>Create note</button>
              <button className="button" type="button" onClick={() => saveNote()}>Save selected</button>
            </div>
          </div>

          <div className="knowledge-base-editor-meta">
            <span>{selectedNote ? `Version ${selectedNote.version}` : "Draft buffer"}</span>
            <span>{selectedNote ? `Updated ${new Date(selectedNote.updated_at).toLocaleString()}` : "Unsaved"}</span>
            <span>{selectedWordCount} words</span>
            <span>{readMinutes(body)} read</span>
          </div>

          <div className="knowledge-base-editor-shell">
            <div className="knowledge-base-editor-shell-head">
              <div className="knowledge-base-editor-shell-title">
                <span className="knowledge-base-kicker">Editor well</span>
                <p>Long-form note drafting with graph-aware context.</p>
              </div>
              <Link className="button" href="/assistant">Open Assistant</Link>
            </div>

            <label className="knowledge-base-field knowledge-base-title-field" htmlFor="note-title">
              <span>Entry title</span>
              <input
                id="note-title"
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <label className="knowledge-base-field" htmlFor="note-body">
              <span>Observation body</span>
              <textarea
                id="note-body"
                className="textarea textarea-longform knowledge-base-editor-textarea"
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>

            <div className="knowledge-base-editor-foot">
              <p className="status">{status}</p>
              <div className="knowledge-base-editor-foot-meta">
                <span>{selectedNote ? "Tracked note" : "Untracked draft"}</span>
                <span>{selectedWordCount} word constellation</span>
              </div>
            </div>
          </div>
        </main>

        <aside className="knowledge-base-inspector" id="knowledge-graph">
          <div className="knowledge-base-pane-head">
            <div>
              <span className="knowledge-base-kicker">Stellar Graph</span>
              <h2>Graph, backlinks, metadata</h2>
            </div>
          </div>
          <div className="knowledge-base-graph">
            <svg className="knowledge-base-graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {graphNodes.slice(1).map((node, index) => (
                <line
                  key={`edge-${node.note.id}`}
                  x1="50"
                  y1="50"
                  x2={index === 0 ? "30" : index === 1 ? "76" : "58"}
                  y2={index === 0 ? "24" : index === 1 ? "38" : "74"}
                />
              ))}
            </svg>
            {graphNodes.map((node, index) => (
              <div
                key={node.note.id}
                className={index === 0 ? "knowledge-base-graph-node active" : "knowledge-base-graph-node"}
                style={{ top: node.top, left: node.left }}
              >
                <span>{node.note.title.slice(0, 1).toUpperCase()}</span>
              </div>
            ))}
            <div className="knowledge-base-graph-caption">
              <span>{selectedNote ? selectedNote.title : "Select a note"}</span>
              <small>{graphNodes.length} connected nodes</small>
            </div>
          </div>
          {selectedNote ? (
            <div className="knowledge-base-backlinks">
              <div className="knowledge-base-pane-head compact">
                <div>
                  <span className="knowledge-base-kicker">Backlinks</span>
                  <h3>Connected references</h3>
                </div>
              </div>
              {relatedNotes.length === 0 ? (
                <p className="console-copy">No related notes found yet.</p>
              ) : (
                <div className="knowledge-base-backlink-list">
                  {relatedNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      className="knowledge-base-backlink-card"
                      onClick={() => selectNote(note)}
                    >
                      <strong>{note.title}</strong>
                      <p>{excerptNote(note.body_md, 92)}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          {selectedNote ? (
            <dl className="knowledge-base-meta-list">
              <div>
                <dt>Selected</dt>
                <dd>{selectedNote.id}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>v{selectedNote.version}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{new Date(selectedNote.updated_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Word count</dt>
                <dd>{selectedWordCount}</dd>
              </div>
              <div>
                <dt>Read time</dt>
                <dd>{readMinutes(body)}</dd>
              </div>
            </dl>
          ) : (
            <p className="console-copy">Select a note to inspect the connected graph and metadata.</p>
          )}
          <div className="knowledge-base-sidecard">
            <span className="knowledge-base-kicker">Backlink pulse</span>
            <p>
              {selectedNote
                ? `${relatedNotes.length} related note${relatedNotes.length === 1 ? "" : "s"} currently orbit this entry.`
                : "Choose a note to trace live backlinks across the archive."}
            </p>
          </div>
          <div className="knowledge-base-sidecard">
            <span className="knowledge-base-kicker">Queue State</span>
            <p>
              {outbox.length > 0
                ? "Queued mutations remain replayable without breaking the current editing session."
                : "No queued note mutations are waiting for replay."}
            </p>
          </div>
          <div className="knowledge-base-sidecard">
            <span className="knowledge-base-kicker">Archive telemetry</span>
            <p>
              {latestUpdatedAt
                ? `Latest sync edge ${new Date(latestUpdatedAt).toLocaleString()}`
                : "No archive telemetry captured yet."}
            </p>
          </div>
        </aside>
      </section>
    </AprilWorkspaceShell>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={<main className="shell"><section className="observatory-panel glass"><p className="status">Loading notes...</p></section></main>}>
      <NotesPageContent />
    </Suspense>
  );
}
