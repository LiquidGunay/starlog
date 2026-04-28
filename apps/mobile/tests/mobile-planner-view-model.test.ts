import { deriveMobilePlannerViewModel } from "../src/mobile-planner-view-model";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");

const model = deriveMobilePlannerViewModel({
  now: new Date("2026-04-28T12:00:00Z"),
  nextActionPreview: "Write the planner execution surface before adding new review work.",
  alarmScheduled: true,
  nextBriefingCountdown: "18h",
  summary: {
    date: "2026-04-28",
    task_buckets: [
      { key: "open_tasks", label: "Open tasks", count: 7 },
      { key: "due_today_tasks", label: "Due today", count: 2 },
    ],
    block_buckets: [
      { key: "fixed_blocks", label: "Fixed blocks", count: 3 },
      { key: "focus_blocks", label: "Focus blocks", count: 1 },
      { key: "buffer_blocks", label: "Buffer blocks", count: 1 },
    ],
    calendar_event_count: 2,
    conflict_count: 1,
    focus_minutes: 150,
    buffer_minutes: 45,
    generated_at: "2026-04-28T11:55:00Z",
  },
});

assert.equal(model.statusLabel, "Synced 11:55 AM");
assert.equal(model.dateLabel, "Tuesday, Apr 28");
assert.deepEqual(model.metrics, [
  { label: "Focus", value: "2h 30m", tone: "focus" },
  { label: "Meetings", value: "2", tone: "meeting" },
  { label: "Tasks", value: "7", tone: "task" },
  { label: "Buffer", value: "45m", tone: "buffer" },
]);
assert.equal(model.dayStrip.length, 7);
assert.equal(model.dayStrip.filter((day) => day.active).length, 1);
assert.equal(model.timelineBlocks.some((block) => block.type === "conflict"), true);
assert.equal(model.conflict?.severityLabel, "Repair in Assistant");
assert.deepEqual(model.planGroups[1].items.slice(0, 2), ["2 due today", "5 open tasks can move"]);
assert.deepEqual(model.promptChips, ["Protect focus", "Repair conflict", "What can move?"]);

const fallback = deriveMobilePlannerViewModel({
  now: new Date("2026-04-28T12:00:00Z"),
  nextActionPreview: "",
  alarmScheduled: false,
});

assert.equal(fallback.statusLabel, "Local preview");
assert.equal(fallback.metrics[0].value, "1h 30m");
assert.equal(fallback.timelineBlocks[0].detail, "Schedule the morning briefing before relying on playback.");
assert.equal(fallback.conflict?.title, "Conflict detected");

console.log("mobile planner view model tests passed");
