import type { AssistantCard as ConversationCard } from "@starlog/contracts";
import { Text, TextInput, TouchableOpacity, View } from "react-native";

import { MobileOpsChip } from "./mobile-ops-panels";
import { MOBILE_SUPPORT_PANEL_COPY } from "./mobile-support-panels";

type SharedProps = {
  styles: Record<string, any>;
  palette: Record<string, string>;
};

type ArtifactAction = "summarize" | "cards" | "tasks" | "append_note";

type SharedFileDraft = {
  localUri: string;
  mimeType: string;
  fileName: string;
  bytesSize: number | null;
};

type PendingCapture = {
  id: string;
  kind: string;
  title: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

type ExecutionResolution = {
  requested: string;
  active: string;
  reason?: string | null;
};

type ArtifactListItem = {
  id: string;
  title?: string | null;
  source_type: string;
  created_at: string;
};

type ArtifactQuickAction = {
  action: ArtifactAction;
  label: string;
};

type ArtifactGraph = {
  summaries: Array<{ version: number; content: string }>;
  cards: Array<{ id: string; prompt: string; answer: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  notes: Array<{ id: string; title: string; body_md: string }>;
};

type ArtifactVersions = {
  summaries: Array<unknown>;
  card_sets: Array<unknown>;
  actions: Array<{ id: string; action: string; status: string }>;
};

type DueCard = {
  id: string;
  card_type: string;
  prompt: string;
  answer: string;
};

type AssistantCommandStep = {
  tool_name: string;
  arguments: Record<string, unknown>;
  status: string;
  message?: string | null;
  result: unknown;
};

type AssistantCommandResponse = {
  matched_intent: string;
  status: string;
  summary: string;
  steps: AssistantCommandStep[];
};

type AssistantQueuedJob = {
  id: string;
  status: string;
  provider_hint?: string | null;
  provider_used?: string | null;
  payload: Record<string, unknown> & {
    command?: string;
  };
  output: {
    transcript?: string;
    assistant_command?: AssistantCommandResponse;
  };
  error_text?: string | null;
  created_at: string;
};

type ConversationMessage = {
  id: string;
  role: string;
  content: string;
  cards: ConversationCard[];
  created_at: string;
  metadata?: {
    assistant_command?: AssistantCommandResponse;
  } & Record<string, unknown>;
};

type ConversationToolTrace = {
  id: string;
  message_id?: string | null;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: string;
  result: unknown;
};

const SUPPORT_CARD_TYPE_LABELS: Record<string, string> = {
  qa: "Recall",
  cloze: "Recall",
  recall: "Recall",
  understanding: "Understanding",
  explain: "Understanding",
  why: "Understanding",
  application: "Application",
  application_case: "Application",
  scenario: "Application",
  drill: "Application",
  synthesis: "Synthesis",
  compare: "Synthesis",
  connect: "Synthesis",
  judgment: "Judgment",
  judgment_prompt: "Judgment",
  tradeoff: "Judgment",
  critique: "Judgment",
  interview: "Interview prompt",
  interview_prompt: "Interview prompt",
};

const SUPPORT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  in_progress: "In progress",
  processing: "Processing",
  complete: "Complete",
  completed: "Completed",
  done: "Done",
  success: "Succeeded",
  succeeded: "Succeeded",
  failed: "Failed",
  error: "Error",
  skipped: "Skipped",
  blocked: "Blocked",
  open: "Open",
  closed: "Closed",
};

const SUPPORT_PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex",
  local: "Local",
  local_first: "Local first",
  openai: "OpenAI",
  openai_primary: "OpenAI primary",
  pending: "Pending",
};

const SUPPORT_SOURCE_TYPE_LABELS: Record<string, string> = {
  browser_clip: "Browser clip",
  desktop_helper: "Desktop helper",
  file_upload: "File upload",
  manual: "Manual entry",
  pdf: "PDF",
  shared_file: "Shared file",
  text: "Text",
  url: "Web page",
  voice_note: "Voice note",
  web: "Web page",
};

function supportMachineKey(value?: string | null): string {
  return value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
}

