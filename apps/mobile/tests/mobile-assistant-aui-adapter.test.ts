import type { AssistantThreadMessage, AssistantThreadSnapshot } from "@starlog/contracts";
import {
  assistantUiThreadFingerprint,
  mobileDynamicUiBadge,
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
    assert.equal(mobileDynamicUiBadge({ rendererKey: "interview.review_grade", placement: "inline" }), "Review grade · Inline panel");
    assert.equal(mobileDynamicUiBadge({ rendererKey: "grade_review_recall", placement: "inline" }), "Grade review recall · Inline panel");
    assert.equal(mobileDynamicUiBadge({ rendererKey: "interview.review_grade" }), "Review grade · Inline panel");
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
            placement: "thread",
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
    assert.equal(part.placement, "thread");
    assert.equal(part.placementLabel, "Thread panel");
    assert.equal(part.fallback, true);
    assert.equal(part.fallbackReason, "No registered mobile renderer; using generic card rendering.");
    assert.deepEqual(part.structuredContent, { mode: "legacy", reason: "compat" });
    assert.deepEqual(part.uiMeta, { source: "legacy" });
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
