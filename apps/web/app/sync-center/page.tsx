"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ObservatoryWorkspaceShell } from "../components/observatory-shell";
import { readEntitySnapshot, readEntitySnapshotAsync, writeEntitySnapshot } from "../lib/entity-snapshot";
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
  const pathname = usePathname();
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

  const loadServerHistory = useCallback(
    async (scope: "client" | "all" = serverScope) => {
      if (!token) {
        setServerStatus("Add bearer token to load server sync history");
        return;
      }

      setServerStatus("Loading server sync history...");
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
    },
    [apiBase, clientId, serverScope, token],
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

  const progressSegments = 5;
  const progressActive = [
    isOnline,
    outbox.length === 0,
    serverEntries.length > 0,
    pulledEvents.length > 0,
    Boolean(warmupResult),
  ].filter(Boolean).length;
  const latestReplay = replayLog[0] ?? null;
  const latestServerEntry = serverEntries[0] ?? null;
  const warmupFailures = warmupResult?.steps.filter((step) => step.status === "failed").length ?? 0;

  return (
    <ObservatoryWorkspaceShell
      pathname={pathname}
      surface="srs-review"
      eyebrow="SRS Review"
      title="Sync diagnostics, replay edge, and offline cache readiness."
      description="Keep the specialized replay and offline tooling intact, but frame it as a support surface for review and shared state reliability."
      statusLabel={isOnline ? "Online replay available" : "Offline mode"}
      stats={[
        { label: "Queued", value: String(outbox.length) },
        { label: "Server entries", value: String(serverEntries.length) },
        { label: "Delta events", value: String(pulledEvents.length) },
      ]}
      actions={
        <div className="button-row">
          <button className="button" type="button" onClick={() => flushOutbox()} disabled={flushInFlight}>
            {flushInFlight ? "Replaying..." : "Replay queued mutations"}
          </button>
          <button className="button" type="button" onClick={() => runWarmup()} disabled={warmupInFlight}>
            {warmupInFlight ? "Warming cache..." : "Offline warmup"}
          </button>
        </div>
      }
      sideNote={{
        title: "Support posture",
        body: "This route exists to keep shared state healthy across devices, not to become the default path for ordinary review work.",
        meta: `Scope ${serverScope === "client" ? "this device" : "all devices"} · cursor ${pullCursor}`,
      }}
      orbitCards={[
        {
          kicker: "Review",
          title: "Return to focus review",
          body: "Use the main SRS review route for card work and deck flow.",
          href: "/review",
          actionLabel: "Open review",
        },
        {
          kicker: "Warmup",
          title: warmupResult ? `${warmupResult.warmed_snapshots} snapshots warmed` : "Offline warmup idle",
          body: warmupFailures > 0 ? `${warmupFailures} warmup step(s) failed.` : "Run warmup before going offline.",
        },
      ]}
      className="sync-observatory-shell"
    >
      <section className="neural-sync-main sync-center-main">
        <article className="sync-card sync-center-hero-card">
          <span className="sync-tag">Scope: {serverScope === "client" ? "this_device" : "all_devices"}</span>
          <div className="sync-prompt">
            Keep queued mutations moving, audit the replay edge, and pre-load the offline cache before the next disconnect.
          </div>
          <div className="sync-center-stat-grid">
            <article className="sync-center-stat-card">
              <strong>{outbox.length}</strong>
              <span>queued mutations</span>
            </article>
            <article className="sync-center-stat-card">
              <strong>{serverEntries.length}</strong>
              <span>server entries</span>
            </article>
            <article className="sync-center-stat-card">
              <strong>{pulledEvents.length}</strong>
              <span>delta events</span>
            </article>
            <article className="sync-center-stat-card">
              <strong>{warmupResult?.warmed_snapshots ?? 0}</strong>
              <span>warmed snapshots</span>
            </article>
          </div>
          <div className="button-row sync-center-action-row">
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
              Reset Cursor
            </button>
            <button className="button" type="button" onClick={() => runWarmup()} disabled={warmupInFlight}>
              {warmupInFlight ? "Warming Offline Cache..." : "Offline Warmup"}
            </button>
          </div>
          <div className="sync-answer">
            <p className="console-copy">Client id: {clientId}</p>
            <p className="console-copy">Network: {isOnline ? "online" : "offline"}</p>
            <p className="console-copy">{flushSummary}</p>
            <p className="console-copy">{serverStatus}</p>
            <p className="console-copy">{pullStatus}</p>
            <p className="console-copy">{warmupStatus}</p>
            <p className="console-copy">Current pull cursor: {pullCursor}</p>
          </div>
        </article>

        <div className="sync-center-deck">
          <section className="sync-center-panel glass">
            <div className="sync-sidecar-head">
              <div>
                <p className="eyebrow">Replay Edge</p>
                <h2>Pending outbox</h2>
              </div>
            </div>
            {outbox.length === 0 ? (
              <p className="console-copy">No queued mutations.</p>
            ) : (
              <ul className="sync-center-list">
                {outbox.map((mutation) => (
                  <li key={mutation.id} className="sync-center-list-item">
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

            <div className="sync-center-panel-footnote">
              {latestReplay ? (
                <p className="console-copy">
                  Latest replay: <strong>{latestReplay.label}</strong> [{latestReplay.status}]
                </p>
              ) : (
                <p className="console-copy">No replay history yet.</p>
              )}
            </div>
          </section>

          <section className="sync-center-panel glass">
            <div className="sync-sidecar-head">
              <div>
                <p className="eyebrow">Server Audit</p>
                <h2>Mutation history and deltas</h2>
              </div>
            </div>
            <div className="sync-center-panel-stack">
              <div>
                <p className="command-footnote">Server mutation history</p>
                {serverEntries.length === 0 ? (
                  <p className="console-copy">No server-side sync history loaded.</p>
                ) : (
                  <ul className="sync-center-list">
                    {serverEntries.map((entry) => (
                      <li key={entry.id} className="sync-center-list-item">
                        <p className="console-copy">
                          <strong>{entry.label}</strong> [{entry.status}] {entry.method} {entry.path}
                        </p>
                        <p className="console-copy">
                          Client: {entry.client_id} | Attempts: {entry.attempts} | Recorded: {new Date(entry.recorded_at).toLocaleString()}
                        </p>
                        {entry.detail ? <p className="console-copy">Detail: {entry.detail}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="command-footnote">Server delta pull</p>
                {pulledEvents.length === 0 ? (
                  <p className="console-copy">No pulled delta events yet.</p>
                ) : (
                  <ul className="sync-center-list">
                    {pulledEvents.map((event) => (
                      <li key={`${event.cursor}-${event.mutation_id}`} className="sync-center-list-item">
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
              </div>
            </div>

            <div className="sync-center-panel-footnote">
              {latestServerEntry ? (
                <p className="console-copy">
                  Latest server record: <strong>{latestServerEntry.label}</strong> [{latestServerEntry.status}]
                </p>
              ) : (
                <p className="console-copy">Server history has not been loaded yet.</p>
              )}
            </div>
          </section>

          <section className="sync-center-panel glass">
            <div className="sync-sidecar-head">
              <div>
                <p className="eyebrow">Offline Warmup</p>
                <h2>Cache readiness</h2>
              </div>
            </div>
            {!warmupResult ? (
              <p className="console-copy">Run Offline Warmup to pre-load route snapshots for offline use.</p>
            ) : (
              <>
                <div className="sync-center-warmup-summary">
                  <span>Updated snapshots: {warmupResult.warmed_snapshots}</span>
                  <span>Failures: {warmupFailures}</span>
                  <span>Completed: {new Date(warmupResult.finished_at).toLocaleString()}</span>
                </div>
                <ul className="sync-center-list">
                  {warmupResult.steps.map((step) => (
                    <li key={step.id} className="sync-center-list-item">
                      <p className="console-copy">
                        <strong>{step.label}</strong> [{step.status}] snapshots: {step.warmed_snapshots}
                      </p>
                      {step.detail ? <p className="console-copy">Detail: {step.detail}</p> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div>
              <p className="command-footnote">Replay log</p>
              {replayLog.length === 0 ? (
                <p className="console-copy">No replay history yet.</p>
              ) : (
                <ul className="sync-center-list">
                  {replayLog.slice(0, 20).map((entry) => (
                    <li key={`${entry.id}-${entry.updated_at}`} className="sync-center-list-item">
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
        </div>
      </section>
    </ObservatoryWorkspaceShell>
  );
}
