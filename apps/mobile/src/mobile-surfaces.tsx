import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

import { mobileConversationCardLabel } from "./conversation-cards";

type SharedProps = {
  styles: Record<string, any>;
  palette: Record<string, string>;
};

type ConversationCard = {
  kind: string;
  version: number;
  title?: string | null;
  body?: string | null;
  metadata: Record<string, unknown>;
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
  runMainRoomTurn: () => void;
  refreshThread: () => void;
  resetConversationSession: () => void;
  visibleConversationMessages: ConversationMessage[];
  hiddenConversationMessageCount: number;
  openAssistantInPwa: () => void;
  previewCommandFlow: () => void;
  formatCardMeta: (card: ConversationCard) => string;
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
  return messages.slice(-4);
}

export function MobileHomeSurface({
  palette,
  pendingConversationTurn,
  homeDraft,
  setHomeDraft,
  runMainRoomTurn,
  refreshThread,
  resetConversationSession,
  visibleConversationMessages,
  hiddenConversationMessageCount,
  openAssistantInPwa,
  previewCommandFlow,
  formatCardMeta,
}: MobileHomeSurfaceProps) {
  const recentMessages = mapRecentMessages(visibleConversationMessages);

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 8 }}>
        <Text style={kickerStyle(palette)}>Home</Text>
        <Text style={headingStyle(palette)}>Persistent thread, reduced to one return point.</Text>
        <Text style={bodyStyle(palette)}>
          The mobile Home tab keeps the conversation first. Tool work and dynamic cards stay inside the thread instead
          of becoming a separate console.
        </Text>
      </View>

      <View style={{ gap: 16 }}>
        {recentMessages.length === 0 ? (
          <View style={cardBase(palette)}>
            <Text style={kickerStyle(palette)}>Main Room</Text>
            <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>No synced turns yet.</Text>
            <Text style={bodyStyle(palette)}>Start the next turn here and the shared thread will fill in.</Text>
          </View>
        ) : (
          recentMessages.map((message, index) => {
            const isUser = message.role === "user";
            const isAssistant = message.role === "assistant";
            const card = message.cards[0];
            return (
              <View
                key={message.id}
                style={{
                  alignSelf: isUser ? "flex-end" : "stretch",
                  maxWidth: "92%",
                  marginLeft: isUser ? 48 : 0,
                  marginRight: isUser ? 0 : 24,
                  borderRadius: 24,
                  borderTopLeftRadius: isUser ? 24 : 8,
                  borderTopRightRadius: isUser ? 8 : 24,
                  backgroundColor: isUser ? palette.surfaceHigh : palette.surfaceLow,
                  borderWidth: 1,
                  borderColor: palette.border,
                  padding: 18,
                  gap: 10,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {!isUser ? (
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 8,
                        backgroundColor: "rgba(241, 182, 205, 0.16)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <MaterialCommunityIcons name="star-four-points-outline" size={14} color={palette.accent} />
                    </View>
                  ) : null}
                  <Text style={[kickerStyle(palette), { color: isUser ? palette.secondary : palette.accent }]}>
                    {isUser ? "Observer" : isAssistant ? "Operational Briefing" : message.role}
                  </Text>
                </View>
                <Text style={{ color: palette.text, fontSize: 18, lineHeight: 28, fontStyle: isUser ? "italic" : "normal" }}>
                  {message.content || (pendingConversationTurn && index === recentMessages.length - 1 ? "Observatory reply forming..." : "No content")}
                </Text>
                {card ? (
                  <View
                    style={{
                      borderRadius: 18,
                      overflow: "hidden",
                      backgroundColor: palette.surfaceHigh,
                      borderWidth: 1,
                      borderColor: palette.border,
                    }}
                  >
                    <View style={{ height: 140, backgroundColor: palette.surfaceHighest }} />
                    <View style={{ padding: 14, gap: 8 }}>
                      <Text style={[kickerStyle(palette), { color: palette.secondary }]}>
                        {mobileConversationCardLabel(card.kind, card.title)}
                      </Text>
                      <Text style={{ color: palette.text, fontSize: 20, lineHeight: 26, fontWeight: "700" }}>
                        {card.title || "Dynamic card"}
                      </Text>
                      <Text style={bodyStyle(palette)}>{card.body || formatCardMeta(card)}</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      <View style={{ ...cardBase(palette), gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={kickerStyle(palette)}>Speak or type command</Text>
          <View style={pillStyle(palette, pendingConversationTurn)}>
            <Text style={{ color: pendingConversationTurn ? palette.accent : palette.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase" }}>
              {pendingConversationTurn ? "Reply pending" : "Thread ready"}
            </Text>
          </View>
        </View>
        <View
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.surfaceHighest,
            paddingHorizontal: 18,
            paddingVertical: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <TextInput
            style={{ flex: 1, color: palette.text, fontSize: 14 }}
            value={homeDraft}
            onChangeText={setHomeDraft}
            placeholder="Speak or type command..."
            placeholderTextColor={palette.muted}
            multiline
          />
          <MaterialCommunityIcons name="keyboard-outline" size={18} color={palette.muted} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity
            style={{
              flex: 1,
              borderRadius: 999,
              backgroundColor: palette.surfaceHigh,
              paddingVertical: 13,
              alignItems: "center",
            }}
            onPress={runMainRoomTurn}
          >
            <Text style={{ color: palette.text, fontWeight: "700", textTransform: "uppercase", fontSize: 12, letterSpacing: 1 }}>
              Send
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: palette.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={previewCommandFlow}
          >
            <MaterialCommunityIcons name="microphone" size={24} color={palette.onAccent} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity style={{ ...pillStyle(palette), flex: 1, alignItems: "center" }} onPress={refreshThread}>
            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>Refresh</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ ...pillStyle(palette), flex: 1, alignItems: "center" }} onPress={resetConversationSession}>
            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>Reset session</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ ...pillStyle(palette), flex: 1, alignItems: "center" }} onPress={openAssistantInPwa}>
            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>Open PWA</Text>
          </TouchableOpacity>
        </View>
        {hiddenConversationMessageCount > 0 ? (
          <Text style={bodyStyle(palette)}>{hiddenConversationMessageCount} older messages remain in the full transcript.</Text>
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
    <View style={{ gap: 20 }}>
      <View style={{ ...cardBase(palette), overflow: "hidden" }}>
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
        <TextInput
          style={{
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
          <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Pinned Notes</Text>
          <Text style={{ color: palette.secondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 }}>
            {pendingCaptures} pending
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {[selectedArtifactTitle || "Lunar Surface Crystallization Patterns", captureCommandPreview, routeNarrative].map((item, index) => (
            <View
              key={`${item}-${index}`}
              style={{
                width: 240,
                borderRadius: 20,
                backgroundColor: palette.surfaceLow,
                borderWidth: 1,
                borderColor: palette.border,
                padding: 16,
                gap: 10,
              }}
            >
              <Text style={[kickerStyle(palette), { color: palette.muted }]}>
                {index === 0 ? "Research" : index === 1 ? "Capture" : "Routing"}
              </Text>
              <Text style={{ color: palette.text, fontSize: 18, lineHeight: 24, fontWeight: "700" }}>{item}</Text>
              <Text style={bodyStyle(palette)}>
                {index === 0 ? captureSourcePreview : index === 1 ? captureQueuePreview : sharedDraftSummary}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Recent Artifacts</Text>
          <Text style={{ color: palette.secondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 }}>
            Archive browse
          </Text>
        </View>
        <View style={cardBase(palette)}>
          <Text style={{ color: palette.text, fontSize: 18, lineHeight: 24, fontWeight: "700" }}>{captureCommandPreview}</Text>
          <Text style={bodyStyle(palette)}>{captureQueuePreview}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <View style={pillStyle(palette)}>
              <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700" }}>{voiceMemoPreview}</Text>
            </View>
            <View style={pillStyle(palette)}>
              <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700" }}>{sharedDraftSummary}</Text>
            </View>
          </View>
        </View>
        <View style={cardBase(palette)}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={kickerStyle(palette)}>Incoming context</Text>
              <Text style={{ color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: "700" }}>{selectedArtifactTitle}</Text>
              <Text style={bodyStyle(palette)}>{captureSourcePreview}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={kickerStyle(palette)}>Routing</Text>
              <Text style={{ color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: "700" }}>Voice + output path</Text>
              <Text style={bodyStyle(palette)}>{routeNarrative}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 }}>
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
              <MaterialCommunityIcons name="play" size={20} color={palette.onAccent} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.text, fontSize: 16, fontWeight: "700" }}>Latest voice memo</Text>
              <Text style={bodyStyle(palette)}>{voiceMemoPreview}</Text>
            </View>
            {voiceClipReady ? (
              <TouchableOpacity style={{ ...pillStyle(palette, true) }} onPress={submitVoiceCapture}>
                <Text style={{ color: palette.accent, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Save voice</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      <View style={{ gap: 10, alignItems: "center" }}>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={submitPrimaryCapture}>
            <Text style={styles.buttonText}>Save capture</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={flushPendingCaptures}>
            <Text style={styles.buttonText}>Flush queue</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={toggleMissionTools}>
          <Text style={[kickerStyle(palette), { fontSize: 11 }]}>
            {showAdvancedCapture ? "Close mission tools" : "Mission tools"}
          </Text>
        </TouchableOpacity>
      </View>
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
          <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Knowledge Health</Text>
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
            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Open workspace</Text>
          </TouchableOpacity>
        </View>
        {(deckCards.length > 0 ? deckCards : [
          {
            id: "review-workspace",
            name: "Deck Workspace",
            description: "Open the fuller browser and analytics surface in the PWA.",
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
            <Text style={bodyStyle(palette)}>This surface stays quiet until the due queue is requested from the shared SRS backend.</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.button} onPress={loadDueCards}>
                <Text style={styles.buttonText}>Load due cards</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={openReviewWorkspace}>
                <Text style={styles.buttonText}>Open deck workspace</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <Text style={bodyStyle(palette)}>{reviewStatus}</Text>
      <TouchableOpacity style={{ alignItems: "center" }} onPress={toggleMissionTools}>
        <Text style={[kickerStyle(palette), { fontSize: 11 }]}>
          {showAdvancedReview ? "Close mission tools" : "Mission tools"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export function MobileLoginSurface({
  styles,
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
          <Text style={{ color: palette.accent, fontSize: 40, fontWeight: "800", letterSpacing: 6 }}>STARLOG</Text>
          <Text style={{ color: palette.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.3 }}>
            Obsidian Observatory
          </Text>
        </View>
      </View>

      <View style={{ ...cardBase(palette), gap: 16 }}>
        <View style={{ gap: 8 }}>
          <Text style={kickerStyle(palette)}>Observer identity</Text>
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
            <Text style={kickerStyle(palette)}>Access cipher</Text>
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
            placeholder="minimum 12 characters for first station bootstrap"
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
            {authBusy ? "Initiating..." : "Initiate Neural Sync"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={{ alignItems: "center", paddingVertical: 8 }} disabled={authBusy} onPress={bootstrap}>
          <Text style={{ color: palette.secondary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.3 }}>
            Establish Station
          </Text>
        </TouchableOpacity>

        <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 20 }}>{authStatus}</Text>
      </View>

      <View style={{ alignItems: "center", gap: 12 }}>
        <Text style={{ color: palette.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2 }}>
          Deep Space Protocol
        </Text>
        <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
          Single-user passphrase login. Use bootstrap once for a new station, then login for subsequent sessions.
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
    <View style={{ gap: 20 }}>
      <View
        style={{
          ...cardBase(palette),
          alignItems: "center",
          backgroundColor: palette.surfaceLow,
          paddingVertical: 28,
        }}
      >
        <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2.8, textTransform: "uppercase" }}>
          Daily Return Point
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
            <Text style={[headingStyle(palette), { fontSize: 22, lineHeight: 28 }]}>Morning Ritual</Text>
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
        <Text style={[headingStyle(palette), { fontSize: 24, lineHeight: 30 }]}>Today's Agenda</Text>
        {[
          { time: "09:30", title: "Archive Review", detail: nextActionPreview, active: true },
          { time: "12:00", title: "Solar Noon Calibration", detail: "Align the day around one quiet reset.", active: false },
          { time: "15:45", title: "Council Manifest", detail: "Critical handoff before evening synthesis.", active: true },
        ].map((item) => (
          <View key={item.time} style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ alignItems: "center" }}>
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  backgroundColor: item.active ? palette.accent : "transparent",
                  borderWidth: item.active ? 0 : 2,
                  borderColor: palette.border,
                  marginTop: 5,
                }}
              />
              <View style={{ width: 1, flex: 1, backgroundColor: palette.border, marginTop: 6 }} />
            </View>
            <View
              style={{
                flex: 1,
                borderRadius: 18,
                backgroundColor: item.active ? palette.surfaceHighest : palette.surfaceLow,
                borderWidth: 1,
                borderColor: palette.border,
                padding: 14,
                gap: 6,
                marginBottom: 10,
              }}
            >
              <Text style={{ color: item.active ? palette.accent : palette.muted, fontSize: 11, fontWeight: "700", fontFamily: "monospace" }}>
                {item.time}
              </Text>
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
            <Text style={styles.buttonText}>Open workspace</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={openReview}>
            <Text style={styles.buttonText}>Open review</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={{ alignItems: "center" }} onPress={toggleMissionTools}>
        <Text style={[kickerStyle(palette), { fontSize: 11 }]}>
          {showAdvancedAlarms ? "Close mission tools" : "Mission tools"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
