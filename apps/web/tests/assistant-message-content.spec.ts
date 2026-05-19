import { expect, test } from "@playwright/test";
import type { AssistantThreadMessage } from "@starlog/contracts";
import { FALLBACK_RENDERER_KEY } from "@starlog/dynamic-ui";

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

test("known interrupt requests expose dynamic-ui assistant metadata and keep the data-part renderer", () => {
  const message: AssistantThreadMessage = {
    id: "msg_question_request_interrupt",
    thread_id: "thr_primary",
    run_id: "run_question_request",
    role: "assistant",
    status: "requires_action",
    parts: [
      {
        type: "interrupt_request",
        id: "part_question_request_interrupt",
        interrupt: {
          id: "interrupt-question-request",
          thread_id: "thr_primary",
          run_id: "run_question_request",
          tool_call_id: null,
          status: "pending",
          interrupt_type: "form",
          tool_name: "create_study_question_request",
          title: "Create a question",
          body: "Choose the prompt shape.",
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
          metadata: {},
          created_at: "2026-05-15T00:00:00.000Z",
          renderer_key: "interview.question_request",
          renderer_version: 1,
          placement: "sidecar",
          structured_content: {
            topic_id: "topic-1",
            topic_title: "Spaced repetition setup",
            prompt: "Explain why spaced repetition works.",
          },
          ui_meta: { density: "compact" },
        },
      },
    ],
    metadata: {},
    created_at: "2026-05-15T09:13:00.000Z",
    updated_at: "2026-05-15T09:13:00.000Z",
  };

  const converted = convertAssistantMessage(message);

  expect(converted.metadata?.custom?.starlog_dynamic_ui).toMatchObject({
    source: "interrupt",
    id: "interrupt-question-request",
    tool_call_id: "interrupt-question-request",
    renderer_key: "interview.question_request",
    requested_renderer_key: "interview.question_request",
    resolved_renderer_key: "interview.question_request",
    fallback_renderer_key: null,
    fallback: false,
    fallback_reason: null,
  });
  expect(converted.content).toContainEqual(
    expect.objectContaining({
      type: "data-interview.question_request",
      data: expect.objectContaining({
        source: "interrupt",
        input: expect.objectContaining({ id: "interrupt-question-request" }),
      }),
    }),
  );
});

test("review-grade tool result metadata wins over earlier non-review interrupt metadata", () => {
  const message: AssistantThreadMessage = {
    id: "msg_interrupt_before_review_grade",
    thread_id: "thr_primary",
    run_id: "run_mixed_dynamic_parts",
    role: "assistant",
    status: "requires_action",
    parts: [
      {
        type: "interrupt_request",
        id: "part_question_request_interrupt",
        interrupt: {
          id: "interrupt-question-request",
          thread_id: "thr_primary",
          run_id: "run_mixed_dynamic_parts",
          tool_call_id: "tool-call-question-request",
          status: "pending",
          interrupt_type: "form",
          tool_name: "create_study_question_request",
          title: "Create a question",
          fields: [],
          primary_label: "Create",
          metadata: {},
          created_at: "2026-05-15T00:00:00.000Z",
          renderer_key: "interview.question_request",
          renderer_version: 1,
          placement: "sidecar",
          structured_content: {
            topic_id: "topic-1",
            prompt: "Explain why spaced repetition works.",
          },
        },
      },
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
            grade: "4",
          },
          ui_meta: { tone: "review" },
          output: { grade: "4" },
          card: null,
          entity_ref: null,
          metadata: {},
        },
      },
    ],
    metadata: {},
    created_at: "2026-05-15T09:13:00.000Z",
    updated_at: "2026-05-15T09:13:00.000Z",
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
      type: "data-interview.question_request",
      data: expect.objectContaining({ source: "interrupt" }),
    }),
  );
  expect(converted.content).toContainEqual(
    expect.objectContaining({
      type: "data-interview.review_grade",
      data: expect.objectContaining({ source: "tool_result" }),
    }),
  );
});

test("interrupt metadata preserves an existing tool call id", () => {
  const message: AssistantThreadMessage = {
    id: "msg_interrupt_existing_tool_call",
    thread_id: "thr_primary",
    run_id: "run_question_request",
    role: "assistant",
    status: "requires_action",
    parts: [
      {
        type: "interrupt_request",
        id: "part_question_request_interrupt",
        interrupt: {
          id: "interrupt-question-request",
          thread_id: "thr_primary",
          run_id: "run_question_request",
          tool_call_id: "tool-call-question-request",
          status: "pending",
          interrupt_type: "form",
          tool_name: "create_study_question_request",
          title: "Create a question",
          fields: [],
          primary_label: "Create",
          metadata: {},
          created_at: "2026-05-15T00:00:00.000Z",
          renderer_key: "interview.question_request",
          renderer_version: 1,
          placement: "sidecar",
        },
      },
    ],
    metadata: {},
    created_at: "2026-05-15T09:13:00.000Z",
    updated_at: "2026-05-15T09:13:00.000Z",
  };

  const converted = convertAssistantMessage(message);

  expect(converted.metadata?.custom?.starlog_dynamic_ui).toMatchObject({
    source: "interrupt",
    id: "interrupt-question-request",
    tool_call_id: "tool-call-question-request",
    renderer_key: "interview.question_request",
    resolved_renderer_key: "interview.question_request",
    fallback: false,
  });
});

test("unknown interrupt renderers expose fallback metadata and keep the generic interrupt data-part", () => {
  const message: AssistantThreadMessage = {
    id: "msg_unknown_interrupt",
    thread_id: "thr_primary",
    run_id: "run_unknown_interrupt",
    role: "assistant",
    status: "requires_action",
    parts: [
      {
        type: "interrupt_request",
        id: "part_unknown_interrupt",
        interrupt: {
          id: "interrupt-unknown-renderer",
          thread_id: "thr_primary",
          run_id: "run_unknown_interrupt",
          status: "pending",
          interrupt_type: "choice",
          tool_name: "choose_unknown_panel",
          title: "Choose next move",
          body: "Pick the next action.",
          fields: [
            {
              id: "choice",
              kind: "select",
              label: "Choice",
              options: [
                { label: "Proceed", value: "proceed" },
                { label: "Pause", value: "pause" },
              ],
            },
          ],
          primary_label: "Continue",
          metadata: {},
          created_at: "2026-05-15T00:00:00.000Z",
          renderer_key: "custom.unknown_interrupt",
          renderer_version: 7,
          placement: "support_panel",
        },
      },
    ],
    metadata: {},
    created_at: "2026-05-15T09:13:00.000Z",
    updated_at: "2026-05-15T09:13:00.000Z",
  };

  const converted = convertAssistantMessage(message);

  expect(converted.metadata?.custom?.starlog_dynamic_ui).toMatchObject({
    source: "interrupt",
    id: "interrupt-unknown-renderer",
    tool_call_id: "interrupt-unknown-renderer",
    renderer_key: "custom.unknown_interrupt",
    requested_renderer_key: "custom.unknown_interrupt",
    resolved_renderer_key: FALLBACK_RENDERER_KEY,
    fallback_renderer_key: FALLBACK_RENDERER_KEY,
    renderer_version: 7,
    requested_renderer_version: 7,
    supported_renderer_version: null,
    placement: "support_panel",
    fallback: true,
    fallback_reason: "unknown_renderer",
  });
  expect(converted.content).toContainEqual(
    expect.objectContaining({
      type: "data-starlog-interrupt-request",
      data: expect.objectContaining({ id: "interrupt-unknown-renderer" }),
    }),
  );
});
