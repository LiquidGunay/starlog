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
equal(topicUnlock.requestedRendererVersion, 1);
equal(topicUnlock.supportedRendererVersion, 1);
equal(topicUnlock.placement, "thread");
equal(topicUnlock.fallback, false);
equal(topicUnlock.fallbackReason, null);
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
equal(morningFocus.fallbackReason, null);
deepEqual(morningFocus.structuredContent, {
  fields: legacyMorningFocusInterrupt.fields,
  recommended_defaults: { focus: "project" },
  tool_call_id: null,
});

const unsupportedSource = createDynamicUiViewModel(
  "interrupt",
  {
    ...legacyMorningFocusInterrupt,
    renderer_key: "interview.topic_unlock",
    renderer_version: 1,
    placement: "sidecar",
  },
  registry,
);
equal(unsupportedSource.rendererKey, FALLBACK_RENDERER_KEY);
equal(unsupportedSource.requestedRendererKey, "interview.topic_unlock");
equal(unsupportedSource.requestedRendererVersion, 1);
equal(unsupportedSource.supportedRendererVersion, 1);
equal(unsupportedSource.rendererVersion, 1);
equal(unsupportedSource.placement, "thread");
equal(unsupportedSource.fallback, true);
equal(unsupportedSource.fallbackReason, "unsupported_source");

const unsupportedVersion = createDynamicUiViewModel(
  "tool_result",
  {
    ...topicUnlockResult,
    renderer_version: 2,
    placement: "sidecar",
  },
  registry,
);
equal(unsupportedVersion.rendererKey, FALLBACK_RENDERER_KEY);
equal(unsupportedVersion.requestedRendererKey, "interview.topic_unlock");
equal(unsupportedVersion.requestedRendererVersion, 2);
equal(unsupportedVersion.supportedRendererVersion, 1);
equal(unsupportedVersion.rendererVersion, 1);
equal(unsupportedVersion.placement, "thread");
equal(unsupportedVersion.fallback, true);
equal(unsupportedVersion.fallbackReason, "unsupported_renderer_version");

const fallback = createDynamicUiViewModel("card", unknownRendererCard, registry);
equal(fallback.rendererKey, FALLBACK_RENDERER_KEY);
equal(fallback.requestedRendererKey, "custom.unknown");
equal(fallback.rendererVersion, 1);
equal(fallback.requestedRendererVersion, 7);
equal(fallback.supportedRendererVersion, null);
equal(fallback.placement, "thread");
equal(fallback.fallback, true);
equal(fallback.fallbackReason, "unknown_renderer");
deepEqual(fallback.uiMeta, {
  source: "fixture",
});

const preservedFallbackPlacement = createDynamicUiViewModel("card", unknownRendererCard, registry, {
  preserveFallbackPlacement: true,
});
equal(preservedFallbackPlacement.rendererKey, FALLBACK_RENDERER_KEY);
equal(preservedFallbackPlacement.placement, "support_panel");
equal(preservedFallbackPlacement.fallbackReason, "unknown_renderer");
