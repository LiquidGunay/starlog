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

export const questionRequestInterrupt: AssistantInterrupt = {
  id: "interrupt-question-request",
  thread_id: "primary",
  run_id: "run-question-request",
  tool_call_id: "tool-call-question-request",
  status: "pending",
  interrupt_type: "form",
  tool_name: "create_study_question_request",
  title: "Request a question",
  body: "Choose the next prompt shape.",
  fields: [
    {
      id: "question_type",
      kind: "select",
      label: "Question type",
      required: true,
      options: [
        { label: "Recall", value: "recall" },
        { label: "Application", value: "application" },
      ],
    },
  ],
  primary_label: "Create",
  display_mode: "sidecar",
  recommended_defaults: { question_type: "recall" },
  metadata: {
    source: "fixture",
  },
  created_at: "2026-05-15T00:00:00Z",
  renderer_key: "interview.question_request",
  renderer_version: 1,
  placement: "sidecar",
  structured_content: {
    topic_id: "topic-1",
    topic_title: "Spaced repetition setup",
    question_type: "recall",
    prompt: "Explain why spaced repetition works.",
  },
  ui_meta: {
    density: "compact",
  },
};

export const reviewGradeResult: AssistantToolResult = {
  id: "tool-result-review-grade",
  tool_call_id: "tool-call-review-grade",
  status: "requires_action",
  renderer_key: "interview.review_grade",
  renderer_version: 1,
  placement: "sidecar",
  structured_content: {
    card_id: "card-1",
    grade: "again",
    next_due_at: "2026-05-16T09:00:00Z",
  },
  ui_meta: {
    tone: "review",
  },
  output: {
    card_id: "card-1",
    submitted: false,
  },
  card: null,
  entity_ref: {
    entity_type: "review_card",
    entity_id: "card-1",
    title: "Spacing effect",
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
