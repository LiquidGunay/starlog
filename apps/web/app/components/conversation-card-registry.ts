export type ConversationCardRegistryEntry = {
  label: string;
  tone: string;
  glyph?: string;
  actionLabel?: string;
  actionKind?: "reuse" | "navigate";
  href?: string;
};

const REGISTRY: Record<string, ConversationCardRegistryEntry> = {
  assistant_summary: { label: "Operational Briefing", tone: "brief", glyph: "✦", actionLabel: "Reuse in composer", actionKind: "reuse" },
  thread_context: { label: "Thread context", tone: "context", glyph: "◌", actionLabel: "Reuse in composer", actionKind: "reuse" },
  review_queue: { label: "SRS challenge", tone: "review", glyph: "◈", actionLabel: "Open review", actionKind: "navigate", href: "/review" },
  briefing: { label: "Daily Briefing", tone: "brief", glyph: "◉", actionLabel: "Open agenda", actionKind: "navigate", href: "/planner" },
  task_list: { label: "Stellar Agenda", tone: "task", glyph: "☰", actionLabel: "Open agenda", actionKind: "navigate", href: "/planner" },
  knowledge_note: { label: "Knowledge Fragment", tone: "knowledge", glyph: "✳", actionLabel: "Open note", actionKind: "navigate", href: "/notes" },
  tool_step: { label: "Tool step", tone: "context", glyph: "⊹" },
};

export function getConversationCardRegistryEntry(kind: string, title?: string | null): ConversationCardRegistryEntry {
  if (REGISTRY[kind]) {
    return REGISTRY[kind];
  }
  return {
    label: title?.trim() || kind.replace(/_/g, " "),
    tone: "default",
    glyph: "•",
    actionLabel: "Reuse in composer",
    actionKind: "reuse",
  };
}
