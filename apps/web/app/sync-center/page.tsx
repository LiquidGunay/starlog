"use client";

import { useCallback, useEffect, useState } from "react";

import { SessionControls } from "../components/session-controls";
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
  const [serverEntries, setServerEntries] = useState<SyncActivityEntry[]>([]);
  const [serverScope, setServerScope] = useState<"client" | "all">("client");
  const [serverStatus, setServerStatus] = useState("Server sync history idle");
  const [pullCursor, setPullCursor] = useState(0);
  const [pulledEvents, setPulledEvents] = useState<SyncEvent[]>([]);
  const [pullStatus, setPullStatus] = useState("Server delta pull idle");

  useEffect(() => {
    const storedCursor = window.localStorage.getItem("starlog-sync-cursor");
    if (!storedCursor) {
      return;
    }
    const parsed = Number(storedCursor);
    if (Number.isFinite(parsed) && parsed >= 0) {
      setPullCursor(parsed);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("starlog-sync-cursor", String(pullCursor));
  }, [pullCursor]);

  const loadServerHistory = useCallback(async (scope: "client" | "all" = serverScope) => {
    if (!token) {
      setServerEntries([]);
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
      setPulledEvents([]);
      setPullStatus("Add bearer token to pull sync deltas");
      return;
    }

    const cursor = resetCursor ? 0 : pullCursor;
    try {
      const payload = await apiRequest<SyncPullResponse>(apiBase, token, `/v1/sync/pull?cursor=${cursor}`);
      setPulledEvents((previous) => (resetCursor ? payload.events : [...payload.events, ...previous].slice(0, 40)));
      setPullCursor(payload.next_cursor);
      setPullStatus(
        payload.events.length === 0
          ? `No new deltas after cursor ${cursor}`
          : `Pulled ${payload.events.length} delta event(s); next cursor ${payload.next_cursor}`,
      );
    } catch (error) {
      setPullStatus(error instanceof Error ? error.message : "Failed to pull sync deltas");
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
            <button
              className="button"
              type="button"
              onClick={() => flushOutbox()}
              disabled={flushInFlight}
            >
              {flushInFlight ? "Replaying..." : "Replay Queued Mutations"}
            </button>
            <button className="button" type="button" onClick={() => {
              setServerScope("client");
              loadServerHistory("client").catch(() => undefined);
            }}>
              Refresh This Device
            </button>
            <button className="button" type="button" onClick={() => {
              setServerScope("all");
              loadServerHistory("all").catch(() => undefined);
            }}>
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
                  {mutation.last_error ? (
                    <p className="console-copy">Last error: {mutation.last_error}</p>
                  ) : null}
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
                  {entry.detail ? (
                    <p className="console-copy">Detail: {entry.detail}</p>
                  ) : null}
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
                  {entry.last_error ? (
                    <p className="console-copy">Detail: {entry.last_error}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
