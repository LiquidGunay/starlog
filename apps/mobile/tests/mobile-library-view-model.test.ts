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
assert.deepEqual(model.segments, ["Inbox", "Artifacts", "Notes", "Sources"]);
assert.deepEqual(model.stats, [
  { label: "Unprocessed", value: "2" },
  { label: "Artifacts", value: "1" },
  { label: "Notes & saved", value: "3" },
  { label: "Linked projects", value: "1" },
]);

assert.equal(model.inboxRows.length, 2);
assert.equal(model.inboxRows[0].sourceLabel, "Recorder");
assert.equal(model.inboxRows[0].captureTypeLabel, "Voice memo");
assert.deepEqual(model.inboxRows[0].primaryActions, ["Transcribe", "Summarize"]);
assert.equal(model.inboxRows[0].primaryActions.length <= 2, true);
assert.equal(model.inboxRows[0].statusLabel, "Queued retry");

assert.equal(model.inboxRows[1].sourceLabel, "example.com");
assert.equal(model.inboxRows[1].timestampLabel, "2h ago");
assert.deepEqual(model.inboxRows[1].primaryActions, ["Summarize", "Make cards"]);

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
assert.equal(emptyQueue.inboxRows[0].sourceLabel, "Voice Memo");
assert.deepEqual(emptyQueue.inboxRows[0].primaryActions, ["Open", "Review"]);

assert.equal(formatMobileLibraryTimestamp("not-a-date", now), "Unknown time");

console.log("mobile library view model tests passed");
