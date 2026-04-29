import type { AssistantInterrupt } from "@starlog/contracts";
import {
  defaultPanelValues,
  mobileAssistantPanelLayout,
  MOBILE_PANEL_ACTION_LAYOUT,
  MOBILE_PANEL_OPTION_LAYOUT,
  mobileAssistantPromptChips,
  mobileCaptureTriagePreview,
  mobileClarificationPreview,
  mobileDynamicPanelStates,
  mobileEntityPickerPreview,
  mobilePanelSecondaryAction,
  mobilePlannerConflictPreview,
  mobilePanelOptionViewModels,
  mobileReviewGradePreview,
  mobileTaskDetailPreview,
  panelDismissPayload,
  panelTone,
  panelSubmitPayload,
  visibleContextChips,
} from "../src/mobile-assistant-panel-state";

declare const require: (moduleName: string) => { equal: (...args: unknown[]) => void; deepEqual: (...args: unknown[]) => void };

const assert = require("node:assert/strict");

function interrupt(overrides: Partial<AssistantInterrupt>): AssistantInterrupt {
  return {
    id: "interrupt-1",
    thread_id: "primary",
    run_id: "run-1",
    status: "pending",
    interrupt_type: "choice",
    tool_name: "choose_morning_focus",
    title: "Choose morning focus",
    body: "Pick the first move.",
    fields: [
      {
        id: "focus",
        kind: "select",
        label: "First move",
        required: true,
        options: [
          { label: "Move project forward", value: "project" },
          { label: "Clear system friction", value: "friction" },
        ],
      },
    ],
    primary_label: "Confirm focus",
    secondary_label: "Later",
    display_mode: "inline",
    consequence_preview: "Planner can reserve the focus window.",
    recommended_defaults: { focus: "project" },
    metadata: {},
    created_at: "2026-04-27T17:00:00Z",
    ...overrides,
  };
}

const first = interrupt({ id: "interrupt-1", tool_name: "choose_morning_focus", display_mode: "inline" });
const second = interrupt({
  id: "interrupt-2",
  tool_name: "resolve_planner_conflict",
  title: "Resolve scheduling conflict",
  display_mode: "sidecar",
  fields: [
    {
      id: "resolution",
      kind: "select",
      label: "Resolution",
      required: true,
      options: [
        { label: "Move deep work", value: "move_deep_work" },
        { label: "Shorten block", value: "shorten" },
      ],
    },
  ],
  recommended_defaults: { resolution: "move_deep_work" },
  metadata: {
    conflict_payload: {
      local_title: "Very long deep work block for onboarding activation polish",
      local_start_label: "9:30 AM",
      local_end_label: "11:00 AM",
      remote_title: "Extremely long product review meeting with platform and growth",
      remote_time_label: "9:45 - 10:15 AM",
      overlap_time_label: "9:45 - 10:15 AM",
      overlap_minutes: 30,
      recommended_repair: "Move deep work",
      target_slot: "2:15 - 3:45 PM",
    },
  },
});

const states = mobileDynamicPanelStates([first, second], {
  "interrupt-1": { focus: "friction" },
  "interrupt-2": { resolution: "shorten" },
});

assert.equal(states.length, 2);
assert.equal(states[0].renderState, "active");
assert.equal(states[0].displayModeLabel, "inline");
assert.deepEqual(states[0].values, { focus: "friction" });
assert.equal(states[1].renderState, "queued");
assert.equal(states[1].displayModeLabel, "inline on mobile");

assert.deepEqual(defaultPanelValues(first), { focus: "project" });

const submit = panelSubmitPayload(second, { "interrupt-2": { resolution: "move_deep_work" } });
assert.equal(submit.interruptId, "interrupt-2");
assert.deepEqual(submit.values, { resolution: "move_deep_work" });

const dismiss = panelDismissPayload(first);
assert.deepEqual(dismiss, { interruptId: "interrupt-1" });

assert.deepEqual(visibleContextChips([first], 0, 0), ["Morning", "Deep work window"]);
assert.deepEqual(visibleContextChips([second], 1, 2), ["Work", "Today", "1 artifact", "Earlier context"]);

