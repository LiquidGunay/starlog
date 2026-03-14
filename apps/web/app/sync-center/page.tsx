"use client";

import { useCallback, useEffect, useState } from "react";

import { SessionControls } from "../components/session-controls";
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
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type SyncActivityEntry = {
  id: string;
  client_id: string;
  mutation_id: string;
  label: string;
  entity: string;
  op: string;
  method: string;
  path: string;
  status: "queued" | "flushed" | "failed" | "dropped";
  attempts: number;
  detail?: string | null;
  created_at: string;
  recorded_at: string;
};

type SyncActivityListResponse = {
  entries: SyncActivityEntry[];
};

type SyncEvent = {
  cursor: number;
  client_id: string;
  mutation_id: string;
  entity: string;
  op: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  server_received_at: string;
};

type SyncPullResponse = {
  next_cursor: number;
  events: SyncEvent[];
};

const SYNC_SERVER_ENTRIES_SNAPSHOT = "sync.server_entries";
const SYNC_PULL_EVENTS_SNAPSHOT = "sync.pulled_events";
const SYNC_PULL_CURSOR_SNAPSHOT = "sync.pull_cursor";
const SYNC_SCOPE_SNAPSHOT = "sync.scope";
const SYNC_CACHE_PREFIXES = ["sync."];
const SYNC_SERVER_ENTRIES_ENTITY_SCOPE = "sync.server_entries";
const SYNC_PULL_EVENTS_ENTITY_SCOPE = "sync.pulled_events";

function cacheServerEntries(entries: SyncActivityEntry[]): void {
  void replaceEntityCacheScope(
    SYNC_SERVER_ENTRIES_ENTITY_SCOPE,
    entries.map((entry) => ({
      id: entry.id,
      value: entry,
      updated_at: entry.recorded_at,
      search_text: `${entry.label} ${entry.entity} ${entry.status} ${entry.method} ${entry.path}`,
    })),
  );
}

function cachePulledEvents(events: SyncEvent[]): void {
  void replaceEntityCacheScope(
    SYNC_PULL_EVENTS_ENTITY_SCOPE,
    events.map((event) => ({
      id: `${event.cursor}:${event.mutation_id}`,
      value: event,
      updated_at: event.server_received_at,
      search_text: `${event.entity} ${event.op} ${event.client_id} ${event.mutation_id}`,
    })),
  );
}

