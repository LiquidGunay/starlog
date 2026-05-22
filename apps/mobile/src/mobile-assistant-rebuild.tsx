import { type ComponentProps, useEffect, useMemo, useState } from "react";
import type {
  AssistantAmbientUpdate,
  AssistantAttachment,
  AssistantCard as ConversationCard,
  AssistantCardAction,
  AssistantEntityRef,
  AssistantInterrupt,
  AssistantInterruptField,
  AssistantThreadMessage,
  AssistantThreadSnapshot,
  AssistantToolCall,
  AssistantToolResult,
} from "@starlog/contracts";
import { productCopy } from "@starlog/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ScrollView, Switch, Text as RNText, TextInput as RNTextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";

import { mobileConversationCardLabel } from "./conversation-cards";
import {
  assistantToolDisplayLabel,
  attachmentActionLabel,
  summarizeOutput,
  supportSurfaceActionLabel,
  toolStatusSummary,
} from "./assistant-mobile-ui";
import {
  activePendingInterruptId,
  defaultPanelValues,
  fieldSummary,
  fieldValue,
  MOBILE_PANEL_ACTION_LAYOUT,
  MOBILE_PANEL_OPTION_LAYOUT,
  mobileAssistantPanelLayout,
  mobileAssistantPromptChips,
  mobileCaptureTriagePreview,
  mobileClarificationPreview,
  mobileDynamicPanelStates,
  mobileEntityPickerPreview,
  mobilePanelFields,
  mobilePanelSecondaryAction,
  mobilePanelSubmitValues,
  mobilePlannerConflictPreview,
  mobilePanelOptionViewModels,
  mobileReviewGradePreview,
  mobileTaskDetailPreview,
  panelDismissPayload,
  panelKicker,
  panelSubmitPayload,
  panelTone,
  isCaptureTriagePanel,
  isClarificationPanel,
  isDeferPanel,
  isEntityPickerPanel,
  isReviewGradePanel,
  isTaskDetailPanel,
  selectedValueLabel,
  visibleContextChips,
  type PanelTone,
} from "./mobile-assistant-panel-state";
import { MobileDynamicPanelHost } from "./mobile-dynamic-panel-host";
import {
  buildMobileAssistantWeeklyMicroSignal,
  buildMobileAssistantTodayViewModel,
  resolveMobileAssistantMorningFocusAction,
  type MobileAssistantTodayAction,
  type MobileAssistantTodaySummary,
  type MobileAssistantWeeklySummary,
} from "./mobile-assistant-today-view-model";
import {
  isDiagnosticAssistantToolCall,
  isDiagnosticAssistantToolResult,
  mobileDynamicPanelInterruptsFromStarlogMessage,
  mobileNativeDynamicPanelPartIdsFromStarlogMessage,
} from "./mobile-assistant-aui-adapter";
import { MobileAssistantUiComposerBridge, MobileAssistantUiShell } from "./mobile-assistant-aui-thread";

const DIAGNOSTIC_CARD_KINDS = new Set(["thread_context", "tool_step"]);
const ASSISTANT_TEXT_PROPS = { maxFontSizeMultiplier: 1.08 } as const;
const ASSISTANT_TIGHT_TEXT_PROPS = { maxFontSizeMultiplier: 1 } as const;

function Text({ maxFontSizeMultiplier = ASSISTANT_TEXT_PROPS.maxFontSizeMultiplier, ...props }: ComponentProps<typeof RNText>) {
  return <RNText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />;
}

function TextInput({
  maxFontSizeMultiplier = ASSISTANT_TEXT_PROPS.maxFontSizeMultiplier,
  ...props
}: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />;
}

const ATTACHMENT_KIND_LABELS: Record<string, string> = {
  artifact: "Artifact",
  audio: "Audio",
  citation: "Source",
  image: "Image",
};

function assistantMachineLabel(value?: string | null, fallback = "Attachment"): string {
  const normalized = value?.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function attachmentKindLabel(kind?: string | null): string {
  const key = kind?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  return ATTACHMENT_KIND_LABELS[key] ?? assistantMachineLabel(kind);
}

function mobileClientTimezone(): string | null {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : null;
  } catch {
    return null;
  }
}

function mobileInterruptSubmitValues(interrupt: AssistantInterrupt, values: Record<string, unknown>): Record<string, unknown> {
  const panelValues = mobilePanelSubmitValues(interrupt, values);
  if (!isTaskDetailPanel(interrupt) || !String(panelValues.due_date ?? "").trim() || String(panelValues.client_timezone ?? "").trim()) {
    return panelValues;
  }
  const clientTimezone = mobileClientTimezone();
  return clientTimezone ? { ...panelValues, client_timezone: clientTimezone } : panelValues;
}

const MORNING_FOCUS_OPTIONS = [
  {
    key: "project",
    label: "Move project forward",
    body: "Make visible progress on a priority project.",
    icon: "trending-up",
    prompt: "Help me plan my next block around moving a priority project forward.",
  },
  {
    key: "friction",
    label: "Clear system friction",
    body: "Reduce blockers and context switching.",
    icon: "sync",
    prompt: "Help me plan my next block around clearing system friction.",
  },
  {
    key: "learning",
    label: "Maintain learning",
    body: "Review or practice important material.",
    icon: "book-open-page-variant-outline",
    prompt: "Help me plan my next block around review or learning.",
  },
] as const;

type MobileAssistantRebuildProps = {
  styles: Record<string, any>;
  palette: Record<string, string>;
  pendingConversationTurn: boolean;
  homeDraft: string;
  setHomeDraft: (value: string) => void;
  runAssistantTurn: (commandOverride?: string) => void;
  onVoiceAction: () => void;
  onCancelVoiceAction: () => void;
  voiceActionState: "idle" | "listening" | "recording" | "ready";
  voiceActionHint?: string | null;
  refreshThread: () => void;
  resetConversationSession: () => void;
  threadSnapshot: AssistantThreadSnapshot | null;
  visibleThreadMessages: AssistantThreadMessage[];
  hiddenThreadMessageCount: number;
  previewCommandFlow: () => void;
  formatCardMeta: (card: ConversationCard) => string;
  onCardAction: (action: AssistantCardAction, card: ConversationCard) => void;
  onInterruptSubmit: (interruptId: string, values: Record<string, unknown>) => void;
  onInterruptDismiss: (interruptId: string) => void;
  reuseCardText: (value: string) => void;
  onOpenEntityRef: (entityRef: AssistantEntityRef) => void;
  onOpenAttachment: (url: string | null | undefined, label: string) => void;
  assistantTodaySummary?: MobileAssistantTodaySummary | null;
  assistantWeeklySummary?: MobileAssistantWeeklySummary | null;
  onAssistantTodayAction: (action: MobileAssistantTodayAction) => void;
};

export function mobileAssistantMicDisabled(options: {
  pendingConversationTurn: boolean;
  voiceActionState: MobileAssistantRebuildProps["voiceActionState"];
}): boolean {
  return options.pendingConversationTurn && options.voiceActionState !== "listening";
}

