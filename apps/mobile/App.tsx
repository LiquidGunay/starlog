import { StatusBar } from "expo-status-bar";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as Notifications from "expo-notifications";
import { useShareIntent } from "expo-share-intent";
import * as Speech from "expo-speech";
import * as SQLite from "expo-sqlite";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";

import { probeLocalSttAvailability, recognizeSpeechOnce } from "./local-stt";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Palette = {
  bg: string;
  bgAlt: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
};

type BriefingPayload = {
  id: string;
  date: string;
  text: string;
  audioRef?: string | null;
  audioPath?: string | null;
};

type PendingTextCapture = {
  id: string;
  kind: "text";
  title: string;
  text: string;
  sourceUrl: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

type PendingFileCapture = {
  id: string;
  kind: "file";
  title: string;
  sourceUrl: string;
  createdAt: string;
  attempts: number;
  localUri: string;
  mimeType: string;
  fileName: string;
  bytesSize: number | null;
  noteText: string;
  lastError?: string;
};

type PendingVoiceCapture = {
  id: string;
  kind: "voice";
  title: string;
  sourceUrl: string;
  createdAt: string;
  attempts: number;
  localUri: string;
  mimeType: string;
  durationMs: number;
  lastError?: string;
};

type PendingCapture = PendingTextCapture | PendingFileCapture | PendingVoiceCapture;

type SharedFileDraft = {
  localUri: string;
  mimeType: string;
  fileName: string;
  bytesSize: number | null;
};

type PersistedState = {
  version: 3;
  apiBase: string;
  pwaBase: string;
  token: string;
  quickCaptureTitle: string;
  quickCaptureText: string;
  quickCaptureSourceUrl: string;
  sharedFileDrafts?: SharedFileDraft[];
  voiceClipUri?: string | null;
  voiceClipDurationMs?: number;
  briefingDate: string;
  cachedPath: string | null;
  alarmHour: number;
  alarmMinute: number;
  alarmNotificationId: string | null;
  pendingCaptures: PendingCapture[];
  artifacts: ArtifactListItem[];
  selectedArtifactId: string;
  artifactGraph: ArtifactGraph | null;
  artifactVersions: ArtifactVersions | null;
  dueCards: DueCard[];
  executionPolicy: ExecutionPolicy;
  assistantCommand?: string;
  assistantHistory?: AssistantCommandResponse[];
  assistantVoiceJobs?: AssistantVoiceJob[];
  assistantAiJobs?: AssistantQueuedJob[];
};

type PersistedStateV2 = Omit<
  PersistedState,
  "version" | "executionPolicy"
> & {
  version: 2;
};

type LegacyPersistedState = Omit<
  PersistedStateV2,
  "version" | "artifacts" | "selectedArtifactId" | "artifactGraph" | "artifactVersions" | "dueCards"
> & {
  version: 1;
};

type DueCard = {
  id: string;
  card_type: string;
  prompt: string;
  answer: string;
  due_at: string;
};

type ArtifactListItem = {
  id: string;
  source_type: string;
  title?: string;
  created_at: string;
};

type ArtifactAction = "summarize" | "cards" | "tasks" | "append_note";

type ArtifactGraph = {
  artifact: {
    id: string;
    source_type: string;
    title?: string;
    raw_content?: string | null;
    normalized_content?: string | null;
    extracted_content?: string | null;
  };
  summaries: Array<{ id: string; version: number; content: string; created_at: string }>;
  cards: Array<{ id: string; prompt: string; answer: string; card_type: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  notes: Array<{ id: string; title: string; body_md: string; version: number }>;
  relations: Array<{ id: string; relation_type: string; target_type: string; target_id: string }>;
};

type ArtifactVersions = {
  artifact_id: string;
  summaries: Array<{ id: string; version: number; created_at: string }>;
  card_sets: Array<{ id: string; version: number; created_at: string }>;
  actions: Array<{ id: string; action: string; status: string; output_ref?: string | null; created_at: string }>;
};

type ExecutionTarget = "on_device" | "server_local" | "batch_local_bridge" | "codex_bridge" | "api_fallback";
type ExecutionPolicyFamily = "llm" | "stt" | "tts" | "ocr";

type ExecutionPolicy = {
  version: number;
  llm: ExecutionTarget[];
  stt: ExecutionTarget[];
  tts: ExecutionTarget[];
  ocr: ExecutionTarget[];
  available_targets?: Partial<Record<ExecutionPolicyFamily, ExecutionTarget[]>>;
  updated_at?: string | null;
};

type ExecutionResolution = {
  requested: ExecutionTarget | "none";
  active: ExecutionTarget | "none";
  reason?: string;
};

type AssistantCommandStep = {
  tool_name: string;
  arguments: Record<string, unknown>;
  status: "planned" | "ok" | "dry_run" | "failed";
  message?: string | null;
  result: unknown;
};

type AssistantCommandResponse = {
  command: string;
  planner: string;
  matched_intent: string;
  status: "planned" | "executed" | "failed";
  summary: string;
  steps: AssistantCommandStep[];
};

type AssistantQueuedJob = {
  id: string;
  capability: "stt" | "llm_agent_plan";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  provider_hint?: string | null;
  provider_used?: string | null;
  action?: string | null;
  payload: Record<string, unknown> & {
    command?: string;
    title?: string;
  };
  output: {
    transcript?: string;
    assistant_command?: AssistantCommandResponse;
  };
  error_text?: string | null;
  created_at: string;
  finished_at?: string | null;
};

type AssistantVoiceJob = AssistantQueuedJob;

const DEFAULT_API_BASE = "http://localhost:8000";
const DEFAULT_PWA_BASE = "http://localhost:3000";
const DEFAULT_CAPTURE_TITLE = "Mobile capture";
const DEFAULT_VOICE_MIME = "audio/x-m4a";
const DEFAULT_FILE_MIME = "application/octet-stream";
const MOBILE_DB_NAME = "starlog-mobile.db";
const MOBILE_STATE_KEY = "state_v2";
const DEFAULT_EXECUTION_TARGETS: Record<ExecutionPolicyFamily, ExecutionTarget[]> = {
  llm: ["on_device", "batch_local_bridge", "server_local", "codex_bridge", "api_fallback"],
  stt: ["on_device", "batch_local_bridge", "server_local", "api_fallback"],
  tts: ["on_device", "server_local", "api_fallback"],
  ocr: ["on_device"],
};
const BATCH_PROVIDER_HINT: Partial<Record<ExecutionPolicyFamily, string>> = {
  llm: "codex_local",
  stt: "whisper_local",
  tts: "piper_local",
};

function supportedSttTargets(localSttAvailable: boolean): ExecutionTarget[] {
  return localSttAvailable ? ["on_device", "batch_local_bridge"] : ["batch_local_bridge"];
}

function sttFallbackReason(localSttAvailable: boolean): string {
  if (localSttAvailable) {
    return "Mobile is using the next executable target from the shared policy.";
  }
  return "On-device STT is unavailable on this phone right now, so Starlog falls back to the queued Whisper bridge.";
}

function localSttProbeLabel(localSttAvailable: boolean): string {
  if (Platform.OS !== "android") {
    return "On-device STT is Android-only in the native companion.";
  }
  return localSttAvailable
    ? "Android speech recognition is available on this device."
    : "Android speech recognition is unavailable or not yet authorized on this device.";
}

const artifactQuickActions: Array<{ label: string; action: ArtifactAction }> = [
  { label: "Summarize", action: "summarize" },
  { label: "Create Cards", action: "cards" },
  { label: "Generate Tasks", action: "tasks" },
  { label: "Append Note", action: "append_note" },
];
const assistantExampleCommands = [
  "summarize latest artifact",
  "create task Review latest summary due tomorrow priority 4",
  "search for spaced repetition",
];

let stateDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function usePalette(): Palette {
  const scheme = useColorScheme();
  return useMemo(() => {
    if (scheme === "light") {
      return {
        bg: "#eaf1ff",
        bgAlt: "#dbe8ff",
        panel: "rgba(255,255,255,0.82)",
        border: "rgba(61,88,160,0.25)",
        text: "#102340",
        muted: "#4a5e87",
        accent: "#355ebb",
      };
    }
    return {
      bg: "#070c1b",
      bgAlt: "#101a33",
      panel: "rgba(18,26,53,0.75)",
      border: "rgba(126,168,255,0.28)",
      text: "#e9f1ff",
      muted: "#9fb4d7",
      accent: "#7ca6ff",
    };
  }, [scheme]);
}

function writableDir(): string {
  const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error("No writable directory available");
  }
  return dir;
}

function stateFilePath(): string {
  return `${writableDir()}mobile-state-v1.json`;
}

function sharedCaptureDir(): string {
  return `${writableDir()}shared-intents/`;
}

function safeSharedFileName(fileName: string, fallbackName: string): string {
  const normalized = (fileName || fallbackName)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-");
  return normalized || fallbackName;
}

async function materializeSharedFileDrafts(drafts: SharedFileDraft[]): Promise<SharedFileDraft[]> {
  if (drafts.length === 0) {
    return [];
  }

  const targetDir = sharedCaptureDir();
  await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true }).catch(() => undefined);
  const timestamp = Date.now();

  return Promise.all(
    drafts.map(async (draft, index) => {
      const fallbackName = `shared-file-${index + 1}`;
      const fileName = safeSharedFileName(draft.fileName, fallbackName);
      const targetUri = `${targetDir}${timestamp}-${index}-${fileName}`;
      try {
        await FileSystem.copyAsync({
          from: draft.localUri,
          to: targetUri,
        });
        return {
          ...draft,
          localUri: targetUri,
          fileName,
        };
      } catch {
        return {
          ...draft,
          fileName,
        };
      }
    }),
  );
}

