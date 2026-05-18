import type { AssistantDynamicUiPlacement } from "@starlog/contracts";
import type { DynamicUiSource } from "./registry";
import type { StarlogKnownRendererKey } from "./renderer-keys";

export type DynamicUiStructuredFieldKind = "string" | "number" | "boolean" | "object" | "array" | "record" | "unknown";

export type DynamicUiStructuredField = {
  path: string;
  kind: DynamicUiStructuredFieldKind;
  required: boolean;
  label: string;
};

export type DynamicUiRendererContract = {
  key: StarlogKnownRendererKey;
  version: number;
  sources: readonly DynamicUiSource[];
  defaultPlacement: AssistantDynamicUiPlacement;
  label: string;
  description: string;
  structuredContent: readonly DynamicUiStructuredField[];
  uiMeta: readonly DynamicUiStructuredField[];
};

export const STARLOG_DYNAMIC_UI_RENDERER_CONTRACTS = [
  {
    key: "interview.topic_unlock",
    version: 1,
    sources: ["tool_result", "card"],
    defaultPlacement: "thread",
    label: "Topic unlock",
    description: "Shows the user that a learning topic has been unlocked and why it is available now.",
    structuredContent: [
      { path: "topic_id", kind: "string", required: true, label: "Topic ID" },
      { path: "topic_title", kind: "string", required: true, label: "Topic title" },
      { path: "unlock_reason", kind: "string", required: false, label: "Unlock reason" },
    ],
    uiMeta: [{ path: "tone", kind: "string", required: false, label: "Tone" }],
  },
  {
    key: "interview.topic_read",
    version: 1,
    sources: ["tool_result", "card", "interrupt"],
    defaultPlacement: "thread",
    label: "Topic read",
    description: "Confirms or acknowledges a study topic as read and why it was tracked.",
    structuredContent: [
      { path: "topic_id", kind: "string", required: true, label: "Topic ID" },
      { path: "topic_title", kind: "string", required: false, label: "Topic title" },
      { path: "read_reason", kind: "string", required: false, label: "Read reason" },
    ],
    uiMeta: [{ path: "confidence", kind: "number", required: false, label: "Confidence" }],
  },
  {
    key: "interview.question_request",
    version: 1,
    sources: ["interrupt", "tool_result", "card"],
    defaultPlacement: "sidecar",
    label: "Question request",
    description: "Requests or previews a generated study question for a topic.",
    structuredContent: [
      { path: "topic_id", kind: "string", required: true, label: "Topic ID" },
      { path: "question_type", kind: "string", required: false, label: "Question type" },
      { path: "prompt", kind: "string", required: false, label: "Prompt" },
    ],
    uiMeta: [{ path: "density", kind: "string", required: false, label: "Density" }],
  },
  {
    key: "interview.review_grade",
    version: 1,
    sources: ["interrupt", "tool_result", "card"],
    defaultPlacement: "sidecar",
    label: "Review grade",
    description: "Collects or displays a recall grade for a review card.",
    structuredContent: [
      { path: "card_id", kind: "string", required: true, label: "Card ID" },
      { path: "grade", kind: "string", required: false, label: "Grade" },
      { path: "next_due_at", kind: "string", required: false, label: "Next due time" },
    ],
    uiMeta: [{ path: "tone", kind: "string", required: false, label: "Tone" }],
  },
  {
    key: "interview.recommendation_reason",
    version: 1,
    sources: ["tool_result", "card", "interrupt"],
    defaultPlacement: "thread",
    label: "Recommendation reason",
    description: "Explains why the assistant is recommending a review, topic, task, or focus.",
    structuredContent: [
      { path: "reason", kind: "string", required: true, label: "Reason" },
      { path: "evidence", kind: "array", required: false, label: "Evidence" },
      { path: "confidence", kind: "number", required: false, label: "Confidence" },
    ],
    uiMeta: [{ path: "tone", kind: "string", required: false, label: "Tone" }],
  },
  {
    key: "interview.why_this_now",
    version: 1,
    sources: ["interrupt", "tool_result", "card"],
    defaultPlacement: "thread",
    label: "Why this now",
    description: "Shows prioritized rationale for a time-sensitive recommendation.",
    structuredContent: [
      { path: "reason", kind: "string", required: true, label: "Reason" },
      { path: "impact", kind: "string", required: false, label: "Impact" },
      { path: "time_window", kind: "string", required: false, label: "Time window" },
    ],
    uiMeta: [{ path: "urgency", kind: "string", required: false, label: "Urgency" }],
  },
  {
    key: "request_due_date",
    version: 1,
    sources: ["interrupt", "tool_result", "card"],
    defaultPlacement: "sidecar",
    label: "Request due date",
    description: "Compatibility renderer for asking the user to set a task due date.",
    structuredContent: [
      { path: "task_id", kind: "string", required: false, label: "Task ID" },
      { path: "title", kind: "string", required: false, label: "Title" },
      { path: "current_due_at", kind: "string", required: false, label: "Current due time" },
    ],
    uiMeta: [],
  },
  {
    key: "triage_capture",
    version: 1,
    sources: ["interrupt", "tool_result", "card"],
    defaultPlacement: "sidecar",
    label: "Triage capture",
    description: "Compatibility renderer for classifying and routing a captured artifact.",
    structuredContent: [
      { path: "artifact_id", kind: "string", required: false, label: "Artifact ID" },
      { path: "title", kind: "string", required: false, label: "Title" },
      { path: "source_url", kind: "string", required: false, label: "Source URL" },
    ],
    uiMeta: [],
  },
  {
    key: "resolve_planner_conflict",
    version: 1,
    sources: ["interrupt", "tool_result", "card"],
    defaultPlacement: "sidecar",
    label: "Resolve planner conflict",
    description: "Compatibility renderer for repairing an internal or synced calendar conflict.",
    structuredContent: [
      { path: "conflict_id", kind: "string", required: false, label: "Conflict ID" },
      { path: "local", kind: "object", required: false, label: "Local event" },
      { path: "remote", kind: "object", required: false, label: "Remote event" },
      { path: "recommendation", kind: "string", required: false, label: "Recommendation" },
    ],
    uiMeta: [],
  },
  {
    key: "grade_review_recall",
    version: 1,
    sources: ["interrupt", "tool_result", "card"],
    defaultPlacement: "sidecar",
    label: "Grade review recall",
    description: "Compatibility renderer for grading a review-card recall attempt.",
    structuredContent: [
      { path: "card_id", kind: "string", required: false, label: "Card ID" },
      { path: "answer", kind: "string", required: false, label: "Answer" },
      { path: "grade_options", kind: "array", required: false, label: "Grade options" },
    ],
    uiMeta: [],
  },
  {
    key: "choose_morning_focus",
    version: 1,
    sources: ["interrupt", "tool_result", "card"],
    defaultPlacement: "composer",
    label: "Choose morning focus",
    description: "Compatibility renderer for selecting the user's first focus in the morning briefing flow.",
    structuredContent: [
      { path: "date", kind: "string", required: false, label: "Date" },
      { path: "options", kind: "array", required: false, label: "Options" },
      { path: "recommended_focus", kind: "string", required: false, label: "Recommended focus" },
    ],
    uiMeta: [],
  },
] as const satisfies readonly DynamicUiRendererContract[];
