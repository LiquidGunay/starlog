import { useState, type ReactNode } from "react";
import type { AssistantCard as ConversationCard, AssistantCardAction } from "@starlog/contracts";
import { PRODUCT_SURFACES, productCopy } from "@starlog/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

import { mobileConversationCardLabel } from "./conversation-cards";
import {
  deriveMobileLibraryViewModel,
  type MobileLibraryArtifact,
  type MobileLibraryInboxRow,
  type MobileLibraryPendingCapture,
  type MobileLibrarySegment,
} from "./mobile-library-view-model";
import {
  deriveMobileArtifactDetailViewModel,
  type MobileArtifactActionExecution,
  type MobileArtifactActionRow,
  type MobileArtifactDetail,
} from "./mobile-library-detail-view-model";
import {
  deriveMobilePlannerViewModel,
  type MobilePlannerSummary,
  type MobilePlannerTimelineBlock,
} from "./mobile-planner-view-model";
import {
  deriveMobileReviewViewModel,
  type MobileReviewGradeOption,
  type MobileReviewLearningInsight,
  type MobileReviewRecommendedDrill,
  type MobileReviewStageChip,
  type MobileReviewStats,
} from "./mobile-review-view-model";

const DIAGNOSTIC_CARD_KINDS = new Set(["thread_context", "tool_step"]);

type SharedProps = {
  styles: Record<string, any>;
  palette: Record<string, string>;
};

type ConversationMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  cards: ConversationCard[];
  metadata?: Record<string, unknown>;
  created_at: string;
};

type MobileHomeSurfaceProps = SharedProps & {
  pendingConversationTurn: boolean;
  homeDraft: string;
  setHomeDraft: (value: string) => void;
  runAssistantTurn: () => void;
  onVoiceAction: () => void;
  onCancelVoiceAction: () => void;
  voiceActionState: "idle" | "listening" | "recording" | "ready";
  voiceActionHint?: string | null;
  refreshThread: () => void;
  resetConversationSession: () => void;
  visibleConversationMessages: ConversationMessage[];
  hiddenConversationMessageCount: number;
  previewCommandFlow: () => void;
  formatCardMeta: (card: ConversationCard) => string;
  onCardAction: (action: AssistantCardAction, card: ConversationCard) => void;
  reuseCardText: (value: string) => void;
};

type MobileNotesSurfaceProps = SharedProps & {
  pendingCaptures: MobileLibraryPendingCapture[];
  artifacts: MobileLibraryArtifact[];
  selectedArtifactDetail: MobileArtifactDetail | null;
  artifactDetailStatus: string;
  openArtifactDetail: (artifactId: string) => void;
  runArtifactAction: (request: MobileArtifactActionExecution) => void;
  notesCount: number;
  linkedProjectCount: number;
  quickCaptureTitle: string;
  setQuickCaptureTitle: (value: string) => void;
  quickCaptureSourceUrl: string;
  setQuickCaptureSourceUrl: (value: string) => void;
  quickCaptureText: string;
  setQuickCaptureText: (value: string) => void;
  notesInstructionDraft: string;
  setNotesInstructionDraft: (value: string) => void;
  voiceRecording: boolean;
  holdToTalkLabel: string;
  beginHoldToTalkCapture: () => void;
  endHoldToTalkCapture: () => void;
  submitPrimaryCapture: () => void;
  flushPendingCaptures: () => void;
  captureCommandPreview: string;
  captureQueuePreview: string;
  voiceMemoPreview: string;
  sharedDraftSummary: string;
  selectedArtifactTitle: string;
  captureSourcePreview: string;
  routeNarrative: string;
  voiceClipReady: boolean;
  playVoiceClip: () => void;
  submitVoiceCapture: () => void;
  showAdvancedCapture: boolean;
  toggleMissionTools: () => void;
};

type MobileReviewSurfaceProps = SharedProps & {
  reviewPrompt: string;
  reviewAnswer: string;
  reviewDueCount: number;
  reviewCardType: string;
  reviewMeta: string;
  reviewRetentionLabel: string;
  reviewReviewedCount: number;
  reviewStats: MobileReviewStats;
  reviewStatus: string;
  reviewLearningInsights: MobileReviewLearningInsight[];
  reviewRecommendedDrill: MobileReviewRecommendedDrill | null;
  reviewDecks: Array<{
    id: string;
    name: string;
    description?: string | null;
    due_count: number;
    card_count: number;
  }>;
  showAnswer: boolean;
  revealAnswer: () => void;
  loadDueCards: () => void;
  submitReview: (rating: number) => void;
  hasReviewCard: boolean;
  openReviewWorkspace: () => void;
  suggestAssistantAsk: (prompt: string) => void;
  showAdvancedReview: boolean;
  toggleMissionTools: () => void;
};

type MobileLoginSurfaceProps = SharedProps & {
  apiBase: string;
  setApiBase: (value: string) => void;
  authPassphrase: string;
  setAuthPassphrase: (value: string) => void;
  revealPassphrase: boolean;
  setRevealPassphrase: (value: boolean) => void;
  authStatus: string;
  authBusy: boolean;
  login: () => void;
  bootstrap: () => void;
};

type MobileCalendarSurfaceProps = SharedProps & {
  plannerSummary?: MobilePlannerSummary | null;
  selectedPlannerDate: string;
  setSelectedPlannerDate: (value: string) => void;
  loadPlannerSummary: () => void;
  repairPlannerConflict: () => void;
  stationTimeLabel: string;
  stationPeriod: string;
  briefingHeroCopy: string;
  nextBriefingCountdown: string;
  offlineBriefingStatus: string;
  briefingPlaybackStatus: string;
  playBriefing: () => void;
  queueBriefingAudio: () => void;
  generateAndCache: () => void;
  canPlayOffline: boolean;
  nextActionPreview: string;
  openPwa: () => void;
  openReview: () => void;
  alarmScheduled: boolean;
  toggleAlarm: () => void;
  showAdvancedAlarms: boolean;
  toggleMissionTools: () => void;
};

function cardBase(palette: Record<string, string>) {
  return {
    borderRadius: 24,
    backgroundColor: palette.surfaceLow,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    gap: 10,
  } as const;
}

function kickerStyle(palette: Record<string, string>) {
  return {
    color: palette.accent,
    fontSize: 10,
    fontWeight: "800" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 1.4,
  };
}

function headingStyle(palette: Record<string, string>) {
  return {
    color: palette.text,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800" as const,
  };
}

function bodyStyle(palette: Record<string, string>) {
  return {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 22,
  };
}

function pillStyle(palette: Record<string, string>, active = false) {
  return {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: active ? palette.surfaceHighest : palette.surfaceHigh,
  } as const;
}

function mapRecentMessages(messages: ConversationMessage[]) {
  return messages.slice(-10);
}

function isDiagnosticConversationCard(card: ConversationCard): boolean {
  return DIAGNOSTIC_CARD_KINDS.has(card.kind);
}

function conversationCardIcon(kind: string): keyof typeof MaterialCommunityIcons.glyphMap {
  if (kind === "review_queue") {
    return "cards-outline";
  }
  if (kind === "knowledge_note") {
    return "notebook-outline";
  }
  if (kind === "task_list") {
    return "checkbox-marked-circle-outline";
  }
  if (kind === "briefing") {
    return "play-circle-outline";
  }
  if (kind === "capture_item") {
    return "tray-arrow-down";
  }
  return "star-four-points-outline";
}

function cardAttachmentLabel(kind: string, title?: string | null): string {
  if (title && title.trim()) {
    return title.trim();
  }
  if (kind === "review_queue") {
    return "Review item";
  }
  if (kind === "knowledge_note") {
    return "Library note";
  }
  if (kind === "task_list") {
    return "Task item";
  }
  if (kind === "briefing") {
    return "Briefing";
  }
  if (kind === "capture_item") {
    return "Capture";
  }
  return "Assistant attachment";
}

function compactCardMeta(meta: string): string {
  return meta.replace(/^v\d+(?:\s*·\s*)?/i, "").trim();
}

