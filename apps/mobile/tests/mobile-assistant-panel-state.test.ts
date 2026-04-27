import type { AssistantInterrupt } from "@starlog/contracts";
import {
  defaultPanelValues,
  mobileDynamicPanelStates,
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

assert.deepEqual(visibleContextChips([second], 1, 2), ["Assistant", "Planner conflict", "Inline panel", "1 artifact"]);

const resolved = mobileDynamicPanelStates([interrupt({ id: "resolved", status: "submitted" })], {});
assert.equal(resolved[0].renderState, "resolved");

console.log("mobile assistant panel state tests passed");
