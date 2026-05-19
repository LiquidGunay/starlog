import type {
  AssistantCard,
  AssistantDynamicUiPlacement,
  AssistantInterrupt,
  AssistantMessagePart,
  AssistantThreadMessage,
  AssistantThreadSnapshot,
  AssistantToolCall,
  AssistantToolResult,
} from "@starlog/contracts";
import {
  createDynamicUiAssistantUiMetadata,
  DEFAULT_DYNAMIC_UI_REGISTRY,
  isStarlogKnownRendererKey,
  resolveDynamicUiRenderer,
  type DynamicUiAssistantUiDescriptor,
} from "../../../packages/dynamic-ui/src";

import { attachmentActionLabel, toolStatusSummary } from "./assistant-mobile-ui";

type MobileAssistantUiRole = "system" | "user" | "assistant";

export const MOBILE_ASSISTANT_UI_TEST_MARKERS = {
  shell: "assistant-ui shell",
  thread: "assistant-ui thread",
  composer: "assistant-ui composer",
  composerInput: "assistant-ui composer input",
} as const;

type DynamicRendererDescriptor = {
  label: string;
  defaultPlacement: AssistantDynamicUiPlacement;
};

type DynamicPartMetadata = {
  rendererKey: string | null;
  requestedRendererKey: string | null;
  resolvedRendererKey: string | null;
  rendererVersion: number | null;
  placement: AssistantDynamicUiPlacement | null;
  structuredContent: Record<string, unknown> | null;
  uiMeta: Record<string, unknown> | null;
  fallback: boolean;
  fallbackReason?: string;
  assistantUiMetadata?: DynamicUiAssistantUiDescriptor;
};

export type MobileAssistantUiRichPart = {
  id: string;
  type: Exclude<AssistantMessagePart["type"], "text" | "status">;
  label: string;
  diagnostic?: boolean;
  rendererLabel?: string;
  rendererKey?: string | null;
  requestedRendererKey?: string | null;
  resolvedRendererKey?: string | null;
  rendererVersion?: number | null;
  placement?: AssistantDynamicUiPlacement | null;
  placementLabel?: string;
  fallback?: boolean;
  fallbackReason?: string;
  structuredContent?: Record<string, unknown> | null;
  uiMeta?: Record<string, unknown> | null;
  metadata?: {
    custom: {
      starlog_dynamic_ui: DynamicUiAssistantUiDescriptor;
    };
  };
};

export type MobileAssistantUiThreadMessage = {
  id: string;
  role: MobileAssistantUiRole;
  content: string;
  createdAt: Date;
  metadata: {
    custom: {
      starlogMessageId: string;
      starlogThreadId: string;
      starlogStatus: AssistantThreadMessage["status"];
      transcriptKind: "text" | "rich_fallback";
      richPartCount: number;
      richParts: MobileAssistantUiRichPart[];
      starlog_dynamic_ui?: DynamicUiAssistantUiDescriptor;
    };
  };
};

export type MobileAssistantUiThread = {
  id: string;
  title: string;
  messages: MobileAssistantUiThreadMessage[];
  metadata: {
    custom: {
      starlogThreadId: string;
      starlogSlug: string;
      starlogMode: string;
      nextCursor?: string | null;
    };
  };
};

const DIAGNOSTIC_CARD_KINDS = new Set(["thread_context", "tool_step"]);
const DIAGNOSTIC_TOOL_NAMES = new Set(["list_dynamic_ui_capabilities"]);

const PLACEMENT_LABELS: Record<string, string> = {
  thread: "Thread panel",
  inline: "Inline panel",
  composer: "Composer panel",
  sidecar: "Inline on mobile",
  bottom_sheet: "Bottom sheet",
  full_screen: "Full screen",
  support_panel: "Support panel",
  ambient: "Ambient update",
};

function hasRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function booleanMetadataFlag(metadata: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => metadata[key] === true);
}

function isRegisteredDynamicRendererKey(rendererKey: string | null | undefined): rendererKey is string {
  return isStarlogKnownRendererKey(rendererKey);
}

function normalizeRole(role: AssistantThreadMessage["role"]): MobileAssistantUiRole {
  if (role === "system" || role === "user") {
    return role;
  }
  return "assistant";
}

