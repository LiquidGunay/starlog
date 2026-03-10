"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SessionControls } from "../components/session-controls";
import { readEntitySnapshot, writeEntitySnapshot } from "../lib/entity-snapshot";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type AgentCommandStep = {
  tool_name: string;
  arguments: Record<string, unknown>;
  status: "planned" | "ok" | "dry_run" | "failed";
  message?: string | null;
  result: unknown;
};

type AgentCommandResponse = {
  command: string;
  planner: string;
  matched_intent: string;
  status: "planned" | "executed" | "failed";
  summary: string;
  steps: AgentCommandStep[];
};

type AgentIntent = {
  name: string;
  description: string;
  examples: string[];
};

type AssistantQueuedJob = {
  id: string;
  capability: "stt" | "llm_agent_plan";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  provider_hint?: string | null;
  provider_used?: string | null;
  action?: string | null;
  payload: {
    command?: string;
    title?: string;
  };
  output: {
    transcript?: string;
    assistant_command?: AgentCommandResponse;
  };
  error_text?: string | null;
  created_at: string;
  finished_at?: string | null;
};

const FALLBACK_EXAMPLES = [
  "summarize latest artifact",
  "create cards for latest artifact",
  "create task Review the latest summary due tomorrow priority 4",
  "create note Morning plan: Focus on review queue and planner cleanup",
  "create event Deep Work from 2026-03-07 09:00 to 2026-03-07 10:00",
  "schedule alarm for tomorrow at 07:00",
  "show execution policy",
];

const ASSISTANT_HISTORY_SNAPSHOT = "assistant.history";
const ASSISTANT_INTENTS_SNAPSHOT = "assistant.intents";
const ASSISTANT_VOICE_JOBS_SNAPSHOT = "assistant.voice_jobs";
const ASSISTANT_AI_JOBS_SNAPSHOT = "assistant.ai_jobs";

