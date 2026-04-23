import { PRODUCT_SURFACES } from "@starlog/contracts";
import type {
  AssistantCard,
  AssistantEntityRef,
  AssistantInterrupt,
  AssistantThreadMessage,
  AssistantThreadSnapshot,
  AssistantToolResult,
} from "@starlog/contracts";

export type SupportSurfaceKey = "library" | "planner" | "review";

export type SupportSurfaceState = {
  key: SupportSurfaceKey;
  title: string;
  href: string;
  summary: string;
  active: boolean;
};

type AssistantHandoffLike = {
  artifactId: string | null;
};

type SupportActivity = {
  surface: SupportSurfaceKey;
  entityKey: string;
  note?: string;
  active: boolean;
};

function metadataIdentity(card: AssistantCard): string | null {
  const metadata = card.metadata || {};
  const candidates = [
    metadata.artifact_id,
    metadata.note_id,
    metadata.briefing_id,
    metadata.card_id,
    metadata.proposal_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  if (Array.isArray(metadata.task_ids) && metadata.task_ids.length > 0) {
    return metadata.task_ids
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .sort()
      .join(",");
  }
  return null;
}

function cardIdentity(card: AssistantCard): string {
  if (card.entity_ref?.entity_type && card.entity_ref?.entity_id) {
    return `${card.entity_ref.entity_type}:${card.entity_ref.entity_id}`;
  }
  const metadataId = metadataIdentity(card);
  if (metadataId) {
    return `${card.kind}:${metadataId}`;
  }
  return `${card.kind}:${card.title || card.body || "untitled"}`;
}

function isResolvedEntityUpdate(entityRef: AssistantEntityRef, label?: string | null): boolean {
  if (entityRef.entity_type === "planner_conflict" && typeof label === "string") {
    return label.toLowerCase().includes("resolved");
  }
  return false;
}

function registerActivity(store: Map<string, SupportActivity>, activity: SupportActivity) {
  if (!store.has(activity.entityKey)) {
    store.set(activity.entityKey, activity);
  }
}

function surfaceForCard(card: AssistantCard): SupportSurfaceKey | null {
  if (card.kind === "capture_item" || card.kind === "knowledge_note" || card.kind === "memory_suggestion") {
    return "library";
  }
  if (card.kind === "task_list" || card.kind === "briefing") {
    return "planner";
  }
  if (card.kind === "review_queue") {
    return "review";
  }
  return null;
}

function currentActivityMessages(messages: AssistantThreadMessage[]): AssistantThreadMessage[] {
  let startIndex = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      startIndex = index + 1;
      break;
    }
  }
  return messages.slice(startIndex).filter((message) => message.role !== "user");
}

