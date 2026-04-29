import type { AssistantInterrupt } from "@starlog/contracts";
import {
  defaultPanelValues,
  mobileAssistantPanelLayout,
  MOBILE_PANEL_ACTION_LAYOUT,
  MOBILE_PANEL_OPTION_LAYOUT,
  mobileAssistantPromptChips,
  mobileDynamicPanelStates,
  mobilePanelSecondaryAction,
  mobilePlannerConflictPreview,
  mobilePanelOptionViewModels,
  panelDismissPayload,
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
  { label: "Later", kind: "dismiss" },
);
assert.deepEqual(
  mobilePanelSecondaryAction(
    interrupt({
      tool_name: "resolve_planner_conflict",
      secondary_label: "Open Planner",
      defer_label: "Open Planner",
    }),
  ),
  { label: "Dismiss", kind: "dismiss" },
);
assert.deepEqual(mobilePanelSecondaryAction(interrupt({ secondary_label: "Adjust options" })), {
  label: "Dismiss",
  kind: "dismiss",
});
assert.deepEqual(mobilePanelSecondaryAction(interrupt({ secondary_label: "Keep in Review" })), {
  label: "Keep in Review",
  kind: "dismiss",
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
