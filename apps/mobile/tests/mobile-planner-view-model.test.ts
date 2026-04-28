import {
  deriveMobilePlannerViewModel,
  shiftPlannerDate,
} from "../src/mobile-planner-view-model";

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
assert.deepEqual(model.dateControls, {
  selectedDate: "2026-04-28",
  todayDate: "2026-04-28",
  previousDate: "2026-04-27",
  nextDate: "2026-04-29",
  isToday: true,
});
assert.deepEqual(model.metrics, [
  { label: "Focus", value: "2h 30m", caption: "1 block", tone: "focus" },
  { label: "Meetings", value: "2", caption: "3 fixed", tone: "meeting" },
  { label: "Tasks", value: "7", caption: "2 due today", tone: "task" },
  { label: "Buffer", value: "45m", caption: "1 block", tone: "buffer" },
]);
assert.equal(model.dayStrip.length, 7);
assert.equal(model.dayStrip.filter((day) => day.active).length, 1);
assert.equal(model.timelineBlocks.some((block) => block.type === "conflict"), true);
assert.equal(model.timelineBlocks.find((block) => block.id === "focus")?.timeLabel, "Focus");
assert.equal(model.timelineBlocks.find((block) => block.id === "focus")?.durationLabel, "2h 30m");
assert.equal(model.conflict?.severityLabel, "Repair in Assistant");
assert.equal(model.decisionLabel, "Resolve the overlap before adding new work.");
assert.deepEqual(model.planGroups[0].items.map((item) => item.id), [
  "focus-capacity",
  "fixed-commitments",
  "buffer-capacity",
  "morning-briefing",
]);
assert.deepEqual(model.planGroups[1].items.slice(0, 2).map((item) => item.metaLabel), ["2 tasks", "5 open"]);
assert.deepEqual(model.promptChips, ["Protect focus", "Repair conflict", "What can move?"]);

const fallback = deriveMobilePlannerViewModel({
  now: new Date("2026-04-28T12:00:00Z"),
  nextActionPreview: "",
  alarmScheduled: false,
});

assert.equal(fallback.statusLabel, "No Planner summary loaded");
assert.deepEqual(fallback.metrics, [
  { label: "Focus", value: "Unknown", caption: "Refresh Planner", tone: "focus" },
  { label: "Meetings", value: "Unknown", caption: "Refresh Planner", tone: "meeting" },
  { label: "Tasks", value: "Unknown", caption: "Refresh Planner", tone: "task" },
  { label: "Buffer", value: "Unknown", caption: "Refresh Planner", tone: "buffer" },
]);
assert.equal(fallback.timelineBlocks[0].durationLabel, "Unknown");
assert.equal(fallback.timelineBlocks[0].title, "Briefing unknown");
assert.equal(fallback.timelineBlocks[0].detail, "Refresh Planner to load briefing readiness for this date.");
assert.equal(fallback.conflict, null);
assert.equal(fallback.timelineBlocks.some((block) => block.type === "conflict"), false);
assert.equal(fallback.nextFocus.title, "Focus unknown");
assert.equal(fallback.nextFocus.body, "Refresh Planner to load focus capacity and named blocks for this date.");
assert.equal(fallback.nextFocus.timeLabel, "Unknown");
assert.equal(fallback.nextFocus.metaLabel, "Refresh Planner");
assert.equal(fallback.timelineBlocks.find((block) => block.id === "focus")?.durationLabel, "Unknown");
assert.equal(fallback.timelineBlocks.find((block) => block.id === "focus")?.title, "Focus unknown");
assert.equal(fallback.timelineBlocks.find((block) => block.id === "focus")?.detail, "Refresh Planner to load focus capacity for this date.");
assert.equal(fallback.timelineBlocks.find((block) => block.id === "fixed")?.durationLabel, "Unknown");
assert.equal(fallback.timelineBlocks.find((block) => block.id === "fixed")?.title, "Calendar not loaded");
assert.equal(fallback.timelineBlocks.find((block) => block.id === "fixed")?.detail, "Refresh Planner to load fixed commitments for this date.");
assert.equal(fallback.timelineBlocks.find((block) => block.id === "buffer")?.durationLabel, "Unknown");
assert.equal(fallback.timelineBlocks.find((block) => block.id === "buffer")?.title, "Buffer unknown");
assert.equal(fallback.timelineBlocks.find((block) => block.id === "buffer")?.detail, "Refresh Planner to load buffer capacity for this date.");
assert.equal(fallback.upcoming.title, "Refresh calendar");
assert.equal(fallback.upcoming.body, "Refresh Planner to load calendar events and fixed blocks for this date.");
assert.equal(fallback.upcoming.timeLabel, "Unknown");
assert.equal(fallback.upcoming.metaLabel, "Refresh Planner");
assert.deepEqual(fallback.promptChips, ["Protect focus", "What can move?", "Plan buffer"]);
assert.deepEqual(fallback.planGroups[0].items, []);
assert.equal(fallback.planGroups[0].summaryLabel, "Unknown");
assert.equal(fallback.planGroups[0].emptyLabel, "Refresh Planner to load scheduled commitments for this date.");
assert.deepEqual(fallback.planGroups[1].items, []);
assert.equal(fallback.planGroups[1].summaryLabel, "Unknown");
assert.equal(fallback.planGroups[1].emptyLabel, "Refresh Planner to load task pressure for this date.");
assert.deepEqual(fallback.planGroups[2].items, []);
assert.equal(fallback.planGroups[2].summaryLabel, "Waiting");

