export type ConversationCardRegistryEntry = {
  label: string;
  tone: string;
  actionLabel?: string;
};

const REGISTRY: Record<string, ConversationCardRegistryEntry> = {
  assistant_summary: { label: "Operational Briefing", tone: "brief", actionLabel: "Reuse in composer" },
  thread_context: { label: "Thread context", tone: "context", actionLabel: "Reuse in composer" },
  review_queue: { label: "SRS challenge", tone: "review", actionLabel: "Open review" },
  briefing: { label: "Daily Briefing", tone: "brief", actionLabel: "Open agenda" },
  task_list: { label: "Stellar Agenda", tone: "task", actionLabel: "Open agenda" },
  knowledge_note: { label: "Knowledge Fragment", tone: "knowledge", actionLabel: "Open note" },
};

export function getConversationCardRegistryEntry(kind: string, title?: string | null): ConversationCardRegistryEntry {
  if (REGISTRY[kind]) {
    return REGISTRY[kind];
  }
  return {
    label: title?.trim() || kind.replace(/_/g, " "),
    tone: "default",
    actionLabel: "Reuse in composer",
  };
}
