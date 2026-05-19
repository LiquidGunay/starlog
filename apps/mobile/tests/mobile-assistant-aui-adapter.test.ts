import type {
  AssistantThreadMessage,
  AssistantThreadSnapshot,
  AssistantToolCall,
  AssistantToolResult,
} from "@starlog/contracts";
import { FALLBACK_RENDERER_KEY, type DynamicUiAssistantUiDescriptor } from "../../../packages/dynamic-ui/src";
import {
  assistantUiThreadFingerprint,
  isDiagnosticAssistantToolCall,
  isDiagnosticAssistantToolResult,
  MOBILE_ASSISTANT_UI_TEST_MARKERS,
  mobileDynamicPanelInterruptsFromAssistantUiMessage,
  mobileDynamicPanelInterruptsFromStarlogMessage,
  mobileDynamicUiBadge,
  mobileNativeDynamicPanelPartIdsFromStarlogMessage,
  starlogMessagesToAssistantUiMessages,
  starlogRichPartsForMessage,
  starlogSnapshotToAssistantUiThread,
} from "../src/mobile-assistant-aui-adapter";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
  ok: (...args: unknown[]) => void;
  notEqual: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");

const createdAt = "2026-05-16T12:00:00.000Z";

function starlogDynamicUiDescriptor(part: ReturnType<typeof starlogRichPartsForMessage>[number]): DynamicUiAssistantUiDescriptor {
  const descriptor = part.metadata?.custom.starlog_dynamic_ui;
  if (!descriptor) {
    throw new Error("Expected mobile rich part to include metadata.custom.starlog_dynamic_ui.");
  }
  return descriptor;
}

function reviewGradeMessage(): AssistantThreadMessage {
  return {
    id: "msg_review_interrupt",
    thread_id: "thread_primary",
    run_id: "run_review",
    role: "assistant",
    status: "requires_action",
    created_at: createdAt,
    updated_at: createdAt,
    metadata: {},
    parts: [
      {
        type: "text",
        id: "part_text",
        text: "You revealed the answer in Review. Grade the recall and I will update the card schedule.",
      },
      {
        type: "interrupt_request",
        id: "part_interrupt",
        interrupt: {
          id: "interrupt_review_grade_1",
          thread_id: "thread_primary",
          run_id: "run_review",
          tool_call_id: "toolcall_review_grade_1",
          status: "pending",
          interrupt_type: "choice",
          tool_name: "grade_review_recall",
          title: "Grade Recall",
          body: "How well did you remember this card?",
          renderer_key: "interview.review_grade",
          renderer_version: 1,
          placement: "inline",
          structured_content: {
            card_id: "card_ml_vectors",
            grade: null,
            next_due_at: null,
          },
          ui_meta: {
            tone: "review",
            review_mode: "recall",
            card_type: "interview",
          },
          fields: [
            {
              id: "grade",
              kind: "select",
              label: "Recall quality",
              required: true,
              options: [
                { label: "Again", value: "again" },
                { label: "Good", value: "good" },
              ],
            },
          ],
          primary_label: "Save grade",
          secondary_label: "Keep in Review",
          display_mode: "inline",
          metadata: {
            card_id: "card_ml_vectors",
            review_mode: "recall",
          },
          created_at: createdAt,
        },
      },
    ],
  };
}

function snapshot(messages: AssistantThreadMessage[]): AssistantThreadSnapshot {
  return {
    id: "thread_primary",
    slug: "primary",
    title: "Primary Assistant",
    mode: "default",
    created_at: createdAt,
    updated_at: createdAt,
    last_message_at: createdAt,
    last_preview_text: "Review grade",
    messages,
    runs: [],
    interrupts: [],
    context_cards: [],
    next_cursor: null,
  };
}