function humanizeKind(value: string): string {
  return value
    .replace(/[_:.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(message: AssistantThreadMessage): string | null {
  if (message.status === "complete") {
    return null;
  }
  return humanizeKind(message.status);
}

function placementLabel(placement: AssistantDynamicUiPlacement | null | undefined): string | undefined {
  if (!placement) {
    return undefined;
  }
  return PLACEMENT_LABELS[placement] || humanizeKind(String(placement));
}

function rendererDescriptor(rendererKey: string | null | undefined): DynamicRendererDescriptor | null {
  if (!rendererKey) {
    return null;
  }
  const resolved = resolveDynamicUiRenderer(rendererKey, DEFAULT_DYNAMIC_UI_REGISTRY);
  if (resolved.fallback) {
    return null;
  }
  return {
    label: resolved.definition.label,
    defaultPlacement: resolved.definition.defaultPlacement,
  };
}

function rendererLabelFromKey(rendererKey: string | null | undefined): string | undefined {
  const descriptor = rendererDescriptor(rendererKey);
  if (descriptor) {
    return descriptor.label;
  }
  return undefined;
}

function metadataToolName(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = metadata?.tool_name;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isDiagnosticToolName(toolName: string | null | undefined): boolean {
  return Boolean(toolName && DIAGNOSTIC_TOOL_NAMES.has(toolName));
}

function toolResultHasUserFacingDynamicUi(result: AssistantToolResult): boolean {
  if (result.renderer_key || result.card?.renderer_key) {
    return true;
  }
  if (result.card && !DIAGNOSTIC_CARD_KINDS.has(result.card.kind)) {
    return true;
  }
  const toolName = metadataToolName(result.metadata);
  return isRegisteredDynamicRendererKey(toolName);
}

export function isDiagnosticAssistantToolCall(toolCall: AssistantToolCall): boolean {
  if (booleanMetadataFlag(toolCall.metadata || {}, ["user_visible", "transcript_visible"])) {
    return false;
  }
  return true;
}

export function isDiagnosticAssistantToolResult(toolResult: AssistantToolResult): boolean {
  if (booleanMetadataFlag(toolResult.metadata || {}, ["user_visible", "transcript_visible"])) {
    return false;
  }
  if (isDiagnosticToolName(metadataToolName(toolResult.metadata))) {
    return true;
  }
  return !toolResultHasUserFacingDynamicUi(toolResult);
}

export function mobileDynamicUiBadge(options: {
  rendererKey?: string | null;
  placement?: AssistantDynamicUiPlacement | string | null;
}): string | null {
  const rendererLabel = rendererLabelFromKey(options.rendererKey);
  if (!rendererLabel) {
    return null;
  }
  const descriptor = rendererDescriptor(options.rendererKey);
  const placement = (options.placement || descriptor?.defaultPlacement || null) as AssistantDynamicUiPlacement | null;
  const label = placementLabel(placement);
  return label ? `${rendererLabel} · ${label}` : rendererLabel;
}

function dynamicPartMetadataFromAssistantUiDescriptor(options: {
  descriptor: DynamicUiAssistantUiDescriptor;
  fallbackReason: string;
}): DynamicPartMetadata {
  const { descriptor, fallbackReason } = options;
  const fallback = descriptor.fallback;
  return {
    rendererKey: fallback ? descriptor.requested_renderer_key : descriptor.resolved_renderer_key,
    requestedRendererKey: descriptor.requested_renderer_key,
    resolvedRendererKey: fallback ? null : descriptor.resolved_renderer_key,
    rendererVersion: descriptor.renderer_version,
    placement: descriptor.placement,
    structuredContent: descriptor.structured_content,
    uiMeta: descriptor.ui_meta,
    fallback,
    fallbackReason: fallback ? fallbackReason : undefined,
    assistantUiMetadata: descriptor,
  };
}

function cardDynamicMetadata(card: AssistantCard): DynamicPartMetadata {
  const requestedRendererKey = card.renderer_key || null;
  if (!requestedRendererKey) {
    return {
      rendererKey: null,
      requestedRendererKey,
      resolvedRendererKey: null,
      rendererVersion: card.renderer_version ?? null,
      placement: card.placement || null,
      structuredContent: card.structured_content || null,
      uiMeta: card.ui_meta || (hasRecordValue(card.metadata) ? card.metadata : null),
      fallback: false,
      fallbackReason: undefined,
    };
  }
  const normalizedCard = {
    ...card,
    renderer_key: requestedRendererKey,
    placement: card.placement || null,
  };
  const descriptor = createDynamicUiAssistantUiMetadata("card", normalizedCard as AssistantCard, DEFAULT_DYNAMIC_UI_REGISTRY, {
    preserveFallbackPlacement: true,
  }).custom.starlog_dynamic_ui;
  return dynamicPartMetadataFromAssistantUiDescriptor({
    descriptor,
    fallbackReason: "No registered mobile renderer; using generic card rendering.",
  });
}

function toolResultDynamicMetadata(result: AssistantToolResult): DynamicPartMetadata {
  const requestedRendererKey = result.renderer_key || result.card?.renderer_key || null;
  if (!requestedRendererKey) {
    return {
      rendererKey: null,
      requestedRendererKey,
      resolvedRendererKey: null,
      rendererVersion: result.renderer_version ?? result.card?.renderer_version ?? null,
      placement: result.placement || result.card?.placement || null,
      structuredContent: result.structured_content || result.card?.structured_content || result.output || null,
      uiMeta: result.ui_meta || result.card?.ui_meta || (hasRecordValue(result.metadata) ? result.metadata : null),
      fallback: false,
      fallbackReason: undefined,
    };
  }
  const normalizedResult = {
    ...result,
    placement: result.placement || result.card?.placement || null,
    renderer_key: requestedRendererKey,
    structured_content: result.structured_content || result.card?.structured_content || result.output || null,
    ui_meta: result.ui_meta || result.card?.ui_meta || (hasRecordValue(result.metadata) ? result.metadata : null),
  };
  const descriptor = createDynamicUiAssistantUiMetadata(
    "tool_result",
    normalizedResult as AssistantToolResult,
    DEFAULT_DYNAMIC_UI_REGISTRY,
    {
      preserveFallbackPlacement: true,
    },
  ).custom.starlog_dynamic_ui;
  return dynamicPartMetadataFromAssistantUiDescriptor({
    descriptor,
    fallbackReason: "No registered mobile renderer; using generic tool result rendering.",
  });
}

function interruptDynamicMetadata(interrupt: AssistantInterrupt): DynamicPartMetadata {
  const requestedRendererKey = interrupt.renderer_key || (isRegisteredDynamicRendererKey(interrupt.tool_name) ? interrupt.tool_name : null);
  if (!requestedRendererKey) {
    return {
      rendererKey: null,
      requestedRendererKey,
      resolvedRendererKey: null,
      rendererVersion: interrupt.renderer_version ?? null,
      placement: interrupt.placement || interrupt.display_mode || null,
      structuredContent: interrupt.structured_content || null,
      uiMeta: interrupt.ui_meta || (hasRecordValue(interrupt.metadata) ? interrupt.metadata : null),
      fallback: false,
      fallbackReason: undefined,
    };
  }
  const normalizedInterrupt = {
    ...interrupt,
    renderer_key: requestedRendererKey,
    placement: interrupt.placement || interrupt.display_mode || null,
  };
  const descriptor = createDynamicUiAssistantUiMetadata(
    "interrupt",
    normalizedInterrupt as AssistantInterrupt,
    DEFAULT_DYNAMIC_UI_REGISTRY,
    { preserveFallbackPlacement: true },
  ).custom.starlog_dynamic_ui;
  return dynamicPartMetadataFromAssistantUiDescriptor({
    descriptor,
    fallbackReason: "No registered mobile renderer; using generic interrupt panel rendering.",
  });
}

function dynamicPartMetadata(part: AssistantMessagePart): DynamicPartMetadata | null {
  if (part.type === "card") {
    return cardDynamicMetadata(part.card);
  }
  if (part.type === "tool_result") {
    return toolResultDynamicMetadata(part.tool_result);
  }
  if (part.type === "interrupt_request") {
    return interruptDynamicMetadata(part.interrupt);
  }
  return null;
}

function richPartLabel(part: AssistantMessagePart): string {
  switch (part.type) {
    case "card":
      return part.card.title || humanizeKind(part.card.kind);
    case "ambient_update":
      return part.update.label || part.update.body || "Ambient update";
    case "tool_call":
      return `${part.tool_call.title || humanizeKind(part.tool_call.tool_name)} · ${toolStatusSummary(part.tool_call)}`;
    case "tool_result":
      return part.tool_result.card?.title || humanizeKind(part.tool_result.status);
    case "interrupt_request":
      return part.interrupt.title || humanizeKind(part.interrupt.tool_name);
    case "interrupt_resolution":
      return humanizeKind(part.resolution.action);
    case "attachment":
      return `${part.attachment.label} · ${attachmentActionLabel(part.attachment)}`;
    case "status":
    case "text":
      return "";
  }
}

function messageTranscriptText(message: AssistantThreadMessage): string {
  const textParts = message.parts
    .filter((part): part is Extract<AssistantMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean);
  return textParts.join("\n\n").trim();
}

function richFallbackTranscriptText(richParts: MobileAssistantUiRichPart[]): string {
  const primaryRichParts = richParts.filter((part) => !part.diagnostic);
  if (primaryRichParts.length === 0) {
    if (richParts.length > 0) {
      return "Assistant details updated.";
    }
    return "";
  }
  if (primaryRichParts.length === 1) {
    return primaryRichParts[0].rendererLabel || primaryRichParts[0].label;
  }
  const firstDynamicLabel = primaryRichParts.find((part) => part.rendererLabel)?.rendererLabel;
  return firstDynamicLabel
    ? `${firstDynamicLabel} and ${primaryRichParts.length - 1} more update${primaryRichParts.length === 2 ? "" : "s"}`
    : `${primaryRichParts.length} assistant updates`;
}

export function starlogRichPartsForMessage(message: AssistantThreadMessage): MobileAssistantUiRichPart[] {
  return message.parts
    .filter((part): part is Exclude<AssistantMessagePart, Extract<AssistantMessagePart, { type: "text" | "status" }>> =>
      part.type !== "text" && part.type !== "status",
    )
    .map((part) => {
      const dynamicMetadata = dynamicPartMetadata(part);
      const requestedRendererKey = dynamicMetadata?.requestedRendererKey || null;
      const resolvedRendererKey = dynamicMetadata?.resolvedRendererKey || null;
      const descriptor = rendererDescriptor(resolvedRendererKey || requestedRendererKey);
      const placement = dynamicMetadata?.placement || descriptor?.defaultPlacement || null;
      const rendererLabel = rendererLabelFromKey(resolvedRendererKey || requestedRendererKey);
      const diagnostic =
        (part.type === "card" && DIAGNOSTIC_CARD_KINDS.has(part.card.kind)) ||
        (part.type === "tool_call" && isDiagnosticAssistantToolCall(part.tool_call)) ||
        (part.type === "tool_result" && isDiagnosticAssistantToolResult(part.tool_result));
      return {
        id: part.id,
        type: part.type,
        label: richPartLabel(part),
        diagnostic,
        rendererLabel,
        rendererKey: dynamicMetadata?.rendererKey,
        requestedRendererKey: dynamicMetadata?.requestedRendererKey,
        resolvedRendererKey: dynamicMetadata?.resolvedRendererKey,
        rendererVersion: dynamicMetadata?.rendererVersion,
        placement,
        placementLabel: placementLabel(placement),
        fallback: dynamicMetadata?.fallback,
        fallbackReason: dynamicMetadata?.fallbackReason,
        structuredContent: dynamicMetadata?.structuredContent,
        uiMeta: dynamicMetadata?.uiMeta,
        metadata: dynamicMetadata?.assistantUiMetadata
          ? {
              custom: {
                starlog_dynamic_ui: dynamicMetadata.assistantUiMetadata,
              },
            }
          : undefined,
      };
    });
}

export function starlogMessageToAssistantUiMessage(message: AssistantThreadMessage): MobileAssistantUiThreadMessage | null {
  const transcriptText = messageTranscriptText(message);
  const richParts = starlogRichPartsForMessage(message);
  const content = transcriptText || richFallbackTranscriptText(richParts);
  if (!content) {
    return null;
  }
  const dynamicUiMetadata = richParts.find((part) => part.metadata?.custom.starlog_dynamic_ui)?.metadata?.custom.starlog_dynamic_ui;
  return {
    id: message.id,
    role: normalizeRole(message.role),
    content,
    createdAt: new Date(message.created_at),
    metadata: {
      custom: {
        starlogMessageId: message.id,
        starlogThreadId: message.thread_id,
        starlogStatus: message.status,
        transcriptKind: transcriptText ? "text" : "rich_fallback",
        richPartCount: richParts.length,
        richParts,
        ...(dynamicUiMetadata ? { starlog_dynamic_ui: dynamicUiMetadata } : {}),
      },
    },
  };
}

export function starlogMessagesToAssistantUiMessages(messages: AssistantThreadMessage[]): MobileAssistantUiThreadMessage[] {
  return messages.map(starlogMessageToAssistantUiMessage).filter((message): message is MobileAssistantUiThreadMessage => Boolean(message));
}

export function starlogSnapshotToAssistantUiThread(snapshot: AssistantThreadSnapshot): MobileAssistantUiThread {
  return {
    id: snapshot.id,
    title: snapshot.title,
    messages: starlogMessagesToAssistantUiMessages(snapshot.messages),
    metadata: {
      custom: {
        starlogThreadId: snapshot.id,
        starlogSlug: snapshot.slug,
        starlogMode: snapshot.mode,
        nextCursor: snapshot.next_cursor,
      },
    },
  };
}

export function assistantUiThreadFingerprint(messages: MobileAssistantUiThreadMessage[]): string {
  return messages
    .map((message) => {
      const richPartIds = message.metadata.custom.richParts
        .map((part) => [
          part.id,
          part.type,
          part.requestedRendererKey,
          part.resolvedRendererKey,
          part.rendererKey,
          part.label,
          part.rendererLabel,
          part.placement,
          part.fallback,
        ])
        .join("|");
      return JSON.stringify({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.metadata.custom.starlogStatus,
        richParts: richPartIds,
      });
    })
    .join("|");
}
