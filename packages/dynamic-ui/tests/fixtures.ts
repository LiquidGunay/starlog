import type { AssistantCard, AssistantInterrupt, AssistantToolResult } from "@starlog/contracts";

export const topicUnlockResult: AssistantToolResult = {
  id: "tool-result-topic-unlock",
  tool_call_id: "tool-call-topic-unlock",
  status: "complete",
  renderer_key: "interview.topic_unlock",
  renderer_version: 1,
  placement: "thread",
  structured_content: {
    topic_id: "topic-1",
    topic_title: "Spaced repetition setup",
  },
  ui_meta: {
    tone: "success",
  },
  output: {
    topic: {
      id: "topic-1",
      status: "unlocked",
    },
  },
  card: null,
  entity_ref: {
    entity_type: "study_topic",
    entity_id: "topic-1",
    title: "Spaced repetition setup",
  },
  metadata: {},
};

export const legacyMorningFocusInterrupt: AssistantInterrupt = {
  id: "interrupt-morning-focus",
  thread_id: "primary",
  run_id: "run-1",
  tool_call_id: null,
  status: "pending",
  interrupt_type: "choice",
  tool_name: "choose_morning_focus",
  title: "Choose morning focus",
  body: "Pick the first move.",
  fields: [
    {
      id: "focus",
      kind: "select",
      label: "First move",
      required: true,
      options: [
        { label: "Move project forward", value: "project" },
        { label: "Clear system friction", value: "friction" },
      ],
    },
  ],
  primary_label: "Confirm focus",
  secondary_label: "Later",
  display_mode: "inline",
  recommended_defaults: { focus: "project" },
  metadata: {
    source: "fixture",
  },
  created_at: "2026-05-15T00:00:00Z",
};

export const unknownRendererCard: AssistantCard = {
  kind: "custom.card",
  version: 1,
  renderer_key: "custom.unknown",
  renderer_version: 7,
  placement: "support_panel",
  title: "Custom card",
  body: "This renderer is not registered.",
  actions: [],
  metadata: {
    source: "fixture",
  },
};
