import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, Text, TextInput, TouchableOpacity, View } from "react-native";

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
  assistantCommand: string;
  setAssistantCommand: (value: string) => void;
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
  assistantCommand: string;
  setAssistantCommand: (value: string) => void;
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
  showAnswer: boolean;
  revealAnswer: () => void;
  submitReview: (rating: number) => void;
  hasReviewCard: boolean;
  showAdvancedReview: boolean;
  toggleMissionTools: () => void;
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

export function MobileHomeSurface({
  styles,
  pendingConversationTurn,
  assistantCommand,
  setAssistantCommand,
  runMainRoomTurn,
  refreshThread,
  resetConversationSession,
  visibleConversationMessages,
  hiddenConversationMessageCount,
  openAssistantInPwa,
  previewCommandFlow,
  formatCardMeta,
}: MobileHomeSurfaceProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionKicker}>Conversation-first home</Text>
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingBadgeText}>{pendingConversationTurn ? "Reply pending" : "Thread ready"}</Text>
        </View>
      </View>
      <View style={styles.surfaceStatsRow}>
        <View style={styles.surfaceStatCard}>
          <Text style={styles.surfaceStatValue}>{visibleConversationMessages.length}</Text>
          <Text style={styles.surfaceStatLabel}>Visible turns</Text>
        </View>
        <View style={styles.surfaceStatCard}>
          <Text style={styles.surfaceStatValue}>{hiddenConversationMessageCount}</Text>
          <Text style={styles.surfaceStatLabel}>Hidden turns</Text>
        </View>
        <View style={styles.surfaceStatCard}>
          <Text style={styles.surfaceStatValue}>{pendingConversationTurn ? "LIVE" : "READY"}</Text>
          <Text style={styles.surfaceStatLabel}>Thread state</Text>
        </View>
      </View>
      <View style={styles.captureComposerCard}>
        <Text style={styles.heroCardLabel}>Main Room message</Text>
        <TextInput
          style={[styles.composerInput, styles.composerInputLarge]}
          value={assistantCommand}
          onChangeText={setAssistantCommand}
          placeholder="What should I focus on next?"
          placeholderTextColor={styles.subtle?.color}
          multiline
        />
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={runMainRoomTurn}>
            <Text style={styles.buttonText}>{pendingConversationTurn ? "Sending..." : "Send to Main Room"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={refreshThread}>
            <Text style={styles.buttonText}>Refresh thread</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={resetConversationSession}>
            <Text style={styles.buttonText}>Reset session</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.captureArtifactCard}>
        <Text style={styles.heroCardLabel}>Recent thread</Text>
        {visibleConversationMessages.length === 0 ? (
          <Text style={styles.subtle}>No conversation turns yet. Start in the Main Room and the thread will appear here.</Text>
        ) : (
          visibleConversationMessages.map((message) => (
            <View key={message.id} style={styles.inlineCard}>
              <Text style={styles.heroCardLabel}>{message.role.toUpperCase()}</Text>
              <Text style={styles.inlineCardTitle}>
                {message.metadata?.pending && message.role === "assistant"
                  ? "Observatory reply forming..."
                  : message.content || "No message body"}
              </Text>
              {message.cards[0] ? (
                <Text style={styles.subtle}>
                  {mobileConversationCardLabel(message.cards[0].kind, message.cards[0].title)} · {formatCardMeta(message.cards[0])}
                </Text>
              ) : null}
            </View>
          ))
        )}
        {hiddenConversationMessageCount > 0 ? (
          <Text style={styles.subtle}>{hiddenConversationMessageCount} older message(s) hidden. Open the PWA for the full transcript.</Text>
        ) : null}
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={openAssistantInPwa}>
          <Text style={styles.buttonText}>Open Main Room in PWA</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={previewCommandFlow}>
          <Text style={styles.buttonText}>Preview command flow</Text>
        </TouchableOpacity>
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
  assistantCommand,
  setAssistantCommand,
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
    <View style={styles.panel}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionKicker}>Notes and capture</Text>
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingBadgeText}>{pendingCaptures} Pending</Text>
        </View>
      </View>
      <View style={styles.surfaceLeadCard}>
        <Text style={styles.heroCardLabel}>Capture mode</Text>
        <Text style={styles.surfaceLeadTitle}>Quick capture with pinned context and recent artifacts nearby.</Text>
        <Text style={styles.surfaceLeadCopy}>
          Keep intake lightweight, then move into artifact triage only when a capture is worth expanding.
        </Text>
      </View>
      <View style={styles.captureComposerCard}>
        <Text style={styles.heroCardLabel}>Capture title</Text>
        <TextInput
          style={styles.composerInput}
          value={quickCaptureTitle}
          onChangeText={setQuickCaptureTitle}
          placeholder="Mobile capture"
          placeholderTextColor={palette.muted}
        />
        <Text style={styles.heroCardLabel}>Source URL</Text>
        <TextInput
          style={styles.composerInput}
          value={quickCaptureSourceUrl}
          onChangeText={setQuickCaptureSourceUrl}
          autoCapitalize="none"
          placeholder="https://..."
          placeholderTextColor={palette.muted}
        />
        <Text style={styles.heroCardLabel}>Capture text</Text>
        <TextInput
          style={[styles.composerInput, styles.composerInputLarge]}
          value={quickCaptureText}
          onChangeText={setQuickCaptureText}
          placeholder="Clip text, ideas, or reminders..."
          placeholderTextColor={palette.muted}
          multiline
        />
        <Text style={styles.heroCardLabel}>Typed instruction</Text>
        <TextInput
          style={styles.composerInput}
          value={assistantCommand}
          onChangeText={setAssistantCommand}
          placeholder="Save this and turn it into tonight's reading note."
          placeholderTextColor={palette.muted}
        />
      </View>
      <View style={styles.captureHeroActions}>
        <Pressable style={styles.primaryAction} onPressIn={beginHoldToTalkCapture} onPressOut={endHoldToTalkCapture}>
          <MaterialCommunityIcons name={voiceRecording ? "stop" : "microphone"} size={16} color={palette.onAccent} />
          <Text style={styles.primaryActionText}>{holdToTalkLabel}</Text>
        </Pressable>
        <TouchableOpacity style={styles.iconAction} onPress={submitPrimaryCapture}>
          <MaterialCommunityIcons name="content-save-outline" size={16} color={palette.accent} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconAction} onPress={flushPendingCaptures}>
          <MaterialCommunityIcons name="upload-outline" size={16} color={palette.accent} />
        </TouchableOpacity>
      </View>
      <Text style={styles.subtle}>Press and hold to capture a voice note. Release to stop, then save the voice note or queue text and files.</Text>
      <View style={styles.captureArtifactCard}>
        <Text style={styles.heroCardLabel}>Selected next move</Text>
        <Text style={styles.captureArtifactTitle}>{captureCommandPreview}</Text>
        <Text style={styles.body}>{captureQueuePreview}</Text>
        <View style={styles.contextMetaRow}>
          <View style={styles.miniTag}>
            <Text style={styles.miniTagText}>{voiceMemoPreview}</Text>
          </View>
          <View style={styles.miniTag}>
            <Text style={styles.miniTagText}>{sharedDraftSummary}</Text>
          </View>
        </View>
      </View>
      <View style={styles.captureMediaRow}>
        <View style={styles.captureMediaTile}>
          <Text style={styles.heroCardLabel}>Incoming context</Text>
          <Text style={styles.inlineCardTitle}>{selectedArtifactTitle}</Text>
          <Text style={styles.subtle}>{captureSourcePreview}</Text>
        </View>
        <View style={styles.captureAlertTile}>
          <Text style={styles.heroCardLabel}>Routing</Text>
          <Text style={styles.inlineCardTitle}>Voice + output path</Text>
          <Text style={styles.subtle}>{routeNarrative}</Text>
        </View>
      </View>
      <View style={styles.captureVoiceMemo}>
        <TouchableOpacity style={styles.capturePlayButton} onPress={playVoiceClip}>
          <MaterialCommunityIcons name="play" size={20} color={palette.onAccent} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.inlineCardTitle}>Latest voice memo</Text>
          <Text style={styles.subtle}>{voiceMemoPreview}</Text>
          {voiceClipReady ? (
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.button} onPress={submitVoiceCapture}>
                <Text style={styles.buttonText}>Save Voice Note</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={toggleMissionTools}>
          <Text style={styles.buttonText}>{showAdvancedCapture ? "Close Mission Tools" : "Open Mission Tools"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function MobileReviewSurface({
  styles,
  reviewPrompt,
  reviewAnswer,
  showAnswer,
  revealAnswer,
  submitReview,
  hasReviewCard,
  showAdvancedReview,
  toggleMissionTools,
}: MobileReviewSurfaceProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.reviewTopRow}>
        <View>
          <Text style={styles.sectionKicker}>Current Session</Text>
          <Text style={styles.subtle}>Knowledge health: 42%</Text>
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
      <View style={styles.surfaceStatsRow}>
        <View style={styles.surfaceStatCard}>
          <Text style={styles.surfaceStatValue}>{hasReviewCard ? "1" : "0"}</Text>
          <Text style={styles.surfaceStatLabel}>Focused card</Text>
        </View>
        <View style={styles.surfaceStatCard}>
          <Text style={styles.surfaceStatValue}>{showAnswer ? "OPEN" : "SEALED"}</Text>
          <Text style={styles.surfaceStatLabel}>Answer state</Text>
        </View>
        <View style={styles.surfaceStatCard}>
          <Text style={styles.surfaceStatValue}>89%</Text>
          <Text style={styles.surfaceStatLabel}>Retention</Text>
        </View>
      </View>
      <View style={styles.reviewFlashcard}>
        <Text style={styles.reviewMeta}>Last seen: 4 days ago</Text>
        <Text style={styles.reviewCategory}>Scientific Nomenclature</Text>
        <Text style={styles.reviewPromptLarge}>{reviewPrompt}</Text>
        <View style={styles.reviewDivider} />
        <Text style={styles.reviewAnswerLarge}>{showAnswer ? reviewAnswer : "Tap reveal to show answer"}</Text>
        <TouchableOpacity style={styles.button} onPress={revealAnswer}>
          <Text style={styles.buttonText}>Reveal Answer</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.reviewRateRow}>
        <TouchableOpacity style={styles.reviewRateButton} onPress={() => submitReview(1)}>
          <Text style={styles.reviewRateLabel}>Again</Text>
          <Text style={styles.reviewRateValue}>1m</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reviewRateButton} onPress={() => submitReview(2)}>
          <Text style={styles.reviewRateLabel}>Hard</Text>
          <Text style={styles.reviewRateValue}>2d</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.reviewRateButton, styles.reviewRateButtonActive]} onPress={() => submitReview(4)}>
          <Text style={[styles.reviewRateLabel, styles.reviewRateLabelActive]}>Good</Text>
          <Text style={styles.reviewRateValue}>4d</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reviewRateButton} onPress={() => submitReview(5)}>
          <Text style={styles.reviewRateLabel}>Easy</Text>
          <Text style={styles.reviewRateValue}>7d</Text>
        </TouchableOpacity>
      </View>
      {!hasReviewCard ? <Text style={styles.subtle}>Load due cards first to start the focused review flow.</Text> : null}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={toggleMissionTools}>
          <Text style={styles.buttonText}>{showAdvancedReview ? "Close Mission Tools" : "Open Mission Tools"}</Text>
        </TouchableOpacity>
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
    <View style={styles.panel}>
      <View style={styles.surfaceLeadCard}>
        <Text style={styles.heroCardLabel}>Daily return point</Text>
        <Text style={styles.surfaceLeadTitle}>Calendar alarms, briefing playback, and one next ritual move.</Text>
        <Text style={styles.surfaceLeadCopy}>
          This screen should feel like a calm ritual station, not a generic alarm utility.
        </Text>
      </View>
      <View style={styles.alarmClockRow}>
        <Text style={styles.alarmClockText}>{stationTimeLabel}</Text>
        <Text style={styles.alarmClockPeriod}>{stationPeriod}</Text>
      </View>
      <Text style={styles.alarmStationMeta}>Daily return point</Text>
      <View style={styles.alarmNextCard}>
        <View>
          <Text style={styles.heroCardLabel}>Agenda cycle</Text>
          <Text style={styles.captureArtifactTitle}>{briefingHeroCopy}</Text>
          <Text style={styles.subtle}>Scheduled for {stationTimeLabel} {stationPeriod}</Text>
        </View>
        <View>
          <Text style={styles.alarmCountdown}>{nextBriefingCountdown}</Text>
          <Text style={styles.subtle}>Until play</Text>
        </View>
      </View>
      <View style={styles.alarmPlayerCard}>
        <Text style={styles.heroCardLabel}>Playback</Text>
        <Text style={styles.inlineCardTitle}>Daily briefing</Text>
        <Text style={styles.subtle}>{offlineBriefingStatus}</Text>
        <Text style={styles.subtle}>{briefingPlaybackStatus}</Text>
        <View style={styles.alarmWaveRow}>
          {[4, 10, 6, 14, 5, 11, 13, 4, 8, 12].map((height, index) => (
            <View key={index} style={[styles.alarmWaveBar, { height }]} />
          ))}
        </View>
        <View style={styles.alarmPlayerButtons}>
          <TouchableOpacity style={[styles.iconAction, !canPlayOffline ? { opacity: 0.45 } : null]} onPress={playBriefing}>
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
      <View style={styles.alarmPlayerCard}>
        <Text style={styles.heroCardLabel}>One next move</Text>
        <Text style={styles.inlineCardTitle}>{nextActionPreview}</Text>
        <Text style={styles.subtle}>After playback, continue in the PWA or in quick review.</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={openPwa}>
            <Text style={styles.buttonText}>Open workspace</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={openReview}>
            <Text style={styles.buttonText}>Open review</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.alarmCycleCard}>
        <Text style={styles.heroCardLabel}>Alarm schedule</Text>
        <Text style={styles.inlineCardTitle}>Daily alarm</Text>
        <View style={styles.alarmCycleRow}>
          <View>
            <Text style={styles.alarmCycleTime}>{stationTimeLabel}</Text>
            <Text style={styles.subtle}>{alarmScheduled ? "Alarm is scheduled" : "Alarm is not scheduled yet"}</Text>
          </View>
          <TouchableOpacity style={styles.toggleButton} onPress={toggleAlarm}>
            <View style={[styles.toggleKnob, alarmScheduled ? styles.toggleKnobOn : null]} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={toggleMissionTools}>
          <Text style={styles.buttonText}>{showAdvancedAlarms ? "Close Mission Tools" : "Open Mission Tools"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
