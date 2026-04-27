import type { AssistantCard } from "./assistant-card";
import type { AssistantAmbientUpdate } from "./assistant-events";
import type { AssistantInterrupt, AssistantInterruptResolution } from "./assistant-interrupt";
import type { AssistantRun, AssistantToolCall, AssistantToolResult } from "./assistant-run";

export type AssistantAttachmentKind = "artifact" | "image" | "audio" | "file" | "citation";

export type AssistantAttachment = {
  id: string;
  kind: AssistantAttachmentKind;
  label: string;
  url?: string | null;
  mime_type?: string | null;
  metadata: Record<string, unknown>;
};

export type AssistantMessageStatus = "pending" | "running" | "requires_action" | "complete" | "error";

export type AssistantTextPart = {
  type: "text";
  id: string;
  text: string;
};

export type AssistantCardPart = {
  type: "card";
  id: string;
  card: AssistantCard;
};

export type AssistantAmbientUpdatePart = {
  type: "ambient_update";
  id: string;
  update: AssistantAmbientUpdate;
};

export type AssistantToolCallPart = {
  type: "tool_call";
  id: string;
  tool_call: AssistantToolCall;
};

export type AssistantToolResultPart = {
  type: "tool_result";
  id: string;
  tool_result: AssistantToolResult;
};

export type AssistantInterruptRequestPart = {
  type: "interrupt_request";
  id: string;
  interrupt: AssistantInterrupt;
};

export type AssistantInterruptResolutionPart = {
  type: "interrupt_resolution";
  id: string;
  resolution: AssistantInterruptResolution;
};

export type AssistantAttachmentPart = {
  type: "attachment";
  id: string;
  attachment: AssistantAttachment;
};

export type AssistantStatusPart = {
  type: "status";
  id: string;
  status: AssistantMessageStatus;
  label?: string | null;
};

export type AssistantMessagePart =
  | AssistantTextPart
  | AssistantCardPart
  | AssistantAmbientUpdatePart
  | AssistantToolCallPart
  | AssistantToolResultPart
  | AssistantInterruptRequestPart
  | AssistantInterruptResolutionPart
  | AssistantAttachmentPart
  | AssistantStatusPart;

export type AssistantThreadMessage = {
  id: string;
  thread_id: string;
  run_id?: string | null;
  role: "system" | "user" | "assistant" | "tool";
  status: AssistantMessageStatus;
  parts: AssistantMessagePart[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
};

export type AssistantThread = {
  id: string;
  slug: string;
  title: string;
  mode: string;
  created_at: string;
  updated_at: string;
};

export type AssistantThreadSummary = AssistantThread & {
  last_message_at?: string | null;
  last_preview_text?: string | null;
};

export type AssistantThreadSnapshot = AssistantThreadSummary & {
  messages: AssistantThreadMessage[];
  runs: AssistantRun[];
  interrupts: AssistantInterrupt[];
  context_cards?: AssistantCard[];
  next_cursor?: string | null;
};

export type AssistantThreadDelta = {
  id: string;
  thread_id: string;
  event_type:
    | "thread.snapshot"
    | "message.created"
    | "message.updated"
    | "run.updated"
    | "run.step.updated"
    | "interrupt.opened"
    | "interrupt.resolved"
    | "surface_event.created";
  payload: Record<string, unknown>;
  created_at: string;
};

export type AssistantDeltaList = {
  thread_id: string;
  cursor?: string | null;
  deltas: AssistantThreadDelta[];
};
