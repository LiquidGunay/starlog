"use client";

import { useState } from "react";

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

const EXAMPLE_COMMANDS = [
  "summarize latest artifact",
  "create cards for latest artifact",
  "create task Review the latest summary due tomorrow priority 4",
  "create note Morning plan: Focus on review queue and planner cleanup",
  "create event Deep Work from 2026-03-07 09:00 to 2026-03-07 10:00",
  "schedule alarm for tomorrow at 07:00",
  "search for spaced repetition",
];

export default function AssistantPage() {
  const { apiBase, token } = useSessionConfig();
  const [command, setCommand] = useState("summarize latest artifact");
  const [status, setStatus] = useState("Ready");
  const [latest, setLatest] = useState<AgentCommandResponse | null>(null);
  const [history, setHistory] = useState<AgentCommandResponse[]>([]);

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

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Assistant</p>
          <h1>Command shell</h1>
          <p className="console-copy">
            Type a command, inspect the planned tool calls, then execute without clicking through the rest of the UI.
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
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Example commands</h2>
          <div className="button-row">
            {EXAMPLE_COMMANDS.map((example) => (
              <button key={example} className="button" type="button" onClick={() => setCommand(example)}>
                {example}
              </button>
            ))}
          </div>
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
