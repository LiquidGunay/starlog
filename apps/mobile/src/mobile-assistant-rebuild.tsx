import { useEffect, useMemo, useState } from "react";
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
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";

import { mobileConversationCardLabel } from "./conversation-cards";
import {
  attachmentActionLabel,
  summarizeOutput,
  supportSurfaceActionLabel,
  toolResultBadges,
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
  mobileDynamicPanelStates,
  mobilePanelSecondaryAction,
  mobilePlannerConflictPreview,
  mobilePanelOptionViewModels,
  panelDismissPayload,
  panelKicker,
  panelSubmitPayload,
  panelTone,
  selectedValueLabel,
  visibleContextChips,
  type PanelTone,
} from "./mobile-assistant-panel-state";
import {
  buildMobileAssistantWeeklyMicroSignal,
  buildMobileAssistantTodayViewModel,
  resolveMobileAssistantMorningFocusAction,
  type MobileAssistantTodayAction,
  type MobileAssistantTodaySummary,
  type MobileAssistantWeeklySummary,
} from "./mobile-assistant-today-view-model";

const DIAGNOSTIC_CARD_KINDS = new Set(["thread_context", "tool_step"]);

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
  runAssistantTurn: () => void;
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

function bodyLines(body?: string | null): string[] {
  return (body || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function timestampLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function compactMeta(meta: string): string {
  return meta.replace(/^v\d+(?:\s*·\s*)?/i, "").trim();
}

function cardTone(kind: string, palette: Record<string, string>) {
  if (kind === "review_queue") {
    return {
      border: "rgba(166, 222, 191, 0.18)",
      bg: "rgba(31, 27, 30, 0.92)",
      accent: "#d8f3e2",
      accentBg: "rgba(166, 222, 191, 0.12)",
    };
  }
  if (kind === "knowledge_note") {
    return {
      border: "rgba(151, 188, 255, 0.18)",
      bg: "rgba(29, 28, 33, 0.92)",
      accent: "#d9e8ff",
      accentBg: "rgba(151, 188, 255, 0.12)",
    };
  }
  if (kind === "task_list") {
    return {
      border: "rgba(243, 207, 122, 0.18)",
      bg: "rgba(33, 29, 28, 0.92)",
      accent: "#f4ddb0",
      accentBg: "rgba(243, 207, 122, 0.12)",
    };
  }
  return {
    border: "rgba(241, 182, 205, 0.16)",
    bg: "rgba(38, 25, 32, 0.92)",
    accent: palette.accent,
    accentBg: "rgba(241, 182, 205, 0.1)",
  };
}

function isDiagnosticConversationCard(card: ConversationCard): boolean {
  return DIAGNOSTIC_CARD_KINDS.has(card.kind);
}

function textParts(message: AssistantThreadMessage) {
  return message.parts.filter((part): part is Extract<AssistantThreadMessage["parts"][number], { type: "text" }> => part.type === "text");
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

function statusParts(message: AssistantThreadMessage) {
  return message.parts.filter((part): part is Extract<AssistantThreadMessage["parts"][number], { type: "status" }> => part.type === "status");
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

function assistantMessageText(message: AssistantThreadMessage): string {
  return textParts(message)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
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
              <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
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
    return { text: "#d8f3e2", bg: "rgba(166, 222, 191, 0.11)", border: "rgba(166, 222, 191, 0.2)" };
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
  return { text: palette.accent, bg: "rgba(241, 182, 205, 0.1)", border: "rgba(241, 182, 205, 0.18)" };
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
      <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
        {attachment.kind.replace(/_/g, " ")}
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
          <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
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
      <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
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
      <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
        Tool call
      </Text>
      <Text style={{ color: palette.text, fontSize: 14, lineHeight: 20, fontWeight: "800" }}>
        {toolCall.title || toolCall.tool_name}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>{toolStatusSummary(toolCall)}</Text>
      {argumentRows.map(([key, value]) => (
        <View key={`${toolCall.id}-${key}`} style={{ gap: 2 }}>
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
            {key.replace(/_/g, " ")}
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
  const outputRows = summarizeOutput(toolResult.output || {});
  const badges = toolResultBadges(toolResult);
  return (
    <View
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
      <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
        Tool result
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {badges.map((badge) => (
          <View
            key={`${toolResult.id}-${badge}`}
            style={{
              borderRadius: 999,
              paddingHorizontal: 9,
              paddingVertical: 5,
              backgroundColor: "rgba(255,255,255,0.024)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.05)",
            }}
          >
            <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
              {badge}
            </Text>
          </View>
        ))}
      </View>
      {outputRows.map(([key, value]) => (
        <View key={`${toolResult.id}-${key}`} style={{ gap: 2 }}>
          <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
            {key.replace(/_/g, " ")}
          </Text>
          <Text style={{ color: palette.text, fontSize: 13, lineHeight: 18 }}>{value}</Text>
        </View>
      ))}
      <EntityActionChip entityRef={toolResult.entity_ref} palette={palette} onOpenEntityRef={onOpenEntityRef} />
      {toolResult.card ? (
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
          <Text style={{ color: palette.text, fontSize: 13, lineHeight: 18, fontWeight: "800" }}>
            {toolResult.card.title || mobileConversationCardLabel(toolResult.card.kind, toolResult.card.title)}
          </Text>
          {toolResult.card.body ? <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>{toolResult.card.body}</Text> : null}
          {formatCardMeta(toolResult.card) ? (
            <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.65 }}>
              {compactMeta(formatCardMeta(toolResult.card))}
            </Text>
          ) : null}
          <EntityActionChip entityRef={toolResult.card.entity_ref} palette={palette} onOpenEntityRef={onOpenEntityRef} />
          {toolResult.card.actions.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
              {toolResult.card.actions.map((action) => (
                <TouchableOpacity
                  key={`${toolResult.card?.kind}-${action.id}`}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    backgroundColor: action.style === "primary" ? "rgba(241, 182, 205, 0.12)" : "rgba(255,255,255,0.03)",
                    borderWidth: 1,
                    borderColor: action.style === "primary" ? "rgba(241, 182, 205, 0.18)" : "rgba(255,255,255,0.05)",
                  }}
                  onPress={() => onCardAction(action, toolResult.card!)}
                >
                  <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
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
  const panelLayout = mobileAssistantPanelLayout(useWindowDimensions().width);

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

  if (field.kind === "select" || field.kind === "priority") {
    const options = mobilePanelOptionViewModels(interrupt, field, values);
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
          {field.label}
        </Text>
        <View style={{ gap: 8 }}>
          {options.map((option) => {
            return (
              <TouchableOpacity
                key={`${field.id}-${option.value}`}
                style={{
                  minHeight: MOBILE_PANEL_OPTION_LAYOUT.minHeight,
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 11,
                  borderWidth: 1,
                  borderColor: option.selected ? accent?.border || "rgba(241, 182, 205, 0.18)" : "rgba(255,255,255,0.05)",
                  backgroundColor: option.selected ? accent?.bg || "rgba(241, 182, 205, 0.12)" : "rgba(255,255,255,0.025)",
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
                    backgroundColor: option.selected ? accent?.bg || "rgba(241, 182, 205, 0.12)" : "transparent",
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
      <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
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

function PlannerConflictMiniPreview({
  interrupt,
  palette,
  accent,
}: {
  interrupt: AssistantInterrupt;
  palette: Record<string, string>;
  accent: { text: string; bg: string; border: string };
}) {
  const panelLayout = mobileAssistantPanelLayout(useWindowDimensions().width);
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
  onSubmit: () => void;
  onDismiss: () => void;
  onOpenEntityRef: (entityRef: AssistantEntityRef) => void;
}) {
  const pending = interrupt.status === "pending";
  const tone = panelTone(interrupt);
  const accent = panelAccent(tone, palette);
  const selectedLabel = selectedValueLabel(interrupt, values);
  const complexFields = interrupt.fields.filter((field) => field.kind === "entity_search");
  const panelLayout = mobileAssistantPanelLayout(useWindowDimensions().width);
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
            <Text style={{ color: accent.text, fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
              {panelKicker(interrupt)}
            </Text>
          </View>
        </View>
        <Text style={{ color: palette.text, fontSize: 17, lineHeight: 23, fontWeight: "800" }}>{interrupt.title}</Text>
        {interrupt.body ? <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{interrupt.body}</Text> : null}
        <EntityActionChip entityRef={interrupt.entity_ref} palette={palette} onOpenEntityRef={onOpenEntityRef} />
      </View>

      <PlannerConflictMiniPreview interrupt={interrupt} palette={palette} accent={accent} />

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
            {interrupt.fields.map((field) => (
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
              <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
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
              onPress={onSubmit}
            >
              <Text style={{ color: palette.onAccent, fontSize: 14, lineHeight: 18, fontWeight: "800", textAlign: "center" }}>
                {interrupt.primary_label}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
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
              onPress={onDismiss}
            >
              <Text style={{ color: palette.text, fontSize: 14, lineHeight: 18, fontWeight: "700", textAlign: "center" }}>
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
          <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
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
  const assistantPanelLayout = mobileAssistantPanelLayout(useWindowDimensions().width);

  const liveInterrupts = threadSnapshot?.interrupts ?? [];
  const liveInterruptById = useMemo(
    () => Object.fromEntries(liveInterrupts.map((interrupt) => [interrupt.id, interrupt])),
    [liveInterrupts],
  );

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

  return (
    <View style={{ gap: 16, paddingTop: 4 }}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 11 }}>
            <MaterialCommunityIcons name={"star-four-points" as never} size={31} color={palette.accent} />
            <Text style={{ flexShrink: 1, color: palette.text, fontSize: 24, lineHeight: 30, fontWeight: "800" }} numberOfLines={1}>
              Starlog Assistant
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 0 }}>
            <MaterialCommunityIcons
              name={pendingConversationTurn ? "sync" : "check-circle-outline"}
              size={18}
              color={pendingConversationTurn ? palette.accent : "#5ee079"}
            />
            <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 16, fontWeight: "700" }} numberOfLines={1}>
              {pendingConversationTurn ? "Syncing" : "Synced just now"}
            </Text>
          </View>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pendingConversationTurn ? "rgba(241, 182, 205, 0.1)" : "rgba(255,255,255,0.025)",
              borderWidth: 1,
              borderColor: pendingConversationTurn ? "rgba(241, 182, 205, 0.12)" : "rgba(255,255,255,0.05)",
            }}
          >
            <MaterialCommunityIcons name={"account-outline" as never} size={17} color={palette.accent} />
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
          {contextChips.map((label) => (
            <View
              key={label}
              style={{
                borderRadius: 999,
                paddingHorizontal: 13,
                paddingVertical: 9,
                backgroundColor: label === "Inline panel" || label === "Deep work window" ? "rgba(243, 178, 66, 0.1)" : "rgba(255,255,255,0.025)",
                borderWidth: 1,
                borderColor: label === "Inline panel" || label === "Deep work window" ? "rgba(243, 178, 66, 0.22)" : "rgba(255,255,255,0.07)",
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
              }}
            >
              <MaterialCommunityIcons
                name={(label === "Morning" ? "white-balance-sunny" : label === "Today" ? "calendar-blank-outline" : label === "Work" ? "briefcase-outline" : "target") as never}
                size={15}
                color={label === "Inline panel" || label === "Deep work window" || label === "Morning" ? palette.accent : palette.muted}
              />
              <Text style={{ color: label === "Inline panel" || label === "Deep work window" || label === "Morning" ? palette.text : palette.muted, fontSize: 14, fontWeight: "700" }}>
                {label}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: 16, paddingBottom: 4 }}>
        {visibleThreadMessages.length === 0 ? (
          visibleThreadMessages.length === 0 && todayViewModel ? (
            <View
              style={{
                gap: 12,
              }}
            >
              <View
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "86%",
                  borderRadius: 20,
                  borderBottomRightRadius: 7,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.055)",
                  backgroundColor: "rgba(255,255,255,0.048)",
                }}
              >
                <Text style={{ color: palette.text, fontSize: 15, lineHeight: 22 }} numberOfLines={3}>
                  What should I focus on this morning?
                </Text>
              </View>

              <View
                style={{
                  borderRadius: 20,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.075)",
                  backgroundColor: "rgba(11, 22, 36, 0.74)",
                  gap: 11,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(243, 178, 66, 0.11)",
                      borderWidth: 1,
                      borderColor: "rgba(243, 178, 66, 0.28)",
                    }}
                  >
                    <MaterialCommunityIcons name={"star-four-points" as never} size={17} color={palette.accent} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: palette.accent, fontSize: 13, lineHeight: 17, fontWeight: "800" }} numberOfLines={1}>
                      Starlog Assistant
                    </Text>
                    <Text style={{ color: palette.muted, fontSize: 11.5, lineHeight: 15 }} numberOfLines={1}>
                      {pendingConversationTurn ? "Syncing" : "Synced just now"}
                    </Text>
                  </View>
                </View>

                <Text style={{ color: palette.text, fontSize: 16, lineHeight: 23 }}>
                  Here's what makes the most sense right now.
                </Text>

                <View style={{ gap: 7 }}>
                  {todayViewModel.reasonStack.slice(0, 3).map((reason) => (
                    <View key={reason} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                      <MaterialCommunityIcons name={"check-circle-outline" as never} size={15} color={palette.accent} style={{ marginTop: 2 }} />
                      <Text style={{ flex: 1, color: palette.text, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
                        {reason}
                      </Text>
                    </View>
                  ))}
                </View>

                <View
                  style={{
                    borderRadius: 17,
                    paddingHorizontal: 10,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: "rgba(243, 178, 66, 0.18)",
                    backgroundColor: "rgba(255,255,255,0.02)",
                    gap: 9,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <MaterialCommunityIcons name={"target" as never} size={18} color={palette.accent} />
                    <Text style={{ flex: 1, color: palette.text, fontSize: 17, lineHeight: 22, fontWeight: "800" }} numberOfLines={1}>
                      {todayViewModel.title}
                    </Text>
                  </View>

                  {showFallbackFocusChooser ? (
                    <View style={{ gap: 7 }}>
                      {MORNING_FOCUS_OPTIONS.map((option) => {
                        const selected = selectedFallbackFocus === option.key;
                        return (
                          <TouchableOpacity
                            key={option.key}
                            style={{
                              minHeight: 58,
                              borderRadius: 14,
                              paddingHorizontal: 11,
                              paddingVertical: 10,
                              borderWidth: 1,
                              borderColor: selected ? "rgba(243, 178, 66, 0.78)" : "rgba(255,255,255,0.06)",
                              backgroundColor: selected ? "rgba(243, 178, 66, 0.1)" : "rgba(255,255,255,0.018)",
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 10,
                            }}
                            onPress={() => setSelectedFallbackFocus(option.key)}
                          >
                            <View
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 10,
                                alignItems: "center",
                                justifyContent: "center",
                                borderWidth: 1,
                                borderColor: selected ? "rgba(243, 178, 66, 0.62)" : "rgba(255,255,255,0.09)",
                                backgroundColor: selected ? "rgba(243, 178, 66, 0.12)" : "rgba(255,255,255,0.02)",
                                flexShrink: 0,
                              }}
                            >
                              <MaterialCommunityIcons name={option.icon as never} size={17} color={selected ? palette.accent : palette.muted} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                              <Text style={{ color: palette.text, fontSize: 14.5, lineHeight: 19, fontWeight: "800" }} numberOfLines={1}>
                                {option.label}
                              </Text>
                              <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 17 }} numberOfLines={2}>
                                {option.body}
                              </Text>
                            </View>
                            <MaterialCommunityIcons
                              name={selected ? "check-circle" : "circle-outline"}
                              size={20}
                              color={selected ? palette.accent : palette.muted}
                            />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }} numberOfLines={3}>
                      {todayViewModel.body}
                    </Text>
                  )}

                  <View
                    style={{
                      borderRadius: 13,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.055)",
                      backgroundColor: "rgba(255,255,255,0.018)",
                      flexDirection: "row",
                      gap: 8,
                      alignItems: "flex-start",
                    }}
                  >
                    <MaterialCommunityIcons name={"calendar-blank-outline" as never} size={15} color={palette.muted} style={{ marginTop: 1 }} />
                    <Text style={{ flex: 1, color: palette.muted, fontSize: 12.5, lineHeight: 17 }} numberOfLines={2}>
                      I can draft a focus block; you confirm plan changes.
                    </Text>
                  </View>

                  <View style={{ flexDirection: assistantPanelLayout.actionDirection, gap: 8 }}>
                    <TouchableOpacity
                      style={{
                        flexGrow: 1,
                        flexBasis: assistantPanelLayout.actionPrimaryBasis,
                        minHeight: 44,
                        borderRadius: 14,
                        paddingHorizontal: 12,
                        paddingVertical: 11,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: palette.accent,
                      }}
                      onPress={() =>
                        onAssistantTodayAction(
                          resolveMobileAssistantMorningFocusAction(todayViewModel, selectedFallbackFocusOption.prompt),
                        )
                      }
                    >
                      <Text style={{ color: palette.onAccent, fontSize: 14, lineHeight: 18, fontWeight: "800", textAlign: "center" }}>
                        {todayViewModel.primaryAction.label}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{
                        flexGrow: 1,
                        flexBasis: assistantPanelLayout.actionSecondaryBasis,
                        minHeight: 44,
                        borderRadius: 14,
                        paddingHorizontal: 12,
                        paddingVertical: 11,
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.06)",
                        backgroundColor: "rgba(255,255,255,0.025)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      onPress={() => setHomeDraft("Help me compare focus options for this morning.")}
                    >
                      <Text style={{ color: palette.text, fontSize: 14, lineHeight: 18, fontWeight: "700", textAlign: "center" }}>
                        Adjust options
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {todayViewModel.promptChips.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
                  {todayViewModel.promptChips.map((action) => (
                    <TouchableOpacity
                      key={action.key}
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: 11,
                        paddingVertical: 8,
                        backgroundColor: "rgba(255,255,255,0.025)",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.05)",
                        maxWidth: assistantPanelLayout.promptChipMaxWidth,
                      }}
                      onPress={() => onAssistantTodayAction(action)}
                    >
                      <Text style={{ color: palette.text, fontSize: 13, lineHeight: 17, fontWeight: "700" }} numberOfLines={1}>
                        {action.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : null}

              {weeklyMicroSignal ? (
                <TouchableOpacity
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: "rgba(255,255,255,0.05)",
                    paddingTop: 11,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                  onPress={() => onAssistantTodayAction(weeklyMicroSignal.action)}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(166, 222, 191, 0.1)",
                      borderWidth: 1,
                      borderColor: "rgba(166, 222, 191, 0.16)",
                    }}
                  >
                    <MaterialCommunityIcons name={"calendar-sync-outline" as never} size={15} color="#d8f3e2" />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: palette.text, fontSize: 13, lineHeight: 17, fontWeight: "800" }}>
                      {weeklyMicroSignal.title}
                    </Text>
                    <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 17 }}>
                      {weeklyMicroSignal.reason}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name={"chevron-right" as never} size={18} color={palette.muted} />
                </TouchableOpacity>
              ) : null}

            </View>
          ) : (
            <View style={{ alignItems: "center", gap: 10, paddingTop: 40, paddingHorizontal: 28 }}>
              <MaterialCommunityIcons name="message-outline" size={26} color={palette.accent} />
              <Text style={{ color: palette.text, fontSize: 22, lineHeight: 26, fontWeight: "800", textAlign: "center" }}>
                {productCopy.assistant.emptyTitle}
              </Text>
              <Text style={{ color: palette.muted, fontSize: 14, lineHeight: 21, textAlign: "center" }}>
                {productCopy.assistant.emptyBody}
              </Text>
            </View>
          )
        ) : (
          visibleThreadMessages.map((message, index) => {
            const previousRole = visibleThreadMessages[index - 1]?.role;
            const isUser = message.role === "user";
            const cards = cardParts(message).map((part) => part.card);
            const primaryCards = cards.filter((card) => !isDiagnosticConversationCard(card));
            const diagnosticCards = cards.filter(isDiagnosticConversationCard);
            const ambientUpdates = ambientParts(message).map((part) => part.update);
            const attachments = attachmentParts(message).map((part) => part.attachment);
            const toolCalls = toolCallParts(message).map((part) => part.tool_call);
            const toolResults = toolResultParts(message).map((part) => part.tool_result);
            const statusLabels = statusParts(message).map((part) => part.label || part.status);
            const interruptRequests = interruptRequestParts(message).map((part) => liveInterruptById[part.interrupt.id] || part.interrupt);
            const resolutions = interruptResolutionParts(message).map((part) => part.resolution);
            const activeAttachmentIndex = activeAttachmentByMessage[message.id] ?? 0;
            const activeAttachment = primaryCards[activeAttachmentIndex] ?? null;
            const showMarker =
              (message.role === "assistant" || message.role === "tool" || message.role === "system") && previousRole !== message.role;
            const showDiagnostics = Boolean(expandedDiagnostics[message.id]);
            const content = assistantMessageText(message);

            return (
              <View
                key={message.id}
                style={{
                  gap: 8,
                  alignItems: isUser ? "flex-end" : "stretch",
                  ...(message.role === "assistant"
                    ? {
                        borderRadius: 22,
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.08)",
                        backgroundColor: "rgba(11, 22, 36, 0.74)",
                        paddingHorizontal: 12,
                        paddingVertical: 12,
                      }
                    : null),
                }}
              >
                {showMarker ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 2 }}>
                    <View
                      style={{
                        width: message.role === "assistant" ? 34 : 8,
                        height: message.role === "assistant" ? 34 : 8,
                        borderRadius: 999,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: message.role === "assistant" ? "rgba(243, 178, 66, 0.11)" : palette.accent,
                        borderWidth: message.role === "assistant" ? 1 : 0,
                        borderColor: "rgba(243, 178, 66, 0.28)",
                      }}
                    >
                      {message.role === "assistant" ? (
                        <MaterialCommunityIcons name={"star-four-points" as never} size={18} color={palette.accent} />
                      ) : null}
                    </View>
                    <Text style={{ color: message.role === "assistant" ? palette.accent : palette.muted, fontSize: 13, lineHeight: 18, fontWeight: "800" }}>
                      {message.role === "assistant" ? "Starlog Assistant" : "System"} {timestampLabel(message.created_at) ? `  ${timestampLabel(message.created_at)}` : ""}
                    </Text>
                  </View>
                ) : null}

                {content || isUser || statusLabels.length > 0 ? (
                  <View
                    style={{
                      alignSelf: isUser ? "flex-end" : "stretch",
                      maxWidth: isUser ? "85%" : "100%",
                      paddingHorizontal: isUser ? 15 : 2,
                      paddingVertical: isUser ? 11 : 0,
                      borderRadius: 24,
                      borderBottomRightRadius: isUser ? 8 : 24,
                      borderWidth: isUser ? 1 : 0,
                      borderColor: "rgba(255,255,255,0.05)",
                      backgroundColor: isUser ? "rgba(255,255,255,0.055)" : "transparent",
                      gap: 6,
                    }}
                  >
                    {content ? (
                      <Text style={{ color: palette.text, fontSize: isUser ? 15.5 : 18, lineHeight: isUser ? 23 : 31 }}>
                        {content}
                      </Text>
                    ) : (
                      <Text style={{ color: palette.muted, fontSize: 14, lineHeight: 20 }}>
                        {statusLabels[0] || "Assistant reply in progress..."}
                      </Text>
                    )}
                    {!content && !isUser && statusLabels.length > 1 ? (
                      <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>{statusLabels.slice(1).join(" · ")}</Text>
                    ) : null}
                  </View>
                ) : null}

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
                        <Text style={{ color: palette.text, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
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
                                  backgroundColor: action.style === "primary" ? "rgba(241, 182, 205, 0.12)" : "rgba(255,255,255,0.03)",
                                  borderWidth: 1,
                                  borderColor: action.style === "primary" ? "rgba(241, 182, 205, 0.18)" : "rgba(255,255,255,0.05)",
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
                                <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
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
                            <Text style={{ color: active ? tone.accent : palette.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
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
                              <Text style={{ color: tone.accent, fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                                {mobileConversationCardLabel(activeAttachment.kind, activeAttachment.title)}
                              </Text>
                              <Text style={{ color: palette.text, fontSize: 14, lineHeight: 19, fontWeight: "800" }}>
                                {activeAttachment.title || mobileConversationCardLabel(activeAttachment.kind, activeAttachment.title)}
                              </Text>
                              {meta ? (
                                <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.65 }}>
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
                                <Text style={{ color: tone.accent, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
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
                                <Text style={{ color: action.style === "primary" ? tone.accent : palette.text, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
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
                                <Text style={{ color: palette.text, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
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

                {toolCalls.length > 0 ? (
                  <View style={{ gap: 8, paddingLeft: 10 }}>
                    {toolCalls.map((toolCall) => (
                      <ToolCallRow key={toolCall.id} toolCall={toolCall} palette={palette} />
                    ))}
                  </View>
                ) : null}

                {toolResults.length > 0 ? (
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
                  <View style={{ gap: 10, paddingLeft: 10 }}>
                    {interruptRequests.map((interrupt) => {
                      const panelState = panelStates.find((state) => state.interrupt.id === interrupt.id);
                      const values = panelState?.values || defaultPanelValues(interrupt);
                      if (panelState?.renderState === "queued") {
                        return (
                          <View
                            key={interrupt.id}
                            style={{
                              borderRadius: 14,
                              paddingHorizontal: 11,
                              paddingVertical: 9,
                              borderWidth: 1,
                              borderColor: "rgba(255,255,255,0.05)",
                              backgroundColor: "rgba(255,255,255,0.014)",
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <MaterialCommunityIcons name={"clock-outline" as never} size={14} color={palette.muted} />
                            <Text style={{ flex: 1, color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>
                              {panelKicker(interrupt)} is waiting behind the active decision.
                            </Text>
                          </View>
                        );
                      }
                      return (
                        <DynamicPanelRenderer
                          key={interrupt.id}
                          interrupt={interrupt}
                          values={values}
                          palette={palette}
                          active={interrupt.id === activePanelId}
                          onValueChange={(fieldId, value) =>
                            setInterruptValuesById((previous) => ({
                              ...previous,
                              [interrupt.id]: {
                                ...(previous[interrupt.id] || defaultPanelValues(interrupt)),
                                [fieldId]: value,
                              },
                            }))
                          }
                          onSubmit={() => {
                            const payload = panelSubmitPayload(interrupt, interruptValuesById);
                            onInterruptSubmit(payload.interruptId, payload.values);
                          }}
                          onDismiss={() => {
                            const payload = panelDismissPayload(interrupt);
                            onInterruptDismiss(payload.interruptId);
                          }}
                          onOpenEntityRef={onOpenEntityRef}
                        />
                      );
                    })}
                  </View>
                ) : null}

                {(diagnosticCards.length > 0 || resolutions.length > 0) ? (
                  <View style={{ paddingLeft: 10, gap: 6 }}>
                    <TouchableOpacity
                      style={{
                        alignSelf: "flex-start",
                        borderRadius: 999,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        backgroundColor: "rgba(255,255,255,0.014)",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.04)",
                      }}
                      onPress={() => setExpandedDiagnostics((previous) => ({ ...previous, [message.id]: !previous[message.id] }))}
                    >
                      <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 }}>
                        {showDiagnostics ? "Details open" : `Details ${diagnosticCards.length + resolutions.length}`}
                      </Text>
                    </TouchableOpacity>
                    {showDiagnostics ? (
                      <View
                        style={{
                          borderRadius: 16,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.04)",
                          backgroundColor: "rgba(255,255,255,0.018)",
                          gap: 8,
                        }}
                      >
                        {resolutions.map((resolution) => (
                          <View
                            key={resolution.id}
                            style={{
                              borderRadius: 14,
                              paddingHorizontal: 10,
                              paddingVertical: 9,
                              borderWidth: 1,
                              borderColor: "rgba(255,255,255,0.04)",
                              backgroundColor: "rgba(255,255,255,0.02)",
                              gap: 4,
                            }}
                          >
                            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.75 }}>
                              Panel saved
                            </Text>
                            <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>{resolution.action}</Text>
                          </View>
                        ))}
                        {diagnosticCards.map((card, cardIndex) => (
                          <View
                            key={`${message.id}-diagnostic-${card.kind}-${cardIndex}`}
                            style={{
                              borderRadius: 14,
                              paddingHorizontal: 10,
                              paddingVertical: 9,
                              borderWidth: 1,
                              borderColor: "rgba(255,255,255,0.04)",
                              backgroundColor: "rgba(255,255,255,0.02)",
                              gap: 4,
                            }}
                          >
                            <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.75 }}>
                              {mobileConversationCardLabel(card.kind, card.title)}
                            </Text>
                            <Text style={{ color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>
                              {card.title || card.body || "Diagnostic detail available."}
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
          borderRadius: 22,
          paddingHorizontal: 6,
          paddingTop: 6,
          paddingBottom: 6,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.04)",
          backgroundColor: "rgba(18, 15, 19, 0.7)",
          gap: 5,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {showVoiceHint ? (
            <Text style={{ flex: 1, color: palette.muted, fontSize: 10.5, lineHeight: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 }}>
              {voiceActionHint || voiceLabel}
            </Text>
          ) : (
            <View />
          )}
          <View style={{ flexDirection: "row", gap: 6 }}>
            {[
              { icon: "tune-variant", action: previewCommandFlow },
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
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                voiceActionState === "recording"
                  ? "rgba(255, 180, 183, 0.16)"
                  : voiceActionState === "ready"
                    ? "rgba(166, 222, 191, 0.14)"
                    : "rgba(255,255,255,0.025)",
              borderWidth: 1,
              borderColor:
                voiceActionState === "recording"
                  ? "rgba(255, 180, 183, 0.18)"
                  : voiceActionState === "ready"
                    ? "rgba(166, 222, 191, 0.18)"
                    : "rgba(255,255,255,0.04)",
            }}
            onPress={onVoiceAction}
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
              minHeight: 46,
              borderRadius: 18,
              paddingHorizontal: 12,
              paddingTop: 3,
              paddingBottom: 3,
              backgroundColor: "rgba(255,255,255,0.022)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.04)",
            }}
          >
            <TextInput
              value={homeDraft}
              onChangeText={setHomeDraft}
              placeholder={productCopy.assistant.inputPlaceholder}
              placeholderTextColor={palette.muted}
              multiline
              style={{
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
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pendingConversationTurn ? "rgba(255,255,255,0.12)" : palette.accent,
            }}
            disabled={pendingConversationTurn}
            onPress={runAssistantTurn}
          >
            <MaterialCommunityIcons name={pendingConversationTurn ? "dots-horizontal" : "arrow-up"} size={19} color={palette.onAccent} />
          </TouchableOpacity>
        </View>

        {displaySuggestions.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
            {displaySuggestions.map((label) => (
              <TouchableOpacity
                key={label}
                style={{
                  minHeight: 36,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: "rgba(255,255,255,0.018)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.05)",
                  justifyContent: "center",
                  maxWidth: assistantPanelLayout.promptChipMaxWidth,
                }}
                onPress={() => setHomeDraft(label)}
              >
                <Text
                  style={{ maxWidth: 190, color: palette.text, fontSize: 13, lineHeight: 17, fontWeight: "700" }}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}
