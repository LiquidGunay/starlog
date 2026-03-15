const ENTITY_CACHE_DB_NAME = "starlog-web-entity-cache";
const ENTITY_CACHE_DB_VERSION = 1;
const ENTITY_STORE = "entities";
const ENTITY_SCOPE_INDEX = "by_scope";
const DEFAULT_SCOPE_RECORD_LIMIT = 250;
const MIN_SCOPE_RECORD_LIMIT = 25;
const RETENTION_SWEEP_INTERVAL_MS = 30_000;

const ENTITY_SCOPE_LIMIT_POLICIES: Array<{ prefix: string; max_records: number }> = [
  { prefix: "artifacts.graph", max_records: 120 },
  { prefix: "artifacts.versions", max_records: 120 },
  { prefix: "artifacts.items", max_records: 600 },
  { prefix: "notes.", max_records: 500 },
  { prefix: "tasks.", max_records: 500 },
  { prefix: "calendar.", max_records: 700 },
  { prefix: "planner.", max_records: 500 },
  { prefix: "assistant.", max_records: 220 },
  { prefix: "sync.", max_records: 220 },
  { prefix: "integrations.", max_records: 160 },
];

export type EntityCacheEntryInput<T> = {
  id: string;
  value: T;
  updated_at: string;
  search_text?: string;
};

export type EntityCacheRecord<T> = {
  scope: string;
  entity_id: string;
  value: T;
  updated_at: string;
  cached_at: string;
  search_text: string;
};

export type EntityCacheScopeSummary = {
  scope: string;
  records: number;
  newest_updated_at: string | null;
  newest_cached_at: string | null;
};

type StoredEntityRecord = EntityCacheRecord<unknown> & {
  cache_key: string;
};

export type EntityCacheStoragePressure = "unknown" | "normal" | "elevated" | "critical";

export type EntityCacheRetentionSweepResult = {
  scopes_checked: number;
  pruned_records: number;
  storage_pressure: EntityCacheStoragePressure;
};

let entityCacheDbPromise: Promise<IDBDatabase | null> | null = null;
const retentionSweepAtByScope = new Map<string, number>();

function cacheKey(scope: string, id: string): string {
  return `${scope}:${id}`;
}

function openEntityCacheDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  if (entityCacheDbPromise) {
    return entityCacheDbPromise;
  }

  entityCacheDbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(ENTITY_CACHE_DB_NAME, ENTITY_CACHE_DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        let store: IDBObjectStore;
        if (!database.objectStoreNames.contains(ENTITY_STORE)) {
          store = database.createObjectStore(ENTITY_STORE, { keyPath: "cache_key" });
        } else {
          const transaction = request.transaction;
          if (!transaction) {
            return;
          }
          store = transaction.objectStore(ENTITY_STORE);
        }

        if (!store.indexNames.contains(ENTITY_SCOPE_INDEX)) {
          store.createIndex(ENTITY_SCOPE_INDEX, "scope", { unique: false });
        }
      };

      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          entityCacheDbPromise = null;
        };
        resolve(database);
      };

      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return entityCacheDbPromise;
}

function withEntityStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T | null> {
  return openEntityCacheDb().then((database) => {
    if (!database) {
      return null;
    }

    try {
      const transaction = database.transaction(ENTITY_STORE, mode);
      return run(transaction.objectStore(ENTITY_STORE)).catch(() => null);
    } catch {
      return null;
    }
  });
}

