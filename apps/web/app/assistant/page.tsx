"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, startTransition, useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantCardAction,
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
import { summarizeSupportSurfaces } from "./support-surfaces";
import styles from "./page.module.css";

type AssistantStreamEnvelope = {
  event: string;
  data: string | null;
  id: string | null;
};

type LiveStatus = "connecting" | "live" | "recovering" | "auth_required";
type AssistantHandoff = {
  token: string;
  artifactId: string | null;
  source: string | null;
  draft: string;
};
type AssistantResolveHandoffResponse = {
  handoff: {
    artifact_id?: string | null;
    source?: string | null;
    draft: string;
  };
};

const STREAM_AUTH_ERROR = "Session expired. Sign in again to reconnect the Assistant feed.";

function hasApiStatus(error: unknown, status: number): error is { status: number; body?: string } {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: unknown }).status === status;
}

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

function normalizeSnapshot(snapshot: AssistantThreadSnapshot | null): AssistantThreadSnapshot | null {
  if (!snapshot) {
    return null;
  }

  const interruptsById = Object.fromEntries(snapshot.interrupts.map((interrupt) => [interrupt.id, interrupt]));
  const messages = snapshot.messages.map((message) => {
    let hasPendingInterrupt = false;
    const parts = message.parts.map((part) => {
      if (part.type !== "interrupt_request") {
        return part;
      }
      const liveInterrupt = interruptsById[part.interrupt.id] || part.interrupt;
      if (liveInterrupt.status === "pending") {
        hasPendingInterrupt = true;
      }
      return {
        ...part,
        interrupt: {
          ...part.interrupt,
          ...liveInterrupt,
        },
      };
    });

    return {
      ...message,
      status: message.status === "requires_action" && !hasPendingInterrupt ? "complete" : message.status,
      parts,
    };
  });

  return {
    ...snapshot,
    messages,
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

function liveStatusLabel(status: LiveStatus): string {
  if (status === "live") {
    return "Synced";
  }
  if (status === "recovering") {
    return "Reconnecting";
  }
  if (status === "auth_required") {
    return "Sign in needed";
  }
  return "Connecting";
}

function readGenericDraft(searchParams: ReturnType<typeof useSearchParams>): string {
  return searchParams.get("draft")?.trim() || "";
}

function readHandoffToken(searchParams: ReturnType<typeof useSearchParams>): string {
  return searchParams.get("handoff")?.trim() || "";
}

function mutationHeaders(payload: Record<string, unknown>): Record<string, string> | undefined {
  const rawHeaders = payload.headers;
  if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
    return undefined;
  }
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function mutationBody(payload: Record<string, unknown>): { body?: string; isJson: boolean } {
  if (!Object.prototype.hasOwnProperty.call(payload, "body")) {
    return { body: undefined, isJson: false };
  }
  const rawBody = payload.body;
  if (rawBody === undefined) {
    return { body: undefined, isJson: false };
  }
  if (typeof rawBody === "string") {
    return { body: rawBody, isJson: false };
  }
  return { body: JSON.stringify(rawBody), isJson: true };
}

function hasContentTypeHeader(headers?: Record<string, string>): boolean {
  if (!headers) {
    return false;
  }
  return Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
}

type RailItem = {
  label: string;
  href?: string;
};

function pendingInterruptLabel(interrupt: AssistantInterrupt): string {
  if (interrupt.tool_name === "request_due_date") {
    return "Task needs details";
  }
  if (interrupt.tool_name === "triage_capture") {
    return "Capture needs triage";
  }
  if (interrupt.tool_name === "resolve_planner_conflict") {
    return "Planner conflict";
  }
  if (interrupt.tool_name === "grade_review_recall") {
    return "Review grade pending";
  }
  if (interrupt.tool_name === "choose_morning_focus") {
    return "Morning focus choice";
  }
  return interrupt.title;
}

function cardRailLabel(kind: string): string | null {
  if (kind === "goal_status") {
    return "Goal";
  }
  if (kind === "project_status") {
    return "Project";
  }
  if (kind === "commitment_status") {
    return "Commitment";
  }
  if (kind === "task_list") {
    return "Planner update";
  }
  if (kind === "review_queue") {
    return "Review queue";
  }
  if (kind === "capture_item") {
    return "Library capture";
  }
  if (kind === "briefing") {
    return "Briefing ready";
  }
  if (kind === "knowledge_note") {
    return "Relevant note";
  }
  if (kind === "learning_drill") {
    return "Learning drill";
  }
  return null;
}

function collectRailCards(snapshot: AssistantThreadSnapshot | null): RailItem[] {
  if (!snapshot) {
    return [];
  }
  const items: RailItem[] = [];
  for (const card of snapshot.context_cards || []) {
    const label = cardRailLabel(card.kind);
    if (!label) {
      continue;
    }
    items.push({
      label: card.title ? `${label}: ${card.title}` : label,
      href: card.entity_ref?.href || undefined,
    });
    if (items.length >= 4) {
      return items;
    }
  }
  for (const message of [...snapshot.messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (part.type !== "card") {
        continue;
      }
      const label = cardRailLabel(part.card.kind);
      if (!label) {
        continue;
      }
      items.push({
        label: part.card.title ? `${label}: ${part.card.title}` : label,
        href: part.card.entity_ref?.href || undefined,
      });
      if (items.length >= 4) {
        return items;
      }
    }
  }
  return items;
}

function buildOpenLoops(snapshot: AssistantThreadSnapshot | null, handoff: AssistantHandoff | null): RailItem[] {
  const loops: RailItem[] = [];
  const pendingInterrupts = (snapshot?.interrupts || []).filter((interrupt) => interrupt.status === "pending");
  for (const interrupt of pendingInterrupts.slice(0, 4)) {
    loops.push({
      label: pendingInterruptLabel(interrupt),
      href: interrupt.entity_ref?.href || undefined,
    });
  }
  if (handoff?.artifactId) {
    loops.push({ label: "Helper capture ready", href: `/artifacts?artifact=${encodeURIComponent(handoff.artifactId)}` });
  }
  return loops.length > 0 ? loops : [{ label: "No open loops in this thread" }];
}

function buildSuggestions(snapshot: AssistantThreadSnapshot | null): RailItem[] {
  const pendingTools = new Set((snapshot?.interrupts || []).filter((interrupt) => interrupt.status === "pending").map((interrupt) => interrupt.tool_name));
  const suggestions: RailItem[] = [];
  if (pendingTools.has("triage_capture")) {
    suggestions.push({ label: "Process latest capture" });
  }
  if (pendingTools.has("request_due_date")) {
    suggestions.push({ label: "Finish task details" });
  }
  if (pendingTools.has("choose_morning_focus")) {
    suggestions.push({ label: "Pick a focus" });
  }
  suggestions.push({ label: "Plan today", href: "/planner" });
  suggestions.push({ label: "Start review", href: "/review" });
  return suggestions.slice(0, 4);
}

function RailSection({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: RailItem[];
  onNavigate: (href: string) => void;
}) {
  return (
    <section className={styles.railGroup}>
      <h3>{title}</h3>
      <ul className={styles.railList}>
        {items.map((item, index) => (
          <li key={`${title}-${item.label}-${index}`}>
            {item.href ? (
              <button type="button" onClick={() => onNavigate(item.href || "")}>
                {item.label}
              </button>
            ) : (
              <span>{item.label}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function parseStreamEnvelope(block: string): AssistantStreamEnvelope | null {
  const normalized = block.trim();
  if (!normalized || normalized.startsWith(":")) {
    return null;
  }

  let event = "message";
  let id: string | null = null;
  const dataLines: string[] = [];

  for (const line of normalized.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("id:")) {
      id = line.slice("id:".length).trim() || null;
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return {
    event,
    id,
    data: dataLines.length > 0 ? dataLines.join("\n") : null,
  };
}

async function consumeAssistantStream({
  apiBase,
  token,
  threadId,
  cursor,
  signal,
  onOpen,
  onDelta,
  onCursor,
}: {
  apiBase: string;
  token: string;
  threadId: string;
  cursor: string | null;
  signal: AbortSignal;
  onOpen?: () => void;
  onDelta: (delta: AssistantThreadDelta) => void;
  onCursor: (cursor: string) => void;
}) {
  const response = await fetch(`${apiBase}/v1/assistant/threads/${threadId}/stream`, {
    method: "GET",
    signal,
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
      ...(cursor ? { "Last-Event-ID": cursor } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(response.status, body);
  }

  if (!response.body) {
    throw new Error("Assistant stream did not return a readable body.");
  }

  onOpen?.();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += value.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const envelope = parseStreamEnvelope(block);
      if (envelope?.event === "cursor" && envelope.data) {
        const payload = JSON.parse(envelope.data) as { cursor?: string };
        if (payload.cursor) {
          onCursor(payload.cursor);
        }
      } else if (envelope?.data) {
        onDelta(JSON.parse(envelope.data) as AssistantThreadDelta);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function AssistantPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const genericDraft = readGenericDraft(searchParams);
  const handoffToken = readHandoffToken(searchParams);
  const { apiBase, token, isOnline, mutateWithQueue } = useSessionConfig();
  const clientTimezone =
    typeof Intl !== "undefined" ? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") : "UTC";
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const snapshotRef = useRef<AssistantThreadSnapshot | null>(null);
  const cursorRef = useRef<string | null>(null);
  const authBlockedRef = useRef(false);
  const appliedDraftRef = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<AssistantThreadSnapshot | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [handoff, setHandoff] = useState<AssistantHandoff | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  const applyAuthFailure = useCallback(() => {
    authBlockedRef.current = true;
    setLiveStatus("auth_required");
    setError(STREAM_AUTH_ERROR);
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    authBlockedRef.current = liveStatus === "auth_required";
  }, [liveStatus]);

  useEffect(() => {
    if (handoffToken) {
      return;
    }
    setHandoff(null);
  }, [handoffToken]);

  useEffect(() => {
    if (handoffToken || !genericDraft || appliedDraftRef.current === `draft:${genericDraft}`) {
      return;
    }
    appliedDraftRef.current = `draft:${genericDraft}`;
    setComposer((current) => current.trim() ? current : genericDraft);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }, [genericDraft, handoffToken]);

  useEffect(() => {
    if (!handoffToken) {
      return;
    }
    if (!token) {
      return;
    }

    let cancelled = false;

    const resolveHandoff = async () => {
      try {
        const payload = await apiRequest<AssistantResolveHandoffResponse>(
          apiBase,
          token,
          `/v1/assistant/handoffs/resolve?token=${encodeURIComponent(handoffToken)}`,
        );
        if (cancelled) {
          return;
        }
        const nextHandoff: AssistantHandoff = {
          token: handoffToken,
          artifactId: payload.handoff.artifact_id || null,
          source: payload.handoff.source || null,
          draft: payload.handoff.draft,
        };
        setHandoff(nextHandoff);
        setError(null);
        if (appliedDraftRef.current !== `handoff:${handoffToken}`) {
          appliedDraftRef.current = `handoff:${handoffToken}`;
          setComposer((current) => current.trim() ? current : nextHandoff.draft);
          window.requestAnimationFrame(() => {
            composerRef.current?.focus();
          });
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (hasApiStatus(err, 401)) {
          applyAuthFailure();
          return;
        }
        setHandoff(null);
        setError(err instanceof ApiError ? err.body : "The handoff could not be verified.");
      }
    };

    void resolveHandoff();
    return () => {
      cancelled = true;
    };
  }, [apiBase, applyAuthFailure, handoffToken, token]);

  const loadSnapshot = useCallback(async (options?: { silent?: boolean }) => {
    if (!token) {
      return null;
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
      authBlockedRef.current = false;
      startTransition(() => {
        setSnapshot(payload);
        setCursor(payload.next_cursor || null);
        setError(null);
        setLiveStatus((current) => (current === "auth_required" ? "connecting" : current));
      });
      return payload;
    } catch (err) {
      if (hasApiStatus(err, 401)) {
        applyAuthFailure();
        return null;
      }
      if (!silent) {
        setError(err instanceof ApiError ? err.body : "Failed to load the Assistant thread.");
      }
      return null;
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [apiBase, applyAuthFailure, token]);

  const loadUpdates = useCallback(async (threadId: string, nextCursor: string | null) => {
    if (!token) {
      return null;
    }

    const path = nextCursor
      ? `/v1/assistant/threads/${threadId}/updates?cursor=${encodeURIComponent(nextCursor)}`
      : `/v1/assistant/threads/${threadId}/updates`;

    try {
      return await apiRequest<AssistantDeltaList>(apiBase, token, path);
    } catch (err) {
      if (hasApiStatus(err, 401)) {
        applyAuthFailure();
      }
      return null;
    }
  }, [apiBase, applyAuthFailure, token]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const threadId = snapshot?.id;
    if (!token || !threadId) {
      return;
    }

    let reconnectTimer: number | null = null;
    let cancelled = false;
    const controller = new AbortController();

    const reconnect = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      reconnectTimer = window.setTimeout(() => {
        if (!cancelled) {
          void openStream();
        }
      }, 1200);
    };

    const recoverFromPolling = async () => {
      const payload = await loadUpdates(threadId, cursorRef.current);
      if (authBlockedRef.current) {
        return false;
      }
      if (payload) {
        startTransition(() => {
          setSnapshot((current) => payload.deltas.reduce<AssistantThreadSnapshot | null>(applyAssistantDelta, current));
          setCursor(payload.cursor || cursorRef.current);
        });
        return true;
      }
      await loadSnapshot({ silent: true });
      return !authBlockedRef.current;
    };

    const openStream = async () => {
      try {
        setLiveStatus((current) => (current === "live" ? current : "connecting"));
        await consumeAssistantStream({
          apiBase,
          token,
          threadId,
          cursor: cursorRef.current,
          signal: controller.signal,
          onOpen: () => setLiveStatus("live"),
          onDelta: (delta) => {
            startTransition(() => {
              setSnapshot((current) => applyAssistantDelta(current, delta));
            });
          },
          onCursor: (nextCursor) => {
            cursorRef.current = nextCursor;
            startTransition(() => {
              setCursor(nextCursor);
            });
          },
        });
      } catch (err) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        if (hasApiStatus(err, 401)) {
          applyAuthFailure();
          return;
        }
        setLiveStatus("recovering");
        if (await recoverFromPolling()) {
          reconnect();
        }
        return;
      }

      if (!controller.signal.aborted && !cancelled) {
        setLiveStatus("recovering");
        if (await recoverFromPolling()) {
          reconnect();
        }
      }
    };

    void openStream();

    const refreshOnFocus = () => {
      if (document.visibilityState === "visible" && !authBlockedRef.current) {
        void loadSnapshot({ silent: true });
      }
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      cancelled = true;
      controller.abort();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [apiBase, applyAuthFailure, loadSnapshot, loadUpdates, snapshot?.id, token]);

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
            metadata: {
              surface: "assistant_web",
              client_timezone: clientTimezone,
              ...(handoff
                ? {
                    handoff_token: handoff.token,
                  }
                : {}),
            },
          }),
        },
      );
      setSnapshot(payload.snapshot);
      setCursor(payload.snapshot.next_cursor || null);
      setComposer("");
      if (handoff) {
        setHandoff(null);
        appliedDraftRef.current = null;
        router.replace("/assistant");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.body : "Failed to send the message.");
    } finally {
      setSending(false);
    }
  }

  function handleQuickStart(prompt: string) {
    setComposer(prompt);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }

  async function handleCardAction(action: AssistantCardAction) {
    const payload = action.payload || {};
    if (action.requires_confirmation && typeof window !== "undefined") {
      const confirmed = window.confirm(`Run "${action.label}"?`);
      if (!confirmed) {
        return;
      }
    }

    if (action.kind === "navigate") {
      const href = typeof payload.href === "string" ? payload.href : null;
      if (href) {
        router.push(href);
      }
      return;
    }

    if (action.kind === "composer") {
      const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
      if (prompt) {
        setComposer(prompt);
        composerRef.current?.focus();
      }
      return;
    }

    if (action.kind === "interrupt") {
      setError("This action is handled by the active thread panel.");
      return;
    }

    if (action.kind !== "mutation") {
      return;
    }

    const endpoint = typeof payload.endpoint === "string" ? payload.endpoint : null;
    const method = typeof payload.method === "string" ? payload.method.toUpperCase() : "POST";
    const headers = mutationHeaders(payload);
    const { body, isJson } = mutationBody(payload);

    if (!endpoint) {
      setError(`Card action "${action.label}" is missing an endpoint.`);
      return;
    }

    setSending(true);
    setError(null);
    try {
      const requestHeaders = {
        ...(headers || {}),
        ...(isJson && !hasContentTypeHeader(headers) ? { "Content-Type": "application/json" } : {}),
        ...(!isJson && body !== undefined && !hasContentTypeHeader(headers) ? { "Content-Type": "text/plain;charset=UTF-8" } : {}),
      };
      const result = await mutateWithQueue(
        endpoint,
        {
          method,
          ...(Object.keys(requestHeaders).length > 0 ? { headers: requestHeaders } : {}),
          ...(body !== undefined ? { body } : {}),
        },
        {
          label: action.label,
          entity: "assistant_card",
          op: action.id,
        },
      );
      if (result.queued) {
        setError(`Queued "${action.label}" for replay.`);
      } else {
        await loadSnapshot({ silent: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.body : `Failed to run "${action.label}".`);
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
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const handoffSourceLabel = handoff?.source === "desktop_helper" ? "Desktop Helper" : "Support surface";
  const supportSurfaces = summarizeSupportSurfaces(normalizedSnapshot, handoff);
  const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(new Date());
  const openLoops = buildOpenLoops(normalizedSnapshot, handoff);
  const openLoopCount = (normalizedSnapshot?.interrupts || []).filter((interrupt) => interrupt.status === "pending").length + (handoff ? 1 : 0);
  const contextItems = [
    ...collectRailCards(normalizedSnapshot),
    ...supportSurfaces.filter((surface) => surface.active).map((surface) => ({ label: surface.title, href: surface.href })),
  ].slice(0, 4);
  const nowItems: RailItem[] = [
    activeInterrupt ? { label: activeInterrupt.title, href: activeInterrupt.entity_ref?.href || undefined } : { label: "Ready for the next move" },
    activeRun ? { label: `Assistant is ${activeRun.status}` } : { label: `${liveStatusLabel(liveStatus)} · ${isOnline ? "Online" : "Offline"}` },
  ];
  const suggestions = buildSuggestions(normalizedSnapshot);

  return (
    <StarlogAssistantRuntimeProvider
      messages={normalizedSnapshot?.messages ?? []}
      isRunning={sending || activeRun?.status === "running"}
      onSendMessage={sendMessage}
    >
      <main className={styles.page}>
        <section className={styles.hero}>
          <div>
            <p className={styles.kicker}>Today · {todayLabel}</p>
            <h1>Starlog Assistant</h1>
            <p className={styles.lede}>
              Move today forward with one thread for capture, planning, review, and follow-through.
            </p>
          </div>
          <div className={styles.heroMeta}>
            <span>{isOnline ? "Online" : "Offline"}</span>
            <span>{liveStatusLabel(liveStatus)}</span>
            <span>{openLoopCount} open loop{openLoopCount === 1 ? "" : "s"}</span>
            <span>{activeInterrupt ? activeInterrupt.title : "No pending action"}</span>
          </div>
        </section>

        <section className={styles.layout}>
          <div className={styles.threadColumn}>
            <MainRoomThread
              snapshot={normalizedSnapshot}
              loading={loading}
              busy={sending}
              todayOpenLoops={openLoops.filter((item) => item.label !== "No open loops in this thread")}
              todayContextItems={contextItems}
              onQuickStart={handleQuickStart}
              onCardAction={handleCardAction}
              onInterruptSubmit={submitInterrupt}
              onInterruptDismiss={dismissInterrupt}
            />
            {handoff ? (
              <section className={styles.handoffBanner}>
                <div>
                  <p className={styles.handoffKicker}>{handoffSourceLabel} handoff</p>
                  <h2>Continue from the latest capture</h2>
                  <p>
                    {handoff.artifactId
                      ? "A recent capture is attached to this draft. You can route it from here or open it in Library for deeper editing."
                      : "This draft came from another Starlog surface. Keep it in the thread or clear the handoff."}
                  </p>
                </div>
                <div className={styles.handoffActions}>
                  {handoff.artifactId ? (
                    <button type="button" onClick={() => router.push(`/artifacts?artifact=${encodeURIComponent(handoff.artifactId || "")}`)}>
                      Open in Library
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.handoffGhostButton}
                    onClick={() => {
                      setHandoff(null);
                      appliedDraftRef.current = null;
                      router.replace("/assistant");
                    }}
                  >
                    Clear handoff
                  </button>
                </div>
              </section>
            ) : null}
            <form
              className={styles.composer}
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(composer);
              }}
            >
              <div className={styles.composerChips} aria-label="Assistant shortcuts">
                {[
                  "Capture",
                  "Plan today",
                  "Process latest capture",
                  "Start review",
                  "Create task",
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setComposer((current) => (current.trim() ? current : chip))}
                    disabled={!snapshot || sending}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <textarea
                ref={composerRef}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder="Ask, capture, plan, review, or move something forward..."
                rows={4}
                disabled={!snapshot || sending}
              />
              <div className={styles.composerBar}>
                <span>{error || (sending ? "Starlog is working..." : "Voice, capture, planning, and review all land in this thread.")}</span>
                <button type="submit" disabled={!snapshot || sending || !composer.trim()}>
                  Send
                </button>
              </div>
            </form>
          </div>

          <aside className={styles.sideRail}>
            <article className={styles.sideCard}>
              <p className={styles.sideLabel}>Today</p>
              <RailSection title="Now" items={nowItems} onNavigate={(href) => router.push(href)} />
              <RailSection title="Open Loops" items={openLoops} onNavigate={(href) => router.push(href)} />
            </article>

            <article className={styles.sideCard}>
              <p className={styles.sideLabel}>Context</p>
              <RailSection
                title="Relevant"
                items={contextItems.length > 0 ? contextItems : [{ label: "No active context yet" }]}
                onNavigate={(href) => router.push(href)}
              />
            </article>

            <article className={styles.sideCard}>
              <p className={styles.sideLabel}>Suggestions</p>
              <RailSection title="Next" items={suggestions} onNavigate={(href) => router.push(href)} />
              <details className={styles.diagnostics}>
                <summary>Diagnostics</summary>
                <ul>
                  <li>{activeRun ? `${activeRun.orchestrator} run is ${activeRun.status}` : "No active run"}</li>
                  <li>{activeInterrupt ? activeInterrupt.title : "No pending action"}</li>
                  <li>{snapshot ? `${snapshot.messages.length} messages loaded` : "No thread snapshot yet"}</li>
                </ul>
              </details>
            </article>
          </aside>
        </section>
      </main>
    </StarlogAssistantRuntimeProvider>
  );
}

export default function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <AssistantPageContent />
    </Suspense>
  );
}
