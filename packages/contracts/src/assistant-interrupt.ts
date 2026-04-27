import type { AssistantEntityRef } from "./assistant-card";

export const ASSISTANT_INTERRUPT_FIELD_KINDS = [
  "text",
  "textarea",
  "select",
  "date",
  "time",
  "datetime",
  "toggle",
  "priority",
  "entity_search",
] as const;

export type AssistantInterruptFieldKind = (typeof ASSISTANT_INTERRUPT_FIELD_KINDS)[number];

export type AssistantInterruptField = {
  id: string;
  kind: AssistantInterruptFieldKind;
  label: string;
  required?: boolean;
  placeholder?: string;
  value?: unknown;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;
  metadata?: Record<string, unknown>;
};

export type AssistantInterruptType = "choice" | "form" | "confirm";
export type AssistantInterruptStatus = "pending" | "submitted" | "dismissed" | "expired";
export type AssistantInterruptDisplayMode = "inline" | "composer" | "sidecar" | "bottom_sheet";

export type AssistantInterrupt = {
  id: string;
  thread_id: string;
  run_id: string;
  status: AssistantInterruptStatus;
  interrupt_type: AssistantInterruptType;
  tool_name: string;
  title: string;
  body?: string | null;
  entity_ref?: AssistantEntityRef | null;
  fields: AssistantInterruptField[];
  primary_label: string;
  secondary_label?: string | null;
  display_mode?: AssistantInterruptDisplayMode | null;
  consequence_preview?: string | null;
  defer_label?: string | null;
  destructive?: boolean;
  recommended_defaults?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
  resolved_at?: string | null;
  resolution?: AssistantInterruptResolution | Record<string, unknown> | null;
};

export type AssistantInterruptResolution = {
  id: string;
  interrupt_id: string;
  action: "submit" | "dismiss";
  values: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
};
