import { useState } from "react";
import type { AssistantCard as ConversationCard, AssistantCardAction } from "@starlog/contracts";
import { PRODUCT_SURFACES, productCopy } from "@starlog/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

import { mobileConversationCardLabel } from "./conversation-cards";

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
  pendingCaptures: number;
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
  reviewStatus: string;
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
  return messages.slice(-8);
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

function conversationCardTone(kind: string, palette: Record<string, string>) {
  if (kind === "review_queue") {
    return {
      cardBorder: "rgba(166, 222, 191, 0.18)",
      cardBackground: "rgba(42, 33, 39, 0.96)",
      accentBackground: "rgba(166, 222, 191, 0.14)",
      accentBorder: "rgba(166, 222, 191, 0.24)",
      accentText: "#cfeeda",
      bodyBackground: "rgba(255,255,255,0.03)",
    };
  }
  if (kind === "task_list") {
    return {
      cardBorder: "rgba(243, 207, 122, 0.18)",
      cardBackground: "rgba(42, 33, 39, 0.96)",
      accentBackground: "rgba(243, 207, 122, 0.14)",
      accentBorder: "rgba(243, 207, 122, 0.24)",
      accentText: "#f4ddb0",
      bodyBackground: "rgba(255,255,255,0.03)",
    };
  }
  if (kind === "knowledge_note") {
    return {
      cardBorder: "rgba(151, 188, 255, 0.18)",
      cardBackground: "rgba(42, 33, 39, 0.96)",
      accentBackground: "rgba(151, 188, 255, 0.14)",
      accentBorder: "rgba(151, 188, 255, 0.22)",
      accentText: "#d7e6ff",
      bodyBackground: "rgba(255,255,255,0.03)",
    };
  }
  if (kind === "briefing") {
    return {
      cardBorder: "rgba(241, 182, 205, 0.2)",
      cardBackground: "rgba(47, 32, 41, 0.98)",
      accentBackground: "rgba(241, 182, 205, 0.14)",
      accentBorder: "rgba(241, 182, 205, 0.24)",
      accentText: palette.accent,
      bodyBackground: "rgba(255,255,255,0.03)",
    };
  }
  if (kind === "capture_item") {
    return {
      cardBorder: "rgba(241, 182, 205, 0.2)",
      cardBackground: "rgba(47, 32, 41, 0.98)",
      accentBackground: "rgba(241, 182, 205, 0.14)",
      accentBorder: "rgba(241, 182, 205, 0.24)",
      accentText: palette.accent,
      bodyBackground: "rgba(255,255,255,0.03)",
    };
  }
  return {
    cardBorder: "rgba(241, 182, 205, 0.16)",
    cardBackground: "rgba(45, 31, 40, 0.96)",
    accentBackground: "rgba(241, 182, 205, 0.12)",
    accentBorder: "rgba(241, 182, 205, 0.18)",
    accentText: palette.accent,
    bodyBackground: "rgba(255,255,255,0.03)",
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
            backgroundColor: "rgba(255,255,255,0.035)",
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
            backgroundColor: "rgba(255,255,255,0.03)",
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
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, gap: 8 }}>
          {card.body ? <Text style={[bodyStyle(palette), { fontSize: 14, lineHeight: 21 }]}>{card.body}</Text> : null}
        </View>
        <View
          style={{
            width: 84,
            minHeight: 82,
            borderRadius: 16,
            backgroundColor: "#14111b",
            borderWidth: 1,
            borderColor: tone.accentBorder,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              position: "absolute",
              left: 10,
              top: 12,
              width: 54,
              height: 54,
              borderRadius: 999,
              backgroundColor: "rgba(124, 189, 255, 0.22)",
            }}
          />
          <View
            style={{
              position: "absolute",
              right: 6,
              bottom: 6,
              width: 42,
              height: 42,
              borderRadius: 999,
              backgroundColor: "rgba(241, 182, 205, 0.18)",
            }}
          />
        </View>
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
      backgroundColor: "rgba(96, 57, 75, 0.88)",
      borderColor: "rgba(241, 182, 205, 0.16)",
      color: palette.accent,
    };
  }
  return {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.06)",
    color: palette.text,
  };
}

