import type {
  AssistantThreadMessage,
  AssistantThreadSnapshot,
  AssistantToolCall,
  AssistantToolResult,
} from "@starlog/contracts";
import {
  assistantUiThreadFingerprint,
  isDiagnosticAssistantToolCall,
  isDiagnosticAssistantToolResult,
  MOBILE_ASSISTANT_UI_TEST_MARKERS,
  mobileDynamicUiBadge,
  starlogMessagesToAssistantUiMessages,
  starlogRichPartsForMessage,
  starlogSnapshotToAssistantUiThread,
} from "../src/mobile-assistant-aui-adapter";

declare function require(moduleName: "node:assert/strict"): {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
  ok: (...args: unknown[]) => void;
  notEqual: (...args: unknown[]) => void;
};
declare function require(moduleName: "node:fs"): {
  readFileSync: (path: string, encoding: "utf8") => string;
};
declare function require(moduleName: "node:path"): {
  resolve: (...segments: string[]) => string;
};
declare const __dirname: string;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const createdAt = "2026-05-16T12:00:00.000Z";

function readMobileSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../../../../../apps/mobile", relativePath), "utf8");
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
    const shellSource = readMobileSource("src/mobile-assistant-aui-thread.tsx");
    assert.ok(shellSource.includes("<ThreadPrimitive.Root"));
    assert.ok(shellSource.includes("<ThreadPrimitive.Messages"));
    assert.ok(shellSource.includes("<MessagePrimitive.Root"));
    assert.ok(shellSource.includes("<MessagePrimitive.Content"));
    assert.ok(shellSource.includes("<ComposerPrimitive.Root"));
    assert.ok(shellSource.includes('testID="assistant-ui-shell"'));
    assert.ok(shellSource.includes('testID="assistant-ui-thread"'));
    assert.ok(shellSource.includes('testID="assistant-ui-composer"'));
    assert.ok(shellSource.includes("MOBILE_ASSISTANT_UI_TEST_MARKERS.composerInput"));
  }

  {
    const panelHostSource = readMobileSource("src/mobile-dynamic-panel-host.tsx");
    assert.ok(panelHostSource.includes('testID="mobile-dynamic-panel-host"'));
    assert.ok(panelHostSource.includes('testID="mobile-dynamic-panel-queued"'));
    assert.ok(panelHostSource.includes('testID="mobile-dynamic-panel-sheet-row"'));
    assert.ok(panelHostSource.includes('testID="mobile-dynamic-panel-sheet"'));
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