async function stateDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!stateDbPromise) {
    stateDbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(MOBILE_DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return stateDbPromise;
}

function tomorrowDateString(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function captureLabel(kind: PendingCapture["kind"]): string {
  if (kind === "voice") {
    return "Voice note";
  }
  if (kind === "file") {
    return "Shared file";
  }
  return "Capture";
}

function captureSourceTypeForMime(mimeType: string): string {
  if (mimeType.startsWith("image/")) {
    return "clip_mobile_image";
  }
  if (mimeType.startsWith("video/")) {
    return "clip_mobile_video";
  }
  return "clip_mobile_file";
}

function describeSharedFile(fileName: string, mimeType: string, bytesSize: number | null): string {
  const sizeLabel = bytesSize && bytesSize > 0 ? `, ${Math.round(bytesSize / 1024)} KB` : "";
  return `${fileName} (${mimeType}${sizeLabel})`;
}

function describeSharedDrafts(drafts: SharedFileDraft[]): string {
  if (drafts.length === 0) {
    return "none";
  }
  if (drafts.length === 1) {
    return describeSharedFile(drafts[0].fileName, drafts[0].mimeType, drafts[0].bytesSize);
  }
  return `${drafts.length} files ready`;
}

function defaultExecutionPolicy(): ExecutionPolicy {
  return {
    version: 1,
    llm: [...DEFAULT_EXECUTION_TARGETS.llm],
    stt: [...DEFAULT_EXECUTION_TARGETS.stt],
    tts: [...DEFAULT_EXECUTION_TARGETS.tts],
    ocr: [...DEFAULT_EXECUTION_TARGETS.ocr],
    available_targets: {
      llm: [...DEFAULT_EXECUTION_TARGETS.llm],
      stt: [...DEFAULT_EXECUTION_TARGETS.stt],
      tts: [...DEFAULT_EXECUTION_TARGETS.tts],
      ocr: [...DEFAULT_EXECUTION_TARGETS.ocr],
    },
    updated_at: null,
  };
}

function policyOrder(policy: ExecutionPolicy, family: ExecutionPolicyFamily): ExecutionTarget[] {
  return policy[family].length > 0 ? policy[family] : DEFAULT_EXECUTION_TARGETS[family];
}

function resolveExecutionTarget(
  policy: ExecutionPolicy,
  family: ExecutionPolicyFamily,
  executableTargets: ExecutionTarget[],
  fallbackTarget?: ExecutionTarget,
  fallbackReason?: string,
): ExecutionResolution {
  const requestedOrder = policyOrder(policy, family);
  const requested = requestedOrder[0] ?? "none";
  const active = requestedOrder.find((target) => executableTargets.includes(target)) ?? fallbackTarget ?? "none";
  if (active === "none") {
    return {
      requested,
      active,
      reason: fallbackReason ?? "No executable mobile route is available for this capability yet.",
    };
  }
  if (requested !== active) {
    return {
      requested,
      active,
      reason: fallbackReason ?? "Mobile is using the next executable target from the shared policy.",
    };
  }
  return { requested, active };
}

function formatExecutionTarget(target: ExecutionTarget | "none"): string {
  if (target === "on_device") {
    return "On device";
  }
  if (target === "server_local") {
    return "Server local";
  }
  if (target === "batch_local_bridge") {
    return "Batch local bridge";
  }
  if (target === "codex_bridge") {
    return "Codex bridge";
  }
  if (target === "api_fallback") {
    return "API fallback";
  }
  return "Unavailable";
}

function toHourMinuteLabel(hour: number, minute: number): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${hh}:${mm}`;
}

function boundedInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function readPersistedState(): Promise<PersistedState | null> {
  try {
    const db = await stateDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_state WHERE key = ?",
      MOBILE_STATE_KEY,
    );
    if (row?.value) {
      const parsed = JSON.parse(row.value) as PersistedState | PersistedStateV2;
      if (parsed.version === 2) {
        const migrated: PersistedState = {
          ...parsed,
          version: 3,
          sharedFileDrafts: [],
          voiceClipUri: null,
          voiceClipDurationMs: 0,
          executionPolicy: defaultExecutionPolicy(),
          assistantCommand: "summarize latest artifact",
          assistantHistory: [],
          assistantVoiceJobs: [],
          assistantAiJobs: [],
        };
        await writePersistedState(migrated);
        return migrated;
      }
      if (parsed.version === 3) {
        return {
          sharedFileDrafts: [],
          voiceClipUri: null,
          voiceClipDurationMs: 0,
          assistantCommand: "summarize latest artifact",
          assistantHistory: [],
          assistantVoiceJobs: [],
          assistantAiJobs: [],
          ...parsed,
        };
      }
    }

    const file = stateFilePath();
    const info = await FileSystem.getInfoAsync(file);
    if (!info.exists) {
      return null;
    }
    const raw = await FileSystem.readAsStringAsync(file);
    const legacy = JSON.parse(raw) as LegacyPersistedState;
    if (legacy.version !== 1) {
      return null;
    }

    const migrated: PersistedState = {
      ...legacy,
      version: 3,
      sharedFileDrafts: [],
      voiceClipUri: null,
      voiceClipDurationMs: 0,
      artifacts: [],
      selectedArtifactId: "",
      artifactGraph: null,
      artifactVersions: null,
      dueCards: [],
      executionPolicy: defaultExecutionPolicy(),
      assistantCommand: "summarize latest artifact",
      assistantHistory: [],
      assistantVoiceJobs: [],
      assistantAiJobs: [],
    };
    await writePersistedState(migrated);
    await FileSystem.deleteAsync(file, { idempotent: true });
    return migrated;
  } catch {
    return null;
  }
}

async function writePersistedState(payload: PersistedState): Promise<void> {
  const db = await stateDatabase();
  await db.runAsync(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    MOBILE_STATE_KEY,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
}

async function loadBriefingFromApi(
  apiBase: string,
  token: string,
  date: string,
): Promise<BriefingPayload> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const existing = await fetch(`${apiBase}/v1/briefings/${date}`, { headers });
  if (existing.ok) {
    const payload = (await existing.json()) as { id: string; text: string; audio_ref?: string | null };
    return { id: payload.id, date, text: payload.text, audioRef: payload.audio_ref ?? null, audioPath: null };
  }

  const generated = await fetch(`${apiBase}/v1/briefings/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ date, provider: "mobile-template" }),
  });

  if (!generated.ok) {
    const errorBody = await generated.text();
    throw new Error(`Briefing fetch failed: ${generated.status} ${errorBody}`);
  }

  const payload = (await generated.json()) as { id: string; text: string; audio_ref?: string | null };
  return { id: payload.id, date, text: payload.text, audioRef: payload.audio_ref ?? null, audioPath: null };
}

