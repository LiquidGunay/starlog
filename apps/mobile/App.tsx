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
  Linking,
  Platform,
  Pressable,
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
const MOBILE_SECURE_TOKEN_KEY = "starlog.api.token";
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
  "create task",
  "search for spaced repetition",
];

let stateDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function usePalette(): Palette {
  const scheme = useColorScheme();
  return useMemo(() => {
    if (scheme === "light") {
      return {
        bg: "#f2f5ff",
        bgAlt: "#ffffff",
        panel: "rgba(255,255,255,0.9)",
        border: "rgba(71,49,164,0.16)",
        text: "#1d2230",
        muted: "#5c5f78",
        accent: "#5f4bbe",
        accentMuted: "rgba(95,75,190,0.12)",
        secondary: "#b56624",
        tertiary: "#197a79",
        error: "#b33834",
        onAccent: "#ffffff",
        surfaceLow: "#eceffd",
        surfaceHigh: "#e2e6fb",
        surfaceHighest: "#d8ddf5",
      };
    }
    return {
      bg: "#10141a",
      bgAlt: "#0a0e14",
      panel: "rgba(201,190,255,0.06)",
      border: "rgba(201,190,255,0.18)",
      text: "#dfe2eb",
      muted: "#c9c4d5",
      accent: "#c9beff",
      accentMuted: "rgba(201,190,255,0.15)",
      secondary: "#f1bc8e",
      tertiary: "#83d4d3",
      error: "#ffb4ab",
      onAccent: "#30118e",
      surfaceLow: "#181c22",
      surfaceHigh: "#262a31",
      surfaceHighest: "#31353c",
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
        const normalized: PersistedState = {
          sharedFileDrafts: [],
          voiceClipUri: null,
          voiceClipDurationMs: 0,
          assistantCommand: "summarize latest artifact",
          assistantHistory: [],
          assistantVoiceJobs: [],
          assistantAiJobs: [],
          ...parsed,
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

function parseSurfaceTabDeepLink(rawUrl: string): "capture" | "alarms" | "review" | null {
  const parsedUrl = parseAppDeepLink(rawUrl);
  if (!parsedUrl || parsedUrl.route !== "surface") {
    return null;
  }
  const { params } = parsedUrl;
  const rawTab = (deepLinkParam(params, "tab") ?? "").trim().toLowerCase();
  if (rawTab === "capture" || rawTab === "alarms" || rawTab === "review") {
    return rawTab;
  }
  return null;
}

export default function App({ initialIntentUrl = null }: AppProps) {
  const palette = usePalette();
  const styles = useMemo(() => themedStyles(palette), [palette]);
  const [activeTab, setActiveTab] = useState<"capture" | "alarms" | "review">("capture");
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

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCountdownTick(Date.now());
    }, 30_000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    voiceRecordingRef.current = voiceRecording;
  }, [voiceRecording]);

  function applyDeepCapture(deepCapture: { title: string; text: string; sourceUrl: string }) {
    setActiveTab("capture");
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
      setStatus(`Opened ${requestedTab} surface`);
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
      setVoiceClipUri(null);
      setVoiceClipDurationMs(0);
      setStatus("Recording voice note...");
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
      setStatus("Voice note ready to upload or queue");
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
    await startVoiceRecording();
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

  const holdToTalkLabel = voiceRecording ? "Release to stop" : "Hold to talk";
  const offlineBriefingStatus = cachedPath
    ? `Offline briefing cached for ${briefingDate}`
    : "No offline briefing cached yet";

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
        setApiBase(persisted.apiBase);
        setPwaBase(persisted.pwaBase);
        setToken(recoveredToken);
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
    writeSecureToken(token).catch(() => undefined);
  }, [hydrated, token]);

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

  function renderOpsChip(label: string, active: boolean, onPress: () => void) {
    return (
      <TouchableOpacity
        key={label}
        style={[styles.opsChip, active ? styles.opsChipActive : null]}
        activeOpacity={0.85}
        onPress={onPress}
      >
        <Text style={[styles.opsChipText, active ? styles.opsChipTextActive : null]}>{label}</Text>
      </TouchableOpacity>
    );
  }

  function renderCaptureQueueSection() {
    return (
      <>
        <Text style={styles.opsSectionTitle}>Capture queue</Text>
        <Text style={styles.subtle}>Keep text, voice, and shared-file intake off the main hero while preserving the full queue workflow.</Text>
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
      </>
    );
  }

  function renderCaptureRoutingSection() {
    return (
      <>
        <Text style={styles.opsSectionTitle}>Execution routing</Text>
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
      </>
    );
  }

  function renderAssistantSection() {
    return (
      <>
        <Text style={styles.opsSectionTitle}>Assistant command relay</Text>
        <Text style={styles.subtle}>
          Keep command, voice, and queue inspection reachable without turning the main capture deck into a second console.
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
        <Text style={styles.subtle}>On-device STT: {localSttProbeLabel(localSttAvailable)}</Text>
        {sttResolution.active === "on_device" ? (
          <Text style={styles.subtle}>
            Voice commands now use Android speech recognition on the phone, then send the transcript through the normal assistant command endpoint.
          </Text>
        ) : (
          <Text style={styles.subtle}>
            Voice clip for commands: {voiceRecording ? "recording..." : voiceClipUri ? `${Math.round(voiceClipDurationMs / 1000)}s ready` : "none"}
          </Text>
        )}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={() => setShowDiagnostics((value) => !value)}>
            <Text style={styles.buttonText}>{showDiagnostics ? "Hide Diagnostics" : "Show Diagnostics"}</Text>
          </TouchableOpacity>
        </View>
        {showDiagnostics ? (
          <>
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
          </>
        ) : (
          <Text style={styles.subtle}>Diagnostics hidden for the focused command view.</Text>
        )}
      </>
    );
  }

  function renderArtifactTriageSection() {
    return (
      <>
        <Text style={styles.opsSectionTitle}>Artifact triage</Text>
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
      </>
    );
  }

  function renderReviewSessionSection() {
    return (
      <>
        <Text style={styles.opsSectionTitle}>Quick review session</Text>
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
      </>
    );
  }

  function renderCompanionLinkSection() {
    return (
      <>
        <Text style={styles.opsSectionTitle}>Phone + PWA linkage</Text>
        <Text style={styles.label}>PWA URL</Text>
        <TextInput style={styles.input} value={pwaBase} onChangeText={setPwaBase} autoCapitalize="none" />
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={openPwa}>
            <Text style={styles.buttonText}>Open PWA</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtle}>Share deep-link format</Text>
        <Text style={styles.mono}>starlog://capture?title=Clip&text=Hello&source_url=https://example.com</Text>
      </>
    );
  }

  function renderBriefingPipelineSection() {
    return (
      <>
        <Text style={styles.opsSectionTitle}>Offline morning brief pipeline</Text>
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
        <Text style={styles.label}>Alarm time</Text>
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
      </>
    );
  }

  function renderCaptureOpsPanel() {
    if (activeTab !== "capture" || !showAdvancedCapture) {
      return null;
    }

    return (
      <View style={styles.panel}>
        <Text style={styles.sectionKicker}>Mission Tools</Text>
        <Text style={styles.panelTitle}>Capture support systems</Text>
        <Text style={styles.subtle}>
          Keep the main capture shell focused on intake. Use the support systems below for queue control, AI routing, and triage.
        </Text>
        <View style={styles.opsChipRow}>
          {renderOpsChip("Queue", captureOpsSection === "queue", () => setCaptureOpsSection("queue"))}
          {renderOpsChip("Assistant", captureOpsSection === "assistant", () => setCaptureOpsSection("assistant"))}
          {renderOpsChip("Routing", captureOpsSection === "routing", () => setCaptureOpsSection("routing"))}
          {renderOpsChip("Triage", captureOpsSection === "triage", () => setCaptureOpsSection("triage"))}
        </View>
        <View style={styles.opsSectionCard}>
          {captureOpsSection === "queue" ? renderCaptureQueueSection() : null}
          {captureOpsSection === "assistant" ? renderAssistantSection() : null}
          {captureOpsSection === "routing" ? renderCaptureRoutingSection() : null}
          {captureOpsSection === "triage" ? renderArtifactTriageSection() : null}
        </View>
      </View>
    );
  }

  function renderReviewOpsPanel() {
    if (activeTab !== "review" || !showAdvancedReview) {
      return null;
    }

    return (
      <View style={styles.panel}>
        <Text style={styles.sectionKicker}>Mission Tools</Text>
        <Text style={styles.panelTitle}>Review support systems</Text>
        <Text style={styles.subtle}>
          Keep the flashcard deck primary. Use the secondary panel for session controls and artifact context when you need it.
        </Text>
        <View style={styles.opsChipRow}>
          {renderOpsChip("Session", reviewOpsSection === "session", () => setReviewOpsSection("session"))}
          {renderOpsChip("Triage", reviewOpsSection === "triage", () => setReviewOpsSection("triage"))}
        </View>
        <View style={styles.opsSectionCard}>
          {reviewOpsSection === "session" ? renderReviewSessionSection() : null}
          {reviewOpsSection === "triage" ? renderArtifactTriageSection() : null}
        </View>
      </View>
    );
  }

  function renderAlarmOpsPanel() {
    if (activeTab !== "alarms" || !showAdvancedAlarms) {
      return null;
    }

    return (
      <View style={styles.panel}>
        <Text style={styles.sectionKicker}>Mission Tools</Text>
        <Text style={styles.panelTitle}>Alarm + briefing support systems</Text>
        <Text style={styles.subtle}>
          Keep the station clock and player front-and-center. Use the secondary panel for setup, caching, and phone-to-PWA linkage.
        </Text>
        <View style={styles.opsChipRow}>
          {renderOpsChip("Briefing", alarmOpsSection === "briefing", () => setAlarmOpsSection("briefing"))}
          {renderOpsChip("Link", alarmOpsSection === "link", () => setAlarmOpsSection("link"))}
        </View>
        <View style={styles.opsSectionCard}>
          {alarmOpsSection === "briefing" ? renderBriefingPipelineSection() : null}
          {alarmOpsSection === "link" ? renderCompanionLinkSection() : null}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={palette.bg === "#10141a" ? "light" : "dark"} />
      <View pointerEvents="none" style={styles.bgOrbTop} />
      <View pointerEvents="none" style={styles.bgOrbCenter} />
      <View style={styles.topBar}>
        <View style={styles.topBarBrand}>
          <View style={styles.topBarAvatar}>
            <MaterialCommunityIcons name="radio-tower" size={14} color={palette.tertiary} />
          </View>
          <Text style={styles.topBarTitle}>Starlog</Text>
        </View>
        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={styles.topBarIconButton}
            onPress={() => {
              loadExecutionPolicy("manual").catch(() => undefined);
              loadArtifacts().catch(() => undefined);
            }}
          >
            <MaterialCommunityIcons name="sync" size={16} color={palette.accent} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBarIconButton} onPress={openPwa}>
            <MaterialCommunityIcons name="account-circle" size={18} color={palette.tertiary} />
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{activeTab === "capture" ? "System Ready" : activeTab === "alarms" ? "Station Time" : "Current Session"}</Text>
          <Text style={styles.title}>
            {activeTab === "capture" ? "Awaiting Command" : activeTab === "alarms" ? `${toHourMinuteLabel(stationHour12, alarmMinute)} ${stationPeriod}` : "Neural Synchronization"}
          </Text>
          {activeTab === "capture" ? (
            <>
              <Text style={styles.body}>
                Capture fast. Triage quickly. Run alarms and offline briefing playback while deep editing stays in the PWA.
              </Text>
              <TextInput
                style={styles.heroInput}
                value={assistantCommand}
                onChangeText={setAssistantCommand}
                placeholder="Specify objective..."
                placeholderTextColor={palette.muted}
              />
              <View style={styles.routeGrid}>
                <View style={[styles.routeCard, styles.routeCardPrimary]}>
                  <Text style={styles.routeLabel}>Engine</Text>
                  <Text style={styles.routeValue}>LLM-01</Text>
                </View>
                <View style={[styles.routeCard, styles.routeCardTertiary]}>
                  <Text style={styles.routeLabel}>Audio</Text>
                  <Text style={styles.routeValue}>VOICE STT</Text>
                </View>
                <View style={[styles.routeCard, styles.routeCardSecondary]}>
                  <Text style={styles.routeLabel}>Output</Text>
                  <Text style={styles.routeValue}>SPEECH</Text>
                </View>
              </View>
              <Text style={styles.subtle}>Suggested Sub-routines</Text>
              <View style={styles.chipRow}>
                {assistantExampleCommands.map((example) => (
                  <TouchableOpacity key={`hero-${example}`} style={styles.chip} activeOpacity={0.8} onPress={() => setAssistantCommand(example)}>
                    <Text style={styles.chipText}>{example}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.dashboardWide}>
                <Text style={styles.inlineCardTitle}>Environmental Logic</Text>
                <Text style={styles.subtle}>Nominal state active</Text>
                <Text style={styles.dashboardValue}>98%</Text>
              </View>
              <View style={styles.dashboardRow}>
                <View style={styles.dashboardCell}>
                  <Text style={styles.dashboardValueSmall}>{artifacts.length || 12}</Text>
                  <Text style={styles.subtle}>Active Artifacts</Text>
                </View>
                <View style={styles.dashboardCell}>
                  <Text style={styles.dashboardValueSmall}>4.2ms</Text>
                  <Text style={styles.subtle}>Latent Response</Text>
                </View>
              </View>
            </>
          ) : null}
          {activeTab === "review" ? (
            <View style={styles.dashboardWide}>
              <Text style={styles.inlineCardTitle}>Neural Synchronization: 42%</Text>
              <Text style={styles.subtle}>Load due cards, reveal answers, and rate quickly.</Text>
            </View>
          ) : null}
          {activeTab === "alarms" ? (
            <View style={styles.dashboardWide}>
              <Text style={styles.inlineCardTitle}>Next Briefing</Text>
              <Text style={styles.subtle}>Scheduled for {toHourMinuteLabel(alarmHour, alarmMinute)}</Text>
            </View>
          ) : null}
        </View>

        {activeTab === "capture" ? (
          <View style={styles.panel}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionKicker}>Recent Artifacts</Text>
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{pendingCaptures.length} Pending</Text>
              </View>
            </View>
            <View style={styles.captureHeroActions}>
              <Pressable
                style={styles.primaryAction}
                onPressIn={() => {
                  beginHoldToTalkCapture().catch(() => undefined);
                }}
                onPressOut={() => {
                  endHoldToTalkCapture().catch(() => undefined);
                }}
              >
                <MaterialCommunityIcons name={voiceRecording ? "stop" : "microphone"} size={16} color={palette.onAccent} />
                <Text style={styles.primaryActionText}>{holdToTalkLabel}</Text>
              </Pressable>
              <TouchableOpacity style={styles.iconAction} onPress={submitQuickCapture}>
                <MaterialCommunityIcons name="camera-outline" size={16} color={palette.accent} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconAction} onPress={() => setQuickCaptureText((prev) => prev || "Quick note")}>
                <MaterialCommunityIcons name="format-text" size={16} color={palette.accent} />
              </TouchableOpacity>
            </View>
            <Text style={styles.subtle}>Press and hold to capture a voice note. Release to stop, then upload or queue it from Mission Tools.</Text>
            <View style={styles.captureArtifactCard}>
              <Text style={styles.captureTrackLabel}>Science Track</Text>
              <Text style={styles.captureArtifactTitle}>{selectedArtifact?.title || "Atmospheric Scan"}</Text>
              <Text style={styles.body}>
                {quickCaptureText.trim() ||
                  "Detected trace amounts of Argon-40 near the sector 7 ridge. Suggests tectonic activity in the lower crust."}
              </Text>
              <View style={styles.chipRow}>
                <View style={styles.miniTag}>
                  <Text style={styles.miniTagText}>#TECTONIC</Text>
                </View>
                <View style={styles.miniTag}>
                  <Text style={styles.miniTagText}>#S7_RIDGE</Text>
                </View>
              </View>
            </View>
            <View style={styles.captureMediaRow}>
              <View style={styles.captureMediaTile}>
                <MaterialCommunityIcons name="image-outline" size={16} color={palette.accent} />
                <Text style={styles.subtle}>Visual_LOG_01.png</Text>
              </View>
              <View style={styles.captureAlertTile}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={palette.secondary} />
                <Text style={styles.inlineCardTitle}>Power Flux</Text>
                <Text style={styles.subtle}>Spike in reactor core telemetry.</Text>
              </View>
            </View>
            <View style={styles.captureVoiceMemo}>
              <TouchableOpacity style={styles.capturePlayButton} onPress={playCached}>
                <MaterialCommunityIcons name="play" size={20} color={palette.onAccent} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.inlineCardTitle}>Captain&apos;s Memo</Text>
                <Text style={styles.subtle}>{voiceClipUri ? `${Math.round(voiceClipDurationMs / 1000)}s` : "42s"}</Text>
              </View>
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => {
                  setCaptureOpsSection("queue");
                  setShowAdvancedCapture((value) => !value);
                }}
              >
                <Text style={styles.buttonText}>{showAdvancedCapture ? "Close Mission Tools" : "Open Mission Tools"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {activeTab === "review" ? (
          <View style={styles.panel}>
            <View style={styles.reviewTopRow}>
              <View>
                <Text style={styles.sectionKicker}>Current Session</Text>
                <Text style={styles.subtle}>Neural Synchronization: 42%</Text>
              </View>
              <View style={styles.reviewPillRow}>
                <View style={styles.reviewPill}>
                  <Text style={styles.reviewPillText}>12</Text>
                </View>
                <View style={styles.reviewPill}>
                  <Text style={styles.reviewPillText}>85</Text>
                </View>
              </View>
            </View>
            <View style={styles.reviewFlashcard}>
              <Text style={styles.reviewMeta}>Last seen: 4 days ago</Text>
              <Text style={styles.reviewCategory}>Scientific Nomenclature</Text>
              <Text style={styles.reviewPromptLarge}>{reviewCard?.prompt || "Nebular Nucleosynthesis"}</Text>
              <View style={styles.reviewDivider} />
              <Text style={styles.reviewAnswerLarge}>
                {showAnswer
                  ? reviewCard?.answer ||
                    "The process responsible for the formation of heavy elements within the core of collapsing stellar bodies."
                  : "Tap reveal to show answer"}
              </Text>
              <TouchableOpacity
                style={styles.button}
                onPress={() => {
                  if (!reviewCard) {
                    loadDueCards().catch(() => undefined);
                  }
                  setShowAnswer(true);
                }}
              >
                <Text style={styles.buttonText}>Reveal Answer</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.reviewRateRow}>
              <TouchableOpacity
                style={styles.reviewRateButton}
                onPress={() => (reviewCard ? submitReview(1) : setStatus("Load due cards first"))}
              >
                <Text style={styles.reviewRateLabel}>Again</Text>
                <Text style={styles.reviewRateValue}>1m</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.reviewRateButton}
                onPress={() => (reviewCard ? submitReview(2) : setStatus("Load due cards first"))}
              >
                <Text style={styles.reviewRateLabel}>Hard</Text>
                <Text style={styles.reviewRateValue}>2d</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reviewRateButton, styles.reviewRateButtonActive]}
                onPress={() => (reviewCard ? submitReview(4) : setStatus("Load due cards first"))}
              >
                <Text style={[styles.reviewRateLabel, styles.reviewRateLabelActive]}>Good</Text>
                <Text style={styles.reviewRateValue}>4d</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.reviewRateButton}
                onPress={() => (reviewCard ? submitReview(5) : setStatus("Load due cards first"))}
              >
                <Text style={styles.reviewRateLabel}>Easy</Text>
                <Text style={styles.reviewRateValue}>7d</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => {
                  setReviewOpsSection("session");
                  setShowAdvancedReview((value) => !value);
                }}
              >
                <Text style={styles.buttonText}>{showAdvancedReview ? "Close Mission Tools" : "Open Mission Tools"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {activeTab === "alarms" ? (
          <View style={styles.panel}>
            <View style={styles.alarmClockRow}>
              <Text style={styles.alarmClockText}>{toHourMinuteLabel(stationHour12, alarmMinute)}</Text>
              <Text style={styles.alarmClockPeriod}>{stationPeriod}</Text>
            </View>
            <Text style={styles.alarmStationMeta}>Station Time • Sector 7G</Text>
            <View style={styles.alarmNextCard}>
              <View>
                <Text style={styles.inlineCardTitle}>Next Briefing</Text>
                <Text style={styles.subtle}>Scheduled for {toHourMinuteLabel(stationHour12, alarmMinute)} {stationPeriod}</Text>
              </View>
              <View>
                <Text style={styles.alarmCountdown}>{nextBriefingCountdown}</Text>
                <Text style={styles.subtle}>Until Sync</Text>
              </View>
            </View>
            <View style={styles.alarmPlayerCard}>
              <Text style={styles.inlineCardTitle}>Daily Briefing</Text>
              <Text style={styles.subtle}>Galactic Market Pulse • Neural Link 4.2</Text>
              <Text style={styles.subtle}>{offlineBriefingStatus}</Text>
              <View style={styles.alarmWaveRow}>
                {[4, 10, 6, 14, 5, 11, 13, 4, 8, 12].map((height, index) => (
                  <View key={index} style={[styles.alarmWaveBar, { height }]} />
                ))}
              </View>
              <View style={styles.alarmPlayerButtons}>
                <TouchableOpacity
                  style={[styles.iconAction, !cachedPath ? { opacity: 0.45 } : null]}
                  onPress={playCached}
                >
                  <MaterialCommunityIcons name="play" size={18} color={palette.accent} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconAction} onPress={queueBriefingAudio}>
                  <MaterialCommunityIcons name="text-to-speech" size={18} color={palette.accent} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconAction} onPress={generateAndCache}>
                  <MaterialCommunityIcons name="download-outline" size={18} color={palette.accent} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.alarmCycleCard}>
              <Text style={styles.inlineCardTitle}>Active Cycles</Text>
              <View style={styles.alarmCycleRow}>
                <View>
                  <Text style={styles.alarmCycleTime}>{toHourMinuteLabel(stationHour12, alarmMinute)}</Text>
                  <Text style={styles.subtle}>Morning Manifest</Text>
                </View>
                <TouchableOpacity style={styles.toggleButton} onPress={alarmNotificationId ? clearMorningAlarm : scheduleMorningAlarm}>
                  <View style={[styles.toggleKnob, alarmNotificationId ? styles.toggleKnobOn : null]} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => {
                  setAlarmOpsSection("briefing");
                  setShowAdvancedAlarms((value) => !value);
                }}
              >
                <Text style={styles.buttonText}>{showAdvancedAlarms ? "Close Mission Tools" : "Open Mission Tools"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {renderCaptureOpsPanel()}
        {renderReviewOpsPanel()}
        {renderAlarmOpsPanel()}
      </ScrollView>
      <TouchableOpacity
        style={styles.fab}
        onPress={() => {
          if (sttResolution.active === "on_device") {
            submitLocalVoiceAssistantCommand(false).catch(() => undefined);
            return;
          }
          if (voiceRecording) {
            stopVoiceRecording().catch(() => undefined);
            return;
          }
          startVoiceRecording().catch(() => undefined);
        }}
      >
        <MaterialCommunityIcons name="waveform" size={20} color={palette.onAccent} />
      </TouchableOpacity>
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.bottomNavItem}
          onPress={() => {
            setActiveTab("capture");
            setStatus("Capture surface active");
          }}
        >
          <MaterialCommunityIcons
            name="camera-iris"
            size={17}
            color={activeTab === "capture" ? palette.accent : palette.muted}
          />
          <Text style={[styles.bottomNavLabel, activeTab === "capture" ? styles.bottomNavLabelActive : null]}>Capture</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.bottomNavItem}
          onPress={() => {
            setActiveTab("alarms");
            setStatus("Alarm + briefing surface active");
          }}
        >
          <MaterialCommunityIcons
            name="bell-ring-outline"
            size={17}
            color={activeTab === "alarms" ? palette.accent : palette.muted}
          />
          <Text style={[styles.bottomNavLabel, activeTab === "alarms" ? styles.bottomNavLabelActive : null]}>Alarms</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.bottomNavItem}
          onPress={() => {
            setActiveTab("review");
            setStatus("Quick review surface active");
          }}
        >
          <MaterialCommunityIcons
            name="eye-outline"
            size={17}
            color={activeTab === "review" ? palette.accent : palette.muted}
          />
          <Text style={[styles.bottomNavLabel, activeTab === "review" ? styles.bottomNavLabelActive : null]}>Review</Text>
        </TouchableOpacity>
      </View>
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
      top: -120,
      right: -120,
      width: 260,
      height: 260,
      borderRadius: 999,
      backgroundColor: palette.accentMuted,
    },
    bgOrbCenter: {
      position: "absolute",
      top: 180,
      left: -100,
      width: 220,
      height: 220,
      borderRadius: 999,
      backgroundColor: "rgba(131,212,211,0.08)",
    },
    topBar: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: "rgba(201,190,255,0.1)",
      backgroundColor: "rgba(16,20,26,0.84)",
    },
    topBarBrand: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
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
    topBarAvatarText: {
      color: palette.accent,
      fontSize: 12,
      fontWeight: "700",
    },
    topBarTitle: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "700",
      letterSpacing: 0.2,
    },
    topBarActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    topBarIconButton: {
      width: 34,
      height: 34,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceLow,
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
      paddingTop: 18,
      paddingBottom: 136,
      gap: 14,
    },
    hero: {
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.panel,
      borderRadius: 20,
      padding: 18,
      gap: 10,
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
      fontSize: 31,
      fontWeight: "600",
    },
    body: {
      color: palette.muted,
      fontSize: 14,
      lineHeight: 21,
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
    pendingBadge: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: "rgba(201,190,255,0.12)",
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
    primaryAction: {
      flex: 1,
      borderWidth: 1,
      borderColor: "rgba(49,17,142,0.18)",
      backgroundColor: palette.accent,
      borderRadius: 12,
      minHeight: 42,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
    },
    primaryActionText: {
      color: palette.onAccent,
      fontSize: 14,
      fontWeight: "700",
    },
    iconAction: {
      width: 42,
      height: 42,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceHigh,
      alignItems: "center",
      justifyContent: "center",
    },
    captureArtifactCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 14,
      padding: 12,
      backgroundColor: palette.surfaceLow,
      gap: 6,
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
      fontSize: 30,
      fontWeight: "600",
      lineHeight: 36,
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
      borderRadius: 14,
      backgroundColor: "rgba(6,11,22,0.65)",
      padding: 10,
      justifyContent: "flex-end",
      gap: 4,
    },
    captureAlertTile: {
      flex: 1,
      minHeight: 110,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 14,
      backgroundColor: palette.surfaceLow,
      padding: 10,
      gap: 4,
    },
    captureVoiceMemo: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 14,
      backgroundColor: palette.surfaceHigh,
      padding: 10,
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
      borderWidth: 1,
      borderColor: "rgba(49,17,142,0.15)",
    },
    routeHint: {
      color: palette.muted,
      fontSize: 9,
      lineHeight: 10,
    },
    dashboardWide: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 14,
      padding: 12,
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
      borderRadius: 14,
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
      fontWeight: "300",
      lineHeight: 56,
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
      borderRadius: 14,
      backgroundColor: palette.surfaceLow,
      padding: 12,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
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
      borderRadius: 14,
      padding: 12,
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
      borderRadius: 14,
      padding: 12,
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
      borderRadius: 16,
      padding: 14,
      gap: 9,
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
      borderColor: palette.border,
      borderRadius: 12,
      padding: 10,
      gap: 4,
      backgroundColor: palette.surfaceLow,
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
      fontSize: 13,
      fontWeight: "700",
    },
    detailCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 14,
      padding: 10,
      gap: 8,
      backgroundColor: "rgba(16,20,26,0.55)",
      marginTop: 6,
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
      borderColor: palette.border,
      borderRadius: 12,
      padding: 12,
      gap: 8,
      backgroundColor: palette.surfaceLow,
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
    fab: {
      position: "absolute",
      right: 22,
      bottom: 84,
      width: 64,
      height: 64,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "rgba(49,17,142,0.15)",
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
      borderTopWidth: 1,
      borderTopColor: "rgba(201,190,255,0.12)",
      backgroundColor: "rgba(10,14,20,0.92)",
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 12,
      flexDirection: "row",
      justifyContent: "space-around",
    },
    bottomNavItem: {
      alignItems: "center",
      justifyContent: "center",
      minWidth: 72,
    },
    bottomNavLabel: {
      color: palette.muted,
      fontSize: 10,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    bottomNavLabelActive: {
      color: palette.accent,
    },
  });
}
