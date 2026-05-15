import type { AssistantThreadMessage } from "@starlog/contracts";
import type { ThreadMessageLike } from "@assistant-ui/react-native";

function messageText(message: AssistantThreadMessage): string {
  const lines: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) {
      lines.push(part.text.trim());
    }
    if (part.type === "status") {
      const label = part.label?.trim() || part.status.replace(/_/g, " ");
      if (label) {
        lines.push(label);
      }
    }
    if (part.type === "tool_call") {
      lines.push(part.tool_call.status === "requires_action" ? "Waiting for your decision." : "Assistant action in progress.");
    }
    if (part.type === "tool_result") {
      lines.push(part.tool_result.status === "complete" ? "Assistant action updated the thread." : "Assistant action needs attention.");
    }
    if (part.type === "interrupt_request") {
      lines.push(part.interrupt.title.trim() || "Assistant decision needed.");
    }
  }
  return lines.join("\n\n").trim();
}

export function starlogMessageToAssistantUiMessage(message: AssistantThreadMessage): ThreadMessageLike | null {
  const content = messageText(message);
  if (!content) {
    return null;
  }

  return {
    id: message.id,
    role: message.role === "user" || message.role === "assistant" || message.role === "system" ? message.role : "assistant",
    content,
    createdAt: new Date(message.created_at),
    metadata: {
      custom: {
        starlogMessageId: message.id,
      },
    },
  };
}

export function starlogMessagesToAssistantUiMessages(messages: AssistantThreadMessage[]): ThreadMessageLike[] {
  return messages
    .map(starlogMessageToAssistantUiMessage)
    .filter((message): message is ThreadMessageLike => message !== null);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function messageContentFingerprint(message: ThreadMessageLike): string {
  return hashString(JSON.stringify({ content: message.content, role: message.role, status: message.status ?? null }));
}

export function assistantUiThreadFingerprint(messages: ThreadMessageLike[]): string {
  return messages.map((message) => `${message.id || message.role}:${messageContentFingerprint(message)}`).join("|");
}