export default function AssistantPage() {
  const { apiBase, token } = useSessionConfig();
  const [command, setCommand] = useState("summarize latest artifact");
  const [status, setStatus] = useState("Ready");
  const [latest, setLatest] = useState<AgentCommandResponse | null>(() => {
    const cached = readEntitySnapshot<AgentCommandResponse[]>(ASSISTANT_HISTORY_SNAPSHOT, []);
    return cached[0] ?? null;
  });
  const [history, setHistory] = useState<AgentCommandResponse[]>(() => readEntitySnapshot<AgentCommandResponse[]>(ASSISTANT_HISTORY_SNAPSHOT, []));
  const [intents, setIntents] = useState<AgentIntent[]>(() => readEntitySnapshot<AgentIntent[]>(ASSISTANT_INTENTS_SNAPSHOT, []));
  const [voiceJobs, setVoiceJobs] = useState<AssistantQueuedJob[]>(() => readEntitySnapshot<AssistantQueuedJob[]>(ASSISTANT_VOICE_JOBS_SNAPSHOT, []));
  const [assistJobs, setAssistJobs] = useState<AssistantQueuedJob[]>(() => readEntitySnapshot<AssistantQueuedJob[]>(ASSISTANT_AI_JOBS_SNAPSHOT, []));
  const [recording, setRecording] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const browserSupportsRecording = useMemo(
    () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    [],
  );
  const exampleCommands = useMemo(() => {
    const collected = intents.flatMap((intent) => intent.examples);
    return collected.length > 0 ? collected : FALLBACK_EXAMPLES;
  }, [intents]);

  useEffect(() => {
    setHistory((previous) => previous.length > 0 ? previous : readEntitySnapshot<AgentCommandResponse[]>(ASSISTANT_HISTORY_SNAPSHOT, []));
    setLatest((previous) => previous ?? readEntitySnapshot<AgentCommandResponse[]>(ASSISTANT_HISTORY_SNAPSHOT, [])[0] ?? null);
    setIntents((previous) => previous.length > 0 ? previous : readEntitySnapshot<AgentIntent[]>(ASSISTANT_INTENTS_SNAPSHOT, []));
    setVoiceJobs((previous) => previous.length > 0 ? previous : readEntitySnapshot<AssistantQueuedJob[]>(ASSISTANT_VOICE_JOBS_SNAPSHOT, []));
    setAssistJobs((previous) => previous.length > 0 ? previous : readEntitySnapshot<AssistantQueuedJob[]>(ASSISTANT_AI_JOBS_SNAPSHOT, []));
  }, []);

  const loadIntents = useCallback(async () => {
    try {
      const payload = await apiRequest<AgentIntent[]>(apiBase, token, "/v1/agent/intents");
      setIntents(payload);
      writeEntitySnapshot(ASSISTANT_INTENTS_SNAPSHOT, payload);
    } catch {
      setIntents([]);
    }
  }, [apiBase, token]);

  const recordCompletedCommand = useCallback((candidate: AgentCommandResponse | null | undefined) => {
    if (!candidate) {
      return;
    }
    setLatest(candidate);
    setHistory((previous) => {
      const next = [candidate, ...previous.filter((item) => item.command !== candidate.command || item.planner !== candidate.planner)].slice(0, 8);
      writeEntitySnapshot(ASSISTANT_HISTORY_SNAPSHOT, next);
      return next;
    });
  }, []);

  const loadVoiceJobs = useCallback(async (origin: "auto" | "manual") => {
    try {
      const payload = await apiRequest<AssistantQueuedJob[]>(
        apiBase,
        token,
        "/v1/ai/jobs?limit=12&action=assistant_command",
      );
      setVoiceJobs(payload);
      writeEntitySnapshot(ASSISTANT_VOICE_JOBS_SNAPSHOT, payload);
      recordCompletedCommand(payload.find((job) => job.output.assistant_command)?.output.assistant_command);
      if (origin === "manual") {
        setStatus(`Loaded ${payload.length} voice command job(s)`);
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load voice jobs");
      }
    }
  }, [apiBase, recordCompletedCommand, token]);

  const loadAssistJobs = useCallback(async (origin: "auto" | "manual") => {
    try {
      const payload = await apiRequest<AssistantQueuedJob[]>(
        apiBase,
        token,
        "/v1/ai/jobs?limit=12&action=assistant_command_ai",
      );
      setAssistJobs(payload);
      writeEntitySnapshot(ASSISTANT_AI_JOBS_SNAPSHOT, payload);
      recordCompletedCommand(payload.find((job) => job.output.assistant_command)?.output.assistant_command);
      if (origin === "manual") {
        setStatus(`Loaded ${payload.length} queued Codex planner job(s)`);
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load queued Codex jobs");
      }
    }
  }, [apiBase, recordCompletedCommand, token]);

  async function runCommand(execute: boolean) {
    const trimmed = command.trim();
    if (!trimmed) {
      setStatus("Enter a command first");
      return;
    }

    try {
      const payload = await apiRequest<AgentCommandResponse>(apiBase, token, "/v1/agent/command", {
        method: "POST",
        body: JSON.stringify({
          command: trimmed,
          execute,
          device_target: "web-pwa",
        }),
      });
      setLatest(payload);
      setHistory((previous) => {
        const next = [payload, ...previous].slice(0, 8);
        writeEntitySnapshot(ASSISTANT_HISTORY_SNAPSHOT, next);
        return next;
      });
      setStatus(`${execute ? "Executed" : "Planned"} ${payload.matched_intent} via ${payload.planner}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assistant command failed");
    }
  }

  async function queueAssistCommand(execute: boolean) {
    const trimmed = command.trim();
    if (!trimmed) {
      setStatus("Enter a command first");
      return;
    }

    try {
      const payload = await apiRequest<AssistantQueuedJob>(apiBase, token, "/v1/agent/command/assist", {
        method: "POST",
        body: JSON.stringify({
          command: trimmed,
          execute,
          device_target: "web-pwa",
          provider_hint: "codex_local",
        }),
      });
      setAssistJobs((previous) => {
        const next = [payload, ...previous.filter((item) => item.id !== payload.id)].slice(0, 12);
        writeEntitySnapshot(ASSISTANT_AI_JOBS_SNAPSHOT, next);
        return next;
      });
      setStatus(`Queued Codex ${execute ? "execute" : "plan"} job ${payload.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to queue Codex planner job");
    }
  }

  async function startVoiceRecording() {
    if (!browserSupportsRecording) {
      setStatus("This browser does not support recording voice commands");
      return;
    }
    if (recording) {
      setStatus("Voice recording is already in progress");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setVoiceBlob(blob);
        setRecording(false);
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setStatus("Voice command ready to upload");
      };
      recorder.start();
      recorderRef.current = recorder;
      streamRef.current = stream;
      setVoiceBlob(null);
      setRecording(true);
      setStatus("Recording voice command...");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to start voice recording");
    }
  }

  function stopVoiceRecording() {
    if (!recorderRef.current) {
      setStatus("No voice command recording is in progress");
      return;
    }
    recorderRef.current.stop();
  }

  async function submitVoiceCommand(execute: boolean) {
    if (!voiceBlob) {
      setStatus("Record a voice command first");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("title", "Web voice command");
      formData.append("execute", execute ? "true" : "false");
      formData.append("device_target", "web-pwa");
      formData.append("provider_hint", "whisper_local");
      formData.append("file", new File([voiceBlob], `voice-command-${Date.now()}.webm`, { type: voiceBlob.type || "audio/webm" }));

      const response = await fetch(`${apiBase}/v1/agent/command/voice`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Voice command upload failed: ${response.status} ${body}`);
      }
      const payload = (await response.json()) as AssistantQueuedJob;
      setVoiceJobs((previous) => {
        const next = [payload, ...previous].slice(0, 12);
        writeEntitySnapshot(ASSISTANT_VOICE_JOBS_SNAPSHOT, next);
        return next;
      });
      setVoiceBlob(null);
      setStatus(`Queued voice command ${payload.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Voice command upload failed");
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    loadIntents().catch(() => undefined);
    loadVoiceJobs("auto").catch(() => undefined);
    loadAssistJobs("auto").catch(() => undefined);
  }, [loadAssistJobs, loadIntents, loadVoiceJobs, token]);

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Assistant</p>
          <h1>Command shell</h1>
          <p className="console-copy">
            Type or speak a command, inspect the planned tool calls, then execute without clicking through the rest of the UI.
          </p>
          <label className="label" htmlFor="assistant-command">Command</label>
          <textarea
            id="assistant-command"
            className="textarea"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            rows={5}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => runCommand(false)}>Plan Command</button>
            <button className="button" type="button" onClick={() => runCommand(true)}>Execute Command</button>
            <button className="button" type="button" onClick={() => queueAssistCommand(false)}>Queue Codex Plan</button>
            <button className="button" type="button" onClick={() => queueAssistCommand(true)}>Queue Codex Execute</button>
            <button className="button" type="button" onClick={() => {
              loadVoiceJobs("manual").catch(() => undefined);
              loadAssistJobs("manual").catch(() => undefined);
            }}>Refresh Jobs</button>
          </div>
          <div className="button-row">
            <button className="button" type="button" onClick={recording ? stopVoiceRecording : startVoiceRecording}>
              {recording ? "Stop Voice Command" : "Start Voice Command"}
            </button>
            <button className="button" type="button" onClick={() => submitVoiceCommand(false)}>Plan Voice</button>
            <button className="button" type="button" onClick={() => submitVoiceCommand(true)}>Execute Voice</button>
          </div>
          <p className="console-copy">Voice clip: {recording ? "recording..." : voiceBlob ? "ready" : "none"}</p>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Intent catalog</h2>
          {intents.length === 0 ? (
            <p className="console-copy">No intent catalog loaded yet. Fallback examples are still available.</p>
          ) : (
            <ul>
              {intents.map((intent) => (
                <li key={intent.name}>
                  <p className="console-copy">
                    <strong>{intent.name}</strong> - {intent.description}
                  </p>
                  <div className="button-row">
                    {intent.examples.map((example) => (
                      <button key={example} className="button" type="button" onClick={() => setCommand(example)}>
                        {example}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {intents.length === 0 ? (
            <div className="button-row">
              {exampleCommands.map((example) => (
                <button key={example} className="button" type="button" onClick={() => setCommand(example)}>
                  {example}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="panel glass">
          <h2>Latest response</h2>
          {!latest ? (
            <p className="console-copy">No command run yet.</p>
          ) : (
            <>
              <p className="console-copy">
                intent: {latest.matched_intent} [{latest.status}]
              </p>
              <p className="console-copy">{latest.summary}</p>
              {latest.steps.map((step, index) => (
                <div key={`${step.tool_name}-${index}`} className="panel glass">
                  <p className="console-copy">
                    <strong>{step.tool_name}</strong> [{step.status}]
                  </p>
                  {step.message ? <p className="console-copy">{step.message}</p> : null}
                  <p className="console-copy">arguments</p>
                  <pre className="console-copy">{JSON.stringify(step.arguments, null, 2)}</pre>
                  <p className="console-copy">result</p>
                  <pre className="console-copy">{JSON.stringify(step.result, null, 2)}</pre>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="panel glass">
          <h2>Voice jobs</h2>
          {voiceJobs.length === 0 ? (
            <p className="console-copy">No voice command jobs yet.</p>
          ) : (
            <ul>
              {voiceJobs.map((job) => (
                <li key={job.id}>
                  <p className="console-copy">
                    <strong>{job.id}</strong> [{job.status}] provider: {job.provider_used || job.provider_hint || "pending"}
                  </p>
                  <p className="console-copy">
                    created: {new Date(job.created_at).toLocaleString()}
                    {job.finished_at ? ` | finished: ${new Date(job.finished_at).toLocaleString()}` : ""}
                  </p>
                  {job.output.transcript ? <p className="console-copy">transcript: {job.output.transcript}</p> : null}
                  {job.output.assistant_command ? (
                    <p className="console-copy">
                      command result: {job.output.assistant_command.matched_intent} [{job.output.assistant_command.status}]
                    </p>
                  ) : null}
                  {job.error_text ? <p className="console-copy">error: {job.error_text}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel glass">
          <h2>Queued Codex jobs</h2>
          {assistJobs.length === 0 ? (
            <p className="console-copy">No queued Codex planner jobs yet.</p>
          ) : (
            <ul>
              {assistJobs.map((job) => (
                <li key={job.id}>
                  <p className="console-copy">
                    <strong>{job.id}</strong> [{job.status}] provider: {job.provider_used || job.provider_hint || "pending"}
                  </p>
                  {job.payload.command ? <p className="console-copy">command: {job.payload.command}</p> : null}
                  <p className="console-copy">
                    created: {new Date(job.created_at).toLocaleString()}
                    {job.finished_at ? ` | finished: ${new Date(job.finished_at).toLocaleString()}` : ""}
                  </p>
                  {job.output.assistant_command ? (
                    <p className="console-copy">
                      command result: {job.output.assistant_command.matched_intent} [{job.output.assistant_command.status}]
                    </p>
                  ) : null}
                  {job.error_text ? <p className="console-copy">error: {job.error_text}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel glass">
          <h2>Recent history</h2>
          {history.length === 0 ? (
            <p className="console-copy">No history yet.</p>
          ) : (
            <ul>
              {history.map((entry, index) => (
                <li key={`${entry.command}-${index}`}>
                  <p className="console-copy">
                    <strong>{entry.command}</strong> [{entry.status}]
                  </p>
                  <p className="console-copy">
                    planner: {entry.planner} | intent: {entry.matched_intent}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
