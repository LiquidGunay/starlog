import { StatusBar } from "expo-status-bar";
import * as FileSystem from "expo-file-system";
import * as Notifications from "expo-notifications";
import * as Speech from "expo-speech";
import { useEffect, useMemo, useState } from "react";
import {
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

const quickActions = ["Summarize", "Create Cards", "Generate Tasks", "Append Note"];

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

function tomorrowDateString(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

function nextMorningAt(hour: number): Date {
  const target = new Date();
  target.setDate(target.getDate() + 1);
  target.setHours(hour, 0, 0, 0);
  return target;
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
  const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error("No writable directory for briefing cache");
  }

  const path = `${dir}briefing-${payload.date}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(payload));
  return path;
}

async function readCachedBriefing(path: string): Promise<BriefingPayload> {
  const text = await FileSystem.readAsStringAsync(path);
  return JSON.parse(text) as BriefingPayload;
}

export default function App() {
  const palette = usePalette();
  const styles = useMemo(() => themedStyles(palette), [palette]);
  const [apiBase, setApiBase] = useState("http://localhost:8000");
  const [token, setToken] = useState("");
  const [quickCaptureTitle, setQuickCaptureTitle] = useState("Mobile capture");
  const [quickCaptureText, setQuickCaptureText] = useState("");
  const [briefingDate, setBriefingDate] = useState(tomorrowDateString());
  const [cachedPath, setCachedPath] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const path = response.notification.request.content.data?.briefingPath;
      if (typeof path === "string") {
        const briefing = await readCachedBriefing(path);
        Speech.speak(briefing.text);
      }
    });
    return () => subscription.remove();
  }, []);

  async function generateAndCache() {
    try {
      if (!token) {
        setStatus("Add API token first");
        return;
      }
      const briefing = await loadBriefingFromApi(apiBase, token, briefingDate);
      const path = await cacheBriefing(briefing);
      setCachedPath(path);
      setStatus(`Cached briefing for ${briefingDate}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to cache briefing");
    }
  }

  async function submitQuickCapture() {
    try {
      if (!token) {
        setStatus("Add API token first");
        return;
      }

      const text = quickCaptureText.trim();
      if (!text) {
        setStatus("Enter capture text first");
        return;
      }

      const response = await fetch(`${apiBase}/v1/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          source_type: "clip_mobile",
          capture_source: "mobile_companion",
          title: quickCaptureTitle || "Mobile capture",
          raw: { text, mime_type: "text/plain" },
          normalized: { text, mime_type: "text/plain" },
          extracted: { text, mime_type: "text/plain" },
          metadata: {
            source: "mobile_app",
            captured_at: new Date().toISOString(),
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Capture failed: ${response.status} ${errorBody}`);
      }

      const payload = (await response.json()) as { artifact: { id: string } };
      setQuickCaptureText("");
      setStatus(`Captured artifact ${payload.artifact.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Capture failed");
    }
  }

  async function playCached() {
    try {
      if (!cachedPath) {
        setStatus("No cached briefing yet");
        return;
      }
      const briefing = await readCachedBriefing(cachedPath);
      Speech.speak(briefing.text);
      setStatus("Playing cached briefing");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to play cached briefing");
    }
  }

  async function scheduleMorningAlarm() {
    try {
      if (!cachedPath) {
        setStatus("Cache briefing before scheduling");
        return;
      }

      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        setStatus("Notification permission denied");
        return;
      }

      const triggerDate = nextMorningAt(7);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Starlog Morning Brief",
          body: "Tap to play your cached spoken briefing.",
          data: { briefingPath: cachedPath },
        },
        trigger: triggerDate,
      });

      setStatus(`Alarm scheduled for ${triggerDate.toLocaleString()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to schedule alarm");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={palette.bg === "#070c1b" ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Starlog Companion</Text>
          <Text style={styles.title}>Capture fast. Wake focused.</Text>
          <Text style={styles.body}>
            Mobile app handles clipping, alarms, and quick review while deep planning stays in the PWA.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Today&apos;s shortcuts</Text>
          <View style={styles.chipRow}>
            {quickActions.map((action) => (
              <TouchableOpacity key={action} style={styles.chip} activeOpacity={0.8}>
                <Text style={styles.chipText}>{action}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Capture title</Text>
          <TextInput style={styles.input} value={quickCaptureTitle} onChangeText={setQuickCaptureTitle} />
          <Text style={styles.label}>Quick capture text</Text>
          <TextInput
            style={styles.input}
            value={quickCaptureText}
            onChangeText={setQuickCaptureText}
            placeholder="Clip text, ideas, or reminders..."
            placeholderTextColor={palette.muted}
            multiline
          />
          <TouchableOpacity style={styles.button} onPress={submitQuickCapture}>
            <Text style={styles.buttonText}>Capture to Inbox</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Offline Morning Brief Pipeline</Text>
          <Text style={styles.label}>API base</Text>
          <TextInput style={styles.input} value={apiBase} onChangeText={setApiBase} autoCapitalize="none" />
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

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={generateAndCache}>
              <Text style={styles.buttonText}>Cache Briefing</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={playCached}>
              <Text style={styles.buttonText}>Play Cached</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={scheduleMorningAlarm}>
              <Text style={styles.buttonText}>Schedule 7AM Alarm</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.body}>Cached file: {cachedPath ?? "none"}</Text>
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
  });
}
