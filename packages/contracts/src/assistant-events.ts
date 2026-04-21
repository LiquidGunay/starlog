import type { AssistantCardAction, AssistantEntityRef } from "./assistant-card";

export const STARLOG_SURFACE_EVENT_KINDS = [
  "capture.created",
  "capture.enriched",
  "artifact.opened",
  "artifact.summarized",
  "task.created",
  "task.completed",
  "task.snoozed",
  "time_block.started",
  "time_block.completed",
  "planner.conflict.detected",
  "review.session.started",
  "review.answer.revealed",
  "review.answer.graded",
  "briefing.generated",
  "briefing.played",
  "assistant.card.action_used",
  "assistant.panel.submitted",
  "voice.capture.transcribed",
] as const;

export type StarlogSurfaceKey = "assistant" | "library" | "planner" | "review" | "desktop_helper" | "system";
export type StarlogSurfaceEventKind = (typeof STARLOG_SURFACE_EVENT_KINDS)[number];

export type AssistantSurfaceEvent = {
  id: string;
  thread_id?: string | null;
  source_surface: StarlogSurfaceKey;
  kind: StarlogSurfaceEventKind | string;
  entity_ref?: AssistantEntityRef | null;
  payload: Record<string, unknown>;
  visibility?: "internal" | "ambient" | "assistant_message";
  projected_message?: boolean;
  created_at: string;
};

export type AssistantAmbientUpdate = {
  id: string;
  event_id: string;
  label: string;
  body?: string | null;
  entity_ref?: AssistantEntityRef | null;
  actions?: AssistantCardAction[];
  metadata: Record<string, unknown>;
  created_at: string;
};
