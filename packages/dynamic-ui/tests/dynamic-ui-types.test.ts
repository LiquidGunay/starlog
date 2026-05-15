import type { AssistantCard, AssistantInterrupt, AssistantToolResult } from "@starlog/contracts";
import type { StarlogKnownRendererKey } from "../src";

const interrupt = {
  id: "interrupt-question-request",
  thread_id: "primary",
  run_id: "run-1",
  tool_call_id: "tool-call-question-request",
  status: "pending",
  interrupt_type: "form",
  tool_name: "create_study_question_request",
  title: "Request a question",
  fields: [],
  primary_label: "Create",
  metadata: {},
  created_at: "2026-05-15T00:00:00Z",
  renderer_key: "interview.question_request",
  renderer_version: 1,
  placement: "sidecar",
  structured_content: {
    topic_id: "topic-1",
  },
  ui_meta: {
    density: "compact",
  },
} satisfies AssistantInterrupt;

const result = {
  id: "tool-result-review-grade",
  tool_call_id: "tool-call-review-grade",
  status: "complete",
  output: {},
  card: null,
  metadata: {},
  renderer_key: "interview.review_grade",
  renderer_version: 1,
  placement: "thread",
  structured_content: {
    grade: "again",
  },
  ui_meta: {},
} satisfies AssistantToolResult;

const card = {
  kind: "review_queue",
  version: 1,
  title: "Review",
  actions: [],
  metadata: {},
  renderer_key: "interview.recommendation_reason",
  renderer_version: 1,
  placement: "thread",
  structured_content: {
    reason: "Repeated miss",
  },
  ui_meta: {},
} satisfies AssistantCard;

const knownRendererKey: StarlogKnownRendererKey = "interview.topic_unlock";

// @ts-expect-error Unknown renderers are allowed in contracts, not in the known renderer registry type.
const invalidKnownRendererKey: StarlogKnownRendererKey = "custom.unknown";

void interrupt;
void result;
void card;
void knownRendererKey;
void invalidKnownRendererKey;