export default function SyncCenterPage() {
  const {
    apiBase,
    token,
    clientId,
    isOnline,
    outbox,
    replayLog,
    flushSummary,
    flushInFlight,
    flushOutbox,
    dropQueuedMutation,
  } = useSessionConfig();
  const [serverEntries, setServerEntries] = useState<SyncActivityEntry[]>(
    () => readEntitySnapshot<SyncActivityEntry[]>(SYNC_SERVER_ENTRIES_SNAPSHOT, []),
  );
  const [serverScope, setServerScope] = useState<"client" | "all">(
    () => readEntitySnapshot<"client" | "all">(SYNC_SCOPE_SNAPSHOT, "client"),
  );
  const [serverStatus, setServerStatus] = useState("Server sync history idle");
  const [pullCursor, setPullCursor] = useState(
    () => readEntitySnapshot<number>(SYNC_PULL_CURSOR_SNAPSHOT, 0),
  );
  const [pulledEvents, setPulledEvents] = useState<SyncEvent[]>(
    () => readEntitySnapshot<SyncEvent[]>(SYNC_PULL_EVENTS_SNAPSHOT, []),
  );
  const [pullStatus, setPullStatus] = useState("Server delta pull idle");

  useEffect(() => {
    setServerEntries((previous) =>
      previous.length > 0 ? previous : readEntitySnapshot<SyncActivityEntry[]>(SYNC_SERVER_ENTRIES_SNAPSHOT, []),
    );
    setPulledEvents((previous) =>
      previous.length > 0 ? previous : readEntitySnapshot<SyncEvent[]>(SYNC_PULL_EVENTS_SNAPSHOT, []),
    );
    setPullCursor((previous) => previous || readEntitySnapshot<number>(SYNC_PULL_CURSOR_SNAPSHOT, 0));
    setServerScope((previous) => previous || readEntitySnapshot<"client" | "all">(SYNC_SCOPE_SNAPSHOT, "client"));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [
        cachedServerEntries,
        cachedPullEvents,
        bootstrapServerEntries,
        bootstrapPullEvents,
        bootstrapCursor,
        bootstrapScope,
      ] = await Promise.all([
        readEntityCacheScope<SyncActivityEntry>(SYNC_SERVER_ENTRIES_ENTITY_SCOPE),
        readEntityCacheScope<SyncEvent>(SYNC_PULL_EVENTS_ENTITY_SCOPE),
        readEntitySnapshotAsync<SyncActivityEntry[]>(SYNC_SERVER_ENTRIES_SNAPSHOT, []),
        readEntitySnapshotAsync<SyncEvent[]>(SYNC_PULL_EVENTS_SNAPSHOT, []),
        readEntitySnapshotAsync<number>(SYNC_PULL_CURSOR_SNAPSHOT, 0),
        readEntitySnapshotAsync<"client" | "all">(SYNC_SCOPE_SNAPSHOT, "client"),
      ]);

      if (cancelled) {
        return;
      }

      const nextServerEntries =
        cachedServerEntries.length > 0 ? cachedServerEntries : bootstrapServerEntries;
      if (nextServerEntries.length > 0) {
        setServerEntries(nextServerEntries);
      }

      const nextPullEvents = cachedPullEvents.length > 0 ? cachedPullEvents : bootstrapPullEvents;
      if (nextPullEvents.length > 0) {
        setPulledEvents(nextPullEvents);
      }

      if (bootstrapCursor > 0) {
        setPullCursor(bootstrapCursor);
      }
      if (bootstrapScope) {
        setServerScope(bootstrapScope);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeEntitySnapshot(SYNC_PULL_CURSOR_SNAPSHOT, pullCursor);
  }, [pullCursor]);

  useEffect(() => {
    writeEntitySnapshot(SYNC_SCOPE_SNAPSHOT, serverScope);
  }, [serverScope]);

  const loadServerHistory = useCallback(
    async (scope: "client" | "all" = serverScope) => {
      if (!token) {
        setServerStatus("Add bearer token to load server sync history");
        return;
      }

      const query =
        scope === "client"
          ? `/v1/sync/activity?limit=30&client_id=${encodeURIComponent(clientId)}`
          : "/v1/sync/activity?limit=30";
      try {
        const payload = await apiRequest<SyncActivityListResponse>(apiBase, token, query);
        setServerEntries(payload.entries);
        writeEntitySnapshot(SYNC_SERVER_ENTRIES_SNAPSHOT, payload.entries);
        cacheServerEntries(payload.entries);
        clearEntityCachesStale(SYNC_CACHE_PREFIXES);
        setServerStatus(
          `Loaded ${payload.entries.length} server log entr${payload.entries.length === 1 ? "y" : "ies"}`,
        );
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Failed to load server sync history";
        setServerStatus(
          serverEntries.length > 0 ? `Loaded cached server sync history. ${detail}` : detail,
        );
      }
    },
    [apiBase, clientId, serverEntries.length, serverScope, token],
  );

  useEffect(() => {
    loadServerHistory().catch(() => undefined);
  }, [loadServerHistory]);

  async function pullServerEvents(resetCursor = false) {
    if (!token) {
      setPullStatus("Add bearer token to pull sync deltas");
      return;
    }

    const cursor = resetCursor ? 0 : pullCursor;
    try {
      const payload = await apiRequest<SyncPullResponse>(apiBase, token, `/v1/sync/pull?cursor=${cursor}`);
      const nextEvents = resetCursor
        ? payload.events
        : [...payload.events, ...pulledEvents].slice(0, 40);
      setPulledEvents(nextEvents);
      setPullCursor(payload.next_cursor);
      writeEntitySnapshot(SYNC_PULL_EVENTS_SNAPSHOT, nextEvents);
      cachePulledEvents(nextEvents);
      clearEntityCachesStale(SYNC_CACHE_PREFIXES);
      setPullStatus(
        payload.events.length === 0
          ? `No new deltas after cursor ${cursor}`
          : `Pulled ${payload.events.length} delta event(s); next cursor ${payload.next_cursor}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to pull sync deltas";
      setPullStatus(pulledEvents.length > 0 ? `Loaded cached delta events. ${detail}` : detail);
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    const refreshIfStale = () => {
      if (!window.navigator.onLine || !hasStaleEntityCache(SYNC_CACHE_PREFIXES)) {
        return;
      }
      loadServerHistory().catch(() => undefined);
    };

    refreshIfStale();

    const onInvalidation = (event: Event) => {
      const detail = (event as CustomEvent<{ prefixes: string[] }>).detail;
      if (detail && cachePrefixesIntersect(detail.prefixes, SYNC_CACHE_PREFIXES)) {
        refreshIfStale();
      }
    };

    window.addEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    return () => {
      window.removeEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    };
  }, [loadServerHistory, token]);

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Sync Center</p>
          <h1>PWA outbox and replay log</h1>
          <p className="console-copy">
            Inspect queued local mutations, replay them manually, and review the recent flush history.
          </p>
          <p className="console-copy">Client id: {clientId}</p>
          <p className="console-copy">Network: {isOnline ? "online" : "offline"}</p>
          <div className="button-row">
            <button className="button" type="button" onClick={() => flushOutbox()} disabled={flushInFlight}>
              {flushInFlight ? "Replaying..." : "Replay Queued Mutations"}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setServerScope("client");
                loadServerHistory("client").catch(() => undefined);
              }}
            >
              Refresh This Device
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setServerScope("all");
                loadServerHistory("all").catch(() => undefined);
              }}
            >
              Refresh All Devices
            </button>
            <button className="button" type="button" onClick={() => pullServerEvents(false)}>
              Pull Deltas
            </button>
            <button className="button" type="button" onClick={() => pullServerEvents(true)}>
              Reset Pull Cursor
            </button>
          </div>
          <p className="status">{flushSummary}</p>
          <p className="console-copy">{serverStatus}</p>
          <p className="console-copy">{pullStatus}</p>
          <p className="console-copy">Current pull cursor: {pullCursor}</p>
        </div>

        <div className="panel glass">
          <h2>Pending outbox</h2>
          {outbox.length === 0 ? (
            <p className="console-copy">No queued mutations.</p>
          ) : (
            <ul>
              {outbox.map((mutation) => (
                <li key={mutation.id}>
                  <p className="console-copy">
                    <strong>{mutation.label}</strong> [{mutation.method}] {mutation.path}
                  </p>
                  <p className="console-copy">
                    Attempts: {mutation.attempts} | Created: {new Date(mutation.created_at).toLocaleString()}
                  </p>
                  {mutation.last_error ? <p className="console-copy">Last error: {mutation.last_error}</p> : null}
                  <div className="button-row">
                    <button className="button" type="button" onClick={() => dropQueuedMutation(mutation.id)}>
                      Drop
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2>Server mutation history</h2>
          {serverEntries.length === 0 ? (
            <p className="console-copy">No server-side sync history loaded.</p>
          ) : (
            <ul>
              {serverEntries.map((entry) => (
                <li key={entry.id}>
                  <p className="console-copy">
                    <strong>{entry.label}</strong> [{entry.status}] {entry.method} {entry.path}
                  </p>
                  <p className="console-copy">
                    Client: {entry.client_id} | Attempts: {entry.attempts} | Recorded:{" "}
                    {new Date(entry.recorded_at).toLocaleString()}
                  </p>
                  {entry.detail ? <p className="console-copy">Detail: {entry.detail}</p> : null}
                </li>
              ))}
            </ul>
          )}

          <h2>Server delta pull</h2>
          {pulledEvents.length === 0 ? (
            <p className="console-copy">No pulled delta events yet.</p>
          ) : (
            <ul>
              {pulledEvents.map((event) => (
                <li key={`${event.cursor}-${event.mutation_id}`}>
                  <p className="console-copy">
                    <strong>{event.entity}</strong> [{event.op}] cursor {event.cursor}
                  </p>
                  <p className="console-copy">
                    Client: {event.client_id} | Received: {new Date(event.server_received_at).toLocaleString()}
                  </p>
                  <p className="console-copy">Payload: {JSON.stringify(event.payload)}</p>
                </li>
              ))}
            </ul>
          )}

          <h2>Replay log</h2>
          {replayLog.length === 0 ? (
            <p className="console-copy">No replay history yet.</p>
          ) : (
            <ul>
              {replayLog.slice(0, 20).map((entry) => (
                <li key={`${entry.id}-${entry.updated_at}`}>
                  <p className="console-copy">
                    <strong>{entry.label}</strong> [{entry.status}] {entry.method} {entry.path}
                  </p>
                  <p className="console-copy">
                    Attempts: {entry.attempts} | Updated: {new Date(entry.updated_at).toLocaleString()}
                  </p>
                  {entry.last_error ? <p className="console-copy">Detail: {entry.last_error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
