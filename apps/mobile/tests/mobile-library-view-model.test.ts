import {
  deriveMobileLibraryViewModel,
  formatMobileLibraryTimestamp,
} from "../src/mobile-library-view-model";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");
const now = new Date("2026-04-28T12:00:00Z");

const model = deriveMobileLibraryViewModel({
  now,
  pendingCaptures: [
    {
      id: "voice-1",
      kind: "voice",
      title: "Interview follow-up",
      sourceUrl: "",
      createdAt: "2026-04-28T11:45:00Z",
      attempts: 1,
    },
    {
      id: "text-1",
      kind: "text",
      title: "Onboarding flow polish",
      sourceUrl: "https://www.example.com/research/interview",
      createdAt: "2026-04-28T10:00:00Z",
      attempts: 0,
    },
  ],
  artifacts: [
    {
      id: "artifact-1",
      source_type: "web_clip",
      title: "Processed reference",
      created_at: "2026-04-27T12:00:00Z",
    },
  ],
  notesCount: 3,
  linkedProjectCount: 1,
});

assert.equal(model.statusLabel, "2 awaiting processing");
assert.equal(model.statusLabel.includes("Synced"), false);
assert.deepEqual(model.segments, ["Inbox", "Artifacts", "Notes", "Sources"]);
assert.deepEqual(model.stats, [
  { label: "Unprocessed captures", value: "2", supportingLabel: "2 need attention", icon: "inbox" },
  { label: "Recent artifacts", value: "1", supportingLabel: "1 ready to use", icon: "artifact" },
]);

assert.equal(model.inboxRows.length, 2);
assert.equal(model.inboxRows[0].sourceLabel, "Recorder");
assert.equal(model.inboxRows[0].captureTypeLabel, "Voice memo");
assert.deepEqual(model.inboxRows[0].actionLabels, ["Transcribe", "Summarize"]);
assert.equal(model.inboxRows[0].primaryActionLabel, "Transcribe");
assert.equal(model.inboxRows[0].secondaryActionLabel, "Summarize");
assert.equal(model.inboxRows[0].overflowActionCount, 3);
assert.equal(model.inboxRows[0].actionLabels.length <= 2, true);
assert.equal(model.inboxRows[0].statusLabel, "Queued retry");
assert.equal(model.inboxRows[0].statusTone, "queued");

assert.equal(model.inboxRows[1].sourceLabel, "example.com");
assert.equal(model.inboxRows[1].timestampLabel, "2h ago");
assert.deepEqual(model.inboxRows[1].actionLabels, ["Summarize", "Make cards"]);
assert.equal(model.inboxRows[1].layout.titleNumberOfLines, 1);
assert.equal(model.inboxRows[1].layout.stackActions, false);

assert.deepEqual(model.recentArtifacts.map((row) => row.title), ["Processed reference"]);
assert.deepEqual(model.recentArtifacts.map((row) => row.tagLabel), ["Artifact"]);
assert.equal(model.noteRows.length, 0);
assert.equal(model.notesAggregate.emptyLabel, "3 notes reported. Note row details are not loaded on mobile yet.");
assert.equal(model.projectsAggregate.emptyLabel, "1 linked project reported. Project row details are not loaded on mobile yet.");
assert.equal(model.sourceRows.some((row) => row.label === "Recorder" && row.count === 1), true);
assert.deepEqual(model.suggestions.map((row) => row.actionLabel), ["Queued", "Available"]);
assert.equal(model.suggestions.some((row) => /Archive older|Link 2/.test(row.label)), false);

const longLayout = deriveMobileLibraryViewModel({
  now,
  pendingCaptures: [
    {
      id: "long-1",
      kind: "text",
      title: "A very long mobile capture title that should use two lines without colliding with actions on narrow Android screens",
      sourceUrl: "not a url but a very very long source label that should be truncated in the middle for mobile layout safety",
      createdAt: "2026-04-28T11:58:00Z",
      attempts: 0,
    },
  ],
  artifacts: [],
});
assert.equal(longLayout.inboxRows[0].layout.titleNumberOfLines, 2);
assert.equal(longLayout.inboxRows[0].layout.metadataNumberOfLines, 2);
assert.equal(longLayout.inboxRows[0].layout.stackActions, true);
assert.equal(longLayout.inboxRows[0].sourceLabel.includes("..."), true);

const retryLayout = deriveMobileLibraryViewModel({
  now,
  pendingCaptures: [
    {
      id: "retry-1",
      kind: "file",
      title: "PDF that failed once",
      sourceUrl: "",
      createdAt: "2026-04-28T11:58:00Z",
      attempts: 2,
      lastError: "transient failure",
    },
  ],
  artifacts: [],
});
assert.equal(retryLayout.inboxRows[0].statusLabel, "Retry needed");
assert.equal(retryLayout.inboxRows[0].statusTone, "retry");

const emptyQueue = deriveMobileLibraryViewModel({
  now,
  pendingCaptures: [],
  artifacts: [
    {
      id: "artifact-2",
      source_type: "voice_memo",
      title: "",
      created_at: "2026-04-21T12:00:00Z",
    },
  ],
});

assert.equal(emptyQueue.statusLabel, "Queue clear");
assert.equal(emptyQueue.inboxRows[0].statusLabel, "Processed");
assert.equal(emptyQueue.inboxRows[0].statusTone, "processed");
assert.equal(emptyQueue.inboxRows[0].sourceLabel, "Voice Memo");
assert.deepEqual(emptyQueue.inboxRows[0].actionLabels, ["Open", "Review"]);
assert.equal(emptyQueue.noteRows.length, 0);
assert.equal(emptyQueue.notesAggregate.emptyLabel, "No note rows are loaded.");
assert.deepEqual(emptyQueue.suggestions.map((row) => row.label), ["Review 1 artifact already in Library"]);

assert.equal(formatMobileLibraryTimestamp("not-a-date", now), "Unknown time");

console.log("mobile library view model tests passed");
