"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SessionControls } from "../components/session-controls";
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

type AssistantVoiceJob = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  provider_hint?: string | null;
  provider_used?: string | null;
  action?: string | null;
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

export default function AssistantPage() {
  const { apiBase, token } = useSessionConfig();
  const [command, setCommand] = useState("summarize latest artifact");
  const [status, setStatus] = useState("Ready");
  const [latest, setLatest] = useState<AgentCommandResponse | null>(null);
  const [history, setHistory] = useState<AgentCommandResponse[]>([]);
  const [intents, setIntents] = useState<AgentIntent[]>([]);
  const [voiceJobs, setVoiceJobs] = useState<AssistantVoiceJob[]>([]);
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

  const loadIntents = useCallback(async () => {
    try {
      const payload = await apiRequest<AgentIntent[]>(apiBase, token, "/v1/agent/intents");
      setIntents(payload);
    } catch {
      setIntents([]);
    }
  }, [apiBase, token]);

  const loadVoiceJobs = useCallback(async (origin: "auto" | "manual") => {
    try {
      const payload = await apiRequest<AssistantVoiceJob[]>(
        apiBase,
        token,
        "/v1/ai/jobs?limit=12&action=assistant_command",
      );
      setVoiceJobs(payload);
      const completedCommand = payload.find((job) => job.output.assistant_command);
      if (completedCommand?.output.assistant_command) {
        setLatest((current) => current ?? completedCommand.output.assistant_command ?? null);
        setHistory((previous) => {
          const candidate = completedCommand.output.assistant_command;
          if (!candidate) {
            return previous;
          }
          const next = [candidate, ...previous.filter((item) => item.command !== candidate.command)];
          return next.slice(0, 8);
        });
      }
      if (origin === "manual") {
        setStatus(`Loaded ${payload.length} voice command job(s)`);
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load voice jobs");
      }
    }
  }, [apiBase, token]);

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
      setHistory((previous) => [payload, ...previous].slice(0, 8));
      setStatus(`${execute ? "Executed" : "Planned"} ${payload.matched_intent} via ${payload.planner}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assistant command failed");
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
      const payload = (await response.json()) as AssistantVoiceJob;
      setVoiceJobs((previous) => [payload, ...previous].slice(0, 12));
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
  }, [loadIntents, loadVoiceJobs, token]);

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
            <button className="button" type="button" onClick={() => loadVoiceJobs("manual")}>Refresh Voice Jobs</button>
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