const resolved = mobileDynamicPanelStates([interrupt({ id: "resolved", status: "submitted" })], {});
assert.equal(resolved[0].renderState, "resolved");

const longFocus = interrupt({
  id: "long-focus",
  tool_name: "choose_morning_focus",
  fields: [
    {
      id: "focus",
      kind: "select",
      label: "Focus option",
      required: true,
      options: [
        {
          label: "Move the very long onboarding and activation project forward without losing the morning window",
          value: "project",
        },
        {
          label: "Clear system friction across captures, project notes, and pending calendar cleanup",
          value: "friction",
        },
      ],
    },
  ],
  recommended_defaults: { focus: "project" },
});
const longOptions = mobilePanelOptionViewModels(longFocus, longFocus.fields[0], defaultPanelValues(longFocus));
assert.equal(longOptions.length, 2);
assert.equal(longOptions[0].selected, true);
assert.equal(longOptions[0].description, "Make visible progress on a priority project.");
assert.equal(
  longOptions[1].label,
  "Clear system friction across captures, project notes, and pending calendar cleanup",
);

const conflictOptions = mobilePanelOptionViewModels(second, second.fields[0], defaultPanelValues(second));
assert.equal(conflictOptions[0].description, "Recommended - preserves your longer focus block.");
assert.deepEqual(mobilePlannerConflictPreview(second), {
  localTitle: "Very long deep work block for onboarding activation polish",
  localTimeLabel: "9:30 AM - 11:00 AM",
  overlapLabel: "Overlaps by 30m",
  overlapTimeLabel: "9:45 - 10:15 AM",
  remoteTitle: "Extremely long product review meeting with platform and growth",
  remoteTimeLabel: "9:45 - 10:15 AM",
  recommendedRepair: "Move deep work",
  targetSlot: "2:15 - 3:45 PM",
});

assert.deepEqual(
  mobilePlannerConflictPreview(
    interrupt({
      tool_name: "resolve_planner_conflict",
      metadata: {
        conflict_payload: {
          detail: {
            title: "Team Sync",
            local_time: "9:30 - 11:00 AM",
            remote_start_time: "9:45 AM",
            remote_end_time: "10:15 AM",
          },
        },
      },
    }),
  ),
  {
    localTitle: "Starlog focus block",
    localTimeLabel: "9:30 - 11:00 AM",
    overlapLabel: "Overlap",
    overlapTimeLabel: null,
    remoteTitle: "Team Sync",
    remoteTimeLabel: "9:45 AM - 10:15 AM",
    recommendedRepair: null,
    targetSlot: null,
  },
);

assert.deepEqual(
  mobilePlannerConflictPreview(
    interrupt({
      tool_name: "resolve_planner_conflict",
      metadata: {
        conflict_payload: {
          detail: {
            local: {
              title: "Deep work block",
              starts_at: "2026-04-21T09:00:00+00:00",
              ends_at: "2026-04-21T10:30:00+00:00",
            },
            remote: {
              title: "Product review",
              starts_at: "2026-04-21T09:45:00+00:00",
              ends_at: "2026-04-21T10:15:00+00:00",
            },
          },
        },
      },
    }),
  ),
  {
    localTitle: "Deep work block",
    localTimeLabel: "9:00 AM - 10:30 AM",
    overlapLabel: "Overlap",
    overlapTimeLabel: null,
    remoteTitle: "Product review",
    remoteTimeLabel: "9:45 AM - 10:15 AM",
    recommendedRepair: null,
    targetSlot: null,
  },
);

