export function mobileConversationCardLabel(kind: string, title?: string | null): string {
  if (title?.trim()) {
    return title.trim();
  }
  const labels: Record<string, string> = {
    assistant_summary: "Observatory brief",
    thread_context: "Thread context",
    review_queue: "Review queue",
    briefing: "Briefing",
    task_list: "Task list",
    knowledge_note: "Knowledge note",
  };
  return labels[kind] ?? kind.replace(/_/g, " ");
}
