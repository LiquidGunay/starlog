"use client";

import { useState } from "react";

import { SessionControls } from "../components/session-controls";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type ProviderConfig = {
  provider_name: string;
  enabled: boolean;
  mode: string;
  config: Record<string, unknown>;
  updated_at: string;
};

type ProviderHealth = {
  provider_name: string;
  healthy: boolean;
  detail: string;
  checks: Record<string, boolean>;
  secure_storage: string;
  probe: Record<string, string>;
};

export default function IntegrationsPage() {
  const { apiBase, token } = useSessionConfig();
  const [providerName, setProviderName] = useState("local_llm");
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState("local_first");
  const [configJson, setConfigJson] = useState('{"model":"qwen2.5"}');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [healthByProvider, setHealthByProvider] = useState<Record<string, ProviderHealth>>({});
  const [status, setStatus] = useState("Ready");

  async function loadProviders() {
    try {
      const payload = await apiRequest<ProviderConfig[]>(apiBase, token, "/v1/integrations/providers");
      setProviders(payload);

      const healthPairs = await Promise.all(
        payload.map(async (provider) => {
          const health = await apiRequest<ProviderHealth>(
            apiBase,
            token,
            `/v1/integrations/providers/${provider.provider_name}/health`,
          );
          return [provider.provider_name, health] as const;
        }),
      );
      setHealthByProvider(Object.fromEntries(healthPairs));
      setStatus(`Loaded ${payload.length} provider config(s)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load providers");
    }
  }

  async function upsertProvider() {
    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(configJson) as Record<string, unknown>;
    } catch {
      setStatus("Config JSON is invalid");
      return;
    }

    try {
      await apiRequest<ProviderConfig>(apiBase, token, `/v1/integrations/providers/${providerName}`, {
        method: "POST",
        body: JSON.stringify({
          enabled,
          mode,
          config: parsedConfig,
        }),
      });
      setStatus(`Saved provider ${providerName}`);
      await loadProviders();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save provider");
    }
  }

  async function refreshHealth(provider: string) {
    try {
      const health = await apiRequest<ProviderHealth>(
        apiBase,
        token,
        `/v1/integrations/providers/${provider}/health`,
      );
      setHealthByProvider((previous) => ({ ...previous, [provider]: health }));
      setStatus(`Refreshed health for ${provider}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Health refresh failed");
    }
  }

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Integrations</p>
          <h1>Provider configs and runtime health</h1>
          <p className="console-copy">
            Configure local/API providers, keep secrets redacted, and inspect runtime probe status.
          </p>
          <label className="label" htmlFor="provider-name">Provider name</label>
          <input
            id="provider-name"
            className="input"
            value={providerName}
            onChange={(event) => setProviderName(event.target.value)}
          />
          <label className="label" htmlFor="provider-mode">Mode</label>
          <input
            id="provider-mode"
            className="input"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          />
          <label className="label" htmlFor="provider-enabled">
            <input
              id="provider-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />{" "}
            Enabled
          </label>
          <label className="label" htmlFor="provider-config">Config JSON</label>
          <textarea
            id="provider-config"
            className="textarea"
            value={configJson}
            onChange={(event) => setConfigJson(event.target.value)}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => upsertProvider()}>Save Provider</button>
            <button className="button" type="button" onClick={() => loadProviders()}>Refresh List</button>
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Configured providers</h2>
          {providers.length === 0 ? (
            <p className="console-copy">No providers loaded yet.</p>
          ) : (
            <ul>
              {providers.map((provider) => {
                const health = healthByProvider[provider.provider_name];
                return (
                  <li key={provider.provider_name}>
                    <p className="console-copy">
                      <strong>{provider.provider_name}</strong> [{provider.mode}] enabled:{" "}
                      {provider.enabled ? "yes" : "no"}
                    </p>
                    <p className="console-copy">Config: {JSON.stringify(provider.config)}</p>
                    {health ? (
                      <div>
                        <p className="console-copy">
                          Health: {health.healthy ? "ok" : "failed"} ({health.detail})
                        </p>
                        <p className="console-copy">
                          Secure storage: {health.secure_storage}
                        </p>
                        <p className="console-copy">Checks: {JSON.stringify(health.checks)}</p>
                        <p className="console-copy">Probe: {JSON.stringify(health.probe)}</p>
                      </div>
                    ) : (
                      <p className="console-copy">Health not loaded.</p>
                    )}
                    <div className="button-row">
                      <button className="button" type="button" onClick={() => refreshHealth(provider.provider_name)}>
                        Refresh Health
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
