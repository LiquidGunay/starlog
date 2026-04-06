"use client";

import { useEffect, useState } from "react";

import { readEntitySnapshot, readEntitySnapshotAsync, writeEntitySnapshot } from "../lib/entity-snapshot";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type AgentToolDefinition = {
  name: string;
  description: string;
  parameters_schema: Record<string, unknown>;
  backing_endpoint?: string | null;
};

type AgentToolResult = {
  tool_name: string;
  status: "ok" | "dry_run";
  validated_arguments: Record<string, unknown>;
  result: unknown;
};

const AGENT_TOOLS_CATALOG_SNAPSHOT = "agent_tools.catalog";
const AGENT_TOOLS_SELECTED_SNAPSHOT = "agent_tools.selected";
const AGENT_TOOLS_ARGUMENTS_SNAPSHOT = "agent_tools.arguments";
const AGENT_TOOLS_RESULT_SNAPSHOT = "agent_tools.result";

export default function AgentToolsPage() {
  const { apiBase, token } = useSessionConfig();
  const [tools, setTools] = useState<AgentToolDefinition[]>(
    () => readEntitySnapshot<AgentToolDefinition[]>(AGENT_TOOLS_CATALOG_SNAPSHOT, []),
  );
  const [selectedTool, setSelectedTool] = useState(
    () => readEntitySnapshot<string>(AGENT_TOOLS_SELECTED_SNAPSHOT, ""),
  );
  const [argumentsJson, setArgumentsJson] = useState(
    () => readEntitySnapshot<string>(AGENT_TOOLS_ARGUMENTS_SNAPSHOT, "{}"),
  );
  const [resultJson, setResultJson] = useState(
    () => readEntitySnapshot<string>(AGENT_TOOLS_RESULT_SNAPSHOT, "{}"),
  );
  const [status, setStatus] = useState("Ready");

  const selectedDefinition = tools.find((item) => item.name === selectedTool) ?? null;

  useEffect(() => {
    setTools((previous) => previous.length > 0 ? previous : readEntitySnapshot<AgentToolDefinition[]>(AGENT_TOOLS_CATALOG_SNAPSHOT, []));
    setSelectedTool((previous) => previous || readEntitySnapshot<string>(AGENT_TOOLS_SELECTED_SNAPSHOT, ""));
    setArgumentsJson((previous) => previous || readEntitySnapshot<string>(AGENT_TOOLS_ARGUMENTS_SNAPSHOT, "{}"));
    setResultJson((previous) => previous || readEntitySnapshot<string>(AGENT_TOOLS_RESULT_SNAPSHOT, "{}"));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cachedTools, cachedSelected, cachedArguments, cachedResult] = await Promise.all([
        readEntitySnapshotAsync<AgentToolDefinition[]>(AGENT_TOOLS_CATALOG_SNAPSHOT, []),
        readEntitySnapshotAsync<string>(AGENT_TOOLS_SELECTED_SNAPSHOT, ""),
        readEntitySnapshotAsync<string>(AGENT_TOOLS_ARGUMENTS_SNAPSHOT, "{}"),
        readEntitySnapshotAsync<string>(AGENT_TOOLS_RESULT_SNAPSHOT, "{}"),
      ]);

      if (cancelled) {
        return;
      }

      if (cachedTools.length > 0) {
        setTools(cachedTools);
      }
      if (cachedSelected) {
        setSelectedTool(cachedSelected);
      }
      if (cachedArguments) {
        setArgumentsJson(cachedArguments);
      }
      if (cachedResult) {
        setResultJson(cachedResult);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadTools() {
    try {
      const payload = await apiRequest<AgentToolDefinition[]>(apiBase, token, "/v1/agent/tools");
      setTools(payload);
      writeEntitySnapshot(AGENT_TOOLS_CATALOG_SNAPSHOT, payload);
      const nextSelected = payload.some((item) => item.name === selectedTool)
        ? selectedTool
        : (payload[0]?.name ?? "");
      setSelectedTool(nextSelected);
      writeEntitySnapshot(AGENT_TOOLS_SELECTED_SNAPSHOT, nextSelected);
      setStatus(`Loaded ${payload.length} agent tools`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load agent tools");
    }
  }

  async function runTool(dryRun: boolean) {
    if (!selectedTool) {
      setStatus("Load and select a tool first");
      return;
    }
    try {
      const parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
      const payload = await apiRequest<AgentToolResult>(apiBase, token, "/v1/agent/execute", {
        method: "POST",
        body: JSON.stringify({
          tool_name: selectedTool,
          arguments: parsed,
          dry_run: dryRun,
        }),
      });
      const rendered = JSON.stringify(payload, null, 2);
      setResultJson(rendered);
      writeEntitySnapshot(AGENT_TOOLS_RESULT_SNAPSHOT, rendered);
      setStatus(`${dryRun ? "Dry-ran" : "Executed"} ${selectedTool}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Tool execution failed");
    }
  }

  useEffect(() => {
    writeEntitySnapshot(AGENT_TOOLS_SELECTED_SNAPSHOT, selectedTool);
  }, [selectedTool]);

  useEffect(() => {
    writeEntitySnapshot(AGENT_TOOLS_ARGUMENTS_SNAPSHOT, argumentsJson);
  }, [argumentsJson]);

  useEffect(() => {
    writeEntitySnapshot(AGENT_TOOLS_RESULT_SNAPSHOT, resultJson);
  }, [resultJson]);

  return (
    <main className="shell">
      <section className="workspace glass">
        <div>
          <p className="eyebrow">Main Room</p>
          <h1>LLM-control surface</h1>
          <p className="console-copy">
            This exposes Starlog actions as explicit tool schemas so chat/voice interfaces can call them without UI clicks.
          </p>
          <div className="button-row">
            <button className="button" type="button" onClick={loadTools}>Load Tools</button>
            <button className="button" type="button" onClick={() => runTool(true)}>Dry Run</button>
            <button className="button" type="button" onClick={() => runTool(false)}>Execute</button>
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Tool Catalog</h2>
          {tools.length === 0 ? (
            <p className="console-copy">No tools loaded yet.</p>
          ) : (
            <ul>
              {tools.map((tool) => (
                <li key={tool.name}>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setSelectedTool(tool.name);
                      setArgumentsJson("{}");
                    }}
                  >
                    {tool.name}
                  </button>
                  <p className="console-copy">{tool.description}</p>
                  <p className="console-copy">endpoint: {tool.backing_endpoint || "n/a"}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel glass">
          <h2>Selected Tool</h2>
          <p className="console-copy">name: {selectedTool || "none"}</p>
          {selectedDefinition ? (
            <>
              <p className="console-copy">schema:</p>
              <pre className="console-copy">{JSON.stringify(selectedDefinition.parameters_schema, null, 2)}</pre>
            </>
          ) : null}
          <label className="label" htmlFor="agent-tool-args">Arguments JSON</label>
          <textarea
            id="agent-tool-args"
            className="input"
            value={argumentsJson}
            onChange={(event) => setArgumentsJson(event.target.value)}
            rows={10}
          />
          <p className="console-copy">Result</p>
          <pre className="console-copy">{resultJson}</pre>
        </div>
      </section>
    </main>
  );
}
