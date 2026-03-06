"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  appendReplayEntry,
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

function bodyString(init?: RequestInit): string | undefined {
  if (!init?.body) {
    return undefined;
  }
  return typeof init.body === "string" ? init.body : undefined;
}

export function SessionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [apiBase, setApiBaseState] = useState("http://localhost:8000");
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
  }, []);

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
    [apiBase, isOnline, queueMutation, token],
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
        replayEntries = [...replayEntries, createReplayEntry(attempted, "flushed")];
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Replay failed";
        replayEntries = [...replayEntries, createReplayEntry(attempted, "failed", reason)];

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
  }, [apiBase, flushInFlight, isOnline, outbox, token]);

  const dropQueuedMutation = useCallback((mutationId: string) => {
    setOutbox((previous) => previous.filter((mutation) => mutation.id !== mutationId));
    setFlushSummary(`Dropped queued mutation ${mutationId}`);
  }, []);

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