function bodyLines(body?: string | null): string[] {
  return (body || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function conversationMessageTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function conversationCardTone(kind: string, palette: Record<string, string>) {
  if (kind === "review_queue") {
    return {
      cardBorder: "rgba(166, 222, 191, 0.12)",
      cardBackground: "rgba(43, 28, 37, 0.92)",
      accentBackground: "rgba(166, 222, 191, 0.09)",
      accentBorder: "rgba(166, 222, 191, 0.16)",
      accentText: "#cfeeda",
      bodyBackground: "rgba(255,255,255,0.02)",
    };
  }
  if (kind === "task_list") {
    return {
      cardBorder: "rgba(243, 207, 122, 0.12)",
      cardBackground: "rgba(43, 28, 37, 0.92)",
      accentBackground: "rgba(243, 207, 122, 0.09)",
      accentBorder: "rgba(243, 207, 122, 0.16)",
      accentText: "#f4ddb0",
      bodyBackground: "rgba(255,255,255,0.02)",
    };
  }
  if (kind === "knowledge_note") {
    return {
      cardBorder: "rgba(151, 188, 255, 0.12)",
      cardBackground: "rgba(43, 28, 37, 0.92)",
      accentBackground: "rgba(151, 188, 255, 0.09)",
      accentBorder: "rgba(151, 188, 255, 0.16)",
      accentText: "#d7e6ff",
      bodyBackground: "rgba(255,255,255,0.02)",
    };
  }
  if (kind === "briefing") {
    return {
      cardBorder: "rgba(241, 182, 205, 0.13)",
      cardBackground: "rgba(45, 30, 39, 0.94)",
      accentBackground: "rgba(241, 182, 205, 0.09)",
      accentBorder: "rgba(241, 182, 205, 0.16)",
      accentText: palette.accent,
      bodyBackground: "rgba(255,255,255,0.02)",
    };
  }
  if (kind === "capture_item") {
    return {
      cardBorder: "rgba(241, 182, 205, 0.13)",
      cardBackground: "rgba(45, 30, 39, 0.94)",
      accentBackground: "rgba(241, 182, 205, 0.09)",
      accentBorder: "rgba(241, 182, 205, 0.16)",
      accentText: palette.accent,
      bodyBackground: "rgba(255,255,255,0.02)",
    };
  }
  return {
    cardBorder: "rgba(241, 182, 205, 0.12)",
    cardBackground: "rgba(43, 29, 37, 0.92)",
    accentBackground: "rgba(241, 182, 205, 0.09)",
    accentBorder: "rgba(241, 182, 205, 0.15)",
    accentText: palette.accent,
    bodyBackground: "rgba(255,255,255,0.02)",
  };
}

function renderConversationCardPreview(
  card: ConversationCard,
  palette: Record<string, string>,
  tone: ReturnType<typeof conversationCardTone>,
  revealActive: boolean,
) {
  const lines = bodyLines(card.body);
  const metadata = card.metadata ?? {};
  const reviewAnswer = typeof metadata.answer === "string" ? metadata.answer.trim() : "";

  if (card.kind === "review_queue") {
    return (
      <View style={{ gap: 10 }}>
        {card.body ? <Text style={[bodyStyle(palette), { fontSize: 14, lineHeight: 21 }]}>{card.body}</Text> : null}
        <View
          style={{
            borderRadius: 14,
            backgroundColor: "rgba(255,255,255,0.026)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.04)",
            padding: 10,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", gap: 8 }}>
            {["Hard", "Good", "Reveal"].map((label, index) => (
              <View
                key={label}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  minHeight: 34,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: index === 2 ? tone.accentBackground : "rgba(14, 10, 14, 0.52)",
                  borderWidth: 1,
                  borderColor: index === 2 ? tone.accentBorder : "rgba(255,255,255,0.04)",
                }}
              >
                <Text
                  style={{
                    color: index === 2 ? tone.accentText : palette.muted,
                    fontSize: 10,
                    fontWeight: "800",
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>
          {reviewAnswer ? (
            <Text style={{ color: palette.text, fontSize: 13.5, lineHeight: 20 }}>
              {revealActive ? reviewAnswer : "Reveal the answer before you rate the card."}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  if (card.kind === "task_list" && lines.length > 0) {
    return (
      <View style={{ gap: 8 }}>
        {lines.slice(0, 4).map((line) => (
          <View key={line} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 5,
                marginTop: 2,
                borderWidth: 1,
                borderColor: tone.accentBorder,
                backgroundColor: tone.accentBackground,
              }}
            />
            <Text style={{ flex: 1, color: palette.text, fontSize: 13.5, lineHeight: 20 }}>
              {line.replace(/^[-*]\s*/, "")}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  if (card.kind === "briefing") {
    return (
      <View style={{ gap: 12 }}>
        {card.body ? <Text style={[bodyStyle(palette), { fontSize: 14, lineHeight: 21 }]}>{card.body}</Text> : null}
        <View
          style={{
            borderRadius: 14,
            paddingHorizontal: 10,
            paddingVertical: 12,
            backgroundColor: "rgba(255,255,255,0.024)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.04)",
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 5,
            minHeight: 54,
          }}
        >
          {Array.from({ length: 16 }).map((_, index) => (
            <View
              key={`wave-${index}`}
              style={{
                width: 4,
                borderRadius: 999,
                height: 12 + ((index * 9) % 26),
                backgroundColor: index >= 5 && index <= 8 ? tone.accentText : "rgba(255,255,255,0.18)",
              }}
            />
          ))}
        </View>
      </View>
    );
  }

  if (card.kind === "knowledge_note") {
    return (
      <View style={{ gap: 10 }}>
        {card.body ? <Text style={[bodyStyle(palette), { fontSize: 14, lineHeight: 21 }]}>{card.body}</Text> : null}
        {lines[0] ? (
          <View
            style={{
              borderLeftWidth: 1,
              borderLeftColor: tone.accentBorder,
              paddingLeft: 10,
            }}
          >
            <Text style={{ color: palette.text, fontSize: 13.5, lineHeight: 20 }}>
              {lines[0]}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (card.kind === "assistant_summary") {
    return (
      <View style={{ gap: 10 }}>
        {card.body ? <Text style={[bodyStyle(palette), { fontSize: 14, lineHeight: 21 }]}>{card.body}</Text> : null}
        {typeof metadata.status === "string" ? (
          <View
            style={{
              alignSelf: "flex-start",
              borderRadius: 999,
              backgroundColor: tone.accentBackground,
              borderWidth: 1,
              borderColor: tone.accentBorder,
              paddingHorizontal: 9,
              paddingVertical: 5,
            }}
          >
            <Text
              style={{
                color: tone.accentText,
                fontSize: 10,
                fontWeight: "800",
                textTransform: "uppercase",
                letterSpacing: 0.8,
              }}
            >
              {metadata.status.replace(/_/g, " ")}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return <Text style={[bodyStyle(palette), { fontSize: 14, lineHeight: 21 }]}>{card.body || ""}</Text>;
}

function conversationActionTone(
  action: AssistantCardAction,
  palette: Record<string, string>,
): { backgroundColor: string; borderColor: string; color: string } {
  if (action.style === "danger") {
    return {
      backgroundColor: "rgba(255, 180, 183, 0.12)",
      borderColor: "rgba(255, 180, 183, 0.18)",
      color: palette.error,
    };
  }
  if (action.style === "primary") {
    return {
      backgroundColor: "rgba(96, 57, 75, 0.62)",
      borderColor: "rgba(241, 182, 205, 0.12)",
      color: palette.accent,
    };
  }
  return {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.06)",
    color: palette.text,
  };
}

function libraryRowIcon(row: MobileLibraryInboxRow): keyof typeof MaterialCommunityIcons.glyphMap {
  if (row.icon === "voice") {
    return "microphone-outline";
  }
  if (row.icon === "file") {
    return "file-document-outline";
  }
  if (row.icon === "artifact") {
    return "cube-outline";
  }
  return "text-box-outline";
}

function plannerTimelineTone(block: MobilePlannerTimelineBlock, palette: Record<string, string>) {
  if (block.type === "focus") {
    return { accent: "#a6debf", background: "rgba(166, 222, 191, 0.08)", border: "rgba(166, 222, 191, 0.18)" };
  }
  if (block.type === "meeting") {
    return { accent: "#9fbfff", background: "rgba(159, 191, 255, 0.08)", border: "rgba(159, 191, 255, 0.18)" };
  }
  if (block.type === "conflict") {
    return { accent: "#f3cf7a", background: "rgba(243, 207, 122, 0.1)", border: "rgba(243, 207, 122, 0.22)" };
  }
  if (block.type === "buffer") {
    return { accent: "#c8b9c1", background: "rgba(255, 255, 255, 0.04)", border: "rgba(255, 255, 255, 0.09)" };
  }
  if (block.type === "away") {
    return { accent: palette.secondary, background: "rgba(255, 255, 255, 0.03)", border: "rgba(255, 255, 255, 0.07)" };
  }
  return { accent: palette.accent, background: palette.surfaceLow, border: palette.border };
}

function plannerMetricTone(tone: string, palette: Record<string, string>) {
  if (tone === "focus") {
    return { color: "#a6debf", background: "rgba(166, 222, 191, 0.08)", border: "rgba(166, 222, 191, 0.16)" };
  }
  if (tone === "meeting") {
    return { color: "#9fbfff", background: "rgba(159, 191, 255, 0.08)", border: "rgba(159, 191, 255, 0.15)" };
  }
  if (tone === "task") {
    return { color: palette.accent, background: "rgba(241, 182, 205, 0.08)", border: "rgba(241, 182, 205, 0.14)" };
  }
  return { color: "#c8b9c1", background: "rgba(255, 255, 255, 0.04)", border: "rgba(255, 255, 255, 0.08)" };
}

function reviewStageTone(stage: MobileReviewStageChip, palette: Record<string, string>) {
  if (stage.active) {
    return { color: palette.onAccent, background: palette.accent, border: "rgba(241, 182, 205, 0.2)" };
  }
  if (stage.tone === "due") {
    return { color: "#f3cf7a", background: "rgba(243, 207, 122, 0.08)", border: "rgba(243, 207, 122, 0.18)" };
  }
  return { color: palette.muted, background: palette.surfaceHigh, border: palette.border };
}

function reviewGradeTone(option: MobileReviewGradeOption, palette: Record<string, string>) {
  if (option.tone === "again") {
    return { color: palette.error, background: "rgba(255, 180, 171, 0.08)", border: "rgba(255, 180, 171, 0.18)" };
  }
  if (option.tone === "good") {
    return { color: palette.accent, background: "rgba(241, 182, 205, 0.12)", border: "rgba(241, 182, 205, 0.2)" };
  }
  if (option.tone === "easy") {
    return { color: "#a6debf", background: "rgba(166, 222, 191, 0.08)", border: "rgba(166, 222, 191, 0.18)" };
  }
  return { color: palette.text, background: palette.surfaceHigh, border: palette.border };
}

function libraryStatChip(palette: Record<string, string>, label: string, value: string) {
  return (
    <View
      key={label}
      style={{
        minWidth: 118,
        borderRadius: 18,
        backgroundColor: palette.surfaceLow,
        borderWidth: 1,
        borderColor: palette.border,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 4,
      }}
    >
      <Text style={{ color: palette.text, fontSize: 20, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 }}>
        {label}
      </Text>
    </View>
  );
}

function librarySegmentButton(
  palette: Record<string, string>,
  segment: MobileLibrarySegment,
  activeSegment: MobileLibrarySegment,
  onPress: (segment: MobileLibrarySegment) => void,
) {
  const active = segment === activeSegment;
  return (
    <TouchableOpacity
      key={segment}
      onPress={() => onPress(segment)}
      style={{
        flex: 1,
        minWidth: 82,
        borderRadius: 999,
        paddingVertical: 10,
        alignItems: "center",
        backgroundColor: active ? palette.accent : "transparent",
      }}
    >
      <Text style={{ color: active ? palette.onAccent : palette.muted, fontSize: 12, fontWeight: "800" }}>{segment}</Text>
    </TouchableOpacity>
  );
}

function mobileCaptureRow(
  palette: Record<string, string>,
  row: MobileLibraryInboxRow,
  onPress?: (row: MobileLibraryInboxRow) => void,
) {
  const content = (
    <>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 14,
            backgroundColor: palette.surfaceHigh,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaterialCommunityIcons name={libraryRowIcon(row)} size={18} color={palette.accent} />
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={{ color: palette.text, fontSize: 16, lineHeight: 21, fontWeight: "800" }}>{row.title}</Text>
          <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 17 }}>
            {row.sourceLabel} · {row.captureTypeLabel} · {row.timestampLabel}
          </Text>
          <Text style={[kickerStyle(palette), { color: row.statusLabel === "Retry needed" ? palette.error : palette.secondary, letterSpacing: 0.8 }]}>
            {row.statusLabel}
          </Text>
        </View>
        <View
          accessibilityLabel={`${row.overflowLabel} options for ${row.title}`}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: palette.surfaceHigh,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaterialCommunityIcons name="dots-horizontal" size={18} color={palette.muted} />
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {row.actionLabels.slice(0, 2).map((action, actionIndex) => (
          <View
            key={action}
            style={{
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: actionIndex === 0 ? palette.accent : palette.surfaceHigh,
            }}
          >
            <Text style={{ color: actionIndex === 0 ? palette.onAccent : palette.text, fontSize: 12, fontWeight: "800" }}>
              {action}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
  const style = {
    borderRadius: 20,
    backgroundColor: palette.surfaceLow,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    gap: 12,
  } as const;
  if (onPress) {
    return (
      <TouchableOpacity key={row.id} onPress={() => onPress(row)} activeOpacity={0.82} style={style}>
        {content}
      </TouchableOpacity>
    );
  }
  return (
    <View key={row.id} style={style}>
      {content}
    </View>
  );
}

function artifactSectionCard(
  palette: Record<string, string>,
  title: string,
  subtitle: string | null,
  expanded: boolean,
  onToggle: () => void,
  children: ReactNode,
) {
  return (
    <View style={{ ...cardBase(palette), backgroundColor: palette.surfaceLow, padding: 0, overflow: "hidden" }}>
      <TouchableOpacity
        onPress={onToggle}
        style={{ paddingHorizontal: 16, paddingVertical: 15, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: palette.text, fontSize: 16, lineHeight: 21, fontWeight: "800" }}>{title}</Text>
          {subtitle ? <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 17 }}>{subtitle}</Text> : null}
        </View>
        <MaterialCommunityIcons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={palette.muted} />
      </TouchableOpacity>
      {expanded ? <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>{children}</View> : null}
    </View>
  );
}

function artifactKeyValueRows(palette: Record<string, string>, rows: Array<{ label: string; value: string }>) {
  return rows.map((row) => (
    <View
      key={`${row.label}:${row.value}`}
      style={{
        borderRadius: 14,
        backgroundColor: palette.surfaceHigh,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 3,
      }}
    >
      <Text style={[kickerStyle(palette), { fontSize: 9, letterSpacing: 0.7 }]}>{row.label}</Text>
      <Text style={{ color: palette.text, fontSize: 13, lineHeight: 18 }}>{row.value}</Text>
    </View>
  ));
}

function artifactActionButton(
  palette: Record<string, string>,
  action: MobileArtifactActionRow,
  onRunAction: (request: MobileArtifactActionExecution) => void,
) {
  const executableRequest = action.executableRequest;
  const enabled = executableRequest !== null;
  return (
    <TouchableOpacity
      key={action.action}
      disabled={!enabled}
      onPress={() => {
        if (executableRequest) {
          onRunAction(executableRequest);
        }
      }}
      style={{
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 9,
        backgroundColor: enabled ? palette.accent : palette.surfaceHigh,
        opacity: enabled ? 1 : 0.62,
      }}
    >
      <Text style={{ color: enabled ? palette.onAccent : palette.muted, fontSize: 12, fontWeight: "800" }}>
        {action.label}
      </Text>
    </TouchableOpacity>
  );
}

function mobileArtifactDetailView(
  palette: Record<string, string>,
  detail: MobileArtifactDetail,
  expandedSections: Record<string, boolean>,
  toggleSection: (section: string) => void,
  onRunAction: (request: MobileArtifactActionExecution) => void,
) {
  const model = deriveMobileArtifactDetailViewModel(detail);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ ...cardBase(palette), backgroundColor: palette.surfaceLow }}>
        <Text style={kickerStyle(palette)}>Artifact detail</Text>
        <Text style={{ color: palette.text, fontSize: 22, lineHeight: 28, fontWeight: "800" }}>{model.title}</Text>
        <Text style={bodyStyle(palette)}>{model.subtitle}</Text>
      </View>

      {artifactSectionCard(
        palette,
        "Artifact detail",
        detail.artifact.id,
        expandedSections.detail,
        () => toggleSection("detail"),
        <View style={{ gap: 8 }}>{artifactKeyValueRows(palette, model.captureLabels)}</View>,
      )}

      {artifactSectionCard(
        palette,
        "Quick capture / source preview",
        model.sourcePreview ? "First available source layer preview" : "No source preview in contract",
        expandedSections.preview,
        () => toggleSection("preview"),
        model.sourcePreview ? (
          <Text style={{ color: palette.text, fontSize: 14, lineHeight: 21 }}>{model.sourcePreview}</Text>
        ) : (
          <Text style={bodyStyle(palette)}>No raw, normalized, or extracted layer preview was returned.</Text>
        ),
      )}

      {artifactSectionCard(
        palette,
        "Source & provenance",
        `${model.sourceLayers.filter((layer) => layer.present).length}/${model.sourceLayers.length} layer(s) present`,
        expandedSections.provenance,
        () => toggleSection("provenance"),
        <View style={{ gap: 10 }}>
          {model.sourceLayers.map((layer) => (
            <View
              key={layer.key}
              style={{
                borderRadius: 15,
                backgroundColor: palette.surfaceHigh,
                padding: 12,
                gap: 6,
                borderWidth: 1,
                borderColor: layer.present ? "rgba(241, 182, 205, 0.16)" : "rgba(255,255,255,0.04)",
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                <Text style={{ color: palette.text, fontSize: 14, fontWeight: "800" }}>{layer.label}</Text>
                <Text style={[kickerStyle(palette), { color: layer.present ? palette.accent : palette.muted, letterSpacing: 0.7 }]}>
                  {layer.stateLabel}
                </Text>
              </View>
              {layer.preview ? <Text style={{ color: palette.text, fontSize: 13, lineHeight: 19 }}>{layer.preview}</Text> : null}
              {layer.meta.length > 0 ? <Text style={{ color: palette.muted, fontSize: 11 }}>{layer.meta.join(" · ")}</Text> : null}
            </View>
          ))}
          {artifactKeyValueRows(palette, model.provenanceRows)}
        </View>,
      )}

      {artifactSectionCard(
        palette,
        "Conversion & enrichment",
        `${detail.connections.action_run_count} action run(s) recorded`,
        expandedSections.conversion,
        () => toggleSection("conversion"),
        <View style={{ gap: 10 }}>
          {artifactKeyValueRows(palette, model.conversionRows)}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {model.actions.map((action) => artifactActionButton(palette, action, onRunAction))}
          </View>
          {model.actions
            .filter((action) => !action.enabled)
            .map((action) => (
              <Text key={`${action.action}:reason`} style={{ color: palette.muted, fontSize: 11, lineHeight: 16 }}>
                {action.label}: {action.disabledReason}
              </Text>
            ))}
        </View>,
      )}

      {artifactSectionCard(
        palette,
        "Activity & timeline",
        model.timelineRows.length > 0 ? `${model.timelineRows.length} event(s)` : "No activity returned",
        expandedSections.timeline,
        () => toggleSection("timeline"),
        model.timelineRows.length > 0 ? (
          <View style={{ gap: 9 }}>
            {model.timelineRows.map((event) => (
              <View key={event.key} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.accent, marginTop: 5 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: palette.text, fontSize: 13.5, lineHeight: 19, fontWeight: "800" }}>{event.label}</Text>
                  <Text style={{ color: palette.muted, fontSize: 11, lineHeight: 16 }}>
                    {event.occurredLabel} · {event.metaLabel}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text style={bodyStyle(palette)}>No timeline events were returned by the artifact detail endpoint.</Text>
        ),
      )}
    </View>
  );
}

export function MobileHomeSurface({
  styles,
  palette,
  pendingConversationTurn,
  homeDraft,
  setHomeDraft,
  runAssistantTurn,
  onVoiceAction,
  onCancelVoiceAction,
  voiceActionState,
  voiceActionHint,
  refreshThread,
  resetConversationSession,
  visibleConversationMessages,
  hiddenConversationMessageCount,
  previewCommandFlow,
  formatCardMeta,
  onCardAction,
  reuseCardText,
}: MobileHomeSurfaceProps) {
  const recentMessages = mapRecentMessages(visibleConversationMessages);
  const assistantReplyCount = visibleConversationMessages.filter((message) => message.role === "assistant").length;
  const attachmentCount = visibleConversationMessages.reduce((count, message) => (
    count + message.cards.filter((card) => !isDiagnosticConversationCard(card)).length
  ), 0);
  const [revealedReviewCards, setRevealedReviewCards] = useState<Record<string, boolean>>({});
  const [showDiagnosticCards, setShowDiagnosticCards] = useState(false);

  function handleCardPress(card: ConversationCard) {
    const preferredAction = card.actions.find((action) => action.kind === "navigate") ?? card.actions[0];
    if (preferredAction) {
      onCardAction(preferredAction, card);
      return;
    }
    const reusableText = card.body?.trim() || card.title?.trim() || "";
    if (reusableText) {
      reuseCardText(reusableText);
    }
  }

  const voiceIcon =
    voiceActionState === "listening" ? "waveform" : voiceActionState === "recording" ? "stop" : "microphone";
  const voiceButtonAccent =
    voiceActionState === "recording"
      ? "rgba(255, 180, 183, 0.18)"
      : voiceActionState === "listening"
        ? "rgba(166, 222, 191, 0.16)"
        : "rgba(255,255,255,0.04)";
  const composerStateLabels = [
    voiceActionState === "recording"
      ? "Listening live"
      : voiceActionState === "ready"
        ? "Voice clip ready"
        : voiceActionState === "listening"
          ? "Preparing mic"
          : "Text draft",
    pendingConversationTurn ? "Reply pending" : "Thread ready",
    hiddenConversationMessageCount > 0 ? "Shared transcript" : "Recent thread",
  ];

  return (
    <View style={{ gap: 14 }}>
      <View
        style={{
          borderRadius: 24,
          borderWidth: 1,
          borderColor: "rgba(241, 182, 205, 0.08)",
          backgroundColor: "rgba(26, 17, 23, 0.72)",
          paddingHorizontal: 14,
          paddingVertical: 14,
          gap: 10,
        }}
      >
        <Text style={[kickerStyle(palette), { color: palette.accent, letterSpacing: 1.05 }]}>Assistant thread</Text>
        <Text style={{ color: palette.text, fontSize: 24, lineHeight: 27, fontWeight: "800" }}>
          Persistent conversation, docked context, minimal chrome.
        </Text>
        <Text style={[bodyStyle(palette), { lineHeight: 21 }]}>
          Keep planning, follow-through, and returned artifacts inside one live thread instead of bouncing between surfaces.
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {[
            `${visibleConversationMessages.length} messages`,
            `${assistantReplyCount} replies`,
            `${attachmentCount} attachments`,
          ].map((label) => (
            <View
              key={label}
              style={{
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 6,
                backgroundColor: "rgba(255,255,255,0.025)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.05)",
              }}
            >
              <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ minHeight: 480, gap: 18, justifyContent: recentMessages.length === 0 ? "center" : "flex-end" }}>
        {recentMessages.length === 0 ? (
          <View style={{ alignItems: "center", gap: 10, paddingHorizontal: 24 }}>
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 16,
                backgroundColor: "rgba(241, 182, 205, 0.08)",
                borderWidth: 1,
                borderColor: "rgba(241, 182, 205, 0.12)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MaterialCommunityIcons name="star-four-points-outline" size={18} color={palette.accent} />
            </View>
            <Text style={[headingStyle(palette), { fontSize: 25, lineHeight: 30, textAlign: "center" }]}>
              {productCopy.assistant.emptyTitle}
            </Text>
            <Text style={[bodyStyle(palette), { textAlign: "center", maxWidth: 300 }]}>
              {productCopy.assistant.emptyBody}
            </Text>
          </View>
        ) : (
          recentMessages.map((message, messageIndex) => {
            const isUser = message.role === "user";
            const previousRole = recentMessages[messageIndex - 1]?.role;
            const showAssistantMarker = !isUser && previousRole !== "assistant";
            const timestampLabel = conversationMessageTimestamp(message.created_at);
            const primaryCards = isUser ? [] : message.cards.filter((card) => !isDiagnosticConversationCard(card));
            const diagnosticCards = isUser ? [] : message.cards.filter(isDiagnosticConversationCard);
            return (
              <View
                key={message.id}
                style={{
                  width: "100%",
                  alignSelf: isUser ? "flex-end" : "stretch",
                  alignItems: isUser ? "flex-end" : "flex-start",
                  marginLeft: isUser ? 70 : 0,
                  marginRight: isUser ? 0 : 2,
                  gap: 9,
                }}
              >
                {showAssistantMarker ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginLeft: 2, marginBottom: 2 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        backgroundColor: palette.accent,
                      }}
                    />
                    <Text
                      style={{
                        color: palette.muted,
                        fontSize: 10,
                        letterSpacing: 0.9,
                        textTransform: "uppercase",
                        fontWeight: "700",
                      }}
                    >
                      Assistant {timestampLabel ? `· ${timestampLabel}` : ""}
                    </Text>
                  </View>
                ) : null}
                <View
                  style={{
                    maxWidth: isUser ? "82%" : "96%",
                    borderRadius: 24,
                    borderBottomRightRadius: isUser ? 11 : 24,
                    borderBottomLeftRadius: isUser ? 24 : 11,
                    backgroundColor: isUser ? "rgba(57, 38, 47, 0.58)" : "transparent",
                    borderWidth: isUser ? 1 : 0,
                    borderColor: isUser ? "rgba(241, 182, 205, 0.06)" : "transparent",
                    paddingHorizontal: isUser ? 14 : 0,
                    paddingVertical: isUser ? 10 : 0,
                  }}
                >
                  <Text
                    style={{
                      color: palette.text,
                      fontSize: isUser ? 16 : 18,
                      lineHeight: isUser ? 24 : 31,
                      paddingHorizontal: isUser ? 0 : 3,
                      paddingVertical: isUser ? 0 : 2,
                    }}
                  >
                    {message.content || (pendingConversationTurn && messageIndex === recentMessages.length - 1 ? "Assistant reply in progress..." : "No content")}
                  </Text>
                </View>
                {primaryCards.length > 0 ? (
                  <View style={{ width: "96%", gap: 10, paddingLeft: 18, position: "relative" }}>
                    <View
                      style={{
                        position: "absolute",
                        left: 8,
                        top: 4,
                        bottom: 10,
                        width: 1,
                        backgroundColor: "rgba(241, 182, 205, 0.06)",
                      }}
                    />
                    {primaryCards.map((card, cardIndex) => {
                      const cardKey = `${message.id}-${cardIndex}-${card.kind}`;
                      const reviewAnswer = typeof card.metadata?.answer === "string" ? card.metadata.answer.trim() : "";
                      const revealActive = !!revealedReviewCards[cardKey];
                      const reusableText = card.body?.trim() || card.title?.trim() || "";
                      const meta = compactCardMeta(formatCardMeta(card));
                      const hasNavigateAction = card.actions.some((action) => action.kind === "navigate");
                      const tone = conversationCardTone(card.kind, palette);
                      return (
                        <Pressable
                          key={cardKey}
                          onPress={() => handleCardPress(card)}
                          style={{
                            marginLeft: 10,
                            flexDirection: "row",
                            alignItems: "stretch",
                            gap: 8,
                          }}
                        >
                          <View
                            style={{
                              width: 8,
                              justifyContent: "center",
                              paddingTop: 20,
                            }}
                          >
                            <View style={{ height: 1, backgroundColor: "rgba(241, 182, 205, 0.1)" }} />
                          </View>
                          <View
                            style={{
                              flex: 1,
                              borderRadius: 18,
                              borderWidth: 1,
                              borderColor: tone.cardBorder,
                              backgroundColor: "rgba(43, 28, 37, 0.62)",
                              paddingHorizontal: 13,
                              paddingVertical: 12,
                              gap: 10,
                            }}
                          >
                            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                              <View style={{ flex: 1, gap: 6 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  <Text
                                    style={[
                                      kickerStyle(palette),
                                      { color: tone.accentText, letterSpacing: 0.92, fontSize: 8.5 },
                                    ]}
                                  >
                                    {mobileConversationCardLabel(card.kind, card.title)}
                                  </Text>
                                  {meta ? (
                                    <Text
                                      style={{
                                        color: palette.muted,
                                        fontSize: 8.8,
                                        fontWeight: "700",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                      }}
                                    >
                                      {meta}
                                    </Text>
                                  ) : null}
                                </View>
                                <Text style={{ color: palette.text, fontSize: 15.5, lineHeight: 21, fontWeight: "800" }} numberOfLines={2}>
                                  {cardAttachmentLabel(card.kind, card.title)}
                                </Text>
                              </View>
                              <View
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 999,
                                  alignItems: "center",
                                  justifyContent: "center",
                                  backgroundColor: tone.accentBackground,
                                  borderWidth: 1,
                                  borderColor: tone.accentBorder,
                                  marginTop: 2,
                                }}
                              >
                                <MaterialCommunityIcons
                                  name={(hasNavigateAction ? "arrow-top-right" : conversationCardIcon(card.kind)) as never}
                                  size={13}
                                  color={tone.accentText}
                                />
                              </View>
                            </View>
                            <View
                              style={{
                                borderRadius: 13,
                                backgroundColor: "rgba(255,255,255,0.022)",
                                borderWidth: 1,
                                borderColor: "rgba(255,255,255,0.04)",
                                paddingHorizontal: 10,
                                paddingVertical: 9,
                                gap: 8,
                              }}
                            >
                              {renderConversationCardPreview(card, palette, tone, revealActive)}
                            </View>
                            <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
                              {card.kind === "review_queue" && reviewAnswer ? (
                                <TouchableOpacity
                                  style={{
                                    ...pillStyle(palette, true),
                                    paddingHorizontal: 10,
                                    paddingVertical: 5,
                                    backgroundColor: "rgba(241, 182, 205, 0.06)",
                                    borderWidth: 1,
                                    borderColor: "rgba(241, 182, 205, 0.08)",
                                  }}
                                  onPress={() =>
                                    setRevealedReviewCards((previous) => ({
                                      ...previous,
                                      [cardKey]: !previous[cardKey],
                                    }))
                                  }
                                >
                                  <Text style={{ color: palette.accent, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase" }}>
                                    {revealActive ? "Hide answer" : "Reveal"}
                                  </Text>
                                </TouchableOpacity>
                              ) : null}
                              {card.actions.map((action) => {
                                const actionTone = conversationActionTone(action, palette);
                                return (
                                  <TouchableOpacity
                                    key={`${cardKey}-${action.id}`}
                                    style={{
                                      ...pillStyle(palette, action.style === "primary"),
                                      paddingHorizontal: 10,
                                      paddingVertical: 6,
                                      borderWidth: 1,
                                      borderColor: actionTone.borderColor,
                                      backgroundColor: actionTone.backgroundColor,
                                    }}
                                    onPress={() => onCardAction(action, card)}
                                  >
                                    <Text
                                      style={{
                                        color: actionTone.color,
                                        fontSize: 9,
                                        fontWeight: "800",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.7,
                                      }}
                                    >
                                      {action.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                              {card.actions.length === 0 && reusableText ? (
                                <TouchableOpacity
                                  style={{
                                    ...pillStyle(palette),
                                    paddingHorizontal: 10,
                                    paddingVertical: 5,
                                    borderWidth: 1,
                                    borderColor: "rgba(255,255,255,0.05)",
                                    backgroundColor: "rgba(255,255,255,0.03)",
                                  }}
                                  onPress={() => reuseCardText(reusableText)}
                                >
                                  <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase" }}>
                                    Use in Assistant
                                  </Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {diagnosticCards.length > 0 ? (
                  <View style={{ width: "92%", paddingLeft: 28 }}>
                    <Pressable
                      onPress={() => setShowDiagnosticCards((previous) => !previous)}
                      style={{
                        borderRadius: 999,
                        backgroundColor: "rgba(255,255,255,0.015)",
                        paddingHorizontal: 11,
                        paddingVertical: 5,
                        alignSelf: "flex-start",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.05)",
                      }}
                    >
                      <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.1 }}>
                        System trace {showDiagnosticCards ? "shown" : "collapsed"} · {diagnosticCards.length} hidden
                      </Text>
                    </Pressable>
                    {showDiagnosticCards ? (
                      <View
                        style={{
                          gap: 8,
                          paddingTop: 8,
                          borderRadius: 16,
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.04)",
                          backgroundColor: "rgba(255,255,255,0.018)",
                          paddingHorizontal: 10,
                          paddingVertical: 10,
                        }}
                      >
                        {diagnosticCards.map((card, cardIndex) => (
                          <View
                            key={`${message.id}-diagnostic-${cardIndex}-${card.kind}`}
                            style={{
                              gap: 4,
                              borderRadius: 12,
                              borderWidth: 1,
                              borderColor: "rgba(255,255,255,0.04)",
                              backgroundColor: "rgba(255,255,255,0.02)",
                              paddingHorizontal: 10,
                              paddingVertical: 9,
                            }}
                          >
                            <Text style={{ color: palette.text, fontSize: 11.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 }}>
                              {mobileConversationCardLabel(card.kind, card.title)}
                            </Text>
                            <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>
                              {card.title || formatCardMeta(card)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      <View
        style={{
          borderRadius: 24,
          backgroundColor: "rgba(32, 20, 27, 0.78)",
          borderWidth: 1,
          borderColor: "rgba(241, 182, 205, 0.07)",
          paddingHorizontal: 10,
          paddingVertical: 10,
          shadowColor: "#000",
          shadowOpacity: 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        <View style={{ gap: 3, paddingHorizontal: 4, paddingBottom: 8 }}>
          <Text style={[kickerStyle(palette), { color: palette.accent, letterSpacing: 1.05 }]}>Composer</Text>
          <Text style={{ color: palette.text, fontSize: 16, lineHeight: 20, fontWeight: "800" }}>
            {voiceActionState === "ready"
              ? "Voice clip ready"
              : voiceActionState === "recording"
                ? "Listening now"
                : pendingConversationTurn
                  ? "Assistant is answering"
                  : "Stay in the thread"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", paddingHorizontal: 4, paddingBottom: 8 }}>
          {composerStateLabels.map((label, index) => (
            <View
              key={label}
              style={{
                borderRadius: 999,
                paddingHorizontal: 9,
                paddingVertical: 5,
                borderWidth: 1,
                borderColor: index === 0 ? "rgba(241, 182, 205, 0.1)" : "rgba(255,255,255,0.05)",
                backgroundColor: index === 0 ? "rgba(241, 182, 205, 0.06)" : "rgba(255,255,255,0.02)",
              }}
            >
              <Text
                style={{
                  color: index === 0 ? palette.text : palette.muted,
                  fontSize: 9.5,
                  fontWeight: "800",
                  textTransform: "uppercase",
                  letterSpacing: 0.65,
                }}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", paddingHorizontal: 4, paddingBottom: 8 }}>
          <TouchableOpacity
            style={{
              ...pillStyle(palette),
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.05)",
              backgroundColor: "rgba(255,255,255,0.025)",
            }}
            onPress={previewCommandFlow}
          >
            <Text style={{ color: palette.text, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
              Preview flow
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              ...pillStyle(palette),
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.05)",
              backgroundColor: "rgba(255,255,255,0.025)",
            }}
            onPress={refreshThread}
          >
            <Text style={{ color: palette.text, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
              Refresh
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              ...pillStyle(palette),
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.05)",
              backgroundColor: "rgba(255,255,255,0.025)",
            }}
            onPress={resetConversationSession}
          >
            <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
              Reset session
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
          <TouchableOpacity
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: voiceButtonAccent,
              borderWidth: 1,
              borderColor:
                voiceActionState === "recording"
                  ? "rgba(255, 180, 183, 0.18)"
                  : voiceActionState === "listening"
                    ? "rgba(166, 222, 191, 0.18)"
                    : "rgba(255,255,255,0.05)",
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={onVoiceAction}
            disabled={pendingConversationTurn || voiceActionState === "listening"}
          >
            <MaterialCommunityIcons
              name={voiceIcon as never}
              size={20}
              color={
                voiceActionState === "recording"
                  ? palette.error
                  : voiceActionState === "listening"
                    ? "#cfeeda"
                    : palette.muted
              }
            />
          </TouchableOpacity>
          <View
            style={{
              flex: 1,
              borderRadius: 20,
              backgroundColor: "rgba(255,255,255,0.02)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.04)",
              paddingHorizontal: 10,
              paddingTop: 2,
              paddingBottom: 6,
            }}
          >
            <TextInput
              style={{
                minHeight: 34,
                maxHeight: 96,
                color: palette.text,
                fontSize: 15,
                lineHeight: 21,
                fontWeight: "500",
                paddingVertical: 8,
                paddingHorizontal: 0,
              }}
              value={homeDraft}
              onChangeText={setHomeDraft}
              placeholder={productCopy.assistant.inputPlaceholder}
              placeholderTextColor={palette.muted}
              multiline
            />
            {voiceActionState !== "idle" || hiddenConversationMessageCount > 0 ? (
              <View style={{ gap: 6, paddingTop: 2 }}>
                {voiceActionState !== "idle" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <Text style={[bodyStyle(palette), { flex: 1, fontSize: 11.5, lineHeight: 17 }]}>
                      {voiceActionHint ||
                        (voiceActionState === "listening"
                          ? "Listening for an on-device message..."
                          : voiceActionState === "recording"
                            ? "Recording voice input. Tap the mic again to stop."
                            : "Voice clip ready. Tap the mic to send it.")}
                    </Text>
                    {voiceActionState === "ready" ? (
                      <TouchableOpacity
                        style={{
                          borderRadius: 999,
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.06)",
                          backgroundColor: "rgba(255,255,255,0.03)",
                        }}
                        onPress={onCancelVoiceAction}
                      >
                        <Text
                          style={{
                            color: palette.muted,
                            fontSize: 10,
                            fontWeight: "800",
                            textTransform: "uppercase",
                            letterSpacing: 0.7,
                          }}
                        >
                          Clear
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
                {hiddenConversationMessageCount > 0 ? (
                  <Text style={[bodyStyle(palette), { fontSize: 11.5, lineHeight: 17 }]}>
                    {hiddenConversationMessageCount} earlier messages remain in the shared assistant transcript.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <TouchableOpacity
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: pendingConversationTurn ? palette.surfaceHighest : palette.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={runAssistantTurn}
            disabled={pendingConversationTurn}
          >
            <MaterialCommunityIcons name={pendingConversationTurn ? "dots-horizontal" : "arrow-up"} size={22} color={palette.onAccent} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", paddingHorizontal: 4, paddingTop: 8 }}>
          {[
            voiceActionState === "idle" ? "Tap or hold mic" : "Voice active",
            hiddenConversationMessageCount > 0 ? `${hiddenConversationMessageCount} earlier messages` : "Recent thread visible",
            "Shared mobile + web transcript",
          ].map((label) => (
            <View
              key={label}
              style={{
                borderRadius: 999,
                paddingHorizontal: 9,
                paddingVertical: 5,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.05)",
                backgroundColor: "rgba(255,255,255,0.02)",
              }}
            >
              <Text style={{ color: palette.muted, fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export function MobileNotesSurface({
  styles,
  palette,
  pendingCaptures,
  artifacts,
  selectedArtifactDetail,
  artifactDetailStatus,
  openArtifactDetail,
  runArtifactAction,
  notesCount,
  linkedProjectCount,
  quickCaptureTitle,
  setQuickCaptureTitle,
  quickCaptureSourceUrl,
  setQuickCaptureSourceUrl,
  quickCaptureText,
  setQuickCaptureText,
  notesInstructionDraft,
  setNotesInstructionDraft,
  voiceRecording,
  holdToTalkLabel,
  beginHoldToTalkCapture,
  endHoldToTalkCapture,
  submitPrimaryCapture,
  flushPendingCaptures,
  captureCommandPreview,
  captureQueuePreview,
  voiceMemoPreview,
  sharedDraftSummary,
  selectedArtifactTitle,
  captureSourcePreview,
  routeNarrative,
  voiceClipReady,
  playVoiceClip,
  submitVoiceCapture,
  showAdvancedCapture,
  toggleMissionTools,
}: MobileNotesSurfaceProps) {
  const [activeSegment, setActiveSegment] = useState<MobileLibrarySegment>("Inbox");
  const [showArtifactDetail, setShowArtifactDetail] = useState(false);
  const [expandedArtifactSections, setExpandedArtifactSections] = useState<Record<string, boolean>>({
    detail: true,
    preview: true,
    provenance: true,
    conversion: true,
    timeline: false,
  });
  const libraryModel = deriveMobileLibraryViewModel({
    pendingCaptures,
    artifacts,
    notesCount,
    linkedProjectCount,
  });
  const pendingCaptureCount = pendingCaptures.length;
  const visibleRows = activeSegment === "Artifacts" ? libraryModel.artifactRows : libraryModel.inboxRows;
  const detailRequested = activeSegment === "Artifacts" && showArtifactDetail;
  const showDetailPane = detailRequested && selectedArtifactDetail;

  function openLibraryArtifact(row: MobileLibraryInboxRow) {
    openArtifactDetail(row.id);
    setActiveSegment("Artifacts");
    setShowArtifactDetail(true);
  }

  function toggleArtifactSection(section: string) {
    setExpandedArtifactSections((current) => ({ ...current, [section]: !current[section] }));
  }

  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 5 }}>
        <Text style={kickerStyle(palette)}>Starlog Library</Text>
        <Text style={headingStyle(palette)}>Processing queue</Text>
        <Text style={bodyStyle(palette)}>{libraryModel.statusLabel} · synced just now</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 2 }}>
        {libraryModel.stats.map((stat) => libraryStatChip(palette, stat.label, stat.value))}
      </ScrollView>

      <View
        style={{
          borderRadius: 999,
          backgroundColor: palette.surfaceLow,
          borderWidth: 1,
          borderColor: palette.border,
          padding: 4,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        {libraryModel.segments.map((segment) => librarySegmentButton(palette, segment, activeSegment, (nextSegment) => {
          setActiveSegment(nextSegment);
          if (nextSegment !== "Artifacts") {
            setShowArtifactDetail(false);
          }
        }))}
      </View>

      {activeSegment === "Inbox" ? (
        <View style={{ ...cardBase(palette), backgroundColor: palette.surfaceLow }}>
          <Text style={kickerStyle(palette)}>Quick capture</Text>
          <TextInput
            style={{
              borderRadius: 18,
              minHeight: 104,
              backgroundColor: "#180911",
              color: palette.text,
              padding: 16,
              fontSize: 17,
              lineHeight: 26,
              textAlignVertical: "top",
            }}
            value={quickCaptureText}
            onChangeText={setQuickCaptureText}
            placeholder="Record a thought or start typing..."
            placeholderTextColor={palette.muted}
            multiline
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TextInput
              style={{
                flex: 1,
                borderRadius: 16,
                backgroundColor: palette.surfaceHigh,
                color: palette.text,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
              }}
              value={quickCaptureTitle}
              onChangeText={setQuickCaptureTitle}
              placeholder="Capture title"
              placeholderTextColor={palette.muted}
            />
            <TextInput
              style={{
                flex: 1,
                borderRadius: 16,
                backgroundColor: palette.surfaceHigh,
                color: palette.text,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
              }}
              value={quickCaptureSourceUrl}
              onChangeText={setQuickCaptureSourceUrl}
              placeholder="https://source"
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
            />
          </View>
          <TextInput
            style={{
              borderRadius: 16,
              backgroundColor: palette.surfaceHigh,
              color: palette.text,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: 14,
            }}
            value={notesInstructionDraft}
            onChangeText={setNotesInstructionDraft}
            placeholder="Typed instruction for the artifact..."
            placeholderTextColor={palette.muted}
          />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity style={{ ...pillStyle(palette), width: 46, height: 46, alignItems: "center", justifyContent: "center" }}>
                <MaterialCommunityIcons name="text-box-outline" size={18} color={palette.muted} />
              </TouchableOpacity>
              <TouchableOpacity style={{ ...pillStyle(palette), width: 46, height: 46, alignItems: "center", justifyContent: "center" }}>
                <MaterialCommunityIcons name="paperclip" size={18} color={palette.muted} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              {voiceClipReady ? (
                <TouchableOpacity
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 23,
                    backgroundColor: palette.surfaceHigh,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onPress={playVoiceClip}
                >
                  <MaterialCommunityIcons name="play" size={18} color={palette.accent} />
                </TouchableOpacity>
              ) : null}
              <Pressable
                style={{
                  borderRadius: 999,
                  backgroundColor: palette.accent,
                  paddingHorizontal: 18,
                  paddingVertical: 13,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
                onPressIn={beginHoldToTalkCapture}
                onPressOut={endHoldToTalkCapture}
              >
                <MaterialCommunityIcons name={voiceRecording ? "stop" : "microphone"} size={18} color={palette.onAccent} />
                <Text style={{ color: palette.onAccent, fontWeight: "800", fontSize: 13 }}>
                  {voiceRecording ? holdToTalkLabel : "Record"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={[headingStyle(palette), { fontSize: 21, lineHeight: 27 }]}>
              {activeSegment === "Inbox" ? "Inbox / Unprocessed captures" : activeSegment}
            </Text>
            <Text style={bodyStyle(palette)}>
              {showDetailPane
                ? artifactDetailStatus
                : activeSegment === "Inbox"
                ? captureQueuePreview
                : activeSegment === "Artifacts"
                  ? selectedArtifactTitle
                  : activeSegment === "Sources"
                    ? captureSourcePreview
                    : routeNarrative}
            </Text>
          </View>
          <Text style={{ color: palette.secondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.1 }}>
            {pendingCaptureCount} pending
          </Text>
        </View>

        {activeSegment === "Notes" ? (
          <View style={{ ...cardBase(palette), backgroundColor: palette.surfaceLow }}>
            <Text style={kickerStyle(palette)}>Notes & saved items</Text>
            <Text style={{ color: palette.text, fontSize: 18, lineHeight: 24, fontWeight: "800" }}>{captureCommandPreview}</Text>
            <Text style={bodyStyle(palette)}>{sharedDraftSummary}</Text>
          </View>
        ) : activeSegment === "Sources" ? (
          <View style={{ ...cardBase(palette), backgroundColor: palette.surfaceLow }}>
            <Text style={kickerStyle(palette)}>Recent sources</Text>
            <Text style={{ color: palette.text, fontSize: 18, lineHeight: 24, fontWeight: "800" }}>{captureSourcePreview}</Text>
            <Text style={bodyStyle(palette)}>{voiceMemoPreview}</Text>
          </View>
        ) : showDetailPane ? (
          <View style={{ gap: 12 }}>
            <TouchableOpacity
              onPress={() => setShowArtifactDetail(false)}
              style={{ alignSelf: "flex-start", ...pillStyle(palette), flexDirection: "row", gap: 6, alignItems: "center" }}
            >
              <MaterialCommunityIcons name="arrow-left" size={15} color={palette.muted} />
              <Text style={{ color: palette.muted, fontSize: 12, fontWeight: "800" }}>Artifacts</Text>
            </TouchableOpacity>
            {mobileArtifactDetailView(
              palette,
              selectedArtifactDetail,
              expandedArtifactSections,
              toggleArtifactSection,
              runArtifactAction,
            )}
          </View>
        ) : detailRequested ? (
          <View style={{ gap: 12 }}>
            <TouchableOpacity
              onPress={() => setShowArtifactDetail(false)}
              style={{ alignSelf: "flex-start", ...pillStyle(palette), flexDirection: "row", gap: 6, alignItems: "center" }}
            >
              <MaterialCommunityIcons name="arrow-left" size={15} color={palette.muted} />
              <Text style={{ color: palette.muted, fontSize: 12, fontWeight: "800" }}>Artifacts</Text>
            </TouchableOpacity>
            <View style={{ ...cardBase(palette), backgroundColor: palette.surfaceLow }}>
              <Text style={kickerStyle(palette)}>Artifact detail</Text>
              <Text style={{ color: palette.text, fontSize: 18, lineHeight: 24, fontWeight: "800" }}>{artifactDetailStatus}</Text>
              <Text style={bodyStyle(palette)}>Loading the artifact detail contract from the API.</Text>
            </View>
          </View>
        ) : visibleRows.length > 0 ? (
          visibleRows.map((row) => mobileCaptureRow(
            palette,
            row,
            row.icon === "artifact" ? openLibraryArtifact : undefined,
          ))
        ) : (
          <View style={{ ...cardBase(palette), backgroundColor: palette.surfaceLow }}>
            <Text style={kickerStyle(palette)}>Queue clear</Text>
            <Text style={{ color: palette.text, fontSize: 18, lineHeight: 24, fontWeight: "800" }}>No captures need processing.</Text>
            <Text style={bodyStyle(palette)}>{sharedDraftSummary}</Text>
          </View>
        )}

        <View style={{ ...cardBase(palette), backgroundColor: palette.surfaceLow }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Text style={kickerStyle(palette)}>Capture controls</Text>
              <Text style={{ color: palette.text, fontSize: 18, fontWeight: "800" }}>Send the current item</Text>
              <Text style={bodyStyle(palette)}>{voiceMemoPreview}</Text>
            </View>
            {voiceClipReady ? (
              <TouchableOpacity
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: palette.accent,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPress={playVoiceClip}
              >
                <MaterialCommunityIcons name="play" size={18} color={palette.onAccent} />
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <TouchableOpacity style={styles.button} onPress={submitPrimaryCapture}>
              <Text style={styles.buttonText}>Save capture</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={flushPendingCaptures}>
              <Text style={styles.buttonText}>Flush queue</Text>
            </TouchableOpacity>
            {voiceClipReady ? (
              <TouchableOpacity style={styles.button} onPress={submitVoiceCapture}>
                <Text style={styles.buttonText}>Save voice</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      <TouchableOpacity style={{ alignItems: "center" }} onPress={toggleMissionTools}>
        <Text style={[kickerStyle(palette), { fontSize: 11 }]}>
          {showAdvancedCapture ? "Close advanced tools" : "Advanced tools"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export function MobileReviewSurface({
  styles,
  palette,
  reviewPrompt,
  reviewAnswer,
  reviewDueCount,
  reviewCardType,
  reviewMeta,
  reviewRetentionLabel,
  reviewReviewedCount,
  reviewStats,
  reviewStatus,
  reviewLearningInsights,
  reviewRecommendedDrill,
  reviewDecks,
  showAnswer,
  revealAnswer,
  loadDueCards,
  submitReview,
  hasReviewCard,
  openReviewWorkspace,
  suggestAssistantAsk,
  showAdvancedReview,
  toggleMissionTools,
}: MobileReviewSurfaceProps) {
  const model = deriveMobileReviewViewModel({
    prompt: reviewPrompt,
    answer: reviewAnswer,
    dueCount: reviewDueCount,
    cardType: reviewCardType,
    meta: reviewMeta,
    retentionLabel: reviewRetentionLabel,
    stats: reviewStats,
    decks: reviewDecks,
    showAnswer,
    hasReviewCard,
    status: reviewStatus,
    learningInsights: reviewLearningInsights,
    recommendedDrill: reviewRecommendedDrill,
  });
  const primaryDeck = reviewDecks
    .filter((deck) => deck.card_count > 0)
    .sort((left, right) => right.due_count - left.due_count)[0] ?? null;

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={kickerStyle(palette)}>Starlog Review</Text>
            <Text style={[headingStyle(palette), { fontSize: 28, lineHeight: 34 }]}>Train the next judgment</Text>
          </View>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: palette.surfaceHigh,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: palette.border,
            }}
          >
            <MaterialCommunityIcons name="brain" size={20} color={palette.accent} />
          </View>
        </View>
        <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 17 }}>
          {model.syncedLabel}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {model.statusChips.map((chip) => (
            <View key={chip.label} style={{ ...pillStyle(palette, chip.active), minHeight: 34, justifyContent: "center" }}>
              <Text style={{ color: chip.active ? palette.accent : palette.muted, fontSize: 11, fontWeight: "800" }}>
                {chip.label} {chip.value}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 12 }}>
        {model.ladder.map((stage, index) => {
          const tone = reviewStageTone(stage, palette);
          return (
            <View
              key={stage.label}
              style={{
                minWidth: 126,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: tone.border,
                backgroundColor: tone.background,
                paddingHorizontal: 14,
                paddingVertical: 12,
                gap: 8,
              }}
            >
              <Text style={{ color: tone.color, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 }}>
                Step {index + 1}
              </Text>
              <Text style={{ color: tone.color, fontSize: 15, fontWeight: "800" }}>{stage.label}</Text>
              <Text style={{ color: stage.active ? palette.onAccent : palette.muted, fontSize: 12 }}>{stage.countLabel}</Text>
            </View>
          );
        })}
      </ScrollView>

      {hasReviewCard ? (
        <View style={{ ...cardBase(palette), gap: 16, padding: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={kickerStyle(palette)}>{model.activeStage}</Text>
              <Text style={{ color: palette.text, fontSize: 20, lineHeight: 26, fontWeight: "800" }}>
                {reviewCardType}
              </Text>
            </View>
            <View style={{ ...pillStyle(palette, true), alignItems: "center" }}>
              <Text style={{ color: palette.accent, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>
                {model.cardProgressLabel}
              </Text>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Text style={{ color: palette.text, fontSize: 25, lineHeight: 34, fontWeight: "700" }}>{reviewPrompt}</Text>
            <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{model.dueStateLabel}</Text>
          </View>

          {model.answerChoices.length > 0 ? (
            <View style={{ gap: 8 }}>
              {model.answerChoices.map((choice) => (
                <View
                  key={choice.key}
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: palette.border,
                    backgroundColor: palette.surfaceHigh,
                    padding: 12,
                    flexDirection: "row",
                    gap: 10,
                    alignItems: "flex-start",
                  }}
                >
                  <Text style={{ color: palette.accent, fontSize: 13, fontWeight: "900" }}>{choice.key}</Text>
                  <Text style={{ flex: 1, color: palette.text, fontSize: 14, lineHeight: 20 }}>{choice.label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View
              style={{
                borderRadius: 16,
                backgroundColor: palette.surfaceHigh,
                borderWidth: 1,
                borderColor: palette.border,
                padding: 12,
              }}
            >
              <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 20 }}>
                Free-recall card. Hold the answer in mind before revealing it.
              </Text>
            </View>
          )}

          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <TouchableOpacity
              style={{ ...pillStyle(palette, true), minHeight: 44, justifyContent: "center" }}
              onPress={revealAnswer}
            >
              <Text style={{ color: palette.accent, fontSize: 12, fontWeight: "800" }}>{model.revealLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ ...pillStyle(palette), minHeight: 44, justifyContent: "center" }}
              onPress={openReviewWorkspace}
            >
              <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800" }}>Worked solution</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ ...pillStyle(palette), minHeight: 44, justifyContent: "center" }}
              onPress={loadDueCards}
            >
              <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800" }}>Refresh queue</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            {model.gradeOptions.map((option) => {
              const tone = reviewGradeTone(option, palette);
              return (
                <TouchableOpacity
                  key={option.label}
                  style={{
                    flex: 1,
                    minHeight: 78,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: tone.border,
                    backgroundColor: tone.background,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    opacity: option.enabled ? 1 : 0.5,
                  }}
                  disabled={!option.enabled}
                  onPress={() => submitReview(option.rating)}
                >
                  <Text style={{ color: tone.color, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6 }}>
                    {option.label}
                  </Text>
                  <Text style={{ color: palette.text, fontSize: 22, fontWeight: "800" }}>{option.intervalLabel}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={cardBase(palette)}>
          <Text style={kickerStyle(palette)}>Focused review</Text>
          <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Load due cards to begin the next pass.</Text>
          <Text style={bodyStyle(palette)}>This surface stays quiet until the shared review queue is requested.</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={loadDueCards}>
              <Text style={styles.buttonText}>Load due cards</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={openReviewWorkspace}>
              <Text style={styles.buttonText}>Open Review</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={{ gap: 10 }}>
        <View style={{ ...cardBase(palette), gap: 10, padding: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <Text style={kickerStyle(palette)}>Correct</Text>
            <View style={pillStyle(palette, showAnswer)}>
              <Text style={{ color: showAnswer ? palette.accent : palette.muted, fontSize: 10, fontWeight: "800" }}>
                {model.answerStateLabel}
              </Text>
            </View>
          </View>
          <Text style={{ color: palette.text, fontSize: 14, lineHeight: 21 }}>{model.correctExplanation}</Text>
      </View>

        <View style={{ ...cardBase(palette), gap: 10, padding: 14 }}>
          <Text style={kickerStyle(palette)}>Why this now?</Text>
          <Text style={{ color: palette.text, fontSize: 14, lineHeight: 21 }}>{model.whyThisNow}</Text>
          {primaryDeck ? (
            <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>
              Source: {primaryDeck.name}
            </Text>
          ) : null}
        </View>

        {model.learningSignal ? (
          <View style={{ ...cardBase(palette), gap: 10, padding: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={kickerStyle(palette)}>{model.learningSignal.eyebrow}</Text>
                <Text style={{ color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: "800" }}>
                  {model.learningSignal.title}
                </Text>
              </View>
              <View style={pillStyle(palette, model.learningSignal.tone === "drill")}>
                <Text style={{ color: palette.accent, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>
                  {model.learningSignal.tone === "drill" ? "Recommended" : "Signal"}
                </Text>
              </View>
            </View>
            <Text style={{ color: palette.text, fontSize: 13, lineHeight: 20 }}>{model.learningSignal.body}</Text>
            <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>{model.learningSignal.detail}</Text>
            {model.learningSignal.action?.kind === "assistant_prompt" ? (
              <TouchableOpacity
                style={{ ...pillStyle(palette), minHeight: 40, justifyContent: "center", alignSelf: "flex-start" }}
                onPress={() => suggestAssistantAsk(model.learningSignal?.action?.prompt ?? "")}
              >
                <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800" }}>
                  {model.learningSignal.action.label}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={{ ...cardBase(palette), gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={kickerStyle(palette)}>Knowledge health</Text>
            <Text style={{ color: palette.text, fontSize: 22, fontWeight: "800" }}>{model.health.value}</Text>
            <Text style={bodyStyle(palette)}>{model.health.detail}</Text>
          </View>
          <View style={{ ...pillStyle(palette, model.health.label === "Stable"), alignSelf: "flex-start" }}>
            <Text style={{ color: palette.accent, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>
              {model.health.label}
            </Text>
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={kickerStyle(palette)}>Queue ladder</Text>
          {model.queueLadder.map((stage) => (
            <View key={stage.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ width: 104, color: stage.active ? palette.accent : palette.muted, fontSize: 12, fontWeight: "800" }}>
                {stage.label}
              </Text>
              <View style={{ flex: 1, height: 6, borderRadius: 999, backgroundColor: palette.surfaceHighest, overflow: "hidden" }}>
                <View
                  style={{
                    width: `${Math.min(100, Math.max(8, Number(stage.value) * 18))}%`,
                    height: "100%",
                    backgroundColor: stage.active ? palette.accent : "rgba(255,255,255,0.18)",
                  }}
                />
              </View>
              <Text style={{ width: 20, textAlign: "right", color: palette.text, fontSize: 12, fontWeight: "800" }}>
                {stage.value}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <Text style={kickerStyle(palette)}>Session progress</Text>
            <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800" }}>
              {reviewReviewedCount > 0 ? model.session.label : "Session not started"}
            </Text>
          </View>
          <View style={{ height: 8, borderRadius: 999, backgroundColor: palette.surfaceHighest, overflow: "hidden" }}>
            <View style={{ width: `${model.session.progressRatio * 100}%`, height: "100%", backgroundColor: palette.accent }} />
          </View>
          <Text style={bodyStyle(palette)}>{model.session.detail}</Text>
        </View>
      </View>

      <TouchableOpacity style={{ alignItems: "center" }} onPress={toggleMissionTools}>
        <Text style={[kickerStyle(palette), { fontSize: 11 }]}>
          {showAdvancedReview ? "Close advanced tools" : "Advanced tools"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export function MobileLoginSurface({
  palette,
  apiBase,
  setApiBase,
  authPassphrase,
  setAuthPassphrase,
  revealPassphrase,
  setRevealPassphrase,
  authStatus,
  authBusy,
  login,
  bootstrap,
}: MobileLoginSurfaceProps) {
  return (
    <View style={{ flex: 1, justifyContent: "space-between", paddingTop: 32, paddingBottom: 24 }}>
      <View style={{ gap: 18, alignItems: "center" }}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.surfaceHigh,
            borderWidth: 1,
            borderColor: palette.border,
          }}
        >
          <Text style={{ color: palette.accent, fontSize: 36, fontWeight: "800" }}>✦</Text>
        </View>
        <View style={{ alignItems: "center", gap: 8 }}>
          <Text style={{ color: palette.accent, fontSize: 40, fontWeight: "800", letterSpacing: 6 }}>{productCopy.brand.name.toUpperCase()}</Text>
          <Text style={{ color: palette.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.3 }}>
            {productCopy.brand.tagline}
          </Text>
        </View>
      </View>

      <View style={{ ...cardBase(palette), gap: 16 }}>
        <View style={{ gap: 8 }}>
          <Text style={kickerStyle(palette)}>API endpoint</Text>
          <TextInput
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.surfaceHigh,
              color: palette.text,
              paddingHorizontal: 16,
              paddingVertical: 14,
            }}
            value={apiBase}
            onChangeText={setApiBase}
            autoCapitalize="none"
            placeholder="http://localhost:8000"
            placeholderTextColor={palette.muted}
          />
        </View>

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={kickerStyle(palette)}>Passphrase</Text>
            <Pressable onPress={() => setRevealPassphrase(!revealPassphrase)}>
              <Text style={{ color: palette.accent, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                {revealPassphrase ? "Hide" : "Reveal"}
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.surfaceHigh,
              color: palette.text,
              paddingHorizontal: 16,
              paddingVertical: 16,
              fontSize: 16,
            }}
            value={authPassphrase}
            onChangeText={setAuthPassphrase}
            secureTextEntry={!revealPassphrase}
            placeholder="use the same single-user passphrase you configured for Starlog"
            placeholderTextColor={palette.muted}
          />
        </View>

        <TouchableOpacity
          style={{
            borderRadius: 999,
            paddingVertical: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.accent,
            opacity: authBusy ? 0.72 : 1,
          }}
          disabled={authBusy}
          onPress={login}
        >
          <Text style={{ color: palette.onAccent, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.5 }}>
            {authBusy ? "Signing in..." : "Sign In"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={{ alignItems: "center", paddingVertical: 8 }} disabled={authBusy} onPress={bootstrap}>
          <Text style={{ color: palette.secondary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.3 }}>
            Set Up Starlog
          </Text>
        </TouchableOpacity>

        <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 20 }}>{authStatus}</Text>
      </View>

      <View style={{ alignItems: "center", gap: 12 }}>
        <Text style={{ color: palette.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2 }}>
          Secure Local Access
        </Text>
        <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
          Single-user passphrase login. Use setup once for a new Starlog instance, then sign in for later sessions.
        </Text>
      </View>
    </View>
  );
}

export function MobileCalendarSurface({
  styles,
  palette,
  plannerSummary,
  selectedPlannerDate,
  setSelectedPlannerDate,
  loadPlannerSummary,
  repairPlannerConflict,
  stationTimeLabel,
  stationPeriod,
  briefingHeroCopy,
  nextBriefingCountdown,
  offlineBriefingStatus,
  briefingPlaybackStatus,
  playBriefing,
  queueBriefingAudio,
  generateAndCache,
  canPlayOffline,
  nextActionPreview,
  openPwa,
  openReview,
  alarmScheduled,
  toggleAlarm,
  showAdvancedAlarms,
  toggleMissionTools,
}: MobileCalendarSurfaceProps) {
  const planner = deriveMobilePlannerViewModel({
    summary: plannerSummary,
    selectedDate: selectedPlannerDate,
    nextActionPreview,
    alarmScheduled,
    nextBriefingCountdown,
  });

  return (
    <View style={{ gap: 18 }}>
      <View
        style={{
          ...cardBase(palette),
          backgroundColor: "rgba(26, 17, 23, 0.72)",
          paddingVertical: 18,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <View style={{ flex: 1, gap: 7 }}>
            <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.6, textTransform: "uppercase" }}>
              Starlog {PRODUCT_SURFACES.planner.label}
            </Text>
            <Text style={{ color: palette.text, fontSize: 28, lineHeight: 32, fontWeight: "800" }}>
              {planner.dateLabel}
            </Text>
            <Text style={[bodyStyle(palette), { lineHeight: 20 }]}>{planner.decisionLabel}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 8 }}>
            <View style={{ ...pillStyle(palette, true), flexDirection: "row", alignItems: "center", gap: 6 }}>
              <MaterialCommunityIcons name="cloud-check-outline" size={14} color={palette.accent} />
              <Text style={{ color: palette.accent, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                {planner.statusLabel}
              </Text>
            </View>
            <TouchableOpacity style={pillStyle(palette)} onPress={loadPlannerSummary}>
              <MaterialCommunityIcons name="refresh" size={17} color={palette.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TouchableOpacity
            accessibilityLabel="Previous planner day"
            style={pillStyle(palette)}
            onPress={() => setSelectedPlannerDate(planner.dateControls.previousDate)}
          >
            <MaterialCommunityIcons name="chevron-left" size={16} color={palette.text} />
          </TouchableOpacity>
          <View
            style={{
              ...pillStyle(palette, planner.dateControls.isToday),
              opacity: planner.dateControls.isToday ? 0.7 : 1,
            }}
          >
            <Text style={{ color: planner.dateControls.isToday ? palette.accent : palette.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>
              {planner.dateControls.isToday ? "Today" : "Selected"}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityLabel="Next planner day"
            style={pillStyle(palette)}
            onPress={() => setSelectedPlannerDate(planner.dateControls.nextDate)}
          >
            <MaterialCommunityIcons name="chevron-right" size={16} color={palette.text} />
          </TouchableOpacity>
          {!planner.dateControls.isToday ? (
            <TouchableOpacity style={pillStyle(palette)} onPress={() => setSelectedPlannerDate(planner.dateControls.todayDate)}>
              <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Today</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <View style={{ ...pillStyle(palette), flexDirection: "row", alignItems: "center", gap: 6 }}>
            <MaterialCommunityIcons name="clock-outline" size={14} color={palette.accent} />
            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800" }}>
              {stationTimeLabel} {stationPeriod}
            </Text>
          </View>
          <View style={{ ...pillStyle(palette), flexDirection: "row", alignItems: "center", gap: 6 }}>
            <MaterialCommunityIcons name={alarmScheduled ? "bell-ring-outline" : "bell-outline"} size={14} color={palette.accent} />
            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800" }}>
              {alarmScheduled ? nextBriefingCountdown : "No alarm"}
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {planner.dayStrip.map((day) => (
            <TouchableOpacity
              key={day.key}
              onPress={() => setSelectedPlannerDate(day.key)}
              style={{
                width: 48,
                borderRadius: 16,
                paddingVertical: 10,
                alignItems: "center",
                gap: 4,
                backgroundColor: day.active ? palette.accent : palette.surfaceHigh,
                borderWidth: 1,
                borderColor: day.active ? "transparent" : palette.border,
              }}
            >
              <Text style={{ color: day.active ? palette.onAccent : palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>
                {day.weekday}
              </Text>
              <Text style={{ color: day.active ? palette.onAccent : palette.text, fontSize: 15, fontWeight: "800" }}>{day.day}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {planner.metrics.map((metric) => {
            const tone = plannerMetricTone(metric.tone, palette);
            return (
              <View
                key={metric.label}
                style={{
                  minWidth: 74,
                  flexGrow: 1,
                  borderRadius: 16,
                  paddingHorizontal: 11,
                  paddingVertical: 10,
                  backgroundColor: tone.background,
                  borderWidth: 1,
                  borderColor: tone.border,
                  gap: 3,
                }}
              >
                <Text style={{ color: tone.color, fontSize: 18, fontWeight: "800" }}>{metric.value}</Text>
                <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 }}>
                  {metric.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {planner.conflict ? (
        <View style={{ ...cardBase(palette), borderColor: "rgba(243, 207, 122, 0.22)", backgroundColor: "rgba(243, 207, 122, 0.08)" }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <MaterialCommunityIcons name="alert-circle-outline" size={22} color="#f3cf7a" />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ color: palette.text, fontSize: 18, lineHeight: 23, fontWeight: "800" }}>{planner.conflict.title}</Text>
              <Text style={bodyStyle(palette)}>{planner.conflict.body}</Text>
              <TouchableOpacity style={{ ...pillStyle(palette), alignSelf: "flex-start" }} onPress={repairPlannerConflict}>
                <Text style={{ color: "#f3cf7a", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                  {planner.conflict.severityLabel}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View>
            <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Day timeline</Text>
            <Text style={{ color: palette.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.9 }}>
              Execution order
            </Text>
          </View>
          <View style={pillStyle(palette)}>
            <Text style={{ color: palette.text, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>Today</Text>
          </View>
        </View>
        <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ maxHeight: 390 }}>
          <View style={{ gap: 10, paddingBottom: 2 }}>
            {planner.timelineBlocks.map((block, index) => {
              const tone = plannerTimelineTone(block, palette);
              return (
                <View key={block.id} style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ width: 48, alignItems: "flex-end", paddingTop: 13 }}>
                    <Text style={{ color: tone.accent, fontSize: 11, fontWeight: "800", fontFamily: "monospace" }}>{block.time}</Text>
                  </View>
                  <View style={{ alignItems: "center" }}>
                    <View style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: tone.accent, marginTop: 16 }} />
                    {index < planner.timelineBlocks.length - 1 ? <View style={{ width: 1, flex: 1, minHeight: 66, backgroundColor: palette.border, marginTop: 5 }} /> : null}
                  </View>
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 18,
                      backgroundColor: tone.background,
                      borderWidth: 1,
                      borderColor: tone.border,
                      padding: 13,
                      gap: 6,
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                      <Text style={{ flex: 1, color: palette.text, fontSize: 15, lineHeight: 20, fontWeight: "800" }}>{block.title}</Text>
                      <Text style={{ color: tone.accent, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>{block.duration}</Text>
                    </View>
                    <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{block.detail}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <View style={{ ...cardBase(palette), flex: 1, minWidth: 150, padding: 14, gap: 7 }}>
          <Text style={kickerStyle(palette)}>Next focus</Text>
          <Text style={{ color: palette.text, fontSize: 17, lineHeight: 22, fontWeight: "800" }}>{planner.nextFocus.title}</Text>
          <Text style={bodyStyle(palette)}>{planner.nextFocus.body}</Text>
          <Text style={{ color: palette.accent, fontSize: 11, fontWeight: "800", fontFamily: "monospace" }}>{planner.nextFocus.timeLabel}</Text>
        </View>
        <View style={{ ...cardBase(palette), flex: 1, minWidth: 150, padding: 14, gap: 7 }}>
          <Text style={kickerStyle(palette)}>Upcoming</Text>
          <Text style={{ color: palette.text, fontSize: 17, lineHeight: 22, fontWeight: "800" }}>{planner.upcoming.title}</Text>
          <Text style={bodyStyle(palette)}>{planner.upcoming.body}</Text>
          <Text style={{ color: palette.accent, fontSize: 11, fontWeight: "800", fontFamily: "monospace" }}>{planner.upcoming.timeLabel}</Text>
        </View>
      </View>

      <View style={cardBase(palette)}>
        <Text style={kickerStyle(palette)}>Today's plan</Text>
        {planner.planGroups.map((group) => (
          <View key={group.title} style={{ gap: 7 }}>
            <Text style={{ color: palette.text, fontSize: 15, fontWeight: "800" }}>{group.title}</Text>
            {group.items.map((item) => (
              <View key={`${group.title}-${item}`} style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
                <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: palette.accent, marginTop: 7 }} />
                <Text style={{ flex: 1, color: palette.muted, fontSize: 13, lineHeight: 19 }}>{item}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>

      <View style={cardBase(palette)}>
        <Text style={kickerStyle(palette)}>Planner composer</Text>
        <View
          style={{
            borderRadius: 18,
            backgroundColor: palette.surfaceHigh,
            borderWidth: 1,
            borderColor: palette.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 20 }}>
            Ask Assistant to choose the next move, repair conflicts, or reserve focus time.
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {planner.promptChips.map((chip) => (
            <View key={chip} style={pillStyle(palette)}>
              <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800" }}>{chip}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={cardBase(palette)}>
        <Text style={kickerStyle(palette)}>Playback</Text>
        <Text style={{ color: palette.text, fontSize: 20, fontWeight: "800" }}>Daily briefing</Text>
        <Text style={bodyStyle(palette)}>{offlineBriefingStatus}</Text>
        <Text style={bodyStyle(palette)}>{briefingPlaybackStatus}</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 20 }}>
          {[4, 10, 6, 14, 5, 11, 13, 4, 8, 12].map((height, index) => (
            <View key={index} style={{ flex: 1, height, borderRadius: 999, backgroundColor: "rgba(241, 182, 205, 0.72)" }} />
          ))}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}>
          <TouchableOpacity style={{ ...pillStyle(palette), opacity: canPlayOffline ? 1 : 0.5 }} onPress={playBriefing}>
            <MaterialCommunityIcons name="play" size={18} color={palette.accent} />
          </TouchableOpacity>
          <TouchableOpacity style={pillStyle(palette)} onPress={queueBriefingAudio}>
            <MaterialCommunityIcons name="text-to-speech" size={18} color={palette.accent} />
          </TouchableOpacity>
          <TouchableOpacity style={pillStyle(palette)} onPress={generateAndCache}>
            <MaterialCommunityIcons name="download-outline" size={18} color={palette.accent} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={cardBase(palette)}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Daily briefing</Text>
            <Text style={bodyStyle(palette)}>{briefingHeroCopy}</Text>
          </View>
          <MaterialCommunityIcons name="star-four-points-outline" size={20} color={palette.accent} />
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={pillStyle(palette)}>
            <Text style={{ color: palette.text, fontSize: 10, fontWeight: "700" }}>Hydration</Text>
          </View>
          <View style={pillStyle(palette)}>
            <Text style={{ color: palette.text, fontSize: 10, fontWeight: "700" }}>Silence</Text>
          </View>
        </View>
      </View>

      <View style={cardBase(palette)}>
        <Text style={kickerStyle(palette)}>Alarm schedule</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={{ color: palette.text, fontSize: 34, lineHeight: 40, fontWeight: "700" }}>{stationTimeLabel}</Text>
            <Text style={bodyStyle(palette)}>{alarmScheduled ? `${nextBriefingCountdown} until play` : "Alarm is not scheduled yet"}</Text>
          </View>
          <TouchableOpacity
            style={{
              width: 54,
              height: 32,
              borderRadius: 999,
              backgroundColor: palette.surfaceHighest,
              paddingHorizontal: 3,
              justifyContent: "center",
            }}
            onPress={toggleAlarm}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: alarmScheduled ? palette.accent : palette.muted,
                alignSelf: alarmScheduled ? "flex-end" : "flex-start",
              }}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={openPwa}>
            <Text style={styles.buttonText}>Open desktop web</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={openReview}>
            <Text style={styles.buttonText}>Open Review</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={{ alignItems: "center" }} onPress={toggleMissionTools}>
        <Text style={[kickerStyle(palette), { fontSize: 11 }]}>
          {showAdvancedAlarms ? "Close advanced tools" : "Advanced tools"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
