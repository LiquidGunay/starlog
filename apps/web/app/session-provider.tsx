"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { markEntityCachesStale } from "./lib/entity-snapshot";
import {
  appendReplayEntry,
  cachePrefixesForMutation,
  createActivityId,
  createQueuedMutation,
  createReplayEntry,
  getOrCreateClientId,
  loadOutbox,
  loadReplayLog,
  type QueuedMutation,
  type ReplayEntry,
  saveOutbox,
  saveReplayLog,
} from "./lib/mutation-outbox";
import { ApiError, apiRequest } from "./lib/starlog-client";

type MutationOptions = {
  label: string;
  entity: string;
  op: string;
};

type MutationResult<T> = {
  queued: boolean;
  data?: T;
};

type SessionConfig = {
  apiBase: string;
  token: string;
  clientId: string;
  isOnline: boolean;
  outbox: QueuedMutation[];
  replayLog: ReplayEntry[];
  flushSummary: string;
  flushInFlight: boolean;
  setApiBase: (apiBase: string) => void;
  setToken: (token: string) => void;
  mutateWithQueue: <T>(
    path: string,
    init: RequestInit | undefined,
    options: MutationOptions,
  ) => Promise<MutationResult<T>>;
  flushOutbox: () => Promise<void>;
  dropQueuedMutation: (mutationId: string) => void;
};

const SessionContext = createContext<SessionConfig | null>(null);
const LOCAL_API_BASE = "http://localhost:8000";
const PRODUCTION_API_BASE = "https://starlog-api-production.up.railway.app";

function inferDefaultApiBase(): string {
  if (typeof window === "undefined") {
    return LOCAL_API_BASE;
  }
  const host = window.location.hostname;
  if (host.endsWith("railway.app") || host.includes("starlog-web")) {
    return PRODUCTION_API_BASE;
  }
  return LOCAL_API_BASE;
}

type SyncActivityWrite = {
  id: string;
  mutation_id: string;
  label: string;
  entity: string;
  op: string;
  method: string;
  path: string;
  status: "queued" | "flushed" | "failed" | "dropped";
  attempts: number;
  detail?: string;
  created_at: string;
  recorded_at: string;
};

function bodyString(init?: RequestInit): string | undefined {
  if (!init?.body) {
    return undefined;
  }
  return typeof init.body === "string" ? init.body : undefined;
}

function toSyncActivity(
  mutation: QueuedMutation,
  status: SyncActivityWrite["status"],
  detail?: string,
): SyncActivityWrite {
  const attempts = mutation.attempts;
  return {
    id: createActivityId(mutation.id, status, attempts),
    mutation_id: mutation.id,
    label: mutation.label,
    entity: mutation.entity,
    op: mutation.op,
    method: mutation.method,
    path: mutation.path,
    status,
    attempts,
    detail,
    created_at: mutation.created_at,
    recorded_at: new Date().toISOString(),
  };
}

