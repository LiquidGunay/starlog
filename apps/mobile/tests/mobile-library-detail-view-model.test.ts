import {
  deriveMobileArtifactFallbackDetail,
  deriveMobileArtifactDetailViewModel,
  findMobileArtifactActionExecution,
  shouldCommitArtifactDetailResponse,
  type MobileArtifactDetail,
} from "../src/mobile-library-detail-view-model";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");

const detail: MobileArtifactDetail = {
  artifact: {
    id: "art_detail_1",
    source_type: "clip_browser",
    title: "Library detail source",
    created_at: "2026-04-28T06:00:00+00:00",
    updated_at: "2026-04-28T06:10:00+00:00",
  },
  capture: {
    source_app: "browser_ext",
    source_type: "clip_browser",
    source_url: "https://example.com/library-detail",
    source_file: "library-detail.html",
    capture_method: "browser_selection",
    captured_at: "2026-04-28T06:00:00+00:00",
    tags: ["research", "library"],
  },
  source_layers: [
    {
      layer: "raw",
      present: true,
      preview: "<article>Raw clipped html</article>",
      character_count: 240,
      mime_type: "text/html",
      checksum_sha256: "raw-checksum-123456789",
      source_filename: "library-detail.html",
    },
    {
      layer: "normalized",
      present: true,
      preview: "Normalized capture text for trustworthy provenance.",
      character_count: 52,
      mime_type: "text/plain",
      checksum_sha256: null,
      source_filename: null,
    },
    {
      layer: "extracted",
      present: false,
      preview: null,
      character_count: null,
      mime_type: null,
      checksum_sha256: null,
      source_filename: null,
    },
  ],
  connections: {
    summary_version_count: 2,
    latest_summary: {
      id: "sum_detail_2",
      version: 2,
      provider: "test",
      created_at: "2026-04-28T06:05:00+00:00",
      preview: "Latest summary version for the detail panel",
      character_count: 43,
    },
    card_count: 2,
    card_set_version_count: 1,
    task_count: 1,
    note_count: 1,
    notes: [{ id: "nte_detail_1", title: "Detail note", version: 3 }],
    relation_count: 1,
    relations: [
      {
        id: "rel_detail_1",
        artifact_id: "art_detail_1",
        relation_type: "artifact.summary_version",
        target_type: "summary_version",
        target_id: "sum_detail_2",
        created_at: "2026-04-28T06:11:00+00:00",
      },
    ],
    action_run_count: 2,
  },
  timeline: [
    {
      kind: "action.summarize",
      label: "Summarize action",
      occurred_at: "2026-04-28T06:09:00+00:00",
      entity_type: "action_run",
      entity_id: "act_detail_1",
      status: "completed",
    },
    {
      kind: "artifact.created",
      label: "Artifact created",
      occurred_at: "2026-04-28T06:00:00+00:00",
      entity_type: "artifact",
      entity_id: "art_detail_1",
      status: null,
    },
  ],
  suggested_actions: [
    {
      action: "summarize",
      label: "Summarize",
      enabled: true,
      method: "POST",
      endpoint: "/v1/artifacts/art_detail_1/actions",
      disabled_reason: null,
    },
    {
      action: "archive",
      label: "Archive",
      enabled: false,
      method: null,
      endpoint: null,
      disabled_reason: "Archive is not supported by the artifact action backend yet.",
    },
    {
      action: "link",
      label: "Link",
      enabled: true,
      method: null,
      endpoint: null,
      disabled_reason: null,
    },
  ],
};

const model = deriveMobileArtifactDetailViewModel(detail);

assert.equal(model.title, "Library detail source");
assert.equal(model.subtitle, "Clip Browser · captured Apr 28");
assert.equal(model.fallbackNotice, null);
assert.equal(model.artifactTypeLabel, "Clip Browser");
assert.equal(model.fileLabel, "library-detail.html");
assert.deepEqual(model.tagChips.map((tag) => tag.label), ["research", "library"]);
assert.equal(model.summary, "Latest summary version for the detail panel");
assert.deepEqual(model.keyIdeas, [
  "2 summary versions preserved.",
  "2 review cards created from this artifact.",
  "1 task connected to this source.",
]);
assert.deepEqual(model.captureLabels, [
  { label: "Source type", value: "Clip Browser" },
  { label: "Captured", value: "Apr 28" },
  { label: "Source app", value: "browser_ext" },
  { label: "Capture method", value: "browser_selection" },
  { label: "Source URL", value: "https://example.com/library-detail" },
  { label: "Source file", value: "library-detail.html" },
  { label: "Tags", value: "research, library" },
]);