function runTests() {
  {
    assert.deepEqual(MOBILE_ASSISTANT_UI_TEST_MARKERS, {
      shell: "assistant-ui shell",
      thread: "assistant-ui thread",
      composer: "assistant-ui composer",
      composerInput: "assistant-ui composer input",
    });
  }

  {
    assert.equal(mobileDynamicUiBadge({ rendererKey: "interview.review_grade", placement: "inline" }), "Review grade · Inline panel");
    assert.equal(mobileDynamicUiBadge({ rendererKey: "grade_review_recall", placement: "inline" }), "Grade review recall · Inline panel");
    assert.equal(mobileDynamicUiBadge({ rendererKey: "interview.review_grade" }), "Review grade · Inline on mobile");
    assert.equal(mobileDynamicUiBadge({ rendererKey: "unknown.renderer", placement: "inline" }), null);
    assert.equal(mobileDynamicUiBadge({ rendererKey: null }), null);
  }

  {
    const message: AssistantThreadMessage = {
      id: "msg_unknown_renderer",
      thread_id: "thread_primary",
      run_id: "run_review",
      role: "assistant",
      status: "complete",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: [
        {
          type: "card",
          id: "part_unknown_card",
          card: {
            kind: "assistant_summary",
            version: 1,
            title: null,
            body: "Summary for fallback card.",
            renderer_key: "legacy.review_grade",
            renderer_version: 3,
            placement: "bottom_sheet",
            structured_content: { mode: "legacy", reason: "compat" },
            ui_meta: { source: "legacy" },
            metadata: {},
            entity_ref: null,
            actions: [],
          },
        },
      ],
    };
    const richParts = starlogRichPartsForMessage(message);
    assert.equal(richParts.length, 1);
    const [part] = richParts;
    assert.equal(part.type, "card");
    assert.equal(part.label, "Assistant Summary");
    assert.equal(part.rendererLabel, undefined);
    assert.equal(part.requestedRendererKey, "legacy.review_grade");
    assert.equal(part.resolvedRendererKey, null);
    assert.equal(part.rendererVersion, 3);
    assert.equal(part.placement, "bottom_sheet");
    assert.equal(part.placementLabel, "Bottom sheet");
    assert.equal(part.fallback, true);
    assert.equal(part.fallbackReason, "No registered mobile renderer; using generic card rendering.");
    assert.deepEqual(part.structuredContent, { mode: "legacy", reason: "compat" });
    assert.deepEqual(part.uiMeta, { source: "legacy" });
    const descriptor = starlogDynamicUiDescriptor(part);
    assert.equal(descriptor.source, "card");
    assert.equal(descriptor.renderer_key, "legacy.review_grade");
    assert.equal(descriptor.requested_renderer_key, "legacy.review_grade");
    assert.equal(descriptor.resolved_renderer_key, FALLBACK_RENDERER_KEY);
    assert.equal(descriptor.fallback_renderer_key, FALLBACK_RENDERER_KEY);
    assert.equal(descriptor.renderer_version, 3);
    assert.equal(descriptor.placement, "bottom_sheet");
    assert.deepEqual(descriptor.structured_content, { mode: "legacy", reason: "compat" });
    assert.deepEqual(descriptor.ui_meta, { source: "legacy" });
    assert.equal(descriptor.fallback, true);
    assert.equal(descriptor.fallback_reason, "unknown_renderer");
  }

  {
    const message: AssistantThreadMessage = {
      id: "msg_unknown_interrupt_renderer",
      thread_id: "thread_primary",
      run_id: "run_review",
      role: "assistant",
      status: "requires_action",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: [
        {
          type: "interrupt_request",
          id: "part_unknown_interrupt",
          interrupt: {
            id: "interrupt_legacy_1",
            thread_id: "thread_primary",
            run_id: "run_review",
            status: "pending",
            interrupt_type: "choice",
            tool_name: "grade_review_recall",
            title: "Legacy review panel",
            body: "Legacy review details.",
            renderer_key: "legacy.review_grade",
            renderer_version: 2,
            placement: "bottom_sheet",
            structured_content: {
              card_id: "card_ml_vectors",
              reason: "legacy protocol bridge",
            },
            ui_meta: {
              source: "legacy",
              tone: "review",
            },
            fields: [
              {
                id: "grade",
                kind: "select",
                label: "Quality",
                required: true,
                options: [
                  { label: "Good", value: "good" },
                  { label: "Great", value: "great" },
                ],
              },
            ],
            primary_label: "Save grade",
            secondary_label: "Later",
            display_mode: "inline",
            metadata: {},
            created_at: createdAt,
          },
        },
      ],
    };

    const richParts = starlogRichPartsForMessage(message);
    assert.equal(richParts.length, 1);
    const [part] = richParts;
    assert.equal(part.type, "interrupt_request");
    assert.equal(part.requestedRendererKey, "legacy.review_grade");
    assert.equal(part.resolvedRendererKey, null);
    assert.equal(part.fallback, true);
    assert.equal(part.fallbackReason, "No registered mobile renderer; using generic interrupt panel rendering.");
    assert.equal(part.placement, "bottom_sheet");
    assert.equal(part.placementLabel, "Bottom sheet");
    assert.deepEqual(part.structuredContent, {
      card_id: "card_ml_vectors",
      reason: "legacy protocol bridge",
    });
    assert.deepEqual(part.uiMeta, {
      source: "legacy",
      tone: "review",
    });
    const descriptor = starlogDynamicUiDescriptor(part);
    assert.equal(descriptor.source, "interrupt");
    assert.equal(descriptor.id, "interrupt_legacy_1");
    assert.equal(descriptor.tool_call_id, null);
    assert.equal(descriptor.renderer_key, "legacy.review_grade");
    assert.equal(descriptor.requested_renderer_key, "legacy.review_grade");
    assert.equal(descriptor.resolved_renderer_key, FALLBACK_RENDERER_KEY);
    assert.equal(descriptor.fallback_renderer_key, FALLBACK_RENDERER_KEY);
    assert.equal(descriptor.renderer_version, 2);
    assert.equal(descriptor.placement, "bottom_sheet");
    assert.deepEqual(descriptor.structured_content, {
      card_id: "card_ml_vectors",
      reason: "legacy protocol bridge",
    });
    assert.deepEqual(descriptor.ui_meta, {
      source: "legacy",
      tone: "review",
    });
    assert.equal(descriptor.fallback, true);
    assert.equal(descriptor.fallback_reason, "unknown_renderer");
  }

  {
    const message = reviewGradeMessage();
    const richParts = starlogRichPartsForMessage(message);
    assert.equal(richParts.length, 1);
    const [part] = richParts;
    assert.equal(part.type, "interrupt_request");
    assert.equal(part.label, "Grade Recall");
    assert.equal(part.rendererLabel, "Review grade");
    assert.equal(part.requestedRendererKey, "interview.review_grade");
    assert.equal(part.resolvedRendererKey, "interview.review_grade");
    assert.equal(part.rendererVersion, 1);
    assert.equal(part.placement, "inline");
    assert.equal(part.placementLabel, "Inline panel");
    assert.equal(part.fallback, false);
    assert.deepEqual(part.structuredContent, {
      card_id: "card_ml_vectors",
      grade: null,
      next_due_at: null,
    });
    assert.deepEqual(part.uiMeta, {
      tone: "review",
      review_mode: "recall",
      card_type: "interview",
    });
    const descriptor = starlogDynamicUiDescriptor(part);
    assert.equal(descriptor.source, "interrupt");
    assert.equal(descriptor.id, "interrupt_review_grade_1");
    assert.equal(descriptor.tool_call_id, "toolcall_review_grade_1");
    assert.equal(descriptor.renderer_key, "interview.review_grade");
    assert.equal(descriptor.requested_renderer_key, "interview.review_grade");
    assert.equal(descriptor.resolved_renderer_key, "interview.review_grade");
    assert.equal(descriptor.fallback_renderer_key, null);
    assert.equal(descriptor.renderer_version, 1);
    assert.equal(descriptor.requested_renderer_version, 1);
    assert.equal(descriptor.supported_renderer_version, 1);
    assert.equal(descriptor.placement, "inline");
    assert.deepEqual(descriptor.structured_content, {
      card_id: "card_ml_vectors",
      grade: null,
      next_due_at: null,
    });
    assert.deepEqual(descriptor.ui_meta, {
      tone: "review",
      review_mode: "recall",
      card_type: "interview",
    });
    assert.equal(descriptor.fallback, false);
    assert.equal(descriptor.fallback_reason, null);
    assert.ok(!String(part.rendererLabel).includes("interview.review_grade"));
    assert.ok(!String(part.rendererLabel).includes("grade_review_recall"));
  }

  {
    const [converted] = starlogMessagesToAssistantUiMessages([reviewGradeMessage()]);
    assert.ok(converted);
    assert.equal(converted.role, "assistant");
    assert.equal(converted.content.includes("Grade the recall"), true);
    assert.equal(converted.metadata.custom.starlogStatus, "requires_action");
    assert.equal(converted.metadata.custom.transcriptKind, "text");
    assert.equal(converted.metadata.custom.richPartCount, 1);
    assert.equal(converted.metadata.custom.richParts[0]?.rendererLabel, "Review grade");
    assert.equal(converted.metadata.custom.starlog_dynamic_ui?.renderer_key, "interview.review_grade");
    assert.equal(converted.metadata.custom.starlog_dynamic_ui?.resolved_renderer_key, "interview.review_grade");

    const [panelInterrupt] = mobileDynamicPanelInterruptsFromAssistantUiMessage(converted);
    assert.ok(panelInterrupt);
    assert.equal(panelInterrupt.id, "interrupt_review_grade_1");
    assert.equal(panelInterrupt.run_id, "run_review");
    assert.equal(panelInterrupt.status, "pending");
    assert.equal(panelInterrupt.tool_name, "grade_review_recall");
    assert.equal(panelInterrupt.renderer_key, "interview.review_grade");
    assert.equal(panelInterrupt.display_mode, "inline");
    assert.equal(panelInterrupt.title, "Grade review");
    assert.equal(panelInterrupt.fields[0]?.id, "rating");
    assert.equal(panelInterrupt.fields[0]?.value, "good");
    assert.deepEqual(panelInterrupt.recommended_defaults, { rating: "good" });
  }

  {
    const message = reviewGradeMessage();
    message.run_id = null;
    const [panelInterrupt] = mobileDynamicPanelInterruptsFromStarlogMessage(message);
    assert.ok(panelInterrupt);
    assert.equal(Object.prototype.hasOwnProperty.call(panelInterrupt, "run_id"), false);
  }

  {
    const message = reviewGradeMessage();
    const liveInterrupt = {
      ...(message.parts[1] as Extract<AssistantThreadMessage["parts"][number], { type: "interrupt_request" }>).interrupt,
      status: "submitted" as const,
      title: "Live Grade Recall",
      resolved_at: "2026-05-16T12:03:00.000Z",
      resolution: {
        id: "resolution_review_grade_1",
        interrupt_id: "interrupt_review_grade_1",
        action: "submit" as const,
        values: { rating: "easy" },
        metadata: {},
        created_at: "2026-05-16T12:03:00.000Z",
      },
    };
    const [panelInterrupt] = mobileDynamicPanelInterruptsFromStarlogMessage(message, { liveInterrupts: [liveInterrupt] });
    assert.equal(panelInterrupt, liveInterrupt);
    assert.equal(panelInterrupt?.status, "submitted");
    assert.equal(panelInterrupt?.title, "Live Grade Recall");
    assert.deepEqual(panelInterrupt?.resolution, liveInterrupt.resolution);
  }

  {
    const topicUnlockResult: AssistantToolResult = {
      id: "tool_result_topic_unlock",
      tool_call_id: "tool_call_topic_unlock",
      status: "complete",
      output: {
        topic_id: "topic_spaced_repetition",
        unlocked: true,
      },
      renderer_key: "interview.topic_unlock",
      renderer_version: 1,
      placement: "thread",
      structured_content: {
        topic_id: "topic_spaced_repetition",
        topic_title: "Spaced repetition setup",
        unlock_reason: "Enough source material is available.",
      },
      ui_meta: {
        tone: "success",
      },
      card: null,
      entity_ref: null,
      metadata: {},
    };
    const message: AssistantThreadMessage = {
      id: "msg_topic_unlock",
      thread_id: "thread_primary",
      run_id: "run_learning",
      role: "assistant",
      status: "complete",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: [
        {
          type: "tool_result",
          id: "part_topic_unlock",
          tool_result: topicUnlockResult,
        },
      ],
    };

    const [part] = starlogRichPartsForMessage(message);
    assert.ok(part);
    assert.equal(part.type, "tool_result");
    assert.equal(part.rendererLabel, "Topic unlock");
    assert.equal(part.requestedRendererKey, "interview.topic_unlock");
    assert.equal(part.resolvedRendererKey, "interview.topic_unlock");
    assert.equal(part.placement, "thread");
    assert.equal(part.placementLabel, "Thread panel");
    assert.equal(part.fallback, false);
    const descriptor = starlogDynamicUiDescriptor(part);
    assert.equal(descriptor.source, "tool_result");
    assert.equal(descriptor.id, "tool_result_topic_unlock");
    assert.equal(descriptor.tool_call_id, "tool_call_topic_unlock");
    assert.equal(descriptor.renderer_key, "interview.topic_unlock");
    assert.equal(descriptor.requested_renderer_key, "interview.topic_unlock");
    assert.equal(descriptor.resolved_renderer_key, "interview.topic_unlock");
    assert.equal(descriptor.fallback_renderer_key, null);
    assert.equal(descriptor.renderer_version, 1);
    assert.equal(descriptor.requested_renderer_version, 1);
    assert.equal(descriptor.supported_renderer_version, 1);
    assert.equal(descriptor.placement, "thread");
    assert.deepEqual(descriptor.structured_content, {
      topic_id: "topic_spaced_repetition",
      topic_title: "Spaced repetition setup",
      unlock_reason: "Enough source material is available.",
    });
    assert.deepEqual(descriptor.ui_meta, {
      tone: "success",
    });
    assert.equal(descriptor.fallback, false);
    assert.equal(descriptor.fallback_reason, null);

    const [converted] = starlogMessagesToAssistantUiMessages([message]);
    assert.ok(converted);
    assert.equal(converted.content, "Topic unlock");
    assert.equal(converted.metadata.custom.starlog_dynamic_ui?.renderer_key, "interview.topic_unlock");

    const [panelInterrupt] = mobileDynamicPanelInterruptsFromAssistantUiMessage(converted);
    assert.ok(panelInterrupt);
    assert.equal(panelInterrupt.id, "tool_result_topic_unlock");
    assert.equal(panelInterrupt.status, "submitted");
    assert.equal(panelInterrupt.tool_name, "interview.topic_unlock");
    assert.equal(panelInterrupt.title, "Spaced repetition setup");
    assert.equal(panelInterrupt.body, "Enough source material is available.");
    assert.equal(panelInterrupt.primary_label, "Open topic");
    assert.deepEqual(panelInterrupt.fields, []);
  }

  {
    const message: AssistantThreadMessage = {
      id: "msg_question_request",
      thread_id: "thread_primary",
      run_id: "run_learning",
      role: "assistant",
      status: "requires_action",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: [
        {
          type: "interrupt_request",
          id: "part_question_request",
          interrupt: {
            id: "interrupt_question_request",
            thread_id: "thread_primary",
            run_id: "run_learning",
            tool_call_id: "tool_call_question_request",
            status: "pending",
            interrupt_type: "form",
            tool_name: "create_study_question_request",
            title: "Request a question",
            body: "Choose the next question shape.",
            renderer_key: "interview.question_request",
            renderer_version: 1,
            placement: "sidecar",
            structured_content: {
              topic_id: "topic_spaced_repetition",
              question_type: "recall",
              prompt: "Explain why spaced repetition works.",
            },
            ui_meta: {
              density: "compact",
            },
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
            primary_label: "Create question",
            secondary_label: "Later",
            display_mode: "sidecar",
            metadata: {},
            created_at: createdAt,
          },
        },
      ],
    };

    const [part] = starlogRichPartsForMessage(message);
    assert.ok(part);
    assert.equal(part.type, "interrupt_request");
    assert.equal(part.label, "Request a question");
    assert.equal(part.rendererLabel, "Question request");
    assert.equal(part.requestedRendererKey, "interview.question_request");
    assert.equal(part.resolvedRendererKey, "interview.question_request");
    assert.equal(part.placement, "sidecar");
    assert.equal(part.placementLabel, "Inline on mobile");
    assert.equal(part.fallback, false);
    const descriptor = starlogDynamicUiDescriptor(part);
    assert.equal(descriptor.source, "interrupt");
    assert.equal(descriptor.id, "interrupt_question_request");
    assert.equal(descriptor.tool_call_id, "tool_call_question_request");
    assert.equal(descriptor.renderer_key, "interview.question_request");
    assert.equal(descriptor.requested_renderer_key, "interview.question_request");
    assert.equal(descriptor.resolved_renderer_key, "interview.question_request");
    assert.equal(descriptor.fallback_renderer_key, null);
    assert.equal(descriptor.renderer_version, 1);
    assert.equal(descriptor.requested_renderer_version, 1);
    assert.equal(descriptor.supported_renderer_version, 1);
    assert.equal(descriptor.placement, "sidecar");
    assert.deepEqual(descriptor.structured_content, {
      topic_id: "topic_spaced_repetition",
      question_type: "recall",
      prompt: "Explain why spaced repetition works.",
    });
    assert.deepEqual(descriptor.ui_meta, {
      density: "compact",
    });
    assert.equal(descriptor.fallback, false);
    assert.equal(descriptor.fallback_reason, null);

    const [converted] = starlogMessagesToAssistantUiMessages([message]);
    assert.ok(converted);
    const [panelInterrupt] = mobileDynamicPanelInterruptsFromAssistantUiMessage(converted);
    assert.ok(panelInterrupt);
    assert.equal(panelInterrupt.id, "interrupt_question_request");
    assert.equal(panelInterrupt.status, "pending");
    assert.equal(panelInterrupt.tool_name, "interview.question_request");
    assert.equal(panelInterrupt.title, "Request a question");
    assert.equal(panelInterrupt.body, "Explain why spaced repetition works.");
    assert.equal(panelInterrupt.display_mode, "sidecar");
    assert.equal(panelInterrupt.fields[0]?.id, "question_type");
    assert.equal(panelInterrupt.fields[0]?.value, "recall");
    assert.deepEqual(panelInterrupt.recommended_defaults, { question_type: "recall" });
  }

  {
    const message: AssistantThreadMessage = {
      id: "msg_topic_read_and_why_now",
      thread_id: "thread_primary",
      run_id: "run_learning",
      role: "assistant",
      status: "complete",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: [
        {
          type: "tool_result",
          id: "part_topic_read",
          tool_result: {
            id: "tool_result_topic_read",
            tool_call_id: "tool_call_topic_read",
            status: "complete",
            output: { topic_id: "topic_sliding_window", read: true },
            renderer_key: "interview.topic_read",
            renderer_version: 1,
            placement: "thread",
            structured_content: {
              topic_id: "topic_sliding_window",
              topic_title: "Sliding Window Interview Patterns",
              read_reason: "Marked read after the source walkthrough.",
            },
            ui_meta: { confidence: 0.92 },
            card: null,
            entity_ref: null,
            metadata: {},
          },
        },
        {
          type: "card",
          id: "part_why_now",
          card: {
            kind: "assistant_summary",
            version: 1,
            title: "Why this now",
            body: "One application card is due after the topic unlock.",
            renderer_key: "interview.why_this_now",
            renderer_version: 1,
            placement: "thread",
            structured_content: {
              reason: "You just unlocked this topic and one application card is due.",
              impact: "Practice now while the source is fresh.",
              time_window: "today",
            },
            ui_meta: { urgency: "medium" },
            metadata: {},
            entity_ref: null,
            actions: [],
          },
        },
      ],
    };

    const panelInterrupts = mobileDynamicPanelInterruptsFromStarlogMessage(message);
    assert.equal(panelInterrupts.length, 2);
    assert.equal(panelInterrupts[0].tool_name, "interview.topic_read");
    assert.equal(panelInterrupts[0].title, "Sliding Window Interview Patterns");
    assert.equal(panelInterrupts[0].body, "Marked read after the source walkthrough.");
    assert.equal(panelInterrupts[1].tool_name, "interview.why_this_now");
    assert.equal(panelInterrupts[1].title, "Why this now");
    assert.equal(
      panelInterrupts[1].body,
      "You just unlocked this topic and one application card is due. Practice now while the source is fresh.",
    );
    assert.equal(panelInterrupts[1].metadata.ui_meta && (panelInterrupts[1].metadata.ui_meta as Record<string, unknown>).urgency, "medium");

    assert.deepEqual(mobileNativeDynamicPanelPartIdsFromStarlogMessage(message), ["part_topic_read", "part_why_now"]);
  }

  {
    const richOnlyMessage: AssistantThreadMessage = {
      id: "msg_review_interrupt_only",
      thread_id: "thread_primary",
      run_id: "run_review",
      role: "assistant",
      status: "requires_action",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: reviewGradeMessage().parts.filter((part) => part.type === "interrupt_request"),
    };
    const [converted] = starlogMessagesToAssistantUiMessages([richOnlyMessage]);
    assert.ok(converted);
    assert.equal(converted.content, "Review grade");
    assert.equal(converted.metadata.custom.transcriptKind, "rich_fallback");
    assert.equal(converted.metadata.custom.richPartCount, 1);
    assert.equal(converted.metadata.custom.richParts[0]?.placementLabel, "Inline panel");
  }

  {
    const thread = starlogSnapshotToAssistantUiThread(snapshot([reviewGradeMessage()]));
    assert.equal(thread.id, "thread_primary");
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.metadata.custom.starlogSlug, "primary");
    assert.equal(typeof assistantUiThreadFingerprint(thread.messages), "string");
    assert.equal(thread.messages[0]?.content, "You revealed the answer in Review. Grade the recall and I will update the card schedule.");
  }

  {
    const diagnosticOnlyMessage: AssistantThreadMessage = {
      id: "msg_diagnostic_only",
      thread_id: "thread_primary",
      run_id: "run_protocol",
      role: "assistant",
      status: "complete",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: [
        {
          type: "card",
          id: "part_tool_step",
          card: {
            kind: "tool_step",
            version: 1,
            title: "ASSISTANT STEP",
            body: "PROVIDER HINT: route this through the default model.",
            renderer_key: null,
            renderer_version: null,
            placement: "thread",
            structured_content: null,
            ui_meta: null,
            metadata: {},
            entity_ref: null,
            actions: [],
          },
        },
      ],
    };
    const [converted] = starlogMessagesToAssistantUiMessages([diagnosticOnlyMessage]);
    assert.ok(converted);
    assert.equal(converted.content, "Assistant details updated.");
    assert.equal(converted.metadata.custom.transcriptKind, "rich_fallback");
    assert.equal(converted.metadata.custom.richParts[0]?.diagnostic, true);
    assert.equal(converted.content.includes("ASSISTANT STEP"), false);
    assert.equal(converted.content.includes("PROVIDER HINT"), false);
  }

  {
    const diagnosticToolCall: AssistantToolCall = {
      id: "tool_call_capabilities",
      tool_name: "list_dynamic_ui_capabilities",
      tool_kind: "system_tool",
      status: "complete",
      arguments: {},
      title: "ASSISTANT STEP",
      metadata: {
        tool_name: "list_dynamic_ui_capabilities",
      },
    };
    const diagnosticToolResult: AssistantToolResult = {
      id: "tool_result_capabilities",
      tool_call_id: "tool_call_capabilities",
      status: "complete",
      output: {
        command_examples: ["I read vectors", "quiz me on embeddings"],
        renderers: ["interview.topic_unlock", "interview.review_grade"],
        surfaces: ["assistant", "review"],
        ui_tools: ["topic unlock", "review grading"],
      },
      renderer_key: null,
      renderer_version: null,
      placement: null,
      structured_content: null,
      ui_meta: null,
      card: null,
      entity_ref: null,
      metadata: {
        tool_name: "list_dynamic_ui_capabilities",
      },
    };

    assert.equal(isDiagnosticAssistantToolCall(diagnosticToolCall), true);
    assert.equal(isDiagnosticAssistantToolResult(diagnosticToolResult), true);

    const message: AssistantThreadMessage = {
      id: "msg_capabilities_response",
      thread_id: "thread_primary",
      run_id: "run_protocol",
      role: "assistant",
      status: "complete",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: [
        {
          type: "text",
          id: "part_capabilities_text",
          text: "I can request Starlog dynamic UI for topic unlocks, question requests, and review grading.",
        },
        {
          type: "tool_call",
          id: "part_capabilities_call",
          tool_call: diagnosticToolCall,
        },
        {
          type: "tool_result",
          id: "part_capabilities_result",
          tool_result: diagnosticToolResult,
        },
      ],
    };

    const richParts = starlogRichPartsForMessage(message);
    assert.equal(richParts.length, 2);
    assert.equal(richParts.every((part) => part.diagnostic), true);

    const [converted] = starlogMessagesToAssistantUiMessages([message]);
    assert.ok(converted);
    assert.equal(converted.content, "I can request Starlog dynamic UI for topic unlocks, question requests, and review grading.");
    assert.equal(converted.content.includes("ASSISTANT STEP"), false);
    assert.equal(converted.content.includes("COMMAND EXAMPLES"), false);
    assert.equal(converted.content.includes("RENDERERS"), false);
    assert.equal(converted.metadata.custom.richPartCount, 2);
    assert.equal(converted.metadata.custom.richParts.every((part) => part.diagnostic), true);
  }

  {
    const dynamicToolResult: AssistantToolResult = {
      id: "tool_result_review_grade",
      tool_call_id: "tool_call_review_grade",
      status: "complete",
      output: {
        card_id: "card_ml_vectors",
        grade: "good",
      },
      renderer_key: "interview.review_grade",
      renderer_version: 1,
      placement: "inline",
      structured_content: {
        card_id: "card_ml_vectors",
        grade: "good",
      },
      ui_meta: {
        tone: "review",
      },
      card: null,
      entity_ref: null,
      metadata: {},
    };

    assert.equal(isDiagnosticAssistantToolResult(dynamicToolResult), false);

    const message: AssistantThreadMessage = {
      id: "msg_review_result",
      thread_id: "thread_primary",
      run_id: "run_review",
      role: "assistant",
      status: "complete",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: [
        {
          type: "tool_result",
          id: "part_review_result",
          tool_result: dynamicToolResult,
        },
      ],
    };

    const [richPart] = starlogRichPartsForMessage(message);
    assert.ok(richPart);
    assert.equal(richPart.diagnostic, false);
    assert.equal(richPart.rendererLabel, "Review grade");

    const [converted] = starlogMessagesToAssistantUiMessages([message]);
    assert.ok(converted);
    assert.equal(converted.content, "Review grade");
    assert.equal(converted.metadata.custom.transcriptKind, "rich_fallback");
  }

  {
    const legacyToolResult: AssistantToolResult = {
      id: "tool_result_legacy_grade",
      tool_call_id: "tool_call_legacy_review",
      status: "complete",
      output: {
        card_id: "card_ml_vectors",
        grade: "great",
      },
      renderer_key: "legacy.review_grade",
      renderer_version: 2,
      placement: "bottom_sheet",
      structured_content: {
        card_id: "card_ml_vectors",
        grade: "great",
      },
      ui_meta: {
        source: "legacy",
      },
      card: null,
      entity_ref: null,
      metadata: {},
    };

    assert.equal(isDiagnosticAssistantToolResult(legacyToolResult), false);

    const message: AssistantThreadMessage = {
      id: "msg_legacy_result",
      thread_id: "thread_primary",
      run_id: "run_review",
      role: "assistant",
      status: "complete",
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {},
      parts: [
        {
          type: "tool_result",
          id: "part_legacy_tool_result",
          tool_result: legacyToolResult,
        },
      ],
    };

    const [richPart] = starlogRichPartsForMessage(message);
    assert.ok(richPart);
    assert.equal(richPart.type, "tool_result");
    assert.equal(richPart.requestedRendererKey, "legacy.review_grade");
    assert.equal(richPart.resolvedRendererKey, null);
    assert.equal(richPart.fallback, true);
    assert.equal(richPart.fallbackReason, "No registered mobile renderer; using generic tool result rendering.");
    assert.equal(richPart.placement, "bottom_sheet");
    assert.equal(richPart.placementLabel, "Bottom sheet");
    assert.deepEqual(richPart.structuredContent, {
      card_id: "card_ml_vectors",
      grade: "great",
    });
    assert.deepEqual(richPart.uiMeta, {
      source: "legacy",
    });
  }

  {
    const baseline = reviewGradeMessage();
    const sameLengthEdit = reviewGradeMessage();
    const baselineText = (baseline.parts[0] as { text: string }).text;
    (sameLengthEdit.parts[0] as { text: string }).text = `${baselineText.slice(0, -1)}?`;
    const [baselineUiMessage] = starlogMessagesToAssistantUiMessages([baseline]);
    const [sameLengthEditUiMessage] = starlogMessagesToAssistantUiMessages([sameLengthEdit]);
    if (!baselineUiMessage || !sameLengthEditUiMessage) {
      throw new Error("Expected assistant UI messages to convert.");
    }

    const baselineFingerprint = assistantUiThreadFingerprint([baselineUiMessage]);
    const editedFingerprint = assistantUiThreadFingerprint([sameLengthEditUiMessage]);

    assert.notEqual(baselineFingerprint, editedFingerprint);
    assert.equal(
      baselineText.length,
      (sameLengthEdit.parts[0] as { text: string }).text.length,
    );
  }
}

runTests();
