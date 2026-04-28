import type { AssistantInterrupt, AssistantInterruptField } from "@starlog/contracts";

export type PanelTone = "focus" | "task" | "capture" | "conflict" | "review" | "clarify" | "defer" | "default";
export type MobilePanelRenderState = "active" | "queued" | "resolved";

export const DYNAMIC_PANEL_TOOL_TONES: Record<string, PanelTone> = {
  choose_morning_focus: "focus",
  request_due_date: "task",
  triage_capture: "capture",
  resolve_planner_conflict: "conflict",
  grade_review_recall: "review",
  clarify_assistant_request: "clarify",
  defer_recommendation: "defer",
};

export type MobileDynamicPanelState = {
  interrupt: AssistantInterrupt;
  values: Record<string, unknown>;
  renderState: MobilePanelRenderState;
  displayModeLabel: string;
};

export type MobilePanelOptionViewModel = {
  label: string;
  value: string;
  description: string | null;
  selected: boolean;
};

export const MOBILE_ASSISTANT_MAX_PROMPT_CHIPS = 3;

export function defaultPanelValues(interrupt: AssistantInterrupt): Record<string, unknown> {
  return interrupt.fields.reduce<Record<string, unknown>>((accumulator, field) => {
    accumulator[field.id] = interrupt.recommended_defaults?.[field.id] ?? field.value ?? (field.kind === "toggle" ? false : "");
    return accumulator;
  }, {});
}

export function activePendingInterruptId(interrupts: AssistantInterrupt[]): string | null {
  return interrupts.find((interrupt) => interrupt.status === "pending")?.id ?? null;
}

export function panelTone(interrupt: AssistantInterrupt): PanelTone {
  return DYNAMIC_PANEL_TOOL_TONES[interrupt.tool_name] || "default";
}

export function panelKicker(interrupt: AssistantInterrupt): string {
  if (interrupt.tool_name === "choose_morning_focus") {
    return "Morning focus";
  }
  if (interrupt.tool_name === "request_due_date") {
    return "Task details";
  }
  if (interrupt.tool_name === "triage_capture") {
    return "Capture triage";
  }
  if (interrupt.tool_name === "resolve_planner_conflict") {
    return "Planner conflict";
  }
  if (interrupt.tool_name === "grade_review_recall") {
    return "Review grade";
  }
  if (interrupt.tool_name.includes("clarif")) {
    return "Clarification";
  }
  if (interrupt.tool_name.includes("defer")) {
    return "Defer";
  }
  return interrupt.tool_name.replace(/_/g, " ");
}

export function mobilePanelDisplayModeLabel(interrupt: AssistantInterrupt): string {
  if (interrupt.display_mode === "bottom_sheet") {
    return "opens as sheet";
  }
  if (interrupt.display_mode === "sidecar") {
    return "inline on mobile";
  }
  return "inline";
}

export function mobileDynamicPanelStates(
  interrupts: AssistantInterrupt[],
  valuesByInterruptId: Record<string, Record<string, unknown>>,
): MobileDynamicPanelState[] {
  const activeId = activePendingInterruptId(interrupts);
  return interrupts.map((interrupt) => {
    const pending = interrupt.status === "pending";
    return {
      interrupt,
      values: valuesByInterruptId[interrupt.id] || defaultPanelValues(interrupt),
      renderState: pending ? (interrupt.id === activeId ? "active" : "queued") : "resolved",
      displayModeLabel: mobilePanelDisplayModeLabel(interrupt),
    };
  });
}

export function panelSubmitPayload(
  interrupt: AssistantInterrupt,
  valuesByInterruptId: Record<string, Record<string, unknown>>,
): { interruptId: string; values: Record<string, unknown> } {
  return {
    interruptId: interrupt.id,
    values: valuesByInterruptId[interrupt.id] || defaultPanelValues(interrupt),
  };
}

export function panelDismissPayload(interrupt: AssistantInterrupt): { interruptId: string } {
  return { interruptId: interrupt.id };
}

