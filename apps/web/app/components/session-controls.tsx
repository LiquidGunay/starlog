"use client";

import { useCallback, useEffect, useState } from "react";

import { clearAllEntityCacheRecords, listEntityCacheScopeSummaries } from "../lib/entity-cache";
import {
  ENTITY_CACHE_INVALIDATION_EVENT,
  clearAllEntitySnapshots,
  clearEntityCachesStale,
  listStaleEntityCaches,
  summarizeEntitySnapshotStorage,
} from "../lib/entity-snapshot";
import { useSessionConfig } from "../session-provider";

type CacheStatus = {
  stalePrefixes: string[];
  entityScopes: string[];
  entityRecordCount: number;
  snapshotCount: number;
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
  refreshedAt: string | null;
};

function formatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }

  if (value < 1_024) {
    return `${value} B`;
  }
  if (value < 1_024 * 1_024) {
    return `${(value / 1_024).toFixed(1)} KB`;
  }
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

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
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>({
    stalePrefixes: [],
    entityScopes: [],
    entityRecordCount: 0,
    snapshotCount: 0,
    storageUsageBytes: null,
    storageQuotaBytes: null,
    refreshedAt: null,
  });
  const [cacheStatusText, setCacheStatusText] = useState("Cache status idle");
  const [cacheBusy, setCacheBusy] = useState(false);

  const loadCacheStatus = useCallback(async () => {
    const [scopeSummaries, snapshotSummary] = await Promise.all([
      listEntityCacheScopeSummaries(),
      summarizeEntitySnapshotStorage(),
    ]);
    const storageEstimate =
      typeof navigator !== "undefined" && navigator.storage?.estimate
        ? await navigator.storage.estimate().catch(() => null)
        : null;

    setCacheStatus({
      stalePrefixes: listStaleEntityCaches().map((entry) => entry.prefix),
      entityScopes: scopeSummaries.map((entry) => entry.scope),
      entityRecordCount: scopeSummaries.reduce((total, entry) => total + entry.records, 0),
      snapshotCount: snapshotSummary.total_records,
      storageUsageBytes: storageEstimate?.usage ?? null,
      storageQuotaBytes: storageEstimate?.quota ?? null,
      refreshedAt: new Date().toISOString(),
    });
  }, []);

  const clearStaleFlags = useCallback(async () => {
    if (cacheStatus.stalePrefixes.length === 0) {
      setCacheStatusText("No stale cache prefixes are currently marked");
      return;
    }

    clearEntityCachesStale(cacheStatus.stalePrefixes);
    setCacheStatusText(`Cleared ${cacheStatus.stalePrefixes.length} stale cache prefix marker(s)`);
    await loadCacheStatus();
  }, [cacheStatus.stalePrefixes, loadCacheStatus]);

  const clearAllCaches = useCallback(async () => {
    setCacheBusy(true);
    try {
      const [entityRecordCount, snapshotCount] = await Promise.all([
        clearAllEntityCacheRecords(),
        clearAllEntitySnapshots(),
      ]);
      setCacheStatusText(
        `Cleared ${entityRecordCount} entity record(s) and ${snapshotCount} snapshot record(s) from local cache storage`,
      );
      await loadCacheStatus();
    } catch (error) {
      setCacheStatusText(error instanceof Error ? error.message : "Cache clear failed");
    } finally {
      setCacheBusy(false);
    }
  }, [loadCacheStatus]);

  useEffect(() => {
    loadCacheStatus().catch(() => undefined);
  }, [loadCacheStatus]);

  useEffect(() => {
    const onInvalidation = () => {
      loadCacheStatus().catch(() => undefined);
    };

    window.addEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    return () => {
      window.removeEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    };
  }, [loadCacheStatus]);

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
        <p className="label">Cache status</p>
        <p className="console-copy">
          entity scopes: {cacheStatus.entityScopes.length} | records: {cacheStatus.entityRecordCount}
        </p>
        <p className="console-copy">
          snapshots: {cacheStatus.snapshotCount} | stale prefixes: {cacheStatus.stalePrefixes.length}
        </p>
        <p className="console-copy">
          storage estimate: {formatBytes(cacheStatus.storageUsageBytes)} / {formatBytes(cacheStatus.storageQuotaBytes)}
        </p>
        {cacheStatus.stalePrefixes.length > 0 ? (
          <p className="console-copy">stale: {cacheStatus.stalePrefixes.join(", ")}</p>
        ) : null}
        {cacheStatus.entityScopes.length > 0 ? (
          <p className="console-copy">scopes: {cacheStatus.entityScopes.slice(0, 4).join(", ")}</p>
        ) : null}
        {cacheStatus.refreshedAt ? (
          <p className="console-copy">cache refreshed: {new Date(cacheStatus.refreshedAt).toLocaleString()}</p>
        ) : null}
        <div className="button-row">
          <button className="button" type="button" onClick={() => loadCacheStatus()}>
            Refresh Cache Status
          </button>
          <button className="button" type="button" onClick={() => clearStaleFlags()} disabled={cacheBusy}>
            Clear Stale Flags
          </button>
          <button className="button" type="button" onClick={() => clearAllCaches()} disabled={cacheBusy}>
            {cacheBusy ? "Clearing..." : "Clear Local Caches"}
          </button>
        </div>
        <p className="console-copy">{cacheStatusText}</p>
      </div>
    </div>
  );
}
