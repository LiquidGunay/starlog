"use client";

import { SessionControls } from "../components/session-controls";
import { useSessionConfig } from "../session-provider";

export default function SyncCenterPage() {
  const {
    clientId,
    isOnline,
    outbox,
    replayLog,
    flushSummary,
    flushInFlight,
    flushOutbox,
    dropQueuedMutation,
  } = useSessionConfig();

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
          </div>
          <p className="status">{flushSummary}</p>
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
