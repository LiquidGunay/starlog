"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  listEntityCacheRetentionPolicies,
  runEntityCacheRetentionSweep,
} from "../lib/entity-cache";
import {
  listEntitySnapshotRetentionPolicies,
  runEntitySnapshotRetentionSweep,
} from "../lib/entity-snapshot";
import { useSessionConfig } from "../session-provider";

export function SessionControls() {
  const {
    apiBase,
    token,
    isOnline,
    outbox,
    flushSummary,
    flushInFlight,
    setApiBase,
    setToken,
    flushOutbox,
  } = useSessionConfig();
  const [retentionStatus, setRetentionStatus] = useState("Auto retention idle");
  const [retentionBusy, setRetentionBusy] = useState(false);
  const sweepInFlightRef = useRef(false);

  const entityPolicySummary = useMemo(() => {
    const policies = listEntityCacheRetentionPolicies();
    const defaultPolicy = policies.find((policy) => policy.scope_prefix === "default");
    const customCount = policies.length - (defaultPolicy ? 1 : 0);
    return defaultPolicy
      ? `Entity cache: ${customCount} scoped rules + default ${defaultPolicy.max_records} records`
      : `Entity cache: ${customCount} scoped rules`;
  }, []);

  const snapshotPolicySummary = useMemo(() => {
    const policies = listEntitySnapshotRetentionPolicies();
    const defaultPolicy = policies.find((policy) => policy.prefix === "default");
    const customCount = policies.length - (defaultPolicy ? 1 : 0);
    return defaultPolicy
      ? `Snapshot cache: ${customCount} prefix rules + default ${defaultPolicy.max_records} records / ${defaultPolicy.max_age_days}d`
      : `Snapshot cache: ${customCount} prefix rules`;
  }, []);

  const runRetentionSweep = useCallback(async () => {
    if (sweepInFlightRef.current) {
      return;
    }
    sweepInFlightRef.current = true;
    setRetentionBusy(true);
    try {
      const [entityResult, snapshotResult] = await Promise.all([
        runEntityCacheRetentionSweep(),
        runEntitySnapshotRetentionSweep(),
      ]);
      setRetentionStatus(
        `Retention sweep pruned ${entityResult.pruned_records} entity + ${snapshotResult.pruned_records} snapshot records (pressure: entity=${entityResult.storage_pressure}, snapshot=${snapshotResult.storage_pressure})`,
      );
    } catch (error) {
      setRetentionStatus(error instanceof Error ? error.message : "Retention sweep failed");
    } finally {
      setRetentionBusy(false);
      sweepInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    runRetentionSweep().catch(() => undefined);
  }, [runRetentionSweep]);

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
      <div>
        <p className="label">PWA sync</p>
        <p className="console-copy">
          Network: {isOnline ? "online" : "offline"} | queued: {outbox.length}
        </p>
        <div className="button-row">
          <button
            className="button"
            type="button"
            onClick={() => flushOutbox()}
            disabled={flushInFlight}
          >
            {flushInFlight ? "Replaying..." : "Replay Outbox"}
          </button>
        </div>
        <p className="console-copy">{flushSummary}</p>
        <p className="label">Cache retention</p>
        <p className="console-copy">{entityPolicySummary}</p>
        <p className="console-copy">{snapshotPolicySummary}</p>
        <div className="button-row">
          <button
            className="button"
            type="button"
            onClick={() => runRetentionSweep()}
            disabled={retentionBusy}
          >
            {retentionBusy ? "Sweeping..." : "Run Retention Sweep"}
          </button>
        </div>
        <p className="console-copy">{retentionStatus}</p>
      </div>
    </div>
  );
}
