import { StatusBar } from "expo-status-bar";
import * as FileSystem from "expo-file-system";
import * as Notifications from "expo-notifications";
import * as Speech from "expo-speech";
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

type PendingCapture = {
  id: string;
  title: string;
  text: string;
  sourceUrl: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

type PersistedState = {
  version: 1;
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

const DEFAULT_API_BASE = "http://localhost:8000";
const DEFAULT_PWA_BASE = "http://localhost:3000";
const DEFAULT_CAPTURE_TITLE = "Mobile capture";
const artifactQuickActions: Array<{ label: string; action: ArtifactAction }> = [
  { label: "Summarize", action: "summarize" },
  { label: "Create Cards", action: "cards" },
  { label: "Generate Tasks", action: "tasks" },
  { label: "Append Note", action: "append_note" },
];

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
    const file = stateFilePath();
    const info = await FileSystem.getInfoAsync(file);
    if (!info.exists) {
      return null;
    }
    const raw = await FileSystem.readAsStringAsync(file);
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writePersistedState(payload: PersistedState): Promise<void> {
  const file = stateFilePath();
  await FileSystem.writeAsStringAsync(file, JSON.stringify(payload));
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
  const [briefingDate, setBriefingDate] = useState(tomorrowDateString());
  const [cachedPath, setCachedPath] = useState<string | null>(null);
  const [alarmHour, setAlarmHour] = useState(7);
  const [alarmMinute, setAlarmMinute] = useState(0);
  const [alarmNotificationId, setAlarmNotificationId] = useState<string | null>(null);
  const [pendingCaptures, setPendingCaptures] = useState<PendingCapture[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactListItem[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [dueCards, setDueCards] = useState<DueCard[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState("unknown");
  const [status, setStatus] = useState("Ready");
  const [hydrated, setHydrated] = useState(false);
  const flushInFlight = useRef(false);
  const cardPromptStartedAt = useRef<number | null>(null);
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;

  async function sendCapture(item: PendingCapture): Promise<string> {
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
      if (!selectedArtifactId && payload[0]) {
        setSelectedArtifactId(payload[0].id);
      }
      setStatus(`Loaded ${payload.length} artifact(s) for triage`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load artifacts");
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
      setStatus(`Requested ${action} for ${selectedArtifactId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Artifact action failed");
    }
  }

  async function openSelectedArtifactInPwa() {
    const base = normalizeBaseUrl(pwaBase);
    if (!selectedArtifactId) {
      await openPwa();
      return;
    }
    try {
      await Linking.openURL(`${base}/artifacts?artifact=${encodeURIComponent(selectedArtifactId)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open artifact in PWA");
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
    setStatus(`Capture queued (${reason}). Pending: ${pendingCaptures.length + 1}`);
  }

  async function submitQuickCapture() {
    const text = quickCaptureText.trim();
    if (!text) {
      setStatus("Enter capture text first");
      return;
    }

    const capture: PendingCapture = {
      id: `mobcap_${Date.now()}`,
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
      version: 1,
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
    }).catch(() => undefined);
  }, [
    alarmHour,
    alarmMinute,
    alarmNotificationId,
    apiBase,
    briefingDate,
    cachedPath,
    hydrated,
    pendingCaptures,
    pwaBase,
    quickCaptureSourceUrl,
    quickCaptureText,
    quickCaptureTitle,
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
          <Text style={styles.subtle}>Pending captures: {pendingCaptures.length}</Text>
          {pendingCaptures[0]?.lastError ? (
            <Text style={styles.subtle}>Last queue error: {pendingCaptures[0].lastError}</Text>
          ) : null}
          {pendingCaptures.slice(0, 3).map((capture) => (
            <View key={capture.id} style={styles.inlineCard}>
              <Text style={styles.subtle}>{capture.title}</Text>
              <Text style={styles.subtle}>
                attempts: {capture.attempts} | queued {new Date(capture.createdAt).toLocaleTimeString()}
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
          </View>
          <Text style={styles.subtle}>
            Selected: {selectedArtifact ? `${selectedArtifact.title || selectedArtifact.id}` : "none"}
          </Text>
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
