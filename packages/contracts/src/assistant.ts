export const ASSISTANT_CARD_KINDS = [
  "assistant_summary",
  "thread_context",
  "review_queue",
  "briefing",
  "task_list",
  "knowledge_note",
  "capture_item",
  "memory_suggestion",
  "tool_step",
] as const;

export type AssistantCardKind = (typeof ASSISTANT_CARD_KINDS)[number];

export const ASSISTANT_CARD_ACTION_KINDS = ["navigate", "mutation", "composer"] as const;

export type AssistantCardActionKind = (typeof ASSISTANT_CARD_ACTION_KINDS)[number];

export type AssistantCardActionStyle = "primary" | "secondary" | "ghost" | "danger";

export type AssistantEntityRef = {
  entity_type: string;
  entity_id: string;
  href?: string | null;
  title?: string | null;
};

export type AssistantCardAction = {
  id: string;
  label: string;
  kind: AssistantCardActionKind;
  payload?: Record<string, unknown>;
  style?: AssistantCardActionStyle;
  requires_confirmation?: boolean;
};

export type AssistantCard = {
  kind: AssistantCardKind | string;
  version: number;
  title?: string | null;
  body?: string | null;
  entity_ref?: AssistantEntityRef | null;
  actions: AssistantCardAction[];
  metadata: Record<string, unknown>;
};

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
