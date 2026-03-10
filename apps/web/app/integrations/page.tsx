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
  auth_probe: Record<string, string>;
};

type ExecutionPolicy = {
  version: number;
  llm: string[];
  stt: string[];
  tts: string[];
  ocr: string[];
  available_targets: Record<string, string[]>;
  updated_at?: string | null;
};

export default function IntegrationsPage() {
  const { apiBase, token, mutateWithQueue } = useSessionConfig();
  const [providerName, setProviderName] = useState("local_llm");
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState("local_first");
  const [configJson, setConfigJson] = useState('{"model":"qwen2.5"}');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [healthByProvider, setHealthByProvider] = useState<Record<string, ProviderHealth>>({});
  const [policyJson, setPolicyJson] = useState(
    JSON.stringify(
      {
        llm: ["on_device", "batch_local_bridge", "server_local", "codex_bridge", "api_fallback"],
        stt: ["on_device", "batch_local_bridge", "server_local", "api_fallback"],
        tts: ["on_device", "server_local", "api_fallback"],
        ocr: ["on_device"],
      },
      null,
      2,
    ),
  );
  const [policyMeta, setPolicyMeta] = useState<ExecutionPolicy | null>(null);
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
      const policy = await apiRequest<ExecutionPolicy>(apiBase, token, "/v1/integrations/execution-policy");
      setPolicyMeta(policy);
      setPolicyJson(
        JSON.stringify(
          {
            llm: policy.llm,
            stt: policy.stt,
            tts: policy.tts,
            ocr: policy.ocr,
          },
          null,
          2,
        ),
      );
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
      const result = await mutateWithQueue<ProviderConfig>(
        `/v1/integrations/providers/${providerName}`,
        {
          method: "POST",
          body: JSON.stringify({
            enabled,
            mode,
            config: parsedConfig,
          }),
        },
        {
          label: `Save provider config: ${providerName}`,
          entity: "provider_config",
          op: "upsert",
        },
      );
      if (result.queued) {
        setStatus(`Queued provider config for ${providerName}`);
        return;
      }
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

  async function saveExecutionPolicy() {
    let parsedPolicy: Record<string, unknown>;
    try {
      parsedPolicy = JSON.parse(policyJson) as Record<string, unknown>;
    } catch {
      setStatus("Execution policy JSON is invalid");
      return;
    }

    try {
      const result = await mutateWithQueue<ExecutionPolicy>(
        "/v1/integrations/execution-policy",
        {
          method: "POST",
          body: JSON.stringify(parsedPolicy),
        },
        {
          label: "Save execution policy",
          entity: "execution_policy",
          op: "upsert",
        },
      );
      if (result.queued) {
        setStatus("Queued execution policy update");
        return;
      }
      if (result.data) {
        setPolicyMeta(result.data);
      }
      setStatus("Saved execution policy");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save execution policy");
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
                        <p className="console-copy">Auth probe: {JSON.stringify(health.auth_probe)}</p>
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

        <div className="panel glass">
          <h2>Execution policy</h2>
          <p className="console-copy">
            Define priority order per capability. `on_device` is for phone/laptop-native execution, `batch_local_bridge` is for queued local workers, and the remaining targets are server-side fallbacks.
          </p>
          <p className="console-copy">
            Android companion builds can now honor <code>{"stt: [\"on_device\", ...]"}</code> for assistant voice commands when the phone exposes a working speech-recognition service. If that probe fails on-device, the mobile app falls back to the queued Whisper bridge.
          </p>
          {policyMeta ? (
            <p className="console-copy">
              version: {policyMeta.version} | updated: {policyMeta.updated_at || "default"}
            </p>
          ) : null}
          {policyMeta ? (
            <p className="console-copy">Available targets: {JSON.stringify(policyMeta.available_targets)}</p>
          ) : null}
          <label className="label" htmlFor="execution-policy">Policy JSON</label>
          <textarea
            id="execution-policy"
            className="textarea"
            value={policyJson}
            onChange={(event) => setPolicyJson(event.target.value)}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => saveExecutionPolicy()}>
              Save Execution Policy
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
