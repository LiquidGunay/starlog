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
};

export default function PlannerPage() {
  const { apiBase, token } = useSessionConfig();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [date, setDate] = useState(today);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [status, setStatus] = useState("Ready");

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

  async function load() {
    try {
      const [blockPayload, eventPayload] = await Promise.all([
        apiRequest<Block[]>(apiBase, token, `/v1/planning/blocks/${date}`),
        apiRequest<EventItem[]>(apiBase, token, "/v1/calendar/events"),
      ]);
      setBlocks(blockPayload);
      setEvents(eventPayload);
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
      const result = await apiRequest<{ pushed: number; pulled: number; conflicts: number }>(
        apiBase,
        token,
        "/v1/calendar/sync/google/run",
        { method: "POST" },
      );
      setStatus(`Google sync pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts}`);
      const conflictPayload = await apiRequest<Conflict[]>(apiBase, token, "/v1/calendar/sync/google/conflicts");
      setConflicts(conflictPayload);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Google sync failed");
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
                  Remote {conflict.remote_id} - strategy {conflict.strategy}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
