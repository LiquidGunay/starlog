import { listEntityCacheRecords, readEntityCacheScope } from "./entity-cache";
import { listEntitySnapshotsByPrefix, readEntitySnapshotAsync } from "./entity-snapshot";
import {
  applyOptimisticArtifacts,
  applyOptimisticCalendarEvents,
  applyOptimisticNotes,
  applyOptimisticTasks,
} from "./optimistic-state";
import type { QueuedMutation } from "./mutation-outbox";

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
  version: number;
  created_at: string;
  updated_at: string;
};

type TaskSnapshot = {
  id: string;
  title: string;
  status: string;
  estimate_min?: number | null;
  priority: number;
  due_at?: string | null;
  linked_note_id?: string | null;
  source_artifact_id?: string | null;
  created_at: string;
  updated_at: string;
};

type CalendarSnapshot = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  source: string;
};

type ArtifactGraphSnapshot = {
  artifact: ArtifactSnapshot;
  summaries: Array<{ id: string; version: number; content: string }>;
  cards: Array<{ id: string; prompt: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  notes: Array<{ id: string; title: string }>;
};

const ARTIFACT_ITEMS_ENTITY_SCOPE = "artifacts.items";
const ARTIFACT_GRAPH_ENTITY_SCOPE = "artifacts.graph";
const NOTES_ENTITY_SCOPE = "notes.items";
const TASKS_ENTITY_SCOPE = "tasks.items";
const CALENDAR_EVENTS_ENTITY_SCOPE = "calendar.events";

function includesQuery(fields: Array<string | null | undefined>, query: string): boolean {
  return fields.some((field) => field?.toLowerCase().includes(query));
}

function upsertResult(results: Map<string, SearchResult>, result: SearchResult): void {
  const key = `${result.kind}:${result.id}`;
  const current = results.get(key);
  if (!current || result.updated_at >= current.updated_at) {
    results.set(key, result);
  }
}

function artifactGraphSnippet(graph: ArtifactGraphSnapshot): string {
  const summary = graph.summaries.find((item) => item.content.trim());
  if (summary) {
    return summary.content.slice(0, 180);
  }

  if (graph.tasks.length > 0) {
    return `Artifact graph tasks: ${graph.tasks.slice(0, 2).map((task) => task.title).join(", ")}`;
  }

  if (graph.notes.length > 0) {
    return `Artifact graph notes: ${graph.notes.slice(0, 2).map((note) => note.title).join(", ")}`;
  }

  return `Artifact snapshot (${graph.artifact.source_type})`;
}

export async function searchLocalSnapshots(
  rawQuery: string,
  outbox: QueuedMutation[],
  limit = 30,
): Promise<SearchResult[]> {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return [];
  }

  const [cachedArtifactItems, cachedNoteItems, cachedTaskItems, cachedCalendarItems, cachedArtifactGraphs] =
    await Promise.all([
      readEntityCacheScope<ArtifactSnapshot>(ARTIFACT_ITEMS_ENTITY_SCOPE),
      readEntityCacheScope<NoteSnapshot>(NOTES_ENTITY_SCOPE),
      readEntityCacheScope<TaskSnapshot>(TASKS_ENTITY_SCOPE),
      readEntityCacheScope<CalendarSnapshot>(CALENDAR_EVENTS_ENTITY_SCOPE),
      listEntityCacheRecords<ArtifactGraphSnapshot>(ARTIFACT_GRAPH_ENTITY_SCOPE),
    ]);
  const [bootstrapArtifactItems, bootstrapNoteItems, bootstrapTaskItems, bootstrapCalendarItems, bootstrapArtifactGraphs] =
    await Promise.all([
      cachedArtifactItems.length > 0
        ? Promise.resolve<ArtifactSnapshot[]>([])
        : readEntitySnapshotAsync<ArtifactSnapshot[]>("artifacts.items", []),
      cachedNoteItems.length > 0
        ? Promise.resolve<NoteSnapshot[]>([])
        : readEntitySnapshotAsync<NoteSnapshot[]>("notes.items", []),
      cachedTaskItems.length > 0
        ? Promise.resolve<TaskSnapshot[]>([])
        : readEntitySnapshotAsync<TaskSnapshot[]>("tasks.items", []),
      cachedCalendarItems.length > 0
        ? Promise.resolve<CalendarSnapshot[]>([])
        : readEntitySnapshotAsync<CalendarSnapshot[]>("calendar.events", []),
      cachedArtifactGraphs.length > 0
        ? Promise.resolve<ArtifactGraphSnapshot[]>([])
        : listEntitySnapshotsByPrefix<ArtifactGraphSnapshot>("artifacts.graph:"),
    ]);

  const artifactItems =
    cachedArtifactItems.length > 0 ? cachedArtifactItems : bootstrapArtifactItems;
  const noteItems = cachedNoteItems.length > 0 ? cachedNoteItems : bootstrapNoteItems;
  const taskItems = cachedTaskItems.length > 0 ? cachedTaskItems : bootstrapTaskItems;
  const calendarItems =
    cachedCalendarItems.length > 0 ? cachedCalendarItems : bootstrapCalendarItems;
  const artifactGraphs =
    cachedArtifactGraphs.length > 0
      ? cachedArtifactGraphs.map((record) => record.value)
      : bootstrapArtifactGraphs;

  const results = new Map<string, SearchResult>();
  const artifacts = applyOptimisticArtifacts(artifactItems, outbox);
  const notes = applyOptimisticNotes(noteItems, outbox);
  const tasks = applyOptimisticTasks(taskItems, outbox);
  const events = applyOptimisticCalendarEvents(calendarItems, outbox);

  for (const artifact of artifacts) {
    if (!includesQuery([artifact.title, artifact.source_type], query)) {
      continue;
    }
    upsertResult(results, {
      kind: "artifact",
      id: artifact.id,
      title: artifact.title || artifact.id,
      snippet: `Artifact snapshot (${artifact.source_type})`,
      updated_at: artifact.created_at,
      metadata: {
        source_type: artifact.source_type,
        cached: true,
        pending: artifact.pending ?? false,
      },
    });
  }

  for (const note of notes) {
    if (!includesQuery([note.title, note.body_md], query)) {
      continue;
    }
    upsertResult(results, {
      kind: "note",
      id: note.id,
      title: note.title,
      snippet: note.body_md.slice(0, 180),
      updated_at: note.updated_at,
      metadata: {
        cached: true,
        pending: note.pending ?? false,
      },
    });
  }

  for (const task of tasks) {
    if (!includesQuery([task.title, task.status, task.due_at ?? ""], query)) {
      continue;
    }
    upsertResult(results, {
      kind: "task",
      id: task.id,
      title: task.title,
      snippet: `Task snapshot (${task.status}${task.due_at ? `, due ${task.due_at}` : ""})`,
      updated_at: task.updated_at,
      metadata: {
        status: task.status,
        cached: true,
        pending: task.pending ?? false,
      },
    });
  }

  for (const event of events) {
    if (!includesQuery([event.title, event.source, event.starts_at, event.ends_at], query)) {
      continue;
    }
    upsertResult(results, {
      kind: "calendar_event",
      id: event.id,
      title: event.title,
      snippet: `Calendar snapshot ${event.starts_at} -> ${event.ends_at}`,
      updated_at: event.starts_at,
      metadata: {
        source: event.source,
        cached: true,
        pending: event.pending ?? false,
      },
    });
  }

  for (const graph of artifactGraphs) {
    const summaryText = graph.summaries.map((item) => item.content).join(" ");
    const taskText = graph.tasks.map((item) => `${item.title} ${item.status}`).join(" ");
    const noteText = graph.notes.map((item) => item.title).join(" ");
    const promptText = graph.cards.map((item) => item.prompt).join(" ");

    if (
      !includesQuery(
        [graph.artifact.title, graph.artifact.source_type, summaryText, taskText, noteText, promptText],
        query,
      )
    ) {
      continue;
    }

    upsertResult(results, {
      kind: "artifact",
      id: graph.artifact.id,
      title: graph.artifact.title || graph.artifact.id,
      snippet: artifactGraphSnippet(graph),
      updated_at: graph.artifact.created_at,
      metadata: {
        source_type: graph.artifact.source_type,
        cached: true,
        detail_cached: true,
      },
    });
  }

  return [...results.values()]
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, limit);
}
