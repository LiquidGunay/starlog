export type ConversationCardRegistryEntry = {
  label: string;
  tone: string;
  actionLabel?: string;
  actionKind?: "reuse" | "navigate";
  href?: string;
};

const REGISTRY: Record<string, ConversationCardRegistryEntry> = {
  assistant_summary: { label: "Operational Briefing", tone: "brief", actionLabel: "Reuse in composer", actionKind: "reuse" },
  thread_context: { label: "Thread context", tone: "context", actionLabel: "Reuse in composer", actionKind: "reuse" },
  review_queue: { label: "SRS challenge", tone: "review", actionLabel: "Open review", actionKind: "navigate", href: "/review" },
  briefing: { label: "Daily Briefing", tone: "brief", actionLabel: "Open agenda", actionKind: "navigate", href: "/planner" },
  task_list: { label: "Stellar Agenda", tone: "task", actionLabel: "Open agenda", actionKind: "navigate", href: "/planner" },
  knowledge_note: { label: "Knowledge Fragment", tone: "knowledge", actionLabel: "Open note", actionKind: "navigate", href: "/notes" },
};

export function getConversationCardRegistryEntry(kind: string, title?: string | null): ConversationCardRegistryEntry {
  if (REGISTRY[kind]) {
    return REGISTRY[kind];
  }
  return {
    label: title?.trim() || kind.replace(/_/g, " "),
    tone: "default",
    actionLabel: "Reuse in composer",
    actionKind: "reuse",
  };
}
