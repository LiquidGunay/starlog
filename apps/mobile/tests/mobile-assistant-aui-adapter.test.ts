import type { AssistantThreadMessage } from "@starlog/contracts";
import {
  assistantUiThreadFingerprint,
  starlogSnapshotToAssistantUiThread,
  starlogMessagesToAssistantUiMessages,
} from "../src/mobile-assistant-aui-adapter";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");

const messages: AssistantThreadMessage[] = [
  {
    id: "message-1",
    thread_id: "primary",
    role: "assistant",
    status: "running",
    created_at: "2026-05-01T10:00:00Z",
    parts: [
      { type: "text", id: "text-1", text: "I found two Library captures to process." },
      {
        type: "tool_call",
        id: "part-tool-1",
        tool_call: {
          id: "tool-1",
          tool_name: "summarize_artifact",
          tool_kind: "domain_tool",
          title: null,
          status: "running",
          arguments: {},
          metadata: {},
        },
      },
    ],
    metadata: {},
  },
  {
    id: "message-2",
    thread_id: "primary",
    role: "tool",
    status: "complete",
    created_at: "2026-05-01T10:01:00Z",
    parts: [
      {
        type: "tool_result",
        id: "part-result-1",
        tool_result: {
          id: "result-1",
          tool_call_id: "tool-1",
          status: "complete",
          output: { artifact_id: "artifact-1" },
          card: null,
          entity_ref: null,
          metadata: {},
        },
      },
    ],
    metadata: {},
  },
  {
    id: "message-3",
    thread_id: "primary",
    role: "assistant",
    status: "requires_action",
    created_at: "2026-05-01T10:02:00Z",
    parts: [
      { type: "text", id: "text-2", text: "I can turn this into an application review card." },
      {
        type: "card",
        id: "part-card-1",
        card: {
          kind: "learning_drill",
          version: 1,
          title: "Sliding window interview prompt",
          body: "Explain when to shrink the current window.",
          renderer_key: "interview.question_request",
          renderer_version: 1,
          placement: "thread",
          structured_content: { topic: "Sliding Window" },
          ui_meta: {},
          entity_ref: null,
          actions: [],
          metadata: {},
        },
      },
      {
        type: "interrupt_request",
        id: "part-interrupt-1",
        interrupt: {
          id: "interrupt-1",
          thread_id: "primary",
          run_id: "run-1",
          tool_call_id: "tool-2",
          status: "pending",
          interrupt_type: "form",
          tool_name: "grade_review_recall",
          title: "Grade this recall",
          body: "Choose the grade that matches your answer.",
          fields: [
            {
              id: "rating",
              kind: "select",
              label: "Rating",
              options: [
                { label: "Again", value: "again" },
                { label: "Good", value: "good" },
              ],
            },
          ],
          primary_label: "Save grade",
          secondary_label: "Skip",
          display_mode: "inline",
          renderer_key: "interview.review_grade",
          renderer_version: 1,
          placement: "inline",
          structured_content: { card_id: "card-1" },
          ui_meta: {},
          metadata: {},
          created_at: "2026-05-01T10:02:00Z",
        },
      },
    ],
    metadata: {},
  },
];

const converted = starlogMessagesToAssistantUiMessages(messages);
const pendingInterruptPart = messages[2].parts.find((part) => part.type === "interrupt_request");
if (!pendingInterruptPart || pendingInterruptPart.type !== "interrupt_request") {
  throw new Error("expected test snapshot to include an interrupt request");
}

assert.equal(converted.length, 2);
assert.equal(converted[0].role, "assistant");
assert.equal(converted[0].content, "I found two Library captures to process.");
assert.equal(converted[1].role, "assistant");
assert.equal(converted[1].content, "I can turn this into an application review card.");
assert.deepEqual(
  {
    starlogMessageId: converted[0].metadata.custom.starlogMessageId,
    starlogThreadId: converted[0].metadata.custom.starlogThreadId,
    richPartCount: converted[0].metadata.custom.richPartCount,
  },
  { starlogMessageId: "message-1", starlogThreadId: "primary", richPartCount: 1 },
);
assert.equal(converted[1].metadata.custom.richPartCount, 2);
assert.deepEqual(
  converted[1].metadata.custom.richParts.map((part) => ({
    type: part.type,
    label: part.label,
    rendererKey: part.rendererKey,
  })),
  [
    {
      type: "card",
      label: "Sliding window interview prompt",
      rendererKey: "interview.question_request",
    },
    {
      type: "interrupt_request",
      label: "Grade this recall",
      rendererKey: "interview.review_grade",
    },
  ],
);
assert.equal(converted[1].content.includes("interview.question_request"), false);
assert.equal(converted[1].content.includes("interview.review_grade"), false);
assert.equal(converted[1].content.includes("interrupt_request"), false);
assert.equal(converted[1].content.includes("grade_review_recall"), false);

const snapshotThread = starlogSnapshotToAssistantUiThread({
  id: "primary",
  slug: "primary",
  title: "Primary assistant thread",
  mode: "assistant",
  created_at: "2026-05-01T09:00:00Z",
  updated_at: "2026-05-01T10:02:00Z",
  messages,
  runs: [],
  interrupts: [pendingInterruptPart.interrupt],
});

assert.equal(snapshotThread.threadId, "primary");
assert.equal(snapshotThread.messages.length, 2);
assert.equal(snapshotThread.messages[0].metadata.custom.richParts[0].label, "Library update");
assert.deepEqual(snapshotThread.pendingInterruptIds, ["interrupt-1"]);
assert.equal(snapshotThread.richPartsByMessageId["message-3"].length, 2);

const originalFingerprint = assistantUiThreadFingerprint(converted);
const sameLengthEditedContent = "I found two Library captures to process!";
assert.equal(sameLengthEditedContent.length, String(converted[0].content).length);
const sameLengthEditFingerprint = assistantUiThreadFingerprint([
  { ...converted[0], content: sameLengthEditedContent },
  converted[1],
]);
assert.equal(originalFingerprint.startsWith("message-1:"), true);
assert.equal(originalFingerprint.includes("|message-3:"), true);
assert.equal(sameLengthEditFingerprint === originalFingerprint, false);

console.log("mobile assistant-ui adapter tests passed");
