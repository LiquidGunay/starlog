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

export default function PlannerPage() {
  const { apiBase, token } = useSessionConfig();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [date, setDate] = useState(today);
  const [blocks, setBlocks] = useState<Block[]>([]);
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
      const payload = await apiRequest<Block[]>(apiBase, token, `/v1/planning/blocks/${date}`);
      setBlocks(payload);
      setStatus(`Loaded ${payload.length} blocks`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Load failed");
    }
  }

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Planner</p>
          <h1>Time blocks</h1>
          <label className="label" htmlFor="planner-date">Date</label>
          <input id="planner-date" className="input" value={date} onChange={(event) => setDate(event.target.value)} />
          <div className="button-row">
            <button className="button" type="button" onClick={() => generate()}>Generate</button>
            <button className="button" type="button" onClick={() => load()}>Load</button>
          </div>
          <p className="status">{status}</p>
        </div>
        <div className="panel glass">
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
        </div>
      </section>
    </main>
  );
}