function requestToPromise(request: IDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function sortByRecency(records: Array<{ updated_at: string; cached_at: string }>): void {
  records.sort((left, right) => {
    if (left.updated_at !== right.updated_at) {
      return right.updated_at.localeCompare(left.updated_at);
    }
    return right.cached_at.localeCompare(left.cached_at);
  });
}

function pressureMultiplier(pressure: EntityCacheStoragePressure): number {
  if (pressure === "critical") {
    return 0.6;
  }
  if (pressure === "elevated") {
    return 0.8;
  }
  return 1;
}

function nowMs(): number {
  return Date.now();
}

function shouldRunScopeSweep(scope: string): boolean {
  const previous = retentionSweepAtByScope.get(scope) ?? 0;
  return nowMs() - previous >= RETENTION_SWEEP_INTERVAL_MS;
}

function markScopeSweep(scope: string): void {
  retentionSweepAtByScope.set(scope, nowMs());
}

function resolveBaseScopeLimit(scope: string): number {
  let chosen = DEFAULT_SCOPE_RECORD_LIMIT;
  let chosenLength = -1;
  for (const policy of ENTITY_SCOPE_LIMIT_POLICIES) {
    if (!scope.startsWith(policy.prefix)) {
      continue;
    }
    if (policy.prefix.length > chosenLength) {
      chosen = policy.max_records;
      chosenLength = policy.prefix.length;
    }
  }
  return chosen;
}

function resolveEffectiveScopeLimit(scope: string, pressure: EntityCacheStoragePressure): number {
  const base = resolveBaseScopeLimit(scope);
  const scaled = Math.floor(base * pressureMultiplier(pressure));
  return Math.max(MIN_SCOPE_RECORD_LIMIT, scaled);
}

async function detectEntityCacheStoragePressure(): Promise<EntityCacheStoragePressure> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return "unknown";
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;
    if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) {
      return "unknown";
    }
    const ratio = usage / quota;
    if (ratio >= 0.9) {
      return "critical";
    }
    if (ratio >= 0.75) {
      return "elevated";
    }
    return "normal";
  } catch {
    return "unknown";
  }
}

async function pruneScopeToRetentionLimit(
  scope: string,
  pressure: EntityCacheStoragePressure,
): Promise<number> {
  const limit = resolveEffectiveScopeLimit(scope, pressure);

  const deletedCount = await withEntityStore("readwrite", async (store) => {
    const index = store.index(ENTITY_SCOPE_INDEX);
    const records = await new Promise<Array<{ cache_key: IDBValidKey; updated_at: string; cached_at: string }>>(
      (resolve, reject) => {
        const values: Array<{ cache_key: IDBValidKey; updated_at: string; cached_at: string }> = [];
        const request = index.openCursor(IDBKeyRange.only(scope));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(values);
            return;
          }
          const record = cursor.value as StoredEntityRecord;
          values.push({
            cache_key: cursor.primaryKey,
            updated_at: record.updated_at,
            cached_at: record.cached_at,
          });
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      },
    );

    if (records.length <= limit) {
      return 0;
    }

    sortByRecency(records);
    const stale = records.slice(limit);
    for (const record of stale) {
      await requestToPromise(store.delete(record.cache_key));
    }
    return stale.length;
  });

  return deletedCount ?? 0;
}

async function runScopeRetentionIfNeeded(scope: string): Promise<void> {
  if (!shouldRunScopeSweep(scope)) {
    return;
  }
  markScopeSweep(scope);
  const pressure = await detectEntityCacheStoragePressure();
  await pruneScopeToRetentionLimit(scope, pressure);
}