function bodyLines(body?: string | null): string[] {
  return (body || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function dateInputValue(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compactMeta(meta: string): string {
  return meta.replace(/^v\d+(?:\s*·\s*)?/i, "").trim();
}

function cardTone(kind: string, palette: Record<string, string>) {
  if (kind === "knowledge_note") {
    return {
      border: "rgba(157, 185, 222, 0.22)",
      bg: palette.surfaceLow,
      accent: palette.secondary,
      accentBg: "rgba(157, 185, 222, 0.12)",
    };
  }
  if (kind === "task_list") {
    return {
      border: "rgba(211, 181, 107, 0.22)",
      bg: palette.surfaceLow,
      accent: palette.tertiary,
      accentBg: "rgba(211, 181, 107, 0.12)",
    };
  }
  return {
    border: palette.border,
    bg: palette.surfaceLow,
    accent: palette.accent,
    accentBg: palette.accentMuted,
  };
}

function isDiagnosticConversationCard(card: ConversationCard): boolean {
  return DIAGNOSTIC_CARD_KINDS.has(card.kind);
}

function diagnosticConversationCardSummary(card: ConversationCard): { label: string; body: string } {
  if (card.kind === "thread_context") {
    return {
      label: "Context details",
      body: "Assistant context was refreshed for this turn.",
    };
  }
  if (card.kind === "tool_step") {
    return {
      label: "Run details",
      body: "Assistant run metadata is available.",
    };
  }
  return {
    label: "Details",
    body: "Additional assistant details are available.",
  };
}

function cardParts(message: AssistantThreadMessage) {
  return message.parts.filter((part): part is Extract<AssistantThreadMessage["parts"][number], { type: "card" }> => part.type === "card");
}

function ambientParts(message: AssistantThreadMessage) {
  return message.parts.filter(
    (part): part is Extract<AssistantThreadMessage["parts"][number], { type: "ambient_update" }> => part.type === "ambient_update",
  );
}

function attachmentParts(message: AssistantThreadMessage) {
  return message.parts.filter(
    (part): part is Extract<AssistantThreadMessage["parts"][number], { type: "attachment" }> => part.type === "attachment",
  );
}

function toolCallParts(message: AssistantThreadMessage) {
  return message.parts.filter(
    (part): part is Extract<AssistantThreadMessage["parts"][number], { type: "tool_call" }> => part.type === "tool_call",
  );
}

function toolResultParts(message: AssistantThreadMessage) {
  return message.parts.filter(
    (part): part is Extract<AssistantThreadMessage["parts"][number], { type: "tool_result" }> => part.type === "tool_result",
  );
}

function interruptRequestParts(message: AssistantThreadMessage) {
  return message.parts.filter(
    (part): part is Extract<AssistantThreadMessage["parts"][number], { type: "interrupt_request" }> => part.type === "interrupt_request",
  );
}

function interruptResolutionParts(message: AssistantThreadMessage) {
  return message.parts.filter(
    (part): part is Extract<AssistantThreadMessage["parts"][number], { type: "interrupt_resolution" }> =>
      part.type === "interrupt_resolution",
  );
}

function previewSuggestions(messages: AssistantThreadMessage[], interrupts: AssistantInterrupt[]): string[] {
  const labels = messages
    .flatMap((message) => cardParts(message))
    .flatMap((part) => part.card.actions.map((action) => action.label))
    .slice(-2);
  if (labels.length > 0) {
    return labels;
  }
  const pendingInterrupt = interrupts.find((interrupt) => interrupt.status === "pending");
  if (pendingInterrupt) {
    return [pendingInterrupt.primary_label, pendingInterrupt.secondary_label || "Handle later"].filter(Boolean) as string[];
  }
  return ["Summarize latest artifact", "Ask follow-up"];
}

function attachmentPreview(
  card: ConversationCard,
  palette: Record<string, string>,
  revealActive: boolean,
) {
  const lines = bodyLines(card.body);
  const metadata = card.metadata ?? {};
  const reviewAnswer = typeof metadata.answer === "string" ? metadata.answer.trim() : "";

  if (card.kind === "review_queue") {
    return (
      <View style={{ gap: 8 }}>
        {card.body ? <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{card.body}</Text> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {["Again", "Good", "Reveal"].map((label) => (
            <View
              key={label}
              style={{
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 6,
                backgroundColor: "rgba(255,255,255,0.035)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.05)",
              }}
            >
              <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800" }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
        {reviewAnswer ? (
          <Text style={{ color: palette.text, fontSize: 13, lineHeight: 19 }}>
            {revealActive ? reviewAnswer : "Tap reveal to inspect the answer before rating."}
          </Text>
        ) : null}
      </View>
    );
  }

  if (card.kind === "task_list" && lines.length > 0) {
    return (
      <View style={{ gap: 7 }}>
        {lines.slice(0, 4).map((line) => (
          <View key={line} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                marginTop: 6,
                backgroundColor: palette.accent,
              }}
            />
            <Text style={{ flex: 1, color: palette.text, fontSize: 13, lineHeight: 19 }}>
              {line.replace(/^[-*]\s*/, "")}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  if (card.kind === "knowledge_note") {
    return (
      <View style={{ gap: 8 }}>
        {card.body ? <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{card.body}</Text> : null}
        {lines[0] ? (
          <View style={{ borderLeftWidth: 1, borderLeftColor: "rgba(151, 188, 255, 0.24)", paddingLeft: 10 }}>
            <Text style={{ color: palette.text, fontSize: 13, lineHeight: 19 }}>{lines[0]}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>
      {card.body || "No detail available."}
    </Text>
  );
}

function interruptDetail(interrupt: AssistantInterrupt): string {
  const resolution = interrupt.resolution;
  if (resolution && typeof resolution === "object" && !Array.isArray(resolution)) {
    const values = (resolution as { values?: Record<string, unknown> }).values;
    const choice = values?.resolution ?? values?.focus ?? values?.next_step ?? values?.rating;
    if (typeof choice === "string" && choice.trim()) {
      return choice.replace(/_/g, " ");
    }
  }
  return interrupt.status === "submitted" ? "resolved from another surface" : "no longer pending";
}

function panelAccent(tone: PanelTone, palette: Record<string, string>) {
  if (tone === "focus") {
    return { text: palette.accent, bg: palette.accentMuted, border: palette.border };
  }
  if (tone === "task") {
    return { text: "#f4ddb0", bg: "rgba(243, 207, 122, 0.11)", border: "rgba(243, 207, 122, 0.2)" };
  }
  if (tone === "capture") {
    return { text: "#d9e8ff", bg: "rgba(151, 188, 255, 0.11)", border: "rgba(151, 188, 255, 0.2)" };
  }
  if (tone === "conflict") {
    return { text: "#ffd8dc", bg: "rgba(255, 180, 183, 0.1)", border: "rgba(255, 180, 183, 0.2)" };
  }
  if (tone === "review") {
    return { text: "#d7d4ff", bg: "rgba(178, 168, 255, 0.1)", border: "rgba(178, 168, 255, 0.2)" };
  }
  return { text: palette.accent, bg: palette.accentMuted, border: palette.border };
}

function AttachmentRow({
  attachment,
  palette,
  onOpenAttachment,
}: {
  attachment: AssistantAttachment;
  palette: Record<string, string>;
  onOpenAttachment: (url: string | null | undefined, label: string) => void;
}) {
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.05)",
        backgroundColor: "rgba(255,255,255,0.018)",
        paddingHorizontal: 11,
        paddingVertical: 10,
        gap: 4,
      }}
    >
      <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800" }}>
        {attachmentKindLabel(attachment.kind)}
      </Text>
      <Text style={{ color: palette.text, fontSize: 14, lineHeight: 20 }}>{attachment.label}</Text>
      {attachment.mime_type ? <Text style={{ color: palette.muted, fontSize: 12 }}>{attachment.mime_type}</Text> : null}
      {attachment.url ? (
        <TouchableOpacity
          style={{
            alignSelf: "flex-start",
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: "rgba(255,255,255,0.025)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.05)",
          }}
          onPress={() => onOpenAttachment(attachment.url, attachmentActionLabel(attachment))}
        >
          <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800" }}>
            {attachmentActionLabel(attachment)}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function EntityActionChip({
  entityRef,
  palette,
  onOpenEntityRef,
}: {
  entityRef?: AssistantEntityRef | null;
  palette: Record<string, string>;
  onOpenEntityRef: (entityRef: AssistantEntityRef) => void;
}) {
  if (!entityRef) {
    return null;
  }

  return (
    <TouchableOpacity
      style={{
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: "rgba(255,255,255,0.025)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.05)",
      }}
      onPress={() => onOpenEntityRef(entityRef)}
    >
      <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800" }}>
        {supportSurfaceActionLabel(entityRef)}
      </Text>
    </TouchableOpacity>
  );
}

function ToolCallRow({
  toolCall,
  palette,
}: {
  toolCall: AssistantToolCall;
  palette: Record<string, string>;
}) {
  const argumentRows = summarizeOutput(toolCall.arguments || {});
  return (
    <View
      style={{
        borderRadius: 14,
        paddingHorizontal: 11,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.05)",
        backgroundColor: "rgba(255,255,255,0.018)",
        gap: 6,
      }}
    >
      <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800" }}>
        Assistant step
      </Text>
      <Text style={{ color: palette.text, fontSize: 14, lineHeight: 20, fontWeight: "800" }}>
        {assistantToolDisplayLabel(toolCall.tool_name, toolCall.title)}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>{toolStatusSummary(toolCall)}</Text>
      {argumentRows.map(([key, value]) => (
        <View key={`${toolCall.id}-${key}`} style={{ gap: 2 }}>
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800" }}>
            {assistantMachineLabel(key, "Argument")}
          </Text>
          <Text style={{ color: palette.text, fontSize: 13, lineHeight: 18 }}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function ToolResultRow({
  toolResult,
  palette,
  formatCardMeta,
  onCardAction,
  onOpenEntityRef,
}: {
  toolResult: AssistantToolResult;
  palette: Record<string, string>;
  formatCardMeta: (card: ConversationCard) => string;
  onCardAction: (action: AssistantCardAction, card: ConversationCard) => void;
  onOpenEntityRef: (entityRef: AssistantEntityRef) => void;
}) {
  const card = toolResult.card;
  if (!card) {
    return null;
  }
  const tone = cardTone(card.kind, palette);
  const meta = compactMeta(formatCardMeta(card));
  return (
    <View
      testID={`mobile-tool-result-card-${toolResult.id}`}
      style={{
        borderRadius: 14,
        paddingHorizontal: 11,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.05)",
        backgroundColor: "rgba(255,255,255,0.018)",
        gap: 7,
      }}
    >
      <EntityActionChip entityRef={toolResult.entity_ref} palette={palette} onOpenEntityRef={onOpenEntityRef} />
      <View
        style={{
          borderRadius: 12,
          paddingHorizontal: 10,
          paddingVertical: 9,
          backgroundColor: "rgba(255,255,255,0.02)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.05)",
          gap: 6,
        }}
      >
        <Text style={{ color: tone.accent, fontSize: 9.5, fontWeight: "800" }}>
          {mobileConversationCardLabel(card.kind, card.title)}
        </Text>
        <Text style={{ color: palette.text, fontSize: 13, lineHeight: 18, fontWeight: "800" }}>
          {card.title || mobileConversationCardLabel(card.kind, card.title)}
        </Text>
        {card.body ? <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>{card.body}</Text> : null}
        {meta ? (
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700" }}>
            {meta}
          </Text>
        ) : null}
        <EntityActionChip entityRef={card.entity_ref} palette={palette} onOpenEntityRef={onOpenEntityRef} />
        {card.actions.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
            {card.actions.map((action) => (
              <TouchableOpacity
                key={`${toolResult.id}-${action.id}`}
                testID={`mobile-tool-result-card-action-${toolResult.id}-${action.id}`}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: action.style === "primary" ? tone.accentBg : "rgba(255,255,255,0.03)",
                  borderWidth: 1,
                  borderColor: action.style === "primary" ? tone.border : "rgba(255,255,255,0.05)",
                }}
                onPress={() => onCardAction(action, card)}
              >
                <Text style={{ color: action.style === "primary" ? tone.accent : palette.text, fontSize: 10.5, fontWeight: "800" }}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

function InterruptFieldInput({
  interrupt,
  field,
  values,
  palette,
  accent,
  setValue,
}: {
  interrupt: AssistantInterrupt;
  field: AssistantInterruptField;
  values: Record<string, unknown>;
  palette: Record<string, string>;
  accent?: { text: string; bg: string; border: string };
  setValue: (value: unknown) => void;
}) {
  const dimensions = useWindowDimensions();
  const panelLayout = mobileAssistantPanelLayout(dimensions.width, dimensions.fontScale);

  if (isTaskDetailPanel(interrupt) && field.kind === "date") {
    const current = fieldValue(values, field);
    const quickDates = [
      { label: "Today", value: dateInputValue(0) },
      { label: "Tomorrow", value: dateInputValue(1) },
    ];
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800" }}>
          {field.label}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {quickDates.map((option) => {
            const selected = current === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={option.label}
                style={{
                  minHeight: 40,
                  borderRadius: 13,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  borderWidth: 1,
                  borderColor: selected ? accent?.border || palette.border : "rgba(255,255,255,0.06)",
                  backgroundColor: selected ? accent?.bg || palette.accentMuted : "rgba(255,255,255,0.025)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPress={() => setValue(option.value)}
              >
                <Text style={{ color: selected ? accent?.text || palette.text : palette.text, fontSize: 13.5, fontWeight: "800" }}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TextInput
          value={current}
          onChangeText={setValue}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={palette.muted}
          autoCapitalize="none"
          style={{
            minHeight: 42,
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.05)",
            backgroundColor: "rgba(255,255,255,0.02)",
            color: palette.text,
            fontSize: 14,
            lineHeight: 20,
          }}
        />
      </View>
    );
  }

  if (field.kind === "toggle") {
    return (
      <View
        style={{
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.05)",
          backgroundColor: "rgba(255,255,255,0.02)",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text style={{ flex: 1, color: palette.text, fontSize: 14, lineHeight: 20 }}>{field.label}</Text>
        <Switch
          value={Boolean(values[field.id])}
          onValueChange={setValue}
          trackColor={{ true: accent?.text || palette.accent, false: "rgba(255,255,255,0.12)" }}
        />
      </View>
    );
  }

  if (field.kind === "select" || field.kind === "priority" || (field.kind === "entity_search" && field.options && field.options.length > 0)) {
    const options = mobilePanelOptionViewModels(interrupt, field, values);
    const compactChoices =
      isCaptureTriagePanel(interrupt) ||
      isReviewGradePanel(interrupt) ||
      isClarificationPanel(interrupt) ||
      isDeferPanel(interrupt) ||
      isEntityPickerPanel(interrupt) ||
      (isTaskDetailPanel(interrupt) && field.kind === "priority");
    if (compactChoices) {
      return (
        <View style={{ gap: 8 }}>
          <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800" }}>
            {field.label}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {options.map((option) => (
              <TouchableOpacity
                key={`${field.id}-${option.value}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: option.selected }}
                accessibilityLabel={option.label}
                style={{
                  minHeight: 38,
                  maxWidth: "100%",
                  borderRadius: 13,
                  paddingHorizontal: 11,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor: option.selected ? accent?.border || palette.border : "rgba(255,255,255,0.06)",
                  backgroundColor: option.selected ? accent?.bg || palette.accentMuted : "rgba(255,255,255,0.025)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPress={() => setValue(option.value)}
              >
                <Text
                  style={{
                    color: option.selected ? accent?.text || palette.text : palette.text,
                    fontSize: 13,
                    lineHeight: 17,
                    fontWeight: "800",
                    textAlign: "center",
                  }}
                  numberOfLines={2}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {field.kind === "entity_search" ? (
            <TextInput
              value={fieldValue(values, field)}
              onChangeText={setValue}
              placeholder={field.placeholder || "Search or paste project id"}
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              style={{
                minHeight: 42,
                borderRadius: 14,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.05)",
                backgroundColor: "rgba(255,255,255,0.02)",
                color: palette.text,
                fontSize: 14,
                lineHeight: 20,
              }}
            />
          ) : null}
        </View>
      );
    }
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800" }}>
          {field.label}
        </Text>
        <View style={{ gap: 8 }}>
          {options.map((option) => {
            return (
              <TouchableOpacity
                key={`${field.id}-${option.value}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: option.selected }}
                accessibilityLabel={option.label}
                style={{
                  minHeight: MOBILE_PANEL_OPTION_LAYOUT.minHeight,
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 11,
                  borderWidth: 1,
                  borderColor: option.selected ? accent?.border || palette.border : "rgba(255,255,255,0.05)",
                  backgroundColor: option.selected ? accent?.bg || palette.accentMuted : "rgba(255,255,255,0.025)",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 11,
                }}
                onPress={() => setValue(option.value)}
              >
                <View
                  style={{
                    width: MOBILE_PANEL_OPTION_LAYOUT.iconSize,
                    height: MOBILE_PANEL_OPTION_LAYOUT.iconSize,
                    borderRadius: MOBILE_PANEL_OPTION_LAYOUT.iconSize / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: option.selected ? accent?.text || palette.accent : "rgba(255,255,255,0.16)",
                    backgroundColor: option.selected ? accent?.bg || palette.accentMuted : "transparent",
                    flexShrink: 0,
                  }}
                >
                  <MaterialCommunityIcons
                    name={option.selected ? "check" : "circle-outline"}
                    size={15}
                    color={option.selected ? accent?.text || palette.accent : palette.muted}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text
                    style={{
                      color: option.selected ? accent?.text || palette.text : palette.text,
                      fontSize: 15,
                      lineHeight: 20,
                      fontWeight: "800",
                    }}
                    numberOfLines={panelLayout.optionTitleMaxLines}
                  >
                    {option.label}
                  </Text>
                  {option.description ? (
                    <Text
                      style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}
                      numberOfLines={panelLayout.optionDescriptionMaxLines}
                    >
                      {option.description}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  const multiline = field.kind === "textarea";
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800" }}>
        {field.label}
      </Text>
      <TextInput
        value={fieldValue(values, field)}
        onChangeText={setValue}
        placeholder={field.placeholder || ""}
        placeholderTextColor={palette.muted}
        multiline={multiline}
        autoCapitalize="none"
        style={{
          minHeight: multiline ? 92 : 44,
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 12 : 10,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.05)",
          backgroundColor: "rgba(255,255,255,0.02)",
          color: palette.text,
          fontSize: 14,
          lineHeight: 20,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}

function ConsequencePreview({
  interrupt,
  palette,
  accent,
}: {
  interrupt: AssistantInterrupt;
  palette: Record<string, string>;
  accent: { text: string; bg: string; border: string };
}) {
  if (!interrupt.consequence_preview) {
    return null;
  }

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: accent.border,
        backgroundColor: accent.bg,
        paddingHorizontal: 11,
        paddingVertical: 9,
        flexDirection: "row",
        gap: 9,
        alignItems: "flex-start",
      }}
    >
      <MaterialCommunityIcons name={"arrow-decision-outline" as never} size={15} color={accent.text} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: palette.text, fontSize: 12.5, lineHeight: 18 }}>{interrupt.consequence_preview}</Text>
    </View>
  );
}

function TaskDetailMiniPreview({
  interrupt,
  palette,
  accent,
}: {
  interrupt: AssistantInterrupt;
  palette: Record<string, string>;
  accent: { text: string; bg: string; border: string };
}) {
  const preview = mobileTaskDetailPreview(interrupt);
  if (!preview) {
    return null;
  }
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
        backgroundColor: "rgba(255,255,255,0.018)",
        paddingHorizontal: 11,
        paddingVertical: 10,
        flexDirection: "row",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <MaterialCommunityIcons name={"checkbox-marked-circle-outline" as never} size={18} color={accent.text} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ color: palette.text, fontSize: 14.5, lineHeight: 19, fontWeight: "800" }} numberOfLines={2}>
          {preview.title}
        </Text>
        {preview.detail ? (
          <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 17 }} numberOfLines={2}>
            {preview.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function CaptureTriageMiniPreview({
  interrupt,
  palette,
  accent,
}: {
  interrupt: AssistantInterrupt;
  palette: Record<string, string>;
  accent: { text: string; bg: string; border: string };
}) {
  const preview = mobileCaptureTriagePreview(interrupt);
  if (!preview) {
    return null;
  }
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
        backgroundColor: "rgba(255,255,255,0.018)",
        paddingHorizontal: 11,
        paddingVertical: 10,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <MaterialCommunityIcons name={"file-document-outline" as never} size={17} color={accent.text} />
        <Text style={{ flex: 1, minWidth: 0, color: palette.text, fontSize: 14.5, lineHeight: 19, fontWeight: "800" }} numberOfLines={2}>
          {preview.title}
        </Text>
      </View>
      {preview.snippet ? (
        <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 17 }} numberOfLines={3}>
          {preview.snippet}
        </Text>
      ) : null}
      {preview.sourceLabel || preview.capturedAtLabel ? (
        <Text style={{ color: palette.muted, fontSize: 11.5, lineHeight: 16, fontWeight: "700" }} numberOfLines={1}>
          {[preview.sourceLabel, preview.capturedAtLabel].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

function PlannerConflictMiniPreview({
  interrupt,
  palette,
  accent,
}: {
  interrupt: AssistantInterrupt;
  palette: Record<string, string>;
  accent: { text: string; bg: string; border: string };
}) {
  const dimensions = useWindowDimensions();
  const panelLayout = mobileAssistantPanelLayout(dimensions.width, dimensions.fontScale);
  const preview = mobilePlannerConflictPreview(interrupt);
  if (!preview) {
    return null;
  }

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
        backgroundColor: "rgba(255,255,255,0.018)",
        paddingHorizontal: 10,
        paddingVertical: 10,
        gap: 8,
      }}
    >
      {[
        { icon: "brain", title: preview.localTitle, time: preview.localTimeLabel, tone: "#9fd3ff" },
        { icon: "alert-outline", title: preview.overlapLabel, time: preview.overlapTimeLabel, tone: "#ff6f59" },
        { icon: "account-group-outline", title: preview.remoteTitle, time: preview.remoteTimeLabel, tone: "#c8a5ff" },
      ].map((item, index) => (
        <View
          key={`${item.title}-${index}`}
          style={{
            minHeight: 38,
            borderRadius: 12,
            paddingHorizontal: 9,
            paddingVertical: 8,
            backgroundColor: index === 1 ? "rgba(255, 111, 89, 0.1)" : "rgba(255,255,255,0.018)",
            borderWidth: 1,
            borderColor: index === 1 ? "rgba(255, 111, 89, 0.18)" : "rgba(255,255,255,0.045)",
            flexDirection: "row",
            alignItems: "center",
            gap: 9,
          }}
        >
          <MaterialCommunityIcons name={item.icon as never} size={17} color={index === 1 ? "#ff6f59" : item.tone || accent.text} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: index === 1 ? "#ff8a72" : palette.text,
              fontSize: 13.5,
              lineHeight: 18,
              fontWeight: "700",
            }}
            numberOfLines={panelLayout.conflictTitleMaxLines}
          >
            {item.title}
          </Text>
          {item.time ? (
            <Text
              style={{
                flexShrink: 0,
                color: index === 1 ? "#ff8a72" : palette.muted,
                fontSize: 12.5,
                lineHeight: 17,
                fontWeight: "700",
                textAlign: "right",
              }}
              numberOfLines={1}
            >
              {item.time}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function ReviewGradeMiniPreview({
  interrupt,
  values,
  palette,
  accent,
  onSupportAction,
}: {
  interrupt: AssistantInterrupt;
  values: Record<string, unknown>;
  palette: Record<string, string>;
  accent: { text: string; bg: string; border: string };
  onSupportAction: (value: string) => void;
}) {
  const preview = mobileReviewGradePreview(interrupt, values);
  if (!preview) {
    return null;
  }
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
        backgroundColor: "rgba(255,255,255,0.018)",
        paddingHorizontal: 11,
        paddingVertical: 10,
        gap: 8,
      }}
    >
      <Text style={{ color: palette.text, fontSize: 14.5, lineHeight: 20, fontWeight: "800" }}>{preview.prompt}</Text>
      {preview.insight ? <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>{preview.insight}</Text> : null}
      {preview.supportActions.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {preview.supportActions.map((action) => (
            <TouchableOpacity
              key={action.value}
              accessibilityRole="button"
              accessibilityState={{ selected: action.selected }}
              style={{
                minHeight: 36,
                borderRadius: 13,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderWidth: 1,
                borderColor: action.selected ? accent.border : "rgba(255,255,255,0.06)",
                backgroundColor: action.selected ? accent.bg : "rgba(255,255,255,0.025)",
                justifyContent: "center",
              }}
              onPress={() => onSupportAction(action.value)}
            >
              <Text style={{ color: action.selected ? accent.text : palette.text, fontSize: 12.5, lineHeight: 16, fontWeight: "800" }}>
                {action.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ClarificationMiniPreview({
  interrupt,
  palette,
}: {
  interrupt: AssistantInterrupt;
  palette: Record<string, string>;
}) {
  const preview = mobileClarificationPreview(interrupt);
  if (!preview) {
    return null;
  }
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
        backgroundColor: "rgba(255,255,255,0.018)",
        paddingHorizontal: 11,
        paddingVertical: 10,
        gap: 4,
      }}
    >
      <Text style={{ color: palette.text, fontSize: 14.5, lineHeight: 20, fontWeight: "800" }}>{preview.question}</Text>
      {preview.detail ? <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>{preview.detail}</Text> : null}
    </View>
  );
}

function EntityPickerMiniPreview({
  interrupt,
  values,
  palette,
  accent,
}: {
  interrupt: AssistantInterrupt;
  values: Record<string, unknown>;
  palette: Record<string, string>;
  accent: { text: string; bg: string; border: string };
}) {
  const preview = mobileEntityPickerPreview(interrupt, values);
  if (!preview) {
    return null;
  }
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
        backgroundColor: "rgba(255,255,255,0.018)",
        paddingHorizontal: 11,
        paddingVertical: 10,
        gap: 7,
      }}
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <MaterialCommunityIcons name={"source-branch" as never} size={17} color={accent.text} />
        <Text style={{ flex: 1, color: palette.text, fontSize: 14.5, lineHeight: 19, fontWeight: "800" }} numberOfLines={2}>
          {preview.title}
        </Text>
      </View>
      <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>
        Selected project:{" "}
        <Text style={{ color: preview.selectedProjectLabel ? accent.text : palette.text, fontWeight: "800" }}>
          {preview.selectedProjectLabel || "Choose one"}
        </Text>
      </Text>
    </View>
  );
}

function DynamicPanelRenderer({
  interrupt,
  values,
  palette,
  active,
  onValueChange,
  onSubmit,
  onDismiss,
  onOpenEntityRef,
}: {
  interrupt: AssistantInterrupt;
  values: Record<string, unknown>;
  palette: Record<string, string>;
  active: boolean;
  onValueChange: (fieldId: string, value: unknown) => void;
  onSubmit: (valuesOverride?: Record<string, unknown>) => void;
  onDismiss: () => void;
  onOpenEntityRef: (entityRef: AssistantEntityRef) => void;
}) {
  const pending = interrupt.status === "pending";
  const tone = panelTone(interrupt);
  const accent = panelAccent(tone, palette);
  const selectedLabel = selectedValueLabel(interrupt, values);
  const panelFields = mobilePanelFields(interrupt);
  const complexFields = panelFields.filter((field) => field.kind === "entity_search" && (!field.options || field.options.length === 0));
  const visibleFields = isReviewGradePanel(interrupt)
    ? panelFields.filter((field) => field.id !== "support_action" && !/support|help|mode/i.test(field.id))
    : panelFields;
  const dimensions = useWindowDimensions();
  const panelLayout = mobileAssistantPanelLayout(dimensions.width, dimensions.fontScale);
  const secondaryAction = mobilePanelSecondaryAction(interrupt);
  return (
    <View
      style={{
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: pending && active ? accent.border : "rgba(255,255,255,0.055)",
        backgroundColor: pending && active ? "rgba(255,255,255,0.022)" : "rgba(255,255,255,0.012)",
        gap: 11,
      }}
    >
      <View style={{ gap: 5 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              alignSelf: "flex-start",
              borderRadius: 999,
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderWidth: 1,
              borderColor: accent.border,
              backgroundColor: accent.bg,
            }}
          >
            <Text style={{ color: accent.text, fontSize: 9.5, fontWeight: "800" }}>
              {panelKicker(interrupt)}
            </Text>
          </View>
        </View>
        <Text style={{ color: palette.text, fontSize: 17, lineHeight: 23, fontWeight: "800" }}>{interrupt.title}</Text>
        {interrupt.body ? <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{interrupt.body}</Text> : null}
        <EntityActionChip entityRef={interrupt.entity_ref} palette={palette} onOpenEntityRef={onOpenEntityRef} />
      </View>

      <TaskDetailMiniPreview interrupt={interrupt} palette={palette} accent={accent} />
      <CaptureTriageMiniPreview interrupt={interrupt} palette={palette} accent={accent} />
      <PlannerConflictMiniPreview interrupt={interrupt} palette={palette} accent={accent} />
      <ReviewGradeMiniPreview
        interrupt={interrupt}
        values={values}
        palette={palette}
        accent={accent}
        onSupportAction={(value) => onValueChange("support_action", value)}
      />
      <ClarificationMiniPreview interrupt={interrupt} palette={palette} />
      <EntityPickerMiniPreview interrupt={interrupt} values={values} palette={palette} accent={accent} />
      {pending ? (
        <>
          {selectedLabel ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <MaterialCommunityIcons name={"star-four-points-outline" as never} size={14} color={accent.text} />
              <Text style={{ flex: 1, color: palette.muted, fontSize: 12, lineHeight: 17 }}>
                Recommended default: <Text style={{ color: palette.text, fontWeight: "800" }}>{selectedLabel}</Text>
              </Text>
            </View>
          ) : null}

          <View style={{ gap: 10 }}>
            {visibleFields.map((field) => (
              <View key={`${interrupt.id}-${field.id}`} style={{ gap: 5 }}>
                <InterruptFieldInput
                  interrupt={interrupt}
                  field={field}
                  values={values}
                  palette={palette}
                  accent={accent}
                  setValue={(value) => onValueChange(field.id, value)}
                />
                {fieldSummary(field) ? <Text style={{ color: palette.muted, fontSize: 11.5, lineHeight: 16 }}>{fieldSummary(field)}</Text> : null}
              </View>
            ))}
          </View>

          {complexFields.length > 0 ? (
            <View
              style={{
                borderRadius: 14,
                paddingHorizontal: 11,
                paddingVertical: 9,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.05)",
                backgroundColor: "rgba(255,255,255,0.018)",
                gap: 4,
              }}
            >
              <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800" }}>
                More detail
              </Text>
              <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>
                {complexFields.map((field) => field.label).join(", ")} can be narrowed with search.
              </Text>
            </View>
          ) : null}

          <ConsequencePreview interrupt={interrupt} palette={palette} accent={accent} />

          <View style={{ flexDirection: panelLayout.actionDirection, gap: 8, flexWrap: panelLayout.actionWraps ? "wrap" : "nowrap" }}>
            <TouchableOpacity
              accessibilityRole="button"
              testID={`mobile-dynamic-panel-submit-${interrupt.id}`}
              style={{
                flexGrow: 1,
                flexBasis: panelLayout.actionPrimaryBasis,
                minHeight: MOBILE_PANEL_ACTION_LAYOUT.minHeight,
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
                backgroundColor: accent.text,
                alignItems: "center",
                justifyContent: "center",
              }}
              onPress={() => onSubmit()}
            >
              <Text {...ASSISTANT_TIGHT_TEXT_PROPS} style={{ color: palette.onAccent, fontSize: 14, lineHeight: 18, fontWeight: "800", textAlign: "center" }}>
                {interrupt.primary_label}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              testID={`mobile-dynamic-panel-secondary-${interrupt.id}`}
              style={{
                flexGrow: 1,
                flexBasis: panelLayout.actionSecondaryBasis,
                minHeight: MOBILE_PANEL_ACTION_LAYOUT.minHeight,
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.06)",
                backgroundColor: "rgba(255,255,255,0.03)",
                alignItems: "center",
                justifyContent: "center",
              }}
              onPress={() => {
                if (secondaryAction.kind === "open_planner") {
                  onOpenEntityRef(
                    interrupt.entity_ref || {
                      entity_type: "planner_conflict",
                      entity_id: interrupt.id,
                      href: "/planner",
                      title: interrupt.title,
                    },
                  );
                  return;
                }
                if (secondaryAction.kind === "open_library") {
                  onOpenEntityRef(
                    interrupt.entity_ref || {
                      entity_type: "artifact",
                      entity_id: interrupt.id,
                      href: "/library",
                      title: interrupt.title,
                    },
                  );
                  return;
                }
                if (secondaryAction.kind === "submit") {
                  const valuesWithoutDate = { ...values };
                  delete valuesWithoutDate.due_date;
                  onSubmit(valuesWithoutDate);
                  return;
                }
                onDismiss();
              }}
            >
              <Text {...ASSISTANT_TIGHT_TEXT_PROPS} style={{ color: palette.text, fontSize: 14, lineHeight: 18, fontWeight: "700", textAlign: "center" }}>
                {secondaryAction.label}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View
          style={{
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.05)",
            backgroundColor: "rgba(255,255,255,0.02)",
            gap: 4,
          }}
        >
          <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800" }}>
            {interrupt.status === "submitted" ? "Resolved" : "Dismissed"}
          </Text>
          <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{interruptDetail(interrupt)}</Text>
        </View>
      )}
    </View>
  );
}

export function MobileAssistantRebuild({
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
  threadSnapshot,
  visibleThreadMessages,
  hiddenThreadMessageCount,
  previewCommandFlow,
  formatCardMeta,
  onCardAction,
  onInterruptSubmit,
  onInterruptDismiss,
  reuseCardText,
  onOpenEntityRef,
  onOpenAttachment,
  assistantTodaySummary,
  assistantWeeklySummary,
  onAssistantTodayAction,
}: MobileAssistantRebuildProps) {
  const [activeAttachmentByMessage, setActiveAttachmentByMessage] = useState<Record<string, number>>({});
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Record<string, boolean>>({});
  const [revealedReviewCards, setRevealedReviewCards] = useState<Record<string, boolean>>({});
  const [interruptValuesById, setInterruptValuesById] = useState<Record<string, Record<string, unknown>>>({});
  const [selectedFallbackFocus, setSelectedFallbackFocus] = useState<(typeof MORNING_FOCUS_OPTIONS)[number]["key"]>("project");
  const [transcriptScrollRef] = useState<{ current: { scrollToEnd?: (options?: { animated?: boolean }) => void } | null }>(() => ({ current: null }));
  const [transcriptScrollTimeoutRef] = useState<{ current: ReturnType<typeof setTimeout> | null }>(() => ({ current: null }));
  const dimensions = useWindowDimensions();
  const assistantPanelLayout = mobileAssistantPanelLayout(dimensions.width, dimensions.fontScale);

  const liveInterrupts = threadSnapshot?.interrupts ?? [];
  const pendingInterruptScrollKey = useMemo(
    () =>
      liveInterrupts
        .filter((interrupt) => interrupt.status === "pending")
        .map((interrupt) => interrupt.id)
        .join("|"),
    [liveInterrupts],
  );
  const latestVisibleMessageId = visibleThreadMessages[visibleThreadMessages.length - 1]?.id || "";
  const liveInterruptById = useMemo(
    () => Object.fromEntries(liveInterrupts.map((interrupt) => [interrupt.id, interrupt])),
    [liveInterrupts],
  );

  const queueTranscriptScrollToEnd = (animated = true) => {
    if (transcriptScrollTimeoutRef.current) {
      clearTimeout(transcriptScrollTimeoutRef.current);
    }

    transcriptScrollTimeoutRef.current = setTimeout(() => {
      transcriptScrollTimeoutRef.current = null;
      transcriptScrollRef.current?.scrollToEnd?.({ animated });
    }, 32);
  };

  useEffect(() => {
    queueTranscriptScrollToEnd(false);

    return () => {
      if (transcriptScrollTimeoutRef.current) {
        clearTimeout(transcriptScrollTimeoutRef.current);
        transcriptScrollTimeoutRef.current = null;
      }
    };
  }, [latestVisibleMessageId, pendingInterruptScrollKey, visibleThreadMessages.length]);

  useEffect(() => {
    setInterruptValuesById((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const interrupt of liveInterrupts) {
        if (interrupt.status !== "pending" || next[interrupt.id]) {
          continue;
        }
        next[interrupt.id] = defaultPanelValues(interrupt);
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [liveInterrupts]);

  const activePanelId = activePendingInterruptId(liveInterrupts);
  const attachmentCount = useMemo(
    () => visibleThreadMessages.reduce((count, message) => count + cardParts(message).length + attachmentParts(message).length, 0),
    [visibleThreadMessages],
  );
  const suggestionPills = useMemo(
    () => previewSuggestions(visibleThreadMessages, liveInterrupts),
    [liveInterrupts, visibleThreadMessages],
  );
  const contextChips = useMemo(
    () => visibleContextChips(liveInterrupts, attachmentCount, hiddenThreadMessageCount),
    [attachmentCount, hiddenThreadMessageCount, liveInterrupts],
  );
  const panelStates = useMemo(
    () => mobileDynamicPanelStates(liveInterrupts, interruptValuesById),
    [interruptValuesById, liveInterrupts],
  );
  const livePanelStateById = useMemo(() => new Map(panelStates.map((state) => [state.interrupt.id, state])), [panelStates]);
  const panelStatesForHostedInterrupts = (hostedInterrupts: AssistantInterrupt[]) => {
    const fallbackStatesById = new Map(
      mobileDynamicPanelStates(
        hostedInterrupts.filter((interrupt) => !liveInterruptById[interrupt.id]),
        interruptValuesById,
      ).map((state) => [state.interrupt.id, state]),
    );
    return hostedInterrupts
      .map((interrupt) => livePanelStateById.get(interrupt.id) || fallbackStatesById.get(interrupt.id))
      .filter((state): state is ReturnType<typeof mobileDynamicPanelStates>[number] => Boolean(state));
  };

  const voiceLabel =
    voiceActionState === "recording"
      ? "Listening now"
      : voiceActionState === "ready"
        ? "Voice clip ready"
        : voiceActionState === "listening"
          ? "Preparing mic"
          : "Thread ready";

  const voiceIcon =
    voiceActionState === "recording" ? "stop" : voiceActionState === "listening" ? "waveform" : "microphone-outline";
  const voiceMicDisabled = mobileAssistantMicDisabled({ pendingConversationTurn, voiceActionState });
  const showVoiceHint = voiceActionState !== "idle" || Boolean(voiceActionHint);
  const displaySuggestions = useMemo(
    () => mobileAssistantPromptChips(suggestionPills, homeDraft),
    [homeDraft, suggestionPills],
  );
  const todayViewModel = useMemo(
    () => buildMobileAssistantTodayViewModel(assistantTodaySummary),
    [assistantTodaySummary],
  );
  const weeklyMicroSignal = useMemo(
    () => buildMobileAssistantWeeklyMicroSignal(assistantWeeklySummary),
    [assistantWeeklySummary],
  );
  const showFallbackFocusChooser = todayViewModel.isFallbackMorningFocus;
  const selectedFallbackFocusOption =
    MORNING_FOCUS_OPTIONS.find((option) => option.key === selectedFallbackFocus) || MORNING_FOCUS_OPTIONS[0];
  const updateInterruptValue = (interrupt: AssistantInterrupt, fieldId: string, value: unknown) =>
    setInterruptValuesById((previous) => ({
      ...previous,
      [interrupt.id]: {
        ...(previous[interrupt.id] || defaultPanelValues(interrupt)),
        [fieldId]: value,
      },
    }));

  const submitInterrupt = (interrupt: AssistantInterrupt, valuesOverride?: Record<string, unknown>) => {
    const payload = valuesOverride ? { interruptId: interrupt.id, values: valuesOverride } : panelSubmitPayload(interrupt, interruptValuesById);
    onInterruptSubmit(payload.interruptId, mobileInterruptSubmitValues(interrupt, payload.values));
  };

  const dismissInterrupt = (interrupt: AssistantInterrupt) => {
    const payload = panelDismissPayload(interrupt);
    onInterruptDismiss(payload.interruptId);
  };

  const renderDynamicPanel = (interrupt: AssistantInterrupt, values: Record<string, unknown>, onResolve?: () => void) => (
    <DynamicPanelRenderer
      key={interrupt.id}
      interrupt={interrupt}
      values={values}
      palette={palette}
      active={interrupt.id === activePanelId}
      onValueChange={(fieldId, value) => updateInterruptValue(interrupt, fieldId, value)}
      onSubmit={(valuesOverride) => {
        onResolve?.();
        submitInterrupt(interrupt, valuesOverride);
      }}
      onDismiss={() => {
        onResolve?.();
        dismissInterrupt(interrupt);
      }}
      onOpenEntityRef={onOpenEntityRef}
    />
  );

  const assistantComposerChrome = (
    <View
      testID="mobile-assistant-aui-composer-surface"
      style={{
        borderRadius: 16,
        paddingHorizontal: 8,
        paddingTop: 8,
        paddingBottom: 8,
        borderWidth: 1,
        borderColor: pendingConversationTurn ? palette.accent : palette.border,
        backgroundColor: palette.panel,
        gap: 7,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        {showVoiceHint ? (
          <Text style={{ flex: 1, color: palette.muted, fontSize: 10.5, lineHeight: 14, fontWeight: "700" }}>
            {voiceActionHint || voiceLabel}
          </Text>
        ) : (
          <View />
        )}
        <View style={{ flexDirection: "row", gap: 6 }}>
          {[
            { icon: "refresh", action: refreshThread },
            { icon: "eraser-variant", action: resetConversationSession },
          ].map((item) => (
            <TouchableOpacity
              key={item.icon}
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255,255,255,0.018)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.04)",
              }}
              onPress={item.action}
            >
              <MaterialCommunityIcons name={item.icon as never} size={14} color={palette.muted} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={voiceActionState === "listening" ? "Cancel Assistant voice listening" : "Start Assistant voice input"}
          testID="mobile-assistant-voice-action"
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              voiceActionState === "recording"
                ? "rgba(255, 180, 183, 0.16)"
                : voiceActionState === "ready"
                  ? palette.accentMuted
                  : palette.surfaceHigh,
            borderWidth: 1,
            borderColor:
              voiceActionState === "recording"
                ? "rgba(255, 180, 183, 0.18)"
                : voiceActionState === "ready"
                  ? palette.accent
                  : palette.border,
            opacity: voiceMicDisabled ? 0.48 : 1,
          }}
          onPress={onVoiceAction}
          disabled={voiceMicDisabled}
        >
          <MaterialCommunityIcons name={voiceIcon as never} size={17} color={voiceActionState === "recording" ? palette.error : palette.text} />
        </TouchableOpacity>

        {voiceActionState === "ready" ? (
          <TouchableOpacity
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 4,
              backgroundColor: "rgba(255,255,255,0.018)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.04)",
            }}
            onPress={onCancelVoiceAction}
          >
            <MaterialCommunityIcons name={"close" as never} size={14} color={palette.muted} />
          </TouchableOpacity>
        ) : null}

        <View
          style={{
            flex: 1,
            minHeight: 50,
            borderRadius: 14,
            paddingHorizontal: 13,
            paddingTop: 4,
            paddingBottom: 4,
            backgroundColor: "rgba(255,255,255,0.035)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.06)",
          }}
        >
          <MobileAssistantUiComposerBridge
            draft={homeDraft}
            onDraftChange={setHomeDraft}
            onSubmit={runAssistantTurn}
            placeholder={productCopy.assistant.inputPlaceholder}
            placeholderTextColor={palette.muted}
            disabled={pendingConversationTurn}
            inputStyle={{
              minHeight: 32,
              maxHeight: 82,
              color: palette.text,
              fontSize: 15,
              lineHeight: 21,
              paddingVertical: 5,
              paddingHorizontal: 0,
            }}
          />
        </View>

        <TouchableOpacity
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pendingConversationTurn ? "rgba(255,255,255,0.12)" : palette.accent,
          }}
          disabled={pendingConversationTurn}
          onPress={() => runAssistantTurn()}
          accessibilityRole="button"
          accessibilityLabel="Send assistant message"
          testID="assistant-send-message"
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
        >
          <MaterialCommunityIcons name={pendingConversationTurn ? "dots-horizontal" : "arrow-up"} size={19} color={palette.onAccent} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const assistantShellHeight = Math.max(520, dimensions.height - 206);
  const transcriptMaxHeight = Math.max(280, assistantShellHeight - 154);

  return (
    <View
      testID="mobile-assistant-clean-chat"
      style={{
        height: assistantShellHeight,
        alignSelf: "stretch",
        justifyContent: "space-between",
        gap: 10,
        paddingTop: 0,
      }}
    >
      <ScrollView
        ref={transcriptScrollRef as never}
        testID="mobile-assistant-aui-transcript"
        style={{ alignSelf: "stretch", maxHeight: transcriptMaxHeight }}
        contentContainerStyle={{ gap: 12, paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => queueTranscriptScrollToEnd()}
      >
        <MobileAssistantUiShell
              messages={visibleThreadMessages}
              liveInterrupts={liveInterrupts}
              palette={palette}
              pendingConversationTurn={pendingConversationTurn}
              onSendMessage={runAssistantTurn}
              renderDynamicPanelHostForMessage={(interrupts) => (
                <MobileDynamicPanelHost
                  interrupts={interrupts}
                  panelStates={panelStatesForHostedInterrupts(interrupts)}
                  palette={palette}
                  renderPanel={renderDynamicPanel}
                />
              )}
              renderCompatibilityForMessage={(message) => {
                const nativeDynamicPanelIds = new Set(
                  mobileDynamicPanelInterruptsFromStarlogMessage(message, { liveInterrupts }).map((interrupt) => interrupt.id),
                );
                const nativeDynamicPanelPartIds = new Set(mobileNativeDynamicPanelPartIdsFromStarlogMessage(message));
                const cards = cardParts(message)
                  .filter((part) => !nativeDynamicPanelPartIds.has(part.id))
                  .map((part) => part.card);
                const primaryCards = cards.filter((card) => !isDiagnosticConversationCard(card));
                const diagnosticCards = cards.filter(isDiagnosticConversationCard);
                const ambientUpdates = ambientParts(message).map((part) => part.update);
                const attachments = attachmentParts(message).map((part) => part.attachment);
                const allToolCalls = toolCallParts(message).map((part) => part.tool_call);
                const allToolResults = toolResultParts(message).map((part) => part.tool_result);
                const toolCalls = allToolCalls.filter((toolCall) => !isDiagnosticAssistantToolCall(toolCall));
                const toolResults = allToolResults.filter(
                  (toolResult) => !isDiagnosticAssistantToolResult(toolResult) && !nativeDynamicPanelIds.has(toolResult.id),
                );
                const diagnosticToolCount =
                  allToolCalls.filter(isDiagnosticAssistantToolCall).length + allToolResults.filter(isDiagnosticAssistantToolResult).length;
                const interruptRequests = interruptRequestParts(message)
                  .map((part) => liveInterruptById[part.interrupt.id] || part.interrupt)
                  .filter((interrupt) => !nativeDynamicPanelIds.has(interrupt.id));
                const resolutions = interruptResolutionParts(message).map((part) => part.resolution);
                const activeAttachmentIndex = activeAttachmentByMessage[message.id] ?? 0;
                const activeAttachment = primaryCards[activeAttachmentIndex] ?? null;
                const showDiagnostics = Boolean(expandedDiagnostics[message.id]);
                const hasRichMessageContent =
                  primaryCards.length > 0 ||
                  toolResults.some((toolResult) => toolResult.card) ||
                  ambientUpdates.length > 0 ||
                  attachments.length > 0 ||
                  interruptRequests.length > 0;

                if (!hasRichMessageContent) {
                  return null;
                }

                return (
                  <View
                    style={{
                      gap: 8,
                      alignItems: "stretch",
                    }}
                  >
                    {ambientUpdates.length > 0 ? (
                      <View style={{ gap: 8, paddingLeft: 10 }}>
                        {ambientUpdates.map((update: AssistantAmbientUpdate) => (
                          <View
                            key={update.id}
                            style={{
                              borderRadius: 14,
                              borderWidth: 1,
                              borderColor: "rgba(255,255,255,0.05)",
                              backgroundColor: "rgba(255,255,255,0.018)",
                              paddingHorizontal: 12,
                              paddingVertical: 10,
                              gap: 4,
                            }}
                          >
                            <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800" }}>
                              {update.label}
                            </Text>
                            {update.body ? <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{update.body}</Text> : null}
                            <EntityActionChip entityRef={update.entity_ref} palette={palette} onOpenEntityRef={onOpenEntityRef} />
                            {update.actions && update.actions.length > 0 ? (
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
                                {update.actions.map((action) => (
                                  <TouchableOpacity
                                    key={`${update.id}-${action.id}`}
                                    style={{
                                      borderRadius: 999,
                                      paddingHorizontal: 10,
                                      paddingVertical: 6,
                                      backgroundColor: action.style === "primary" ? palette.accentMuted : "rgba(255,255,255,0.03)",
                                      borderWidth: 1,
                                      borderColor: action.style === "primary" ? palette.border : "rgba(255,255,255,0.05)",
                                    }}
                                    onPress={() =>
                                      onCardAction(action, {
                                        kind: "assistant_summary",
                                        version: 1,
                                        title: update.label,
                                        body: update.body || null,
                                        entity_ref: update.entity_ref || null,
                                        actions: update.actions || [],
                                        metadata: update.metadata || {},
                                      })
                                    }
                                  >
                                    <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800" }}>
                                      {action.label}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </ScrollView>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {primaryCards.length > 0 ? (
                      <View style={{ gap: 8, paddingLeft: 10 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
                          {primaryCards.map((card, cardIndex) => {
                            const active = activeAttachmentIndex === cardIndex;
                            const tone = cardTone(card.kind, palette);
                            return (
                              <TouchableOpacity
                                key={`${message.id}-${card.kind}-${cardIndex}`}
                                style={{
                                  borderRadius: 999,
                                  paddingHorizontal: 10,
                                  paddingVertical: 6,
                                  borderWidth: 1,
                                  borderColor: active ? tone.border : "rgba(255,255,255,0.05)",
                                  backgroundColor: active ? tone.accentBg : "rgba(255,255,255,0.018)",
                                }}
                                onPress={() => setActiveAttachmentByMessage((previous) => ({ ...previous, [message.id]: cardIndex }))}
                              >
                                <Text style={{ color: active ? tone.accent : palette.muted, fontSize: 10.5, fontWeight: "800" }}>
                                  {mobileConversationCardLabel(card.kind, card.title)}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>

                        {activeAttachment ? (() => {
                          const tone = cardTone(activeAttachment.kind, palette);
                          const cardKey = `${message.id}-${activeAttachmentIndex}-${activeAttachment.kind}`;
                          const reviewAnswer = typeof activeAttachment.metadata?.answer === "string" ? activeAttachment.metadata.answer.trim() : "";
                          const revealActive = !!revealedReviewCards[cardKey];
                          const reusableText = activeAttachment.body?.trim() || activeAttachment.title?.trim() || "";
                          const meta = compactMeta(formatCardMeta(activeAttachment));
                          return (
                            <View
                              style={{
                                borderRadius: 14,
                                borderWidth: 1,
                                borderColor: "rgba(255,255,255,0.035)",
                                backgroundColor: "rgba(255,255,255,0.012)",
                                paddingHorizontal: 11,
                                paddingVertical: 9,
                                gap: 7,
                              }}
                            >
                              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                                <View style={{ flex: 1, gap: 3 }}>
                                  <Text style={{ color: tone.accent, fontSize: 9.5, fontWeight: "800" }}>
                                    {mobileConversationCardLabel(activeAttachment.kind, activeAttachment.title)}
                                  </Text>
                                  <Text style={{ color: palette.text, fontSize: 14, lineHeight: 19, fontWeight: "800" }}>
                                    {activeAttachment.title || mobileConversationCardLabel(activeAttachment.kind, activeAttachment.title)}
                                  </Text>
                                  {meta ? (
                                    <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700" }}>
                                      {meta}
                                    </Text>
                                  ) : null}
                                </View>
                                <MaterialCommunityIcons
                                  name={(activeAttachment.actions.some((action) => action.kind === "navigate") ? "arrow-top-right" : "sparkles") as never}
                                  size={16}
                                  color={tone.accent}
                                />
                              </View>

                              <EntityActionChip entityRef={activeAttachment.entity_ref} palette={palette} onOpenEntityRef={onOpenEntityRef} />

                              <View
                                style={{
                                  borderLeftWidth: 2,
                                  borderLeftColor: tone.border,
                                  paddingLeft: 10,
                                }}
                              >
                                {attachmentPreview(activeAttachment, palette, revealActive)}
                              </View>

                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
                                {activeAttachment.kind === "review_queue" && reviewAnswer ? (
                                  <TouchableOpacity
                                    style={{
                                      borderRadius: 999,
                                      paddingHorizontal: 10,
                                      paddingVertical: 6,
                                      backgroundColor: tone.accentBg,
                                      borderWidth: 1,
                                      borderColor: tone.border,
                                    }}
                                    onPress={() => setRevealedReviewCards((previous) => ({ ...previous, [cardKey]: !previous[cardKey] }))}
                                  >
                                    <Text style={{ color: tone.accent, fontSize: 10.5, fontWeight: "800" }}>
                                      {revealActive ? "Hide answer" : "Reveal"}
                                    </Text>
                                  </TouchableOpacity>
                                ) : null}

                                {activeAttachment.actions.map((action) => (
                                  <TouchableOpacity
                                    key={`${cardKey}-${action.id}`}
                                    style={{
                                      borderRadius: 999,
                                      paddingHorizontal: 10,
                                      paddingVertical: 6,
                                      backgroundColor: action.style === "primary" ? tone.accentBg : "rgba(255,255,255,0.03)",
                                      borderWidth: 1,
                                      borderColor: action.style === "primary" ? tone.border : "rgba(255,255,255,0.05)",
                                    }}
                                    onPress={() => onCardAction(action, activeAttachment)}
                                  >
                                    <Text style={{ color: action.style === "primary" ? tone.accent : palette.text, fontSize: 10.5, fontWeight: "800" }}>
                                      {action.label}
                                    </Text>
                                  </TouchableOpacity>
                                ))}

                                {activeAttachment.actions.length === 0 && reusableText ? (
                                  <TouchableOpacity
                                    style={{
                                      borderRadius: 999,
                                      paddingHorizontal: 10,
                                      paddingVertical: 6,
                                      backgroundColor: "rgba(255,255,255,0.03)",
                                      borderWidth: 1,
                                      borderColor: "rgba(255,255,255,0.05)",
                                    }}
                                    onPress={() => reuseCardText(reusableText)}
                                  >
                                    <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800" }}>
                                      Use in chat
                                    </Text>
                                  </TouchableOpacity>
                                ) : null}
                              </ScrollView>
                            </View>
                          );
                        })() : null}
                      </View>
                    ) : null}

                    {attachments.length > 0 ? (
                      <View style={{ gap: 8, paddingLeft: 10 }}>
                        {attachments.map((attachment) => (
                          <AttachmentRow
                            key={attachment.id}
                            attachment={attachment}
                            palette={palette}
                            onOpenAttachment={onOpenAttachment}
                          />
                        ))}
                      </View>
                    ) : null}

                    {toolResults.some((toolResult) => toolResult.card) ? (
                      <View style={{ gap: 8, paddingLeft: 10 }}>
                        {toolResults.map((toolResult) => (
                          <ToolResultRow
                            key={toolResult.id}
                            toolResult={toolResult}
                            palette={palette}
                            formatCardMeta={formatCardMeta}
                            onCardAction={onCardAction}
                            onOpenEntityRef={onOpenEntityRef}
                          />
                        ))}
                      </View>
                    ) : null}

                    {interruptRequests.length > 0 ? (
                      <MobileDynamicPanelHost
                        interrupts={interruptRequests}
                        panelStates={panelStates}
                        palette={palette}
                        renderPanel={renderDynamicPanel}
                      />
                    ) : null}


                  </View>
                );
              }}
            />
        {visibleThreadMessages.length === 0 ? (
          <View testID="mobile-assistant-empty-thread" style={{ alignItems: "center", gap: 8, paddingTop: 28, paddingHorizontal: 28 }}>
            <MaterialCommunityIcons name="message-outline" size={24} color={palette.accent} />
            <Text style={{ color: palette.text, fontSize: 21, lineHeight: 26, fontWeight: "800", textAlign: "center" }}>
              {productCopy.assistant.emptyTitle}
            </Text>
            <Text style={{ color: palette.muted, fontSize: 14, lineHeight: 21, textAlign: "center" }}>
              {productCopy.assistant.emptyBody}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      {assistantComposerChrome}
    </View>
  );
}
