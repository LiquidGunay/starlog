"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  metadata: {
    assistant_command?: AgentCommandResponse;
  };
  created_at: string;
};

type ConversationSnapshot = {
  id: string;
  slug: string;
  title: string;
  mode: string;
  session_state: Record<string, unknown>;
  messages: ConversationMessage[];
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
const ASSISTANT_QUEUE_PANE_SNAPSHOT = "assistant.pane.queue";
const ASSISTANT_AGENT_PANE_SNAPSHOT = "assistant.pane.agent";

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
  const { apiBase, token, isOnline } = useSessionConfig();
  const queuePane = usePaneCollapsed(ASSISTANT_QUEUE_PANE_SNAPSHOT);
  const agentPane = usePaneCollapsed(ASSISTANT_AGENT_PANE_SNAPSHOT);
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
  const [voiceUploadQueueHydrated, setVoiceUploadQueueHydrated] = useState(false);
  const [voiceQueueReplayInFlight, setVoiceQueueReplayInFlight] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [sessionState, setSessionState] = useState<Record<string, unknown>>({});
  const [conversationTitle, setConversationTitle] = useState("Primary Thread");
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [speakingReply, setSpeakingReply] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const holdToTalkActiveRef = useRef(false);
  const stopRecordingOnceReadyRef = useRef(false);
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
  const transcriptMessages = useMemo(() => {
    if (conversationMessages.length > 0) {
      return conversationMessages;
    }
    if (!latest) {
      return [];
    }
    return [
      {
        id: "assistant-preview",
        role: "assistant" as const,
        content: latest.summary,
        metadata: { assistant_command: latest },
        created_at: new Date().toISOString(),
      },
    ];
  }, [conversationMessages, latest]);

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
      setStatus("Enter a command first");
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

  async function queueAssistCommand(execute: boolean) {
    const trimmed = command.trim();
    if (!trimmed) {
      setStatus("Enter a command first");
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
      await apiRequest<{ thread_id: string; session_state: Record<string, unknown> }>(
        apiBase,
        token,
        "/v1/conversations/primary/session/reset",
        { method: "POST" },
      );
      setSessionState({});
      setStatus("Cleared short-term conversation state");
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
    <main className="command-center-shell assistant-thread-shell">
      <section
        className={[
          "command-center-layout",
          queuePane.collapsed ? "command-center-layout-left-collapsed" : "",
          agentPane.collapsed ? "command-center-layout-right-collapsed" : "",
        ].filter(Boolean).join(" ")}
      >
        {!queuePane.collapsed ? (
          <aside className="command-center-column assistant-side-column">
            <div className="command-column-header">
              <span className="command-column-title">Ritual Feed</span>
              <span className="command-footnote">{history.length} recent runs</span>
              <PaneToggleButton label="Hide pane" onClick={queuePane.collapse} />
            </div>
            <div className="assistant-side-stack">
              <section className="assistant-side-card glass">
                <div className="assistant-side-card-head">
                  <span className="assistant-side-kicker">Latest Turn</span>
                  <span className="command-footnote">{showcaseLabel}</span>
                </div>
                <ul className="assistant-mini-feed">
                  {history.length === 0 ? (
                    <li className="assistant-mini-feed-empty">No recent command runs yet.</li>
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
              </section>

              <section className="assistant-side-card glass">
                <div className="assistant-side-card-head">
                  <span className="assistant-side-kicker">Invocation Library</span>
                  <span className="command-footnote">{exampleCommands.length} samples</span>
                </div>
                <div className="assistant-chip-grid">
                  {exampleCommands.slice(0, 8).map((example) => (
                    <button key={example} type="button" className="assistant-chip-button" onClick={() => setCommand(example)}>
                      {example}
                    </button>
                  ))}
                </div>
              </section>

              <section className="assistant-side-card glass">
                <div className="assistant-side-card-head">
                  <span className="assistant-side-kicker">Session Context</span>
                  <span className="command-footnote">{Object.keys(sessionState).length} live keys</span>
                </div>
                <p className="console-copy">
                  {Object.keys(sessionState).length > 0
                    ? JSON.stringify(sessionState, null, 2)
                    : "Short-term session state is empty."}
                </p>
              </section>
            </div>
          </aside>
        ) : null}

        <section className="command-center-main">
          <div className="command-scroll assistant-main-scroll">
            <section className="assistant-hero glass">
              <div className="assistant-hero-copy">
                <div className="assistant-hero-meta">
                  <span className="assistant-hero-kicker">{conversationTitle}</span>
                  <span className="assistant-hero-separator">/</span>
                  <span>{showcasePlanner}</span>
                  <span className="assistant-hero-separator">/</span>
                  <span>{showcaseDate}</span>
                </div>
                <h1>Turn the whole day into one brief and one next move.</h1>
                <p>
                  Keep the thread as the main room. Speak or type, let the answer arrive as a composed briefing,
                  and use the side panes as supporting shelves instead of the primary stage.
                </p>
              </div>
              <div className="assistant-hero-actions">
                <button
                  className={recording ? "assistant-voice-button recording" : "assistant-voice-button"}
                  type="button"
                  onPointerDown={beginHoldToTalk}
                  onPointerUp={endHoldToTalk}
                  onPointerLeave={endHoldToTalk}
                  onPointerCancel={endHoldToTalk}
                  disabled={!browserSupportsRecording}
                >
                  <span className="assistant-voice-button-label">
                    {recording ? "Release to capture" : voiceBlob ? "Voice captured" : "Hold to talk"}
                  </span>
                  <span className="assistant-voice-button-meta">
                    {browserSupportsRecording ? "local mic capture" : "browser capture unavailable"}
                  </span>
                </button>
                <div className="assistant-hero-button-row">
                  <button className="button" type="button" onClick={() => runCommand(false)}>
                    Plan flow
                  </button>
                  <button className="button" type="button" onClick={() => runCommand(true)}>
                    Execute flow
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
              </div>
              <div className="assistant-hero-stats">
                <div className="assistant-stat-pill">
                  <span>Today</span>
                  <strong>{isOnline ? "Thread in sync" : "Offline cache"}</strong>
                </div>
                <div className="assistant-stat-pill">
                  <span>Voice queue</span>
                  <strong>{voiceUploadQueue.length} staged</strong>
                </div>
                <div className="assistant-stat-pill">
                  <span>Planner jobs</span>
                  <strong>{assistJobs.length} pending</strong>
                </div>
              </div>
            </section>

            <PaneRestoreStrip
              actions={[
                ...(queuePane.collapsed ? [{ id: "queue", label: "Show thread activity", onClick: queuePane.expand }] : []),
                ...(agentPane.collapsed ? [{ id: "agent", label: "Show voice and jobs", onClick: agentPane.expand }] : []),
              ]}
            />

            <section className="assistant-thread-panel glass">
              <div className="assistant-thread-head">
                <div>
                  <span className="assistant-side-kicker">Salon Transcript</span>
                  <h2>Persistent conversation, arranged for rereading</h2>
                </div>
                <div className="assistant-thread-actions">
                  <button className="button" type="button" onClick={() => setCommand(exampleCommands[0] || FALLBACK_EXAMPLES[0])}>
                    Load sample
                  </button>
                  <button className="button" type="button" onClick={() => resetConversationSession()}>
                    Clear session
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      loadConversation("manual").catch(() => undefined);
                      loadVoiceJobs("manual").catch(() => undefined);
                      loadAssistJobs("manual").catch(() => undefined);
                    }}
                  >
                    Refresh
                  </button>
                </div>
              </div>

              <div className="assistant-thread-feed">
                {transcriptMessages.length === 0 ? (
                  <div className="assistant-empty-thread">
                    <p className="assistant-empty-kicker">No messages yet</p>
                    <h3>Begin with a spoken request or a typed instruction</h3>
                    <p>
                      The thread will hold the composed answer, the next action, and the supporting context without
                      turning the main room into a dashboard.
                    </p>
                    <ul className="command-story-list">
                      {showcaseActions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  transcriptMessages.map((message) => {
                    const assistantCommand = message.metadata?.assistant_command;
                    const fallbackBody = assistantCommand?.summary || "No message content recorded.";
                    const body = message.content.trim() || fallbackBody;
                    return (
                      <article key={message.id} className={`assistant-thread-message role-${message.role}`}>
                        <div className="assistant-thread-message-meta">
                          <span className="assistant-role-chip">{message.role}</span>
                          <span>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="assistant-thread-bubble">
                          <p>{body}</p>
                          {assistantCommand ? (
                            <div className="assistant-inline-card">
                              <div className="assistant-inline-card-head">
                                <span>{assistantCommand.matched_intent}</span>
                                <span>{assistantCommand.status}</span>
                              </div>
                              <p>{assistantCommand.summary}</p>
                              <div className="assistant-inline-card-steps">
                                {assistantCommand.steps.slice(0, 3).map((step, index) => (
                                  <div key={`${assistantCommand.command}-${step.tool_name}-${index}`} className="assistant-inline-step">
                                    <strong>{step.tool_name}</strong>
                                    <span>{step.status}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="button-row">
                                <button className="button" type="button" onClick={() => setCommand(assistantCommand.command)}>
                                  Reuse command
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            <section className="assistant-composer glass">
              <div className="assistant-composer-head">
                <div>
                  <span className="assistant-side-kicker">Composer</span>
                  <h2>Compose the next move</h2>
                </div>
                <p className="command-footnote">Voice leads. Buttons remain backup controls.</p>
              </div>
              <label className="label" htmlFor="assistant-command">Command</label>
              <textarea
                id="assistant-command"
                className="textarea"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                rows={4}
                placeholder="Ask Starlog to distill what matters, create a note, make cards, prepare a briefing, or set up the next task."
              />
              <div className="assistant-toolbar">
                <button className="button" type="button" onClick={() => runCommand(false)}>Plan</button>
                <button className="button" type="button" onClick={() => runCommand(true)}>Execute</button>
                <button className="button" type="button" onClick={() => queueAssistCommand(false)}>Queue planner</button>
                <button className="button" type="button" onClick={() => queueAssistCommand(true)}>Queue execute</button>
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
              ) : (
                <p className="command-footnote">
                  Hold the mic button above, release to stage the clip, then choose whether to plan or execute it.
                </p>
              )}
              <p className="status">{status}</p>
            </section>
          </div>
        </section>

        {!agentPane.collapsed ? (
          <aside className="command-agent-panel assistant-side-column">
            <div className="command-agent-head">
              <div className="command-agent-tabs">
                <div className="command-agent-tab active">Voice</div>
                <div className="command-agent-tab">Jobs</div>
              </div>
              <PaneToggleButton label="Hide pane" onClick={agentPane.collapse} />
            </div>
            <div className="command-agent-body">
              <div className="command-agent-scroll assistant-side-stack">
                <section className="assistant-side-card glass">
                  <div className="assistant-side-card-head">
                    <span className="assistant-side-kicker">Voice State</span>
                    <span className="command-footnote">{recording ? "recording" : voiceBlob ? "ready" : "idle"}</span>
                  </div>
                  <p className="console-copy">Upload queue: {voiceUploadQueue.length} {isOnline ? "(online)" : "(offline)"}</p>
                  <p className="console-copy">Speech playback: {speakingReply ? "speaking" : "idle"}</p>
                  <div className="button-row">
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        replayVoiceUploadQueue("manual").catch(() => undefined);
                      }}
                      disabled={voiceUploadQueue.length === 0 || voiceQueueReplayInFlight}
                    >
                      {voiceQueueReplayInFlight ? "Replaying..." : "Replay queued voice"}
                    </button>
                  </div>
                </section>

                <details className="command-agent-detail" open>
                  <summary>Queued voice uploads ({voiceUploadQueue.length})</summary>
                  {voiceUploadQueue.length === 0 ? (
                    <p className="console-copy">No queued voice uploads.</p>
                  ) : (
                    <div className="scroll-panel">
                      {voiceUploadQueue.map((item) => (
                        <div key={item.id} className="command-step-card">
                          <p className="console-copy">
                            <strong>{item.id}</strong> [{item.execute ? "execute" : "plan"}] attempts: {item.attempts}
                          </p>
                          <p className="console-copy">
                            captured: {new Date(item.created_at).toLocaleString()}
                            {item.last_attempt_at ? ` | last replay: ${new Date(item.last_attempt_at).toLocaleString()}` : ""}
                          </p>
                          {item.last_error ? <p className="console-copy">last error: {item.last_error}</p> : null}
                          <div className="button-row">
                            <button className="button" type="button" onClick={() => dropQueuedVoiceUpload(item.id)}>
                              Drop upload
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </details>

                <details className="command-agent-detail" open>
                  <summary>Voice jobs ({voiceJobs.length})</summary>
                  {voiceJobs.length === 0 ? (
                    <p className="console-copy">No voice command jobs yet.</p>
                  ) : (
                    <div className="scroll-panel">
                      {voiceJobs.map((job) => (
                        <div key={job.id} className="command-step-card">
                          <p className="console-copy">
                            <strong>{job.id}</strong> [{job.status}] provider: {job.provider_used || job.provider_hint || "pending"}
                          </p>
                          <p className="console-copy">
                            created: {new Date(job.created_at).toLocaleString()}
                            {job.finished_at ? ` | finished: ${new Date(job.finished_at).toLocaleString()}` : ""}
                          </p>
                          {job.output.transcript ? <p className="console-copy">transcript: {job.output.transcript}</p> : null}
                          {job.output.assistant_command ? (
                            <p className="console-copy">
                              command result: {job.output.assistant_command.matched_intent} [{job.output.assistant_command.status}]
                            </p>
                          ) : null}
                          {job.error_text ? <p className="console-copy">error: {job.error_text}</p> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </details>

                <details className="command-agent-detail" open>
                  <summary>Queued planner jobs ({assistJobs.length})</summary>
                  {assistJobs.length === 0 ? (
                    <p className="console-copy">No queued planner jobs yet.</p>
                  ) : (
                    <div className="scroll-panel">
                      {assistJobs.map((job) => (
                        <div key={job.id} className="command-step-card">
                          <p className="console-copy">
                            <strong>{job.id}</strong> [{job.status}] provider: {job.provider_used || job.provider_hint || "pending"}
                          </p>
                          {job.payload.command ? <p className="console-copy">command: {job.payload.command}</p> : null}
                          <p className="console-copy">
                            created: {new Date(job.created_at).toLocaleString()}
                            {job.finished_at ? ` | finished: ${new Date(job.finished_at).toLocaleString()}` : ""}
                          </p>
                          {job.output.assistant_command ? (
                            <p className="console-copy">
                              command result: {job.output.assistant_command.matched_intent} [{job.output.assistant_command.status}]
                            </p>
                          ) : null}
                          {job.error_text ? <p className="console-copy">error: {job.error_text}</p> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              </div>
            </div>
          </aside>
        ) : null}
      </section>
    </main>
  );
}