async function listCachedScopes(): Promise<string[]> {
  const scopes = await withEntityStore("readonly", async (store) => {
    return new Promise<string[]>((resolve, reject) => {
      const values = new Set<string>();
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve([...values].sort((left, right) => left.localeCompare(right)));
          return;
        }
        const record = cursor.value as StoredEntityRecord;
        values.add(record.scope);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  });

  return scopes ?? [];
}

function normalizeRecord<T>(scope: string, entry: EntityCacheEntryInput<T>): StoredEntityRecord {
  return {
    cache_key: cacheKey(scope, entry.id),
    scope,
    entity_id: entry.id,
    value: entry.value,
    updated_at: entry.updated_at,
    cached_at: new Date().toISOString(),
    search_text: entry.search_text ?? "",
  };
}

async function putRecords(scope: string, entries: EntityCacheEntryInput<unknown>[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  await withEntityStore("readwrite", async (store) => {
    for (const entry of entries) {
      await requestToPromise(store.put(normalizeRecord(scope, entry)));
    }
  });

  void runScopeRetentionIfNeeded(scope);
}

export async function replaceEntityCacheScope<T>(
  scope: string,
  entries: EntityCacheEntryInput<T>[],
): Promise<void> {
  await withEntityStore("readwrite", async (store) => {
    const index = store.index(ENTITY_SCOPE_INDEX);
    const nextKeys = new Set(entries.map((entry) => cacheKey(scope, entry.id)));
    const staleKeys = await new Promise<string[]>((resolve, reject) => {
      const keys: string[] = [];
      const request = index.openCursor(IDBKeyRange.only(scope));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(keys);
          return;
        }

        const key = String(cursor.primaryKey);
        if (!nextKeys.has(key)) {
          keys.push(key);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

    for (const key of staleKeys) {
      await requestToPromise(store.delete(key));
    }

    for (const entry of entries) {
      await requestToPromise(store.put(normalizeRecord(scope, entry)));
    }
  });

  void runScopeRetentionIfNeeded(scope);
}

export async function mergeEntityCacheScope<T>(
  scope: string,
  entries: EntityCacheEntryInput<T>[],
): Promise<void> {
  await putRecords(scope, entries as EntityCacheEntryInput<unknown>[]);
}

export async function writeEntityCacheEntry<T>(
  scope: string,
  entry: EntityCacheEntryInput<T>,
): Promise<void> {
  await putRecords(scope, [entry] as EntityCacheEntryInput<unknown>[]);
}

export async function listEntityCacheRecords<T>(scope: string): Promise<EntityCacheRecord<T>[]> {
  const records = await withEntityStore("readonly", async (store) => {
    const index = store.index(ENTITY_SCOPE_INDEX);
    return new Promise<StoredEntityRecord[]>((resolve, reject) => {
      const items: StoredEntityRecord[] = [];
      const request = index.openCursor(IDBKeyRange.only(scope));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(items);
          return;
        }

        items.push(cursor.value as StoredEntityRecord);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  });

  return (records ?? [])
    .map((record) => ({
      scope: record.scope,
      entity_id: record.entity_id,
      value: record.value as T,
      updated_at: record.updated_at,
      cached_at: record.cached_at,
      search_text: record.search_text,
    }))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export async function readEntityCacheScope<T>(scope: string): Promise<T[]> {
  const records = await listEntityCacheRecords<T>(scope);
  return records.map((record) => record.value);
}

export async function readEntityCacheValue<T>(
  scope: string,
  entityId: string,
  fallback: T,
): Promise<T> {
  const record = await withEntityStore("readonly", async (store) => {
    return new Promise<StoredEntityRecord | null>((resolve, reject) => {
      const request = store.get(cacheKey(scope, entityId));
      request.onsuccess = () => resolve((request.result as StoredEntityRecord | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  });

  if (!record) {
    return fallback;
  }

  return record.value as T;
}

export function listEntityCacheRetentionPolicies(): Array<{ scope_prefix: string; max_records: number }> {
  return [
    ...ENTITY_SCOPE_LIMIT_POLICIES.map((policy) => ({
      scope_prefix: policy.prefix,
      max_records: policy.max_records,
    })),
    { scope_prefix: "default", max_records: DEFAULT_SCOPE_RECORD_LIMIT },
  ];
}

export async function runEntityCacheRetentionSweep(): Promise<EntityCacheRetentionSweepResult> {
  const pressure = await detectEntityCacheStoragePressure();
  const scopes = await listCachedScopes();
  let pruned = 0;

  for (const scope of scopes) {
    // Sequential by design to avoid multiple concurrent readwrite transactions.
    // eslint-disable-next-line no-await-in-loop
    pruned += await pruneScopeToRetentionLimit(scope, pressure);
    markScopeSweep(scope);
  }

  return {
    scopes_checked: scopes.length,
    pruned_records: pruned,
    storage_pressure: pressure,
  };
}
