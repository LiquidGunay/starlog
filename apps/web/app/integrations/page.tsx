"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ENTITY_CACHE_INVALIDATION_EVENT,
  cachePrefixesIntersect,
  clearEntityCachesStale,
  hasStaleEntityCache,
  readEntitySnapshot,
  readEntitySnapshotAsync,
  writeEntitySnapshot,
} from "../lib/entity-snapshot";
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
  resolved_routes?: Record<string, unknown>;
  updated_at?: string | null;
};

type CodexBridgeContract = {
  contract_version: number;
  provider_name: string;
  summary: string;
  native_contract_state: "unavailable" | "available";
  native_contract_detail: string;
  feature_flag_key: string;
  supported_adapter_kinds: string[];
  configured_adapter_kind?: string | null;
  supported_auth: string[];
  supported_capabilities: string[];
  unsupported_capabilities: string[];
  required_config: string[];
  optional_config: string[];
  native_oauth_supported: boolean;
  safe_fallback: string;
  recommended_runtime_mode: "experimental_openai_compatible_bridge" | "api_fallback";
  first_party_blockers: string[];
  configured: boolean;
  enabled: boolean;
  execute_enabled: boolean;
  missing_requirements: string[];
  derived_endpoints: Record<string, string>;
  verified_at: string;
};

type MobileLLMContract = {
  contract_version: number;
  provider_name: string;
  summary: string;
  runtime_state: "unavailable" | "experimental_available";
  feature_flag_key: string;
  route_target: "mobile_bridge";
  required_capabilities: string[];
  capability_checks: Record<string, boolean>;
  required_runtime: string[];
  mobile_bridge_worker_online: boolean;
  phone_local_runtime_supported: boolean;
  blockers: string[];
  recommended_policy_order: Array<"mobile_bridge" | "desktop_bridge" | "api">;
  safe_fallback: string;
  checked_at: string;
};

const INTEGRATIONS_PROVIDERS_SNAPSHOT = "integrations.providers";
const INTEGRATIONS_HEALTH_SNAPSHOT = "integrations.health";
const INTEGRATIONS_POLICY_JSON_SNAPSHOT = "integrations.policy_json";
const INTEGRATIONS_POLICY_META_SNAPSHOT = "integrations.policy_meta";
const INTEGRATIONS_CODEX_CONTRACT_SNAPSHOT = "integrations.codex_contract";
const INTEGRATIONS_MOBILE_LLM_CONTRACT_SNAPSHOT = "integrations.mobile_llm_contract";
const INTEGRATIONS_CACHE_PREFIXES = ["integrations."];
const DEFAULT_POLICY_DRAFT = {
  llm: ["on_device", "batch_local_bridge", "server_local", "codex_bridge", "api_fallback"],
  stt: ["on_device", "batch_local_bridge", "server_local", "api_fallback"],
  tts: ["on_device", "server_local", "api_fallback"],
  ocr: ["on_device"],
};
const DEFAULT_POLICY_JSON = JSON.stringify(DEFAULT_POLICY_DRAFT, null, 2);