function supportMachineLabel(value?: string | null, fallback = "Unknown"): string {
  const normalized = value?.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function supportStatusLabel(status?: string | null): string {
  const key = supportMachineKey(status);
  return SUPPORT_STATUS_LABELS[key] ?? supportMachineLabel(status);
}

function supportCardTypeLabel(cardType?: string | null): string {
  const key = supportMachineKey(cardType);
  return SUPPORT_CARD_TYPE_LABELS[key] ?? supportMachineLabel(cardType, "Review card");
}

function supportActionLabel(action?: string | null): string {
  return supportMachineLabel(action, "Action");
}

function supportCommandLabel(command?: string | null): string {
  return supportMachineLabel(command, "Assistant command");
}

function supportToolLabel(toolName?: string | null): string {
  return supportMachineLabel(toolName, "Runtime tool");
}

function supportProviderLabel(provider?: string | null): string {
  const key = supportMachineKey(provider);
  return SUPPORT_PROVIDER_LABELS[key] ?? supportMachineLabel(provider, "Pending");
}

function supportArtifactSourceLabel(sourceType?: string | null): string {
  const key = supportMachineKey(sourceType);
  return SUPPORT_SOURCE_TYPE_LABELS[key] ?? supportMachineLabel(sourceType, "Source");
}

type CaptureQueueSectionProps = SharedProps & {
  quickCaptureTitle: string;
  setQuickCaptureTitle: (value: string) => void;
  quickCaptureSourceUrl: string;
  setQuickCaptureSourceUrl: (value: string) => void;
  quickCaptureText: string;
  setQuickCaptureText: (value: string) => void;
  submitQuickCapture: () => void;
  flushPendingCaptures: () => void;
  voiceRecording: boolean;
  startVoiceRecording: () => void;
  stopVoiceRecording: () => void;
  submitVoiceCapture: () => void;
  voiceClipUri: string | null;
  voiceClipDurationMs: number;
  sharedFileDrafts: SharedFileDraft[];
  describeSharedDrafts: (drafts: SharedFileDraft[]) => string;
  describeSharedFile: (fileName: string, mimeType: string, bytesSize: number | null) => string;
  clearSharedFiles: () => void;
  pendingCaptures: PendingCapture[];
};

type CaptureRoutingSectionProps = SharedProps & {
  llmResolution: ExecutionResolution;
  sttResolution: ExecutionResolution;
  ttsResolution: ExecutionResolution;
  formatExecutionTarget: (target: string) => string;
  voiceRoutePreference: "shared_policy" | "on_device_first" | "bridge_first";
  setVoiceRoutePreference: (value: "shared_policy" | "on_device_first" | "bridge_first") => void;
  executionPolicyUpdatedAt?: string | null;
  refreshPolicy: () => void;
  openIntegrations: () => void;
};

type ArtifactTriageSectionProps = SharedProps & {
  loadArtifacts: () => void;
  openSelectedArtifactInPwa: () => void;
  speakSelectedArtifact: () => void;
  selectedArtifact: ArtifactListItem | null;
  artifactDetailStatus: string;
  artifactQuickActions: ArtifactQuickAction[];
  runArtifactAction: (action: ArtifactAction) => void;
  artifacts: ArtifactListItem[];
  selectedArtifactId: string;
  setSelectedArtifactId: (id: string) => void;
  artifactGraph: ArtifactGraph | null;
  artifactVersions: ArtifactVersions | null;
  openTaskInPwa: (taskId: string) => void;
  openNoteInPwa: (noteId: string) => void;
};

type ReviewSessionSectionProps = SharedProps & {
  dueCards: DueCard[];
  showAnswer: boolean;
  loadDueCards: () => void;
  revealAnswer: () => void;
  submitReview: (rating: number) => void;
};

type DesktopFallbackSectionProps = SharedProps & {
  pwaBase: string;
  setPwaBase: (value: string) => void;
  openPwa: () => void;
};

type BriefingPipelineSectionProps = SharedProps & {
  apiBase: string;
  setApiBase: (value: string) => void;
  token: string;
  setToken: (value: string) => void;
  briefingDate: string;
  setBriefingDate: (value: string) => void;
  alarmHour: number;
  setAlarmHour: (value: number) => void;
  alarmMinute: number;
  setAlarmMinute: (value: number) => void;
  boundedInt: (value: number, lower: number, upper: number) => number;
  briefingPlaybackStatus: string;
  briefingPlaybackPreference: "offline_first" | "refresh_then_cache";
  setBriefingPlaybackPreference: (value: "offline_first" | "refresh_then_cache") => void;
  generateAndCache: () => void;
  queueBriefingAudio: () => void;
  playBriefing: () => void;
  scheduleMorningAlarm: () => void;
  clearMorningAlarm: () => void;
  notificationPermission: string;
  cachedPath: string | null;
  alarmNotificationId: string | null;
  toHourMinuteLabel: (hour: number, minute: number) => string;
  status: string;
};

type AssistantToolsSectionProps = SharedProps & {
  assistantCommand: string;
  setAssistantCommand: (value: string) => void;
  assistantExampleCommands: string[];
  runAssistantPlan: () => void;
  runAssistantExecute: () => void;
  queueAssistantPlan: () => void;
  queueAssistantExecute: () => void;
  openAssistantInPwa: () => void;
  sttUsesOnDevice: boolean;
  localSttListening: boolean;
  submitLocalVoiceAssistantPlan: () => void;
  submitLocalVoiceAssistantExecute: () => void;
  refreshLocalSttAvailability: () => void;
  voiceRecording: boolean;
  voiceClipTarget: "assistant" | "capture" | null;
  startAssistantVoiceRecording: () => void;
  stopVoiceRecording: () => void;
  submitVoiceAssistantPlan: () => void;
  submitVoiceAssistantExecute: () => void;
  refreshAssistantThread: () => void;
  resetConversationSession: () => void;
  localSttLabel: string;
  voiceCommandStatus: string;
  conversationTitle: string;
  conversationSessionState: Record<string, unknown>;
  conversationMessages: ConversationMessage[];
  conversationToolTraces: ConversationToolTrace[];
  lastConversationReset: { cleared_keys?: string[] } | null;
  visibleConversationMessages: ConversationMessage[];
  hiddenConversationMessageCount: number;
  showFullConversationThread: boolean;
  setShowFullConversationThread: (value: boolean) => void;
  expandedThreadCards: Record<string, boolean>;
  setExpandedThreadCards: (updater: (previous: Record<string, boolean>) => Record<string, boolean>) => void;
  expandedThreadTraces: Record<string, boolean>;
  setExpandedThreadTraces: (updater: (previous: Record<string, boolean>) => Record<string, boolean>) => void;
  cardMetaText: (card: ConversationCard) => string;
  summarizeTraceValue: (value: unknown) => string;
  threadMessagesLength: number;
  defaultVisibleMessages: number;
  showDiagnostics: boolean;
  toggleDiagnostics: () => void;
  assistantHistory: AssistantCommandResponse[];
  assistantVoiceJobs: AssistantQueuedJob[];
  assistantAiJobs: AssistantQueuedJob[];
};

export function CaptureQueueSection({
  styles,
  palette,
  quickCaptureTitle,
  setQuickCaptureTitle,
  quickCaptureSourceUrl,
  setQuickCaptureSourceUrl,
  quickCaptureText,
  setQuickCaptureText,
  submitQuickCapture,
  flushPendingCaptures,
  voiceRecording,
  startVoiceRecording,
  stopVoiceRecording,
  submitVoiceCapture,
  voiceClipUri,
  voiceClipDurationMs,
  sharedFileDrafts,
  describeSharedDrafts,
  describeSharedFile,
  clearSharedFiles,
  pendingCaptures,
}: CaptureQueueSectionProps) {
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
          <Text style={styles.buttonText}>Capture / queue</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={flushPendingCaptures}>
          <Text style={styles.buttonText}>Flush queue</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={voiceRecording ? stopVoiceRecording : startVoiceRecording}>
          <Text style={styles.buttonText}>{voiceRecording ? "Stop voice note" : "Start voice note"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={submitVoiceCapture}>
          <Text style={styles.buttonText}>Upload / queue voice</Text>
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
            <TouchableOpacity style={styles.button} onPress={clearSharedFiles}>
              <Text style={styles.buttonText}>Clear shared files</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
      <Text style={styles.subtle}>Pending captures: {pendingCaptures.length}</Text>
      {pendingCaptures[0]?.lastError ? <Text style={styles.subtle}>Last queue error: {pendingCaptures[0].lastError}</Text> : null}
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

export function CaptureRoutingSection({
  styles,
  llmResolution,
  sttResolution,
  ttsResolution,
  formatExecutionTarget,
  voiceRoutePreference,
  setVoiceRoutePreference,
  executionPolicyUpdatedAt,
  refreshPolicy,
  openIntegrations,
}: CaptureRoutingSectionProps) {
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
        <View style={styles.opsChipRow}>
          <MobileOpsChip
            styles={styles}
            label="Shared policy"
            active={voiceRoutePreference === "shared_policy"}
            onPress={() => setVoiceRoutePreference("shared_policy")}
          />
          <MobileOpsChip
            styles={styles}
            label="On-device first"
            active={voiceRoutePreference === "on_device_first"}
            onPress={() => setVoiceRoutePreference("on_device_first")}
          />
          <MobileOpsChip
            styles={styles}
            label="Bridge first"
            active={voiceRoutePreference === "bridge_first"}
            onPress={() => setVoiceRoutePreference("bridge_first")}
          />
        </View>
      </View>
      <View style={styles.inlineCard}>
        <Text style={styles.inlineCardTitle}>Speech playback</Text>
        <Text style={styles.subtle}>
          requested {formatExecutionTarget(ttsResolution.requested)} {"->"} active {formatExecutionTarget(ttsResolution.active)}
        </Text>
        {ttsResolution.reason ? <Text style={styles.subtle}>{ttsResolution.reason}</Text> : null}
      </View>
      <Text style={styles.subtle}>
        Policy updated: {executionPolicyUpdatedAt ? new Date(executionPolicyUpdatedAt).toLocaleString() : "local default"}
      </Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={refreshPolicy}>
          <Text style={styles.buttonText}>Refresh policy</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={openIntegrations}>
          <Text style={styles.buttonText}>Open integrations</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

export function ArtifactTriageSection({
  styles,
  loadArtifacts,
  openSelectedArtifactInPwa,
  speakSelectedArtifact,
  selectedArtifact,
  artifactDetailStatus,
  artifactQuickActions,
  runArtifactAction,
  artifacts,
  selectedArtifactId,
  setSelectedArtifactId,
  artifactGraph,
  artifactVersions,
  openTaskInPwa,
  openNoteInPwa,
}: ArtifactTriageSectionProps) {
  return (
    <>
      <Text style={styles.opsSectionTitle}>Library detail</Text>
      <Text style={styles.subtle}>{MOBILE_SUPPORT_PANEL_COPY.libraryDetail.description}</Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={loadArtifacts}>
          <Text style={styles.buttonText}>Refresh library</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={openSelectedArtifactInPwa}>
          <Text style={styles.buttonText}>{MOBILE_SUPPORT_PANEL_COPY.libraryDetail.openLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={speakSelectedArtifact}>
          <Text style={styles.buttonText}>Speak locally</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtle}>Selected: {selectedArtifact ? `${selectedArtifact.title || selectedArtifact.id}` : "none"}</Text>
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
                {supportArtifactSourceLabel(artifact.source_type)} | {new Date(artifact.created_at).toLocaleString()}
              </Text>
            </TouchableOpacity>
          );
        })
      )}
      {artifactGraph ? (
        <View style={styles.detailCard}>
          <Text style={styles.inlineCardTitle}>Selected artifact detail</Text>
          <Text style={styles.subtle}>
            summaries {artifactGraph.summaries.length} | cards {artifactGraph.cards.length} | tasks {artifactGraph.tasks.length} | notes{" "}
            {artifactGraph.notes.length}
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
              <Text style={styles.subtle}>Task status: {supportStatusLabel(task.status)}</Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.button} onPress={() => openTaskInPwa(task.id)}>
                  <Text style={styles.buttonText}>Open task</Text>
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
                  <Text style={styles.buttonText}>Open in Library</Text>
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
                  {supportActionLabel(action.action)} ({supportStatusLabel(action.status)})
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

export function ReviewSessionSection({
  styles,
  dueCards,
  showAnswer,
  loadDueCards,
  revealAnswer,
  submitReview,
}: ReviewSessionSectionProps) {
  return (
    <>
      <Text style={styles.opsSectionTitle}>Review tools</Text>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={loadDueCards}>
          <Text style={styles.buttonText}>Load due cards</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={revealAnswer}>
          <Text style={styles.buttonText}>Reveal answer</Text>
        </TouchableOpacity>
      </View>
      {dueCards[0] ? (
        <View style={styles.reviewCard}>
          <Text style={styles.subtle}>
            Card type: {supportCardTypeLabel(dueCards[0].card_type)}; due queue: {dueCards.length}
          </Text>
          <Text style={styles.reviewPrompt}>{dueCards[0].prompt}</Text>
          {showAnswer ? <Text style={styles.reviewAnswer}>{dueCards[0].answer}</Text> : null}
          <View style={styles.buttonRow}>
            {[1, 3, 4, 5].map((rating) => (
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

export function DesktopFallbackSection({ styles, pwaBase, setPwaBase, openPwa }: DesktopFallbackSectionProps) {
  return (
    <>
      <Text style={styles.opsSectionTitle}>{MOBILE_SUPPORT_PANEL_COPY.fallback.title}</Text>
      <Text style={styles.label}>{MOBILE_SUPPORT_PANEL_COPY.fallback.label}</Text>
      <TextInput style={styles.input} value={pwaBase} onChangeText={setPwaBase} autoCapitalize="none" />
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={openPwa}>
          <Text style={styles.buttonText}>{MOBILE_SUPPORT_PANEL_COPY.fallback.openLabel}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtle}>{MOBILE_SUPPORT_PANEL_COPY.fallback.helpText}</Text>
      <Text style={styles.mono}>starlog://capture?title=Clip&text=Hello&source_url=https://example.com</Text>
    </>
  );
}

export function BriefingPipelineSection({
  styles,
  palette,
  apiBase,
  setApiBase,
  token,
  setToken,
  briefingDate,
  setBriefingDate,
  alarmHour,
  setAlarmHour,
  alarmMinute,
  setAlarmMinute,
  boundedInt,
  briefingPlaybackStatus,
  briefingPlaybackPreference,
  setBriefingPlaybackPreference,
  generateAndCache,
  queueBriefingAudio,
  playBriefing,
  scheduleMorningAlarm,
  clearMorningAlarm,
  notificationPermission,
  cachedPath,
  alarmNotificationId,
  toHourMinuteLabel,
  status,
}: BriefingPipelineSectionProps) {
  return (
    <>
      <Text style={styles.opsSectionTitle}>Briefing setup</Text>
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
      <TextInput style={styles.input} value={token} onChangeText={setToken} autoCapitalize="none" secureTextEntry />
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
      <View style={styles.inlineCard}>
        <Text style={styles.inlineCardTitle}>Playback route</Text>
        <Text style={styles.subtle}>{briefingPlaybackStatus}</Text>
        <View style={styles.opsChipRow}>
          <MobileOpsChip
            styles={styles}
            label="Offline first"
            active={briefingPlaybackPreference === "offline_first"}
            onPress={() => setBriefingPlaybackPreference("offline_first")}
          />
          <MobileOpsChip
            styles={styles}
            label="Refresh + cache"
            active={briefingPlaybackPreference === "refresh_then_cache"}
            onPress={() => setBriefingPlaybackPreference("refresh_then_cache")}
          />
        </View>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={generateAndCache}>
          <Text style={styles.buttonText}>Cache briefing</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={queueBriefingAudio}>
          <Text style={styles.buttonText}>Queue audio render</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={playBriefing}>
          <Text style={styles.buttonText}>Play briefing</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={scheduleMorningAlarm}>
          <Text style={styles.buttonText}>Schedule daily alarm</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={clearMorningAlarm}>
          <Text style={styles.buttonText}>Clear alarm</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtle}>Notification permission: {notificationPermission}</Text>
      <Text style={styles.subtle}>Cached file: {cachedPath ?? "none"}</Text>
      <Text style={styles.subtle}>{briefingPlaybackStatus}</Text>
      <Text style={styles.subtle}>
        Alarm status: {alarmNotificationId ? `scheduled at ${toHourMinuteLabel(alarmHour, alarmMinute)}` : "not scheduled"}
      </Text>
      <Text style={styles.subtle}>{status}</Text>
    </>
  );
}

export function AssistantToolsSection({
  styles,
  palette,
  assistantCommand,
  setAssistantCommand,
  assistantExampleCommands,
  runAssistantPlan,
  runAssistantExecute,
  queueAssistantPlan,
  queueAssistantExecute,
  openAssistantInPwa,
  sttUsesOnDevice,
  localSttListening,
  submitLocalVoiceAssistantPlan,
  submitLocalVoiceAssistantExecute,
  refreshLocalSttAvailability,
  voiceRecording,
  voiceClipTarget,
  startAssistantVoiceRecording,
  stopVoiceRecording,
  submitVoiceAssistantPlan,
  submitVoiceAssistantExecute,
  refreshAssistantThread,
  resetConversationSession,
  localSttLabel,
  voiceCommandStatus,
  conversationTitle,
  conversationSessionState,
  conversationMessages,
  conversationToolTraces,
  lastConversationReset,
  visibleConversationMessages,
  hiddenConversationMessageCount,
  showFullConversationThread,
  setShowFullConversationThread,
  expandedThreadCards,
  setExpandedThreadCards,
  expandedThreadTraces,
  setExpandedThreadTraces,
  cardMetaText,
  summarizeTraceValue,
  threadMessagesLength,
  defaultVisibleMessages,
  showDiagnostics,
  toggleDiagnostics,
  assistantHistory,
  assistantVoiceJobs,
  assistantAiJobs,
}: AssistantToolsSectionProps) {
  return (
    <>
      <Text style={styles.opsSectionTitle}>Assistant tools</Text>
      <Text style={styles.subtle}>{MOBILE_SUPPORT_PANEL_COPY.assistant.description}</Text>
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
          <TouchableOpacity key={example} style={styles.chip} activeOpacity={0.8} onPress={() => setAssistantCommand(example)}>
            <Text style={styles.chipText}>{example}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={runAssistantPlan}>
          <Text style={styles.buttonText}>Plan command</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={runAssistantExecute}>
          <Text style={styles.buttonText}>Execute command</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={queueAssistantPlan}>
          <Text style={styles.buttonText}>{MOBILE_SUPPORT_PANEL_COPY.assistant.queuePlanLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={queueAssistantExecute}>
          <Text style={styles.buttonText}>{MOBILE_SUPPORT_PANEL_COPY.assistant.queueRunLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={openAssistantInPwa}>
          <Text style={styles.buttonText}>{MOBILE_SUPPORT_PANEL_COPY.assistant.openDesktopLabel}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.buttonRow}>
        {sttUsesOnDevice ? (
          <>
            <TouchableOpacity style={styles.button} onPress={submitLocalVoiceAssistantPlan}>
              <Text style={styles.buttonText}>{localSttListening ? "Listening..." : "Listen & plan"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={submitLocalVoiceAssistantExecute}>
              <Text style={styles.buttonText}>{localSttListening ? "Listening..." : "Listen & execute"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={refreshLocalSttAvailability}>
              <Text style={styles.buttonText}>Refresh STT</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.button}
              onPress={voiceRecording && voiceClipTarget === "assistant" ? stopVoiceRecording : startAssistantVoiceRecording}
            >
              <Text style={styles.buttonText}>
                {voiceRecording && voiceClipTarget === "assistant" ? "Stop voice command" : "Start voice command"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={submitVoiceAssistantPlan}>
              <Text style={styles.buttonText}>Plan voice command</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={submitVoiceAssistantExecute}>
              <Text style={styles.buttonText}>Execute voice</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={styles.button} onPress={refreshAssistantThread}>
          <Text style={styles.buttonText}>{MOBILE_SUPPORT_PANEL_COPY.assistant.refreshThreadLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={resetConversationSession}>
          <Text style={styles.buttonText}>{MOBILE_SUPPORT_PANEL_COPY.assistant.resetSessionLabel}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtle}>On-device STT: {localSttLabel}</Text>
      <Text style={styles.subtle}>{voiceCommandStatus}</Text>
      <View style={styles.detailCard}>
        <Text style={styles.inlineCardTitle}>{conversationTitle}</Text>
        <Text style={styles.subtle}>
          {Object.keys(conversationSessionState).length} live session keys | {conversationMessages.length} messages | {conversationToolTraces.length} traces
        </Text>
        <Text style={styles.subtle}>
          Reset clears only short-term thread state. The transcript and runtime trace history stay attached for rereading.
        </Text>
        {lastConversationReset ? (
          <View style={styles.inlineCard}>
            <Text style={styles.inlineCardTitle}>Last reset</Text>
            <Text style={styles.subtle}>
              {(lastConversationReset.cleared_keys ?? []).length > 0
                ? `Cleared ${(lastConversationReset.cleared_keys ?? []).join(", ")}`
                : "No session keys needed clearing."}
            </Text>
          </View>
        ) : null}
        {visibleConversationMessages.length === 0 ? (
          <Text style={styles.subtle}>No persistent thread messages loaded yet.</Text>
        ) : (
          <>
            {hiddenConversationMessageCount > 0 ? (
              <View style={styles.inlineCard}>
                <Text style={styles.inlineCardTitle}>Earlier thread context is available</Text>
                <Text style={styles.subtle}>
                  {hiddenConversationMessageCount} older message{hiddenConversationMessageCount === 1 ? "" : "s"} are hidden from the compact view.
                </Text>
                <View style={styles.buttonRow}>
                  <TouchableOpacity style={styles.button} onPress={() => setShowFullConversationThread(true)}>
                    <Text style={styles.buttonText}>Show full thread</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {visibleConversationMessages.map((message) => {
              const messageTraces = conversationToolTraces.filter((trace) => trace.message_id === message.id);
              const body = message.content.trim() || message.metadata?.assistant_command?.summary || "No message body recorded.";
              const cardsExpanded = expandedThreadCards[message.id] ?? false;
              const tracesExpanded = expandedThreadTraces[message.id] ?? false;
              return (
                <View key={message.id} style={styles.threadMessageCard}>
                  <View style={styles.threadMessageMeta}>
                    <Text style={styles.threadRoleChip}>{message.role}</Text>
                    <Text style={styles.subtle}>{new Date(message.created_at).toLocaleTimeString()}</Text>
                  </View>
                  <Text style={styles.threadMessageBody}>{body}</Text>
                  {message.cards.length > 0 ? (
                    <View style={styles.inlineCard}>
                      <View style={styles.threadDetailHeader}>
                        <Text style={styles.inlineCardTitle}>Attached cards</Text>
                        <TouchableOpacity
                          style={styles.threadDetailToggle}
                          onPress={() =>
                            setExpandedThreadCards((previous) => ({
                              ...previous,
                              [message.id]: !cardsExpanded,
                            }))
                          }
                        >
                          <Text style={styles.threadDetailToggleText}>
                            {cardsExpanded ? "Collapse" : "Expand"} {message.cards.length}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {message.cards.map((card, index) => (
                        <View key={`${message.id}-card-${index}`} style={styles.threadDetailRow}>
                          <Text style={styles.threadDetailTitle}>{card.title || supportMachineLabel(card.kind, "Card")}</Text>
                          <Text style={styles.threadDetailMeta}>{cardMetaText(card)}</Text>
                          {cardsExpanded && card.body ? <Text style={styles.subtle}>{card.body}</Text> : null}
                          {cardsExpanded && card.metadata && Object.keys(card.metadata).length > 0 ? (
                            <Text style={styles.mono}>{JSON.stringify(card.metadata, null, 2)}</Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {messageTraces.length > 0 ? (
                    <View style={styles.inlineCard}>
                      <View style={styles.threadDetailHeader}>
                        <Text style={styles.inlineCardTitle}>Runtime traces</Text>
                        <TouchableOpacity
                          style={styles.threadDetailToggle}
                          onPress={() =>
                            setExpandedThreadTraces((previous) => ({
                              ...previous,
                              [message.id]: !tracesExpanded,
                            }))
                          }
                        >
                          <Text style={styles.threadDetailToggleText}>
                            {tracesExpanded ? "Collapse" : "Expand"} {messageTraces.length}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {messageTraces.map((trace) => (
                        <View key={trace.id} style={styles.threadDetailRow}>
                          <Text style={styles.threadDetailTitle}>{supportToolLabel(trace.tool_name)}</Text>
                          <Text style={styles.threadDetailMeta}>Status: {supportStatusLabel(trace.status)}</Text>
                          <Text style={styles.subtle}>{summarizeTraceValue(trace.result)}</Text>
                          {tracesExpanded && Object.keys(trace.arguments).length > 0 ? (
                            <Text style={styles.mono}>{JSON.stringify(trace.arguments, null, 2)}</Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {message.metadata?.assistant_command ? (
                    <View style={styles.inlineCard}>
                      <Text style={styles.inlineCardTitle}>
                        {supportCommandLabel(message.metadata.assistant_command.matched_intent)}: {supportStatusLabel(message.metadata.assistant_command.status)}
                      </Text>
                      <Text style={styles.subtle}>{message.metadata.assistant_command.summary}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
            {showFullConversationThread && threadMessagesLength > defaultVisibleMessages ? (
              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.button} onPress={() => setShowFullConversationThread(false)}>
                  <Text style={styles.buttonText}>Collapse thread</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={toggleDiagnostics}>
          <Text style={styles.buttonText}>{showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}</Text>
        </TouchableOpacity>
      </View>
      {showDiagnostics ? (
        <>
          {assistantHistory[0] ? (
            <View style={styles.detailCard}>
              <Text style={styles.inlineCardTitle}>
                Latest: {supportCommandLabel(assistantHistory[0].matched_intent)}: {supportStatusLabel(assistantHistory[0].status)}
              </Text>
              <Text style={styles.subtle}>{assistantHistory[0].summary}</Text>
              {assistantHistory[0].steps.map((step, index) => (
                <View key={`${step.tool_name}-${index}`} style={styles.inlineCard}>
                  <Text style={styles.inlineCardTitle}>
                    {supportToolLabel(step.tool_name)}: {supportStatusLabel(step.status)}
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
                    Voice job {job.id}: {supportStatusLabel(job.status)}
                  </Text>
                  <Text style={styles.subtle}>
                    Provider: {supportProviderLabel(job.provider_used || job.provider_hint)} | {new Date(job.created_at).toLocaleString()}
                  </Text>
                  {job.output.transcript ? <Text style={styles.subtle}>Transcript: {job.output.transcript}</Text> : null}
                  {job.output.assistant_command ? (
                    <Text style={styles.subtle}>
                      Command result: {supportCommandLabel(job.output.assistant_command.matched_intent)}: {supportStatusLabel(job.output.assistant_command.status)}
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
                    Codex job {job.id}: {supportStatusLabel(job.status)}
                  </Text>
                  <Text style={styles.subtle}>
                    Provider: {supportProviderLabel(job.provider_used || job.provider_hint)} | {new Date(job.created_at).toLocaleString()}
                  </Text>
                  {typeof job.payload.command === "string" && job.payload.command ? (
                    <Text style={styles.subtle}>Command: {job.payload.command}</Text>
                  ) : null}
                  {job.output.assistant_command ? (
                    <Text style={styles.subtle}>
                      Command result: {supportCommandLabel(job.output.assistant_command.matched_intent)}: {supportStatusLabel(job.output.assistant_command.status)}
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
