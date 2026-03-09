import { readEntitySnapshot } from "./entity-snapshot";

type SearchResult = {
  kind: "artifact" | "note" | "task" | "calendar_event";
  id: string;
  title: string;
  snippet: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

type ArtifactSnapshot = {
  id: string;
  title?: string;
  source_type: string;
  created_at: string;
};

type NoteSnapshot = {
  id: string;
  title: string;
  body_md: string;
  updated_at: string;
};

type TaskSnapshot = {
  id: string;
  title: string;
  status: string;
  due_at?: string | null;
  updated_at: string;
};

type CalendarSnapshot = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  source: string;
};

function includesQuery(fields: Array<string | null | undefined>, query: string): boolean {
  return fields.some((field) => field?.toLowerCase().includes(query));
}

export function searchLocalSnapshots(rawQuery: string, limit = 30): SearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return [];
  }

  const results: SearchResult[] = [];
  const artifacts = readEntitySnapshot<ArtifactSnapshot[]>("artifacts.items", []);
  const notes = readEntitySnapshot<NoteSnapshot[]>("notes.items", []);
  const tasks = readEntitySnapshot<TaskSnapshot[]>("tasks.items", []);
  const events = readEntitySnapshot<CalendarSnapshot[]>("calendar.events", []);

  for (const artifact of artifacts) {
    if (!includesQuery([artifact.title, artifact.source_type], query)) {
      continue;
    }
    results.push({
      kind: "artifact",
      id: artifact.id,
      title: artifact.title || artifact.id,
      snippet: `Artifact snapshot (${artifact.source_type})`,
      updated_at: artifact.created_at,
      metadata: { source_type: artifact.source_type, cached: true },
    });
  }

  for (const note of notes) {
    if (!includesQuery([note.title, note.body_md], query)) {
      continue;
    }
    results.push({
      kind: "note",
      id: note.id,
      title: note.title,
      snippet: note.body_md.slice(0, 180),
      updated_at: note.updated_at,
      metadata: { cached: true },
    });
  }

  for (const task of tasks) {
    if (!includesQuery([task.title, task.status, task.due_at ?? ""], query)) {
      continue;
    }
    results.push({
      kind: "task",
      id: task.id,
      title: task.title,
      snippet: `Task snapshot (${task.status}${task.due_at ? `, due ${task.due_at}` : ""})`,
      updated_at: task.updated_at,
      metadata: { status: task.status, cached: true },
    });
  }

  for (const event of events) {
    if (!includesQuery([event.title, event.source, event.starts_at, event.ends_at], query)) {
      continue;
    }
    results.push({
      kind: "calendar_event",
      id: event.id,
      title: event.title,
      snippet: `Calendar snapshot ${event.starts_at} -> ${event.ends_at}`,
      updated_at: event.starts_at,
      metadata: { source: event.source, cached: true },
    });
  }

  results.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  return results.slice(0, limit);
}
