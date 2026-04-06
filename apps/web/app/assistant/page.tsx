"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { MainRoomThread } from "../components/main-room-thread";
import {
  ObservatoryActionChip,
  ObservatoryFloatingAction,
  ObservatoryPanel,
  ObservatoryWaveform,
  ObservatoryWorkspaceShell,
} from "../components/observatory-shell";
import { PaneRestoreStrip, PaneToggleButton } from "../components/pane-controls";
import { replaceEntityCacheScope } from "../lib/entity-cache";
import { clearEntityCachesStale, readEntitySnapshot, readEntitySnapshotAsync, writeEntitySnapshot } from "../lib/entity-snapshot";
import { usePaneCollapsed } from "../lib/pane-state";
import { ApiError } from "../lib/starlog-client";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type AgentCommandStep = {
  tool_name: string;
  arguments: Record<string, unknown>;
  status: "planned" | "ok" | "dry_run" | "failed";
  message?: string | null;
  result: unknown;
};

type AgentCommandResponse = {
  command: string;
  planner: string;
  matched_intent: string;
  status: "planned" | "executed" | "failed";
  summary: string;
  steps: AgentCommandStep[];
};

type AgentIntent = {
  name: string;
  description: string;
  examples: string[];
};

type AssistantQueuedJob = {
  id: string;
  capability: "stt" | "llm_agent_plan";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  provider_hint?: string | null;
  provider_used?: string | null;
  action?: string | null;
  payload: {
    command?: string;
    title?: string;
  };
  output: {
    transcript?: string;
    assistant_command?: AgentCommandResponse;
  };
  error_text?: string | null;
  created_at: string;
  finished_at?: string | null;
};

type AssistantVoiceUploadQueueItem = {
  id: string;
  title: string;
  execute: boolean;
  provider_hint: string;
  device_target: string;
  file_name: string;
  mime_type: string;
  blob: Blob;
  created_at: string;
  attempts: number;
  last_attempt_at?: string;
  last_error?: string;
};

type ConversationMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  cards: ConversationCard[];
  metadata: {
    assistant_command?: AgentCommandResponse;
  } & Record<string, unknown>;
  created_at: string;
};

type ConversationCard = {
  kind: string;
  version: number;
  title?: string | null;
  body?: string | null;
  metadata: Record<string, unknown>;
};

type ConversationToolTrace = {
  id: string;
  thread_id: string;
  message_id?: string | null;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: string;
  result: unknown;
  metadata: Record<string, unknown>;
  created_at: string;
};

type ConversationSnapshot = {
  id: string;
  slug: string;
  title: string;
  mode: string;
  session_state: Record<string, unknown>;
  messages: ConversationMessage[];
  tool_traces: ConversationToolTrace[];
};

type ConversationSessionResetResponse = {
  thread_id: string;
  session_state: Record<string, unknown>;
  cleared_keys?: string[];
  preserved_message_count?: number;
  preserved_tool_trace_count?: number;
  updated_at: string;
};

type ConversationTurnResponse = {
  thread_id: string;
  user_message: ConversationMessage;
  assistant_message: ConversationMessage;
  trace: ConversationToolTrace;
  session_state: Record<string, unknown>;
};

type PendingTurn = {
  id: string;
  content: string;
  inputMode: "text" | "voice";
  createdAt: string;
};

const FALLBACK_EXAMPLES = [
  "summarize latest artifact",
  "create cards for latest artifact",
  "create task Review the latest summary due tomorrow priority 4",
  "create note Morning plan: Focus on review queue and planner cleanup",
  "create event Deep Work from 2026-03-07 09:00 to 2026-03-07 10:00",
  "schedule alarm for tomorrow at 07:00",
  "show execution policy",
];

const ASSISTANT_HISTORY_SNAPSHOT = "assistant.history";
const ASSISTANT_INTENTS_SNAPSHOT = "assistant.intents";
const ASSISTANT_VOICE_JOBS_SNAPSHOT = "assistant.voice_jobs";
const ASSISTANT_AI_JOBS_SNAPSHOT = "assistant.ai_jobs";
const ASSISTANT_VOICE_UPLOAD_QUEUE_SNAPSHOT = "assistant.voice_upload_queue";
const ASSISTANT_CACHE_PREFIXES = ["assistant."];
const ASSISTANT_INTENTS_ENTITY_SCOPE = "assistant.intents";
const ASSISTANT_HISTORY_ENTITY_SCOPE = "assistant.history";
const ASSISTANT_VOICE_JOBS_ENTITY_SCOPE = "assistant.voice_jobs";
const ASSISTANT_AI_JOBS_ENTITY_SCOPE = "assistant.ai_jobs";
const ASSISTANT_HISTORY_PANE_SNAPSHOT = "assistant.history_pane.collapsed";
const ASSISTANT_DIAGNOSTICS_PANE_SNAPSHOT = "assistant.diagnostics_pane.collapsed";

function cacheAssistantIntents(intents: AgentIntent[]): void {
  const recordedAt = new Date().toISOString();
  void replaceEntityCacheScope(
    ASSISTANT_INTENTS_ENTITY_SCOPE,
    intents.map((intent) => ({
      id: intent.name,
      value: intent,
      updated_at: recordedAt,
      search_text: `${intent.name} ${intent.description} ${intent.examples.join(" ")}`,
    })),
  );
}