assert.deepEqual(
  mobilePanelSecondaryAction(
    interrupt({
      tool_name: "resolve_planner_conflict",
      secondary_label: "Open Planner",
      defer_label: "Later",
    }),
  ),
  { label: "Open Planner", kind: "open_planner" },
);
assert.deepEqual(
  mobilePanelSecondaryAction(
    interrupt({
      tool_name: "resolve_planner_conflict",
      secondary_label: "Open Planner",
      defer_label: "Open Planner",
    }),
  ),
  { label: "Open Planner", kind: "open_planner" },
);
assert.deepEqual(mobilePanelSecondaryAction(interrupt({ secondary_label: "Adjust options" })), {
  label: "Dismiss",
  kind: "dismiss",
});
assert.deepEqual(mobilePanelSecondaryAction(interrupt({ secondary_label: "Keep in Review" })), {
  label: "Keep in Review",
  kind: "dismiss",
});
assert.deepEqual(
  mobilePanelSecondaryAction(interrupt({ tool_name: "request_due_date", secondary_label: "Save without date", defer_label: "Later" })),
  {
    label: "Save without date",
    kind: "submit",
  },
);
assert.deepEqual(mobilePanelSecondaryAction(interrupt({ tool_name: "triage_capture", secondary_label: "Open Library" })), {
  label: "Open Library",
  kind: "open_library",
});

const taskDetail = interrupt({
  id: "task-detail",
  tool_name: "request_due_date",
  title: "Finish task details",
  fields: [
    { id: "due_date", kind: "date", label: "Due date", required: true, value: "2026-04-28" },
    {
      id: "priority",
      kind: "priority",
      label: "Priority",
      required: false,
      value: 1,
      options: [
        { label: "High", value: "1" },
        { label: "Medium", value: "2" },
        { label: "Low", value: "3" },
      ],
    },
    { id: "create_time_block", kind: "toggle", label: "Create 45m focus block", value: true },
  ],
  entity_ref: {
    entity_type: "task",
    entity_id: "task-onboarding",
    href: "/planner?task=task-onboarding",
    title: "Finish onboarding flow polish",
  },
  metadata: { task_detail: "Needs due date and priority before Starlog creates it." },
});
assert.equal(panelTone(taskDetail), "task");
assert.deepEqual(mobileTaskDetailPreview(taskDetail), {
  title: "Finish onboarding flow polish",
  detail: "Needs due date and priority before Starlog creates it.",
});
const taskPriorityOptions = mobilePanelOptionViewModels(taskDetail, taskDetail.fields[1], defaultPanelValues(taskDetail));
assert.equal(taskPriorityOptions[0].selected, true);
assert.equal(taskPriorityOptions[0].description, "Do this before lower-priority tasks.");
assert.equal(taskPriorityOptions[1].description, "Keep it visible without taking over today.");
assert.equal(taskPriorityOptions[2].description, "Track it without protecting time yet.");

const captureTriage = interrupt({
  id: "capture-triage",
  tool_name: "triage_capture",
  title: "Triage this capture",
  fields: [
    {
      id: "capture_kind",
      kind: "select",
      label: "Classify this item",
      required: true,
      value: "reference",
      options: [
        { label: "Reference", value: "reference" },
        { label: "Idea", value: "idea" },
        { label: "Task", value: "task" },
        { label: "Review material", value: "review_material" },
        { label: "Project input", value: "project_input" },
      ],
    },
    {
      id: "next_step",
      kind: "select",
      label: "Next step",
      required: true,
      value: "summarize",
      options: [
        { label: "Summarize", value: "summarize" },
        { label: "Make cards", value: "cards" },
        { label: "Create task", value: "task" },
        { label: "Append to note", value: "append_note" },
      ],
    },
  ],
  metadata: {
    capture_title: "Design idea: inline AI suggestions in the editor",
    snippet: "Use inline suggestions to keep drafting flow intact.",
    source_label: "Chrome - starlog idea doc",
    captured_at_label: "9:12 AM",
  },
});
assert.equal(panelTone(captureTriage), "capture");
assert.deepEqual(mobileCaptureTriagePreview(captureTriage), {
  title: "Design idea: inline AI suggestions in the editor",
  snippet: "Use inline suggestions to keep drafting flow intact.",
  sourceLabel: "Chrome - starlog idea doc",
  capturedAtLabel: "9:12 AM",
});
const captureKindOptions = mobilePanelOptionViewModels(captureTriage, captureTriage.fields[0], defaultPanelValues(captureTriage));
assert.deepEqual(
  captureKindOptions.map((option) => option.label),
  ["Reference", "Idea", "Task", "Review material", "Project input"],
);
assert.equal(captureKindOptions[0].description, "Keep source context for later lookup.");

