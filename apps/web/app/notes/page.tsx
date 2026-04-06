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

function NotesPageContent() {
  const searchParams = useSearchParams();
  const { apiBase, token, outbox, mutateWithQueue } = useSessionConfig();
  const [notes, setNotes] = useState<Note[]>(() => readEntitySnapshot<Note[]>(NOTES_SNAPSHOT, []));
  const [selectedId, setSelectedId] = useState(() => readEntitySnapshot<string>(NOTE_SELECTED_SNAPSHOT, ""));
  const [title, setTitle] = useState("New note");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("Ready");
  const [editorSeedId, setEditorSeedId] = useState("");

  const visibleNotes = useMemo(() => applyOptimisticNotes(notes, outbox), [notes, outbox]);
  const selectedNote = visibleNotes.find((note) => note.id === selectedId) ?? null;

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
              <Link href="/assistant">Main Room</Link>
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
          {visibleNotes.length === 0 ? (
            <p className="console-copy">No notes yet.</p>
          ) : (
            <div className="knowledge-base-note-tree">
              {visibleNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={note.id === selectedId ? "knowledge-base-tree-item active" : "knowledge-base-tree-item"}
                  onClick={() => selectNote(note)}
                >
                  <strong>{note.title}</strong>
                  <span>v{note.version} · {new Date(note.updated_at).toLocaleDateString()}</span>
                  {note.pending ? <small>{note.pendingLabel || "queued mutation"}</small> : null}
                </button>
              ))}
            </div>
          )}
          <div className="knowledge-base-explorer-footer">
            <p>Disk usage: {visibleNotes.length} note objects</p>
            <p>Sync queue: {outbox.length} pending</p>
          </div>
        </aside>

        <main className="knowledge-base-editor-pane" id="knowledge-editor">
          <div className="knowledge-base-editor-head">
            <div className="knowledge-base-editor-tags">
              <span>{selectedNote ? "Research" : "Draft"}</span>
              <span>{selectedNote ? "Tracked" : "Fresh Entry"}</span>
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
            <span>{body.trim().split(/\s+/).filter(Boolean).length} words</span>
          </div>

          <label className="knowledge-base-field" htmlFor="note-title">
            <span>Title</span>
            <input
              id="note-title"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="knowledge-base-field" htmlFor="note-body">
            <span>Body</span>
            <textarea
              id="note-body"
              className="textarea textarea-longform knowledge-base-editor-textarea"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>

          <div className="knowledge-base-editor-foot">
            <p className="status">{status}</p>
            <Link className="button" href="/assistant">Open Main Room</Link>
          </div>
        </main>

        <aside className="knowledge-base-inspector" id="knowledge-graph">
          <div className="knowledge-base-pane-head">
            <div>
              <span className="knowledge-base-kicker">Stellar Graph</span>
              <h2>Backlinks and metadata</h2>
            </div>
          </div>
          <div className="knowledge-base-graph">
            <span className="knowledge-base-graph-node active" />
            <span className="knowledge-base-graph-node node-a" />
            <span className="knowledge-base-graph-node node-b" />
            <span className="knowledge-base-graph-node node-c" />
          </div>
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
                <dd>{body.trim().split(/\s+/).filter(Boolean).length}</dd>
              </div>
            </dl>
          ) : (
            <p className="console-copy">Select a note to inspect the connected graph and metadata.</p>
          )}
          <div className="knowledge-base-sidecard">
            <span className="knowledge-base-kicker">Queue State</span>
            <p>
              {outbox.length > 0
                ? "Queued mutations remain replayable without breaking the current editing session."
                : "No queued note mutations are waiting for replay."}
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
