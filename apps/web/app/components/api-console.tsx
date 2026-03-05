"use client";

import { useMemo, useState } from "react";

import { useSessionConfig } from "../session-provider";
import { SessionControls } from "./session-controls";

type ConsoleState = {
  artifactId: string;
  status: string;
};

const defaultPassphrase = "correct horse battery staple";

export function ApiConsole() {
  const { apiBase, token, setToken } = useSessionConfig();
  const [state, setState] = useState<ConsoleState>({
    artifactId: "",
    status: "API console ready",
  });
  const [passphrase, setPassphrase] = useState(defaultPassphrase);
  const [clipText, setClipText] = useState("A clipped idea about active recall and spaced repetition.");

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token],
  );

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
    const response = await fetch(`${apiBase}/v1/artifacts`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        source_type: "clip_manual",
        title: "Quick clip",
        raw_content: clipText,
        normalized_content: clipText,
        extracted_content: clipText,
        metadata: { source: "web_console" },
      }),
    });

    if (!response.ok) {
      setState((prev) => ({ ...prev, status: `Clip failed (${response.status})` }));
      return;
    }

    const payload = (await response.json()) as { id: string };
    setState((prev) => ({ ...prev, artifactId: payload.id, status: `Clip saved: ${payload.id}` }));
  }

  async function runAction(action: "summarize" | "cards" | "tasks" | "append_note") {
    if (!state.artifactId) {
      setState((prev) => ({ ...prev, status: "Create a clip first" }));
      return;
    }

    const response = await fetch(`${apiBase}/v1/artifacts/${state.artifactId}/actions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action }),
    });

    if (!response.ok) {
      setState((prev) => ({ ...prev, status: `${action} failed (${response.status})` }));
      return;
    }

    setState((prev) => ({ ...prev, status: `${action} suggested for ${state.artifactId}` }));
  }

  return (
    <section className="workspace glass">
      <SessionControls />
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
