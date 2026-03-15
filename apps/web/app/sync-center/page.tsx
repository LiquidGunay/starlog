"use client";

import { useCallback, useEffect, useState } from "react";

import { SessionControls } from "../components/session-controls";
import { runOfflineWarmup, type OfflineWarmupResult } from "../lib/offline-warmup";
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

const SYNC_CENTER_SCOPE_SNAPSHOT = "sync_center.scope";
const SYNC_CENTER_SERVER_ENTRIES_SNAPSHOT = "sync_center.server_entries";
const SYNC_CENTER_PULL_CURSOR_SNAPSHOT = "sync_center.pull_cursor";
const SYNC_CENTER_PULLED_EVENTS_SNAPSHOT = "sync_center.pulled_events";
const LEGACY_SYNC_CURSOR_KEY = "starlog-sync-cursor";

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
    () => readEntitySnapshot<SyncActivityEntry[]>(SYNC_CENTER_SERVER_ENTRIES_SNAPSHOT, []),
  );
  const [serverScope, setServerScope] = useState<"client" | "all">(
    () => readEntitySnapshot<"client" | "all">(SYNC_CENTER_SCOPE_SNAPSHOT, "client"),
  );
  const [serverStatus, setServerStatus] = useState("Server sync history idle");
  const [pullCursor, setPullCursor] = useState(
    () => readEntitySnapshot<number>(SYNC_CENTER_PULL_CURSOR_SNAPSHOT, 0),
  );
  const [pulledEvents, setPulledEvents] = useState<SyncEvent[]>(
    () => readEntitySnapshot<SyncEvent[]>(SYNC_CENTER_PULLED_EVENTS_SNAPSHOT, []),
  );
  const [pullStatus, setPullStatus] = useState("Server delta pull idle");
  const [warmupStatus, setWarmupStatus] = useState("Offline warmup idle");
  const [warmupResult, setWarmupResult] = useState<OfflineWarmupResult | null>(null);
  const [warmupInFlight, setWarmupInFlight] = useState(false);

  useEffect(() => {
    setServerScope((previous) => previous || readEntitySnapshot<"client" | "all">(SYNC_CENTER_SCOPE_SNAPSHOT, "client"));
    setServerEntries((previous) =>
      previous.length > 0 ? previous : readEntitySnapshot<SyncActivityEntry[]>(SYNC_CENTER_SERVER_ENTRIES_SNAPSHOT, []),
    );
    setPulledEvents((previous) =>
      previous.length > 0 ? previous : readEntitySnapshot<SyncEvent[]>(SYNC_CENTER_PULLED_EVENTS_SNAPSHOT, []),
    );

    const bootstrapCursor = readEntitySnapshot<number>(SYNC_CENTER_PULL_CURSOR_SNAPSHOT, 0);
    if (bootstrapCursor > 0) {
      setPullCursor(bootstrapCursor);
      return;
    }

    const legacyCursor = window.localStorage.getItem(LEGACY_SYNC_CURSOR_KEY);
    if (!legacyCursor) {
      return;
    }
    const parsed = Number(legacyCursor);
    if (Number.isFinite(parsed) && parsed >= 0) {
      setPullCursor(parsed);
      writeEntitySnapshot(SYNC_CENTER_PULL_CURSOR_SNAPSHOT, parsed);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cachedScope, cachedEntries, cachedCursor, cachedEvents] = await Promise.all([
        readEntitySnapshotAsync<"client" | "all">(SYNC_CENTER_SCOPE_SNAPSHOT, "client"),
        readEntitySnapshotAsync<SyncActivityEntry[]>(SYNC_CENTER_SERVER_ENTRIES_SNAPSHOT, []),
        readEntitySnapshotAsync<number>(SYNC_CENTER_PULL_CURSOR_SNAPSHOT, 0),
        readEntitySnapshotAsync<SyncEvent[]>(SYNC_CENTER_PULLED_EVENTS_SNAPSHOT, []),
      ]);

      if (cancelled) {
        return;
      }

      if (cachedScope) {
        setServerScope(cachedScope);
      }
      if (cachedEntries.length > 0) {
        setServerEntries(cachedEntries);
      }
      if (cachedCursor > 0) {
        setPullCursor(cachedCursor);
      }
      if (cachedEvents.length > 0) {
        setPulledEvents(cachedEvents);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeEntitySnapshot(SYNC_CENTER_SCOPE_SNAPSHOT, serverScope);
  }, [serverScope]);

  useEffect(() => {
    writeEntitySnapshot(SYNC_CENTER_PULL_CURSOR_SNAPSHOT, pullCursor);
    window.localStorage.setItem(LEGACY_SYNC_CURSOR_KEY, String(pullCursor));
  }, [pullCursor]);

  useEffect(() => {
    writeEntitySnapshot(SYNC_SCOPE_SNAPSHOT, serverScope);
  }, [serverScope]);

    const query =
      scope === "client"
        ? `/v1/sync/activity?limit=30&client_id=${encodeURIComponent(clientId)}`
        : "/v1/sync/activity?limit=30";
    try {
      const payload = await apiRequest<SyncActivityListResponse>(apiBase, token, query);
      setServerEntries(payload.entries);
      setServerScope(scope);
      writeEntitySnapshot(SYNC_CENTER_SERVER_ENTRIES_SNAPSHOT, payload.entries);
      writeEntitySnapshot(SYNC_CENTER_SCOPE_SNAPSHOT, scope);
      setServerStatus(`Loaded ${payload.entries.length} server log entr${payload.entries.length === 1 ? "y" : "ies"}`);
    } catch (error) {
      setServerStatus(error instanceof Error ? error.message : "Failed to load server sync history");
    }
  }, [apiBase, clientId, serverScope, token]);

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
      setPulledEvents((previous) => {
        const next = (resetCursor ? payload.events : [...payload.events, ...previous]).slice(0, 40);
        writeEntitySnapshot(SYNC_CENTER_PULLED_EVENTS_SNAPSHOT, next);
        return next;
      });
      setPullCursor(payload.next_cursor);
      writeEntitySnapshot(SYNC_CENTER_PULL_CURSOR_SNAPSHOT, payload.next_cursor);
      setPullStatus(
        payload.events.length === 0
          ? `No new deltas after cursor ${cursor}`
          : `Pulled ${payload.events.length} delta event(s); next cursor ${payload.next_cursor}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to pull sync deltas";
      setPullStatus(pulledEvents.length > 0 ? `Loaded cached pulled deltas. ${detail}` : detail);
    }
  }

  async function runWarmup() {
    if (warmupInFlight) {
      return;
    }
    if (!token) {
      setWarmupStatus("Add bearer token to run offline warmup");
      return;
    }

    setWarmupInFlight(true);
    setWarmupStatus("Warming offline snapshots...");
    try {
      const result = await runOfflineWarmup(apiBase, token);
      const failed = result.steps.filter((step) => step.status === "failed");
      setWarmupResult(result);
      if (failed.length === 0) {
        setWarmupStatus(`Offline warmup complete: ${result.warmed_snapshots} snapshots updated`);
      } else {
        setWarmupStatus(
          `Offline warmup partial: ${result.warmed_snapshots} snapshots updated, ${failed.length} step(s) failed`,
        );
      }
    } catch (error) {
      setWarmupStatus(error instanceof Error ? error.message : "Offline warmup failed");
    } finally {
      setWarmupInFlight(false);
    }
  }

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
            <button className="button" type="button" onClick={() => runWarmup()} disabled={warmupInFlight}>
              {warmupInFlight ? "Warming Offline Cache..." : "Offline Warmup"}
            </button>
          </div>
          <p className="status">{flushSummary}</p>
          <p className="console-copy">{serverStatus}</p>
          <p className="console-copy">{pullStatus}</p>
          <p className="console-copy">{warmupStatus}</p>
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

          <h2>Offline warmup report</h2>
          {!warmupResult ? (
            <p className="console-copy">Run Offline Warmup to pre-load route snapshots for offline use.</p>
          ) : (
            <>
              <p className="console-copy">
                Updated snapshots: {warmupResult.warmed_snapshots} | Completed: {new Date(warmupResult.finished_at).toLocaleString()}
              </p>
              <ul>
                {warmupResult.steps.map((step) => (
                  <li key={step.id}>
                    <p className="console-copy">
                      <strong>{step.label}</strong> [{step.status}] snapshots: {step.warmed_snapshots}
                    </p>
                    {step.detail ? <p className="console-copy">Detail: {step.detail}</p> : null}
                  </li>
                ))}
              </ul>
            </>
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