const reviewGrade = interrupt({
  id: "review-grade",
  tool_name: "grade_review_recall",
  title: "Grade this review",
  body: "You are missing application, not recall.",
  fields: [
    {
      id: "grade",
      kind: "select",
      label: "Grade",
      required: true,
      value: "3",
      options: [
        { label: "Again", value: "1" },
        { label: "Hard", value: "3" },
        { label: "Good", value: "4" },
        { label: "Easy", value: "5" },
      ],
    },
    {
      id: "support_action",
      kind: "select",
      label: "Support action",
      options: [
        { label: "Show worked example", value: "worked_example" },
        { label: "Switch to explanation", value: "explanation" },
      ],
    },
  ],
  metadata: {
    prompt: "What should you do when a feature flag causes production degradation?",
    insight: "You are missing application, not recall.",
  },
});
assert.equal(panelTone(reviewGrade), "review");
assert.deepEqual(mobileReviewGradePreview(reviewGrade, defaultPanelValues(reviewGrade)), {
  prompt: "What should you do when a feature flag causes production degradation?",
  insight: "You are missing application, not recall.",
  supportActions: [
    {
      label: "Show worked example",
      value: "worked_example",
      description: "See the answer applied to a real case.",
      selected: false,
    },
    {
      label: "Switch to explanation",
      value: "explanation",
      description: "Switch into teaching mode.",
      selected: false,
    },
  ],
});
const reviewOptions = mobilePanelOptionViewModels(reviewGrade, reviewGrade.fields[0], defaultPanelValues(reviewGrade));
assert.equal(reviewOptions[1].selected, true);
assert.equal(reviewOptions[0].description, "Review soon.");
assert.equal(reviewOptions[3].description, "Stretch the interval.");
assert.deepEqual(panelSubmitPayload(reviewGrade, { "review-grade": { grade: "4", support_action: "worked_example" } }), {
  interruptId: "review-grade",
  values: { grade: "4", support_action: "worked_example" },
});

const clarification = interrupt({
  id: "schedule-clarify",
  tool_name: "clarify_schedule_time",
  title: "What time should I schedule this?",
  fields: [
    {
      id: "scheduled_time",
      kind: "select",
      label: "Schedule time",
      required: true,
      value: "09:30",
      options: [
        { label: "9:30 AM", value: "09:30" },
        { label: "10:00 AM", value: "10:00" },
        { label: "Pick custom time", value: "custom" },
      ],
    },
    { id: "reuse_for_similar_blocks", kind: "toggle", label: "Use this time for similar blocks", value: true },
  ],
  metadata: { question: "What time should I schedule this?", detail: "One missing detail." },
});
assert.equal(panelTone(clarification), "clarify");
assert.deepEqual(mobileClarificationPreview(clarification), {
  question: "What time should I schedule this?",
  detail: "One missing detail.",
});
const clarifyOptions = mobilePanelOptionViewModels(clarification, clarification.fields[0], defaultPanelValues(clarification));
assert.equal(clarifyOptions[0].selected, true);
assert.equal(clarifyOptions[1].description, "Use this schedule time.");
assert.equal(clarifyOptions[2].description, "Pick another time.");

const deferReminder = interrupt({
  id: "defer-reminder",
  tool_name: "defer_recommendation",
  title: "Remind me later",
  fields: [
    {
      id: "remind_at",
      kind: "select",
      label: "Reminder",
      value: "in_1_hour",
      options: [
        { label: "In 1 hour", value: "in_1_hour" },
        { label: "This evening", value: "this_evening" },
        { label: "Tomorrow morning", value: "tomorrow_morning" },
        { label: "No thanks, keep it in view", value: "keep_in_view" },
      ],
    },
  ],
});
assert.equal(panelTone(deferReminder), "defer");
const deferOptions = mobilePanelOptionViewModels(deferReminder, deferReminder.fields[0], defaultPanelValues(deferReminder));
assert.equal(deferOptions[0].description, "Remind me without interrupting flow.");
assert.equal(deferOptions[3].description, "Keep it visible without a reminder.");

