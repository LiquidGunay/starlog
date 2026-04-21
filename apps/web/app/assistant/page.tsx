"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import type {
  AssistantDeltaList,
  AssistantInterrupt,
  AssistantRun,
  AssistantThreadDelta,
  AssistantThreadMessage,
  AssistantThreadSnapshot,
} from "@starlog/contracts";

import { MainRoomThread } from "../components/main-room-thread";
import { ApiError, apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";
import { StarlogAssistantRuntimeProvider } from "./runtime/starlog-runtime-provider";
import styles from "./page.module.css";

function maxIso(left?: string | null, right?: string | null): string {
  if (!left) {
    return right || "";
  }
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

function previewFromMessage(message: AssistantThreadMessage): string | null {
  const text = message.parts
    .filter((part): part is Extract<AssistantThreadMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return text || null;
}

function sortMessages(messages: AssistantThreadMessage[]): AssistantThreadMessage[] {
  return [...messages].sort((left, right) =>
    left.created_at === right.created_at ? left.id.localeCompare(right.id) : left.created_at.localeCompare(right.created_at),
  );
}

function sortRuns(runs: AssistantRun[]): AssistantRun[] {
  return [...runs].sort((left, right) =>
    left.created_at === right.created_at ? right.id.localeCompare(left.id) : right.created_at.localeCompare(left.created_at),
  );
}

function sortInterrupts(interrupts: AssistantInterrupt[]): AssistantInterrupt[] {
  return [...interrupts].sort((left, right) =>
    left.created_at === right.created_at ? right.id.localeCompare(left.id) : right.created_at.localeCompare(left.created_at),
  );
}

function upsertById<T extends { id: string }>(
  items: T[],
  nextItem: T,
  sortItems: (items: T[]) => T[],
): T[] {
  const filtered = items.filter((item) => item.id !== nextItem.id);
  return sortItems([...filtered, nextItem]);
}

function withMessage(snapshot: AssistantThreadSnapshot, message: AssistantThreadMessage): AssistantThreadSnapshot {
  const messages = upsertById(snapshot.messages, message, sortMessages);
  const lastMessage = messages.at(-1) || null;
  return {
    ...snapshot,
    messages,
    last_message_at: lastMessage?.created_at || snapshot.last_message_at,
    last_preview_text: lastMessage ? previewFromMessage(lastMessage) : snapshot.last_preview_text,
    updated_at: maxIso(snapshot.updated_at, message.updated_at || message.created_at),
  };
}

function withRun(snapshot: AssistantThreadSnapshot, run: AssistantRun): AssistantThreadSnapshot {
  const runs = upsertById(snapshot.runs, run, sortRuns);
  const interrupts = run.current_interrupt
    ? upsertById(snapshot.interrupts, run.current_interrupt, sortInterrupts)
    : snapshot.interrupts;
  return {
    ...snapshot,
    runs,
    interrupts,
    updated_at: maxIso(snapshot.updated_at, run.updated_at),
  };
}

function withInterrupt(snapshot: AssistantThreadSnapshot, interrupt: AssistantInterrupt): AssistantThreadSnapshot {
  const interrupts = upsertById(snapshot.interrupts, interrupt, sortInterrupts);
  const runs = snapshot.runs.map((run) =>
    run.id === interrupt.run_id
      ? {
          ...run,
          current_interrupt: interrupt.status === "pending" ? interrupt : null,
        }
      : run,
  );
  return {
    ...snapshot,
    interrupts,
    runs,
    updated_at: maxIso(snapshot.updated_at, interrupt.resolved_at || interrupt.created_at),
  };
}

function applyAssistantDelta(
  snapshot: AssistantThreadSnapshot | null,
  delta: AssistantThreadDelta,
): AssistantThreadSnapshot | null {
  if (delta.event_type === "thread.snapshot") {
    return delta.payload as unknown as AssistantThreadSnapshot;
  }

  if (!snapshot) {
    return snapshot;
  }

  if (delta.event_type === "message.created" || delta.event_type === "message.updated") {
    return withMessage(snapshot, delta.payload as unknown as AssistantThreadMessage);
  }

  if (delta.event_type === "run.updated" || delta.event_type === "run.step.updated") {
    return withRun(snapshot, delta.payload as unknown as AssistantRun);
  }

  if (delta.event_type === "interrupt.opened" || delta.event_type === "interrupt.resolved") {
    return withInterrupt(snapshot, delta.payload as unknown as AssistantInterrupt);
  }

  if (delta.event_type === "surface_event.created") {
    return {
      ...snapshot,
      updated_at: maxIso(snapshot.updated_at, delta.created_at),
    };
  }

  return snapshot;
}

export default function AssistantPage() {
  const { apiBase, token, isOnline } = useSessionConfig();
  const clientTimezone =
    typeof Intl !== "undefined" ? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") : "UTC";
  const [snapshot, setSnapshot] = useState<AssistantThreadSnapshot | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async (options?: { silent?: boolean }) => {
    if (!token) {
      return;
    }

    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }

    try {
      const payload = await apiRequest<AssistantThreadSnapshot>(
        apiBase,
        token,
        "/v1/assistant/threads/primary",
      );
      startTransition(() => {
        setSnapshot(payload);
        setCursor(payload.next_cursor || null);
        setError(null);
      });
    } catch (err) {
      if (!silent) {
        setError(err instanceof ApiError ? err.body : "Failed to load the Assistant thread.");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [apiBase, token]);

  const loadUpdates = useCallback(async () => {
    if (!token || !snapshot) {
      return;
    }

    const path = cursor
      ? `/v1/assistant/threads/${snapshot.id}/updates?cursor=${encodeURIComponent(cursor)}`
      : `/v1/assistant/threads/${snapshot.id}/updates`;

    try {
      const payload = await apiRequest<AssistantDeltaList>(apiBase, token, path);
      startTransition(() => {
        setSnapshot((current) => payload.deltas.reduce<AssistantThreadSnapshot | null>(applyAssistantDelta, current));
        setCursor(payload.cursor || cursor);
      });
    } catch {
      // Keep the current snapshot and retry on the next interval/focus cycle.
    }
  }, [apiBase, cursor, snapshot, token]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!token || !snapshot) {
      return;
    }

    const refresh = () => {
      if (document.visibilityState === "hidden" || sending) {
        return;
      }
      if (!cursor) {
        void loadSnapshot({ silent: true });
        return;
      }
      void loadUpdates();
    };

    const intervalId = window.setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [cursor, loadSnapshot, loadUpdates, sending, snapshot, token]);

  async function sendMessage(content: string) {
    if (!snapshot || !content.trim() || sending) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const payload = await apiRequest<{ snapshot: AssistantThreadSnapshot }>(
        apiBase,
        token,
        `/v1/assistant/threads/${snapshot.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            content,
            input_mode: "text",
            device_target: "web-desktop",
            metadata: { surface: "assistant_web", client_timezone: clientTimezone },
          }),
        },
      );
      setSnapshot(payload.snapshot);
      setCursor(payload.snapshot.next_cursor || null);
      setComposer("");
    } catch (err) {
      setError(err instanceof ApiError ? err.body : "Failed to send the message.");
    } finally {
      setSending(false);
    }
  }

  async function submitInterrupt(interruptId: string, values: Record<string, unknown>) {
    if (!snapshot) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const payload = await apiRequest<AssistantThreadSnapshot>(
        apiBase,
        token,
        `/v1/assistant/interrupts/${interruptId}/submit`,
        {
          method: "POST",
          body: JSON.stringify({ values: { ...values, client_timezone: clientTimezone } }),
        },
      );
      setSnapshot(payload);
      setCursor(payload.next_cursor || null);
    } catch (err) {
      setError(err instanceof ApiError ? err.body : "Failed to submit the panel.");
    } finally {
      setSending(false);
    }
  }

  async function dismissInterrupt(interruptId: string) {
    if (!snapshot) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const payload = await apiRequest<AssistantThreadSnapshot>(
        apiBase,
        token,
        `/v1/assistant/interrupts/${interruptId}/dismiss`,
        {
          method: "POST",
        },
      );
      setSnapshot(payload);
      setCursor(payload.next_cursor || null);
    } catch (err) {
      setError(err instanceof ApiError ? err.body : "Failed to dismiss the panel.");
    } finally {
      setSending(false);
    }
  }

  const activeRun = snapshot?.runs.find((run) => run.status === "running" || run.status === "interrupted");
  const activeInterrupt = snapshot?.interrupts.find((interrupt) => interrupt.status === "pending");

  return (
    <StarlogAssistantRuntimeProvider
      messages={snapshot?.messages ?? []}
      isRunning={sending || activeRun?.status === "running"}
      onSendMessage={sendMessage}
    >
      <main className={styles.page}>
        <section className={styles.hero}>
          <div>
            <p className={styles.kicker}>Assistant Runtime</p>
            <h1>{snapshot?.title || "Assistant thread"}</h1>
            <p className={styles.lede}>
              Starlog is now centered on a server-owned assistant thread with runs, interrupts,
              ambient updates, and support-surface events.
            </p>
          </div>
          <div className={styles.heroMeta}>
            <span>{isOnline ? "Online" : "Offline"}</span>
            <span>{activeRun ? `Run: ${activeRun.status}` : "Idle"}</span>
            <span>{activeInterrupt ? `Panel: ${activeInterrupt.title}` : "No open panel"}</span>
          </div>
        </section>

        <section className={styles.layout}>
          <div className={styles.threadColumn}>
            <MainRoomThread
              snapshot={snapshot}
              loading={loading}
              busy={sending}
              onInterruptSubmit={submitInterrupt}
              onInterruptDismiss={dismissInterrupt}
            />
            <form
              className={styles.composer}
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(composer);
              }}
            >
              <textarea
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder="Capture, plan, review, or ask the Assistant to move something forward."
                rows={4}
                disabled={!snapshot || sending}
              />
              <div className={styles.composerBar}>
                <span>{error || (sending ? "Assistant is working..." : "The thread remains the control plane.")}</span>
                <button type="submit" disabled={!snapshot || sending || !composer.trim()}>
                  Send
                </button>
              </div>
            </form>
          </div>

          <aside className={styles.sideRail}>
            <article className={styles.sideCard}>
              <p className={styles.sideLabel}>Protocol</p>
              <h2>assistant-ui runtime boundary</h2>
              <p>
                This web surface uses the new `/v1/assistant/...` contract and an assistant-ui
                external-store runtime adapter instead of the old `content + cards + traces` page
                orchestration.
              </p>
            </article>

            <article className={styles.sideCard}>
              <p className={styles.sideLabel}>Open Work</p>
              <ul>
                <li>{activeRun ? `${activeRun.orchestrator} run is ${activeRun.status}` : "No active run"}</li>
                <li>{activeInterrupt ? activeInterrupt.title : "No pending interrupt"}</li>
                <li>{snapshot ? `${snapshot.messages.length} thread messages loaded` : "No thread snapshot yet"}</li>
              </ul>
            </article>
          </aside>
        </section>
      </main>
    </StarlogAssistantRuntimeProvider>
  );
}
