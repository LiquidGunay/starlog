export type QueuedMutation = {
  id: string;
  label: string;
  path: string;
  method: string;
  body?: string;
  entity: string;
  op: string;
  created_at: string;
  attempts: number;
  last_attempt_at?: string;
  last_error?: string;
};

export type ReplayEntry = {
  id: string;
  label: string;
  path: string;
  method: string;
  entity: string;
  op: string;
  status: "queued" | "flushed" | "failed" | "dropped";
  created_at: string;
  updated_at: string;
  attempts: number;
  last_error?: string;
};

const OUTBOX_KEY = "starlog-web-outbox-v1";
const REPLAY_LOG_KEY = "starlog-web-replay-log-v1";
const CLIENT_ID_KEY = "starlog-web-client-id";
const MAX_REPLAY_ENTRIES = 40;

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function createId(prefix: string): string {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateClientId(): string {
  if (typeof window === "undefined") {
    return "web_server";
  }

  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const next = createId("web");
  window.localStorage.setItem(CLIENT_ID_KEY, next);
  return next;
}

export function loadOutbox(): QueuedMutation[] {
  return readStorage<QueuedMutation[]>(OUTBOX_KEY, []);
}

export function saveOutbox(outbox: QueuedMutation[]): void {
  writeStorage(OUTBOX_KEY, outbox);
}

export function loadReplayLog(): ReplayEntry[] {
  return readStorage<ReplayEntry[]>(REPLAY_LOG_KEY, []);
}

export function saveReplayLog(entries: ReplayEntry[]): void {
  writeStorage(REPLAY_LOG_KEY, entries.slice(0, MAX_REPLAY_ENTRIES));
}

export function createQueuedMutation(input: {
  label: string;
  path: string;
  method: string;
  body?: string;
  entity: string;
  op: string;
  attempts?: number;
  last_error?: string;
}): QueuedMutation {
  const now = new Date().toISOString();
  return {
    id: createId("mut"),
    label: input.label,
    path: input.path,
    method: input.method.toUpperCase(),
    body: input.body,
    entity: input.entity,
    op: input.op,
    created_at: now,
    attempts: input.attempts ?? 0,
    last_attempt_at: input.attempts ? now : undefined,
    last_error: input.last_error,
  };
}

export function createReplayEntry(
  mutation: QueuedMutation,
  status: ReplayEntry["status"],
  lastError?: string,
): ReplayEntry {
  return {
    id: mutation.id,
    label: mutation.label,
    path: mutation.path,
    method: mutation.method,
    entity: mutation.entity,
    op: mutation.op,
    status,
    created_at: mutation.created_at,
    updated_at: new Date().toISOString(),
    attempts: mutation.attempts,
    last_error: lastError,
  };
}

export function createActivityId(
  mutationId: string,
  status: ReplayEntry["status"],
  attempts: number,
): string {
  return `act_${mutationId}_${status}_${attempts}`;
}

export function appendReplayEntry(entries: ReplayEntry[], entry: ReplayEntry): ReplayEntry[] {
  return [entry, ...entries].slice(0, MAX_REPLAY_ENTRIES);
}
