import type {
  AssistantCard,
  AssistantDynamicUiPlacement,
  AssistantInterrupt,
  AssistantMessagePart,
  AssistantThreadMessage,
  AssistantThreadSnapshot,
  AssistantToolResult,
} from "@starlog/contracts";

import { attachmentActionLabel, toolStatusSummary } from "./assistant-mobile-ui";

type MobileAssistantUiRole = "system" | "user" | "assistant";

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
};

export type MobileAssistantUiRichPart = {
  id: string;
  type: Exclude<AssistantMessagePart["type"], "text" | "status">;
  label: string;
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
      richPartCount: number;
      richParts: MobileAssistantUiRichPart[];
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

const DYNAMIC_RENDERER_LABELS: Record<string, DynamicRendererDescriptor> = {
  "interview.topic_unlock": { label: "Topic unlock", defaultPlacement: "thread" },
  "interview.question_request": { label: "Question request", defaultPlacement: "thread" },
  "interview.review_grade": { label: "Review grade", defaultPlacement: "inline" },
  "interview.recommendation_reason": { label: "Recommendation reason", defaultPlacement: "thread" },
  request_due_date: { label: "Request due date", defaultPlacement: "composer" },
  triage_capture: { label: "Triage capture", defaultPlacement: "sidecar" },
  resolve_planner_conflict: { label: "Resolve planner conflict", defaultPlacement: "sidecar" },
  grade_review_recall: { label: "Grade review recall", defaultPlacement: "inline" },
  choose_morning_focus: { label: "Choose morning focus", defaultPlacement: "composer" },
};

const DYNAMIC_RENDERER_KEYS = new Set<string>(Object.keys(DYNAMIC_RENDERER_LABELS));

const PLACEMENT_LABELS: Record<string, string> = {
  thread: "Thread panel",
  inline: "Inline panel",
  composer: "Composer panel",
  sidecar: "Side panel",
  bottom_sheet: "Bottom sheet",
  full_screen: "Full screen",
  support_panel: "Support panel",
  ambient: "Ambient update",
};

function hasRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRegisteredDynamicRendererKey(rendererKey: string | null | undefined): rendererKey is string {
  return typeof rendererKey === "string" && DYNAMIC_RENDERER_KEYS.has(rendererKey);
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
  return DYNAMIC_RENDERER_LABELS[rendererKey] || null;
}

function rendererLabelFromKey(rendererKey: string | null | undefined): string | undefined {
  const descriptor = rendererDescriptor(rendererKey);
  if (descriptor) {
    return descriptor.label;
  }
  return undefined;
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

function cardDynamicMetadata(card: AssistantCard): DynamicPartMetadata {
  const requestedRendererKey = card.renderer_key || null;
  const descriptor = rendererDescriptor(requestedRendererKey);
  const resolvedRendererKey = descriptor ? requestedRendererKey : null;
  const fallback = Boolean(requestedRendererKey && !descriptor);
  return {
    rendererKey: resolvedRendererKey || requestedRendererKey,
    requestedRendererKey,
    resolvedRendererKey,
    rendererVersion: card.renderer_version ?? null,
    placement: card.placement || descriptor?.defaultPlacement || null,
    structuredContent: card.structured_content || null,
    uiMeta: card.ui_meta || (hasRecordValue(card.metadata) ? card.metadata : null),
    fallback,
    fallbackReason: fallback ? "No registered mobile renderer; using generic card rendering." : undefined,
  };
}

function toolResultDynamicMetadata(result: AssistantToolResult): DynamicPartMetadata {
  const requestedRendererKey = result.renderer_key || result.card?.renderer_key || null;
  const descriptor = rendererDescriptor(requestedRendererKey);
  const resolvedRendererKey = descriptor ? requestedRendererKey : null;
  const fallback = Boolean(requestedRendererKey && !descriptor);
  return {
    rendererKey: resolvedRendererKey || requestedRendererKey,
    requestedRendererKey,
    resolvedRendererKey,
    rendererVersion: result.renderer_version ?? result.card?.renderer_version ?? null,
    placement: result.placement || result.card?.placement || descriptor?.defaultPlacement || null,
    structuredContent: result.structured_content || result.card?.structured_content || result.output || null,
    uiMeta: result.ui_meta || result.card?.ui_meta || (hasRecordValue(result.metadata) ? result.metadata : null),
    fallback,
    fallbackReason: fallback ? "No registered mobile renderer; using generic tool result rendering." : undefined,
  };
}

function interruptDynamicMetadata(interrupt: AssistantInterrupt): DynamicPartMetadata {
  const requestedRendererKey = interrupt.renderer_key || (isRegisteredDynamicRendererKey(interrupt.tool_name) ? interrupt.tool_name : null);
  const descriptor = rendererDescriptor(requestedRendererKey);
  const resolvedRendererKey = descriptor ? requestedRendererKey : null;
  const fallback = Boolean(requestedRendererKey && !descriptor);
  return {
    rendererKey: resolvedRendererKey || requestedRendererKey,
    requestedRendererKey,
    resolvedRendererKey,
    rendererVersion: interrupt.renderer_version ?? null,
    placement: interrupt.placement || interrupt.display_mode || descriptor?.defaultPlacement || null,
    structuredContent: interrupt.structured_content || null,
    uiMeta: interrupt.ui_meta || (hasRecordValue(interrupt.metadata) ? interrupt.metadata : null),
    fallback,
    fallbackReason: fallback ? "No registered mobile renderer; using generic interrupt panel rendering." : undefined,
  };
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
      return {
        id: part.id,
        type: part.type,
        label: richPartLabel(part),
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
      };
    });
}

export function starlogMessageToAssistantUiMessage(message: AssistantThreadMessage): MobileAssistantUiThreadMessage | null {
  const transcriptText = messageTranscriptText(message);
  const richParts = starlogRichPartsForMessage(message);
  if (!transcriptText) {
    return null;
  }
  return {
    id: message.id,
    role: normalizeRole(message.role),
    content: transcriptText,
    createdAt: new Date(message.created_at),
    metadata: {
      custom: {
        starlogMessageId: message.id,
        starlogThreadId: message.thread_id,
        starlogStatus: message.status,
        richPartCount: richParts.length,
        richParts,
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
