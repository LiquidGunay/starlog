const SNAPSHOT_PREFIX = "starlog-web-snapshot-v2:";
const SNAPSHOT_DB_NAME = "starlog-web-cache";
const SNAPSHOT_DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const CACHE_INVALIDATION_KEY = "starlog-web-cache-invalidation-v1";
const DEFAULT_SNAPSHOT_MAX_RECORDS = 60;
const DEFAULT_SNAPSHOT_MAX_AGE_DAYS = 21;
const SNAPSHOT_RETENTION_SWEEP_INTERVAL_MS = 30_000;

const SNAPSHOT_RETENTION_POLICIES: Array<{
  prefix: string;
  max_records: number;
  max_age_days: number;
}> = [
  { prefix: "artifacts.graph:", max_records: 80, max_age_days: 30 },
  { prefix: "artifacts.versions:", max_records: 80, max_age_days: 30 },
  { prefix: "artifacts.", max_records: 160, max_age_days: 30 },
  { prefix: "notes.", max_records: 120, max_age_days: 21 },
  { prefix: "tasks.", max_records: 120, max_age_days: 21 },
  { prefix: "calendar.", max_records: 140, max_age_days: 21 },
  { prefix: "planner.", max_records: 120, max_age_days: 21 },
  { prefix: "assistant.", max_records: 80, max_age_days: 14 },
  { prefix: "sync.", max_records: 80, max_age_days: 14 },
  { prefix: "search.", max_records: 40, max_age_days: 14 },
  { prefix: "integrations.", max_records: 60, max_age_days: 21 },
];

export const ENTITY_CACHE_INVALIDATION_EVENT = "starlog:cache-invalidation";

type SnapshotRecord = {
  key: string;
  value: unknown;
  updated_at: string;
};

type CacheInvalidationRecord = {
  prefix: string;
  recorded_at: string;
  reason: string;
};

type CacheInvalidationMap = Record<string, CacheInvalidationRecord>;

type EntitySnapshotWriteOptions = {
  persistBootstrap?: boolean;
};

type CacheInvalidationEventDetail = {
  action: "mark" | "clear";
  prefixes: string[];
  reason?: string;
  recorded_at: string;
};

export type EntitySnapshotStoragePressure = "unknown" | "normal" | "elevated" | "critical";

export type EntitySnapshotRetentionSweepResult = {
  policies_checked: number;
  pruned_records: number;
  storage_pressure: EntitySnapshotStoragePressure;
};

let snapshotDbPromise: Promise<IDBDatabase | null> | null = null;
const snapshotSweepAtByPolicy = new Map<string, number>();

function snapshotStorageKey(key: string): string {
  return `${SNAPSHOT_PREFIX}${key}`;
}

function dispatchInvalidationEvent(detail: CacheInvalidationEventDetail): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<CacheInvalidationEventDetail>(ENTITY_CACHE_INVALIDATION_EVENT, { detail }));
}

function openSnapshotDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  if (snapshotDbPromise) {
    return snapshotDbPromise;
  }

  snapshotDbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(SNAPSHOT_DB_NAME, SNAPSHOT_DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
          database.createObjectStore(SNAPSHOT_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          snapshotDbPromise = null;
        };
        resolve(database);
      };

      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return snapshotDbPromise;
}

function withSnapshotStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T | null> {
  return openSnapshotDb().then((database) => {
    if (!database) {
      return null;
    }

    try {
      const transaction = database.transaction(SNAPSHOT_STORE, mode);
      return run(transaction.objectStore(SNAPSHOT_STORE)).catch(() => null);
    } catch {
      return null;
    }
  });
}

