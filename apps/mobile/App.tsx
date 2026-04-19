import { StatusBar } from "expo-status-bar";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as Notifications from "expo-notifications";
import { useShareIntent } from "expo-share-intent";
import * as SecureStore from "expo-secure-store";
import * as Speech from "expo-speech";
import * as SQLite from "expo-sqlite";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  DeviceEventEmitter,
  Keyboard,
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
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { clearCurrentIntentUrl, getCurrentIntentUrl, probeLocalSttAvailability, recognizeSpeechOnce } from "./local-stt";
import {
  PRODUCT_SURFACES,
} from "@starlog/contracts";
import type {
  AssistantCard as ConversationCard,
  AssistantCardAction,
  AssistantConversationMessage,
  AssistantConversationToolTrace,
} from "@starlog/contracts";
import {
  MobileCalendarSurface,
  MobileLoginSurface,
  MobileNotesSurface,
  MobileReviewSurface,
} from "./src/mobile-surfaces";
import { MobileAssistantRebuild } from "./src/mobile-assistant-rebuild";
import { MobileOpsChip, MobileSupportPanel } from "./src/mobile-ops-panels";
import {
  AssistantToolsSection,
  ArtifactTriageSection,
  BriefingPipelineSection,
  CaptureQueueSection,
  CaptureRoutingSection,
  DesktopFallbackSection,
  ReviewSessionSection,
} from "./src/mobile-support-panel-sections";
import { MobileAssistantDrawer, MobileBottomNav, MobileTopBar } from "./src/mobile-shell";
import { MOBILE_SUPPORT_PANEL_COPY } from "./src/mobile-support-panels";
import { mobileTabLabel, mobileTabFromParam, type MobileTab } from "./src/navigation";

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
  accentMuted: string;
  secondary: string;
  tertiary: string;
  error: string;
  onAccent: string;
  surfaceLow: string;
  surfaceHigh: string;
  surfaceHighest: string;
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

type IncomingShareIntentFile = {
  path: string;
  mimeType?: string | null;
  fileName?: string | null;
  size?: number | null;
  duration?: number | null;
};

type IncomingShareIntent = {
  text?: string | null;
  webUrl?: string | null;
  meta?: { title?: string | null };
  files?: IncomingShareIntentFile[];
};

type VoiceClipTarget = "capture" | "assistant";
type VoiceRoutePreference = "shared_policy" | "on_device_first" | "bridge_first";
type BriefingPlaybackPreference = "offline_first" | "refresh_then_cache";

type PersistedState = {
  version: 5;
  apiBase: string;
  pwaBase: string;
  token: string;
  quickCaptureTitle: string;
  quickCaptureText: string;
  quickCaptureSourceUrl: string;
  sharedFileDrafts?: SharedFileDraft[];
  voiceClipUri?: string | null;
  voiceClipDurationMs?: number;
  voiceClipTarget?: VoiceClipTarget | null;
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
  voiceRoutePreference: VoiceRoutePreference;
  briefingPlaybackPreference: BriefingPlaybackPreference;
  homeDraft?: string;
  notesInstructionDraft?: string;
  assistantCommand?: string;
  assistantHistory?: AssistantCommandResponse[];
  assistantVoiceJobs?: AssistantVoiceJob[];
  assistantAiJobs?: AssistantQueuedJob[];
  conversationTitle?: string;
  conversationSessionState?: Record<string, unknown>;
  conversationMessages?: ConversationMessage[];
  conversationToolTraces?: ConversationToolTrace[];
  lastConversationReset?: ConversationSessionResetResponse | null;
};

type PersistedStateV4 = Omit<
  PersistedState,
  "version"
> & {
  version: 4;
};

type PersistedStateV3 = Omit<
  PersistedStateV4,
  "version" | "voiceRoutePreference" | "briefingPlaybackPreference"
> & {
  version: 3;
};

type PersistedStateV2 = Omit<
  PersistedStateV3,
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
  deck_id?: string | null;
  card_type: string;
  prompt: string;
  answer: string;
  due_at: string;
};

type CardDeckSummary = {
  id: string;
  name: string;
  description?: string | null;
  card_count: number;
  due_count: number;
};

type ReviewSessionStats = {
  reviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
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

type ConversationMessage = Omit<AssistantConversationMessage, "metadata"> & {
  metadata: {
    assistant_command?: AssistantCommandResponse;
  } & Record<string, unknown>;
};

type ConversationToolTrace = AssistantConversationToolTrace;

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

type PendingConversationTurn = {
  id: string;
  content: string;
  createdAt: string;
};

const RUNTIME_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const DEFAULT_API_BASE = RUNTIME_ENV.EXPO_PUBLIC_STARLOG_API_BASE?.trim()
  || (__DEV__ ? "http://localhost:8000" : "https://starlog-api-production.up.railway.app");
const DEFAULT_PWA_BASE = RUNTIME_ENV.EXPO_PUBLIC_STARLOG_PWA_BASE?.trim()
  || (__DEV__ ? "http://localhost:3000" : "https://starlog-web-production.up.railway.app");
const DEFAULT_CAPTURE_TITLE = "Mobile capture";
const DEFAULT_HOME_DRAFT = "summarize latest artifact";
const DEFAULT_NOTES_INSTRUCTION_DRAFT = "Save this and turn it into tonight's reading note.";
const DEFAULT_VOICE_MIME = "audio/x-m4a";
const DEFAULT_FILE_MIME = "application/octet-stream";
const MOBILE_DB_NAME = "starlog-mobile.db";
const MOBILE_STATE_KEY = "state_v2";
const MOBILE_SECURE_TOKEN_KEY = "starlog.api.token";
const SERIF_FONT_FAMILY = Platform.select({ ios: "Georgia", android: "serif", default: undefined });
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
const DEFAULT_MOBILE_THREAD_VISIBLE_MESSAGES = 12;

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
  "create task",
  "search for spaced repetition",
];

let stateDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function usePalette(): Palette {
  const scheme = useColorScheme();
  return useMemo(() => {
    if (scheme === "light") {
      return {
        bg: "#faf4f6",
        bgAlt: "#f5eaef",
        panel: "rgba(255,248,250,0.84)",
        border: "rgba(101,57,76,0.16)",
        text: "#311820",
        muted: "#6f5961",
        accent: "#8d4860",
        accentMuted: "rgba(141,72,96,0.12)",
        secondary: "#7e7564",
        tertiary: "#b97d97",
        error: "#b33834",
        onAccent: "#fff6fa",
        surfaceLow: "#fff7f9",
        surfaceHigh: "#f2e4ea",
        surfaceHighest: "#ead8e0",
      };
    }
    return {
      bg: "#1e0f16",
      bgAlt: "#27171e",
      panel: "rgba(71,52,60,0.4)",
      border: "rgba(73,71,63,0.18)",
      text: "#f8dbe6",
      muted: "#cac6bb",
      accent: "#f1b6cd",
      accentMuted: "rgba(241,182,205,0.14)",
      secondary: "#cbc7b3",
      tertiary: "#65394c",
      error: "#ffb4ab",
      onAccent: "#320f20",
      surfaceLow: "#2b1b23",
      surfaceHigh: "#37252d",
      surfaceHighest: "#422f38",
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

async function readSecureToken(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(MOBILE_SECURE_TOKEN_KEY)) ?? "";
  } catch {
    return "";
  }
}

async function writeSecureToken(rawToken: string): Promise<void> {
  const token = rawToken.trim();
  try {
    if (!token) {
      await SecureStore.deleteItemAsync(MOBILE_SECURE_TOKEN_KEY);
      return;
    }
    await SecureStore.setItemAsync(MOBILE_SECURE_TOKEN_KEY, token);
  } catch {
    // Keep app behavior resilient if secure storage is unavailable on a host/device.
  }
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

function incomingShareIntentFingerprint(intent: IncomingShareIntent): string {
  const fileSignature = (intent.files ?? []).map((file) =>
    [
      file.path || "",
      file.fileName || "",
      file.mimeType || "",
      String(file.size ?? ""),
      String(file.duration ?? ""),
    ].join("|"),
  );

  return JSON.stringify({
    text: (intent.text ?? "").trim(),
    webUrl: (intent.webUrl ?? "").trim(),
    title: (intent.meta?.title ?? "").trim(),
    files: fileSignature,
  });
}

function hasMeaningfulIncomingShareIntent(intent: IncomingShareIntent): boolean {
  return Boolean(
    (intent.text ?? "").trim() ||
      (intent.webUrl ?? "").trim() ||
      (intent.meta?.title ?? "").trim() ||
      (intent.files ?? []).length > 0,
  );
}

function shareSourcePlatformLabel(): string {
  return Platform.OS === "ios" ? "iOS" : "Android";
}

const DEFAULT_VOICE_ROUTE_PREFERENCE: VoiceRoutePreference = "shared_policy";
const DEFAULT_BRIEFING_PLAYBACK_PREFERENCE: BriefingPlaybackPreference = "offline_first";

function normalizeVoiceRoutePreference(value: unknown): VoiceRoutePreference {
  if (value === "on_device_first" || value === "bridge_first") {
    return value;
  }
  return DEFAULT_VOICE_ROUTE_PREFERENCE;
}

function normalizeBriefingPlaybackPreference(value: unknown): BriefingPlaybackPreference {
  if (value === "refresh_then_cache") {
    return value;
  }
  return DEFAULT_BRIEFING_PLAYBACK_PREFERENCE;
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

function uniqueExecutionTargets(targets: ExecutionTarget[]): ExecutionTarget[] {
  return [...new Set(targets)] as ExecutionTarget[];
}

function sttOrderForPreference(policy: ExecutionPolicy, preference: VoiceRoutePreference): ExecutionTarget[] {
  const requestedOrder = policyOrder(policy, "stt");
  if (preference === "shared_policy") {
    return requestedOrder;
  }

  const preferredOrder: ExecutionTarget[] =
    preference === "on_device_first"
      ? ["on_device", "batch_local_bridge", "server_local", "codex_bridge", "api_fallback"]
      : ["batch_local_bridge", "on_device", "server_local", "codex_bridge", "api_fallback"];
  return uniqueExecutionTargets([...preferredOrder, ...requestedOrder]);
}

function resolveExecutionTargetFromOrder(
  requestedOrder: ExecutionTarget[],
  executableTargets: ExecutionTarget[],
  fallbackTarget?: ExecutionTarget,
  fallbackReason?: string,
): ExecutionResolution {
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

function resolveExecutionTarget(
  policy: ExecutionPolicy,
  family: ExecutionPolicyFamily,
  executableTargets: ExecutionTarget[],
  fallbackTarget?: ExecutionTarget,
  fallbackReason?: string,
): ExecutionResolution {
  return resolveExecutionTargetFromOrder(policyOrder(policy, family), executableTargets, fallbackTarget, fallbackReason);
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

function summarizeTraceValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (value && typeof value === "object") {
    return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  }
  return "No structured payload";
}

function cardMetaText(card: ConversationCard): string {
  const parts = [`v${card.version}`];
  const metadata = card.metadata ?? {};
  const source = typeof metadata.projection_source === "string" ? metadata.projection_source : "";
  const updatedAt = typeof metadata.projection_updated_at === "string" ? metadata.projection_updated_at : "";
  if (updatedAt) {
    const parsed = new Date(updatedAt);
    if (!Number.isNaN(parsed.getTime())) {
      parts.push(`updated ${parsed.toLocaleString()}`);
    }
  }
  if (source) {
    parts.push(`source ${source.replace(/_/g, " ")}`);
  }
  return parts.join(" · ");
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
      const parsed = JSON.parse(row.value) as PersistedState | PersistedStateV4 | PersistedStateV3 | PersistedStateV2;
      if (parsed.version === 2) {
        const migrated: PersistedState = {
          ...parsed,
          version: 5,
          sharedFileDrafts: [],
          voiceClipUri: null,
          voiceClipDurationMs: 0,
          executionPolicy: defaultExecutionPolicy(),
          voiceRoutePreference: DEFAULT_VOICE_ROUTE_PREFERENCE,
          briefingPlaybackPreference: DEFAULT_BRIEFING_PLAYBACK_PREFERENCE,
          homeDraft: DEFAULT_HOME_DRAFT,
          notesInstructionDraft: DEFAULT_NOTES_INSTRUCTION_DRAFT,
          assistantCommand: DEFAULT_HOME_DRAFT,
          assistantHistory: [],
          assistantVoiceJobs: [],
          assistantAiJobs: [],
          conversationTitle: "Assistant Thread",
          conversationSessionState: {},
          conversationMessages: [],
          conversationToolTraces: [],
          lastConversationReset: null,
        };
        await writePersistedState(migrated);
        return migrated;
      }
      if (parsed.version === 3) {
        const normalized: PersistedState = {
          sharedFileDrafts: [],
          voiceClipUri: null,
          voiceClipDurationMs: 0,
          voiceRoutePreference: DEFAULT_VOICE_ROUTE_PREFERENCE,
          briefingPlaybackPreference: DEFAULT_BRIEFING_PLAYBACK_PREFERENCE,
          homeDraft: DEFAULT_HOME_DRAFT,
          notesInstructionDraft: DEFAULT_NOTES_INSTRUCTION_DRAFT,
          assistantCommand: DEFAULT_HOME_DRAFT,
          assistantHistory: [],
          assistantVoiceJobs: [],
          assistantAiJobs: [],
          conversationTitle: "Assistant Thread",
          conversationSessionState: {},
          conversationMessages: [],
          conversationToolTraces: [],
          lastConversationReset: null,
          ...parsed,
          version: 5,
        };
        if (normalized.token) {
          // Strip legacy plaintext token persistence from the local DB row.
          await writePersistedState(normalized);
        }
        return normalized;
      }
      if (parsed.version === 4 || parsed.version === 5) {
        const normalized: PersistedState = {
          sharedFileDrafts: [],
          voiceClipUri: null,
          voiceClipDurationMs: 0,
          assistantCommand: DEFAULT_HOME_DRAFT,
          assistantHistory: [],
          assistantVoiceJobs: [],
          assistantAiJobs: [],
          conversationTitle: "Assistant Thread",
          conversationSessionState: {},
          conversationMessages: [],
          conversationToolTraces: [],
          lastConversationReset: null,
          ...parsed,
          homeDraft: parsed.homeDraft ?? parsed.assistantCommand ?? DEFAULT_HOME_DRAFT,
          notesInstructionDraft: parsed.notesInstructionDraft ?? parsed.assistantCommand ?? DEFAULT_NOTES_INSTRUCTION_DRAFT,
          voiceRoutePreference: normalizeVoiceRoutePreference(parsed.voiceRoutePreference),
          briefingPlaybackPreference: normalizeBriefingPlaybackPreference(parsed.briefingPlaybackPreference),
          version: 5,
        };
        if (normalized.token) {
          // Strip legacy plaintext token persistence from the local DB row.
          await writePersistedState(normalized);
        }
        return normalized;
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
      version: 5,
      sharedFileDrafts: [],
      voiceClipUri: null,
      voiceClipDurationMs: 0,
      artifacts: [],
      selectedArtifactId: "",
      artifactGraph: null,
      artifactVersions: null,
      dueCards: [],
      executionPolicy: defaultExecutionPolicy(),
      voiceRoutePreference: DEFAULT_VOICE_ROUTE_PREFERENCE,
      briefingPlaybackPreference: DEFAULT_BRIEFING_PLAYBACK_PREFERENCE,
      homeDraft: DEFAULT_HOME_DRAFT,
      notesInstructionDraft: DEFAULT_NOTES_INSTRUCTION_DRAFT,
      assistantCommand: DEFAULT_HOME_DRAFT,
      assistantHistory: [],
      assistantVoiceJobs: [],
      assistantAiJobs: [],
      conversationTitle: "Assistant Thread",
      conversationSessionState: {},
      conversationMessages: [],
      conversationToolTraces: [],
      lastConversationReset: null,
    };
    await writePersistedState(migrated);
    await FileSystem.deleteAsync(file, { idempotent: true });
    return migrated;
  } catch {
    return null;
  }
}

async function writePersistedState(payload: PersistedState): Promise<void> {
  const sanitized: PersistedState = {
    ...payload,
    token: "",
  };
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
    JSON.stringify(sanitized),
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

type ParsedAppDeepLink = {
  params: Record<string, string>;
  route: string;
  scheme: string;
};

type AppProps = {
  initialIntentUrl?: string | null;
};

const APP_LINK_DEDUP_WINDOW_MS = 1500;

const SUPPORTED_MOBILE_DEEP_LINK_SCHEMES = new Set([
  "starlog",
  "exp+starlog",
  "com.starlog.app.dev",
  "com.starlog.app.preview",
]);

async function resolveInitialDeepLinkUrl(
  attempts = 8,
  delayMs = 250,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const initialUrl =
      Platform.OS === "android" ? (await getCurrentIntentUrl()) ?? (await Linking.getInitialURL()) : await Linking.getInitialURL();
    if (initialUrl) {
      return initialUrl;
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

function decodeDeepLinkParam(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function parseDeepLinkParams(rawQuery: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!rawQuery) {
    return params;
  }
  for (const segment of rawQuery.split("&")) {
    if (!segment) {
      continue;
    }
    const [rawKey, ...rawValueParts] = segment.split("=");
    const key = decodeDeepLinkParam(rawKey ?? "").trim();
    if (!key || key in params) {
      continue;
    }
    params[key] = decodeDeepLinkParam(rawValueParts.join("="));
  }
  return params;
}

function deepLinkParam(params: Record<string, string>, key: string): string | null {
  return params[key] ?? null;
}

function parseAppDeepLink(rawUrl: string, depth = 0): ParsedAppDeepLink | null {
  if (depth > 3) {
    return null;
  }
  const trimmedUrl = rawUrl.trim();
  const match = trimmedUrl.match(/^([a-z][a-z0-9+.-]*):\/\/([^?#]*)(?:\?([^#]*))?/i);
  if (!match) {
    return null;
  }
  const scheme = match[1]?.toLowerCase() ?? "";
  if (!SUPPORTED_MOBILE_DEEP_LINK_SCHEMES.has(scheme)) {
    return null;
  }

  const route = (match[2] ?? "")
    .replace(/^\/+/, "")
    .split("/")[0]
    ?.trim()
    .toLowerCase();
  const params = parseDeepLinkParams(match[3] ?? "");

  const nestedUrl = deepLinkParam(params, "url");
  if (nestedUrl && nestedUrl !== trimmedUrl) {
    const parsedNested = parseAppDeepLink(nestedUrl, depth + 1);
    if (parsedNested) {
      return parsedNested;
    }
  }

  if (!route) {
    return null;
  }
  return { scheme, route, params };
}

function parseCaptureDeepLink(rawUrl: string): { title: string; text: string; sourceUrl: string } | null {
  const parsedUrl = parseAppDeepLink(rawUrl);
  if (!parsedUrl || parsedUrl.route !== "capture") {
    return null;
  }
  const { params } = parsedUrl;
  const text = (deepLinkParam(params, "text") ?? deepLinkParam(params, "content") ?? "").trim();
  if (!text) {
    return null;
  }

  return {
    title: (deepLinkParam(params, "title") ?? DEFAULT_CAPTURE_TITLE).trim() || DEFAULT_CAPTURE_TITLE,
    text,
    sourceUrl: (deepLinkParam(params, "source_url") ?? deepLinkParam(params, "url") ?? "").trim(),
  };
}

function parseSurfaceTabDeepLink(rawUrl: string): MobileTab | null {
  const parsedUrl = parseAppDeepLink(rawUrl);
  if (!parsedUrl || parsedUrl.route !== "surface") {
    return null;
  }
  const { params } = parsedUrl;
  const rawTab = (deepLinkParam(params, "tab") ?? "").trim().toLowerCase();
  return mobileTabFromParam(rawTab);
}

export default function App({ initialIntentUrl = null }: AppProps) {
  const palette = usePalette();
  const styles = useMemo(() => themedStyles(palette), [palette]);
  const mainScrollViewRef = useRef<ScrollView>(null);
  const [activeTab, setActiveTab] = useState<MobileTab>("assistant");
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [countdownTick, setCountdownTick] = useState(() => Date.now());
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showAdvancedCapture, setShowAdvancedCapture] = useState(false);
  const [showAdvancedAlarms, setShowAdvancedAlarms] = useState(false);
  const [showAdvancedReview, setShowAdvancedReview] = useState(false);
  const [captureOpsSection, setCaptureOpsSection] = useState<"queue" | "assistant" | "routing" | "triage">("queue");
  const [reviewOpsSection, setReviewOpsSection] = useState<"session" | "triage">("session");
  const [alarmOpsSection, setAlarmOpsSection] = useState<"briefing" | "link">("briefing");
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
  const [voiceClipTarget, setVoiceClipTarget] = useState<VoiceClipTarget | null>(null);
  const [localSttAvailable, setLocalSttAvailable] = useState(false);
  const [localSttListening, setLocalSttListening] = useState(false);
  const [briefingDate, setBriefingDate] = useState(tomorrowDateString());
  const [cachedPath, setCachedPath] = useState<string | null>(null);
  const [voiceRoutePreference, setVoiceRoutePreference] = useState<VoiceRoutePreference>(DEFAULT_VOICE_ROUTE_PREFERENCE);
  const [briefingPlaybackPreference, setBriefingPlaybackPreference] = useState<BriefingPlaybackPreference>(
    DEFAULT_BRIEFING_PLAYBACK_PREFERENCE,
  );
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
  const [reviewDecks, setReviewDecks] = useState<CardDeckSummary[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewSessionStats>({ reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 });
  const [executionPolicy, setExecutionPolicy] = useState<ExecutionPolicy>(() => defaultExecutionPolicy());
  const [authPassphrase, setAuthPassphrase] = useState("");
  const [authBusy, setAuthBusy] = useState<"login" | "bootstrap" | null>(null);
  const [authRevealPassphrase, setAuthRevealPassphrase] = useState(false);
  const [homeDraft, setHomeDraft] = useState(DEFAULT_HOME_DRAFT);
  const [notesInstructionDraft, setNotesInstructionDraft] = useState(DEFAULT_NOTES_INSTRUCTION_DRAFT);
  const [assistantCommand, setAssistantCommand] = useState(DEFAULT_HOME_DRAFT);
  const [assistantHistory, setAssistantHistory] = useState<AssistantCommandResponse[]>([]);
  const [assistantVoiceJobs, setAssistantVoiceJobs] = useState<AssistantVoiceJob[]>([]);
  const [assistantAiJobs, setAssistantAiJobs] = useState<AssistantQueuedJob[]>([]);
  const [conversationTitle, setConversationTitle] = useState("Assistant Thread");
  const [conversationSessionState, setConversationSessionState] = useState<Record<string, unknown>>({});
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [conversationToolTraces, setConversationToolTraces] = useState<ConversationToolTrace[]>([]);
  const [lastConversationReset, setLastConversationReset] = useState<ConversationSessionResetResponse | null>(null);
  const [pendingConversationTurn, setPendingConversationTurn] = useState<PendingConversationTurn | null>(null);
  const [expandedThreadCards, setExpandedThreadCards] = useState<Record<string, boolean>>({});
  const [expandedThreadTraces, setExpandedThreadTraces] = useState<Record<string, boolean>>({});
  const [showFullConversationThread, setShowFullConversationThread] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState("unknown");
  const [status, setStatus] = useState("Ready");
  const [hydrated, setHydrated] = useState(false);
  const flushInFlight = useRef(false);
  const voiceRecordingRef = useRef<Audio.Recording | null>(null);
  const captureHoldActive = useRef(false);
  const lastShareFingerprint = useRef<{ value: string; processedAt: number } | null>(null);
  const cardPromptStartedAt = useRef<number | null>(null);
  const briefingSoundRef = useRef<Audio.Sound | null>(null);
  const lastHandledAppLink = useRef<{ handledAt: number; url: string } | null>(null);
  const {
    hasShareIntent,
    shareIntent,
    resetShareIntent,
    error: shareIntentError,
  } = useShareIntent({
    disabled: false,
    resetOnBackground: false,
  });
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;
  const isAssistantMode = activeTab === "assistant";
  const captureVoiceRecording = Boolean(voiceRecording) && voiceClipTarget === "capture";
  const captureVoiceClipReady = Boolean(voiceClipUri) && voiceClipTarget === "capture";
  const assistantVoiceActionState =
    localSttListening
      ? "listening"
      : Boolean(voiceRecording) && voiceClipTarget === "assistant"
        ? "recording"
        : Boolean(voiceClipUri) && voiceClipTarget === "assistant"
          ? "ready"
          : "idle";
  const assistantVoiceActionHint =
    assistantVoiceActionState === "listening"
      ? "Listening for an on-device message..."
      : assistantVoiceActionState === "recording"
        ? "Recording voice input. Tap the mic again to stop."
        : assistantVoiceActionState === "ready"
          ? "Voice clip ready. Tap the mic to send it as an Assistant command, or clear it."
          : null;
  const threadMessages = useMemo(() => {
    if (!pendingConversationTurn) {
      return conversationMessages;
    }
    return [
      ...conversationMessages,
      {
        id: pendingConversationTurn.id,
        thread_id: "primary",
        role: "user" as const,
        content: pendingConversationTurn.content,
        cards: [],
        metadata: { pending: true, submitted_via: "mobile_home" },
        created_at: pendingConversationTurn.createdAt,
      },
      {
        id: `${pendingConversationTurn.id}:assistant`,
        thread_id: "primary",
        role: "assistant" as const,
        content: "",
        cards: [],
        metadata: { pending: true, status: "thinking" },
        created_at: pendingConversationTurn.createdAt,
      },
    ];
  }, [conversationMessages, pendingConversationTurn]);
  const visibleConversationMessages = useMemo(() => {
    if (showFullConversationThread) {
      return threadMessages;
    }
    return threadMessages.slice(-DEFAULT_MOBILE_THREAD_VISIBLE_MESSAGES);
  }, [showFullConversationThread, threadMessages]);
  const hiddenConversationMessageCount = Math.max(0, threadMessages.length - visibleConversationMessages.length);
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
    () => {
      const resolution = resolveExecutionTargetFromOrder(
        sttOrderForPreference(executionPolicy, voiceRoutePreference),
        sttTargets,
        sttTargets[0] ?? "batch_local_bridge",
        sttFallbackReason(localSttAvailable),
      );
      if (voiceRoutePreference === "shared_policy") {
        return resolution;
      }
      const overrideNote =
        voiceRoutePreference === "on_device_first"
          ? "Voice override is preferring on-device STT on mobile."
          : "Voice override is preferring the laptop bridge queue before other STT routes.";
      return {
        ...resolution,
        reason: resolution.reason ? `${overrideNote} ${resolution.reason}` : overrideNote,
      };
    },
    [executionPolicy, localSttAvailable, sttTargets, voiceRoutePreference],
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
  const stationHour12 = ((alarmHour + 11) % 12) + 1;
  const stationPeriod = alarmHour >= 12 ? "PM" : "AM";
  const nextBriefingCountdown = useMemo(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(alarmHour, alarmMinute, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    const totalMinutes = Math.floor((next.getTime() - now.getTime()) / 60000);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }, [alarmHour, alarmMinute, countdownTick]);
  const reviewCard = dueCards[0];
  const reviewCardTypeLabel = reviewCard ? reviewCard.card_type.replace(/_/g, " ").toUpperCase() : "QUEUE IDLE";
  const reviewMetaLabel = reviewCard
    ? `Due ${new Date(reviewCard.due_at).toLocaleString()}`
    : (token ? "Load due cards to start a focused pass." : "Add API credentials to load the review queue.");
  const reviewRetentionLabel = reviewStats.reviewed > 0
    ? `${Math.round(((reviewStats.good + reviewStats.easy) / reviewStats.reviewed) * 100)}%`
    : "0%";

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCountdownTick(Date.now());
    }, 30_000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    voiceRecordingRef.current = voiceRecording;
  }, [voiceRecording]);

  useEffect(() => {
    if (activeTab !== "assistant" && assistantPanelOpen) {
      setAssistantPanelOpen(false);
    }
  }, [activeTab, assistantPanelOpen]);

  function applyDeepCapture(deepCapture: { title: string; text: string; sourceUrl: string }) {
    setActiveTab("library");
    setShowAdvancedCapture(true);
    setQuickCaptureTitle(deepCapture.title);
    setQuickCaptureText(deepCapture.text);
    setQuickCaptureSourceUrl(deepCapture.sourceUrl);
    setSharedFileDrafts([]);
    setVoiceClipUri(null);
    setVoiceClipDurationMs(0);
    setCaptureOpsSection("queue");
    setStatus("Loaded capture from share deep link");
  }

  function handleAppLink(rawUrl: string): boolean {
    const normalizedUrl = rawUrl.trim();
    const now = Date.now();
    if (
      !normalizedUrl ||
      (lastHandledAppLink.current &&
        lastHandledAppLink.current.url === normalizedUrl &&
        now - lastHandledAppLink.current.handledAt < APP_LINK_DEDUP_WINDOW_MS)
    ) {
      return false;
    }

    let handled = false;
    const requestedTab = parseSurfaceTabDeepLink(normalizedUrl);
    if (requestedTab) {
      setActiveTab(requestedTab);
      setStatus(`Opened ${mobileTabLabel(requestedTab)}`);
      handled = true;
    }

    const deepCapture = parseCaptureDeepLink(normalizedUrl);
    if (deepCapture) {
      applyDeepCapture(deepCapture);
      handled = true;
    }

    if (handled) {
      lastHandledAppLink.current = { handledAt: now, url: normalizedUrl };
      if (Platform.OS === "android") {
        clearCurrentIntentUrl().catch(() => undefined);
      }
    }
    return handled;
  }

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
      setStatus(error instanceof Error ? error.message : "Failed to open Library detail");
    }
  }

  async function openNoteInPwa(noteId: string) {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}/notes?note=${encodeURIComponent(noteId)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open note detail");
    }
  }

  async function openTaskInPwa(taskId: string) {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}/tasks?task=${encodeURIComponent(taskId)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open task detail");
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

  async function submitPrimaryCapture() {
    if (captureVoiceClipReady) {
      await submitVoiceCapture();
      return;
    }

    await submitQuickCapture();
  }

  function clearVoiceClip(target?: VoiceClipTarget) {
    if (target && voiceClipTarget !== target) {
      return;
    }
    setVoiceClipUri(null);
    setVoiceClipDurationMs(0);
    setVoiceClipTarget(null);
  }

  async function startVoiceRecording(target: VoiceClipTarget) {
    if (voiceRecordingRef.current) {
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
      voiceRecordingRef.current = recording;
      setVoiceRecording(recording);
      setSharedFileDrafts([]);
      clearVoiceClip();
      setVoiceClipTarget(target);
      setStatus(target === "assistant" ? "Recording an Assistant voice message..." : "Recording voice note...");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to start voice recording");
    }
  }

  async function stopVoiceRecording() {
    const activeRecording = voiceRecordingRef.current ?? voiceRecording;
    if (!activeRecording) {
      setStatus("No voice recording is in progress");
      return;
    }

    try {
      await activeRecording.stopAndUnloadAsync();
      const status = await activeRecording.getStatusAsync();
      const uri = activeRecording.getURI();
      voiceRecordingRef.current = null;
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
      setStatus(voiceClipTarget === "assistant" ? "Assistant voice clip ready" : "Voice note ready to upload or queue");
    } catch (error) {
      voiceRecordingRef.current = null;
      setVoiceRecording(null);
      setStatus(error instanceof Error ? error.message : "Failed to stop voice recording");
    }
  }

  async function beginHoldToTalkCapture() {
    captureHoldActive.current = true;
    if (voiceRecordingRef.current) {
      return;
    }
    await startVoiceRecording("capture");
    if (!captureHoldActive.current && voiceRecordingRef.current) {
      await stopVoiceRecording();
    }
  }

  async function endHoldToTalkCapture() {
    captureHoldActive.current = false;
    if (voiceRecordingRef.current) {
      await stopVoiceRecording();
    }
  }

  async function submitVoiceCapture() {
    if (!voiceClipUri) {
      setStatus("Record a voice note first");
      return;
    }
    if (voiceClipTarget === "assistant") {
      setStatus("An Assistant voice clip is ready. Send or clear it from Assistant before using capture upload.");
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
      clearVoiceClip("capture");
      return;
    }

    try {
      const artifactId = await sendCapture(capture);
      clearVoiceClip("capture");
      setSelectedArtifactId(artifactId);
      loadArtifacts().catch(() => undefined);
      setStatus(`Queued voice note ${artifactId} for transcription`);
    } catch (error) {
      queueCapture(capture, error instanceof Error ? error.message : "voice upload failed");
      clearVoiceClip("capture");
    }
  }

  async function loadReviewDecks() {
    try {
      if (!token) {
        setReviewDecks([]);
        return;
      }
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/cards/decks`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Deck fetch failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as CardDeckSummary[];
      setReviewDecks(payload);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load review decks");
    }
  }

  async function loginObservatorySession() {
    if (authPassphrase.trim().length < 8) {
      setStatus("Use at least 8 characters for the passphrase");
      return;
    }

    setAuthBusy("login");
    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passphrase: authPassphrase.trim() }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Login failed: ${response.status} ${errorBody}`);
      }

      const payload = (await response.json()) as { access_token: string };
      setToken(payload.access_token);
      setStatus("Starlog is ready on mobile");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Login failed");
    } finally {
      setAuthBusy(null);
    }
  }

  async function bootstrapObservatorySession() {
    if (authPassphrase.trim().length < 12) {
      setStatus("Setup requires a passphrase of at least 12 characters");
      return;
    }

    setAuthBusy("bootstrap");
    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/auth/bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passphrase: authPassphrase.trim() }),
      });

      if (response.status !== 201 && response.status !== 409) {
        const errorBody = await response.text();
        throw new Error(`Bootstrap failed: ${response.status} ${errorBody}`);
      }

      await loginObservatorySession();
      setStatus(response.status === 201 ? "Starlog is set up on this device" : "Starlog was already set up. Session refreshed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bootstrap failed");
    } finally {
      setAuthBusy(null);
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
      void loadReviewDecks();
      setReviewStats({ reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 });
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
      setReviewStats((previous) => ({
        reviewed: previous.reviewed + 1,
        again: previous.again + (rating === 1 ? 1 : 0),
        hard: previous.hard + (rating === 3 ? 1 : 0),
        good: previous.good + (rating === 4 ? 1 : 0),
        easy: previous.easy + (rating === 5 ? 1 : 0),
      }));
      setShowAnswer(false);
      cardPromptStartedAt.current = remaining.length > 0 ? Date.now() : null;
      void loadReviewDecks();
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

  async function playCachedBriefing() {
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

  async function refreshCacheAndPlayBriefing() {
    try {
      if (!token) {
        setStatus("Add API token first");
        return;
      }
      const baseUrl = normalizeBaseUrl(apiBase);
      const briefing = await loadBriefingFromApi(baseUrl, token, briefingDate);
      const path = await cacheBriefing(baseUrl, token, briefing);
      setCachedPath(path);
      const cachedBriefing = await readCachedBriefing(path);
      await playBriefingPayload(cachedBriefing, "cached");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to refresh and play briefing");
    }
  }

  async function playBriefing() {
    if (briefingPlaybackPreference === "refresh_then_cache") {
      await refreshCacheAndPlayBriefing();
      return;
    }
    await playCachedBriefing();
  }

  async function playVoiceClip() {
    if (!voiceClipUri) {
      setStatus("Record a voice clip first");
      return;
    }

    try {
      const info = await FileSystem.getInfoAsync(voiceClipUri);
      if (!info.exists) {
        setStatus("Voice clip file not found");
        return;
      }
      if (briefingSoundRef.current) {
        await briefingSoundRef.current.unloadAsync();
        briefingSoundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri: voiceClipUri }, { shouldPlay: true });
      briefingSoundRef.current = sound;
      setStatus(
        voiceClipDurationMs > 0
          ? `Playing recorded voice clip (${Math.round(voiceClipDurationMs / 1000)}s)`
          : "Playing recorded voice clip",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to play recorded voice clip");
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

  const holdToTalkLabel = captureVoiceRecording ? "Release to stop" : "Hold to talk";
  const offlineBriefingStatus = cachedPath
    ? `Offline briefing cached for ${briefingDate}`
    : "No offline briefing cached yet";
  const briefingPlaybackStatus =
    briefingPlaybackPreference === "offline_first"
      ? "Playback preference: use the cached offline package first."
      : "Playback preference: refresh from the API, recache, then play.";
  const captureCommandPreview = notesInstructionDraft.trim() || DEFAULT_NOTES_INSTRUCTION_DRAFT;
  const captureSourcePreview = quickCaptureSourceUrl.trim() || "Attach a source URL, title, excerpt, or one spoken instruction.";
  const captureBodyPreview =
    quickCaptureText.trim()
    || (sharedFileDrafts.length > 0
      ? describeSharedDrafts(sharedFileDrafts)
      : selectedArtifact?.title || "Article URL, title, excerpt, and one spoken instruction travel together.");
  const captureQueuePreview =
    pendingCaptures.length > 0 ? `${pendingCaptures.length} capture item(s) waiting to sync.` : "No queued captures right now.";
  const routeNarrative =
    sttResolution.active === "on_device"
      ? "Phone-local STT/TTS first, then bridge or hosted fallback."
      : sttFallbackReason(localSttAvailable);
  const briefingHeroCopy = cachedPath
    ? "Your day, condensed into one elegant ritual."
    : "Cache the brief first, then let one next action carry the day.";
  const nextActionPreview =
    dueCards[0]?.prompt || selectedArtifact?.title || "Promote one note, one task, or one card after playback.";
  const voiceMemoPreview = captureVoiceClipReady ? `${Math.round(voiceClipDurationMs / 1000)}s voice memo ready` : "No voice memo recorded yet.";

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
      setStatus(error instanceof Error ? error.message : "Failed to open the desktop web fallback");
    }
  }

  async function openIntegrationsInPwa() {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}/integrations`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open integrations in desktop web");
    }
  }

  async function openAssistantInPwa() {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}/assistant`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open Assistant in desktop web");
    }
  }

  async function openReviewWorkspaceInPwa() {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}/review/decks`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open Review in desktop web");
    }
  }

  async function openWebPath(path: string, failureLabel: string) {
    try {
      await Linking.openURL(`${normalizeBaseUrl(pwaBase)}${path.startsWith("/") ? path : `/${path}`}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : failureLabel);
    }
  }

  function reuseConversationCardText(value: string) {
    const prompt = value.trim();
    if (!prompt) {
      return;
    }
    setActiveTab("assistant");
    setHomeDraft(prompt);
    setStatus("Loaded card text into Assistant");
  }

  async function handleConversationCardAction(action: AssistantCardAction, card: ConversationCard) {
    if (action.kind === "navigate") {
      const href = typeof action.payload?.href === "string" ? action.payload.href : "";
      if (!href) {
        setStatus(`Action "${action.label}" is missing a destination`);
        return;
      }
      if (href === "/assistant" || href.startsWith("/assistant?")) {
        setActiveTab("assistant");
        setStatus(`${PRODUCT_SURFACES.assistant.label} ready`);
        return;
      }
      if (href === "/review" || href.startsWith("/review")) {
        setActiveTab("review");
        setStatus(`${PRODUCT_SURFACES.review.label} ready`);
        return;
      }
      if (href === "/planner" || href.startsWith("/planner")) {
        setActiveTab("planner");
        setStatus(`${PRODUCT_SURFACES.planner.label} ready`);
        return;
      }
      if (href === "/notes" || href.startsWith("/notes?") || href.startsWith("/notes/")) {
        setActiveTab("library");
        setStatus(`${PRODUCT_SURFACES.library.label} ready`);
        return;
      }
      await openWebPath(href, `Failed to open ${action.label.toLowerCase()}`);
      return;
    }

    if (action.kind === "composer") {
      const prompt = typeof action.payload?.prompt === "string" ? action.payload.prompt : card.body || card.title || "";
      setActiveTab("assistant");
      setHomeDraft(prompt);
      setStatus(`Loaded "${action.label}" into Assistant`);
      return;
    }

    const endpoint = typeof action.payload?.endpoint === "string" ? action.payload.endpoint : "";
    const method = typeof action.payload?.method === "string" ? action.payload.method : "POST";
    const body = action.payload?.body ?? {};
    if (!endpoint) {
      setStatus(`Action "${action.label}" is missing an endpoint`);
      return;
    }
    setStatus(`${action.label}...`);
    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`${action.label} failed: ${response.status} ${errorBody}`);
      }
      await loadConversation("auto");
      if (card.kind === "capture_item" || card.kind === "knowledge_note") {
        loadArtifacts().catch(() => undefined);
      }
      if (card.kind === "review_queue") {
        loadDueCards().catch(() => undefined);
      }
      setStatus(`${action.label} complete`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${action.label} failed`);
    }
  }

  async function sendConversationTurn(command: string, sourceLabel = "typed composer") {
    if (!command) {
      setStatus("Enter an Assistant message first");
      return;
    }
    if (pendingConversationTurn) {
      setStatus("Wait for the current Assistant reply to finish");
      return;
    }
    if (!token) {
      setStatus("Add API token first");
      return;
    }

    const pendingId = `pending_${Date.now()}`;
    setPendingConversationTurn({
      id: pendingId,
      content: command,
      createdAt: new Date().toISOString(),
    });

    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/conversations/primary/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: command,
          input_mode: sourceLabel === "voice" ? "voice" : "text",
          device_target: "mobile-native",
          metadata: {
            surface: "assistant_mobile",
            submitted_via: sourceLabel,
          },
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Assistant turn failed: ${response.status} ${errorBody}`);
      }

      const payload = (await response.json()) as ConversationTurnResponse;
      setConversationMessages((previous) => [...previous, payload.user_message, payload.assistant_message]);
      setConversationToolTraces((previous) => [payload.trace, ...previous].slice(0, 24));
      setConversationSessionState(payload.session_state);
      setHomeDraft("");
      setPendingConversationTurn(null);
      setStatus("Assistant reply received");
    } catch (error) {
      setPendingConversationTurn(null);
      setStatus(error instanceof Error ? error.message : "Assistant turn failed");
    }
  }

  async function submitAssistantCommand(command: string, execute: boolean, sourceLabel?: string) {
    if (!command) {
      setStatus("Enter an Assistant command first");
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
          device_target: "mobile-native",
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
      loadConversation("auto").catch(() => undefined);
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

  async function runAssistantTurn() {
    const command = homeDraft.trim();
    await sendConversationTurn(command);
  }

  async function previewHomeDraftCommandFlow() {
    const command = homeDraft.trim();
    await submitAssistantCommand(command, false);
  }

  function recordAssistantHistory(entry: AssistantCommandResponse | null | undefined) {
    if (!entry) {
      return;
    }
    setAssistantHistory((previous) => [entry, ...previous.filter((item) => item.command !== entry.command || item.planner !== entry.planner)].slice(0, 6));
  }

  async function loadConversation(origin: "auto" | "manual") {
    if (!token) {
      if (origin === "manual") {
        setStatus("Add API token first");
      }
      return;
    }

    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/conversations/primary`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Conversation fetch failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as ConversationSnapshot;
      setConversationTitle(payload.title);
      setConversationSessionState(payload.session_state);
      setConversationMessages(payload.messages);
      setConversationToolTraces(payload.tool_traces);
      const completedCommand = [...payload.messages]
        .reverse()
        .map((message) => message.metadata?.assistant_command)
        .find((message): message is AssistantCommandResponse => !!message);
      if (completedCommand) {
        recordAssistantHistory(completedCommand);
      }
      if (origin === "manual") {
        setStatus(`Loaded ${payload.title}`);
      }
    } catch (error) {
      if (origin === "manual") {
        setStatus(error instanceof Error ? error.message : "Failed to load conversation");
      }
    }
  }

  async function resetConversationSession() {
    if (!token) {
      setStatus("Add API token first");
      return;
    }

    try {
      const response = await fetch(`${normalizeBaseUrl(apiBase)}/v1/conversations/primary/session/reset`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Conversation reset failed: ${response.status} ${errorBody}`);
      }
      const payload = (await response.json()) as ConversationSessionResetResponse;
      setConversationSessionState(payload.session_state);
      setLastConversationReset(payload);
      const clearedKeys = payload.cleared_keys ?? Object.keys(conversationSessionState);
      const preservedMessageCount = payload.preserved_message_count ?? conversationMessages.length;
      const preservedTraceCount = payload.preserved_tool_trace_count ?? conversationToolTraces.length;
      const clearedLabel =
        clearedKeys.length > 0 ? `${clearedKeys.length} key${clearedKeys.length === 1 ? "" : "s"} cleared` : "Session already empty";
      setStatus(
        `${clearedLabel}; kept ${preservedMessageCount} messages and ${preservedTraceCount} traces`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to clear conversation state");
    }
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
        loadConversation("auto").catch(() => undefined);
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
        loadConversation("auto").catch(() => undefined);
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
      setStatus("Enter an Assistant command first");
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
          device_target: "mobile-native",
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
    if (voiceClipUri) {
      setStatus(
        voiceClipTarget === "capture"
          ? "A Library voice note is ready. Upload it in Library or clear it before starting Assistant STT."
          : "An Assistant voice clip is ready. Send it or clear it before starting on-device STT.",
      );
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

      setHomeDraft(transcript);
      await submitAssistantCommand(transcript, execute, "on-device STT");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "On-device STT failed");
    } finally {
      setLocalSttListening(false);
    }
  }

  async function submitLocalVoiceConversationTurn() {
    if (localSttListening) {
      setStatus("On-device STT is already listening");
      return;
    }
    if (!token) {
      setStatus("Add API token first");
      return;
    }
    if (!localSttAvailable || sttResolution.active !== "on_device") {
      setStatus("On-device STT is unavailable; use the recording fallback.");
      return;
    }
    if (voiceRecording) {
      setStatus("Stop the current voice recording before starting on-device STT");
      return;
    }
    if (voiceClipUri) {
      setStatus(
        voiceClipTarget === "capture"
          ? "A Library voice note is ready. Upload it in Library or clear it before using Assistant voice."
          : "An Assistant voice clip is ready. Send it or clear it before starting on-device STT.",
      );
      return;
    }

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setStatus("Microphone permission denied");
        return;
      }

      setLocalSttListening(true);
      setStatus("Listening for an Assistant message...");
      const transcriptPayload = await recognizeSpeechOnce({
        prompt: "Speak your message for Assistant",
      });
      const transcript = transcriptPayload.transcript.trim();
      if (!transcript) {
        throw new Error("On-device STT returned no transcript");
      }
      setHomeDraft(transcript);
      await sendConversationTurn(transcript, "voice");
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
    if (voiceClipTarget === "capture") {
      setStatus("A Library voice note is ready. Upload it in Library or clear it before sending an Assistant voice command.");
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
      formData.append("device_target", "mobile-native");
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
      clearVoiceClip("assistant");
      setStatus(`Queued voice command ${payload.id} via ${formatExecutionTarget(sttResolution.active)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Voice command upload failed");
    }
  }

  function clearAssistantVoiceAction() {
    if (localSttListening) {
      setStatus("Wait for on-device listening to finish");
      return;
    }
    clearVoiceClip("assistant");
    setStatus("Cleared Assistant voice clip");
  }

  async function handleAssistantVoiceAction() {
    if (pendingConversationTurn) {
      setStatus("Wait for the current Assistant reply to finish");
      return;
    }
    if (sttResolution.active === "on_device") {
      await submitLocalVoiceConversationTurn();
      return;
    }
    if (voiceRecording) {
      if (voiceClipTarget !== "assistant") {
        setStatus("A Library voice note is recording. Finish it in Library before recording for Assistant.");
        return;
      }
      await stopVoiceRecording();
      return;
    }
    if (voiceClipUri) {
      if (voiceClipTarget !== "assistant") {
        setStatus("A Library voice note is ready. Upload it in Library or clear it before using Assistant voice.");
        return;
      }
      await submitVoiceAssistantCommand(true);
      return;
    }
    await startVoiceRecording("assistant");
  }

  useEffect(() => {
    let active = true;

    async function initialize() {
      const initialUrlPromise = initialIntentUrl ? Promise.resolve(initialIntentUrl) : resolveInitialDeepLinkUrl();
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
      const secureToken = await readSecureToken();
      const recoveredToken = secureToken || persisted?.token || "";
      if (!secureToken && persisted?.token) {
        await writeSecureToken(persisted.token);
      }

      if (active && persisted) {
        setApiBase(persisted.apiBase || DEFAULT_API_BASE);
        setPwaBase(persisted.pwaBase || DEFAULT_PWA_BASE);
        setToken(recoveredToken);
        setQuickCaptureTitle(persisted.quickCaptureTitle);
        setQuickCaptureText(persisted.quickCaptureText);
        setQuickCaptureSourceUrl(persisted.quickCaptureSourceUrl);
        setSharedFileDrafts(persisted.sharedFileDrafts || []);
        setVoiceClipUri(persisted.voiceClipUri ?? null);
        setVoiceClipDurationMs(persisted.voiceClipDurationMs ?? 0);
        setVoiceClipTarget(persisted.voiceClipTarget ?? (persisted.voiceClipUri ? "capture" : null));
        setBriefingDate(persisted.briefingDate);
        setCachedPath(persisted.cachedPath);
        setVoiceRoutePreference(normalizeVoiceRoutePreference(persisted.voiceRoutePreference));
        setBriefingPlaybackPreference(normalizeBriefingPlaybackPreference(persisted.briefingPlaybackPreference));
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
        setHomeDraft(persisted.homeDraft || persisted.assistantCommand || DEFAULT_HOME_DRAFT);
        setNotesInstructionDraft(
          persisted.notesInstructionDraft || persisted.assistantCommand || DEFAULT_NOTES_INSTRUCTION_DRAFT,
        );
        setAssistantCommand(persisted.assistantCommand || DEFAULT_HOME_DRAFT);
        setAssistantHistory(persisted.assistantHistory || []);
        setAssistantVoiceJobs(persisted.assistantVoiceJobs || []);
        setAssistantAiJobs(persisted.assistantAiJobs || []);
        setConversationTitle(persisted.conversationTitle || "Assistant Thread");
        setConversationSessionState(persisted.conversationSessionState || {});
        setConversationMessages(persisted.conversationMessages || []);
        setConversationToolTraces(persisted.conversationToolTraces || []);
        setLastConversationReset(persisted.lastConversationReset ?? null);
      } else if (active && recoveredToken) {
        setToken(recoveredToken);
      }

      const initialUrl = await initialUrlPromise;
      if (active && initialUrl) {
        handleAppLink(initialUrl);
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
      handleAppLink(event.url);
    });
    const nativeLinkSubscription =
      Platform.OS === "android"
        ? DeviceEventEmitter.addListener("StarlogAppLink", (nextUrl: unknown) => {
            if (typeof nextUrl === "string") {
              handleAppLink(nextUrl);
            }
          })
        : null;

    const linkPollingInterval =
      Platform.OS === "android"
        ? setInterval(() => {
            Linking.getInitialURL()
              .then(async (url) => {
                const nextUrl = (await getCurrentIntentUrl()) ?? url;
                if (!active || !nextUrl) {
                  return;
                }
                handleAppLink(nextUrl);
              })
              .catch(() => {
                getCurrentIntentUrl()
                  .then((url) => {
                    if (!active || !url) {
                      return;
                    }
                    handleAppLink(url);
                  })
                  .catch(() => undefined);
              });
          }, 1000)
        : null;

    return () => {
      active = false;
      notificationSubscription.remove();
      linkSubscription.remove();
      nativeLinkSubscription?.remove();
      if (linkPollingInterval) {
        clearInterval(linkPollingInterval);
      }
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
    const payload = shareIntent as IncomingShareIntent;
    if (!hasMeaningfulIncomingShareIntent(payload)) {
      resetShareIntent();
      return;
    }
    const fingerprint = incomingShareIntentFingerprint(payload);
    const previous = lastShareFingerprint.current;
    const now = Date.now();
    if (previous && previous.value === fingerprint && now - previous.processedAt < 15000) {
      // Some share-extension callbacks can fire more than once while the app resumes.
      resetShareIntent();
      return;
    }
    lastShareFingerprint.current = { value: fingerprint, processedAt: now };

    let cancelled = false;

    async function applyIncomingShareIntent() {
      const sharedText = (payload.text ?? "").trim();
      const sharedUrl = (payload.webUrl ?? "").trim();
      const shareFiles = payload.files ?? [];
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
        (payload.meta?.title ?? "").trim() ||
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
        setStatus(`Loaded ${shareSourcePlatformLabel()} shared audio into the companion app`);
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
        setStatus(`Loaded ${shareFiles.length} ${shareSourcePlatformLabel()} shared files into quick capture`);
      } else {
        setStatus(
          firstFile
            ? `Loaded ${shareSourcePlatformLabel()} shared file into quick capture`
            : "Loaded shared text/url into quick capture",
        );
      }
      resetShareIntent();
    }

    applyIncomingShareIntent().catch((error) => {
      if (cancelled) {
        return;
      }
      lastShareFingerprint.current = null;
      setStatus(error instanceof Error ? error.message : "Share intent load failed");
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
        loadConversation("auto").catch(() => undefined);
        loadAssistantVoiceJobs("auto").catch(() => undefined);
        loadAssistantAiJobs("auto").catch(() => undefined);
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, [token, pendingCaptures.length, apiBase]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    writeSecureToken(token).catch(() => undefined);
  }, [hydrated, token]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    writePersistedState({
      version: 5,
      apiBase,
      pwaBase,
      token,
      quickCaptureTitle,
      quickCaptureText,
      quickCaptureSourceUrl,
      sharedFileDrafts,
      voiceClipUri,
      voiceClipDurationMs,
      voiceClipTarget,
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
      voiceRoutePreference,
      briefingPlaybackPreference,
      homeDraft,
      notesInstructionDraft,
      assistantCommand,
      assistantHistory,
      assistantVoiceJobs,
      assistantAiJobs,
      conversationTitle,
      conversationSessionState,
      conversationMessages,
      conversationToolTraces,
      lastConversationReset,
    }).catch(() => undefined);
  }, [
    alarmHour,
    alarmMinute,
    alarmNotificationId,
    apiBase,
    homeDraft,
    notesInstructionDraft,
    assistantCommand,
    assistantHistory,
    assistantVoiceJobs,
    assistantAiJobs,
    conversationTitle,
    conversationSessionState,
    conversationMessages,
    conversationToolTraces,
    lastConversationReset,
    artifactGraph,
    artifactVersions,
    artifacts,
    briefingDate,
    cachedPath,
    briefingPlaybackPreference,
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
    voiceRoutePreference,
    voiceClipDurationMs,
    voiceClipTarget,
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
    loadConversation("auto").catch(() => undefined);
  }, [hydrated, token, apiBase]);

  useEffect(() => {
    if (!hydrated || !token) {
      setReviewDecks([]);
      return;
    }
    loadReviewDecks().catch(() => undefined);
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

  if (!token) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={palette.bg === "#1e0f16" ? "light" : "dark"} />
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="always">
          <MobileLoginSurface
            styles={styles}
            palette={palette}
            apiBase={apiBase}
            setApiBase={setApiBase}
            authPassphrase={authPassphrase}
            setAuthPassphrase={setAuthPassphrase}
            revealPassphrase={authRevealPassphrase}
            setRevealPassphrase={setAuthRevealPassphrase}
            authStatus={status}
            authBusy={authBusy !== null}
            login={() => {
              loginObservatorySession().catch(() => undefined);
            }}
            bootstrap={() => {
              bootstrapObservatorySession().catch(() => undefined);
            }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={palette.bg === "#1e0f16" ? "light" : "dark"} />
      <MobileTopBar
        styles={styles}
        palette={palette}
        isAssistantMode={isAssistantMode}
        assistantPanelOpen={assistantPanelOpen}
        onToggleAssistantPanel={() => setAssistantPanelOpen((value) => !value)}
        onRefresh={() => {
          loadExecutionPolicy("manual").catch(() => undefined);
          loadArtifacts().catch(() => undefined);
        }}
        onToggleDiagnostics={() => {
          const next = !showDiagnostics;
          setShowDiagnostics(next);
          setStatus(next ? "Diagnostics available" : "Diagnostics hidden");
        }}
      />
      {isAssistantMode ? (
        <MobileAssistantDrawer
          styles={styles}
          palette={palette}
          open={assistantPanelOpen}
          activeTab={activeTab}
          messageCount={conversationMessages.length}
          queuedCaptureCount={pendingCaptures.length}
          pendingReply={Boolean(pendingConversationTurn)}
          onClose={() => setAssistantPanelOpen(false)}
          onSelectTab={(tab, label) => {
            setActiveTab(tab);
            setAssistantPanelOpen(false);
            setStatus(`${label} ready`);
          }}
          onRefreshThread={() => {
            loadConversation("manual").catch(() => undefined);
            setAssistantPanelOpen(false);
          }}
          onResetSession={() => {
            resetConversationSession().catch(() => undefined);
            setAssistantPanelOpen(false);
          }}
        />
      ) : null}
      <ScrollView
        ref={mainScrollViewRef}
        contentContainerStyle={[
          styles.scrollContent,
          isAssistantMode && !keyboardVisible ? styles.assistantScrollContent : null,
        ]}
        keyboardShouldPersistTaps="always"
        onContentSizeChange={() => {
          if (isAssistantMode) {
            mainScrollViewRef.current?.scrollToEnd({ animated: true });
          }
        }}
      >
        {activeTab === "assistant" ? (
          <View style={styles.assistantStage}>
            <MobileAssistantRebuild
              styles={styles}
              palette={palette}
              pendingConversationTurn={Boolean(pendingConversationTurn)}
              homeDraft={homeDraft}
              setHomeDraft={setHomeDraft}
              runAssistantTurn={runAssistantTurn}
              onVoiceAction={() => handleAssistantVoiceAction().catch(() => undefined)}
              onCancelVoiceAction={clearAssistantVoiceAction}
              voiceActionState={assistantVoiceActionState}
              voiceActionHint={assistantVoiceActionHint}
              refreshThread={() => loadConversation("manual").catch(() => undefined)}
              resetConversationSession={resetConversationSession}
              visibleConversationMessages={visibleConversationMessages}
              hiddenConversationMessageCount={hiddenConversationMessageCount}
              previewCommandFlow={() => previewHomeDraftCommandFlow().catch(() => undefined)}
              formatCardMeta={cardMetaText}
              onCardAction={(action, card) => {
                handleConversationCardAction(action, card).catch(() => undefined);
              }}
              reuseCardText={reuseConversationCardText}
            />
          </View>
        ) : null}

        {activeTab === "library" ? (
          <MobileNotesSurface
            styles={styles}
            palette={palette}
            pendingCaptures={pendingCaptures.length}
            quickCaptureTitle={quickCaptureTitle}
            setQuickCaptureTitle={setQuickCaptureTitle}
            quickCaptureSourceUrl={quickCaptureSourceUrl}
            setQuickCaptureSourceUrl={setQuickCaptureSourceUrl}
            quickCaptureText={quickCaptureText}
            setQuickCaptureText={setQuickCaptureText}
            notesInstructionDraft={notesInstructionDraft}
            setNotesInstructionDraft={setNotesInstructionDraft}
            voiceRecording={captureVoiceRecording}
            holdToTalkLabel={holdToTalkLabel}
            beginHoldToTalkCapture={() => beginHoldToTalkCapture().catch(() => undefined)}
            endHoldToTalkCapture={() => endHoldToTalkCapture().catch(() => undefined)}
            submitPrimaryCapture={() => submitPrimaryCapture().catch(() => undefined)}
            flushPendingCaptures={() => flushPendingCaptures("manual").catch(() => undefined)}
            captureCommandPreview={captureCommandPreview}
            captureQueuePreview={captureQueuePreview}
            voiceMemoPreview={voiceMemoPreview}
            sharedDraftSummary={sharedFileDrafts.length > 0 ? describeSharedDrafts(sharedFileDrafts) : "No shared files"}
            selectedArtifactTitle={selectedArtifact?.title || quickCaptureTitle || "Waiting for a chosen artifact"}
            captureSourcePreview={captureSourcePreview}
            routeNarrative={routeNarrative}
            voiceClipReady={captureVoiceClipReady}
            playVoiceClip={playVoiceClip}
            submitVoiceCapture={() => submitVoiceCapture().catch(() => undefined)}
            showAdvancedCapture={showAdvancedCapture}
            toggleMissionTools={() => {
              setCaptureOpsSection("queue");
              setShowAdvancedCapture((value) => !value);
            }}
          />
        ) : null}

        {activeTab === "review" ? (
          <MobileReviewSurface
            styles={styles}
            palette={palette}
            reviewPrompt={reviewCard?.prompt || "Load the next due card to begin a focused review pass."}
            reviewAnswer={reviewCard?.answer || "The answer stays sealed until you load a card and intentionally reveal it."}
            reviewDueCount={dueCards.length}
            reviewCardType={reviewCardTypeLabel}
            reviewMeta={reviewMetaLabel}
            reviewRetentionLabel={reviewRetentionLabel}
            reviewReviewedCount={reviewStats.reviewed}
            reviewStatus={status}
            reviewDecks={reviewDecks}
            showAnswer={showAnswer}
            revealAnswer={() => {
              if (!reviewCard) {
                loadDueCards().catch(() => undefined);
                return;
              }
              setShowAnswer((value) => !value);
            }}
            loadDueCards={() => {
              loadDueCards().catch(() => undefined);
            }}
            submitReview={(rating) => {
              if (!reviewCard) {
                setStatus("Load due cards first");
                return;
              }
              submitReview(rating).catch(() => undefined);
            }}
            hasReviewCard={Boolean(reviewCard)}
            openReviewWorkspace={() => {
              openReviewWorkspaceInPwa().catch(() => undefined);
            }}
            showAdvancedReview={showAdvancedReview}
            toggleMissionTools={() => {
              setReviewOpsSection("session");
              setShowAdvancedReview((value) => !value);
            }}
          />
        ) : null}

        {activeTab === "planner" ? (
          <MobileCalendarSurface
            styles={styles}
            palette={palette}
            stationTimeLabel={toHourMinuteLabel(stationHour12, alarmMinute)}
            stationPeriod={stationPeriod}
            briefingHeroCopy={briefingHeroCopy}
            nextBriefingCountdown={nextBriefingCountdown}
            offlineBriefingStatus={offlineBriefingStatus}
            briefingPlaybackStatus={briefingPlaybackStatus}
            playBriefing={playBriefing}
            queueBriefingAudio={() => queueBriefingAudio().catch(() => undefined)}
            generateAndCache={() => generateAndCache().catch(() => undefined)}
            canPlayOffline={Boolean(cachedPath || briefingPlaybackPreference !== "offline_first")}
            nextActionPreview={nextActionPreview}
            openPwa={openPwa}
            openReview={() => {
              setActiveTab("review");
              setStatus(`${PRODUCT_SURFACES.review.label} ready`);
            }}
            alarmScheduled={Boolean(alarmNotificationId)}
            toggleAlarm={() => (alarmNotificationId ? clearMorningAlarm().catch(() => undefined) : scheduleMorningAlarm().catch(() => undefined))}
            showAdvancedAlarms={showAdvancedAlarms}
            toggleMissionTools={() => {
              setAlarmOpsSection("briefing");
              setShowAdvancedAlarms((value) => !value);
            }}
          />
        ) : null}

        <MobileSupportPanel
          styles={styles}
          visible={activeTab === "library" && showAdvancedCapture}
          kicker={MOBILE_SUPPORT_PANEL_COPY.library.kicker}
          title={MOBILE_SUPPORT_PANEL_COPY.library.title}
          description={MOBILE_SUPPORT_PANEL_COPY.library.description}
          activeSection={captureOpsSection}
          onSelectSection={setCaptureOpsSection}
          sections={[
            {
              id: "queue",
              label: "Queue",
              content: (
                <CaptureQueueSection
                  styles={styles}
                  palette={palette}
                  quickCaptureTitle={quickCaptureTitle}
                  setQuickCaptureTitle={setQuickCaptureTitle}
                  quickCaptureSourceUrl={quickCaptureSourceUrl}
                  setQuickCaptureSourceUrl={setQuickCaptureSourceUrl}
                  quickCaptureText={quickCaptureText}
                  setQuickCaptureText={setQuickCaptureText}
                  submitQuickCapture={() => {
                    submitQuickCapture().catch(() => undefined);
                  }}
                  flushPendingCaptures={() => {
                    flushPendingCaptures("manual").catch(() => undefined);
                  }}
                  voiceRecording={captureVoiceRecording}
                  startVoiceRecording={() => {
                    startVoiceRecording("capture").catch(() => undefined);
                  }}
                  stopVoiceRecording={() => {
                    stopVoiceRecording().catch(() => undefined);
                  }}
                  submitVoiceCapture={() => {
                    submitVoiceCapture().catch(() => undefined);
                  }}
                  voiceClipUri={voiceClipUri}
                  voiceClipDurationMs={voiceClipDurationMs}
                  sharedFileDrafts={sharedFileDrafts}
                  describeSharedDrafts={describeSharedDrafts}
                  describeSharedFile={describeSharedFile}
                  clearSharedFiles={() => {
                    setSharedFileDrafts([]);
                    setStatus("Cleared shared file drafts");
                  }}
                  pendingCaptures={pendingCaptures}
                />
              ),
            },
            {
              id: "assistant",
              label: "Assistant",
              content: (
                <AssistantToolsSection
                  styles={styles}
                  palette={palette}
                  assistantCommand={assistantCommand}
                  setAssistantCommand={setAssistantCommand}
                  assistantExampleCommands={assistantExampleCommands}
                  runAssistantPlan={() => {
                    runAssistantCommand(false).catch(() => undefined);
                  }}
                  runAssistantExecute={() => {
                    runAssistantCommand(true).catch(() => undefined);
                  }}
                  queueAssistantPlan={() => {
                    queueAssistantAiCommand(false).catch(() => undefined);
                  }}
                  queueAssistantExecute={() => {
                    queueAssistantAiCommand(true).catch(() => undefined);
                  }}
                  openAssistantInPwa={openAssistantInPwa}
                  sttUsesOnDevice={sttResolution.active === "on_device"}
                  localSttListening={localSttListening}
                  submitLocalVoiceAssistantPlan={() => {
                    submitLocalVoiceAssistantCommand(false).catch(() => undefined);
                  }}
                  submitLocalVoiceAssistantExecute={() => {
                    submitLocalVoiceAssistantCommand(true).catch(() => undefined);
                  }}
                  refreshLocalSttAvailability={() => {
                    refreshLocalSttAvailability("manual").catch(() => undefined);
                  }}
                  voiceRecording={Boolean(voiceRecording) && voiceClipTarget === "assistant"}
                  voiceClipTarget={voiceClipTarget}
                  startAssistantVoiceRecording={() => {
                    startVoiceRecording("assistant").catch(() => undefined);
                  }}
                  stopVoiceRecording={() => {
                    stopVoiceRecording().catch(() => undefined);
                  }}
                  submitVoiceAssistantPlan={() => {
                    submitVoiceAssistantCommand(false).catch(() => undefined);
                  }}
                  submitVoiceAssistantExecute={() => {
                    submitVoiceAssistantCommand(true).catch(() => undefined);
                  }}
                  refreshAssistantThread={() => {
                    loadConversation("manual").catch(() => undefined);
                    loadAssistantVoiceJobs("manual").catch(() => undefined);
                    loadAssistantAiJobs("manual").catch(() => undefined);
                  }}
                  resetConversationSession={() => {
                    resetConversationSession().catch(() => undefined);
                  }}
                  localSttLabel={localSttProbeLabel(localSttAvailable)}
                  voiceCommandStatus={
                    sttResolution.active === "on_device"
                      ? "Voice commands now use Android speech recognition on the phone, then send the transcript through the normal assistant command endpoint."
                      : `Voice clip for commands: ${
                          voiceRecording && voiceClipTarget === "assistant"
                            ? "recording..."
                            : voiceClipUri && voiceClipTarget === "assistant"
                              ? `${Math.round(voiceClipDurationMs / 1000)}s ready`
                              : "none"
                        }`
                  }
                  conversationTitle={conversationTitle}
                  conversationSessionState={conversationSessionState}
                  conversationMessages={conversationMessages}
                  conversationToolTraces={conversationToolTraces}
                  lastConversationReset={lastConversationReset}
                  visibleConversationMessages={visibleConversationMessages}
                  hiddenConversationMessageCount={hiddenConversationMessageCount}
                  showFullConversationThread={showFullConversationThread}
                  setShowFullConversationThread={setShowFullConversationThread}
                  expandedThreadCards={expandedThreadCards}
                  setExpandedThreadCards={(updater) => setExpandedThreadCards(updater)}
                  expandedThreadTraces={expandedThreadTraces}
                  setExpandedThreadTraces={(updater) => setExpandedThreadTraces(updater)}
                  cardMetaText={cardMetaText}
                  summarizeTraceValue={summarizeTraceValue}
                  threadMessagesLength={threadMessages.length}
                  defaultVisibleMessages={DEFAULT_MOBILE_THREAD_VISIBLE_MESSAGES}
                  showDiagnostics={showDiagnostics}
                  toggleDiagnostics={() => setShowDiagnostics((value) => !value)}
                  assistantHistory={assistantHistory}
                  assistantVoiceJobs={assistantVoiceJobs}
                  assistantAiJobs={assistantAiJobs}
                />
              ),
            },
            {
              id: "routing",
              label: "Routing",
              content: (
                <CaptureRoutingSection
                  styles={styles}
                  palette={palette}
                  llmResolution={llmResolution}
                  sttResolution={sttResolution}
                  ttsResolution={ttsResolution}
                  formatExecutionTarget={(target) => formatExecutionTarget(target as never)}
                  voiceRoutePreference={voiceRoutePreference}
                  setVoiceRoutePreference={setVoiceRoutePreference}
                  executionPolicyUpdatedAt={executionPolicy.updated_at}
                  refreshPolicy={() => {
                    loadExecutionPolicy("manual").catch(() => undefined);
                  }}
                  openIntegrations={() => {
                    openIntegrationsInPwa().catch(() => undefined);
                  }}
                />
              ),
            },
            {
              id: "triage",
              label: "Triage",
              content: (
                <ArtifactTriageSection
                  styles={styles}
                  palette={palette}
                  loadArtifacts={() => {
                    loadArtifacts().catch(() => undefined);
                  }}
                  openSelectedArtifactInPwa={() => {
                    openSelectedArtifactInPwa().catch(() => undefined);
                  }}
                  speakSelectedArtifact={() => {
                    speakSelectedArtifact();
                  }}
                  selectedArtifact={selectedArtifact}
                  artifactDetailStatus={artifactDetailStatus}
                  artifactQuickActions={artifactQuickActions}
                  runArtifactAction={(action) => {
                    runArtifactAction(action).catch(() => undefined);
                  }}
                  artifacts={artifacts}
                  selectedArtifactId={selectedArtifactId}
                  setSelectedArtifactId={setSelectedArtifactId}
                  artifactGraph={artifactGraph}
                  artifactVersions={artifactVersions}
                  openTaskInPwa={(taskId) => {
                    openTaskInPwa(taskId).catch(() => undefined);
                  }}
                  openNoteInPwa={(noteId) => {
                    openNoteInPwa(noteId).catch(() => undefined);
                  }}
                />
              ),
            },
          ]}
        />
        <MobileSupportPanel
          styles={styles}
          visible={activeTab === "review" && showAdvancedReview}
          kicker={MOBILE_SUPPORT_PANEL_COPY.review.kicker}
          title={MOBILE_SUPPORT_PANEL_COPY.review.title}
          description={MOBILE_SUPPORT_PANEL_COPY.review.description}
          activeSection={reviewOpsSection}
          onSelectSection={setReviewOpsSection}
          sections={[
            {
              id: "session",
              label: "Session",
              content: (
                <ReviewSessionSection
                  styles={styles}
                  palette={palette}
                  dueCards={dueCards}
                  showAnswer={showAnswer}
                  loadDueCards={() => {
                    loadDueCards().catch(() => undefined);
                  }}
                  revealAnswer={() => {
                    if (!dueCards[0]) {
                      setStatus("No due card selected");
                      return;
                    }
                    setShowAnswer(true);
                  }}
                  submitReview={(rating) => {
                    submitReview(rating).catch(() => undefined);
                  }}
                />
              ),
            },
            {
              id: "triage",
              label: "Triage",
              content: (
                <ArtifactTriageSection
                  styles={styles}
                  palette={palette}
                  loadArtifacts={() => {
                    loadArtifacts().catch(() => undefined);
                  }}
                  openSelectedArtifactInPwa={() => {
                    openSelectedArtifactInPwa().catch(() => undefined);
                  }}
                  speakSelectedArtifact={() => {
                    speakSelectedArtifact();
                  }}
                  selectedArtifact={selectedArtifact}
                  artifactDetailStatus={artifactDetailStatus}
                  artifactQuickActions={artifactQuickActions}
                  runArtifactAction={(action) => {
                    runArtifactAction(action).catch(() => undefined);
                  }}
                  artifacts={artifacts}
                  selectedArtifactId={selectedArtifactId}
                  setSelectedArtifactId={setSelectedArtifactId}
                  artifactGraph={artifactGraph}
                  artifactVersions={artifactVersions}
                  openTaskInPwa={(taskId) => {
                    openTaskInPwa(taskId).catch(() => undefined);
                  }}
                  openNoteInPwa={(noteId) => {
                    openNoteInPwa(noteId).catch(() => undefined);
                  }}
                />
              ),
            },
          ]}
        />
        <MobileSupportPanel
          styles={styles}
          visible={activeTab === "planner" && showAdvancedAlarms}
          kicker={MOBILE_SUPPORT_PANEL_COPY.planner.kicker}
          title={MOBILE_SUPPORT_PANEL_COPY.planner.title}
          description={MOBILE_SUPPORT_PANEL_COPY.planner.description}
          activeSection={alarmOpsSection}
          onSelectSection={setAlarmOpsSection}
          sections={[
            {
              id: "briefing",
              label: "Briefing",
              content: (
                <BriefingPipelineSection
                  styles={styles}
                  palette={palette}
                  apiBase={apiBase}
                  setApiBase={setApiBase}
                  token={token}
                  setToken={setToken}
                  briefingDate={briefingDate}
                  setBriefingDate={setBriefingDate}
                  alarmHour={alarmHour}
                  setAlarmHour={setAlarmHour}
                  alarmMinute={alarmMinute}
                  setAlarmMinute={setAlarmMinute}
                  boundedInt={boundedInt}
                  briefingPlaybackStatus={briefingPlaybackStatus}
                  briefingPlaybackPreference={briefingPlaybackPreference}
                  setBriefingPlaybackPreference={setBriefingPlaybackPreference}
                  generateAndCache={() => {
                    generateAndCache().catch(() => undefined);
                  }}
                  queueBriefingAudio={() => {
                    queueBriefingAudio().catch(() => undefined);
                  }}
                  playBriefing={() => {
                    playBriefing().catch(() => undefined);
                  }}
                  scheduleMorningAlarm={() => {
                    scheduleMorningAlarm().catch(() => undefined);
                  }}
                  clearMorningAlarm={() => {
                    clearMorningAlarm().catch(() => undefined);
                  }}
                  notificationPermission={notificationPermission}
                  cachedPath={cachedPath}
                  alarmNotificationId={alarmNotificationId}
                  toHourMinuteLabel={toHourMinuteLabel}
                  status={status}
                />
              ),
            },
            {
              id: "link",
              label: "Link",
              content: (
                <DesktopFallbackSection
                  styles={styles}
                  palette={palette}
                  pwaBase={pwaBase}
                  setPwaBase={setPwaBase}
                  openPwa={() => {
                    openPwa().catch(() => undefined);
                  }}
                />
              ),
            },
          ]}
        />
      </ScrollView>
      {keyboardVisible || isAssistantMode ? null : (
        <MobileBottomNav
          styles={styles}
          palette={palette}
          activeTab={activeTab}
          onSelectTab={(tab, label) => {
            setActiveTab(tab);
            setStatus(`${label} ready`);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function themedStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: palette.bg,
    },
    bgOrbTop: {
      position: "absolute",
      top: -80,
      right: -60,
      width: 220,
      height: 220,
      borderRadius: 999,
      backgroundColor: palette.accentMuted,
    },
    bgOrbCenter: {
      position: "absolute",
      top: 220,
      left: -60,
      width: 180,
      height: 180,
      borderRadius: 999,
      backgroundColor: "rgba(109,61,83,0.16)",
    },
    topBar: {
      paddingHorizontal: 18,
      paddingTop: Platform.OS === "android" ? 10 : 10,
      paddingBottom: 8,
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      backgroundColor: "rgba(30,15,22,0.52)",
    },
    topBarAssistant: {
      paddingTop: Platform.OS === "android" ? 18 : 6,
      paddingBottom: 8,
      backgroundColor: "rgba(30,15,22,0.08)",
      borderBottomWidth: 1,
      borderBottomColor: "rgba(255,255,255,0.04)",
      alignItems: "center",
    },
    topBarBrand: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    topBarBrandAssistant: {
      gap: 8,
      flex: 1,
      paddingRight: 12,
      alignItems: "center",
    },
    topBarAvatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceHigh,
      alignItems: "center",
      justifyContent: "center",
    },
    topBarPill: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceLow,
    },
    topBarPillText: {
      color: palette.accent,
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1.1,
    },
    topBarAvatarText: {
      color: palette.accent,
      fontSize: 12,
      fontWeight: "700",
    },
    topBarTitle: {
      color: palette.accent,
      fontSize: 18,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },
    topBarTitleAssistant: {
      fontSize: 16,
      letterSpacing: -0.2,
      textTransform: "none",
      color: palette.text,
    },
    topBarAssistantStatus: {
      flexDirection: "column",
      alignItems: "flex-end",
      gap: 2,
      paddingHorizontal: 2,
      paddingVertical: 2,
    },
    topBarAssistantStatusDot: {
      width: 8,
      height: 8,
      borderRadius: 999,
      backgroundColor: palette.accent,
      shadowColor: palette.accent,
      shadowOpacity: 0.3,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
    },
    topBarAssistantStatusText: {
      color: palette.muted,
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    topBarActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    topBarIconButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.05)",
      backgroundColor: "rgba(255,255,255,0.03)",
      alignItems: "center",
      justifyContent: "center",
    },
    topBarAction: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: palette.surfaceLow,
    },
    topBarActionText: {
      color: palette.accent,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 120,
      gap: 18,
    },
    assistantScrollContent: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 22,
      gap: 12,
    },
    assistantStage: {
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.05)",
      borderRadius: 30,
      backgroundColor: "rgba(27,16,22,0.52)",
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 14,
      gap: 12,
      overflow: "hidden",
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
    },
    hero: {
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.panel,
      borderRadius: 28,
      padding: 22,
      gap: 12,
    },
    eyebrow: {
      textTransform: "uppercase",
      letterSpacing: 1.4,
      color: palette.accent,
      fontSize: 10,
      fontWeight: "700",
    },
    title: {
      color: palette.text,
      fontSize: 52,
      lineHeight: 58,
      fontWeight: "400",
      fontFamily: SERIF_FONT_FAMILY,
    },
    body: {
      color: palette.muted,
      fontSize: 15,
      lineHeight: 24,
    },
    heroInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 12,
      color: palette.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: palette.bgAlt,
    },
    routeGrid: {
      flexDirection: "row",
      gap: 8,
      marginTop: 6,
    },
    routeCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 10,
      backgroundColor: palette.surfaceLow,
      gap: 4,
    },
    routeCardPrimary: {
      borderLeftWidth: 2,
      borderLeftColor: palette.accent,
    },
    routeCardTertiary: {
      borderLeftWidth: 2,
      borderLeftColor: palette.tertiary,
    },
    routeCardSecondary: {
      borderLeftWidth: 2,
      borderLeftColor: palette.secondary,
    },
    routeLabel: {
      color: palette.muted,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    routeValue: {
      color: palette.text,
      fontSize: 11,
      fontWeight: "600",
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    intentHeroCard: {
      borderRadius: 24,
      paddingHorizontal: 18,
      paddingVertical: 18,
      gap: 10,
      backgroundColor: palette.accent,
    },
    heroCardLabel: {
      color: palette.accent,
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1.1,
    },
    heroCardLabelInverse: {
      color: palette.onAccent,
      opacity: 0.76,
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1.1,
    },
    intentHeroCopy: {
      color: palette.onAccent,
      fontSize: 24,
      lineHeight: 34,
      fontWeight: "400",
      fontFamily: SERIF_FONT_FAMILY,
    },
    editorialCardCopy: {
      color: palette.text,
      fontSize: 28,
      lineHeight: 38,
      fontWeight: "400",
      fontFamily: SERIF_FONT_FAMILY,
    },
    contextCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 22,
      padding: 16,
      gap: 10,
      backgroundColor: palette.surfaceLow,
    },
    contextCardBody: {
      color: palette.text,
      fontSize: 16,
      lineHeight: 25,
    },
    contextMetaRow: {
      gap: 8,
    },
    contextMetaPill: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: palette.surfaceHigh,
    },
    contextMetaText: {
      color: palette.muted,
      fontSize: 12,
      lineHeight: 18,
    },
    pendingBadge: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: palette.accentMuted,
    },
    pendingBadgeText: {
      color: palette.accent,
      fontSize: 10,
      fontWeight: "600",
    },
    captureHeroActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 2,
    },
    captureComposerCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 22,
      backgroundColor: palette.surfaceLow,
      padding: 16,
      gap: 8,
    },
    composerInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 16,
      color: palette.text,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: palette.bgAlt,
    },
    composerInputLarge: {
      minHeight: 110,
      textAlignVertical: "top",
    },
    primaryAction: {
      flex: 1,
      borderWidth: 0,
      backgroundColor: palette.accent,
      borderRadius: 18,
      minHeight: 56,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    primaryActionText: {
      color: palette.onAccent,
      fontSize: 15,
      fontWeight: "700",
    },
    iconAction: {
      width: 56,
      height: 56,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceHigh,
      alignItems: "center",
      justifyContent: "center",
    },
    captureArtifactCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 22,
      padding: 16,
      backgroundColor: palette.surfaceLow,
      gap: 8,
    },
    captureTrackLabel: {
      color: palette.tertiary,
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.9,
    },
    captureArtifactTitle: {
      color: palette.text,
      fontSize: 36,
      fontWeight: "400",
      lineHeight: 44,
      fontFamily: SERIF_FONT_FAMILY,
    },
    miniTag: {
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceHigh,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    miniTagText: {
      color: palette.muted,
      fontSize: 10,
      fontWeight: "600",
    },
    captureMediaRow: {
      flexDirection: "row",
      gap: 10,
    },
    captureMediaTile: {
      flex: 1,
      minHeight: 110,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 18,
      backgroundColor: palette.surfaceLow,
      padding: 12,
      justifyContent: "space-between",
      gap: 4,
    },
    captureAlertTile: {
      flex: 1,
      minHeight: 110,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 18,
      backgroundColor: palette.surfaceLow,
      padding: 12,
      gap: 4,
    },
    captureVoiceMemo: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 18,
      backgroundColor: palette.surfaceHigh,
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    capturePlayButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.accent,
    },
    routeHint: {
      color: palette.muted,
      fontSize: 9,
      lineHeight: 10,
    },
    dashboardWide: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 22,
      padding: 16,
      gap: 2,
      backgroundColor: palette.surfaceLow,
      marginTop: 8,
      position: "relative",
    },
    dashboardValue: {
      position: "absolute",
      right: 12,
      top: 10,
      color: palette.tertiary,
      fontSize: 30,
      fontWeight: "700",
    },
    dashboardRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 4,
    },
    dashboardCell: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: palette.surfaceLow,
      gap: 2,
    },
    dashboardValueSmall: {
      color: palette.text,
      fontSize: 24,
      fontWeight: "700",
      lineHeight: 28,
    },
    surfaceLeadCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 22,
      padding: 16,
      gap: 6,
      backgroundColor: palette.surfaceLow,
    },
    surfaceLeadTitle: {
      color: palette.text,
      fontSize: 26,
      lineHeight: 32,
      fontFamily: SERIF_FONT_FAMILY,
      fontWeight: "400",
    },
    surfaceLeadCopy: {
      color: palette.muted,
      fontSize: 13,
      lineHeight: 20,
    },
    surfaceStatsRow: {
      flexDirection: "row",
      gap: 8,
    },
    surfaceStatCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 18,
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: palette.surfaceLow,
      gap: 2,
    },
    surfaceStatValue: {
      color: palette.secondary,
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "800",
      fontFamily: "Manrope",
    },
    surfaceStatLabel: {
      color: palette.muted,
      fontSize: 10,
      letterSpacing: 0.9,
      textTransform: "uppercase",
    },
    reviewTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 2,
    },
    reviewPillRow: {
      flexDirection: "row",
      gap: 8,
    },
    reviewPill: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: palette.surfaceHigh,
    },
    reviewPillText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "700",
    },
    reviewFlashcard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 20,
      padding: 14,
      backgroundColor: "rgba(16,20,26,0.66)",
      gap: 8,
    },
    reviewMeta: {
      color: palette.muted,
      fontSize: 10,
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    reviewCategory: {
      color: palette.secondary,
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 1.5,
      textAlign: "center",
    },
    reviewPromptLarge: {
      color: palette.text,
      fontSize: 49,
      lineHeight: 56,
      textAlign: "center",
      fontWeight: "300",
    },
    reviewDivider: {
      height: 2,
      width: 46,
      borderRadius: 999,
      backgroundColor: "rgba(201,190,255,0.2)",
      alignSelf: "center",
    },
    reviewAnswerLarge: {
      color: palette.muted,
      fontSize: 15,
      lineHeight: 24,
      textAlign: "center",
    },
    reviewRateRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 2,
    },
    reviewRateButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 12,
      backgroundColor: palette.surfaceLow,
      minHeight: 70,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    reviewRateButtonActive: {
      borderColor: "rgba(201,190,255,0.38)",
      backgroundColor: "rgba(201,190,255,0.16)",
    },
    reviewRateLabel: {
      color: palette.muted,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontWeight: "700",
    },
    reviewRateLabelActive: {
      color: palette.accent,
    },
    reviewRateValue: {
      color: palette.text,
      fontSize: 33,
      lineHeight: 36,
      fontWeight: "700",
    },
    alarmClockRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "center",
      gap: 6,
    },
    alarmClockText: {
      color: palette.text,
      fontSize: 50,
      fontWeight: "400",
      lineHeight: 56,
      fontFamily: SERIF_FONT_FAMILY,
    },
    alarmClockPeriod: {
      color: palette.accent,
      fontSize: 22,
      fontWeight: "600",
      marginBottom: 6,
    },
    alarmStationMeta: {
      color: palette.muted,
      fontSize: 11,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      textAlign: "center",
      marginBottom: 2,
    },
    alarmNextCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 22,
      backgroundColor: palette.surfaceLow,
      padding: 16,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
    },
    alarmCountdown: {
      color: palette.secondary,
      fontSize: 31,
      fontWeight: "600",
      textAlign: "right",
    },
    alarmPlayerCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 22,
      padding: 16,
      gap: 8,
      backgroundColor: palette.surfaceLow,
    },
    alarmWaveRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 4,
      height: 16,
      marginTop: 2,
    },
    alarmWaveBar: {
      flex: 1,
      borderRadius: 999,
      backgroundColor: "rgba(201,190,255,0.7)",
    },
    alarmPlayerButtons: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 10,
    },
    alarmCycleCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 22,
      padding: 16,
      backgroundColor: palette.surfaceLow,
      gap: 10,
    },
    alarmCycleRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    alarmCycleTime: {
      color: palette.text,
      fontSize: 34,
      fontWeight: "500",
      lineHeight: 38,
    },
    toggleButton: {
      width: 52,
      height: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceHighest,
      paddingHorizontal: 3,
      justifyContent: "center",
    },
    toggleKnob: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: palette.muted,
      alignSelf: "flex-start",
    },
    toggleKnobOn: {
      alignSelf: "flex-end",
      backgroundColor: palette.accent,
    },
    panel: {
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.panel,
      borderRadius: 24,
      padding: 18,
      gap: 12,
    },
    sectionKicker: {
      color: palette.accent,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 1.2,
      opacity: 0.8,
    },
    panelTitle: {
      color: palette.text,
      fontSize: 19,
      fontWeight: "600",
      fontFamily: SERIF_FONT_FAMILY,
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
      paddingVertical: 7,
      paddingHorizontal: 12,
      backgroundColor: palette.surfaceLow,
    },
    chipText: {
      color: palette.text,
      fontWeight: "600",
      fontSize: 12,
    },
    opsChipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4,
    },
    opsChip: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      paddingVertical: 7,
      paddingHorizontal: 12,
      backgroundColor: palette.surfaceLow,
    },
    opsChipActive: {
      borderColor: palette.accent,
      backgroundColor: palette.surfaceHigh,
    },
    opsChipText: {
      color: palette.muted,
      fontWeight: "700",
      fontSize: 11,
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },
    opsChipTextActive: {
      color: palette.accent,
    },
    opsSectionCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 14,
      padding: 12,
      gap: 8,
      backgroundColor: "rgba(16,20,26,0.55)",
      marginTop: 2,
    },
    opsSectionTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: "700",
    },
    inlineCard: {
      borderWidth: 1,
      borderColor: "rgba(241, 182, 205, 0.14)",
      borderRadius: 16,
      padding: 12,
      gap: 6,
      backgroundColor: "rgba(16,20,26,0.76)",
      marginTop: 6,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },
    inlineCardActive: {
      borderColor: "rgba(241, 182, 205, 0.34)",
      shadowColor: palette.accent,
      shadowOpacity: 0.22,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
    inlineCardTitle: {
      color: palette.text,
      fontSize: 14,
      fontWeight: "700",
    },
    detailCard: {
      borderWidth: 1,
      borderColor: "rgba(241, 182, 205, 0.14)",
      borderRadius: 16,
      padding: 12,
      gap: 8,
      backgroundColor: "rgba(16,20,26,0.68)",
      marginTop: 8,
    },
    threadMessageCard: {
      borderWidth: 1,
      borderColor: "rgba(241, 182, 205, 0.12)",
      borderRadius: 18,
      padding: 12,
      gap: 10,
      backgroundColor: "rgba(16,20,26,0.76)",
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    threadMessageMeta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    threadRoleChip: {
      color: palette.secondary,
      fontSize: 9,
      textTransform: "uppercase",
      letterSpacing: 1.1,
      fontWeight: "800",
      borderWidth: 1,
      borderColor: "rgba(241, 182, 205, 0.14)",
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: "rgba(255,255,255,0.03)",
      overflow: "hidden",
    },
    threadMessageBody: {
      color: palette.text,
      fontSize: 15,
      lineHeight: 22,
    },
    threadDetailHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    threadDetailToggle: {
      borderWidth: 1,
      borderColor: "rgba(241, 182, 205, 0.12)",
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: "rgba(255,255,255,0.03)",
    },
    threadDetailToggleText: {
      color: palette.muted,
      fontSize: 10,
      letterSpacing: 0.8,
      textTransform: "uppercase",
    },
    threadDetailRow: {
      gap: 4,
      paddingTop: 4,
    },
    threadDetailTitle: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "700",
    },
    threadDetailMeta: {
      color: palette.muted,
      fontSize: 10,
      letterSpacing: 0.4,
    },
    subtle: {
      color: palette.muted,
      fontSize: 12,
    },
    label: {
      color: palette.muted,
      fontSize: 11,
      marginTop: 6,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 12,
      color: palette.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: palette.surfaceLow,
    },
    timeInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 12,
      color: palette.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: palette.surfaceLow,
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
      borderRadius: 12,
      backgroundColor: palette.surfaceHigh,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    buttonText: {
      color: palette.text,
      fontWeight: "600",
      fontSize: 12,
    },
    mono: {
      color: palette.muted,
      fontSize: 12,
      fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    },
    reviewCard: {
      borderWidth: 1,
      borderColor: "rgba(241, 182, 205, 0.12)",
      borderRadius: 16,
      padding: 12,
      gap: 8,
      backgroundColor: "rgba(16,20,26,0.72)",
      marginTop: 8,
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
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
    fab: {
      position: "absolute",
      right: 22,
      bottom: 84,
      width: 64,
      height: 64,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.accent,
    },
    fabText: {
      color: palette.onAccent,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    bottomNav: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(30,15,22,0.92)",
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 14,
      flexDirection: "row",
      justifyContent: "space-around",
    },
    bottomNavItem: {
      alignItems: "center",
      justifyContent: "center",
      minWidth: 74,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
    },
    bottomNavItemActive: {
      backgroundColor: palette.surfaceHighest,
    },
    bottomNavLabel: {
      color: "#49473f",
      fontSize: 11,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    bottomNavLabelActive: {
      color: palette.accent,
    },
  });
}
