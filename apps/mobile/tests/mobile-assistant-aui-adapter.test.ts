import type { AssistantThreadMessage } from "@starlog/contracts";
import {
  assistantUiThreadFingerprint,
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
];

const converted = starlogMessagesToAssistantUiMessages(messages);

assert.equal(converted.length, 2);
assert.equal(converted[0].role, "assistant");
assert.equal(converted[0].content, "I found two Library captures to process.\n\nAssistant action in progress.");
assert.equal(converted[1].role, "assistant");
assert.equal(converted[1].content, "Assistant action updated the thread.");
assert.deepEqual(converted[0].metadata?.custom, { starlogMessageId: "message-1" });
assert.equal(assistantUiThreadFingerprint(converted), "message-1:71|message-2:36");

console.log("mobile assistant-ui adapter tests passed");