assert.equal(model.sourcePreview, "<article>Raw clipped html</article>");
assert.equal(model.quickCapture.preview, "<article>Raw clipped html</article>");
assert.deepEqual(model.quickCapture.classificationOptions, [
  { id: "reference", label: "Reference", selected: true },
  { id: "idea", label: "Idea", selected: false },
  { id: "task", label: "Task", selected: false },
]);
assert.deepEqual(
  model.sourceLayers.map((layer) => ({ label: layer.label, present: layer.present, state: layer.stateLabel })),
  [
    { label: "Raw", present: true, state: "Present" },
    { label: "Normalized", present: true, state: "Present" },
    { label: "Extracted", present: false, state: "Missing" },
  ],
);
assert.equal(model.sourceLayers[2].preview, null);

assert.deepEqual(model.provenanceRows.slice(0, 4), [
  { label: "Source", value: "browser_ext" },
  { label: "URL", value: "https://example.com/library-detail" },
  { label: "Method", value: "browser_selection" },
  { label: "Captured", value: "Apr 28" },
]);
assert.equal(model.provenanceRows.some((row) => row.value.includes("Latest summary version for the detail panel")), true);
assert.equal(model.provenanceRows.some((row) => row.value.includes("Detail note")), true);
assert.deepEqual(model.connectionRows, [
  { label: "Linked to summary version", value: "sum_detail_2", actionLabel: "View" },
  { label: "Linked to notes (1)", value: "Detail note", actionLabel: "View all" },
  { label: "Used in", value: "1 task", actionLabel: "View all" },
]);
assert.deepEqual(
  model.actions.map((action) => ({
    action: action.action,
    enabled: action.enabled,
    status: action.statusLabel,
    request: action.executableRequest,
  })),
  [
    {
      action: "summarize",
      enabled: true,
      status: "Action",
      request: {
        artifactId: "art_detail_1",
        action: "summarize",
        method: "POST",
        endpoint: "/v1/artifacts/art_detail_1/actions",
      },
    },
    { action: "archive", enabled: false, status: "Status only", request: null },
    { action: "link", enabled: false, status: "Status only", request: null },
  ],
);
assert.equal(model.actions[2].disabledReason, "No executable endpoint is available.");
assert.deepEqual(model.accordions.map((section) => ({
  id: section.id,
  step: section.stepLabel,
  expanded: section.expandedByDefault,
})), [
  { id: "detail", step: "1", expanded: true },
  { id: "preview", step: "2", expanded: true },
  { id: "provenance", step: "3", expanded: true },
  { id: "conversion", step: "4", expanded: true },
  { id: "timeline", step: "5", expanded: true },
]);
assert.deepEqual(findMobileArtifactActionExecution(detail, "summarize"), {
  artifactId: "art_detail_1",
  action: "summarize",
  method: "POST",
  endpoint: "/v1/artifacts/art_detail_1/actions",
});
assert.equal(findMobileArtifactActionExecution(detail, "cards"), null);

assert.deepEqual(
  model.timelineRows.map((event) => ({ label: event.label, meta: event.metaLabel })),
  [
    { label: "Summarize action", meta: "Action Summarize · Action Run · completed" },
    { label: "Artifact created", meta: "Artifact Created · Artifact" },
  ],
);

