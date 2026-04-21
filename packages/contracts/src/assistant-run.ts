import type { AssistantCard, AssistantEntityRef } from "./assistant-card";
import type { AssistantInterrupt } from "./assistant-interrupt";

export type AssistantToolKind = "domain_tool" | "ui_tool" | "system_tool";
export type AssistantToolStatus = "queued" | "running" | "requires_action" | "complete" | "error" | "cancelled";

export type AssistantToolCall = {
  id: string;
  tool_name: string;
  tool_kind: AssistantToolKind;
  status: AssistantToolStatus;
  arguments: Record<string, unknown>;
  title?: string | null;
  metadata: Record<string, unknown>;
};

export type AssistantToolResult = {
  id: string;
  tool_call_id: string;
  status: Exclude<AssistantToolStatus, "queued" | "running">;
  output: Record<string, unknown>;
  card?: AssistantCard | null;
  entity_ref?: AssistantEntityRef | null;
  metadata: Record<string, unknown>;
};

export type AssistantRunStatus = "queued" | "running" | "interrupted" | "completed" | "failed" | "cancelled";

export type AssistantRunStep = {
  id: string;
  run_id: string;
  step_index: number;
  title: string;
  tool_name?: string | null;
  tool_kind?: AssistantToolKind | null;
  status: AssistantRunStatus | AssistantToolStatus;
  arguments?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error_text?: string | null;
  interrupt_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AssistantRun = {
  id: string;
  thread_id: string;
  origin_message_id?: string | null;
  orchestrator: "deterministic" | "runtime" | "hybrid";
  status: AssistantRunStatus;
  summary?: string | null;
  current_interrupt?: AssistantInterrupt | null;
  steps: AssistantRunStep[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
