import {
  buildAssistantTodayQueryDate,
  buildMobileAssistantTodayViewModel,
  localDateStringForAssistantToday,
  resolveMobileAssistantTodayActionRoute,
  type MobileAssistantTodaySummary,
} from "../src/mobile-assistant-today-view-model";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
  ok: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");

function summary(overrides: Partial<MobileAssistantTodaySummary> = {}): MobileAssistantTodaySummary {
  return {
    date: "2026-04-28",
    thread_id: "primary",
    active_run_count: 0,
    open_interrupt_count: 0,
    recent_surface_event_count: 0,
    open_loops: [
      { key: "open_tasks", label: "Open tasks", count: 5, href: "/planner" },
      { key: "overdue_tasks", label: "Overdue tasks", count: 1, href: "/planner" },
      { key: "due_reviews", label: "Reviews due", count: 4, href: "/review" },
      { key: "unprocessed_library", label: "Library inbox", count: 2, href: "/library" },
    ],
    recommended_next_move: {
      key: "finish_onboarding",
      title: "Finish onboarding flow polish",
      body: "A 90 minute focus block can move launch polish forward.",
      surface: "planner",
      href: null,
      action_label: "Start focus",
      prompt: "Start a 90 minute focus block for onboarding flow polish.",
      priority: 95,
      urgency: "high",
    },
    reason_stack: [
      "5 open tasks include launch polish",
      "4 reviews are due after the focus block",
      "2 Library inbox items can wait",
      "1 open commitment needs follow-through",
      "extra desktop-only detail",
    ],
    at_a_glance: [
      { key: "planner", label: "Planner", count: 5, href: "/planner" },
      { key: "library", label: "Library inbox", count: 2, href: "/library" },
      { key: "review", label: "Review due", count: 4, href: "/review" },
      { key: "commitments", label: "Open commitments", count: 1, href: "/planner" },
    ],
    quick_actions: [
      {
        key: "adjust_plan",
        title: "Adjust plan",
        surface: "planner",
        href: "/planner",
        action_label: "Adjust plan",
        prompt: "Adjust today around onboarding flow polish.",
        enabled: true,
        count: 5,
        reason: null,
        priority: 10,
      },
      {
        key: "empty_disabled",
        title: "Empty disabled action",
        surface: "library",
        href: "/library",
        action_label: "Empty disabled action",
        prompt: null,
        enabled: false,
        count: 0,
        reason: "No unprocessed captures.",
        priority: 20,
      },
      {
        key: "open_review",
        title: "Open Review",
        surface: "review",
        href: "/review",
        action_label: "Open Review",
        prompt: null,
        enabled: true,
        count: 4,
        reason: null,
        priority: 30,
      },
      {
        key: "process_inbox",
        title: "Process inbox",
        surface: "library",
        href: "/library",
        action_label: "Process inbox",
        prompt: "Process my latest Library captures and route anything actionable.",
        enabled: true,
        count: 2,
        reason: null,
        priority: 40,
      },
      {
        key: "create_task",
        title: "Create task",
        surface: "planner",
        href: "/planner",
        action_label: "Create task",
        prompt: "Create a task.",
        enabled: true,
        count: 0,
        reason: null,
        priority: 50,
      },
    ],
    generated_at: "2026-04-28T12:00:00Z",
    ...overrides,
  };
}

const today = buildMobileAssistantTodayViewModel(summary());
if (!today) {
  throw new Error("expected enriched Assistant Today summary to produce a mobile view-model");
}
assert.equal(today.title, "Finish onboarding flow polish");
assert.deepEqual(today.primaryAction, {
  key: "finish_onboarding",
  label: "Start focus",
  prompt: "Start a 90 minute focus block for onboarding flow polish.",
  surface: "planner",
});
assert.deepEqual(
  today.promptChips.map((action) => action.label),
  ["Adjust plan", "Open Review", "Process inbox"],
);
assert.equal(today.promptChips.some((action) => action.label === "Empty disabled action"), false);

assert.equal(today.reasonStack.length, 4);
assert.equal(today.openLoops.length, 3);

const fourthPositiveContext = buildMobileAssistantTodayViewModel(
  summary({
    at_a_glance: [
      { key: "planner", label: "Planner", count: 0, href: "/planner" },
      { key: "library", label: "Library inbox", count: 0, href: "/library" },
      { key: "review", label: "Review due", count: 0, href: "/review" },
      { key: "commitments", label: "Open commitments", count: 2, href: "/planner" },
    ],
  }),
);
assert.deepEqual(
  fourthPositiveContext.openLoops.map((loop) => `${loop.label}:${loop.count}`),
  ["Open commitments:2", "Planner:0", "Library inbox:0"],
);

assert.equal(localDateStringForAssistantToday(new Date(2026, 0, 2, 3, 4, 5)), "2026-01-02");
assert.equal(buildAssistantTodayQueryDate(new Date(2026, 10, 9, 23, 30, 0)), "2026-11-09");

const unusableSummaryFallback = buildMobileAssistantTodayViewModel(
  summary({
    recommended_next_move: {
      key: "broken",
      title: "Broken move",
      body: "No real action exists.",
      surface: "assistant",
      href: null,
      action_label: "Do nothing",
      prompt: null,
      priority: 1,
      urgency: "low",
    },
  }),
);
assert.equal(unusableSummaryFallback.title, "Plan today");
assert.equal(unusableSummaryFallback.primaryAction.prompt, "Help me plan today around my schedule, tasks, and open loops.");
assert.equal(unusableSummaryFallback.promptChips.length, 3);
assert.equal(unusableSummaryFallback.openLoops.length, 3);

const endpointFailureFallback = buildMobileAssistantTodayViewModel(null);
assert.equal(endpointFailureFallback.title, "Plan today");
assert.equal(endpointFailureFallback.reasonStack.length, 4);
assert.deepEqual(
  endpointFailureFallback.promptChips.map((action) => action.label),
  ["Open Planner", "Open Library", "Open Review"],
);

assert.deepEqual(
  resolveMobileAssistantTodayActionRoute({
    key: "planner_both",
    label: "Open Planner",
    surface: "planner",
    href: "/planner",
    prompt: "Plan today with Assistant.",
  }),
  { kind: "navigate", href: "/planner", surface: "planner" },
);
assert.deepEqual(
  resolveMobileAssistantTodayActionRoute({
    key: "assistant_prompt",
    label: "Plan with Assistant",
    surface: "assistant",
    href: "/assistant",
    prompt: "Plan today with Assistant.",
  }),
  { kind: "prompt", prompt: "Plan today with Assistant." },
);
assert.deepEqual(
  resolveMobileAssistantTodayActionRoute({
    key: "disabled",
    label: "Process captures",
    disabledReason: "No unprocessed captures.",
  }),
  { kind: "disabled", reason: "No unprocessed captures." },
);

console.log("mobile assistant today view-model tests passed");
