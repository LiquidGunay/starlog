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
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";

import { mobileConversationCardLabel } from "./conversation-cards";
import {
  attachmentActionLabel,
  summarizeOutput,
  supportSurfaceActionLabel,
  toolResultBadges,
  toolStatusSummary,
} from "./assistant-mobile-ui";

const DIAGNOSTIC_CARD_KINDS = new Set(["thread_context", "tool_step"]);

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
};

type ThreadLens = "live" | "artifacts" | "actions";

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

function defaultValues(interrupt: AssistantInterrupt): Record<string, unknown> {
  return interrupt.fields.reduce<Record<string, unknown>>((accumulator, field) => {
    accumulator[field.id] = field.value ?? (field.kind === "toggle" ? false : "");
    return accumulator;
  }, {});
}

function messageHasArtifactContent(message: AssistantThreadMessage): boolean {
  return cardParts(message).length > 0 || attachmentParts(message).length > 0;
}

function messageHasActionContent(message: AssistantThreadMessage): boolean {
  return (
    ambientParts(message).length > 0
    || toolCallParts(message).length > 0
    || toolResultParts(message).length > 0
    || statusParts(message).length > 0
    || interruptRequestParts(message).length > 0
    || interruptResolutionParts(message).length > 0
    || message.role === "system"
    || message.role === "tool"
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

function fieldValue(values: Record<string, unknown>, field: AssistantInterruptField): string {
  const value = values[field.id];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
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
  field,
  values,
  palette,
  setValue,
}: {
  field: AssistantInterruptField;
  values: Record<string, unknown>;
  palette: Record<string, string>;
  setValue: (value: unknown) => void;
}) {
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
          trackColor={{ true: palette.accent, false: "rgba(255,255,255,0.12)" }}
        />
      </View>
    );
  }

  if (field.kind === "select" || field.kind === "priority") {
    const options =
      field.options && field.options.length > 0
        ? field.options
        : field.kind === "priority"
          ? [1, 2, 3, 4, 5].map((option) => ({ label: `Priority ${option}`, value: String(option) }))
          : [];
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
          {field.label}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
          {options.map((option) => {
            const active = fieldValue(values, field) === option.value;
            return (
              <TouchableOpacity
                key={`${field.id}-${option.value}`}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderWidth: 1,
                  borderColor: active ? "rgba(241, 182, 205, 0.18)" : "rgba(255,255,255,0.05)",
                  backgroundColor: active ? "rgba(241, 182, 205, 0.12)" : "rgba(255,255,255,0.025)",
                }}
                onPress={() => setValue(option.value)}
              >
                <Text
                  style={{
                    color: active ? palette.text : palette.muted,
                    fontSize: 11,
                    fontWeight: "800",
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                  }}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
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
}: MobileAssistantRebuildProps) {
  const [threadLens, setThreadLens] = useState<ThreadLens>("live");
  const [activeAttachmentByMessage, setActiveAttachmentByMessage] = useState<Record<string, number>>({});
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Record<string, boolean>>({});
  const [revealedReviewCards, setRevealedReviewCards] = useState<Record<string, boolean>>({});
  const [interruptValuesById, setInterruptValuesById] = useState<Record<string, Record<string, unknown>>>({});

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
        next[interrupt.id] = defaultValues(interrupt);
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [liveInterrupts]);

  const attachmentCount = useMemo(
    () => visibleThreadMessages.reduce((count, message) => count + cardParts(message).length + attachmentParts(message).length, 0),
    [visibleThreadMessages],
  );
  const assistantReplyCount = useMemo(
    () => visibleThreadMessages.filter((message) => message.role === "assistant").length,
    [visibleThreadMessages],
  );
  const suggestionPills = useMemo(
    () => previewSuggestions(visibleThreadMessages, liveInterrupts),
    [liveInterrupts, visibleThreadMessages],
  );

  const filteredMessages = useMemo(() => {
    if (threadLens === "live") {
      return visibleThreadMessages;
    }
    return visibleThreadMessages.filter((message) =>
      threadLens === "artifacts" ? messageHasArtifactContent(message) : messageHasActionContent(message),
    );
  }, [threadLens, visibleThreadMessages]);

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
  const displaySuggestions = homeDraft.trim().length === 0 ? suggestionPills : suggestionPills.slice(0, 1);

  return (
    <View style={{ gap: 16, paddingTop: 4 }}>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={{ color: palette.muted, fontSize: 11.5, lineHeight: 15, fontWeight: "700" }}>
            Shared thread · mobile + web
          </Text>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 9,
              paddingVertical: 4,
              backgroundColor: pendingConversationTurn ? "rgba(241, 182, 205, 0.08)" : "rgba(255,255,255,0.025)",
              borderWidth: 1,
              borderColor: pendingConversationTurn ? "rgba(241, 182, 205, 0.12)" : "rgba(255,255,255,0.05)",
            }}
          >
            <Text style={{ color: palette.text, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 }}>
              {pendingConversationTurn ? "Reply pending" : "Live"}
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
          {[
            { id: "live", label: "Thread" },
            { id: "artifacts", label: `Artifacts ${attachmentCount}` },
            { id: "actions", label: `System ${hiddenThreadMessageCount > 0 ? hiddenThreadMessageCount : ""}`.trim() },
            { id: "count", label: `${assistantReplyCount} replies`, passive: true },
          ].map((item) => {
            if ("passive" in item) {
              return (
                <View
                  key={item.id}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    backgroundColor: "rgba(255,255,255,0.018)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.04)",
                  }}
                >
                  <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "700" }}>{item.label}</Text>
                </View>
              );
            }
            const active = threadLens === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 11,
                  paddingVertical: 6,
                  backgroundColor: active ? "rgba(241, 182, 205, 0.12)" : "rgba(255,255,255,0.018)",
                  borderWidth: 1,
                  borderColor: active ? "rgba(241, 182, 205, 0.16)" : "rgba(255,255,255,0.04)",
                }}
                onPress={() => setThreadLens(item.id as ThreadLens)}
              >
                <Text style={{ color: active ? palette.text : palette.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ gap: 16, paddingBottom: 4 }}>
        {filteredMessages.length === 0 ? (
          <View style={{ alignItems: "center", gap: 10, paddingTop: 40, paddingHorizontal: 28 }}>
            <MaterialCommunityIcons name="message-outline" size={26} color={palette.accent} />
            <Text style={{ color: palette.text, fontSize: 22, lineHeight: 26, fontWeight: "800", textAlign: "center" }}>
              {productCopy.assistant.emptyTitle}
            </Text>
            <Text style={{ color: palette.muted, fontSize: 14, lineHeight: 21, textAlign: "center" }}>
              {productCopy.assistant.emptyBody}
            </Text>
          </View>
        ) : (
          filteredMessages.map((message, index) => {
            const previousRole = filteredMessages[index - 1]?.role;
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
              <View key={message.id} style={{ gap: 8, alignItems: isUser ? "flex-end" : "stretch" }}>
                {showMarker ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginLeft: 2 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: palette.accent }} />
                    <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.75 }}>
                      {message.role === "assistant" ? "Assistant" : "System"} {timestampLabel(message.created_at) ? `· ${timestampLabel(message.created_at)}` : ""}
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
                      const values = interruptValuesById[interrupt.id] || defaultValues(interrupt);
                      const pending = interrupt.status === "pending";
                      return (
                        <View
                          key={interrupt.id}
                          style={{
                            borderRadius: 16,
                            paddingHorizontal: 12,
                            paddingVertical: 12,
                            borderWidth: 1,
                            borderColor: pending ? "rgba(241, 182, 205, 0.16)" : "rgba(255,255,255,0.05)",
                            backgroundColor: pending ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.012)",
                            gap: 10,
                          }}
                        >
                          <View style={{ gap: 4 }}>
                            <Text style={{ color: palette.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                              {interrupt.tool_name.replace(/_/g, " ")}
                            </Text>
                            <Text style={{ color: palette.text, fontSize: 17, lineHeight: 24, fontWeight: "800" }}>{interrupt.title}</Text>
                            {interrupt.body ? <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{interrupt.body}</Text> : null}
                            <EntityActionChip entityRef={interrupt.entity_ref} palette={palette} onOpenEntityRef={onOpenEntityRef} />
                          </View>

                          {pending ? (
                            <>
                              <View style={{ gap: 10 }}>
                                {interrupt.fields.map((field) => (
                                  <InterruptFieldInput
                                    key={`${interrupt.id}-${field.id}`}
                                    field={field}
                                    values={values}
                                    palette={palette}
                                    setValue={(value) =>
                                      setInterruptValuesById((previous) => ({
                                        ...previous,
                                        [interrupt.id]: {
                                          ...(previous[interrupt.id] || defaultValues(interrupt)),
                                          [field.id]: value,
                                        },
                                      }))
                                    }
                                  />
                                ))}
                              </View>

                              <View style={{ flexDirection: "row", gap: 8 }}>
                                <TouchableOpacity
                                  style={{
                                    flex: 1,
                                    borderRadius: 999,
                                    paddingHorizontal: 12,
                                    paddingVertical: 10,
                                    borderWidth: 1,
                                    borderColor: "rgba(255,255,255,0.06)",
                                    backgroundColor: "rgba(255,255,255,0.03)",
                                    alignItems: "center",
                                  }}
                                  onPress={() => onInterruptDismiss(interrupt.id)}
                                >
                                  <Text style={{ color: palette.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                                    {interrupt.secondary_label || "Dismiss"}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={{
                                    flex: 1,
                                    borderRadius: 999,
                                    paddingHorizontal: 12,
                                    paddingVertical: 10,
                                    backgroundColor: palette.accent,
                                    alignItems: "center",
                                  }}
                                  onPress={() => onInterruptSubmit(interrupt.id, values)}
                                >
                                  <Text style={{ color: palette.onAccent, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                                    {interrupt.primary_label}
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

        {displaySuggestions.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
            {displaySuggestions.map((label) => (
              <TouchableOpacity
                key={label}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                  backgroundColor: "rgba(255,255,255,0.016)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.04)",
                }}
                onPress={() => setHomeDraft(label)}
              >
                <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.65 }}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

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
      </View>
    </View>
  );
}
