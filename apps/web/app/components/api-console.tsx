"use client";

import { useState } from "react";

import { useSessionConfig } from "../session-provider";

type ConsoleState = {
  artifactId: string;
  status: string;
};

const defaultPassphrase = "correct horse battery staple";

export function ApiConsole() {
  const { apiBase, setToken, mutateWithQueue } = useSessionConfig();
  const [state, setState] = useState<ConsoleState>({
    artifactId: "",
    status: "API console ready",
  });
  const [passphrase, setPassphrase] = useState(defaultPassphrase);
  const [clipText, setClipText] = useState("A clipped idea about active recall and spaced repetition.");

  async function bootstrap() {
    const response = await fetch(`${apiBase}/v1/auth/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });

    if (response.status === 201 || response.status === 409) {
      setState((prev) => ({ ...prev, status: response.status === 201 ? "Bootstrapped" : "Already bootstrapped" }));
      return;
    }

    setState((prev) => ({ ...prev, status: `Bootstrap failed (${response.status})` }));
  }

  async function login() {
    const response = await fetch(`${apiBase}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });

    if (!response.ok) {
      setState((prev) => ({ ...prev, status: `Login failed (${response.status})` }));
      return;
    }

    const payload = (await response.json()) as { access_token: string };
    setToken(payload.access_token);
    setState((prev) => ({ ...prev, status: "Logged in" }));
  }

  async function createClip() {
    const result = await mutateWithQueue<{ artifact: { id: string } }>(
      "/v1/capture",
      {
        method: "POST",
        body: JSON.stringify({
          source_type: "clip_manual",
          capture_source: "pwa_console",
          title: "Quick clip",
          raw: { text: clipText, mime_type: "text/plain" },
          normalized: { text: clipText, mime_type: "text/plain" },
          extracted: { text: clipText, mime_type: "text/plain" },
          metadata: { source: "web_console" },
        }),
      },
      {
        label: "Console clip",
        entity: "artifact",
        op: "create",
      },
    );

    if (result.queued || !result.data) {
      setState((prev) => ({ ...prev, status: "Clip queued for replay" }));
      return;
    }

    const payload = result.data;
    setState((prev) => ({
      ...prev,
      artifactId: payload.artifact.id,
      status: `Clip saved: ${payload.artifact.id}`,
    }));
  }

  async function runAction(action: "summarize" | "cards" | "tasks" | "append_note") {
    if (!state.artifactId) {
      setState((prev) => ({ ...prev, status: "Create a clip first" }));
      return;
    }

    const result = await mutateWithQueue(
      `/v1/artifacts/${state.artifactId}/actions`,
      {
        method: "POST",
        body: JSON.stringify({ action }),
      },
      {
        label: `Console action: ${action}`,
        entity: "artifact_action",
        op: action,
      },
    );

    setState((prev) => ({
      ...prev,
      status: result.queued
        ? `${action} queued for replay`
        : `${action} suggested for ${state.artifactId}`,
    }));
  }

  return (
    <section className="workspace glass">
      <div className="console-grid">
        <div>
          <p className="eyebrow">Live API Console</p>
          <h2>Drive Starlog from the workspace</h2>
          <p className="console-copy">
            Bootstrap auth, login, clip text, and run quick actions directly against the FastAPI backend.
          </p>
          <label className="label" htmlFor="passphrase">Passphrase</label>
          <input
            id="passphrase"
            className="input"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            type="password"
          />
          <div className="button-row">
            <button className="button" type="button" onClick={bootstrap}>Bootstrap</button>
            <button className="button" type="button" onClick={login}>Login</button>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="clip-text">Quick clip text</label>
          <textarea
            id="clip-text"
            className="textarea"
            value={clipText}
            onChange={(event) => setClipText(event.target.value)}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={createClip}>Create Clip</button>
            <button className="button" type="button" onClick={() => runAction("summarize")}>Summarize</button>
            <button className="button" type="button" onClick={() => runAction("cards")}>Create Cards</button>
          </div>
          <div className="button-row">
            <button className="button" type="button" onClick={() => runAction("tasks")}>Suggest Tasks</button>
            <button className="button" type="button" onClick={() => runAction("append_note")}>Append Note</button>
          </div>
          <p className="status">{state.status}</p>
        </div>
      </div>
    </section>
  );
}
