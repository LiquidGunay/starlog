"use client";

import { useSessionConfig } from "../session-provider";

export function SessionControls() {
  const { apiBase, token, setApiBase, setToken } = useSessionConfig();

  return (
    <div className="session-controls glass">
      <div>
        <label className="label" htmlFor="session-api-base">API base</label>
        <input
          id="session-api-base"
          className="input"
          value={apiBase}
          onChange={(event) => setApiBase(event.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="session-token">Bearer token</label>
        <input
          id="session-token"
          className="input"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          type="password"
        />
      </div>
    </div>
  );
}
