"use client";

import { useMemo, useState } from "react";

import { SessionControls } from "../components/session-controls";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type Block = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
};

type EventItem = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  source: string;
};

type Conflict = {
  id: string;
  remote_id: string;
  strategy: string;
  detail: Record<string, unknown>;
  resolved: boolean;
  resolved_at?: string | null;
  resolution_strategy?: string | null;
};

type OAuthStatus = {
  connected: boolean;
  mode?: string | null;
  source?: string | null;
  expires_at?: string | null;
  has_refresh_token: boolean;
  detail: string;
};

type TimelineItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  kind: "block" | "event";
  source: string;
};

function isSameDay(iso: string, date: string): boolean {
  return iso.slice(0, 10) === date;
}

function toMinutes(iso: string): number {
  const stamp = new Date(iso);
  return stamp.getHours() * 60 + stamp.getMinutes();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function PlannerPage() {
  const { apiBase, token } = useSessionConfig();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [date, setDate] = useState(today);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [status, setStatus] = useState("Ready");
  const timeline = useMemo<TimelineItem[]>(() => {
    const blockItems = blocks
      .filter((block) => isSameDay(block.starts_at, date))
      .map<TimelineItem>((block) => ({
        id: `blk-${block.id}`,
        title: block.title,
        startsAt: block.starts_at,
        endsAt: block.ends_at,
        kind: "block",
        source: "planner",
      }));
    const eventItems = events
      .filter((event) => isSameDay(event.starts_at, date))
      .map<TimelineItem>((event) => ({
        id: `evt-${event.id}`,
        title: event.title,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        kind: "event",
        source: event.source,
      }));

    return [...blockItems, ...eventItems].sort((left, right) => toMinutes(left.startsAt) - toMinutes(right.startsAt));
  }, [blocks, events, date]);

  async function generate() {
    try {
      const payload = await apiRequest<{ generated: number; blocks: Block[] }>(
        apiBase,
        token,
        "/v1/planning/blocks/generate",
        {
          method: "POST",
          body: JSON.stringify({ date, day_start_hour: 8, day_end_hour: 20 }),
        },
      );
      setBlocks(payload.blocks);
      setStatus(`Generated ${payload.generated} blocks for ${date}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Generation failed");
    }
  }

  async function loadOauthStatus() {
    try {
      const payload = await apiRequest<OAuthStatus>(apiBase, token, "/v1/calendar/sync/google/oauth/status");
      setOauthStatus(payload);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "OAuth status load failed");
    }
  }

  async function load() {
    try {
      const [blockPayload, eventPayload, oauthPayload] = await Promise.all([
        apiRequest<Block[]>(apiBase, token, `/v1/planning/blocks/${date}`),
        apiRequest<EventItem[]>(apiBase, token, "/v1/calendar/events"),
        apiRequest<OAuthStatus>(apiBase, token, "/v1/calendar/sync/google/oauth/status"),
      ]);
      setBlocks(blockPayload);
      setEvents(eventPayload);
      setOauthStatus(oauthPayload);
      setStatus(`Loaded ${blockPayload.length} blocks and ${eventPayload.length} events`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Load failed");
    }
  }

  async function addSampleEvent() {
    try {
      await apiRequest(apiBase, token, "/v1/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Focus Block",
          starts_at: `${date}T08:00:00+00:00`,
          ends_at: `${date}T09:00:00+00:00`,
          source: "internal",
        }),
      });
      setStatus("Created sample calendar event");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Event create failed");
    }
  }

  async function runGoogleSync() {
    try {
      const result = await apiRequest<{ run_id: string; pushed: number; pulled: number; conflicts: number }>(
        apiBase,
        token,
        "/v1/calendar/sync/google/run",
        { method: "POST" },
      );
      setStatus(`Google sync ${result.run_id}: pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts}`);
      const conflictPayload = await apiRequest<Conflict[]>(apiBase, token, "/v1/calendar/sync/google/conflicts");
      setConflicts(conflictPayload);
      await Promise.all([load(), loadOauthStatus()]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Google sync failed");
    }
  }

  async function resolveConflict(conflictId: string, resolutionStrategy: "local_wins" | "remote_wins" | "dismiss") {
    try {
      await apiRequest(apiBase, token, `/v1/calendar/sync/google/conflicts/${conflictId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution_strategy: resolutionStrategy }),
      });
      setStatus(`Resolved conflict ${conflictId} with ${resolutionStrategy}`);
      const conflictPayload = await apiRequest<Conflict[]>(apiBase, token, "/v1/calendar/sync/google/conflicts");
      setConflicts(conflictPayload);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Conflict resolution failed");
    }
  }

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Planner</p>
          <h1>Time blocks and calendar sync</h1>
          <label className="label" htmlFor="planner-date">Date</label>
          <input id="planner-date" className="input" value={date} onChange={(event) => setDate(event.target.value)} />
          <div className="button-row">
            <button className="button" type="button" onClick={() => generate()}>Generate Blocks</button>
            <button className="button" type="button" onClick={() => load()}>Refresh</button>
            <button className="button" type="button" onClick={() => addSampleEvent()}>Add Event</button>
            <button className="button" type="button" onClick={() => runGoogleSync()}>Run Google Sync</button>
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Day board</h2>
          <p className="console-copy">
            {timeline.length} scheduled item(s) on {date}
          </p>
          {timeline.length === 0 ? (
            <p className="console-copy">No timeline items for this day yet.</p>
          ) : (
            <ul className="timeline-list">
              {timeline.map((item) => (
                <li key={item.id} className="timeline-item">
                  <div>
                    <span className={`timeline-kind ${item.kind === "block" ? "timeline-kind-block" : "timeline-kind-event"}`}>
                      {item.kind}
                    </span>
                    <strong>{item.title}</strong>
                    <p className="console-copy">{item.source}</p>
                  </div>
                  <div className="timeline-time">
                    {formatTime(item.startsAt)} - {formatTime(item.endsAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2>Blocks</h2>
          {blocks.length === 0 ? (
            <p className="console-copy">No blocks yet.</p>
          ) : (
            <ul>
              {blocks.map((block) => (
                <li key={block.id}>
                  <strong>{block.title}</strong> - {block.starts_at} to {block.ends_at}
                </li>
              ))}
            </ul>
          )}

          <h2>Calendar events</h2>
          {events.length === 0 ? (
            <p className="console-copy">No events yet.</p>
          ) : (
            <ul>
              {events.map((event) => (
                <li key={event.id}>
                  <strong>{event.title}</strong> ({event.source})
                </li>
              ))}
            </ul>
          )}

          <h2>Sync conflicts</h2>
          {conflicts.length === 0 ? (
            <p className="console-copy">No conflicts.</p>
          ) : (
            <ul>
              {conflicts.map((conflict) => (
                <li key={conflict.id}>
                  <p className="console-copy">
                    Remote {conflict.remote_id} - policy {conflict.strategy}
                  </p>
                  <div className="button-row">
                    <button className="button" type="button" onClick={() => resolveConflict(conflict.id, "local_wins")}>
                      Local Wins
                    </button>
                    <button className="button" type="button" onClick={() => resolveConflict(conflict.id, "remote_wins")}>
                      Remote Wins
                    </button>
                    <button className="button" type="button" onClick={() => resolveConflict(conflict.id, "dismiss")}>
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2>Google OAuth</h2>
          {!oauthStatus ? (
            <p className="console-copy">OAuth status not loaded.</p>
          ) : (
            <div>
              <p className="console-copy">Connected: {oauthStatus.connected ? "yes" : "no"}</p>
              <p className="console-copy">Mode: {oauthStatus.mode || "n/a"}</p>
              <p className="console-copy">Source: {oauthStatus.source || "n/a"}</p>
              <p className="console-copy">Refresh token: {oauthStatus.has_refresh_token ? "yes" : "no"}</p>
              <p className="console-copy">{oauthStatus.detail}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
