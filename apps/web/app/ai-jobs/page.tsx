"use client";

import { useEffect, useState } from "react";

import { readEntitySnapshot, readEntitySnapshotAsync, writeEntitySnapshot } from "../lib/entity-snapshot";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type AIJob = {
  id: string;
  capability: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
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

const AI_JOBS_LIST_SNAPSHOT = "ai_jobs.items";
const AI_JOBS_STATUS_FILTER_SNAPSHOT = "ai_jobs.filter.status";
const AI_JOBS_CAPABILITY_FILTER_SNAPSHOT = "ai_jobs.filter.capability";
const AI_JOBS_PROVIDER_FILTER_SNAPSHOT = "ai_jobs.filter.provider";
const AI_JOBS_ACTION_FILTER_SNAPSHOT = "ai_jobs.filter.action";
const AI_JOBS_RETRY_PROVIDER_SNAPSHOT = "ai_jobs.retry_provider";

export default function AIJobsPage() {
  const { apiBase, token } = useSessionConfig();
  const [jobs, setJobs] = useState<AIJob[]>(() => readEntitySnapshot<AIJob[]>(AI_JOBS_LIST_SNAPSHOT, []));
  const [statusFilter, setStatusFilter] = useState(
    () => readEntitySnapshot<string>(AI_JOBS_STATUS_FILTER_SNAPSHOT, "pending"),
  );
  const [capabilityFilter, setCapabilityFilter] = useState(
    () => readEntitySnapshot<string>(AI_JOBS_CAPABILITY_FILTER_SNAPSHOT, ""),
  );
  const [providerFilter, setProviderFilter] = useState(
    () => readEntitySnapshot<string>(AI_JOBS_PROVIDER_FILTER_SNAPSHOT, ""),
  );
  const [actionFilter, setActionFilter] = useState(
    () => readEntitySnapshot<string>(AI_JOBS_ACTION_FILTER_SNAPSHOT, ""),
  );
  const [retryProviderHint, setRetryProviderHint] = useState(
    () => readEntitySnapshot<string>(AI_JOBS_RETRY_PROVIDER_SNAPSHOT, ""),
  );
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    setJobs((previous) => previous.length > 0 ? previous : readEntitySnapshot<AIJob[]>(AI_JOBS_LIST_SNAPSHOT, []));
    setStatusFilter((previous) => previous || readEntitySnapshot<string>(AI_JOBS_STATUS_FILTER_SNAPSHOT, "pending"));
    setCapabilityFilter((previous) => previous || readEntitySnapshot<string>(AI_JOBS_CAPABILITY_FILTER_SNAPSHOT, ""));
    setProviderFilter((previous) => previous || readEntitySnapshot<string>(AI_JOBS_PROVIDER_FILTER_SNAPSHOT, ""));
    setActionFilter((previous) => previous || readEntitySnapshot<string>(AI_JOBS_ACTION_FILTER_SNAPSHOT, ""));
    setRetryProviderHint((previous) => previous || readEntitySnapshot<string>(AI_JOBS_RETRY_PROVIDER_SNAPSHOT, ""));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cachedJobs, cachedStatus, cachedCapability, cachedProvider, cachedAction, cachedRetryProvider] =
        await Promise.all([
          readEntitySnapshotAsync<AIJob[]>(AI_JOBS_LIST_SNAPSHOT, []),
          readEntitySnapshotAsync<string>(AI_JOBS_STATUS_FILTER_SNAPSHOT, "pending"),
          readEntitySnapshotAsync<string>(AI_JOBS_CAPABILITY_FILTER_SNAPSHOT, ""),
          readEntitySnapshotAsync<string>(AI_JOBS_PROVIDER_FILTER_SNAPSHOT, ""),
          readEntitySnapshotAsync<string>(AI_JOBS_ACTION_FILTER_SNAPSHOT, ""),
          readEntitySnapshotAsync<string>(AI_JOBS_RETRY_PROVIDER_SNAPSHOT, ""),
        ]);

      if (cancelled) {
        return;
      }

      if (cachedJobs.length > 0) {
        setJobs(cachedJobs);
      }
      if (cachedStatus) {
        setStatusFilter(cachedStatus);
      }
      if (cachedCapability) {
        setCapabilityFilter(cachedCapability);
      }
      if (cachedProvider) {
        setProviderFilter(cachedProvider);
      }
      if (cachedAction) {
        setActionFilter(cachedAction);
      }
      if (cachedRetryProvider) {
        setRetryProviderHint(cachedRetryProvider);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadJobs(nextStatus = statusFilter) {
    try {
      const params = new URLSearchParams();
      if (nextStatus) {
        params.set("status", nextStatus);
      }
      if (capabilityFilter.trim()) {
        params.set("capability", capabilityFilter.trim());
      }
      if (providerFilter.trim()) {
        params.set("provider_hint", providerFilter.trim());
      }
      if (actionFilter.trim()) {
        params.set("action", actionFilter.trim());
      }
      params.set("limit", "50");
      const query = `?${params.toString()}`;
      const payload = await apiRequest<AIJob[]>(apiBase, token, `/v1/ai/jobs${query}`);
      setJobs(payload);
      writeEntitySnapshot(AI_JOBS_LIST_SNAPSHOT, payload);
      writeEntitySnapshot(AI_JOBS_STATUS_FILTER_SNAPSHOT, nextStatus);
      setStatus(`Loaded ${payload.length} AI job(s)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load AI jobs");
    }
  }

  useEffect(() => {
    writeEntitySnapshot(AI_JOBS_STATUS_FILTER_SNAPSHOT, statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    writeEntitySnapshot(AI_JOBS_CAPABILITY_FILTER_SNAPSHOT, capabilityFilter);
  }, [capabilityFilter]);

  useEffect(() => {
    writeEntitySnapshot(AI_JOBS_PROVIDER_FILTER_SNAPSHOT, providerFilter);
  }, [providerFilter]);

  useEffect(() => {
    writeEntitySnapshot(AI_JOBS_ACTION_FILTER_SNAPSHOT, actionFilter);
  }, [actionFilter]);

  useEffect(() => {
    writeEntitySnapshot(AI_JOBS_RETRY_PROVIDER_SNAPSHOT, retryProviderHint);
  }, [retryProviderHint]);

  async function cancelJob(jobId: string) {
    setBusyJobId(jobId);
    try {
      await apiRequest<AIJob>(apiBase, token, `/v1/ai/jobs/${jobId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Cancelled from /ai-jobs" }),
      });
      setStatus(`Cancelled ${jobId}`);
      await loadJobs();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to cancel job");
    } finally {
      setBusyJobId(null);
    }
  }

  async function retryJob(jobId: string) {
    setBusyJobId(jobId);
    try {
      await apiRequest<AIJob>(apiBase, token, `/v1/ai/jobs/${jobId}/retry`, {
        method: "POST",
        body: JSON.stringify({
          provider_hint: retryProviderHint.trim() || undefined,
        }),
      });
      setStatus(`Retried ${jobId}`);
      await loadJobs();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to retry job");
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <main className="shell">
      <section className="workspace glass">
        <div>
          <p className="eyebrow">Assistant</p>
          <h1>Queued local AI work</h1>
          <p className="console-copy">
            Queue Codex, Whisper, and local TTS work, then inspect, cancel, or retry those jobs from one place.
          </p>
          <label className="label" htmlFor="ai-job-status">Status filter</label>
          <input
            id="ai-job-status"
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          />
          <label className="label" htmlFor="ai-job-capability">Capability filter</label>
          <input
            id="ai-job-capability"
            className="input"
            value={capabilityFilter}
            onChange={(event) => setCapabilityFilter(event.target.value)}
            placeholder="tts"
          />
          <label className="label" htmlFor="ai-job-provider">Provider hint filter</label>
          <input
            id="ai-job-provider"
            className="input"
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)}
            placeholder="piper_local"
          />
          <label className="label" htmlFor="ai-job-action">Action filter</label>
          <input
            id="ai-job-action"
            className="input"
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
            placeholder="briefing_audio"
          />
          <label className="label" htmlFor="ai-job-retry-provider">Retry provider override</label>
          <input
            id="ai-job-retry-provider"
            className="input"
            value={retryProviderHint}
            onChange={(event) => setRetryProviderHint(event.target.value)}
            placeholder="say_local"
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => loadJobs()}>Refresh Jobs</button>
          </div>
          <p className="status">{status}</p>
          <p className="console-copy">
            Local runner command: `python scripts/local_ai_worker.py --api-base http://localhost:8000 --token ... --once`
          </p>
          <p className="console-copy">
            TTS worker hints now include `piper_local`, `say_local`, `espeak_local`, and `espeak_ng_local`.
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
                  <p className="console-copy">
                    created: {new Date(job.created_at).toLocaleString()}
                    {job.claimed_at ? ` | claimed: ${new Date(job.claimed_at).toLocaleString()}` : ""}
                    {job.finished_at ? ` | finished: ${new Date(job.finished_at).toLocaleString()}` : ""}
                  </p>
                  {(job.status === "pending" || job.status === "running" || job.status === "failed" || job.status === "cancelled") ? (
                    <div className="button-row">
                      {(job.status === "pending" || job.status === "running") ? (
                        <button
                          className="button"
                          type="button"
                          onClick={() => cancelJob(job.id)}
                          disabled={busyJobId === job.id}
                        >
                          {busyJobId === job.id ? "Working..." : "Cancel"}
                        </button>
                      ) : null}
                      {(job.status === "failed" || job.status === "cancelled") ? (
                        <button
                          className="button"
                          type="button"
                          onClick={() => retryJob(job.id)}
                          disabled={busyJobId === job.id}
                        >
                          {busyJobId === job.id ? "Working..." : "Retry"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {job.error_text ? <p className="console-copy">error: {job.error_text}</p> : null}
                  {Object.keys(job.output || {}).length > 0 ? (
                    <pre className="console-copy">{JSON.stringify(job.output, null, 2)}</pre>
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