export function fieldValue(values: Record<string, unknown>, field: AssistantInterruptField): string {
  const value = values[field.id];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

export function fieldSummary(field: AssistantInterruptField): string | null {
  if (field.kind === "date") {
    return "Today, tomorrow, or a picked date.";
  }
  if (field.kind === "time" || field.kind === "datetime") {
    return "Choose a specific time when needed.";
  }
  if (field.kind === "entity_search") {
    return "Search opens as a larger picker when wired.";
  }
  return null;
}

export function valueLabel(field: AssistantInterruptField, value: unknown): string {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const optionLabel = field.options?.find((option) => option.value === normalized)?.label;
  return optionLabel || normalized.replace(/_/g, " ");
}

export function selectedValueLabel(interrupt: AssistantInterrupt, values: Record<string, unknown>): string | null {
  const field = interrupt.fields.find((candidate) => {
    const value = values[candidate.id];
    return value !== undefined && value !== null && String(value).trim().length > 0;
  });
  if (!field) {
    return null;
  }
  return valueLabel(field, values[field.id]);
}

export function visibleContextChips(interrupts: AssistantInterrupt[], attachmentCount: number, hiddenThreadMessageCount: number): string[] {
  const pending = interrupts.find((interrupt) => interrupt.status === "pending");
  const chips: string[] = [];
  if (pending?.tool_name === "choose_morning_focus") {
    chips.push("Morning", "Deep work window");
  } else if (pending?.tool_name === "resolve_planner_conflict") {
    chips.push("Work", "Today");
  } else if (pending) {
    chips.push(panelKicker(pending), pending.display_mode === "bottom_sheet" ? "Sheet ready" : "Inline panel");
  } else {
    chips.push("Assistant", "Synced thread");
  }
  if (attachmentCount > 0) {
    chips.push(`${attachmentCount} artifact${attachmentCount === 1 ? "" : "s"}`);
  }
  if (hiddenThreadMessageCount > 0) {
    chips.push(`${hiddenThreadMessageCount} system`);
  }
  return chips.slice(0, 4);
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionDescription(interrupt: AssistantInterrupt, field: AssistantInterruptField, value: string, label: string): string | null {
  const fieldDescriptions = metadataRecord(field.metadata?.option_descriptions);
  const interruptDescriptions = metadataRecord(interrupt.metadata?.option_descriptions);
  const direct = fieldDescriptions[value] ?? interruptDescriptions[value] ?? fieldDescriptions[label] ?? interruptDescriptions[label];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  if (interrupt.tool_name === "choose_morning_focus") {
    if (value.includes("project") || /project/i.test(label)) {
      return "Make visible progress on a priority project.";
    }
    if (value.includes("friction") || /friction|system/i.test(label)) {
      return "Reduce blockers and context switching.";
    }
    if (value.includes("learning") || /learning|review|practice/i.test(label)) {
      return "Review or practice important material.";
    }
  }
  if (interrupt.tool_name === "resolve_planner_conflict") {
    if (value.includes("move") || /move/i.test(label)) {
      return "Recommended - preserves your longer focus block.";
    }
    if (value.includes("shorten") || /shorten/i.test(label)) {
      return "Keep both, but reduce protected time.";
    }
    if (value.includes("keep") || /keep/i.test(label)) {
      return "Mark deep work flexible and decide later.";
    }
  }
  return null;
}

export function mobilePanelOptionViewModels(
  interrupt: AssistantInterrupt,
  field: AssistantInterruptField,
  values: Record<string, unknown>,
): MobilePanelOptionViewModel[] {
  const options =
    field.options && field.options.length > 0
      ? field.options
      : field.kind === "priority"
        ? [1, 2, 3, 4, 5].map((option) => ({ label: `Priority ${option}`, value: String(option) }))
        : [];
  const selected = fieldValue(values, field);
  return options.map((option) => ({
    label: option.label,
    value: option.value,
    description: optionDescription(interrupt, field, option.value, option.label),
    selected: selected === option.value,
  }));
}

export function mobileAssistantPromptChips(suggestions: string[], draft: string): string[] {
  const seen = new Set<string>();
  const cleaned = suggestions
    .map((label) => label.trim())
    .filter((label) => {
      if (!label || seen.has(label.toLowerCase())) {
        return false;
      }
      seen.add(label.toLowerCase());
      return true;
    });
  return cleaned.slice(0, draft.trim().length > 0 ? 1 : MOBILE_ASSISTANT_MAX_PROMPT_CHIPS);
}
