"use client";

import Link from "next/link";

import { SessionControls } from "../components/session-controls";
import { useSessionConfig } from "../session-provider";

export default function RuntimePage() {
  const { apiBase, isOnline, outbox, replayLog } = useSessionConfig();

  return (
    <main className="shell">
      <section className="workspace glass runtime-shell">
        <div className="runtime-hero">
          <div>
            <p className="eyebrow">Runtime Console</p>
            <h1>Central session and sync configuration</h1>
            <p className="console-copy">
              Shared provider access, API connectivity, and outbox replay live here now instead of repeating inside
              every workspace tab.
            </p>
          </div>
          <div className="runtime-hero-meta">
            <p className="console-copy">API base: {apiBase}</p>
            <p className="console-copy">Network: {isOnline ? "online" : "offline"}</p>
            <p className="console-copy">Queued mutations: {outbox.length}</p>
            <p className="console-copy">Replay log entries: {replayLog.length}</p>
          </div>
        </div>

        <SessionControls variant="full" />

        <section className="runtime-shortcuts">
          <div className="runtime-shortcut-card glass">
            <p className="eyebrow">Provider setup</p>
            <h2>Integrations</h2>
            <p className="console-copy">
              Configure provider contracts, runtime health checks, and execution policy once for the whole PWA.
            </p>
            <Link href="/integrations" className="button">
              Open Integrations
            </Link>
          </div>

          <div className="runtime-shortcut-card glass">
            <p className="eyebrow">Queue visibility</p>
            <h2>Sync Center</h2>
            <p className="console-copy">
              Inspect queued mutations, replay history, and offline warmup without carrying the full session form on
              each surface.
            </p>
            <Link href="/sync-center" className="button">
              Open Sync Center
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
