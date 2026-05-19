import { expect, test } from "@playwright/test";
import type { AssistantThreadMessage } from "@starlog/contracts";

import { convertAssistantMessage } from "../app/assistant/runtime/message-content";

test("review-grade tool results expose dynamic-ui assistant metadata and keep the data-part fallback", () => {
  const message: AssistantThreadMessage = {
    id: "msg_review_grade_result",
    thread_id: "thr_primary",
    run_id: "run_review_grade",
    role: "assistant",
    status: "complete",
    parts: [
      {
        type: "tool_result",
        id: "part_review_grade_result",
        tool_result: {
          id: "tool-result-review-grade",
          tool_call_id: "tool-call-review-grade",
          status: "complete",
          renderer_key: "interview.review_grade",
          renderer_version: 1,
          placement: "sidecar",
          structured_content: {
            card_id: "card_interview_1",
            prompt: "Explain the JavaScript event loop.",
            answer: "It coordinates queued work without blocking the main thread.",
            rating: "4",
            next_interval_label: "Review in 4 days",
            recommendation_reason: "Async JavaScript has been a recent weak spot.",
          },
          ui_meta: { tone: "review" },
          output: { rating: "4" },
          entity_ref: {
            entity_type: "card",
            entity_id: "card_interview_1",
            href: "/review?card=card_interview_1",
            title: "Event loop card",
          },
          metadata: {},
        },
      },
    ],
    metadata: {},
    created_at: "2026-04-21T09:13:00.000Z",
    updated_at: "2026-04-21T09:13:00.000Z",
  };

  const converted = convertAssistantMessage(message);

  expect(converted.metadata?.custom?.starlog_dynamic_ui).toMatchObject({
    source: "tool_result",
    id: "tool-result-review-grade",
    tool_call_id: "tool-call-review-grade",
    renderer_key: "interview.review_grade",
    resolved_renderer_key: "interview.review_grade",
    fallback: false,
  });
  expect(converted.content).toContainEqual(
    expect.objectContaining({
      type: "data-interview.review_grade",
      data: expect.objectContaining({
        source: "tool_result",
        input: expect.objectContaining({ id: "tool-result-review-grade" }),
      }),
    }),
  );
});