export default function IntegrationsPage() {
  const { apiBase, token, mutateWithQueue } = useSessionConfig();
  const [providerName, setProviderName] = useState("local_llm");
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState("local_first");
  const [configJson, setConfigJson] = useState('{"model":"qwen2.5"}');
  const [providers, setProviders] = useState<ProviderConfig[]>(
    () => readEntitySnapshot<ProviderConfig[]>(INTEGRATIONS_PROVIDERS_SNAPSHOT, []),
  );
  const [healthByProvider, setHealthByProvider] = useState<Record<string, ProviderHealth>>(
    () => readEntitySnapshot<Record<string, ProviderHealth>>(INTEGRATIONS_HEALTH_SNAPSHOT, {}),
  );
  const [policyJson, setPolicyJson] = useState(
    () => readEntitySnapshot<string>(INTEGRATIONS_POLICY_JSON_SNAPSHOT, DEFAULT_POLICY_JSON),
  );
  const [policyMeta, setPolicyMeta] = useState<ExecutionPolicy | null>(
    () => readEntitySnapshot<ExecutionPolicy | null>(INTEGRATIONS_POLICY_META_SNAPSHOT, null),
  );
  const [codexContract, setCodexContract] = useState<CodexBridgeContract | null>(
    () => readEntitySnapshot<CodexBridgeContract | null>(INTEGRATIONS_CODEX_CONTRACT_SNAPSHOT, null),
  );
  const [mobileLlmContract, setMobileLlmContract] = useState<MobileLLMContract | null>(
    () => readEntitySnapshot<MobileLLMContract | null>(INTEGRATIONS_MOBILE_LLM_CONTRACT_SNAPSHOT, null),
  );
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    setProviders((previous) => previous.length > 0 ? previous : readEntitySnapshot<ProviderConfig[]>(INTEGRATIONS_PROVIDERS_SNAPSHOT, []));
    setHealthByProvider((previous) =>
      Object.keys(previous).length > 0
        ? previous
        : readEntitySnapshot<Record<string, ProviderHealth>>(INTEGRATIONS_HEALTH_SNAPSHOT, {}),
    );
    setPolicyMeta((previous) => previous ?? readEntitySnapshot<ExecutionPolicy | null>(INTEGRATIONS_POLICY_META_SNAPSHOT, null));
    setCodexContract((previous) => previous ?? readEntitySnapshot<CodexBridgeContract | null>(INTEGRATIONS_CODEX_CONTRACT_SNAPSHOT, null));
    setMobileLlmContract((previous) =>
      previous ?? readEntitySnapshot<MobileLLMContract | null>(INTEGRATIONS_MOBILE_LLM_CONTRACT_SNAPSHOT, null),
    );
    setPolicyJson((previous) => previous || readEntitySnapshot<string>(INTEGRATIONS_POLICY_JSON_SNAPSHOT, DEFAULT_POLICY_JSON));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cachedProviders, cachedHealth, cachedPolicyMeta, cachedPolicyJson, cachedContract, cachedMobileContract] = await Promise.all([
        readEntitySnapshotAsync<ProviderConfig[]>(INTEGRATIONS_PROVIDERS_SNAPSHOT, []),
        readEntitySnapshotAsync<Record<string, ProviderHealth>>(INTEGRATIONS_HEALTH_SNAPSHOT, {}),
        readEntitySnapshotAsync<ExecutionPolicy | null>(INTEGRATIONS_POLICY_META_SNAPSHOT, null),
        readEntitySnapshotAsync<string>(INTEGRATIONS_POLICY_JSON_SNAPSHOT, DEFAULT_POLICY_JSON),
        readEntitySnapshotAsync<CodexBridgeContract | null>(INTEGRATIONS_CODEX_CONTRACT_SNAPSHOT, null),
        readEntitySnapshotAsync<MobileLLMContract | null>(INTEGRATIONS_MOBILE_LLM_CONTRACT_SNAPSHOT, null),
      ]);

      if (cancelled) {
        return;
      }

      if (cachedProviders.length > 0) {
        setProviders(cachedProviders);
      }
      if (Object.keys(cachedHealth).length > 0) {
        setHealthByProvider(cachedHealth);
      }
      if (cachedPolicyMeta) {
        setPolicyMeta(cachedPolicyMeta);
      }
      if (cachedPolicyJson) {
        setPolicyJson(cachedPolicyJson);
      }
      if (cachedContract) {
        setCodexContract(cachedContract);
      }
      if (cachedMobileContract) {
        setMobileLlmContract(cachedMobileContract);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const [payload, policy, codex, mobileLlm] = await Promise.all([
        apiRequest<ProviderConfig[]>(apiBase, token, "/v1/integrations/providers"),
        apiRequest<ExecutionPolicy>(apiBase, token, "/v1/integrations/execution-policy"),
        apiRequest<CodexBridgeContract>(apiBase, token, "/v1/integrations/providers/codex_bridge/contract"),
        apiRequest<MobileLLMContract>(apiBase, token, "/v1/integrations/providers/mobile_llm/contract"),
      ]);
      setProviders(payload);
      setCodexContract(codex);
      setMobileLlmContract(mobileLlm);

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
      const healthMap = Object.fromEntries(healthPairs);
      setHealthByProvider(healthMap);
      setPolicyMeta(policy);
      const nextPolicyJson = JSON.stringify(
        {
          llm: policy.llm,
          stt: policy.stt,
          tts: policy.tts,
          ocr: policy.ocr,
        },
        null,
        2,
      );
      setPolicyJson(nextPolicyJson);
      writeEntitySnapshot(INTEGRATIONS_PROVIDERS_SNAPSHOT, payload);
      writeEntitySnapshot(INTEGRATIONS_HEALTH_SNAPSHOT, healthMap);
      writeEntitySnapshot(INTEGRATIONS_POLICY_META_SNAPSHOT, policy);
      writeEntitySnapshot(INTEGRATIONS_POLICY_JSON_SNAPSHOT, nextPolicyJson);
      writeEntitySnapshot(INTEGRATIONS_CODEX_CONTRACT_SNAPSHOT, codex);
      writeEntitySnapshot(INTEGRATIONS_MOBILE_LLM_CONTRACT_SNAPSHOT, mobileLlm);
      clearEntityCachesStale(INTEGRATIONS_CACHE_PREFIXES);
      setStatus(`Loaded ${payload.length} provider config(s), Codex bridge contract, and phone-local contract`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to load providers";
      setStatus(
        providers.length > 0
          || Object.keys(healthByProvider).length > 0
          || Boolean(policyMeta)
          || Boolean(codexContract)
          || Boolean(mobileLlmContract)
          ? `Loaded cached integration state. ${detail}`
          : detail,
      );
    }
  }, [apiBase, codexContract, healthByProvider, mobileLlmContract, policyMeta, providers.length, token]);

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
      setHealthByProvider((previous) => {
        const next = { ...previous, [provider]: health };
        writeEntitySnapshot(INTEGRATIONS_HEALTH_SNAPSHOT, next);
        return next;
      });
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
        writeEntitySnapshot(INTEGRATIONS_POLICY_META_SNAPSHOT, result.data);
        const nextPolicyJson = JSON.stringify(
          {
            llm: result.data.llm,
            stt: result.data.stt,
            tts: result.data.tts,
            ocr: result.data.ocr,
          },
          null,
          2,
        );
        setPolicyJson(nextPolicyJson);
        writeEntitySnapshot(INTEGRATIONS_POLICY_JSON_SNAPSHOT, nextPolicyJson);
      }
      clearEntityCachesStale(INTEGRATIONS_CACHE_PREFIXES);
      setStatus("Saved execution policy");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save execution policy");
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    loadProviders().catch(() => undefined);
  }, [loadProviders, token]);

  useEffect(() => {
    writeEntitySnapshot(INTEGRATIONS_POLICY_JSON_SNAPSHOT, policyJson);
  }, [policyJson]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const refreshIfStale = () => {
      if (!window.navigator.onLine || !hasStaleEntityCache(INTEGRATIONS_CACHE_PREFIXES)) {
        return;
      }
      loadProviders().catch(() => undefined);
    };

    refreshIfStale();

    const onInvalidation = (event: Event) => {
      const detail = (event as CustomEvent<{ prefixes: string[] }>).detail;
      if (detail && cachePrefixesIntersect(detail.prefixes, INTEGRATIONS_CACHE_PREFIXES)) {
        refreshIfStale();
      }
    };

    window.addEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    return () => {
      window.removeEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    };
  }, [loadProviders, token]);

  return (
    <main className="shell">
      <section className="workspace glass">
        <div>
          <p className="eyebrow">Planner</p>
          <h1>Provider configs and runtime health</h1>
          <p className="console-copy">
            Configure local/API providers, keep secrets redacted, and inspect runtime probe status.
          </p>
          <label className="label" htmlFor="provider-name">
            Provider name
          </label>
          <input
            id="provider-name"
            className="input"
            value={providerName}
            onChange={(event) => setProviderName(event.target.value)}
          />
          <label className="label" htmlFor="provider-mode">
            Mode
          </label>
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
          <label className="label" htmlFor="provider-config">
            Config JSON
          </label>
          <textarea
            id="provider-config"
            className="textarea"
            value={configJson}
            onChange={(event) => setConfigJson(event.target.value)}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => upsertProvider()}>
              Save Provider
            </button>
            <button className="button" type="button" onClick={() => loadProviders()}>
              Refresh List
            </button>
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
                        <p className="console-copy">Secure storage: {health.secure_storage}</p>
                        <p className="console-copy">Checks: {JSON.stringify(health.checks)}</p>
                        <p className="console-copy">Probe: {JSON.stringify(health.probe)}</p>
                        <p className="console-copy">Auth probe: {JSON.stringify(health.auth_probe)}</p>
                      </div>
                    ) : (
                      <p className="console-copy">Health not loaded.</p>
                    )}
                    <div className="button-row">
                      <button
                        className="button"
                        type="button"
                        onClick={() => refreshHealth(provider.provider_name)}
                      >
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
          <h2>Codex bridge contract</h2>
          {!codexContract ? (
            <p className="console-copy">Refresh the provider list to load the current Codex bridge contract.</p>
          ) : (
            <div>
              <p className="console-copy">{codexContract.summary}</p>
              <p className="console-copy">
                contract version: {codexContract.contract_version} | verified: {codexContract.verified_at}
              </p>
              <p className="console-copy">
                native contract state: {codexContract.native_contract_state}
              </p>
              <p className="console-copy">{codexContract.native_contract_detail}</p>
              <p className="console-copy">
                configured: {codexContract.configured ? "yes" : "no"} | enabled:{" "}
                {codexContract.enabled ? "yes" : "no"} | execute enabled:{" "}
                {codexContract.execute_enabled ? "yes" : "no"}
              </p>
              <p className="console-copy">
                feature flag: {codexContract.feature_flag_key} | adapter:{" "}
                {codexContract.configured_adapter_kind || codexContract.supported_adapter_kinds[0]}
              </p>
              <p className="console-copy">
                native OAuth supported: {codexContract.native_oauth_supported ? "yes" : "no"}
              </p>
              <p className="console-copy">
                recommended runtime mode: {codexContract.recommended_runtime_mode}
              </p>
              <p className="console-copy">
                supported capabilities: {codexContract.supported_capabilities.join(", ")}
              </p>
              <p className="console-copy">
                unsupported capabilities: {codexContract.unsupported_capabilities.join(", ")}
              </p>
              <p className="console-copy">required config: {codexContract.required_config.join(" | ")}</p>
              <p className="console-copy">optional config: {codexContract.optional_config.join(" | ")}</p>
              <p className="console-copy">auth modes: {codexContract.supported_auth.join(", ")}</p>
              <p className="console-copy">{codexContract.safe_fallback}</p>
              {codexContract.first_party_blockers.length > 0 ? (
                <div>
                  <p className="console-copy">first-party blockers:</p>
                  <ul>
                    {codexContract.first_party_blockers.map((item) => (
                      <li key={item} className="console-copy">{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {Object.keys(codexContract.derived_endpoints).length > 0 ? (
                <p className="console-copy">
                  derived endpoints: {JSON.stringify(codexContract.derived_endpoints)}
                </p>
              ) : null}
              {codexContract.missing_requirements.length > 0 ? (
                <div>
                  <p className="console-copy">missing requirements:</p>
                  <ul>
                    {codexContract.missing_requirements.map((item) => (
                      <li key={item} className="console-copy">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="panel glass">
          <h2>Execution policy</h2>
          <p className="console-copy">
            Define priority order per capability using canonical targets: `mobile_bridge`, `desktop_bridge`, and `api`.
          </p>
          <p className="console-copy">
            Keep LLM order as <code>{"[\"mobile_bridge\", \"desktop_bridge\", \"api\"]"}</code> to prefer phone-local worker routing first while preserving desktop/API fallback.
          </p>
          {policyMeta ? (
            <p className="console-copy">
              version: {policyMeta.version} | updated: {policyMeta.updated_at || "default"}
            </p>
          ) : null}
          {policyMeta ? (
            <p className="console-copy">Available targets: {JSON.stringify(policyMeta.available_targets)}</p>
          ) : null}
          {policyMeta?.resolved_routes ? (
            <p className="console-copy">Resolved routes: {JSON.stringify(policyMeta.resolved_routes)}</p>
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

        <div className="panel glass">
          <h2>Phone-local LLM contract</h2>
          {!mobileLlmContract ? (
            <p className="console-copy">Refresh the provider list to load phone-local LLM feasibility and routing state.</p>
          ) : (
            <div>
              <p className="console-copy">{mobileLlmContract.summary}</p>
              <p className="console-copy">
                contract version: {mobileLlmContract.contract_version} | checked: {mobileLlmContract.checked_at}
              </p>
              <p className="console-copy">
                runtime state: {mobileLlmContract.runtime_state} | route target: {mobileLlmContract.route_target}
              </p>
              <p className="console-copy">
                feature flag: {mobileLlmContract.feature_flag_key} | mobile worker online:{" "}
                {mobileLlmContract.mobile_bridge_worker_online ? "yes" : "no"} | runtime enabled:{" "}
                {mobileLlmContract.phone_local_runtime_supported ? "yes" : "no"}
              </p>
              <p className="console-copy">
                required capabilities: {mobileLlmContract.required_capabilities.join(", ")}
              </p>
              <p className="console-copy">
                capability checks: {JSON.stringify(mobileLlmContract.capability_checks)}
              </p>
              <p className="console-copy">
                required runtime: {mobileLlmContract.required_runtime.join(" | ")}
              </p>
              <p className="console-copy">
                recommended policy order: {mobileLlmContract.recommended_policy_order.join(" -> ")}
              </p>
              <p className="console-copy">{mobileLlmContract.safe_fallback}</p>
              {mobileLlmContract.blockers.length > 0 ? (
                <div>
                  <p className="console-copy">current blockers:</p>
                  <ul>
                    {mobileLlmContract.blockers.map((item) => (
                      <li key={item} className="console-copy">{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
