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

export const ASSISTANT_CARD_ACTION_KINDS = ["navigate", "mutation", "composer", "interrupt"] as const;

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
