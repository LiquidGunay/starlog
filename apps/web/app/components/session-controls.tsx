"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  clearAllEntityCacheRecords,
  clearEntityCacheScopeRecords,
  listEntityCacheScopeSummaries,
} from "../lib/entity-cache";
import {
  ENTITY_CACHE_INVALIDATION_EVENT,
  clearAllEntitySnapshots,
  clearEntityCachesStale,
  clearEntitySnapshotsByPrefix,
  listStaleEntityCaches,
  summarizeEntitySnapshotStorage,
} from "../lib/entity-snapshot";
import { useSessionConfig } from "../session-provider";

type CacheTelemetry = {
  entityScopes: string[];
  entityRecords: number;
  snapshotPrefixes: string[];
  snapshotRecords: number;
  stalePrefixes: string[];
  usageBytes: number | null;
  quotaBytes: number | null;
  refreshedAt: string | null;
};

function formatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function prefixFromKey(key: string): string {
  const base = key.split(":")[0] ?? key;
  const stem = base.split(".")[0] ?? base;
  if (!stem) {
    return key;
  }
  return `${stem}.`;
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

  const [cacheTelemetry, setCacheTelemetry] = useState<CacheTelemetry>({
    entityScopes: [],
    entityRecords: 0,
    snapshotPrefixes: [],
    snapshotRecords: 0,
    stalePrefixes: [],
    usageBytes: null,
    quotaBytes: null,
    refreshedAt: null,
  });
  const [selectedPrefix, setSelectedPrefix] = useState("");
  const [cacheStatus, setCacheStatus] = useState("Cache controls idle");
  const [cacheBusy, setCacheBusy] = useState(false);

  const loadCacheTelemetry = useCallback(async () => {
    const [scopeSummaries, snapshotSummary] = await Promise.all([
      listEntityCacheScopeSummaries(),
      summarizeEntitySnapshotStorage(),
    ]);
    const stalePrefixes = listStaleEntityCaches().map((entry) => entry.prefix);
    const storageEstimate =
      typeof navigator !== "undefined" && navigator.storage?.estimate
        ? await navigator.storage.estimate().catch(() => null)
        : null;

    const snapshotPrefixes = [...new Set(snapshotSummary.keys.map((key) => prefixFromKey(key)))].sort(
      (left, right) => left.localeCompare(right),
    );

    setCacheTelemetry({
      entityScopes: scopeSummaries.map((entry) => entry.scope),
      entityRecords: scopeSummaries.reduce((sum, entry) => sum + entry.records, 0),
      snapshotPrefixes,
      snapshotRecords: snapshotSummary.total_records,
      stalePrefixes,
      usageBytes: storageEstimate?.usage ?? null,
      quotaBytes: storageEstimate?.quota ?? null,
      refreshedAt: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    loadCacheTelemetry().catch(() => undefined);
  }, [loadCacheTelemetry]);

  useEffect(() => {
    const allPrefixes = [...cacheTelemetry.snapshotPrefixes, ...cacheTelemetry.stalePrefixes];
    const uniquePrefixes = [...new Set(allPrefixes)];
    if (selectedPrefix || uniquePrefixes.length === 0) {
      return;
    }
    setSelectedPrefix(uniquePrefixes[0]);
  }, [cacheTelemetry.snapshotPrefixes, cacheTelemetry.stalePrefixes, selectedPrefix]);

  useEffect(() => {
    const onInvalidation = () => {
      loadCacheTelemetry().catch(() => undefined);
    };

    window.addEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    return () => {
      window.removeEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    };
  }, [loadCacheTelemetry]);

  const usageRatio = useMemo(() => {
    if (!cacheTelemetry.usageBytes || !cacheTelemetry.quotaBytes || cacheTelemetry.quotaBytes <= 0) {
      return null;
    }
    return cacheTelemetry.usageBytes / cacheTelemetry.quotaBytes;
  }, [cacheTelemetry.quotaBytes, cacheTelemetry.usageBytes]);

  const quotaGuidance = useMemo(() => {
    if (usageRatio == null) {
      return "Storage pressure unknown (browser does not expose storage estimate)";
    }
    if (usageRatio >= 0.9) {
      return "Storage pressure critical: clear high-volume prefixes now to prevent cache write failures";
    }
    if (usageRatio >= 0.75) {
      return "Storage pressure elevated: consider clearing older prefixes to avoid quota pressure";
    }
    return "Storage pressure healthy";
  }, [usageRatio]);

  async function clearSelectedPrefix() {
    if (!selectedPrefix) {
      setCacheStatus("Select a cache prefix first");
      return;
    }

    setCacheBusy(true);
    try {
      const scopes = cacheTelemetry.entityScopes.filter((scope) => scope.startsWith(selectedPrefix));
      let entityDeleted = 0;
      for (const scope of scopes) {
        // Sequential by design to keep operation deterministic per scope.
        // eslint-disable-next-line no-await-in-loop
        entityDeleted += await clearEntityCacheScopeRecords(scope);
      }
      const snapshotDeleted = await clearEntitySnapshotsByPrefix(selectedPrefix);
      clearEntityCachesStale([selectedPrefix]);

      setCacheStatus(
        `Cleared prefix ${selectedPrefix}: ${entityDeleted} entity record(s), ${snapshotDeleted} snapshot record(s)`,
      );
      await loadCacheTelemetry();
    } catch (error) {
      setCacheStatus(error instanceof Error ? error.message : "Cache prefix clear failed");
    } finally {
      setCacheBusy(false);
    }
  }

  async function clearStaleOnly() {
    if (cacheTelemetry.stalePrefixes.length === 0) {
      setCacheStatus("No stale cache prefixes are marked");
      return;
    }

    clearEntityCachesStale(cacheTelemetry.stalePrefixes);
    setCacheStatus(`Cleared ${cacheTelemetry.stalePrefixes.length} stale cache marker(s)`);
    await loadCacheTelemetry();
  }

  async function clearAllCaches() {
    setCacheBusy(true);
    try {
      const [entityDeleted, snapshotDeleted] = await Promise.all([
        clearAllEntityCacheRecords(),
        clearAllEntitySnapshots(),
      ]);
      if (cacheTelemetry.stalePrefixes.length > 0) {
        clearEntityCachesStale(cacheTelemetry.stalePrefixes);
      }
      setCacheStatus(
        `Cleared all local caches: ${entityDeleted} entity record(s), ${snapshotDeleted} snapshot record(s)`,
      );
      await loadCacheTelemetry();
    } catch (error) {
      setCacheStatus(error instanceof Error ? error.message : "Failed to clear all caches");
    } finally {
      setCacheBusy(false);
    }
  }

  const prefixOptions = [...new Set([...cacheTelemetry.snapshotPrefixes, ...cacheTelemetry.stalePrefixes])]
    .sort((left, right) => left.localeCompare(right));

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
      <div>
        <p className="label">Cache policy</p>
        <p className="console-copy">
          entity: {cacheTelemetry.entityRecords} records across {cacheTelemetry.entityScopes.length} scopes
        </p>
        <p className="console-copy">
          snapshots: {cacheTelemetry.snapshotRecords} records across {cacheTelemetry.snapshotPrefixes.length} prefixes
        </p>
        <p className="console-copy">
          stale markers: {cacheTelemetry.stalePrefixes.length}
        </p>
        <p className="console-copy">
          storage: {formatBytes(cacheTelemetry.usageBytes)} / {formatBytes(cacheTelemetry.quotaBytes)}
        </p>
        <p className="console-copy">{quotaGuidance}</p>
        <label className="label" htmlFor="cache-prefix-target">Evict prefix</label>
        <select
          id="cache-prefix-target"
          className="input"
          value={selectedPrefix}
          onChange={(event) => setSelectedPrefix(event.target.value)}
        >
          {prefixOptions.length === 0 ? (
            <option value="">No prefixes cached</option>
          ) : null}
          {prefixOptions.map((prefix) => (
            <option key={prefix} value={prefix}>{prefix}</option>
          ))}
        </select>
        <div className="button-row">
          <button className="button" type="button" onClick={() => loadCacheTelemetry()}>
            Refresh Cache Status
          </button>
          <button
            className="button"
            type="button"
            onClick={() => clearSelectedPrefix()}
            disabled={cacheBusy || !selectedPrefix}
          >
            {cacheBusy ? "Working..." : "Clear Selected Prefix"}
          </button>
          <button
            className="button"
            type="button"
            onClick={() => clearStaleOnly()}
            disabled={cacheBusy || cacheTelemetry.stalePrefixes.length === 0}
          >
            Clear Stale Flags
          </button>
          <button
            className="button"
            type="button"
            onClick={() => clearAllCaches()}
            disabled={cacheBusy}
          >
            {cacheBusy ? "Working..." : "Clear All Local Caches"}
          </button>
        </div>
        {cacheTelemetry.refreshedAt ? (
          <p className="console-copy">cache refreshed: {new Date(cacheTelemetry.refreshedAt).toLocaleString()}</p>
        ) : null}
        <p className="console-copy">{cacheStatus}</p>
      </div>
    </div>
  );
}
