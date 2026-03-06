"use client";

import { useState } from "react";

import { SessionControls } from "../components/session-controls";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type AIJob = {
  id: string;
  capability: string;
  status: "pending" | "running" | "completed" | "failed";
  provider_hint?: string | null;
  provider_used?: string | null;
  artifact_id?: string | null;
  action?: string | null;
  payload: Record<string, unknown>;
  output: Record<string, unknown>;
  error_text?: string | null;
  worker_id?: string | null;
  created_at: string;
  claimed_at?: string | null;
  finished_at?: string | null;
};

export default function AIJobsPage() {
  const { apiBase, token } = useSessionConfig();
  const [jobs, setJobs] = useState<AIJob[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [status, setStatus] = useState("Ready");

  async function loadJobs(nextStatus = statusFilter) {
    try {
      const query = nextStatus ? `?status=${encodeURIComponent(nextStatus)}&limit=50` : "?limit=50";
      const payload = await apiRequest<AIJob[]>(apiBase, token, `/v1/ai/jobs${query}`);
      setJobs(payload);
      setStatus(`Loaded ${payload.length} AI job(s)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load AI jobs");
    }
  }

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">AI Jobs</p>
          <h1>Queued local AI work</h1>
          <p className="console-copy">
            Queue Codex summarization/card/task work plus Whisper voice-note transcription, then process them with the local laptop worker.
          </p>
          <label className="label" htmlFor="ai-job-status">Status filter</label>
          <input
            id="ai-job-status"
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => loadJobs()}>Refresh Jobs</button>
          </div>
          <p className="status">{status}</p>
          <p className="console-copy">
            Local runner command: `python scripts/local_ai_worker.py --api-base http://localhost:8000 --token ... --once`
          </p>
        </div>

        <div className="panel glass">
          <h2>Jobs</h2>
          {jobs.length === 0 ? (
            <p className="console-copy">No jobs loaded yet.</p>
          ) : (
            <ul>
              {jobs.map((job) => (
                <li key={job.id}>
                  <p className="console-copy">
                    <strong>{job.capability}</strong> [{job.status}] {job.id}
                  </p>
                  <p className="console-copy">
                    provider hint: {job.provider_hint || "none"} | provider used: {job.provider_used || "pending"}
                  </p>
                  <p className="console-copy">
                    artifact: {job.artifact_id || "n/a"} | action: {job.action || "n/a"} | worker: {job.worker_id || "n/a"}
                  </p>
                  {job.error_text ? <p className="console-copy">error: {job.error_text}</p> : null}
                  {Object.keys(job.output || {}).length > 0 ? (
                    <p className="console-copy">output: {JSON.stringify(job.output)}</p>
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
