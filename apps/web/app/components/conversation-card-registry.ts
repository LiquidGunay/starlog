import { productCardLabel } from "@starlog/contracts";

export type ConversationCardRegistryEntry = {
  label: string;
  tone: string;
  glyph?: string;
};

const REGISTRY: Record<string, ConversationCardRegistryEntry> = {
  assistant_summary: { label: productCardLabel("assistant_summary"), tone: "brief", glyph: "✦" },
  thread_context: { label: productCardLabel("thread_context"), tone: "context", glyph: "◌" },
  review_queue: { label: productCardLabel("review_queue"), tone: "review", glyph: "◈" },
  briefing: { label: productCardLabel("briefing"), tone: "brief", glyph: "◉" },
  task_list: { label: productCardLabel("task_list"), tone: "task", glyph: "☰" },
  knowledge_note: { label: productCardLabel("knowledge_note"), tone: "knowledge", glyph: "✳" },
  capture_item: { label: productCardLabel("capture_item"), tone: "knowledge", glyph: "⬒" },
  memory_suggestion: { label: productCardLabel("memory_suggestion"), tone: "knowledge", glyph: "⟲" },
  tool_step: { label: productCardLabel("tool_step"), tone: "context", glyph: "⊹" },
  project_status: { label: productCardLabel("project_status"), tone: "task", glyph: "▣" },
  goal_status: { label: productCardLabel("goal_status"), tone: "brief", glyph: "◎" },
  commitment_status: { label: productCardLabel("commitment_status"), tone: "task", glyph: "◧" },
  learning_drill: { label: productCardLabel("learning_drill"), tone: "review", glyph: "◈" },
};

export function getConversationCardRegistryEntry(kind: string, title?: string | null): ConversationCardRegistryEntry {
  if (REGISTRY[kind]) {
    return REGISTRY[kind];
  }
  return {
    label: title?.trim() || productCardLabel(kind),
    tone: "default",
    glyph: "•",
  };
}