export function supportSurfaceForEntityType(entityType: string): SupportSurfaceKey | null {
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

function surfaceActivityForCard(card: AssistantCard): SupportActivity | null {
  const surface = surfaceForCard(card);
  if (!surface) {
    return null;
  }
  return {
    surface,
    entityKey: cardIdentity(card),
    active: true,
  };
}

function surfaceActivityForEntityRef(
  entityRef: AssistantEntityRef,
  note?: string,
  active: boolean = true,
): SupportActivity | null {
  const surface = supportSurfaceForEntityType(entityRef.entity_type);
  if (!surface) {
    return null;
  }
  return {
    surface,
    entityKey: `${entityRef.entity_type}:${entityRef.entity_id}`,
    note,
    active,
  };
}

function collectPendingInterrupts(
  interrupts: AssistantInterrupt[],
  activities: Map<string, SupportActivity>,
) {
  for (const interrupt of interrupts) {
    if (interrupt.status !== "pending") {
      continue;
    }
    if (interrupt.entity_ref) {
      const activity = surfaceActivityForEntityRef(interrupt.entity_ref, interrupt.title, true);
      if (activity) {
        registerActivity(activities, activity);
      }
      continue;
    }
    if (interrupt.tool_name === "triage_capture") {
      registerActivity(activities, {
        surface: "library",
        entityKey: `interrupt:${interrupt.id}`,
        note: interrupt.title,
        active: true,
      });
    } else if (
      interrupt.tool_name === "resolve_planner_conflict" ||
      interrupt.tool_name === "request_due_date" ||
      interrupt.tool_name === "choose_morning_focus"
    ) {
      registerActivity(activities, {
        surface: "planner",
        entityKey: `interrupt:${interrupt.id}`,
        note: interrupt.title,
        active: true,
      });
    } else if (interrupt.tool_name === "grade_review_recall") {
      registerActivity(activities, {
        surface: "review",
        entityKey: `interrupt:${interrupt.id}`,
        note: interrupt.title,
        active: true,
      });
    }
  }
}

function collectToolResult(toolResult: AssistantToolResult, activities: Map<string, SupportActivity>) {
  if (toolResult.card) {
    const cardActivity = surfaceActivityForCard(toolResult.card);
    if (cardActivity) {
      registerActivity(activities, cardActivity);
    }
  }
  if (toolResult.entity_ref) {
    const activity = surfaceActivityForEntityRef(toolResult.entity_ref);
    if (activity) {
      registerActivity(activities, activity);
    }
  }
}

function collectLatestMessageActivities(
  snapshot: AssistantThreadSnapshot | null,
  handoff: AssistantHandoffLike | null,
): Map<string, SupportActivity> {
  const activities = new Map<string, SupportActivity>();

  if (handoff?.artifactId) {
    registerActivity(activities, {
      surface: "library",
      entityKey: `artifact:${handoff.artifactId}`,
      note: "Helper handoff is attached",
      active: true,
    });
  }

  collectPendingInterrupts(snapshot?.interrupts || [], activities);

  const messages = currentActivityMessages(snapshot?.messages || []);
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "card") {
        const activity = surfaceActivityForCard(part.card);
        if (activity) {
          registerActivity(activities, activity);
        }
      } else if (part.type === "ambient_update" && part.update.entity_ref) {
        const active = !isResolvedEntityUpdate(part.update.entity_ref, part.update.label);
        const activity = surfaceActivityForEntityRef(part.update.entity_ref, part.update.label, active);
        if (activity) {
          registerActivity(activities, activity);
        }
      } else if (part.type === "interrupt_request" && part.interrupt.entity_ref && part.interrupt.status === "pending") {
        const activity = surfaceActivityForEntityRef(part.interrupt.entity_ref, part.interrupt.title, true);
        if (activity) {
          registerActivity(activities, activity);
        }
      } else if (part.type === "tool_result") {
        collectToolResult(part.tool_result, activities);
      }
    }
  }

  return activities;
}

export function summarizeSupportSurfaces(
  snapshot: AssistantThreadSnapshot | null,
  handoff: AssistantHandoffLike | null,
): SupportSurfaceState[] {
  const activities = collectLatestMessageActivities(snapshot, handoff);

  return (["library", "planner", "review"] as const).map((key) => {
    const surface = PRODUCT_SURFACES[key];
    const relevant = [...activities.values()].filter((activity) => activity.surface === key && activity.active);
    const count = relevant.length;
    const note = relevant[0]?.note;
    let summary = surface.description;
    if (count > 0) {
      const noun = key === "planner" ? "planning item" : key === "review" ? "review item" : "knowledge item";
      const verb = count === 1 ? "is" : "are";
      summary = note
        ? `${note}. ${count} ${noun}${count === 1 ? "" : "s"} ${verb} active from this thread.`
        : `${count} ${noun}${count === 1 ? "" : "s"} ${verb} active from this thread.`;
    } else if (key === "library" && handoff) {
      summary = "A support-surface draft is in progress. Keep the thread anchored to the captured source or open Library for deeper editing.";
    }
    return {
      key,
      title: surface.label,
      href: surface.href,
      summary,
      active: count > 0 || (key === "library" && Boolean(handoff)),
    };
  });
}