const projectPicker = interrupt({
  id: "project-picker",
  tool_name: "link_capture_project",
  title: "Link to project",
  fields: [
    {
      id: "project_id",
      kind: "entity_search",
      label: "Suggested projects",
      value: "project_assistant_v2",
      options: [
        { label: "Assistant v2.0 launch", value: "project_assistant_v2" },
        { label: "AI suggestions engine", value: "project_ai_suggestions" },
        { label: "Onboarding experience", value: "project_onboarding" },
      ],
    },
  ],
  entity_ref: {
    entity_type: "artifact",
    entity_id: "artifact-inline-suggestions",
    href: "/library?artifact=artifact-inline-suggestions",
    title: "Design idea: inline AI suggestions in the editor",
  },
  metadata: { item_title: "Design idea: inline AI suggestions in the editor" },
});
assert.equal(panelTone(projectPicker), "entity");
assert.deepEqual(mobileEntityPickerPreview(projectPicker, defaultPanelValues(projectPicker)), {
  title: "Design idea: inline AI suggestions in the editor",
  selectedProjectLabel: "Assistant v2.0 launch",
  suggestedProjects: [
    {
      label: "Assistant v2.0 launch",
      value: "project_assistant_v2",
      description: "Most likely match.",
      selected: true,
    },
    {
      label: "AI suggestions engine",
      value: "project_ai_suggestions",
      description: "Link this item to the project.",
      selected: false,
    },
    {
      label: "Onboarding experience",
      value: "project_onboarding",
      description: "Relevant to the current capture.",
      selected: false,
    },
  ],
});

assert.deepEqual(MOBILE_PANEL_OPTION_LAYOUT, {
  minHeight: 58,
  titleMaxLines: 2,
  descriptionMaxLines: 3,
  iconSize: 28,
  fullWidth: true,
});
assert.deepEqual(MOBILE_PANEL_ACTION_LAYOUT, {
  minHeight: 46,
  primaryBasis: 180,
  secondaryBasis: 138,
  wraps: true,
});
assert.deepEqual(mobileAssistantPanelLayout(320), {
  viewportWidth: 320,
  optionColumns: 1,
  optionTitleMaxLines: 2,
  optionDescriptionMaxLines: 4,
  actionDirection: "column",
  actionPrimaryBasis: "100%",
  actionSecondaryBasis: "100%",
  actionWraps: true,
  conflictTitleMaxLines: 3,
  promptChipMaxWidth: "100%",
});
assert.deepEqual(mobileAssistantPanelLayout(412), {
  viewportWidth: 412,
  optionColumns: 1,
  optionTitleMaxLines: 2,
  optionDescriptionMaxLines: 3,
  actionDirection: "row",
  actionPrimaryBasis: 180,
  actionSecondaryBasis: 138,
  actionWraps: true,
  conflictTitleMaxLines: 2,
  promptChipMaxWidth: "92%",
});
assert.deepEqual(mobileAssistantPanelLayout(412, 1.4), {
  viewportWidth: 412,
  optionColumns: 1,
  optionTitleMaxLines: 2,
  optionDescriptionMaxLines: 3,
  actionDirection: "column",
  actionPrimaryBasis: "100%",
  actionSecondaryBasis: "100%",
  actionWraps: true,
  conflictTitleMaxLines: 2,
  promptChipMaxWidth: "92%",
});

assert.deepEqual(
  mobileAssistantPromptChips(
    [
      "Plan my morning",
      "What is most important?",
      "Review later",
      "This fourth prompt should not render",
      "Plan my morning",
    ],
    "",
  ),
  ["Plan my morning", "What is most important?", "Review later"],
);
assert.deepEqual(mobileAssistantPromptChips(["Repair my afternoon", "Move the meeting"], "already typing"), ["Repair my afternoon"]);

console.log("mobile assistant panel state tests passed");