function pressureMultiplier(pressure: EntitySnapshotStoragePressure): number {
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

function shouldSweepPolicy(policyKey: string): boolean {
  const previous = snapshotSweepAtByPolicy.get(policyKey) ?? 0;
  return nowMs() - previous >= SNAPSHOT_RETENTION_SWEEP_INTERVAL_MS;
}

function markPolicySweep(policyKey: string): void {
  snapshotSweepAtByPolicy.set(policyKey, nowMs());
}

function matchingPolicyPrefix(key: string): string {
  let chosen = "";
  for (const policy of SNAPSHOT_RETENTION_POLICIES) {
    if (!key.startsWith(policy.prefix)) {
      continue;
    }
    if (policy.prefix.length > chosen.length) {
      chosen = policy.prefix;
    }
  }
  return chosen;
}

function policyKeyForSnapshot(key: string): string {
  const matched = matchingPolicyPrefix(key);
  return matched || "default";
}

function policyForKey(key: string): { policy_key: string; max_records: number; max_age_days: number } {
  const matched = matchingPolicyPrefix(key);
  if (!matched) {
    return {
      policy_key: "default",
      max_records: DEFAULT_SNAPSHOT_MAX_RECORDS,
      max_age_days: DEFAULT_SNAPSHOT_MAX_AGE_DAYS,
    };
  }

  const policy = SNAPSHOT_RETENTION_POLICIES.find((item) => item.prefix === matched);
  if (!policy) {
    return {
      policy_key: "default",
      max_records: DEFAULT_SNAPSHOT_MAX_RECORDS,
      max_age_days: DEFAULT_SNAPSHOT_MAX_AGE_DAYS,
    };
  }

  return {
    policy_key: policy.prefix,
    max_records: policy.max_records,
    max_age_days: policy.max_age_days,
  };
}

async function detectSnapshotStoragePressure(): Promise<EntitySnapshotStoragePressure> {
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

function readBootstrapRaw(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(snapshotStorageKey(key));
  } catch {
    return null;
  }
}

function readBootstrapValue<T>(key: string, fallback: T): T {
  const raw = readBootstrapRaw(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeBootstrapValue(key: string, value: unknown): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(snapshotStorageKey(key), JSON.stringify(value));
  } catch {
    // Best-effort bootstrap cache only.
  }
}

function removeBootstrapValue(key: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(snapshotStorageKey(key));
  } catch {
    // Best-effort bootstrap cache only.
  }
}

async function persistSnapshotRecord(key: string, value: unknown): Promise<void> {
  await withSnapshotStore("readwrite", async (store) => {
    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        key,
        value,
        updated_at: new Date().toISOString(),
      } satisfies SnapshotRecord);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });

  void runSnapshotRetentionForKey(key);
}

function readInvalidationMap(): CacheInvalidationMap {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(CACHE_INVALIDATION_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as CacheInvalidationMap;
  } catch {
    return {};
  }
}

function writeInvalidationMap(value: CacheInvalidationMap): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CACHE_INVALIDATION_KEY, JSON.stringify(value));
  } catch {
    // Best-effort status only.
  }
}

function removeBootstrapSnapshotKey(snapshotKey: string): void {
  removeBootstrapValue(snapshotKey);
}