export function SessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [apiBase, setApiBaseState] = useState(LOCAL_API_BASE);
  const [token, setTokenState] = useState("");
  const [clientId, setClientId] = useState("web_local");
  const [isOnline, setIsOnline] = useState(true);
  const [outbox, setOutbox] = useState<QueuedMutation[]>([]);
  const [replayLog, setReplayLog] = useState<ReplayEntry[]>([]);
  const [flushSummary, setFlushSummary] = useState("Outbox idle");
  const [flushInFlight, setFlushInFlight] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const storedApi = window.localStorage.getItem("starlog-api-base");
    const storedToken = window.localStorage.getItem("starlog-token");
    if (storedApi) {
      setApiBaseState(storedApi);
    } else {
      setApiBaseState(inferDefaultApiBase());
    }
    if (storedToken) {
      setTokenState(storedToken);
    }

    setClientId(getOrCreateClientId());
    setOutbox(loadOutbox());
    setReplayLog(loadReplayLog());
    setIsOnline(window.navigator.onLine);
    setHydrated(true);

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    window.localStorage.setItem("starlog-api-base", apiBase);
    window.localStorage.setItem("starlog-token", token);
    saveOutbox(outbox);
    saveReplayLog(replayLog);
  }, [apiBase, hydrated, outbox, replayLog, token]);

  const setApiBase = (next: string) => {
    setApiBaseState(next);
  };

  const setToken = (next: string) => {
    setTokenState(next);
  };

  const reportSyncActivity = useCallback(
    async (entries: SyncActivityWrite[]) => {
      if (entries.length === 0 || !isOnline || !token) {
        return;
      }

      try {
        await apiRequest(apiBase, token, "/v1/sync/activity", {
          method: "POST",
          body: JSON.stringify({
            client_id: clientId,
            entries,
          }),
        });
      } catch {
        // Best-effort telemetry for cross-device sync visibility; never block user mutations.
      }
    },
    [apiBase, clientId, isOnline, token],
  );

  const queueMutation = useCallback((mutation: QueuedMutation, reason: string) => {
    const queued = {
      ...mutation,
      last_error: reason,
    };
    setOutbox((previous) => [queued, ...previous]);
    setReplayLog((previous) =>
      appendReplayEntry(previous, createReplayEntry(queued, "queued", reason)),
    );
    setFlushSummary(`Queued for replay: ${queued.label}`);
    void reportSyncActivity([toSyncActivity(queued, "queued", reason)]);
  }, [reportSyncActivity]);

  const mutateWithQueue = useCallback(
    async <T,>(path: string, init: RequestInit | undefined, options: MutationOptions): Promise<MutationResult<T>> => {
      const method = (init?.method ?? "POST").toUpperCase();
      const mutation = createQueuedMutation({
        label: options.label,
        path,
        method,
        body: bodyString(init),
        entity: options.entity,
        op: options.op,
      });

      if (!isOnline) {
        queueMutation(mutation, "Browser is offline");
        return { queued: true };
      }

      if (!token) {
        queueMutation(mutation, "Bearer token missing");
        return { queued: true };
      }

      try {
        const data = await apiRequest<T>(apiBase, token, path, init);
        const sentMutation = {
          ...mutation,
          attempts: 1,
          last_attempt_at: new Date().toISOString(),
        };
        setReplayLog((previous) =>
          appendReplayEntry(previous, createReplayEntry(sentMutation, "flushed")),
        );
        setFlushSummary(`Sent mutation: ${options.label}`);
        void reportSyncActivity([toSyncActivity(sentMutation, "flushed")]);
        markEntityCachesStale(cachePrefixesForMutation(sentMutation), `Mutation sent: ${options.label}`);
        return { queued: false, data };
      } catch (error) {
        if (error instanceof ApiError && error.status < 500) {
          throw error;
        }

        const reason = error instanceof Error ? error.message : "Mutation request failed";
        const queuedMutation = {
          ...mutation,
          attempts: 1,
          last_attempt_at: new Date().toISOString(),
          last_error: reason,
        };
        queueMutation(queuedMutation, reason);
        return { queued: true };
      }
    },
    [apiBase, isOnline, queueMutation, reportSyncActivity, token],
  );

  const flushOutbox = useCallback(async () => {
    if (flushInFlight) {
      return;
    }
    if (outbox.length === 0) {
      setFlushSummary("No queued mutations to replay");
      return;
    }
    if (!isOnline) {
      setFlushSummary("Reconnect to replay queued mutations");
      return;
    }
    if (!token) {
      setFlushSummary("Add bearer token to replay queued mutations");
      return;
    }

    setFlushInFlight(true);
    let flushed = 0;
    let remaining: QueuedMutation[] = [];
    let replayEntries: ReplayEntry[] = [];
    let activityEntries: SyncActivityWrite[] = [];
    const stalePrefixes = new Set<string>();

    for (const mutation of outbox) {
      const attempted = {
        ...mutation,
        attempts: mutation.attempts + 1,
        last_attempt_at: new Date().toISOString(),
      };

      try {
        await apiRequest<unknown>(apiBase, token, mutation.path, {
          method: mutation.method,
          body: mutation.body,
        });
        flushed += 1;
        for (const prefix of cachePrefixesForMutation(attempted)) {
          stalePrefixes.add(prefix);
        }
        replayEntries = [...replayEntries, createReplayEntry(attempted, "flushed")];
        activityEntries = [
          ...activityEntries,
          toSyncActivity(mutation, "queued", mutation.last_error),
          toSyncActivity(attempted, "flushed"),
        ];
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Replay failed";
        replayEntries = [...replayEntries, createReplayEntry(attempted, "failed", reason)];
        activityEntries = [
          ...activityEntries,
          toSyncActivity(mutation, "queued", mutation.last_error),
          toSyncActivity(attempted, "failed", reason),
        ];

        if (error instanceof ApiError && error.status < 500) {
          continue;
        }

        remaining = [
          ...remaining,
          {
            ...attempted,
            last_error: reason,
          },
        ];
      }
    }

    setOutbox(remaining);
    setReplayLog((previous) =>
      replayEntries.reduce(
        (entries, entry) => appendReplayEntry(entries, entry),
        previous,
      ),
    );
    setFlushSummary(
      remaining.length === 0
        ? `Replayed ${flushed} queued mutation(s)`
        : `Replayed ${flushed}; ${remaining.length} queued mutation(s) remain`,
    );
    setFlushInFlight(false);
    if (stalePrefixes.size > 0) {
      markEntityCachesStale(
        [...stalePrefixes],
        `Mutation replay completed: ${flushed} flushed`,
      );
    }
    void reportSyncActivity(activityEntries);
  }, [apiBase, flushInFlight, isOnline, outbox, reportSyncActivity, token]);

  const dropQueuedMutation = useCallback((mutationId: string) => {
    const mutation = outbox.find((item) => item.id === mutationId);
    setOutbox((previous) => previous.filter((mutation) => mutation.id !== mutationId));
    setFlushSummary(`Dropped queued mutation ${mutationId}`);
    if (mutation) {
      setReplayLog((previous) =>
        appendReplayEntry(previous, createReplayEntry(mutation, "dropped", mutation.last_error)),
      );
      void reportSyncActivity([
        toSyncActivity(mutation, "queued", mutation.last_error),
        toSyncActivity(mutation, "dropped", mutation.last_error),
      ]);
    }
  }, [outbox, reportSyncActivity]);

  useEffect(() => {
    if (!hydrated || !isOnline || !token || flushInFlight || outbox.length === 0) {
      return;
    }

    flushOutbox().catch((error) => {
      setFlushSummary(error instanceof Error ? error.message : "Outbox replay failed");
      setFlushInFlight(false);
    });
  }, [flushInFlight, flushOutbox, hydrated, isOnline, outbox.length, token]);

  const value = useMemo(
    () => ({
      apiBase,
      token,
      clientId,
      isOnline,
      outbox,
      replayLog,
      flushSummary,
      flushInFlight,
      setApiBase,
      setToken,
      mutateWithQueue,
      flushOutbox,
      dropQueuedMutation,
    }),
    [
      apiBase,
      clientId,
      dropQueuedMutation,
      flushInFlight,
      flushOutbox,
      flushSummary,
      isOnline,
      mutateWithQueue,
      outbox,
      replayLog,
      token,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionConfig(): SessionConfig {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionConfig must be used within SessionProvider");
  }
  return context;
}
