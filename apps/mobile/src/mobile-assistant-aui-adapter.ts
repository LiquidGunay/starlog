import type { AssistantMessagePart, AssistantThreadMessage, AssistantThreadSnapshot } from "@starlog/contracts";
import { assistantToolDisplayLabel, attachmentActionLabel } from "./assistant-mobile-ui";

export type MobileAssistantUiThreadMessage = {
  id: string;
  role: "system" | "user" | "assistant";
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

export type MobileAssistantUiRichPart = {
  id: string;
  type: Exclude<AssistantMessagePart["type"], "text" | "status">;
  label: string;
  rendererKey: string | null;
  placement: string | null;
};

export type MobileAssistantUiThreadSnapshot = {
  threadId: string;
  messages: MobileAssistantUiThreadMessage[];
  richPartsByMessageId: Record<string, MobileAssistantUiRichPart[]>;
  pendingInterruptIds: string[];
};

function statusLabel(part: Extract<AssistantMessagePart, { type: "status" }>): string {
  const explicitLabel = part.label?.trim();
  if (explicitLabel) {
    return explicitLabel;
  }
  if (part.status === "pending" || part.status === "running") {
    return "Assistant reply in progress.";
  }
  if (part.status === "requires_action") {
    return "Decision needed.";
  }
  if (part.status === "error") {
    return "Assistant reply needs attention.";
  }
  return "";
}

function messageTranscriptText(message: AssistantThreadMessage): string {
  const lines: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) {
      lines.push(part.text.trim());
    }
    if (part.type === "status") {
      const label = statusLabel(part);
      if (label) {
        lines.push(label);
      }
    }
  }
  return lines.join("\n\n").trim();
}

function normalizeRole(role: AssistantThreadMessage["role"]): MobileAssistantUiThreadMessage["role"] {
  return role === "user" || role === "assistant" || role === "system" ? role : "assistant";
}

function dynamicPartFields(part: AssistantMessagePart): { rendererKey: string | null; placement: string | null } {
  if (part.type === "card") {
    return {
      rendererKey: part.card.renderer_key ?? null,
      placement: part.card.placement ?? null,
    };
  }
  if (part.type === "tool_result") {
    return {
      rendererKey: part.tool_result.renderer_key ?? null,
      placement: part.tool_result.placement ?? null,
    };
  }
  if (part.type === "interrupt_request") {
    return {
      rendererKey: part.interrupt.renderer_key ?? null,
      placement: part.interrupt.placement ?? part.interrupt.display_mode ?? null,
    };
  }
  return {
    rendererKey: null,
    placement: null,
  };
}

function humanizeKind(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function richPartLabel(part: AssistantMessagePart): string {
  if (part.type === "card") {
    return part.card.title?.trim() || humanizeKind(part.card.kind);
  }
  if (part.type === "ambient_update") {
    return part.update.label.trim() || "Ambient update";
  }
  if (part.type === "attachment") {
    return part.attachment.label.trim() || attachmentActionLabel(part.attachment);
  }
  if (part.type === "tool_call") {
    return assistantToolDisplayLabel(part.tool_call.tool_name, part.tool_call.title);
  }
  if (part.type === "tool_result") {
    const cardTitle = part.tool_result.card?.title?.trim();
    if (cardTitle) {
      return cardTitle;
    }
    return part.tool_result.status === "complete" ? "Assistant action result" : "Assistant action attention";
  }
  if (part.type === "interrupt_request") {
    return part.interrupt.title.trim() || part.interrupt.primary_label.trim() || "Assistant decision";
  }
  if (part.type === "interrupt_resolution") {
    return part.resolution.action === "submit" ? "Panel saved" : "Panel dismissed";
  }
  return "Assistant update";
}

export function starlogRichPartsForMessage(message: AssistantThreadMessage): MobileAssistantUiRichPart[] {
  return message.parts
    .filter((part): part is Exclude<AssistantMessagePart, Extract<AssistantMessagePart, { type: "text" | "status" }>> =>
      part.type !== "text" && part.type !== "status",
    )
    .map((part) => {
      const fields = dynamicPartFields(part);
      return {
        id: part.id,
        type: part.type,
        label: richPartLabel(part),
        rendererKey: fields.rendererKey,
        placement: fields.placement,
      };
    });
}

export function starlogMessageToAssistantUiMessage(message: AssistantThreadMessage): MobileAssistantUiThreadMessage | null {
  const content = messageTranscriptText(message);
  if (!content) {
    return null;
  }
  const richParts = starlogRichPartsForMessage(message);

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
        richPartCount: richParts.length,
        richParts,
      },
    },
  };
}

export function starlogMessagesToAssistantUiMessages(messages: AssistantThreadMessage[]): MobileAssistantUiThreadMessage[] {
  return messages
    .map(starlogMessageToAssistantUiMessage)
    .filter((message): message is MobileAssistantUiThreadMessage => message !== null);
}

export function starlogSnapshotToAssistantUiThread(snapshot: AssistantThreadSnapshot): MobileAssistantUiThreadSnapshot {
  return {
    threadId: snapshot.id,
    messages: starlogMessagesToAssistantUiMessages(snapshot.messages),
    richPartsByMessageId: Object.fromEntries(
      snapshot.messages
        .map((message) => [message.id, starlogRichPartsForMessage(message)] as const)
        .filter(([, richParts]) => richParts.length > 0),
    ),
    pendingInterruptIds: snapshot.interrupts
      .filter((interrupt) => interrupt.status === "pending")
      .map((interrupt) => interrupt.id),
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function messageContentFingerprint(message: MobileAssistantUiThreadMessage): string {
  return hashString(
    JSON.stringify({
      content: message.content,
      role: message.role,
      status: message.metadata.custom.starlogStatus,
      richPartCount: message.metadata.custom.richPartCount,
    }),
  );
}

export function assistantUiThreadFingerprint(messages: MobileAssistantUiThreadMessage[]): string {
  return messages.map((message) => `${message.id || message.role}:${messageContentFingerprint(message)}`).join("|");
}