async function maybeCacheBriefingAudio(
  apiBase: string,
  token: string,
  payload: BriefingPayload,
): Promise<string | null> {
  if (!payload.audioRef?.startsWith("media://")) {
    return null;
  }

  const mediaId = payload.audioRef.slice("media://".length);
  const targetPath = `${writableDir()}briefing-${payload.date}.wav`;
  try {
    await FileSystem.downloadAsync(
      `${apiBase}/v1/media/${mediaId}/content`,
      targetPath,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    return targetPath;
  } catch {
    return null;
  }
}

async function cacheBriefing(apiBase: string, token: string, payload: BriefingPayload): Promise<string> {
  const audioPath = await maybeCacheBriefingAudio(apiBase, token, payload);
  const path = `${writableDir()}briefing-${payload.date}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify({ ...payload, audioPath }));
  return path;
}

async function readCachedBriefing(path: string): Promise<BriefingPayload> {
  const text = await FileSystem.readAsStringAsync(path);
  return JSON.parse(text) as BriefingPayload;
}

function parseCaptureDeepLink(rawUrl: string): { title: string; text: string; sourceUrl: string } | null {
  if (!rawUrl.startsWith("starlog://capture")) {
    return null;
  }
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex < 0) {
    return null;
  }

  const params = new URLSearchParams(rawUrl.slice(queryIndex + 1));
  const text = (params.get("text") ?? params.get("content") ?? "").trim();
  if (!text) {
    return null;
  }

  return {
    title: (params.get("title") ?? DEFAULT_CAPTURE_TITLE).trim() || DEFAULT_CAPTURE_TITLE,
    text,
    sourceUrl: (params.get("source_url") ?? params.get("url") ?? "").trim(),
  };
}

export default function App() {
  const palette = usePalette();
  const styles = useMemo(() => themedStyles(palette), [palette]);
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [pwaBase, setPwaBase] = useState(DEFAULT_PWA_BASE);
  const [token, setToken] = useState("");
  const [quickCaptureTitle, setQuickCaptureTitle] = useState(DEFAULT_CAPTURE_TITLE);
  const [quickCaptureText, setQuickCaptureText] = useState("");
  const [quickCaptureSourceUrl, setQuickCaptureSourceUrl] = useState("");
  const [sharedFileDrafts, setSharedFileDrafts] = useState<SharedFileDraft[]>([]);
  const [voiceRecording, setVoiceRecording] = useState<Audio.Recording | null>(null);
  const [voiceClipUri, setVoiceClipUri] = useState<string | null>(null);
  const [voiceClipDurationMs, setVoiceClipDurationMs] = useState(0);
  const [localSttAvailable, setLocalSttAvailable] = useState(false);
  const [localSttListening, setLocalSttListening] = useState(false);
  const [briefingDate, setBriefingDate] = useState(tomorrowDateString());
  const [cachedPath, setCachedPath] = useState<string | null>(null);
  const [alarmHour, setAlarmHour] = useState(7);
  const [alarmMinute, setAlarmMinute] = useState(0);
  const [alarmNotificationId, setAlarmNotificationId] = useState<string | null>(null);
  const [pendingCaptures, setPendingCaptures] = useState<PendingCapture[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactListItem[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [artifactGraph, setArtifactGraph] = useState<ArtifactGraph | null>(null);
  const [artifactVersions, setArtifactVersions] = useState<ArtifactVersions | null>(null);
  const [artifactDetailStatus, setArtifactDetailStatus] = useState("Artifact detail idle");
  const [dueCards, setDueCards] = useState<DueCard[]>([]);
  const [executionPolicy, setExecutionPolicy] = useState<ExecutionPolicy>(() => defaultExecutionPolicy());
  const [assistantCommand, setAssistantCommand] = useState("summarize latest artifact");
  const [assistantHistory, setAssistantHistory] = useState<AssistantCommandResponse[]>([]);
  const [assistantVoiceJobs, setAssistantVoiceJobs] = useState<AssistantVoiceJob[]>([]);
  const [assistantAiJobs, setAssistantAiJobs] = useState<AssistantQueuedJob[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState("unknown");
  const [status, setStatus] = useState("Ready");
  const [hydrated, setHydrated] = useState(false);
  const flushInFlight = useRef(false);
  const cardPromptStartedAt = useRef<number | null>(null);
  const briefingSoundRef = useRef<Audio.Sound | null>(null);
  const {
    hasShareIntent,
    shareIntent,
    resetShareIntent,
    error: shareIntentError,
  } = useShareIntent({
    disabled: Platform.OS !== "android",
    resetOnBackground: false,
  });
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;
  const sttTargets = useMemo(() => supportedSttTargets(localSttAvailable), [localSttAvailable]);
  const llmResolution = useMemo(
    () =>
      resolveExecutionTarget(
        executionPolicy,
        "llm",
        ["batch_local_bridge", "server_local", "codex_bridge", "api_fallback"],
        "batch_local_bridge",
        "On-device LLM is not implemented in the mobile client yet, so Starlog uses the next executable target.",
      ),
    [executionPolicy],
  );
  const sttResolution = useMemo(
    () =>
      resolveExecutionTarget(
        executionPolicy,
        "stt",
        sttTargets,
        sttTargets[0] ?? "batch_local_bridge",
        sttFallbackReason(localSttAvailable),
      ),
    [executionPolicy, localSttAvailable, sttTargets],
  );
  const ttsResolution = useMemo(
    () =>
      resolveExecutionTarget(
        executionPolicy,
        "tts",
        ["on_device"],
        "on_device",
        "Mobile speech playback currently stays on-device.",
      ),
    [executionPolicy],
  );

  async function refreshLocalSttAvailability(origin: "auto" | "manual") {
    const available = await probeLocalSttAvailability();
    setLocalSttAvailable(available);
    if (origin === "manual") {
      setStatus(localSttProbeLabel(available));
    }
    return available;
  }

  async function loadExecutionPolicy(origin: "auto" | "manual") {
    if (!token) {
      if (origin === "manual") {
        setStatus("Add API token first");
      }
      return;
    }

    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/integrations/execution-policy`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Execution policy fetch failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as ExecutionPolicy;
      setExecutionPolicy(payload);
      if (origin === "manual") {
        const policySttTargets = supportedSttTargets(localSttAvailable);
        setStatus(
          `Loaded execution policy: LLM ${formatExecutionTarget(
            resolveExecutionTarget(
              payload,
              "llm",
              ["batch_local_bridge", "server_local", "codex_bridge", "api_fallback"],
              "batch_local_bridge",
            ).active,
          )}, STT ${formatExecutionTarget(
            resolveExecutionTarget(
              payload,
              "stt",
              policySttTargets,
              policySttTargets[0] ?? "batch_local_bridge",
              sttFallbackReason(localSttAvailable),
            ).active,
          )}`,
        );
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load execution policy");
      }
    }
  }

  async function sendCapture(item: PendingCapture): Promise<string> {
    if (item.kind === "voice") {
      const providerHint = BATCH_PROVIDER_HINT.stt ?? "whisper_local";
      const formData = new FormData();
      formData.append("title", item.title);
      if (item.sourceUrl) {
        formData.append("source_url", item.sourceUrl);
      }
      formData.append("duration_ms", String(item.durationMs));
      formData.append("provider_hint", providerHint);
      formData.append(
        "file",
        {
          uri: item.localUri,
          name: `${item.id}.m4a`,
          type: item.mimeType,
        } as unknown as Blob,
      );

      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/capture/voice`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Voice capture failed: ${response.status} ${errorBody}`);
      }

      const payload = (await response.json()) as { artifact: { id: string }; job_id: string };
      const routeNote =
        sttResolution.requested !== sttResolution.active
          ? ` (requested ${formatExecutionTarget(sttResolution.requested)}; using ${formatExecutionTarget(sttResolution.active)})`
          : "";
      setStatus(`Queued voice transcript job ${payload.job_id} via ${formatExecutionTarget(sttResolution.active)}${routeNote}`);
      return payload.artifact.id;
    }

    if (item.kind === "file") {
      const formData = new FormData();
      formData.append(
        "file",
        {
          uri: item.localUri,
          name: item.fileName,
          type: item.mimeType,
        } as unknown as Blob,
      );

      const uploadResponse = await fetch(`${normalizeBaseUrl(apiBase)}/v1/media/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text();
        throw new Error(`Shared file upload failed: ${uploadResponse.status} ${errorBody}`);
      }

      const uploaded = (await uploadResponse.json()) as {
        id: string;
        blob_ref: string;
        checksum_sha256: string;
        content_type?: string | null;
        content_url: string;
      };
      const noteText = item.noteText.trim();
      const fallbackText = noteText || `Shared file: ${describeSharedFile(item.fileName, item.mimeType, item.bytesSize)}`;

      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          source_type: captureSourceTypeForMime(item.mimeType),
          capture_source: "mobile_share",
          title: item.title,
          source_url: item.sourceUrl || undefined,
          raw: {
            blob_ref: uploaded.blob_ref,
            mime_type: uploaded.content_type ?? item.mimeType,
            checksum_sha256: uploaded.checksum_sha256,
          },
          normalized: { text: fallbackText, mime_type: "text/plain" },
          extracted: noteText ? { text: noteText, mime_type: "text/plain" } : undefined,
          metadata: {
            source: "mobile_share",
            captured_at: item.createdAt,
            queued_capture_id: item.id,
            attempts: item.attempts,
            shared_file: {
              media_id: uploaded.id,
              content_url: uploaded.content_url,
              file_name: item.fileName,
              mime_type: item.mimeType,
              bytes_size: item.bytesSize,
            },
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Shared file capture failed: ${response.status} ${errorBody}`);
      }

      const payload = (await response.json()) as { artifact: { id: string } };
      return payload.artifact.id;
    }

    const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        source_type: "clip_mobile",
        capture_source: "mobile_companion",
        title: item.title,
        source_url: item.sourceUrl || undefined,
        raw: { text: item.text, mime_type: "text/plain" },
        normalized: { text: item.text, mime_type: "text/plain" },
        extracted: { text: item.text, mime_type: "text/plain" },
        metadata: {
          source: "mobile_app",
          captured_at: item.createdAt,
          queued_capture_id: item.id,
          attempts: item.attempts,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Capture failed: ${response.status} ${errorBody}`);
    }

    const payload = (await response.json()) as { artifact: { id: string } };
    return payload.artifact.id;
  }

  async function loadArtifacts() {
    try {
      if (!token) {
        setStatus("Add API token first");
        return;
      }
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/artifacts`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Artifact inbox fetch failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as ArtifactListItem[];
      setArtifacts(payload);
      if (payload.length === 0) {
        setSelectedArtifactId("");
        setArtifactGraph(null);
        setArtifactVersions(null);
        setArtifactDetailStatus("No artifact selected");
      } else if (!selectedArtifactId || !payload.some((artifact) => artifact.id === selectedArtifactId)) {
        setSelectedArtifactId(payload[0].id);
      }
      setStatus(`Loaded ${payload.length} artifact(s) for triage`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load artifacts");
    }
  }

  async function loadArtifactDetail(artifactId: string) {
    try {
      if (!token) {
        setArtifactGraph(null);
        setArtifactVersions(null);
        setArtifactDetailStatus("Add API token first");
        return;
      }

      const [graphResponse, versionsResponse] = await Promise.all([
        fetch(`${normalizeBaseUrl(apiBase)}/v1/artifacts/${artifactId}/graph`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${normalizeBaseUrl(apiBase)}/v1/artifacts/${artifactId}/versions`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!graphResponse.ok) {
        const errorBody = await graphResponse.text();
        throw new Error(`Artifact graph fetch failed: ${graphResponse.status} ${errorBody}`);
      }
      if (!versionsResponse.ok) {
        const errorBody = await versionsResponse.text();
        throw new Error(`Artifact versions fetch failed: ${versionsResponse.status} ${errorBody}`);
      }

      const graphPayload = (await graphResponse.json()) as ArtifactGraph;
      const versionsPayload = (await versionsResponse.json()) as ArtifactVersions;
      setArtifactGraph(graphPayload);
      setArtifactVersions(versionsPayload);
      setArtifactDetailStatus(
        `Loaded artifact detail: ${graphPayload.summaries.length} summaries, ${graphPayload.cards.length} cards`,
      );
    } catch (error) {
      setArtifactGraph(null);
      setArtifactVersions(null);
      setArtifactDetailStatus(error instanceof Error ? error.message : "Failed to load artifact detail");
    }
  }

  async function runArtifactAction(action: ArtifactAction) {
    if (!selectedArtifactId) {
      setStatus("Load artifacts and select one first");
      return;
    }
    if (!token) {
      setStatus("Add API token first");
      return;
    }

    try {
      const shouldDefer = action !== "append_note" && llmResolution.active === "batch_local_bridge";
      const providerHint = shouldDefer ? BATCH_PROVIDER_HINT.llm : undefined;
      const response = await fetch(
        `${normalizeBaseUrl(apiBase)}/v1/artifacts/${selectedArtifactId}/actions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action,
            defer: shouldDefer,
            provider_hint: providerHint,
          }),
        },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Artifact action failed: ${response.status} ${errorBody}`);
      }
      await loadArtifactDetail(selectedArtifactId);
      if (shouldDefer) {
        setStatus(`Queued ${action} for ${selectedArtifactId} via ${formatExecutionTarget(llmResolution.active)}`);
      } else if (action === "append_note") {
        setStatus(`Requested ${action} for ${selectedArtifactId}`);
      } else {
        const routeNote =
          llmResolution.requested !== llmResolution.active
            ? ` (requested ${formatExecutionTarget(llmResolution.requested)})`
            : "";
        setStatus(`Requested ${action} for ${selectedArtifactId} via ${formatExecutionTarget(llmResolution.active)}${routeNote}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Artifact action failed");
    }
  }

  function speakSelectedArtifact() {
    const latestSummary = artifactGraph?.summaries[0]?.content?.trim();
    const fallback = artifactGraph?.artifact.normalized_content?.trim() || artifactGraph?.artifact.extracted_content?.trim();
    const text = latestSummary || fallback;
    if (!text) {
      setStatus("No selected artifact text is available for local speech");
      return;
    }
    Speech.stop();
    Speech.speak(text);
    const routeNote =
      ttsResolution.requested !== ttsResolution.active ? ` (requested ${formatExecutionTarget(ttsResolution.requested)})` : "";
    setStatus(`Speaking selected artifact via ${formatExecutionTarget(ttsResolution.active)}${routeNote}`);
  }

  async function openSelectedArtifactInPwa() {
    if (!selectedArtifactId) {
      await openPwa();
      return;
    }
    try {
      await Linking.openURL(
        `${normalizeBaseUrl(pwaBase)}/artifacts?artifact=${encodeURIComponent(selectedArtifactId)}`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open artifact in PWA");
    }
  }

  async function openNoteInPwa(noteId: string) {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}/notes?note=${encodeURIComponent(noteId)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open note in PWA");
    }
  }

  async function openTaskInPwa(taskId: string) {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}/tasks?task=${encodeURIComponent(taskId)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open task in PWA");
    }
  }

  async function flushPendingCaptures(origin: "auto" | "manual") {
    if (flushInFlight.current) {
      return;
    }
    if (!token) {
      if (origin === "manual") {
        setStatus("Add API token first");
      }
      return;
    }
    if (pendingCaptures.length === 0) {
      if (origin === "manual") {
        setStatus("No pending captures to flush");
      }
      return;
    }

    flushInFlight.current = true;
    let flushed = 0;
    const remaining: PendingCapture[] = [];

    for (const capture of pendingCaptures) {
      try {
        await sendCapture(capture);
        flushed += 1;
      } catch (error) {
        remaining.push({
          ...capture,
          attempts: capture.attempts + 1,
          lastError: error instanceof Error ? error.message : "Unknown capture error",
        });
      }
    }

    setPendingCaptures(remaining);
    if (flushed > 0) {
      loadArtifacts().catch(() => undefined);
    }
    if (remaining.length === 0) {
      setStatus(`Flushed ${flushed} queued capture(s)`);
    } else {
      setStatus(`Flushed ${flushed}; ${remaining.length} queued capture(s) remain`);
    }
    flushInFlight.current = false;
  }

  function queueCapture(item: PendingCapture, reason: string) {
    setPendingCaptures((previous) => [item, ...previous]);
    setStatus(`${captureLabel(item.kind)} queued (${reason}). Pending: ${pendingCaptures.length + 1}`);
  }

  async function submitQuickCapture() {
    const text = quickCaptureText.trim();
    if (!text && sharedFileDrafts.length === 0) {
      setStatus("Enter capture text first");
      return;
    }

    if (sharedFileDrafts.length > 0) {
      const timestamp = Date.now();
      const titleSeed = quickCaptureTitle.trim();
      const captureSourceUrl = quickCaptureSourceUrl.trim();
      const sharedCaptures: PendingFileCapture[] = sharedFileDrafts.map((draft, index) => ({
        id: `mobfile_${timestamp}_${index}`,
        kind: "file",
        title:
          sharedFileDrafts.length > 1
            ? `${titleSeed || DEFAULT_CAPTURE_TITLE} (${index + 1}/${sharedFileDrafts.length})`
            : titleSeed || draft.fileName || DEFAULT_CAPTURE_TITLE,
        sourceUrl: captureSourceUrl,
        createdAt: new Date().toISOString(),
        attempts: 0,
        localUri: draft.localUri,
        mimeType: draft.mimeType,
        fileName: draft.fileName,
        bytesSize: draft.bytesSize,
        noteText: text,
      }));

      if (!token) {
        setPendingCaptures((previous) => [...sharedCaptures, ...previous]);
        setQuickCaptureText("");
        setSharedFileDrafts([]);
        setStatus(`Shared files queued (missing token). Pending: ${pendingCaptures.length + sharedCaptures.length}`);
        return;
      }

      let firstArtifactId = "";
      let successCount = 0;
      const failedCaptures: PendingFileCapture[] = [];

      for (const capture of sharedCaptures) {
        try {
          const artifactId = await sendCapture(capture);
          if (!firstArtifactId) {
            firstArtifactId = artifactId;
          }
          successCount += 1;
        } catch (error) {
          failedCaptures.push({
            ...capture,
            attempts: capture.attempts + 1,
            lastError: error instanceof Error ? error.message : "shared file upload failed",
          });
        }
      }

      setQuickCaptureText("");
      setSharedFileDrafts([]);
      if (failedCaptures.length > 0) {
        setPendingCaptures((previous) => [...failedCaptures, ...previous]);
      }
      if (firstArtifactId) {
        setSelectedArtifactId(firstArtifactId);
        loadArtifacts().catch(() => undefined);
      }
      if (failedCaptures.length === 0) {
        setStatus(
          successCount === 1
            ? `Captured shared file artifact ${firstArtifactId}`
            : `Captured ${successCount} shared file artifacts`,
        );
      } else {
        setStatus(`Captured ${successCount}; queued ${failedCaptures.length} shared file(s) for retry`);
      }
      return;
    }

    const capture: PendingTextCapture = {
      id: `mobcap_${Date.now()}`,
      kind: "text",
      title: quickCaptureTitle.trim() || DEFAULT_CAPTURE_TITLE,
      text,
      sourceUrl: quickCaptureSourceUrl.trim(),
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    if (!token) {
      queueCapture(capture, "missing token");
      setQuickCaptureText("");
      return;
    }

    try {
      const artifactId = await sendCapture(capture);
      setQuickCaptureText("");
      setSelectedArtifactId(artifactId);
      loadArtifacts().catch(() => undefined);
      setStatus(`Captured artifact ${artifactId}`);
    } catch (error) {
      queueCapture(capture, error instanceof Error ? error.message : "request failed");
      setQuickCaptureText("");
    }
  }

  async function startVoiceRecording() {
    if (voiceRecording) {
      setStatus("Voice recording is already in progress");
      return;
    }

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setStatus("Microphone permission denied");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setVoiceRecording(recording);
      setSharedFileDrafts([]);
      setVoiceClipUri(null);
      setVoiceClipDurationMs(0);
      setStatus("Recording voice note...");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to start voice recording");
    }
  }

  async function stopVoiceRecording() {
    if (!voiceRecording) {
      setStatus("No voice recording is in progress");
      return;
    }

    try {
      await voiceRecording.stopAndUnloadAsync();
      const status = await voiceRecording.getStatusAsync();
      const uri = voiceRecording.getURI();
      setVoiceRecording(null);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      if (!uri) {
        throw new Error("Voice recording finished without a file");
      }
      setVoiceClipUri(uri);
      setVoiceClipDurationMs(typeof status.durationMillis === "number" ? status.durationMillis : 0);
      setStatus("Voice note ready to upload or queue");
    } catch (error) {
      setVoiceRecording(null);
      setStatus(error instanceof Error ? error.message : "Failed to stop voice recording");
    }
  }

  async function submitVoiceCapture() {
    if (!voiceClipUri) {
      setStatus("Record a voice note first");
      return;
    }

    const capture: PendingVoiceCapture = {
      id: `mobvoice_${Date.now()}`,
      kind: "voice",
      title: quickCaptureTitle.trim() || "Voice note",
      sourceUrl: quickCaptureSourceUrl.trim(),
      createdAt: new Date().toISOString(),
      attempts: 0,
      localUri: voiceClipUri,
      mimeType: DEFAULT_VOICE_MIME,
      durationMs: voiceClipDurationMs,
    };

    if (!token) {
      queueCapture(capture, "missing token");
      setVoiceClipUri(null);
      setVoiceClipDurationMs(0);
      return;
    }

    try {
      const artifactId = await sendCapture(capture);
      setVoiceClipUri(null);
      setVoiceClipDurationMs(0);
      setSelectedArtifactId(artifactId);
      loadArtifacts().catch(() => undefined);
      setStatus(`Queued voice note ${artifactId} for transcription`);
    } catch (error) {
      queueCapture(capture, error instanceof Error ? error.message : "voice upload failed");
      setVoiceClipUri(null);
      setVoiceClipDurationMs(0);
    }
  }

  async function loadDueCards() {
    try {
      if (!token) {
        setStatus("Add API token first");
        return;
      }
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/cards/due?limit=20`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Due cards fetch failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as DueCard[];
      setDueCards(payload);
      setShowAnswer(false);
      cardPromptStartedAt.current = payload.length > 0 ? Date.now() : null;
      setStatus(`Loaded ${payload.length} due card(s)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load due cards");
    }
  }

  async function submitReview(rating: number) {
    const current = dueCards[0];
    if (!current) {
      setStatus("No due card selected");
      return;
    }
    if (!token) {
      setStatus("Add API token first");
      return;
    }
    const latency = cardPromptStartedAt.current ? Date.now() - cardPromptStartedAt.current : undefined;

    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          card_id: current.id,
          rating,
          latency_ms: typeof latency === "number" ? Math.max(latency, 0) : undefined,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Review submit failed: ${response.status} ${errorBody}`);
      }

      const remaining = dueCards.slice(1);
      setDueCards(remaining);
      setShowAnswer(false);
      cardPromptStartedAt.current = remaining.length > 0 ? Date.now() : null;
      setStatus(`Recorded rating ${rating}. ${remaining.length} due card(s) left`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to submit review");
    }
  }

  async function requestNotificationPermission(): Promise<boolean> {
    const permission = await Notifications.requestPermissionsAsync();
    setNotificationPermission(permission.status);
    if (!permission.granted) {
      setStatus("Notification permission denied");
      return false;
    }
    return true;
  }

  async function playCached() {
    try {
      if (!cachedPath) {
        setStatus("No cached briefing yet");
        return;
      }
      const info = await FileSystem.getInfoAsync(cachedPath);
      if (!info.exists) {
        setStatus("Cached briefing file not found");
        return;
      }
      const briefing = await readCachedBriefing(cachedPath);
      await playBriefingPayload(briefing, "cached");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to play cached briefing");
    }
  }

  async function generateAndCache() {
    try {
      if (!token) {
        setStatus("Add API token first");
        return;
      }
      const baseUrl = normalizeBaseUrl(apiBase);
      const briefing = await loadBriefingFromApi(baseUrl, token, briefingDate);
      const path = await cacheBriefing(baseUrl, token, briefing);
      setCachedPath(path);
      setStatus(
        briefing.audioRef
          ? `Cached briefing package for ${briefingDate} with audio`
          : `Cached briefing for ${briefingDate} (text only)`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to cache briefing");
    }
  }

  async function queueBriefingAudio() {
    try {
      if (!token) {
        setStatus("Add API token first");
        return;
      }
      const baseUrl = normalizeBaseUrl(apiBase);
      const briefing = await loadBriefingFromApi(baseUrl, token, briefingDate);
      if (briefing.audioRef) {
        setStatus("Briefing audio already exists. Cache again to download it locally.");
        return;
      }

      const response = await fetch(`${baseUrl}/v1/briefings/${briefing.id}/audio/render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider_hint: BATCH_PROVIDER_HINT.tts ?? "piper_local",
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Briefing audio queue failed: ${response.status} ${errorBody}`);
      }

      const payload = (await response.json()) as { id: string };
      setStatus(`Queued briefing audio job ${payload.id} via ${formatExecutionTarget(ttsResolution.active)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to queue briefing audio");
    }
  }

  async function scheduleMorningAlarm() {
    try {
      if (!cachedPath) {
        setStatus("Cache briefing before scheduling");
        return;
      }

      const permission = await requestNotificationPermission();
      if (!permission) {
        return;
      }

      if (alarmNotificationId) {
        await Notifications.cancelScheduledNotificationAsync(alarmNotificationId);
      }

      const trigger: Notifications.DailyTriggerInput = {
        hour: boundedInt(alarmHour, 0, 23),
        minute: boundedInt(alarmMinute, 0, 59),
        repeats: true,
      };

      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Starlog Morning Brief",
          body: "Tap to play your cached spoken briefing.",
          data: {
            briefingPath: cachedPath,
            fallbackText: "Briefing cache missing. Open Starlog companion to refresh.",
          },
          ...(Platform.OS === "android" ? { channelId: "starlog-morning" } : {}),
        },
        trigger,
      });

      setAlarmNotificationId(identifier);
      setStatus(`Daily alarm scheduled for ${toHourMinuteLabel(trigger.hour, trigger.minute)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to schedule alarm");
    }
  }

  async function clearMorningAlarm() {
    try {
      if (!alarmNotificationId) {
        setStatus("No morning alarm is scheduled");
        return;
      }
      await Notifications.cancelScheduledNotificationAsync(alarmNotificationId);
      setAlarmNotificationId(null);
      setStatus("Morning alarm cleared");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to clear alarm");
    }
  }

  async function playBriefingPayload(briefing: BriefingPayload, mode: "cached" | "scheduled") {
    try {
      if (briefing.audioPath) {
        const info = await FileSystem.getInfoAsync(briefing.audioPath);
        if (info.exists) {
          if (briefingSoundRef.current) {
            await briefingSoundRef.current.unloadAsync();
            briefingSoundRef.current = null;
          }
          const { sound } = await Audio.Sound.createAsync({ uri: briefing.audioPath }, { shouldPlay: true });
          briefingSoundRef.current = sound;
          setStatus(`${mode === "scheduled" ? "Playing scheduled" : "Playing cached"} briefing audio`);
          return;
        }
      }

      Speech.speak(briefing.text);
      setStatus(`${mode === "scheduled" ? "Playing scheduled" : "Playing cached"} briefing text`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to play briefing");
    }
  }

  async function openPwa() {
    try {
      await Linking.openURL(pwaBase);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open PWA URL");
    }
  }

  async function openIntegrationsInPwa() {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}/integrations`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open integrations in PWA");
    }
  }

  async function openAssistantInPwa() {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}/assistant`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open assistant in PWA");
    }
  }

  async function submitAssistantCommand(command: string, execute: boolean, sourceLabel?: string) {
    if (!command) {
      setStatus("Enter an assistant command first");
      return;
    }
    if (!token) {
      setStatus("Add API token first");
      return;
    }

    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/agent/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          command,
          execute,
          device_target: "mobile-companion",
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Assistant command failed: ${response.status} ${errorBody}`);
      }

      const payload = (await response.json()) as AssistantCommandResponse;
      recordAssistantHistory(payload);
      if (payload.matched_intent === "capture" || ["summarize", "cards", "tasks", "append_note"].includes(payload.matched_intent)) {
        loadArtifacts().catch(() => undefined);
      }
      if (payload.matched_intent === "list_due_cards") {
        loadDueCards().catch(() => undefined);
      }
      const sourceNote = sourceLabel ? ` from ${sourceLabel}` : "";
      setStatus(`${execute ? "Executed" : "Planned"} ${payload.matched_intent} via ${payload.planner}${sourceNote}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assistant command failed");
    }
  }

  async function runAssistantCommand(execute: boolean) {
    const command = assistantCommand.trim();
    await submitAssistantCommand(command, execute);
  }

  function recordAssistantHistory(entry: AssistantCommandResponse | null | undefined) {
    if (!entry) {
      return;
    }
    setAssistantHistory((previous) => [entry, ...previous.filter((item) => item.command !== entry.command || item.planner !== entry.planner)].slice(0, 6));
  }

  async function loadAssistantVoiceJobs(origin: "auto" | "manual") {
    if (!token) {
      if (origin === "manual") {
        setStatus("Add API token first");
      }
      return;
    }

    try {
      const response = await fetch(
        `${normalizeBaseUrl(apiBase)}/v1/ai/jobs?limit=10&action=assistant_command`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Voice command job fetch failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as AssistantVoiceJob[];
      setAssistantVoiceJobs(payload);
      const completed = payload.find((job) => job.output.assistant_command)?.output.assistant_command;
      if (completed) {
        recordAssistantHistory(completed);
      }
      if (origin === "manual") {
        setStatus(`Loaded ${payload.length} voice command job(s)`);
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load voice command jobs");
      }
    }
  }

  async function loadAssistantAiJobs(origin: "auto" | "manual") {
    if (!token) {
      if (origin === "manual") {
        setStatus("Add API token first");
      }
      return;
    }

    try {
      const response = await fetch(
        `${normalizeBaseUrl(apiBase)}/v1/ai/jobs?limit=10&action=assistant_command_ai`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Queued Codex job fetch failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as AssistantQueuedJob[];
      setAssistantAiJobs(payload);
      const completed = payload.find((job) => job.output.assistant_command)?.output.assistant_command;
      if (completed) {
        recordAssistantHistory(completed);
      }
      if (origin === "manual") {
        setStatus(`Loaded ${payload.length} queued Codex job(s)`);
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load queued Codex jobs");
      }
    }
  }

  async function queueAssistantAiCommand(execute: boolean) {
    const command = assistantCommand.trim();
    if (!command) {
      setStatus("Enter an assistant command first");
      return;
    }
    if (!token) {
      setStatus("Add API token first");
      return;
    }

    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/agent/command/assist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          command,
          execute,
          device_target: "mobile-companion",
          provider_hint: BATCH_PROVIDER_HINT.llm ?? "codex_local",
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Queued Codex command failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as AssistantQueuedJob;
      setAssistantAiJobs((previous) => [payload, ...previous.filter((item) => item.id !== payload.id)].slice(0, 10));
      setStatus(`Queued Codex ${execute ? "execute" : "plan"} job ${payload.id} via ${formatExecutionTarget(llmResolution.active)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to queue Codex command");
    }
  }

  async function submitLocalVoiceAssistantCommand(execute: boolean) {
    if (localSttListening) {
      setStatus("On-device STT is already listening");
      return;
    }
    if (!token) {
      setStatus("Add API token first");
      return;
    }
    if (!localSttAvailable || sttResolution.active !== "on_device") {
      setStatus("On-device STT is unavailable; use the queued Whisper voice path instead.");
      return;
    }
    if (voiceRecording) {
      setStatus("Stop the current voice recording before starting on-device STT");
      return;
    }

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setStatus("Microphone permission denied");
        return;
      }

      setLocalSttListening(true);
      setStatus("Listening for an on-device voice command...");
      const transcriptPayload = await recognizeSpeechOnce({
        prompt: execute ? "Speak the command to execute" : "Speak the command to plan",
      });
      const transcript = transcriptPayload.transcript.trim();
      if (!transcript) {
        throw new Error("On-device STT returned no transcript");
      }

      setAssistantCommand(transcript);
      await submitAssistantCommand(transcript, execute, "on-device STT");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "On-device STT failed");
    } finally {
      setLocalSttListening(false);
    }
  }

  async function submitVoiceAssistantCommand(execute: boolean) {
    if (sttResolution.active === "on_device") {
      await submitLocalVoiceAssistantCommand(execute);
      return;
    }
    if (!voiceClipUri) {
      setStatus("Record a voice clip first");
      return;
    }
    if (!token) {
      setStatus("Add API token first");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("title", "Mobile voice command");
      formData.append("duration_ms", String(voiceClipDurationMs));
      formData.append("execute", execute ? "true" : "false");
      formData.append("device_target", "mobile-companion");
      formData.append("provider_hint", BATCH_PROVIDER_HINT.stt ?? "whisper_local");
      formData.append(
        "file",
        {
          uri: voiceClipUri,
          name: `voice-command-${Date.now()}.m4a`,
          type: DEFAULT_VOICE_MIME,
        } as unknown as Blob,
      );

      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/agent/command/voice`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Voice command upload failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as AssistantVoiceJob;
      setAssistantVoiceJobs((previous) => [payload, ...previous].slice(0, 10));
      setVoiceClipUri(null);
      setVoiceClipDurationMs(0);
      setStatus(`Queued voice command ${payload.id} via ${formatExecutionTarget(sttResolution.active)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Voice command upload failed");
    }
  }

  useEffect(() => {
    let active = true;

    async function initialize() {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("starlog-morning", {
          name: "Starlog Morning Brief",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 200, 250],
        });
      }

      const permission = await Notifications.getPermissionsAsync();
      if (active) {
        setNotificationPermission(permission.status);
      }

      await refreshLocalSttAvailability("auto");

      const persisted = await readPersistedState();
      if (active && persisted) {
        setApiBase(persisted.apiBase);
        setPwaBase(persisted.pwaBase);
        setToken(persisted.token);
        setQuickCaptureTitle(persisted.quickCaptureTitle);
        setQuickCaptureText(persisted.quickCaptureText);
        setQuickCaptureSourceUrl(persisted.quickCaptureSourceUrl);
        setSharedFileDrafts(persisted.sharedFileDrafts || []);
        setVoiceClipUri(persisted.voiceClipUri ?? null);
        setVoiceClipDurationMs(persisted.voiceClipDurationMs ?? 0);
        setBriefingDate(persisted.briefingDate);
        setCachedPath(persisted.cachedPath);
        setAlarmHour(boundedInt(persisted.alarmHour, 0, 23));
        setAlarmMinute(boundedInt(persisted.alarmMinute, 0, 59));
        setAlarmNotificationId(persisted.alarmNotificationId);
        setPendingCaptures(persisted.pendingCaptures || []);
        setArtifacts(persisted.artifacts || []);
        setSelectedArtifactId(persisted.selectedArtifactId || "");
        setArtifactGraph(persisted.artifactGraph);
        setArtifactVersions(persisted.artifactVersions);
        setDueCards(persisted.dueCards || []);
        setExecutionPolicy(persisted.executionPolicy || defaultExecutionPolicy());
        setAssistantCommand(persisted.assistantCommand || "summarize latest artifact");
        setAssistantHistory(persisted.assistantHistory || []);
        setAssistantVoiceJobs(persisted.assistantVoiceJobs || []);
        setAssistantAiJobs(persisted.assistantAiJobs || []);
      }

      const initialUrl = await Linking.getInitialURL();
      if (active && initialUrl) {
        const deepCapture = parseCaptureDeepLink(initialUrl);
        if (deepCapture) {
          setQuickCaptureTitle(deepCapture.title);
          setQuickCaptureText(deepCapture.text);
          setQuickCaptureSourceUrl(deepCapture.sourceUrl);
          setSharedFileDrafts([]);
          setVoiceClipUri(null);
          setVoiceClipDurationMs(0);
          setStatus("Loaded capture from share deep link");
        }
      }

      if (active) {
        setHydrated(true);
      }
    }

    initialize().catch((error) => {
      if (active) {
        setStatus(error instanceof Error ? error.message : "Mobile init failed");
        setHydrated(true);
      }
    });

    const notificationSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const briefingPath = typeof data?.briefingPath === "string" ? data.briefingPath : null;
      const fallbackText = typeof data?.fallbackText === "string" ? data.fallbackText : null;

      if (!briefingPath) {
        if (fallbackText) {
          Speech.speak(fallbackText);
        }
        return;
      }

      readCachedBriefing(briefingPath)
        .then((briefing) => {
          return playBriefingPayload(briefing, "scheduled");
        })
        .catch(() => {
          if (fallbackText) {
            Speech.speak(fallbackText);
          }
          setStatus("Cached briefing missing; fallback played");
        });
    });

    const linkSubscription = Linking.addEventListener("url", (event) => {
      const deepCapture = parseCaptureDeepLink(event.url);
      if (!deepCapture) {
        return;
      }
      setQuickCaptureTitle(deepCapture.title);
      setQuickCaptureText(deepCapture.text);
      setQuickCaptureSourceUrl(deepCapture.sourceUrl);
      setSharedFileDrafts([]);
      setVoiceClipUri(null);
      setVoiceClipDurationMs(0);
      setStatus("Loaded capture from share deep link");
    });

    return () => {
      active = false;
      notificationSubscription.remove();
      linkSubscription.remove();
      if (briefingSoundRef.current) {
        briefingSoundRef.current.unloadAsync().catch(() => undefined);
        briefingSoundRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!shareIntentError) {
      return;
    }
    setStatus(`Share intent error: ${shareIntentError}`);
  }, [shareIntentError]);

  useEffect(() => {
    if (!hasShareIntent) {
      return;
    }
    let cancelled = false;

    async function applyIncomingShareIntent() {
      const sharedText = (shareIntent.text ?? "").trim();
      const sharedUrl = (shareIntent.webUrl ?? "").trim();
      const shareFiles = shareIntent.files ?? [];
      const firstFile = shareFiles[0] ?? null;
      const audioOnlyShare = shareFiles.length === 1 && firstFile?.mimeType?.startsWith("audio/");
      const incomingDrafts: SharedFileDraft[] = shareFiles.map((file, index) => ({
        localUri: file.path,
        mimeType: file.mimeType || DEFAULT_FILE_MIME,
        fileName: file.fileName || `shared-file-${index + 1}`,
        bytesSize: file.size ?? null,
      }));
      const sharedDrafts = await materializeSharedFileDrafts(incomingDrafts);
      if (cancelled) {
        return;
      }

      const inferredTitle =
        (shareIntent.meta?.title ?? "").trim() ||
        (shareFiles.length > 1 ? `${shareFiles.length} shared files` : "") ||
        firstFile?.fileName ||
        sharedUrl ||
        DEFAULT_CAPTURE_TITLE;

      setQuickCaptureTitle(inferredTitle);
      setQuickCaptureSourceUrl(sharedUrl);

      if (audioOnlyShare) {
        const audioDraft = sharedDrafts[0];
        setSharedFileDrafts([]);
        setVoiceClipUri(audioDraft?.localUri ?? firstFile?.path ?? null);
        setVoiceClipDurationMs(firstFile?.duration ?? 0);
        setQuickCaptureText(sharedText || `Shared audio file: ${audioDraft?.fileName || firstFile?.fileName}`);
        setStatus("Loaded Android share audio into the companion app");
        resetShareIntent();
        return;
      }

      setSharedFileDrafts(sharedDrafts);
      setVoiceClipUri(null);
      setVoiceClipDurationMs(0);

      if (sharedText) {
        setQuickCaptureText(sharedText);
      } else if (shareFiles.length > 0) {
        setQuickCaptureText("");
      } else if (sharedUrl) {
        setQuickCaptureText(sharedUrl);
      }

      if (shareFiles.length > 1) {
        setStatus(`Loaded ${shareFiles.length} Android shared files into quick capture`);
      } else {
        setStatus(firstFile ? "Loaded Android shared file into quick capture" : "Loaded shared text/url into quick capture");
      }
      resetShareIntent();
    }

    applyIncomingShareIntent().catch((error) => {
      if (cancelled) {
        return;
      }
      setStatus(error instanceof Error ? error.message : "Android share intent load failed");
      resetShareIntent();
    });

    return () => {
      cancelled = true;
    };
  }, [hasShareIntent, resetShareIntent, shareIntent]);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        refreshLocalSttAvailability("auto").catch(() => undefined);
      }
      if (nextState === "active" && token) {
        if (pendingCaptures.length > 0) {
          flushPendingCaptures("auto").catch(() => undefined);
        }
        loadAssistantVoiceJobs("auto").catch(() => undefined);
        loadAssistantAiJobs("auto").catch(() => undefined);
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, [token, pendingCaptures.length, apiBase]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    writePersistedState({
      version: 3,
      apiBase,
      pwaBase,
      token,
      quickCaptureTitle,
      quickCaptureText,
      quickCaptureSourceUrl,
      sharedFileDrafts,
      voiceClipUri,
      voiceClipDurationMs,
      briefingDate,
      cachedPath,
      alarmHour: boundedInt(alarmHour, 0, 23),
      alarmMinute: boundedInt(alarmMinute, 0, 59),
      alarmNotificationId,
      pendingCaptures,
      artifacts,
      selectedArtifactId,
      artifactGraph,
      artifactVersions,
      dueCards,
      executionPolicy,
      assistantCommand,
      assistantHistory,
      assistantVoiceJobs,
      assistantAiJobs,
    }).catch(() => undefined);
  }, [
    alarmHour,
    alarmMinute,
    alarmNotificationId,
    apiBase,
    assistantCommand,
    assistantHistory,
    assistantVoiceJobs,
    assistantAiJobs,
    artifactGraph,
    artifactVersions,
    artifacts,
    briefingDate,
    cachedPath,
    dueCards,
    executionPolicy,
    hydrated,
    pendingCaptures,
    pwaBase,
    quickCaptureSourceUrl,
    sharedFileDrafts,
    quickCaptureText,
    quickCaptureTitle,
    selectedArtifactId,
    token,
    voiceClipDurationMs,
    voiceClipUri,
  ]);

  useEffect(() => {
    if (!hydrated || !token || pendingCaptures.length === 0) {
      return;
    }
    flushPendingCaptures("auto").catch(() => undefined);
  }, [hydrated, token, apiBase, pendingCaptures.length]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    loadArtifacts().catch(() => undefined);
  }, [hydrated, token, apiBase]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    loadExecutionPolicy("auto").catch(() => undefined);
  }, [hydrated, token, apiBase]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    loadAssistantVoiceJobs("auto").catch(() => undefined);
    loadAssistantAiJobs("auto").catch(() => undefined);
  }, [hydrated, token, apiBase]);

  useEffect(() => {
    if (!hydrated || !token || !selectedArtifactId) {
      setArtifactGraph(null);
      setArtifactVersions(null);
      return;
    }
    loadArtifactDetail(selectedArtifactId).catch(() => undefined);
  }, [hydrated, token, apiBase, selectedArtifactId]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={palette.bg === "#070c1b" ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Starlog Companion</Text>
          <Text style={styles.title}>Capture fast. Wake focused.</Text>
          <Text style={styles.body}>
            Mobile app handles share capture, queue retries, alarms, and offline brief playback while deep planning stays in the PWA.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Execution routing</Text>
          <Text style={styles.subtle}>
            Mobile reads the shared execution policy, then falls back to the nearest implemented route on phone when needed.
          </Text>
          <View style={styles.inlineCard}>
            <Text style={styles.inlineCardTitle}>LLM actions</Text>
            <Text style={styles.subtle}>
              requested {formatExecutionTarget(llmResolution.requested)} {"->"} active {formatExecutionTarget(llmResolution.active)}
            </Text>
            {llmResolution.reason ? <Text style={styles.subtle}>{llmResolution.reason}</Text> : null}
          </View>
          <View style={styles.inlineCard}>
            <Text style={styles.inlineCardTitle}>Voice STT</Text>
            <Text style={styles.subtle}>
              requested {formatExecutionTarget(sttResolution.requested)} {"->"} active {formatExecutionTarget(sttResolution.active)}
            </Text>
            {sttResolution.reason ? <Text style={styles.subtle}>{sttResolution.reason}</Text> : null}
          </View>
          <View style={styles.inlineCard}>
            <Text style={styles.inlineCardTitle}>Speech playback</Text>
            <Text style={styles.subtle}>
              requested {formatExecutionTarget(ttsResolution.requested)} {"->"} active {formatExecutionTarget(ttsResolution.active)}
            </Text>
            {ttsResolution.reason ? <Text style={styles.subtle}>{ttsResolution.reason}</Text> : null}
          </View>
          <Text style={styles.subtle}>
            Policy updated: {executionPolicy.updated_at ? new Date(executionPolicy.updated_at).toLocaleString() : "local default"}
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={() => loadExecutionPolicy("manual")}>
              <Text style={styles.buttonText}>Refresh Policy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={openIntegrationsInPwa}>
              <Text style={styles.buttonText}>Open Integrations</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Assistant command</Text>
          <Text style={styles.subtle}>
            Send typed or queued voice commands through the same tool-backed assistant layer used by the PWA.
          </Text>
          <TextInput
            style={styles.input}
            value={assistantCommand}
            onChangeText={setAssistantCommand}
            placeholder="summarize latest artifact"
            placeholderTextColor={palette.muted}
            multiline
          />
          <View style={styles.chipRow}>
            {assistantExampleCommands.map((example) => (
              <TouchableOpacity
                key={example}
                style={styles.chip}
                activeOpacity={0.8}
                onPress={() => setAssistantCommand(example)}
              >
                <Text style={styles.chipText}>{example}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={() => runAssistantCommand(false)}>
              <Text style={styles.buttonText}>Plan Command</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => runAssistantCommand(true)}>
              <Text style={styles.buttonText}>Execute Command</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => queueAssistantAiCommand(false)}>
              <Text style={styles.buttonText}>Queue Codex Plan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => queueAssistantAiCommand(true)}>
              <Text style={styles.buttonText}>Queue Codex Execute</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={openAssistantInPwa}>
              <Text style={styles.buttonText}>Open PWA Assistant</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.buttonRow}>
            {sttResolution.active === "on_device" ? (
              <>
                <TouchableOpacity style={styles.button} onPress={() => submitLocalVoiceAssistantCommand(false)}>
                  <Text style={styles.buttonText}>{localSttListening ? "Listening..." : "Listen & Plan"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => submitLocalVoiceAssistantCommand(true)}>
                  <Text style={styles.buttonText}>{localSttListening ? "Listening..." : "Listen & Execute"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => refreshLocalSttAvailability("manual")}>
                  <Text style={styles.buttonText}>Refresh STT</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.button} onPress={voiceRecording ? stopVoiceRecording : startVoiceRecording}>
                  <Text style={styles.buttonText}>{voiceRecording ? "Stop Voice Command" : "Start Voice Command"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => submitVoiceAssistantCommand(false)}>
                  <Text style={styles.buttonText}>Plan Voice Command</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => submitVoiceAssistantCommand(true)}>
                  <Text style={styles.buttonText}>Execute Voice</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={styles.button}
              onPress={() => {
                loadAssistantVoiceJobs("manual").catch(() => undefined);
                loadAssistantAiJobs("manual").catch(() => undefined);
              }}
            >
              <Text style={styles.buttonText}>Refresh Jobs</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subtle}>
            On-device STT: {localSttProbeLabel(localSttAvailable)}
          </Text>
          {sttResolution.active === "on_device" ? (
            <Text style={styles.subtle}>
              Voice commands now use Android speech recognition on the phone, then send the transcript through the normal assistant command endpoint.
            </Text>
          ) : (
            <Text style={styles.subtle}>
              Voice clip for commands: {voiceRecording ? "recording..." : voiceClipUri ? `${Math.round(voiceClipDurationMs / 1000)}s ready` : "none"}
            </Text>
          )}
          {assistantHistory[0] ? (
            <View style={styles.detailCard}>
              <Text style={styles.inlineCardTitle}>
                Latest: {assistantHistory[0].matched_intent} [{assistantHistory[0].status}]
              </Text>
              <Text style={styles.subtle}>{assistantHistory[0].summary}</Text>
              {assistantHistory[0].steps.map((step, index) => (
                <View key={`${step.tool_name}-${index}`} style={styles.inlineCard}>
                  <Text style={styles.inlineCardTitle}>
                    {step.tool_name} [{step.status}]
                  </Text>
                  {step.message ? <Text style={styles.subtle}>{step.message}</Text> : null}
                  <Text style={styles.mono}>{JSON.stringify(step.arguments)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.subtle}>No mobile assistant command history yet.</Text>
          )}
          {assistantVoiceJobs.length > 0 ? (
            <View style={styles.detailCard}>
              <Text style={styles.inlineCardTitle}>Voice command jobs</Text>
              {assistantVoiceJobs.slice(0, 4).map((job) => (
                <View key={job.id} style={styles.inlineCard}>
                  <Text style={styles.inlineCardTitle}>
                    {job.id} [{job.status}]
                  </Text>
                  <Text style={styles.subtle}>
                    provider {job.provider_used || job.provider_hint || "pending"} | {new Date(job.created_at).toLocaleString()}
                  </Text>
                  {job.output.transcript ? <Text style={styles.subtle}>Transcript: {job.output.transcript}</Text> : null}
                  {job.output.assistant_command ? (
                    <Text style={styles.subtle}>
                      Command result: {job.output.assistant_command.matched_intent} [{job.output.assistant_command.status}]
                    </Text>
                  ) : null}
                  {job.error_text ? <Text style={styles.subtle}>Error: {job.error_text}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
          {assistantAiJobs.length > 0 ? (
            <View style={styles.detailCard}>
              <Text style={styles.inlineCardTitle}>Queued Codex jobs</Text>
              {assistantAiJobs.slice(0, 4).map((job) => (
                <View key={job.id} style={styles.inlineCard}>
                  <Text style={styles.inlineCardTitle}>
                    {job.id} [{job.status}]
                  </Text>
                  <Text style={styles.subtle}>
                    provider {job.provider_used || job.provider_hint || "pending"} | {new Date(job.created_at).toLocaleString()}
                  </Text>
                  {typeof job.payload.command === "string" && job.payload.command ? (
                    <Text style={styles.subtle}>Command: {job.payload.command}</Text>
                  ) : null}
                  {job.output.assistant_command ? (
                    <Text style={styles.subtle}>
                      Command result: {job.output.assistant_command.matched_intent} [{job.output.assistant_command.status}]
                    </Text>
                  ) : null}
                  {job.error_text ? <Text style={styles.subtle}>Error: {job.error_text}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Quick capture + queue</Text>
          <Text style={styles.label}>Capture title</Text>
          <TextInput style={styles.input} value={quickCaptureTitle} onChangeText={setQuickCaptureTitle} />
          <Text style={styles.label}>Source URL (optional)</Text>
          <TextInput
            style={styles.input}
            value={quickCaptureSourceUrl}
            onChangeText={setQuickCaptureSourceUrl}
            autoCapitalize="none"
            placeholder="https://..."
            placeholderTextColor={palette.muted}
          />
          <Text style={styles.label}>Quick capture text</Text>
          <TextInput
            style={styles.input}
            value={quickCaptureText}
            onChangeText={setQuickCaptureText}
            placeholder="Clip text, ideas, or reminders..."
            placeholderTextColor={palette.muted}
            multiline
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={submitQuickCapture}>
              <Text style={styles.buttonText}>Capture / Queue</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => flushPendingCaptures("manual")}>
              <Text style={styles.buttonText}>Flush Queue</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={voiceRecording ? stopVoiceRecording : startVoiceRecording}>
              <Text style={styles.buttonText}>{voiceRecording ? "Stop Voice Note" : "Start Voice Note"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={submitVoiceCapture}>
              <Text style={styles.buttonText}>Upload / Queue Voice</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subtle}>
            Voice clip: {voiceRecording ? "recording..." : voiceClipUri ? `${Math.round(voiceClipDurationMs / 1000)}s ready` : "none"}
          </Text>
          <Text style={styles.subtle}>
            Shared file{sharedFileDrafts.length === 1 ? "" : "s"}: {describeSharedDrafts(sharedFileDrafts)}
          </Text>
          {sharedFileDrafts.length > 0 ? (
            <>
              {sharedFileDrafts.slice(0, 3).map((draft) => (
                <View key={`${draft.localUri}:${draft.fileName}`} style={styles.inlineCard}>
                  <Text style={styles.subtle}>{describeSharedFile(draft.fileName, draft.mimeType, draft.bytesSize)}</Text>
                </View>
              ))}
              {sharedFileDrafts.length > 3 ? (
                <Text style={styles.subtle}>+{sharedFileDrafts.length - 3} more shared file(s)</Text>
              ) : null}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => {
                    setSharedFileDrafts([]);
                    setStatus("Cleared shared file drafts");
                  }}
                >
                  <Text style={styles.buttonText}>Clear Shared Files</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
          <Text style={styles.subtle}>Pending captures: {pendingCaptures.length}</Text>
          {pendingCaptures[0]?.lastError ? (
            <Text style={styles.subtle}>Last queue error: {pendingCaptures[0].lastError}</Text>
          ) : null}
          {pendingCaptures.slice(0, 3).map((capture) => (
            <View key={capture.id} style={styles.inlineCard}>
              <Text style={styles.subtle}>{capture.title}</Text>
              <Text style={styles.subtle}>
                {capture.kind} | attempts: {capture.attempts} | queued {new Date(capture.createdAt).toLocaleTimeString()}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Artifact triage</Text>
          <Text style={styles.subtle}>
            Load recent clips, trigger manual AI actions, then jump into the full artifact graph in the PWA.
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={loadArtifacts}>
              <Text style={styles.buttonText}>Refresh Inbox</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={openSelectedArtifactInPwa}>
              <Text style={styles.buttonText}>Open in PWA</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={speakSelectedArtifact}>
              <Text style={styles.buttonText}>Speak Locally</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subtle}>
            Selected: {selectedArtifact ? `${selectedArtifact.title || selectedArtifact.id}` : "none"}
          </Text>
          <Text style={styles.subtle}>{artifactDetailStatus}</Text>
          <View style={styles.chipRow}>
            {artifactQuickActions.map((item) => (
              <TouchableOpacity
                key={item.action}
                style={styles.chip}
                activeOpacity={0.8}
                onPress={() => runArtifactAction(item.action)}
              >
                <Text style={styles.chipText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {artifacts.length === 0 ? (
            <Text style={styles.subtle}>No artifacts loaded yet.</Text>
          ) : (
            artifacts.slice(0, 6).map((artifact) => {
              const active = artifact.id === selectedArtifactId;
              return (
                <TouchableOpacity
                  key={artifact.id}
                  style={[styles.inlineCard, active ? styles.inlineCardActive : null]}
                  activeOpacity={0.85}
                  onPress={() => setSelectedArtifactId(artifact.id)}
                >
                  <Text style={styles.inlineCardTitle}>{artifact.title || artifact.id}</Text>
                  <Text style={styles.subtle}>
                    {artifact.source_type} | {new Date(artifact.created_at).toLocaleString()}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
          {artifactGraph ? (
            <View style={styles.detailCard}>
              <Text style={styles.inlineCardTitle}>Selected artifact detail</Text>
              <Text style={styles.subtle}>
                summaries {artifactGraph.summaries.length} | cards {artifactGraph.cards.length} | tasks {artifactGraph.tasks.length} | notes {artifactGraph.notes.length}
              </Text>
              {artifactGraph.summaries[0] ? (
                <View style={styles.inlineCard}>
                  <Text style={styles.inlineCardTitle}>Latest summary v{artifactGraph.summaries[0].version}</Text>
                  <Text style={styles.subtle}>
                    {artifactGraph.summaries[0].content.slice(0, 180)}
                    {artifactGraph.summaries[0].content.length > 180 ? "..." : ""}
                  </Text>
                </View>
              ) : null}
              {artifactGraph.tasks.slice(0, 2).map((task) => (
                <View key={task.id} style={styles.inlineCard}>
                  <Text style={styles.inlineCardTitle}>{task.title}</Text>
                  <Text style={styles.subtle}>task status: {task.status}</Text>
                  <View style={styles.buttonRow}>
                    <TouchableOpacity style={styles.button} onPress={() => openTaskInPwa(task.id)}>
                      <Text style={styles.buttonText}>Open Task</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              {artifactGraph.notes.slice(0, 1).map((note) => (
                <View key={note.id} style={styles.inlineCard}>
                  <Text style={styles.inlineCardTitle}>{note.title}</Text>
                  <Text style={styles.subtle}>
                    {note.body_md.slice(0, 160)}
                    {note.body_md.length > 160 ? "..." : ""}
                  </Text>
                  <View style={styles.buttonRow}>
                    <TouchableOpacity style={styles.button} onPress={() => openNoteInPwa(note.id)}>
                      <Text style={styles.buttonText}>Open Note</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              {artifactGraph.cards.slice(0, 2).map((card) => (
                <View key={card.id} style={styles.inlineCard}>
                  <Text style={styles.inlineCardTitle}>{card.prompt}</Text>
                  <Text style={styles.subtle}>
                    {card.answer.slice(0, 140)}
                    {card.answer.length > 140 ? "..." : ""}
                  </Text>
                </View>
              ))}
              {artifactVersions ? (
                <View style={styles.inlineCard}>
                  <Text style={styles.inlineCardTitle}>Version history</Text>
                  <Text style={styles.subtle}>
                    {artifactVersions.summaries.length} summaries | {artifactVersions.card_sets.length} card sets | {artifactVersions.actions.length} actions
                  </Text>
                  {artifactVersions.actions.slice(0, 3).map((action) => (
                    <Text key={action.id} style={styles.subtle}>
                      {action.action} [{action.status}]
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Quick review session</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={loadDueCards}>
              <Text style={styles.buttonText}>Load Due Cards</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.button}
              onPress={() => {
                if (!dueCards[0]) {
                  setStatus("No due card selected");
                  return;
                }
                setShowAnswer(true);
              }}
            >
              <Text style={styles.buttonText}>Reveal Answer</Text>
            </TouchableOpacity>
          </View>

          {dueCards[0] ? (
            <View style={styles.reviewCard}>
              <Text style={styles.subtle}>
                Card type: {dueCards[0].card_type} | due queue: {dueCards.length}
              </Text>
              <Text style={styles.reviewPrompt}>{dueCards[0].prompt}</Text>
              {showAnswer ? <Text style={styles.reviewAnswer}>{dueCards[0].answer}</Text> : null}
              <View style={styles.buttonRow}>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <TouchableOpacity key={rating} style={styles.button} onPress={() => submitReview(rating)}>
                    <Text style={styles.buttonText}>Rate {rating}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.subtle}>No due card loaded yet.</Text>
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Phone + PWA linkage</Text>
          <Text style={styles.label}>PWA URL</Text>
          <TextInput style={styles.input} value={pwaBase} onChangeText={setPwaBase} autoCapitalize="none" />
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={openPwa}>
              <Text style={styles.buttonText}>Open PWA</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subtle}>Share deep-link format</Text>
          <Text style={styles.mono}>starlog://capture?title=Clip&text=Hello&source_url=https://example.com</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Offline Morning Brief Pipeline</Text>
          <Text style={styles.label}>API base</Text>
          <TextInput
            style={styles.input}
            value={apiBase}
            onChangeText={setApiBase}
            autoCapitalize="none"
            placeholder="http://192.168.x.x:8000"
            placeholderTextColor={palette.muted}
          />
          <Text style={styles.label}>Bearer token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            secureTextEntry
          />
          <Text style={styles.label}>Briefing date (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={briefingDate} onChangeText={setBriefingDate} autoCapitalize="none" />

          <Text style={styles.label}>Alarm time (24h)</Text>
          <View style={styles.buttonRow}>
            <TextInput
              style={styles.timeInput}
              keyboardType="number-pad"
              value={String(alarmHour)}
              onChangeText={(value) => setAlarmHour(boundedInt(Number(value || "0"), 0, 23))}
            />
            <TextInput
              style={styles.timeInput}
              keyboardType="number-pad"
              value={String(alarmMinute)}
              onChangeText={(value) => setAlarmMinute(boundedInt(Number(value || "0"), 0, 59))}
            />
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={generateAndCache}>
              <Text style={styles.buttonText}>Cache Briefing</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={queueBriefingAudio}>
              <Text style={styles.buttonText}>Queue Audio Render</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={playCached}>
              <Text style={styles.buttonText}>Play Cached</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={scheduleMorningAlarm}>
              <Text style={styles.buttonText}>Schedule Daily Alarm</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={clearMorningAlarm}>
              <Text style={styles.buttonText}>Clear Alarm</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.subtle}>Notification permission: {notificationPermission}</Text>
          <Text style={styles.subtle}>Cached file: {cachedPath ?? "none"}</Text>
          <Text style={styles.subtle}>
            Alarm status: {alarmNotificationId ? `scheduled at ${toHourMinuteLabel(alarmHour, alarmMinute)}` : "not scheduled"}
          </Text>
          <Text style={styles.subtle}>{status}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function themedStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: palette.bg,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingVertical: 18,
      gap: 12,
      backgroundColor: palette.bg,
    },
    hero: {
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.panel,
      borderRadius: 18,
      padding: 16,
      gap: 8,
    },
    eyebrow: {
      textTransform: "uppercase",
      letterSpacing: 1,
      color: palette.accent,
      fontSize: 11,
      fontWeight: "700",
    },
    title: {
      color: palette.text,
      fontSize: 28,
      fontWeight: "800",
    },
    body: {
      color: palette.muted,
      fontSize: 15,
      lineHeight: 22,
    },
    panel: {
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.panel,
      borderRadius: 16,
      padding: 14,
      gap: 8,
    },
    panelTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "700",
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4,
    },
    chip: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 12,
      backgroundColor: palette.bgAlt,
    },
    chipText: {
      color: palette.text,
      fontWeight: "600",
      fontSize: 13,
    },
    inlineCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 12,
      padding: 10,
      gap: 4,
      backgroundColor: palette.bgAlt,
      marginTop: 4,
    },
    inlineCardActive: {
      borderColor: palette.accent,
      shadowColor: palette.accent,
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    inlineCardTitle: {
      color: palette.text,
      fontSize: 14,
      fontWeight: "700",
    },
    detailCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 14,
      padding: 10,
      gap: 8,
      backgroundColor: palette.panel,
      marginTop: 6,
    },
    subtle: {
      color: palette.muted,
      fontSize: 13,
    },
    label: {
      color: palette.muted,
      fontSize: 13,
      marginTop: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 10,
      color: palette.text,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: palette.bgAlt,
    },
    timeInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 10,
      color: palette.text,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: palette.bgAlt,
      minWidth: 64,
      textAlign: "center",
    },
    buttonRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 6,
    },
    button: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      backgroundColor: palette.bgAlt,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    buttonText: {
      color: palette.text,
      fontWeight: "600",
      fontSize: 13,
    },
    mono: {
      color: palette.muted,
      fontSize: 12,
      fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    },
    reviewCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 10,
      padding: 10,
      gap: 8,
      backgroundColor: palette.bgAlt,
      marginTop: 6,
    },
    reviewPrompt: {
      color: palette.text,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "600",
    },
    reviewAnswer: {
      color: palette.muted,
      fontSize: 14,
      lineHeight: 20,
    },
  });
}
