import type { AssistantCard } from "./assistant-card";
import type { AssistantMessagePart, AssistantThreadMessage } from "./assistant-thread";

export type AssistantCommandStep = {
  tool_name: string;
  arguments: Record<string, unknown>;
  status: "planned" | "ok" | "dry_run" | "failed" | "completed" | "confirmation_required";
  message?: string | null;
  result: unknown;
};

export type AssistantCommandResponse = {
  command: string;
  planner: string;
  matched_intent: string;
  status: "planned" | "executed" | "failed";
  summary: string;
  steps: AssistantCommandStep[];
};

export type AssistantConversationMessage = {
  id: string;
  thread_id?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  cards: AssistantCard[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AssistantConversationToolTrace = {
  id: string;
  thread_id: string;
  message_id?: string | null;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: string;
  result: unknown;
  metadata: Record<string, unknown>;
  created_at: string;
};

export function assistantThreadMessageToLegacyMessage(message: AssistantThreadMessage): AssistantConversationMessage {
  const cards = message.parts
    .filter((part): part is Extract<AssistantMessagePart, { type: "card" }> => part.type === "card")
    .map((part) => part.card);
  const content = message.parts
    .filter((part): part is Extract<AssistantMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();

  return {
    id: message.id,
    thread_id: message.thread_id,
    role: message.role,
    content,
    cards,
    metadata: message.metadata,
    created_at: message.created_at,
  };
}
