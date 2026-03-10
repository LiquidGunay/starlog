const SNAPSHOT_PREFIX = "starlog-web-snapshot-v2:";
const SNAPSHOT_DB_NAME = "starlog-web-cache";
const SNAPSHOT_DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const CACHE_INVALIDATION_KEY = "starlog-web-cache-invalidation-v1";

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

let snapshotDbPromise: Promise<IDBDatabase | null> | null = null;

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
