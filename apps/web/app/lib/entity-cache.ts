const ENTITY_CACHE_DB_NAME = "starlog-web-entity-cache";
const ENTITY_CACHE_DB_VERSION = 1;
const ENTITY_STORE = "entities";
const ENTITY_SCOPE_INDEX = "by_scope";

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

let entityCacheDbPromise: Promise<IDBDatabase | null> | null = null;

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

export async function listEntityCacheScopeSummaries(): Promise<EntityCacheScopeSummary[]> {
  const records = await withEntityStore("readonly", async (store) => {
    return new Promise<StoredEntityRecord[]>((resolve, reject) => {
      const items: StoredEntityRecord[] = [];
      const request = store.openCursor();
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

  const summaries = new Map<string, EntityCacheScopeSummary>();
  for (const record of records ?? []) {
    const existing = summaries.get(record.scope);
    if (!existing) {
      summaries.set(record.scope, {
        scope: record.scope,
        records: 1,
        newest_updated_at: record.updated_at,
        newest_cached_at: record.cached_at,
      });
      continue;
    }

    existing.records += 1;
    if (record.updated_at > (existing.newest_updated_at ?? "")) {
      existing.newest_updated_at = record.updated_at;
    }
    if (record.cached_at > (existing.newest_cached_at ?? "")) {
      existing.newest_cached_at = record.cached_at;
    }
  }

  return [...summaries.values()].sort((left, right) => left.scope.localeCompare(right.scope));
}

export async function clearEntityCacheScopeRecords(scope: string): Promise<number> {
  const deleted = await withEntityStore("readwrite", async (store) => {
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const values: IDBValidKey[] = [];
      const request = store.index(ENTITY_SCOPE_INDEX).openCursor(IDBKeyRange.only(scope));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(values);
          return;
        }

        values.push(cursor.primaryKey);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

    for (const key of keys) {
      await requestToPromise(store.delete(key));
    }

    return keys.length;
  });

  return deleted ?? 0;
}

export async function clearAllEntityCacheRecords(): Promise<number> {
  const deleted = await withEntityStore("readwrite", async (store) => {
    const count = await new Promise<number>((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result ?? 0);
      request.onerror = () => reject(request.error);
    });
    await requestToPromise(store.clear());
    return count;
  });

  return deleted ?? 0;
}