function cacheAssistantHistory(history: AgentCommandResponse[]): void {
  const recordedAt = new Date().toISOString();
  void replaceEntityCacheScope(
    ASSISTANT_HISTORY_ENTITY_SCOPE,
    history.map((entry, index) => ({
      id: `${entry.matched_intent}:${entry.planner}:${index}`,
      value: entry,
      updated_at: recordedAt,
      search_text: `${entry.command} ${entry.summary} ${entry.matched_intent} ${entry.planner}`,
    })),
  );
}

function cacheAssistantJobs(scope: string, jobs: AssistantQueuedJob[]): void {
  void replaceEntityCacheScope(
    scope,
    jobs.map((job) => ({
      id: job.id,
      value: job,
      updated_at: job.finished_at || job.created_at,
      search_text: `${job.capability} ${job.status} ${job.provider_hint || ""} ${job.provider_used || ""} ${job.action || ""} ${job.payload.command || job.payload.title || ""}`,
    })),
  );
}

function extractAssistantHistory(snapshot: ConversationSnapshot): AgentCommandResponse[] {
  return snapshot.messages
    .map((message) => message.metadata?.assistant_command)
    .filter((entry): entry is AgentCommandResponse => !!entry)
    .slice()
    .reverse()
    .slice(0, 8);
}

function createVoiceQueueId(): string {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return `vq_${window.crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `vq_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function extensionForMime(mimeType: string): string {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  if (normalized.includes("mp4")) {
    return "m4a";
  }
  if (normalized.includes("mpeg")) {
    return "mp3";
  }
  if (normalized.includes("wav")) {
    return "wav";
  }
  return "webm";
}

function isVoiceQueueItem(value: unknown): value is AssistantVoiceUploadQueueItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AssistantVoiceUploadQueueItem>;
  return (
    typeof candidate.id === "string"
    && typeof candidate.title === "string"
    && typeof candidate.execute === "boolean"
    && typeof candidate.file_name === "string"
    && typeof candidate.mime_type === "string"
    && candidate.blob instanceof Blob
    && typeof candidate.created_at === "string"
    && typeof candidate.attempts === "number"
  );
}

