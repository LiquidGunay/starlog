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
  const chips = ["Assistant"];
  if (pending) {
    chips.push(panelKicker(pending));
    chips.push(pending.display_mode === "bottom_sheet" ? "Sheet ready" : "Inline panel");
  } else {
    chips.push("Synced thread");
  }
  if (attachmentCount > 0) {
    chips.push(`${attachmentCount} artifact${attachmentCount === 1 ? "" : "s"}`);
  }
  if (hiddenThreadMessageCount > 0) {
    chips.push(`${hiddenThreadMessageCount} system`);
  }
  return chips.slice(0, 4);
}
