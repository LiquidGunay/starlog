import { StatusBar } from "expo-status-bar";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as Notifications from "expo-notifications";
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
  date: string;
  text: string;
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

type PendingCapture = PendingTextCapture | PendingVoiceCapture;

type PersistedState = {
  version: 2;
  apiBase: string;
  pwaBase: string;
  token: string;
  quickCaptureTitle: string;
  quickCaptureText: string;
  quickCaptureSourceUrl: string;
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
};

type LegacyPersistedState = Omit<
  PersistedState,
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

const DEFAULT_API_BASE = "http://localhost:8000";
const DEFAULT_PWA_BASE = "http://localhost:3000";
const DEFAULT_CAPTURE_TITLE = "Mobile capture";
const DEFAULT_VOICE_MIME = "audio/x-m4a";
const MOBILE_DB_NAME = "starlog-mobile.db";
const MOBILE_STATE_KEY = "state_v2";
const artifactQuickActions: Array<{ label: string; action: ArtifactAction }> = [
  { label: "Summarize", action: "summarize" },
  { label: "Create Cards", action: "cards" },
  { label: "Generate Tasks", action: "tasks" },
  { label: "Append Note", action: "append_note" },
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
      const parsed = JSON.parse(row.value) as PersistedState;
      if (parsed.version === 2) {
        return parsed;
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
      version: 2,
      artifacts: [],
      selectedArtifactId: "",
      artifactGraph: null,
      artifactVersions: null,
      dueCards: [],
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
    const payload = (await existing.json()) as { text: string };
    return { date, text: payload.text };
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

  const payload = (await generated.json()) as { text: string };
  return { date, text: payload.text };
}

async function cacheBriefing(payload: BriefingPayload): Promise<string> {
  const path = `${writableDir()}briefing-${payload.date}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(payload));
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
  const [voiceRecording, setVoiceRecording] = useState<Audio.Recording | null>(null);
  const [voiceClipUri, setVoiceClipUri] = useState<string | null>(null);
  const [voiceClipDurationMs, setVoiceClipDurationMs] = useState(0);
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
  const [showAnswer, setShowAnswer] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState("unknown");
  const [status, setStatus] = useState("Ready");
  const [hydrated, setHydrated] = useState(false);
  const flushInFlight = useRef(false);
  const cardPromptStartedAt = useRef<number | null>(null);
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;

  async function sendCapture(item: PendingCapture): Promise<string> {
    if (item.kind === "voice") {
      const formData = new FormData();
      formData.append("title", item.title);
      if (item.sourceUrl) {
        formData.append("source_url", item.sourceUrl);
      }
      formData.append("duration_ms", String(item.durationMs));
      formData.append("provider_hint", "whisper_local");
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
      setStatus(`Queued Whisper transcript job ${payload.job_id}`);
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
      const response = await fetch(
        `${normalizeBaseUrl(apiBase)}/v1/artifacts/${selectedArtifactId}/actions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action }),
        },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Artifact action failed: ${response.status} ${errorBody}`);
      }
      await loadArtifactDetail(selectedArtifactId);
      setStatus(`Requested ${action} for ${selectedArtifactId}`);
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
    setStatus("Speaking selected artifact locally");
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
    setStatus(`${item.kind === "voice" ? "Voice note" : "Capture"} queued (${reason}). Pending: ${pendingCaptures.length + 1}`);
  }

  async function submitQuickCapture() {
    const text = quickCaptureText.trim();
    if (!text) {
      setStatus("Enter capture text first");
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
      Speech.speak(briefing.text);
      setStatus("Playing cached briefing");
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
      const briefing = await loadBriefingFromApi(normalizeBaseUrl(apiBase), token, briefingDate);
      const path = await cacheBriefing(briefing);
      setCachedPath(path);
      setStatus(`Cached briefing for ${briefingDate}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to cache briefing");
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

  async function openPwa() {
    try {
      await Linking.openURL(pwaBase);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open PWA URL");
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

      const persisted = await readPersistedState();
      if (active && persisted) {
        setApiBase(persisted.apiBase);
        setPwaBase(persisted.pwaBase);
        setToken(persisted.token);
        setQuickCaptureTitle(persisted.quickCaptureTitle);
        setQuickCaptureText(persisted.quickCaptureText);
        setQuickCaptureSourceUrl(persisted.quickCaptureSourceUrl);
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
      }

      const initialUrl = await Linking.getInitialURL();
      if (active && initialUrl) {
        const deepCapture = parseCaptureDeepLink(initialUrl);
        if (deepCapture) {
          setQuickCaptureTitle(deepCapture.title);
          setQuickCaptureText(deepCapture.text);
          setQuickCaptureSourceUrl(deepCapture.sourceUrl);
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
          Speech.speak(briefing.text);
          setStatus("Playing scheduled morning briefing");
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
      setStatus("Loaded capture from share deep link");
    });

    return () => {
      active = false;
      notificationSubscription.remove();
      linkSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && token && pendingCaptures.length > 0) {
        flushPendingCaptures("auto").catch(() => undefined);
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
      version: 2,
      apiBase,
      pwaBase,
      token,
      quickCaptureTitle,
      quickCaptureText,
      quickCaptureSourceUrl,
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
    }).catch(() => undefined);
  }, [
    alarmHour,
    alarmMinute,
    alarmNotificationId,
    apiBase,
    artifactGraph,
    artifactVersions,
    artifacts,
    briefingDate,
    cachedPath,
    dueCards,
    hydrated,
    pendingCaptures,
    pwaBase,
    quickCaptureSourceUrl,
    quickCaptureText,
    quickCaptureTitle,
    selectedArtifactId,
    token,
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