async function pruneSnapshotPolicy(
  policyKey: string,
  pressure: EntitySnapshotStoragePressure,
): Promise<number> {
  const policySeed = policyKey === "default" ? policyForKey("") : policyForKey(policyKey);
  const effectiveMax = Math.max(10, Math.floor(policySeed.max_records * pressureMultiplier(pressure)));
  const cutoffMs = nowMs() - policySeed.max_age_days * 24 * 60 * 60 * 1000;

  const result = await withSnapshotStore("readwrite", async (store) => {
    const candidates = await new Promise<Array<{ key: string; updated_at: string }>>((resolve, reject) => {
      const values: Array<{ key: string; updated_at: string }> = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(values);
          return;
        }
        const record = cursor.value as SnapshotRecord;
        const recordPolicy = policyKeyForSnapshot(record.key);
        if (recordPolicy === policyKey) {
          values.push({ key: record.key, updated_at: record.updated_at });
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

    if (candidates.length === 0) {
      return { deleted: 0, deleted_keys: [] as string[] };
    }

    candidates.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    const staleKeys = candidates
      .filter((record, index) => {
        if (index >= effectiveMax) {
          return true;
        }
        const stamp = Date.parse(record.updated_at);
        return Number.isFinite(stamp) && stamp < cutoffMs;
      })
      .map((record) => record.key);

    for (const key of staleKeys) {
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    return { deleted: staleKeys.length, deleted_keys: staleKeys };
  });

  const deleted = result?.deleted ?? 0;
  for (const key of result?.deleted_keys ?? []) {
    removeBootstrapSnapshotKey(key);
  }
  return deleted;
}

async function runSnapshotRetentionForKey(key: string): Promise<void> {
  const policyKey = policyKeyForSnapshot(key);
  if (!shouldSweepPolicy(policyKey)) {
    return;
  }
  markPolicySweep(policyKey);
  const pressure = await detectSnapshotStoragePressure();
  await pruneSnapshotPolicy(policyKey, pressure);
}

export function cachePrefixesIntersect(prefixes: string[], targets: string[]): boolean {
  return prefixes.some((prefix) =>
    targets.some((target) => prefix.startsWith(target) || target.startsWith(prefix)),
  );
}

export function readEntitySnapshot<T>(key: string, fallback: T): T {
  return readBootstrapValue(key, fallback);
}

export async function readEntitySnapshotAsync<T>(key: string, fallback: T): Promise<T> {
  const record = await withSnapshotStore("readonly", async (store) => {
    return new Promise<SnapshotRecord | null>((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as SnapshotRecord | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  });

  if (record?.value !== undefined) {
    return record.value as T;
  }

  const raw = readBootstrapRaw(key);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as T;
    void persistSnapshotRecord(key, parsed);
    return parsed;
  } catch {
    return fallback;
  }
}

export async function listEntitySnapshotsByPrefix<T>(prefix: string): Promise<T[]> {
  const records = await withSnapshotStore("readonly", async (store) => {
    return new Promise<SnapshotRecord[]>((resolve, reject) => {
      const values: SnapshotRecord[] = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(values);
          return;
        }

        const record = cursor.value as SnapshotRecord;
        if (record.key.startsWith(prefix)) {
          values.push(record);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  });

  if (records && records.length > 0) {
    return records.map((record) => record.value as T);
  }

  if (typeof window === "undefined") {
    return [];
  }

  const values: T[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index);
    if (!storageKey || !storageKey.startsWith(SNAPSHOT_PREFIX)) {
      continue;
    }

    const key = storageKey.slice(SNAPSHOT_PREFIX.length);
    if (!key.startsWith(prefix)) {
      continue;
    }

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        continue;
      }
      values.push(JSON.parse(raw) as T);
    } catch {
      // Best-effort fallback only.
    }
  }

  return values;
}

export function writeEntitySnapshot(
  key: string,
  value: unknown,
  options?: EntitySnapshotWriteOptions,
): void {
  if (options?.persistBootstrap === false) {
    removeBootstrapValue(key);
  } else {
    writeBootstrapValue(key, value);
  }

  void persistSnapshotRecord(key, value);
}

export function markEntityCachesStale(prefixes: string[], reason: string): void {
  if (typeof window === "undefined" || prefixes.length === 0) {
    return;
  }

  const current = readInvalidationMap();
  const recordedAt = new Date().toISOString();
  for (const prefix of prefixes) {
    current[prefix] = {
      prefix,
      recorded_at: recordedAt,
      reason,
    };
  }
  writeInvalidationMap(current);
  dispatchInvalidationEvent({
    action: "mark",
    prefixes,
    reason,
    recorded_at: recordedAt,
  });
}

export function clearEntityCachesStale(prefixes: string[]): void {
  if (typeof window === "undefined" || prefixes.length === 0) {
    return;
  }

  const current = readInvalidationMap();
  let changed = false;
  for (const prefix of prefixes) {
    if (!current[prefix]) {
      continue;
    }
    delete current[prefix];
    changed = true;
  }

  if (!changed) {
    return;
  }

  writeInvalidationMap(current);
  dispatchInvalidationEvent({
    action: "clear",
    prefixes,
    recorded_at: new Date().toISOString(),
  });
}

export function hasStaleEntityCache(prefixes: string[]): boolean {
  const invalidationMap = readInvalidationMap();
  return prefixes.some((prefix) => Boolean(invalidationMap[prefix]));
}

export function listEntitySnapshotRetentionPolicies(): Array<{
  prefix: string;
  max_records: number;
  max_age_days: number;
}> {
  return [
    ...SNAPSHOT_RETENTION_POLICIES,
    {
      prefix: "default",
      max_records: DEFAULT_SNAPSHOT_MAX_RECORDS,
      max_age_days: DEFAULT_SNAPSHOT_MAX_AGE_DAYS,
    },
  ];
}

export async function runEntitySnapshotRetentionSweep(): Promise<EntitySnapshotRetentionSweepResult> {
  const pressure = await detectSnapshotStoragePressure();
  const policyKeys = [
    ...SNAPSHOT_RETENTION_POLICIES.map((policy) => policy.prefix),
    "default",
  ];

  let pruned = 0;
  for (const policyKey of policyKeys) {
    // Sequential by design to avoid overlapping readwrite transactions.
    // eslint-disable-next-line no-await-in-loop
    pruned += await pruneSnapshotPolicy(policyKey, pressure);
    markPolicySweep(policyKey);
  }

  return {
    policies_checked: policyKeys.length,
    pruned_records: pruned,
    storage_pressure: pressure,
  };
}