export default function AssistantPage() {
  const pathname = usePathname();
  const router = useRouter();
  const { apiBase, token, isOnline } = useSessionConfig();
  const [command, setCommand] = useState("summarize latest artifact");
  const [status, setStatus] = useState("Ready");
  const [latest, setLatest] = useState<AgentCommandResponse | null>(() => {
    const cached = readEntitySnapshot<AgentCommandResponse[]>(ASSISTANT_HISTORY_SNAPSHOT, []);
    return cached[0] ?? null;
  });
  const [history, setHistory] = useState<AgentCommandResponse[]>(() => readEntitySnapshot<AgentCommandResponse[]>(ASSISTANT_HISTORY_SNAPSHOT, []));
  const [intents, setIntents] = useState<AgentIntent[]>(() => readEntitySnapshot<AgentIntent[]>(ASSISTANT_INTENTS_SNAPSHOT, []));
  const [voiceJobs, setVoiceJobs] = useState<AssistantQueuedJob[]>(() => readEntitySnapshot<AssistantQueuedJob[]>(ASSISTANT_VOICE_JOBS_SNAPSHOT, []));
  const [assistJobs, setAssistJobs] = useState<AssistantQueuedJob[]>(() => readEntitySnapshot<AssistantQueuedJob[]>(ASSISTANT_AI_JOBS_SNAPSHOT, []));
  const [voiceUploadQueue, setVoiceUploadQueue] = useState<AssistantVoiceUploadQueueItem[]>([]);
  const historyPane = usePaneCollapsed(ASSISTANT_HISTORY_PANE_SNAPSHOT);
  const diagnosticsPane = usePaneCollapsed(ASSISTANT_DIAGNOSTICS_PANE_SNAPSHOT);
  const [voiceUploadQueueHydrated, setVoiceUploadQueueHydrated] = useState(false);
  const [voiceQueueReplayInFlight, setVoiceQueueReplayInFlight] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [sessionState, setSessionState] = useState<Record<string, unknown>>({});
  const [conversationTitle, setConversationTitle] = useState("Primary Thread");
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [conversationTraces, setConversationTraces] = useState<ConversationToolTrace[]>([]);
  const [lastResetSummary, setLastResetSummary] = useState<ConversationSessionResetResponse | null>(null);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});
  const [speakingReply, setSpeakingReply] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const [turnInFlight, setTurnInFlight] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const holdToTalkActiveRef = useRef(false);
  const stopRecordingOnceReadyRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const browserSupportsRecording = useMemo(
    () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    [],
  );
  const browserSupportsSpeech = useMemo(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    [],
  );
  const exampleCommands = useMemo(() => {
    const collected = intents.flatMap((intent) => intent.examples);
    return collected.length > 0 ? collected : FALLBACK_EXAMPLES;
  }, [intents]);
  const showcaseLabel = latest?.matched_intent?.replace(/_/g, ".") || "command.draft";
  const showcasePlanner = latest?.planner || "preview_shell";
  const showcaseDate = useMemo(
    () => new Intl.DateTimeFormat([], { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    [],
  );
  const showcaseActions = useMemo(() => {
    if (latest?.steps.length) {
      return latest.steps.slice(0, 3).map((step) => step.message || `${step.tool_name} ${step.status}`);
    }
    return [
      "Refine the command until the planned tool flow looks correct.",
      "Inspect the queue and agent panes before promoting to execute mode.",
      "Push any long-running voice or Codex work into the side feeds for replay.",
    ];
  }, [latest]);
  const latestSpokenReply = useMemo(() => {
    if (latest?.summary) {
      return latest.summary;
    }
    const assistantMessage = [...conversationMessages].reverse().find((message) => message.role === "assistant");
    return assistantMessage?.content?.trim() || "";
  }, [conversationMessages, latest]);
  const recentToolNames = useMemo(
    () => [...new Set(conversationTraces.slice(0, 4).map((trace) => trace.tool_name.replace(/_/g, " ")))],
    [conversationTraces],
  );
  const orbitCards = useMemo(() => ([
    {
      kicker: "Thread state",
      title: pendingTurn ? "Reply underway" : "Ready for the next turn",
      body: pendingTurn
        ? `Main Room is working on ${pendingTurn.inputMode === "voice" ? "a voiced" : "a typed"} turn.`
        : `${conversationMessages.length} messages and ${conversationTraces.length} recent traces remain attached to the thread.`,
      href: "/assistant",
      actionLabel: "Stay in Main Room",
    },
    {
      kicker: "Research",
      title: recentToolNames[0] ? `Latest tool: ${recentToolNames[0]}` : "Tool detail stays subordinate",
      body: recentToolNames.length > 0
        ? `Recent trace context: ${recentToolNames.join(", ")}.`
        : "Tool calls appear inline under replies until you deliberately expand them.",
      href: "/notes",
      actionLabel: "Inspect notes",
    },
    {
      kicker: "Memory",
      title: Object.keys(sessionState).length > 0 ? "Short-term context live" : "Session memory clear",
      body: Object.keys(sessionState).length > 0
        ? `${Object.keys(sessionState).length} live session key${Object.keys(sessionState).length === 1 ? "" : "s"} remain resettable without clearing the thread.`
        : "Long-term thread history persists while session context stays explainable and resettable.",
      href: "/runtime",
      actionLabel: "Open runtime",
    },
  ]), [conversationMessages.length, conversationTraces.length, pendingTurn, recentToolNames, sessionState]);
  const transcriptMessages = useMemo(() => {
    if (conversationMessages.length > 0 || pendingTurn) {
      const messages = [...conversationMessages];
      if (pendingTurn) {
        messages.push({
          id: pendingTurn.id,
          role: "user",
          content: pendingTurn.content,
          cards: [],
          metadata: { pending: true, input_mode: pendingTurn.inputMode },
          created_at: pendingTurn.createdAt,
        });
        messages.push({
          id: `${pendingTurn.id}:assistant`,
          role: "assistant",
          content: "",
          cards: [],
          metadata: { pending: true, status: "thinking" },
          created_at: pendingTurn.createdAt,
        });
      }
      return messages;
    }
    if (!latest) {
      return [];
    }
    return [
      {
        id: "assistant-preview",
        role: "assistant" as const,
        content: latest.summary,
        cards: [],
        metadata: { assistant_command: latest },
        created_at: new Date().toISOString(),
      },
    ];
  }, [conversationMessages, latest, pendingTurn]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: turnInFlight ? "smooth" : "auto", block: "end" });
  }, [transcriptMessages.length, turnInFlight]);

  const toggleExpandedCards = useCallback((key: string) => {
    setExpandedCards((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

  const toggleExpandedTraces = useCallback((key: string) => {
    setExpandedTraces((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

  useEffect(() => {
    setHistory((previous) => previous.length > 0 ? previous : readEntitySnapshot<AgentCommandResponse[]>(ASSISTANT_HISTORY_SNAPSHOT, []));
    setLatest((previous) => previous ?? readEntitySnapshot<AgentCommandResponse[]>(ASSISTANT_HISTORY_SNAPSHOT, [])[0] ?? null);
    setIntents((previous) => previous.length > 0 ? previous : readEntitySnapshot<AgentIntent[]>(ASSISTANT_INTENTS_SNAPSHOT, []));
    setVoiceJobs((previous) => previous.length > 0 ? previous : readEntitySnapshot<AssistantQueuedJob[]>(ASSISTANT_VOICE_JOBS_SNAPSHOT, []));
    setAssistJobs((previous) => previous.length > 0 ? previous : readEntitySnapshot<AssistantQueuedJob[]>(ASSISTANT_AI_JOBS_SNAPSHOT, []));

    let cancelled = false;
    readEntitySnapshotAsync<AssistantVoiceUploadQueueItem[]>(ASSISTANT_VOICE_UPLOAD_QUEUE_SNAPSHOT, [])
      .then((cachedQueue) => {
        if (cancelled) {
          return;
        }
        const validQueue = cachedQueue.filter((item) => isVoiceQueueItem(item));
        setVoiceUploadQueue(validQueue);
      })
      .finally(() => {
        if (!cancelled) {
          setVoiceUploadQueueHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!voiceUploadQueueHydrated) {
      return;
    }
    writeEntitySnapshot(
      ASSISTANT_VOICE_UPLOAD_QUEUE_SNAPSHOT,
      voiceUploadQueue,
      { persistBootstrap: false },
    );
  }, [voiceUploadQueue, voiceUploadQueueHydrated]);

  const loadIntents = useCallback(async () => {
    try {
      const payload = await apiRequest<AgentIntent[]>(apiBase, token, "/v1/agent/intents");
      setIntents(payload);
      writeEntitySnapshot(ASSISTANT_INTENTS_SNAPSHOT, payload);
      cacheAssistantIntents(payload);
      clearEntityCachesStale(ASSISTANT_CACHE_PREFIXES);
    } catch {
      // Keep existing cached intents when live refresh fails.
    }
  }, [apiBase, token]);

  const loadConversation = useCallback(async (origin: "auto" | "manual") => {
    try {
      const payload = await apiRequest<ConversationSnapshot>(apiBase, token, "/v1/conversations/primary");
      const derivedHistory = extractAssistantHistory(payload);
      setConversationTitle(payload.title);
      setConversationMessages(payload.messages);
      setConversationTraces(payload.tool_traces);
      setSessionState(payload.session_state);
      setLatest(derivedHistory[0] ?? null);
      setHistory(derivedHistory);
      writeEntitySnapshot(ASSISTANT_HISTORY_SNAPSHOT, derivedHistory);
      cacheAssistantHistory(derivedHistory);
      clearEntityCachesStale(ASSISTANT_CACHE_PREFIXES);
      if (origin === "manual") {
        setStatus(`Loaded conversation ${payload.title}`);
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load conversation");
      }
    }
  }, [apiBase, token]);

  const recordCompletedCommand = useCallback((candidate: AgentCommandResponse | null | undefined) => {
    if (!candidate) {
      return;
    }
    setLatest(candidate);
    setHistory((previous) => {
      const next = [candidate, ...previous.filter((item) => item.command !== candidate.command || item.planner !== candidate.planner)].slice(0, 8);
      writeEntitySnapshot(ASSISTANT_HISTORY_SNAPSHOT, next);
      cacheAssistantHistory(next);
      return next;
    });
  }, []);

  const loadVoiceJobs = useCallback(async (origin: "auto" | "manual") => {
    try {
      const payload = await apiRequest<AssistantQueuedJob[]>(
        apiBase,
        token,
        "/v1/ai/jobs?limit=12&action=assistant_command",
      );
      setVoiceJobs(payload);
      writeEntitySnapshot(ASSISTANT_VOICE_JOBS_SNAPSHOT, payload);
      cacheAssistantJobs(ASSISTANT_VOICE_JOBS_ENTITY_SCOPE, payload);
      recordCompletedCommand(payload.find((job) => job.output.assistant_command)?.output.assistant_command);
      if (payload.some((job) => job.output.assistant_command)) {
        loadConversation("auto").catch(() => undefined);
      }
      clearEntityCachesStale(ASSISTANT_CACHE_PREFIXES);
      if (origin === "manual") {
        setStatus(`Loaded ${payload.length} voice command job(s)`);
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load voice jobs");
      }
    }
  }, [apiBase, loadConversation, recordCompletedCommand, token]);

  const loadAssistJobs = useCallback(async (origin: "auto" | "manual") => {
    try {
      const payload = await apiRequest<AssistantQueuedJob[]>(
        apiBase,
        token,
        "/v1/ai/jobs?limit=12&action=assistant_command_ai",
      );
      setAssistJobs(payload);
      writeEntitySnapshot(ASSISTANT_AI_JOBS_SNAPSHOT, payload);
      cacheAssistantJobs(ASSISTANT_AI_JOBS_ENTITY_SCOPE, payload);
      recordCompletedCommand(payload.find((job) => job.output.assistant_command)?.output.assistant_command);
      if (payload.some((job) => job.output.assistant_command)) {
        loadConversation("auto").catch(() => undefined);
      }
      clearEntityCachesStale(ASSISTANT_CACHE_PREFIXES);
      if (origin === "manual") {
        setStatus(`Loaded ${payload.length} queued Codex planner job(s)`);
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load queued Codex jobs");
      }
    }
  }, [apiBase, loadConversation, recordCompletedCommand, token]);

  const appendVoiceJobs = useCallback((jobs: AssistantQueuedJob[]) => {
    if (jobs.length === 0) {
      return;
    }
    setVoiceJobs((previous) => {
      const nextById = new Map<string, AssistantQueuedJob>();
      for (const job of jobs) {
        nextById.set(job.id, job);
      }
      for (const existing of previous) {
        if (!nextById.has(existing.id)) {
          nextById.set(existing.id, existing);
        }
      }
      const ordered = [...nextById.values()].slice(0, 12);
      writeEntitySnapshot(ASSISTANT_VOICE_JOBS_SNAPSHOT, ordered);
      return ordered;
    });
  }, []);

  const uploadVoiceQueueItem = useCallback(async (item: AssistantVoiceUploadQueueItem): Promise<AssistantQueuedJob> => {
    const formData = new FormData();
    formData.append("title", item.title);
    formData.append("execute", item.execute ? "true" : "false");
    formData.append("device_target", item.device_target);
    formData.append("provider_hint", item.provider_hint);
    formData.append("file", new File([item.blob], item.file_name, { type: item.mime_type || "audio/webm" }));

    const response = await fetch(`${apiBase}/v1/agent/command/voice`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(response.status, body);
    }

    return await response.json() as AssistantQueuedJob;
  }, [apiBase, token]);

  const replayVoiceUploadQueue = useCallback(async (origin: "auto" | "manual") => {
    if (voiceQueueReplayInFlight) {
      return;
    }
    if (voiceUploadQueue.length === 0) {
      if (origin === "manual") {
        setStatus("No queued voice uploads");
      }
      return;
    }
    if (!isOnline) {
      if (origin === "manual") {
        setStatus("Reconnect to replay queued voice uploads");
      }
      return;
    }
    if (!token) {
      if (origin === "manual") {
        setStatus("Add bearer token to replay queued voice uploads");
      }
      return;
    }

    setVoiceQueueReplayInFlight(true);
    try {
      const orderedQueue = [...voiceUploadQueue].sort((left, right) => left.created_at.localeCompare(right.created_at));
      const remaining: AssistantVoiceUploadQueueItem[] = [];
      const uploadedJobs: AssistantQueuedJob[] = [];

      for (const item of orderedQueue) {
        const attemptedAt = new Date().toISOString();
        try {
          const payload = await uploadVoiceQueueItem(item);
          uploadedJobs.push(payload);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Voice command upload failed";
          remaining.push({
            ...item,
            attempts: item.attempts + 1,
            last_attempt_at: attemptedAt,
            last_error: reason,
          });
        }
      }

      setVoiceUploadQueue(remaining);
      appendVoiceJobs(uploadedJobs);
      recordCompletedCommand(uploadedJobs.find((job) => job.output.assistant_command)?.output.assistant_command);
      if (remaining.length === 0) {
        setStatus(
          uploadedJobs.length > 0
            ? `Uploaded ${uploadedJobs.length} queued voice command(s)`
            : "Voice queue is empty",
        );
      } else {
        setStatus(
          uploadedJobs.length > 0
            ? `Uploaded ${uploadedJobs.length} queued voice command(s); ${remaining.length} still queued`
            : `Voice upload replay failed; ${remaining.length} item(s) remain queued`,
        );
      }
    } finally {
      setVoiceQueueReplayInFlight(false);
    }
  }, [
    appendVoiceJobs,
    isOnline,
    recordCompletedCommand,
    token,
    uploadVoiceQueueItem,
    voiceQueueReplayInFlight,
    voiceUploadQueue,
  ]);

  function dropQueuedVoiceUpload(queueId: string) {
    setVoiceUploadQueue((previous) => previous.filter((item) => item.id !== queueId));
    setStatus(`Dropped queued voice upload ${queueId}`);
  }

  function discardVoiceCapture() {
    setVoiceBlob(null);
    setStatus("Discarded captured voice command");
  }

  function beginHoldToTalk() {
    holdToTalkActiveRef.current = true;
    stopRecordingOnceReadyRef.current = false;
    if (!recording && !recorderRef.current) {
      void startVoiceRecording();
    }
  }

  function endHoldToTalk() {
    holdToTalkActiveRef.current = false;
    if (recording || recorderRef.current) {
      stopVoiceRecording();
      return;
    }
    stopRecordingOnceReadyRef.current = true;
  }

  function handleHoldToTalkKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.repeat || (event.key !== " " && event.key !== "Enter")) {
      return;
    }
    event.preventDefault();
    beginHoldToTalk();
  }

  function handleHoldToTalkKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    endHoldToTalk();
  }

  function toggleSpokenReply() {
    if (!browserSupportsSpeech) {
      setStatus("This browser cannot play spoken replies");
      return;
    }
    const synth = window.speechSynthesis;
    if (speakingReply) {
      synth.cancel();
      setSpeakingReply(false);
      setStatus("Stopped spoken reply");
      return;
    }
    const nextReply = latestSpokenReply.trim();
    if (!nextReply) {
      setStatus("No assistant reply is available to speak");
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(nextReply);
    utterance.rate = 1.03;
    utterance.pitch = 0.95;
    utterance.onend = () => {
      setSpeakingReply(false);
      setStatus("Finished spoken reply");
    };
    utterance.onerror = () => {
      setSpeakingReply(false);
      setStatus("Spoken reply failed");
    };
    setSpeakingReply(true);
    setStatus("Speaking latest assistant reply");
    synth.speak(utterance);
  }

  useEffect(() => () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  async function runCommand(execute: boolean) {
    const trimmed = command.trim();
    if (!trimmed) {
      setStatus("Enter an operator command first");
      return;
    }

    try {
      const payload = await apiRequest<AgentCommandResponse>(apiBase, token, "/v1/agent/command", {
        method: "POST",
        body: JSON.stringify({
          command: trimmed,
          execute,
          device_target: "web-pwa",
        }),
      });
      setLatest(payload);
      setHistory((previous) => {
        const next = [payload, ...previous].slice(0, 8);
        writeEntitySnapshot(ASSISTANT_HISTORY_SNAPSHOT, next);
        cacheAssistantHistory(next);
        return next;
      });
      loadConversation("auto").catch(() => undefined);
      clearEntityCachesStale(ASSISTANT_CACHE_PREFIXES);
      setStatus(`${execute ? "Executed" : "Planned"} ${payload.matched_intent} via ${payload.planner}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assistant command failed");
    }
  }

  async function sendToMainRoom(inputMode: "text" | "voice" = "text") {
    const trimmed = command.trim();
    if (!trimmed) {
      setStatus("Enter a message for the Main Room first");
      return;
    }

    const pendingId =
      typeof window !== "undefined" && window.crypto?.randomUUID
        ? `pending_${window.crypto.randomUUID().replace(/-/g, "")}`
        : `pending_${Date.now()}`;

    setPendingTurn({
      id: pendingId,
      content: trimmed,
      inputMode,
      createdAt: new Date().toISOString(),
    });
    setTurnInFlight(true);
    setStatus(inputMode === "voice" ? "Routing voice text into the Main Room..." : "Sending to the Main Room...");

    try {
      const payload = await apiRequest<ConversationTurnResponse>(apiBase, token, "/v1/conversations/primary/chat", {
        method: "POST",
        body: JSON.stringify({
          content: trimmed,
          input_mode: inputMode,
          device_target: "web-pwa",
          metadata: {
            surface: "main_room",
            submitted_via: "assistant_page",
          },
        }),
      });
      setConversationMessages((previous) => [...previous, payload.user_message, payload.assistant_message]);
      setConversationTraces((previous) => [payload.trace, ...previous].slice(0, 25));
      setSessionState(payload.session_state);
      setPendingTurn(null);
      setCommand("");
      clearEntityCachesStale(ASSISTANT_CACHE_PREFIXES);
      setStatus("Main Room reply received");
    } catch (error) {
      setPendingTurn(null);
      setStatus(error instanceof Error ? error.message : "Main Room turn failed");
    } finally {
      setTurnInFlight(false);
    }
  }

  async function queueAssistCommand(execute: boolean) {
    const trimmed = command.trim();
    if (!trimmed) {
      setStatus("Enter an operator command first");
      return;
    }

    try {
      const payload = await apiRequest<AssistantQueuedJob>(apiBase, token, "/v1/agent/command/assist", {
        method: "POST",
        body: JSON.stringify({
          command: trimmed,
          execute,
          device_target: "web-pwa",
          provider_hint: "codex_local",
        }),
      });
      setAssistJobs((previous) => {
        const next = [payload, ...previous.filter((item) => item.id !== payload.id)].slice(0, 12);
        writeEntitySnapshot(ASSISTANT_AI_JOBS_SNAPSHOT, next);
        cacheAssistantJobs(ASSISTANT_AI_JOBS_ENTITY_SCOPE, next);
        return next;
      });
      clearEntityCachesStale(ASSISTANT_CACHE_PREFIXES);
      setStatus(`Queued Codex ${execute ? "execute" : "plan"} job ${payload.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to queue Codex planner job");
    }
  }

  async function startVoiceRecording() {
    if (!browserSupportsRecording) {
      setStatus("This browser does not support recording voice commands");
      return;
    }
    if (recording) {
      setStatus("Voice recording is already in progress");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setVoiceBlob(blob);
        setRecording(false);
        chunksRef.current = [];
        holdToTalkActiveRef.current = false;
        stopRecordingOnceReadyRef.current = false;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setStatus("Voice command ready to upload");
      };
      recorder.start();
      recorderRef.current = recorder;
      streamRef.current = stream;
      setVoiceBlob(null);
      setRecording(true);
      setStatus("Recording voice command...");
      if (!holdToTalkActiveRef.current || stopRecordingOnceReadyRef.current) {
        stopRecordingOnceReadyRef.current = false;
        recorder.stop();
      }
    } catch (error) {
      holdToTalkActiveRef.current = false;
      stopRecordingOnceReadyRef.current = false;
      setStatus(error instanceof Error ? error.message : "Failed to start voice recording");
    }
  }

  function stopVoiceRecording() {
    if (!recorderRef.current) {
      setStatus("No voice command recording is in progress");
      return;
    }
    recorderRef.current.stop();
  }

  async function submitVoiceCommand(execute: boolean) {
    if (!voiceBlob) {
      setStatus("Record a voice command first");
      return;
    }

    const mimeType = voiceBlob.type || "audio/webm";
    const queueId = createVoiceQueueId();
    const queueItem: AssistantVoiceUploadQueueItem = {
      id: queueId,
      title: "Web voice command",
      execute,
      provider_hint: "whisper_local",
      device_target: "web-pwa",
      file_name: `voice-command-${Date.now()}.${extensionForMime(mimeType)}`,
      mime_type: mimeType,
      blob: voiceBlob,
      created_at: new Date().toISOString(),
      attempts: 0,
    };
    setVoiceUploadQueue((previous) => [queueItem, ...previous]);
    setVoiceBlob(null);
    setStatus(
      isOnline && token
        ? `Queued voice upload ${queueId}; replaying now`
        : `Queued voice upload ${queueId} for replay`,
    );
  }

  async function resetConversationSession() {
    try {
      const payload = await apiRequest<ConversationSessionResetResponse>(
        apiBase,
        token,
        "/v1/conversations/primary/session/reset",
        { method: "POST" },
      );
      setSessionState(payload.session_state);
      setLastResetSummary(payload);
      const clearedKeys = payload.cleared_keys ?? Object.keys(sessionState);
      const preservedMessageCount = payload.preserved_message_count ?? conversationMessages.length;
      const preservedTraceCount = payload.preserved_tool_trace_count ?? conversationTraces.length;
      const clearedLabel =
        clearedKeys.length > 0 ? `${clearedKeys.length} key${clearedKeys.length === 1 ? "" : "s"} cleared` : "Session already empty";
      setStatus(
        `${clearedLabel}; kept ${preservedMessageCount} messages and ${preservedTraceCount} traces`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to clear conversation state");
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    loadConversation("auto").catch(() => undefined);
    loadIntents().catch(() => undefined);
    loadVoiceJobs("auto").catch(() => undefined);
    loadAssistJobs("auto").catch(() => undefined);
  }, [loadAssistJobs, loadConversation, loadIntents, loadVoiceJobs, token]);

  useEffect(() => {
    if (!voiceUploadQueueHydrated || voiceUploadQueue.length === 0 || !isOnline || !token) {
      return;
    }

    replayVoiceUploadQueue("auto").catch((error) => {
      setStatus(error instanceof Error ? error.message : "Voice upload replay failed");
      setVoiceQueueReplayInFlight(false);
    });
  }, [
    isOnline,
    replayVoiceUploadQueue,
    token,
    voiceUploadQueue.length,
    voiceUploadQueueHydrated,
  ]);

  return (
    <ObservatoryWorkspaceShell
      pathname={pathname}
      surface="main-room"
      eyebrow={conversationTitle}
      title="Speak, inspect, confirm."
      description="Send typed or spoken turns into one persistent thread. Tool work, cards, and session memory stay attached to each reply instead of taking over the workspace."
      statusLabel={isOnline ? "System optimal" : "Offline cache"}
      stats={[
        { label: "Main Room", value: pendingTurn ? "Reply pending" : "Ready" },
        { label: "Voice queue", value: String(voiceUploadQueue.length) },
        { label: "Recent runs", value: String(history.length) },
      ]}
      actions={
        <div className="button-row">
          <button className="button" type="button" onClick={() => loadConversation("manual").catch(() => undefined)}>
            Refresh thread
          </button>
          <Link className="button" href="/review">Open review</Link>
        </div>
      }
      sideNote={{
        title: "Operational cycle",
        body: showcaseActions[0] || "The thread is ready for note lookup, agenda planning, and review pivots.",
        meta: `${showcasePlanner} · ${showcaseDate}`,
      }}
      orbitCards={orbitCards}
      footer={
        <ObservatoryFloatingAction
          label="Jump"
          detail="Composer"
          onClick={() => document.getElementById("assistant-command")?.focus()}
        />
      }
    >
      <section className="observatory-grid observatory-grid-wide">
        <ObservatoryPanel
          kicker="Observatory intelligence"
          title="Main Room transcript"
          meta="Cards and tool detail stay folded under the reply so the conversation remains primary."
          actions={
            <div className="button-row">
              <button className="button" type="button" onClick={() => setCommand(exampleCommands[0] || FALLBACK_EXAMPLES[0])}>
                Load sample
              </button>
              <button className="button" type="button" onClick={() => resetConversationSession()}>
                Reset session
              </button>
            </div>
          }
        >
          <MainRoomThread
            messages={transcriptMessages}
            traces={conversationTraces}
            expandedCards={expandedCards}
            expandedTraces={expandedTraces}
            onToggleCards={toggleExpandedCards}
            onToggleTraces={toggleExpandedTraces}
            onReuseCommand={(nextCommand) => setCommand(nextCommand)}
            onOpenSurface={(href) => router.push(href)}
            emptyTitle="Begin with a typed turn or a held-to-talk request"
            emptyBody="The Main Room keeps the answer, the next move, and the supporting tool details in one readable thread."
            emptyActions={showcaseActions}
            transcriptEndRef={transcriptEndRef}
          />
        </ObservatoryPanel>

        <ObservatoryPanel
          kicker="Voice dock"
          title={voiceBlob ? "Voice clip staged" : recording ? "Listening now" : "Composer and mic"}
          meta="Use typed turns for deliberate prompts, or hold the voice control for a short spoken request."
        >
          <div className="assistant-voice-dock">
            <button
              className={recording ? "assistant-voice-button recording" : "assistant-voice-button"}
              type="button"
              onPointerDown={beginHoldToTalk}
              onPointerUp={endHoldToTalk}
              onPointerLeave={endHoldToTalk}
              onPointerCancel={endHoldToTalk}
              onKeyDown={handleHoldToTalkKeyDown}
              onKeyUp={handleHoldToTalkKeyUp}
              disabled={!browserSupportsRecording}
            >
              <span className="assistant-voice-button-label">
                {recording ? "Release to capture" : voiceBlob ? "Voice captured" : "Hold to talk"}
              </span>
              <span className="assistant-voice-button-meta">
                {browserSupportsRecording ? "Local mic capture for Main Room turns" : "Browser capture unavailable"}
              </span>
            </button>
            <ObservatoryWaveform
              label={recording ? "Capture active" : voiceBlob ? "Voice staged" : "Voice ready"}
              detail={
                recording
                  ? "Release to preserve the transcript."
                  : voiceBlob
                    ? "Route this clip into the Main Room or operator lanes."
                    : "Short reply mode. Interruptible. Transcript preserved."
              }
              active={recording}
            />
          </div>

          <label className="label" htmlFor="assistant-command">Message</label>
          <textarea
            id="assistant-command"
            className="textarea"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            rows={5}
            placeholder="Ask for a briefing, a next move, a recap of the current thread, or a card-backed reply."
          />
          <div className="assistant-toolbar">
            <button className="button" type="button" onClick={() => sendToMainRoom("text")} disabled={turnInFlight}>
              {turnInFlight ? "Sending..." : "Send to Main Room"}
            </button>
            <button
              className="button"
              type="button"
              onClick={toggleSpokenReply}
              disabled={!browserSupportsSpeech || !latestSpokenReply}
            >
              {speakingReply ? "Stop spoken reply" : "Speak latest reply"}
            </button>
          </div>
          <div className="assistant-chip-grid">
            {exampleCommands.slice(0, 6).map((example) => (
              <ObservatoryActionChip key={example} label={example} onClick={() => setCommand(example)} />
            ))}
          </div>
          {voiceBlob ? (
            <div className="assistant-voice-ready">
              <p className="console-copy">Voice clip captured and ready for upload.</p>
              <div className="button-row">
                <button className="button" type="button" onClick={() => submitVoiceCommand(false)}>Plan voice</button>
                <button className="button" type="button" onClick={() => submitVoiceCommand(true)}>Execute voice</button>
                <button className="button" type="button" onClick={() => discardVoiceCapture()}>Discard clip</button>
              </div>
            </div>
          ) : null}
          <p className="status">{status}</p>
        </ObservatoryPanel>
      </section>

      <section className="observatory-grid observatory-grid-wide">
        <PaneRestoreStrip
          actions={[
            ...(historyPane.collapsed ? [{ id: "assistant-history", label: "Show advanced lanes", onClick: historyPane.expand }] : []),
            ...(diagnosticsPane.collapsed ? [{ id: "assistant-diagnostics", label: "Show diagnostics", onClick: diagnosticsPane.expand }] : []),
          ]}
        />
        {!historyPane.collapsed ? (
          <ObservatoryPanel
            kicker="Advanced lanes"
            title="Operator history and reusable prompts"
            meta="Keep planning/debug controls reachable, but subordinate to the thread."
            actions={<PaneToggleButton label="Hide pane" onClick={historyPane.collapse} />}
          >
            <ul className="assistant-mini-feed">
              {history.length === 0 ? (
                <li className="assistant-mini-feed-empty">No recent operator runs yet.</li>
              ) : (
                history.map((entry, index) => (
                  <li key={`${entry.command}-${index}`} className={index === 0 ? "assistant-mini-feed-item active" : "assistant-mini-feed-item"}>
                    <button type="button" className="assistant-mini-feed-button" onClick={() => setCommand(entry.command)}>
                      <span className="assistant-mini-feed-meta">{entry.matched_intent} · {entry.status}</span>
                      <strong>{entry.command}</strong>
                      <span>{entry.summary}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <details className="command-agent-detail">
              <summary>Command actions</summary>
              <div className="assistant-toolbar assistant-toolbar-advanced">
                <button className="button" type="button" onClick={() => runCommand(false)}>Preview flow</button>
                <button className="button" type="button" onClick={() => runCommand(true)}>Execute flow</button>
                <button className="button" type="button" onClick={() => queueAssistCommand(true)}>Queue Codex execute</button>
              </div>
            </details>
          </ObservatoryPanel>
        ) : null}

        {!diagnosticsPane.collapsed ? (
          <ObservatoryPanel
            kicker="Diagnostics"
            title="Queue state and session memory"
            meta="Raw queues and memory stay one click away rather than living in the transcript."
            actions={<PaneToggleButton label="Hide pane" onClick={diagnosticsPane.collapse} />}
          >
            <div className="assistant-diagnostics-grid">
              <article className="assistant-diagnostic-card">
                <span className="observatory-eyebrow">Session memory</span>
                <p className="console-copy">
                  {Object.keys(sessionState).length > 0
                    ? JSON.stringify(sessionState, null, 2)
                    : "Short-term session state is empty."}
                </p>
              </article>
              <article className="assistant-diagnostic-card">
                <span className="observatory-eyebrow">Queued voice uploads</span>
                {voiceUploadQueue.length === 0 ? (
                  <p className="console-copy">No queued voice uploads.</p>
                ) : (
                  voiceUploadQueue.map((item) => (
                    <div key={item.id} className="assistant-queue-item">
                      <p className="console-copy">
                        <strong>{item.id}</strong> [{item.execute ? "execute" : "plan"}] attempts: {item.attempts}
                      </p>
                      {item.last_error ? <p className="console-copy">last error: {item.last_error}</p> : null}
                      <button className="button" type="button" onClick={() => dropQueuedVoiceUpload(item.id)}>
                        Drop upload
                      </button>
                    </div>
                  ))
                )}
              </article>
            </div>
            <details className="command-agent-detail">
              <summary>Voice jobs ({voiceJobs.length})</summary>
              <div className="scroll-panel">
                {voiceJobs.length === 0 ? (
                  <p className="console-copy">No voice command jobs yet.</p>
                ) : (
                  voiceJobs.map((job) => (
                    <div key={job.id} className="command-step-card">
                      <p className="console-copy">
                        <strong>{job.id}</strong> [{job.status}] provider: {job.provider_used || job.provider_hint || "pending"}
                      </p>
                      {job.output.transcript ? <p className="console-copy">transcript: {job.output.transcript}</p> : null}
                      {job.error_text ? <p className="console-copy">error: {job.error_text}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </details>
            <details className="command-agent-detail">
              <summary>Planner jobs ({assistJobs.length})</summary>
              <div className="scroll-panel">
                {assistJobs.length === 0 ? (
                  <p className="console-copy">No queued planner jobs yet.</p>
                ) : (
                  assistJobs.map((job) => (
                    <div key={job.id} className="command-step-card">
                      <p className="console-copy">
                        <strong>{job.id}</strong> [{job.status}] provider: {job.provider_used || job.provider_hint || "pending"}
                      </p>
                      {job.payload.command ? <p className="console-copy">command: {job.payload.command}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </details>
          </ObservatoryPanel>
        ) : null}
      </section>
    </ObservatoryWorkspaceShell>
  );
}
