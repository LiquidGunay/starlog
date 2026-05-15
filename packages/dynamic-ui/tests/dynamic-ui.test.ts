import {
  createDynamicUiRegistry,
  createDynamicUiViewModel,
  FALLBACK_RENDERER_KEY,
  isStarlogKnownRendererKey,
  STARLOG_COMPATIBILITY_RENDERER_KEYS,
  STARLOG_DYNAMIC_UI_RENDERER_CONTRACTS,
  STARLOG_DYNAMIC_RENDERER_KEYS,
} from "../src";
import { legacyMorningFocusInterrupt, topicUnlockResult, unknownRendererCard } from "./fixtures";

declare const require: (moduleName: string) => {
  deepEqual: (actual: unknown, expected: unknown) => void;
  equal: (actual: unknown, expected: unknown) => void;
};

const { deepEqual, equal } = require("node:assert/strict");

const registry = createDynamicUiRegistry();

equal(registry.size, STARLOG_DYNAMIC_RENDERER_KEYS.length + STARLOG_COMPATIBILITY_RENDERER_KEYS.length);
equal(registry.size, STARLOG_DYNAMIC_UI_RENDERER_CONTRACTS.length);
equal(isStarlogKnownRendererKey("interview.question_request"), true);
equal(isStarlogKnownRendererKey("custom.unknown"), false);

const topicUnlock = createDynamicUiViewModel("tool_result", topicUnlockResult, registry);
equal(topicUnlock.rendererKey, "interview.topic_unlock");
deepEqual(topicUnlock.renderer.structuredContent.slice(0, 2), [
  { path: "topic_id", kind: "string", required: true, label: "Topic ID" },
  { path: "topic_title", kind: "string", required: true, label: "Topic title" },
]);
equal(topicUnlock.requestedRendererKey, "interview.topic_unlock");
equal(topicUnlock.rendererVersion, 1);
equal(topicUnlock.placement, "thread");
equal(topicUnlock.fallback, false);
deepEqual(topicUnlock.structuredContent, {
  topic_id: "topic-1",
  topic_title: "Spaced repetition setup",
});
deepEqual(topicUnlock.uiMeta, {
  tone: "success",
});

const morningFocus = createDynamicUiViewModel("interrupt", legacyMorningFocusInterrupt, registry);
equal(morningFocus.rendererKey, "choose_morning_focus");
equal(morningFocus.requestedRendererKey, "choose_morning_focus");
equal(morningFocus.placement, "composer");
equal(morningFocus.fallback, false);
deepEqual(morningFocus.structuredContent, {
  fields: legacyMorningFocusInterrupt.fields,
  recommended_defaults: { focus: "project" },
  tool_call_id: null,
});

const fallback = createDynamicUiViewModel("card", unknownRendererCard, registry);
equal(fallback.rendererKey, FALLBACK_RENDERER_KEY);
equal(fallback.requestedRendererKey, "custom.unknown");
equal(fallback.rendererVersion, 7);
equal(fallback.placement, "support_panel");
equal(fallback.fallback, true);
deepEqual(fallback.uiMeta, {
  source: "fixture",
});