const sparse = deriveMobileArtifactDetailViewModel({
  ...detail,
  artifact: { ...detail.artifact, title: null },
  capture: {
    source_type: "clip_manual",
    captured_at: "not-a-date",
    tags: [],
  },
  source_layers: [
    {
      layer: "raw",
      present: false,
      preview: null,
      character_count: null,
      mime_type: null,
      checksum_sha256: null,
      source_filename: null,
    },
  ],
  connections: {
    summary_version_count: 0,
    latest_summary: null,
    card_count: 0,
    card_set_version_count: 0,
    task_count: 0,
    note_count: 0,
    notes: [],
    relation_count: 0,
    relations: [],
    action_run_count: 0,
  },
  timeline: [],
  suggested_actions: [],
});

assert.equal(sparse.title, "art_detail_1");
assert.equal(sparse.sourcePreview, null);
assert.equal(sparse.quickCapture.preview, null);
assert.equal(sparse.provenanceRows.some((row) => row.label === "Latest summary"), false);
assert.equal(sparse.connectionRows.length, 0);
assert.equal(sparse.timelineRows.length, 0);
assert.equal(sparse.actions.length, 0);

const oldActivity = deriveMobileArtifactDetailViewModel({
  ...detail,
  artifact: { ...detail.artifact, updated_at: "2026-04-20T06:10:00+00:00" },
});
assert.equal(oldActivity.accordions.find((section) => section.id === "timeline")?.expandedByDefault, false);

const fallbackDetail = deriveMobileArtifactFallbackDetail({
  artifact: {
    id: "art_local_1",
    source_type: "web_clip",
    title: "Local fallback artifact",
    created_at: "2026-04-28T09:00:00+00:00",
  },
  reason: "Showing a local artifact snapshot because API detail failed.",
});
const fallbackModel = deriveMobileArtifactDetailViewModel(fallbackDetail);
assert.equal(fallbackModel.title, "Local fallback artifact");
assert.equal(fallbackModel.fallbackNotice, "Showing a local artifact snapshot because API detail failed.");
assert.equal(fallbackModel.sourcePreview, "Local fallback artifact");
assert.deepEqual(
  fallbackModel.sourceLayers.map((layer) => ({ label: layer.label, present: layer.present })),
  [
    { label: "Raw", present: true },
    { label: "Normalized", present: false },
    { label: "Extracted", present: false },
  ],
);
assert.deepEqual(fallbackModel.actions.map((action) => ({
  action: action.action,
  enabled: action.enabled,
  request: action.executableRequest,
})), [
  { action: "summarize", enabled: false, request: null },
  { action: "cards", enabled: false, request: null },
  { action: "tasks", enabled: false, request: null },
  { action: "append_note", enabled: false, request: null },
]);
assert.equal(fallbackModel.timelineRows[0].label, "Local artifact snapshot shown");

const untitledFallbackModel = deriveMobileArtifactDetailViewModel(deriveMobileArtifactFallbackDetail({
  artifact: {
    id: "art_local_untitled",
    source_type: "clip_mobile",
    title: "",
    created_at: "2026-04-28T10:00:00+00:00",
  },
}));
assert.equal(untitledFallbackModel.title, "Untitled artifact");
assert.equal(untitledFallbackModel.sourcePreview, null);
assert.deepEqual(
  untitledFallbackModel.sourceLayers.map((layer) => ({ label: layer.label, present: layer.present, preview: layer.preview })),
  [
    { label: "Raw", present: false, preview: null },
    { label: "Normalized", present: false, preview: null },
    { label: "Extracted", present: false, preview: null },
  ],
);
assert.equal(untitledFallbackModel.keyIdeas.length, 0);

assert.equal(shouldCommitArtifactDetailResponse({
  requested: { artifactId: "art_a", requestId: 1 },
  current: { artifactId: "art_a", requestId: 1 },
  responseArtifactId: "art_a",
}), true);
assert.equal(shouldCommitArtifactDetailResponse({
  requested: { artifactId: "art_a", requestId: 1 },
  current: { artifactId: "art_b", requestId: 2 },
  responseArtifactId: "art_a",
}), false);
assert.equal(shouldCommitArtifactDetailResponse({
  requested: { artifactId: "art_b", requestId: 2 },
  current: { artifactId: "art_b", requestId: 2 },
  responseArtifactId: "art_a",
}), false);

console.log("mobile library detail view model tests passed");