function artifactCard(
  palette: Record<string, string>,
  title: string,
  detail: string,
  metaA: string,
  metaB: string,
) {
  return (
    <View key={`${title}-${metaA}`} style={cardBase(palette)}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <Text style={{ flex: 1, color: palette.text, fontSize: 20, lineHeight: 26, fontWeight: "800" }}>{title}</Text>
        <MaterialCommunityIcons name="dots-vertical" size={18} color={palette.muted} />
      </View>
      <Text style={bodyStyle(palette)}>{detail}</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <View style={pillStyle(palette)}>
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700" }}>{metaA}</Text>
        </View>
        <View style={pillStyle(palette)}>
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700" }}>{metaB}</Text>
        </View>
      </View>
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

  return (
    <View style={{ gap: 18 }}>
      <View style={{ minHeight: 460, gap: 16, justifyContent: recentMessages.length === 0 ? "center" : "flex-end" }}>
        {recentMessages.length === 0 ? (
          <View style={{ alignItems: "center", gap: 14, paddingHorizontal: 16 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 24,
                backgroundColor: "rgba(241, 182, 205, 0.14)",
                borderWidth: 1,
                borderColor: "rgba(241, 182, 205, 0.24)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MaterialCommunityIcons name="star-four-points-outline" size={28} color={palette.accent} />
            </View>
            <Text style={[headingStyle(palette), { fontSize: 25, lineHeight: 31, textAlign: "center" }]}>{productCopy.assistant.emptyTitle}</Text>
            <Text style={[bodyStyle(palette), { textAlign: "center", maxWidth: 300 }]}>{productCopy.assistant.emptyBody}</Text>
          </View>
        ) : (
          recentMessages.map((message, messageIndex) => {
            const isUser = message.role === "user";
            const primaryCards = isUser ? [] : message.cards.filter((card) => !isDiagnosticConversationCard(card));
            const diagnosticCards = isUser ? [] : message.cards.filter(isDiagnosticConversationCard);
            return (
              <View
                key={message.id}
                style={{
                  width: "100%",
                  alignSelf: isUser ? "flex-end" : "stretch",
                  alignItems: isUser ? "flex-end" : "flex-start",
                  marginLeft: isUser ? 52 : 0,
                  marginRight: isUser ? 0 : 12,
                  gap: 8,
                }}
              >
                {!isUser ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 9, marginLeft: 2, marginBottom: 1 }}>
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 9,
                        backgroundColor: "rgba(241, 182, 205, 0.12)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <MaterialCommunityIcons name="star-four-points-outline" size={14} color={palette.accent} />
                    </View>
                    <Text style={[kickerStyle(palette), { color: palette.secondary }]}>{PRODUCT_SURFACES.assistant.label}</Text>
                  </View>
                ) : null}
                <View
                  style={{
                    maxWidth: isUser ? "84%" : "90%",
                    borderRadius: 24,
                    borderBottomRightRadius: isUser ? 10 : 24,
                    borderBottomLeftRadius: isUser ? 24 : 10,
                    backgroundColor: isUser ? "rgba(61, 41, 49, 0.92)" : "transparent",
                    borderWidth: isUser ? 1 : 0,
                    borderColor: isUser ? "rgba(241, 182, 205, 0.08)" : "transparent",
                    paddingHorizontal: isUser ? 16 : 0,
                    paddingVertical: isUser ? 14 : 0,
                  }}
                >
                  <Text
                    style={{
                      color: palette.text,
                      fontSize: isUser ? 16 : 17,
                      lineHeight: isUser ? 24 : 29,
                      paddingHorizontal: isUser ? 0 : 4,
                      paddingVertical: isUser ? 0 : 2,
                    }}
                  >
                    {message.content || (pendingConversationTurn && messageIndex === recentMessages.length - 1 ? "Assistant reply in progress..." : "No content")}
                  </Text>
                </View>
                {primaryCards.length > 0 ? (
                  <View style={{ width: "92%", gap: 10, paddingLeft: 18, position: "relative" }}>
                    <View
                      style={{
                        position: "absolute",
                        left: 8,
                        top: 2,
                        bottom: 10,
                        width: 1,
                        backgroundColor: "rgba(241, 182, 205, 0.12)",
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
                            marginLeft: 14,
                            borderRadius: 22,
                            borderWidth: 1,
                            borderColor: tone.cardBorder,
                            backgroundColor: tone.cardBackground,
                            shadowColor: "#000",
                            shadowOpacity: 0.22,
                            shadowRadius: 18,
                            shadowOffset: { width: 0, height: 10 },
                            overflow: "hidden",
                          }}
                        >
                          <View
                            style={{
                              position: "absolute",
                              left: -11,
                              top: 28,
                              width: 11,
                              height: 1,
                              backgroundColor: "rgba(241, 182, 205, 0.12)",
                            }}
                          />
                          <View
                            style={{
                              position: "absolute",
                              top: -28,
                              right: -10,
                              width: 116,
                              height: 116,
                              borderRadius: 999,
                              backgroundColor: tone.accentBackground,
                            }}
                          />
                          <View style={{ paddingHorizontal: 14, paddingVertical: 14, gap: 12 }}>
                            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                              <View
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderRadius: 14,
                                  backgroundColor: tone.accentBackground,
                                  borderWidth: 1,
                                  borderColor: tone.accentBorder,
                                  alignItems: "center",
                                  justifyContent: "center",
                                  marginTop: 2,
                                }}
                              >
                                <MaterialCommunityIcons name={conversationCardIcon(card.kind)} size={19} color={tone.accentText} />
                              </View>
                              <View style={{ flex: 1, gap: 4 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  <Text
                                    style={[
                                      kickerStyle(palette),
                                      { color: tone.accentText, letterSpacing: 1.15, fontSize: 9.5 },
                                    ]}
                                  >
                                    {mobileConversationCardLabel(card.kind, card.title)}
                                  </Text>
                                </View>
                                <Text style={{ color: palette.text, fontSize: 18, lineHeight: 22, fontWeight: "800" }} numberOfLines={2}>
                                  {cardAttachmentLabel(card.kind, card.title)}
                                </Text>
                              </View>
                              {hasNavigateAction ? (
                                <View
                                  style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: 999,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: "rgba(255,255,255,0.04)",
                                  }}
                                >
                                  <MaterialCommunityIcons name="arrow-top-right" size={14} color={palette.muted} />
                                </View>
                              ) : null}
                            </View>
                            <View
                              style={{
                                borderRadius: 16,
                                backgroundColor: tone.bodyBackground,
                                borderWidth: 1,
                                borderColor: "rgba(255,255,255,0.04)",
                                paddingHorizontal: 12,
                                paddingVertical: 11,
                                gap: 10,
                              }}
                            >
                              {renderConversationCardPreview(card, palette, tone, revealActive)}
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              {meta ? (
                                <Text
                                  style={{
                                    color: palette.muted,
                                    fontSize: 10.5,
                                    lineHeight: 16,
                                    fontWeight: "700",
                                    textTransform: "uppercase",
                                    letterSpacing: 0.7,
                                  }}
                                >
                                  {meta}
                                </Text>
                              ) : (
                                <View />
                              )}
                              {hasNavigateAction ? (
                                <Text
                                  style={{
                                    color: tone.accentText,
                                    fontSize: 10.5,
                                    lineHeight: 16,
                                    fontWeight: "800",
                                    textTransform: "uppercase",
                                    letterSpacing: 0.8,
                                  }}
                                >
                                  Tap card to open
                                </Text>
                              ) : null}
                            </View>
                            <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
                              {card.kind === "review_queue" && reviewAnswer ? (
                                <TouchableOpacity
                                  style={{
                                    ...pillStyle(palette, true),
                                    paddingHorizontal: 12,
                                    paddingVertical: 7,
                                    backgroundColor: "rgba(241, 182, 205, 0.10)",
                                    borderWidth: 1,
                                    borderColor: "rgba(241, 182, 205, 0.12)",
                                  }}
                                  onPress={() =>
                                    setRevealedReviewCards((previous) => ({
                                      ...previous,
                                      [cardKey]: !previous[cardKey],
                                    }))
                                  }
                                >
                                  <Text style={{ color: palette.accent, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>
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
                                      paddingHorizontal: 12,
                                      paddingVertical: 8,
                                      borderWidth: 1,
                                      borderColor: actionTone.borderColor,
                                      backgroundColor: actionTone.backgroundColor,
                                    }}
                                    onPress={() => onCardAction(action, card)}
                                  >
                                    <Text
                                      style={{
                                        color: actionTone.color,
                                        fontSize: 9.5,
                                        fontWeight: "800",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.75,
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
                                    paddingHorizontal: 12,
                                    paddingVertical: 7,
                                    borderWidth: 1,
                                    borderColor: "rgba(255,255,255,0.05)",
                                    backgroundColor: "rgba(255,255,255,0.04)",
                                  }}
                                  onPress={() => reuseCardText(reusableText)}
                                >
                                  <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>
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
                        backgroundColor: "rgba(255,255,255,0.03)",
                        paddingHorizontal: 13,
                        paddingVertical: 8,
                        alignSelf: "flex-start",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.05)",
                      }}
                    >
                      <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.1 }}>
                        Diagnostics {showDiagnosticCards ? "shown" : "collapsed"} · {diagnosticCards.length} hidden
                      </Text>
                    </Pressable>
                    {showDiagnosticCards ? (
                      <View style={{ gap: 6, paddingTop: 8 }}>
                        {diagnosticCards.map((card, cardIndex) => (
                          <Text key={`${message.id}-diagnostic-${cardIndex}-${card.kind}`} style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>
                            {mobileConversationCardLabel(card.kind, card.title)} · {card.title || formatCardMeta(card)}
                          </Text>
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
          borderRadius: 30,
          backgroundColor: "rgba(48, 31, 39, 0.9)",
          borderWidth: 1,
          borderColor: "rgba(241, 182, 205, 0.16)",
          paddingHorizontal: 14,
          paddingVertical: 12,
          shadowColor: "#000",
          shadowOpacity: 0.22,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 12 },
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
          <TouchableOpacity
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: voiceButtonAccent,
              borderWidth: 1,
              borderColor:
                voiceActionState === "recording"
                  ? "rgba(255, 180, 183, 0.18)"
                  : voiceActionState === "listening"
                    ? "rgba(166, 222, 191, 0.18)"
                    : "rgba(255,255,255,0.06)",
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
          <TextInput
            style={{
              flex: 1,
              minHeight: 42,
              maxHeight: 118,
              color: palette.text,
              fontSize: 16,
              lineHeight: 22,
              fontWeight: "500",
              paddingVertical: 9,
              paddingHorizontal: 4,
            }}
            value={homeDraft}
            onChangeText={setHomeDraft}
            placeholder={productCopy.assistant.inputPlaceholder}
            placeholderTextColor={palette.muted}
            multiline
          />
          <TouchableOpacity
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
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
        {voiceActionState !== "idle" ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 4, paddingTop: 8 }}>
            <Text style={[bodyStyle(palette), { flex: 1, fontSize: 12, lineHeight: 18 }]}>
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
                  paddingVertical: 6,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.06)",
                  backgroundColor: "rgba(255,255,255,0.03)",
                }}
                onPress={onCancelVoiceAction}
              >
                <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                  Clear
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {hiddenConversationMessageCount > 0 ? (
          <Text style={[bodyStyle(palette), { fontSize: 12, lineHeight: 18, paddingHorizontal: 4, paddingTop: 8 }]}>
            {hiddenConversationMessageCount} earlier messages remain in the shared assistant transcript.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function MobileNotesSurface({
  styles,
  palette,
  pendingCaptures,
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
  return (
    <View style={{ gap: 24 }}>
      <View style={{ ...cardBase(palette), overflow: "hidden", backgroundColor: palette.surfaceLow }}>
        <View
          style={{
            position: "absolute",
            top: -40,
            right: -20,
            width: 140,
            height: 140,
            borderRadius: 999,
            backgroundColor: "rgba(241, 182, 205, 0.1)",
          }}
        />
        <Text style={kickerStyle(palette)}>Quick Capture</Text>
        <TextInput
          style={{
            borderRadius: 18,
            minHeight: 120,
            backgroundColor: "#180911",
            color: palette.text,
            padding: 16,
            fontSize: 18,
            lineHeight: 28,
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
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity style={{ ...pillStyle(palette), width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
              <MaterialCommunityIcons name="text-box-outline" size={18} color={palette.muted} />
            </TouchableOpacity>
            <TouchableOpacity style={{ ...pillStyle(palette), width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
              <MaterialCommunityIcons name="paperclip" size={18} color={palette.muted} />
            </TouchableOpacity>
          </View>
          <Pressable
            style={{
              borderRadius: 999,
              backgroundColor: palette.accent,
              paddingHorizontal: 22,
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

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Library Snapshot</Text>
          <Text style={{ color: palette.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2 }}>
            {pendingCaptures} pending
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
          {[selectedArtifactTitle || "Lunar Surface Crystallization Patterns", captureCommandPreview, routeNarrative].map((item, index) => (
            <View
              key={`${item}-${index}`}
              style={{
                width: 248,
                borderRadius: 22,
                backgroundColor: palette.surfaceLow,
                borderWidth: 1,
                borderColor: palette.border,
                padding: 18,
                gap: 10,
              }}
            >
              <Text style={[kickerStyle(palette), { color: palette.muted }]}>
                {index === 0 ? "Selected item" : index === 1 ? "Queue" : "Routing"}
              </Text>
              <Text style={{ color: palette.text, fontSize: 20, lineHeight: 26, fontWeight: "800" }}>{item}</Text>
              <Text style={bodyStyle(palette)}>
                {index === 0 ? captureSourcePreview : index === 1 ? captureQueuePreview : sharedDraftSummary}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Recent Library Items</Text>
          <Text style={{ color: palette.secondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 }}>
            Sync
          </Text>
        </View>
        {artifactCard(palette, captureCommandPreview, captureQueuePreview, "DATA-STREAM", "4H AGO")}
        {artifactCard(palette, selectedArtifactTitle, captureSourcePreview, "AUDIO-LOG", "YESTERDAY")}
        <View style={{ ...cardBase(palette), backgroundColor: palette.surfaceLow }}>
          <View style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={kickerStyle(palette)}>Voice capture</Text>
              <Text style={{ color: palette.text, fontSize: 18, fontWeight: "800" }}>Latest capture</Text>
              <Text style={bodyStyle(palette)}>{voiceMemoPreview}</Text>
              <Text style={bodyStyle(palette)}>{sharedDraftSummary}</Text>
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
  reviewStatus,
  reviewDecks,
  showAnswer,
  revealAnswer,
  loadDueCards,
  submitReview,
  hasReviewCard,
  openReviewWorkspace,
  showAdvancedReview,
  toggleMissionTools,
}: MobileReviewSurfaceProps) {
  const deckCards = reviewDecks.length > 0
    ? reviewDecks
      .filter((deck) => deck.card_count > 0)
      .sort((left, right) => right.due_count - left.due_count)
      .slice(0, 4)
    : [];

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Review Overview</Text>
          <Text style={{ color: palette.accent, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 }}>
            {reviewReviewedCount > 0 ? `${reviewReviewedCount} reviewed` : "Last updated now"}
          </Text>
        </View>
        <View style={{ ...cardBase(palette), gap: 18 }}>
          <View style={{ flexDirection: "row", gap: 18 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.1 }}>Cards due</Text>
              <Text style={{ color: palette.accent, fontSize: 38, fontWeight: "800" }}>{reviewDueCount}</Text>
              <Text style={bodyStyle(palette)}>Current queue pressure</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.1 }}>Retention</Text>
              <Text style={{ color: palette.accent, fontSize: 38, fontWeight: "800" }}>{reviewRetentionLabel}</Text>
              <Text style={bodyStyle(palette)}>{reviewReviewedCount > 0 ? "Current session" : "No pass started"}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 64 }}>
            {[40, 56, 52, 76, 84, 74, 90].map((height, index) => (
              <View
                key={index}
                style={{
                  flex: 1,
                  height,
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                  backgroundColor: index >= 4 ? palette.accent : "rgba(73, 71, 63, 0.44)",
                }}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Active Decks</Text>
          <TouchableOpacity style={pillStyle(palette)} onPress={openReviewWorkspace}>
            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Open Review</Text>
          </TouchableOpacity>
        </View>
        {(deckCards.length > 0 ? deckCards : [
          {
            id: "review-workspace",
            name: "Review queue",
            description: "Open the full review workspace when you need deck analytics or editing.",
            due_count: reviewDueCount,
            card_count: Math.max(reviewDueCount, 1),
          },
        ]).map((deck) => (
          <TouchableOpacity
            key={deck.id}
            style={{
              ...cardBase(palette),
              backgroundColor: palette.surfaceLow,
            }}
            onPress={openReviewWorkspace}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.text, fontSize: 18, fontWeight: "800" }}>{deck.name}</Text>
                <Text style={bodyStyle(palette)} numberOfLines={2}>
                  {deck.description?.trim() || "Deck ready for focused review."}
                </Text>
              </View>
              <View style={{ ...pillStyle(palette, deck.due_count > 0) }}>
                <Text style={{ color: deck.due_count > 0 ? palette.accent : palette.text, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>
                  {deck.due_count > 0 ? `${deck.due_count} Due` : "Stable"}
                </Text>
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: palette.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1.1 }}>Progress</Text>
                <Text style={{ color: palette.text, fontSize: 10, fontWeight: "700" }}>
                  {deck.card_count > 0 ? `${Math.round(((deck.card_count - deck.due_count) / deck.card_count) * 100)}%` : "0%"}
                </Text>
              </View>
              <View style={{ height: 4, borderRadius: 999, backgroundColor: palette.surfaceHighest, overflow: "hidden" }}>
                <View
                  style={{
                    width: `${deck.card_count > 0 ? Math.max(0, Math.min(100, ((deck.card_count - deck.due_count) / deck.card_count) * 100)) : 0}%`,
                    height: "100%",
                    backgroundColor: deck.due_count > 0 ? palette.accent : palette.secondary,
                  }}
                />
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Focused Review</Text>
          <View style={pillStyle(palette, showAnswer)}>
            <Text style={{ color: showAnswer ? palette.accent : palette.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase" }}>
              {showAnswer ? "Answer open" : "Answer sealed"}
            </Text>
          </View>
        </View>

        {hasReviewCard ? (
          <View style={{ ...cardBase(palette), gap: 14 }}>
            <Text style={{ color: palette.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.3 }}>{reviewCardType}</Text>
            <Text style={{ color: palette.text, fontSize: 28, lineHeight: 38, textAlign: "center" }}>{reviewPrompt}</Text>
            <Text style={{ color: palette.muted, fontSize: 14, lineHeight: 22, textAlign: "center" }}>{reviewMeta}</Text>
            <Text style={{ color: palette.muted, fontSize: 15, lineHeight: 24, textAlign: "center" }}>
              {showAnswer ? reviewAnswer : "Keep the answer sealed until you commit to retrieval."}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={{ ...pillStyle(palette, true), flex: 1, alignItems: "center" }} onPress={revealAnswer}>
                <Text style={{ color: palette.accent, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>
                  {showAnswer ? "Hide answer" : "Reveal answer"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ ...pillStyle(palette), flex: 1, alignItems: "center" }} onPress={loadDueCards}>
                <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Refresh queue</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                { label: "Again", eta: "1m", rating: 1, tone: "rgba(255, 180, 171, 0.08)" },
                { label: "Hard", eta: "1d", rating: 3, tone: palette.surfaceHigh },
                { label: "Good", eta: "3d", rating: 4, tone: "rgba(241, 182, 205, 0.12)" },
                { label: "Easy", eta: "5d", rating: 5, tone: palette.surfaceHigh },
              ].map((option) => (
                <TouchableOpacity
                  key={option.label}
                  style={{
                    flex: 1,
                    minHeight: 78,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: palette.border,
                    backgroundColor: option.tone,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    opacity: showAnswer ? 1 : 0.56,
                  }}
                  disabled={!showAnswer}
                  onPress={() => submitReview(option.rating)}
                >
                  <Text style={{ color: option.label === "Good" ? palette.accent : palette.text, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2 }}>
                    {option.label}
                  </Text>
                  <Text style={{ color: palette.text, fontSize: 24, fontWeight: "800" }}>{option.eta}</Text>
                </TouchableOpacity>
              ))}
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
      </View>

      <Text style={bodyStyle(palette)}>{reviewStatus}</Text>
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
  return (
    <View style={{ gap: 24 }}>
      <View
        style={{
          ...cardBase(palette),
          alignItems: "center",
          backgroundColor: palette.surfaceLow,
          paddingVertical: 30,
        }}
      >
        <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2.8, textTransform: "uppercase" }}>
          {PRODUCT_SURFACES.planner.label}
        </Text>
        <Text style={{ color: palette.accent, fontSize: 72, lineHeight: 78, fontWeight: "800", letterSpacing: -4 }}>
          {stationTimeLabel}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: palette.accent, fontSize: 24, fontWeight: "700" }}>{stationPeriod}</Text>
          <View style={{ width: 40, height: 1, backgroundColor: palette.border }} />
          <MaterialCommunityIcons name="bell-ring-outline" size={18} color={palette.accent} />
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

      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View>
            <Text style={[headingStyle(palette), { fontSize: 24, lineHeight: 30 }]}>Today's plan</Text>
            <Text style={{ color: palette.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2 }}>
              {alarmScheduled ? `${nextBriefingCountdown} until briefing` : "Alarm unscheduled"}
            </Text>
          </View>
          <TouchableOpacity style={pillStyle(palette)} onPress={openPwa}>
            <Text style={{ color: palette.text, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>Open desktop web</Text>
          </TouchableOpacity>
        </View>
        {[
          { time: "09:30", title: "Assistant follow-up", detail: nextActionPreview, active: true, critical: false },
          { time: "12:00", title: "Focused work block", detail: "Protect a quiet block for your highest-value work.", active: false, critical: false },
          { time: "15:45", title: "Priority handoff", detail: "Close the biggest open loop before the evening review.", active: true, critical: true },
        ].map((item, index, items) => (
          <View key={item.time} style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ alignItems: "center" }}>
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  backgroundColor: item.active ? palette.accent : "transparent",
                  borderWidth: item.active ? 0 : 2,
                  borderColor: item.critical ? palette.accent : palette.border,
                  marginTop: 5,
                }}
              />
              {index < items.length - 1 ? <View style={{ width: 1, flex: 1, backgroundColor: palette.border, marginTop: 6 }} /> : null}
            </View>
            <View
              style={{
                flex: 1,
                borderRadius: 18,
                backgroundColor: item.critical ? palette.surfaceHighest : palette.surfaceLow,
                borderWidth: 1,
                borderColor: palette.border,
                padding: 14,
                gap: 6,
                marginBottom: 10,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <Text style={{ color: item.active ? palette.accent : palette.muted, fontSize: 11, fontWeight: "700", fontFamily: "monospace" }}>
                  {item.time}
                </Text>
                {item.critical ? (
                  <View style={{ ...pillStyle(palette, true), paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: palette.accent, fontSize: 9, fontWeight: "800", textTransform: "uppercase" }}>Critical</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: palette.text, fontSize: 16, fontWeight: "800" }}>{item.title}</Text>
              <Text style={bodyStyle(palette)}>{item.detail}</Text>
            </View>
          </View>
        ))}
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
