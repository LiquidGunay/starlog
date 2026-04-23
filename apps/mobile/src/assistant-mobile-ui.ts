import type {
  AssistantAttachment,
  AssistantEntityRef,
  AssistantToolCall,
  AssistantToolResult,
} from "@starlog/contracts";
import type { MobileTab } from "./navigation";

export function supportSurfaceForEntityType(entityType: string): "library" | "planner" | "review" | null {
  if (entityType === "artifact" || entityType === "note" || entityType === "memory_page") {
    return "library";
  }
  if (entityType === "task" || entityType === "briefing" || entityType === "planner_conflict") {
    return "planner";
  }
  if (entityType === "card" || entityType === "review_queue") {
    return "review";
  }
  return null;
}

export function supportSurfaceActionLabel(entityRef: AssistantEntityRef): string {
  const surface = supportSurfaceForEntityType(entityRef.entity_type);
  if (surface === "library") {
    return "Open in Library";
  }
  if (surface === "planner") {
    return "Open in Planner";
  }
  if (surface === "review") {
    return "Open in Review";
  }
  return "Open item";
}

export function mobileTabForAssistantHref(href: string): MobileTab | null {
  const normalized = href.trim();
  if (!normalized) {
    return null;
  }
  if (normalized === "/assistant" || normalized.startsWith("/assistant?")) {
    return "assistant";
  }
  if (normalized === "/review" || normalized.startsWith("/review")) {
    return "review";
  }
  if (normalized === "/planner" || normalized.startsWith("/planner")) {
    return "planner";
  }
  if (normalized === "/notes" || normalized.startsWith("/notes?") || normalized.startsWith("/notes/")) {
    return "library";
  }
  return null;
}

export function attachmentActionLabel(attachment: AssistantAttachment): string {
  if (attachment.kind === "audio") {
    return "Open audio";
  }
  if (attachment.kind === "image") {
    return "Open image";
  }
  if (attachment.kind === "citation") {
    return "Open source";
  }
  if (attachment.kind === "artifact") {
    return "Open artifact";
  }
  return "Open attachment";
}

export function toolStatusSummary(toolCall: AssistantToolCall): string {
  if (toolCall.status === "requires_action") {
    return "Awaiting thread decision";
  }
  if (toolCall.status === "running") {
    return "Running now";
  }
  if (toolCall.status === "queued") {
    return "Queued to run";
  }
  if (toolCall.status === "error") {
    return "Tool execution failed";
  }
  if (toolCall.status === "cancelled") {
    return "Tool execution cancelled";
  }
  return "Completed";
}

export function summarizeOutput(output: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(output)
    .filter((entry) => entry[1] !== null && entry[1] !== undefined)
    .slice(0, 4)
    .map(([key, value]) => {
      if (typeof value === "string") {
        return [key, value];
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return [key, String(value)];
      }
      if (Array.isArray(value)) {
        return [key, `${value.length} item${value.length === 1 ? "" : "s"}`];
      }
      if (typeof value === "object" && value) {
        const fieldCount = Object.keys(value).length;
        return [key, `${fieldCount} field${fieldCount === 1 ? "" : "s"}`];
      }
      return [key, String(value)];
    });
}

export function toolResultBadges(result: AssistantToolResult): string[] {
  const outputCount = Object.keys(result.output || {}).length;
  return [result.status.replace(/_/g, " "), `${outputCount} field${outputCount === 1 ? "" : "s"}`];
}