const fallbackWithAlarm = deriveMobilePlannerViewModel({
  now: new Date("2026-04-28T12:00:00Z"),
  nextActionPreview: "",
  alarmScheduled: true,
  nextBriefingCountdown: "18h",
});

assert.equal(fallbackWithAlarm.statusLabel, "No Planner summary loaded");
assert.equal(fallbackWithAlarm.timelineBlocks.find((block) => block.id === "briefing")?.durationLabel, "Unknown");
assert.equal(fallbackWithAlarm.timelineBlocks.find((block) => block.id === "briefing")?.title, "Briefing unknown");
assert.equal(
  fallbackWithAlarm.timelineBlocks.find((block) => block.id === "briefing")?.detail,
  "Refresh Planner to load briefing readiness for this date.",
);
assert.equal(
  fallbackWithAlarm.timelineBlocks.some(
    (block) => block.durationLabel === "Scheduled" || block.detail.includes("Offline playback is scheduled"),
  ),
  false,
);
assert.deepEqual(fallbackWithAlarm.planGroups[0].items, []);
assert.equal(fallbackWithAlarm.planGroups[0].summaryLabel, "Unknown");
assert.equal(fallbackWithAlarm.planGroups[0].emptyLabel, "Refresh Planner to load scheduled commitments for this date.");
assert.deepEqual(fallbackWithAlarm.planGroups[1].items, []);
assert.equal(fallbackWithAlarm.planGroups[1].summaryLabel, "Unknown");
assert.equal(fallbackWithAlarm.planGroups[1].emptyLabel, "Refresh Planner to load task pressure for this date.");
assert.deepEqual(fallbackWithAlarm.planGroups[2].items, []);
assert.equal(fallbackWithAlarm.planGroups[2].summaryLabel, "Waiting");
assert.equal(fallbackWithAlarm.nextFocus.timeLabel, "Unknown");
assert.equal(fallbackWithAlarm.upcoming.timeLabel, "Unknown");
assert.equal(fallbackWithAlarm.upcoming.metaLabel, "Refresh Planner");

const futureFallback = deriveMobilePlannerViewModel({
  selectedDate: "2026-04-30",
  now: new Date("2026-04-28T12:00:00Z"),
});

assert.equal(futureFallback.dateLabel, "Thursday, Apr 30");
assert.deepEqual(futureFallback.dateControls, {
  selectedDate: "2026-04-30",
  todayDate: "2026-04-28",
  previousDate: "2026-04-29",
  nextDate: "2026-05-01",
  isToday: false,
});
assert.equal(futureFallback.dayStrip.find((day) => day.active)?.key, "2026-04-30");
assert.equal(shiftPlannerDate("2026-04-30", -1), "2026-04-29");

const emptySummary = deriveMobilePlannerViewModel({
  now: new Date("2026-04-28T12:00:00Z"),
  summary: {
    date: "2026-04-28",
    task_buckets: [],
    block_buckets: [],
    calendar_event_count: 0,
    conflict_count: 0,
    focus_minutes: 0,
    buffer_minutes: 0,
    generated_at: "2026-04-28T11:55:00Z",
  },
});

assert.equal(emptySummary.decisionLabel, "Keep the day open until Planner has more state.");
assert.deepEqual(emptySummary.planGroups[0].items, []);
assert.deepEqual(emptySummary.planGroups[1].items, []);
assert.equal(emptySummary.planGroups[0].summaryLabel, "Empty");
assert.equal(emptySummary.planGroups[1].summaryLabel, "None");
assert.equal(emptySummary.nextFocus.timeLabel, "Unscheduled");
assert.equal(emptySummary.upcoming.timeLabel, "None");

const countOnlySummary = deriveMobilePlannerViewModel({
  now: new Date("2026-04-28T12:00:00Z"),
  summary: {
    date: "2026-04-28",
    task_buckets: [{ key: "open_tasks", label: "Open tasks", count: 1 }],
    block_buckets: [],
    calendar_event_count: 0,
    conflict_count: 0,
    focus_minutes: 60,
    buffer_minutes: 15,
    generated_at: "2026-04-28T11:55:00Z",
  },
});

assert.equal(countOnlySummary.metrics[0].caption, "No block");
assert.equal(countOnlySummary.nextFocus.timeLabel, "Unscheduled");

console.log("mobile planner view model tests passed");
