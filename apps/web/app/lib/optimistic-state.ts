import type { QueuedMutation } from "./mutation-outbox";

type PendingMeta = {
  pending?: boolean;
  pendingLabel?: string;
};

type NoteLike = {
  id: string;
  title: string;
  body_md: string;
  version: number;
  created_at: string;
  updated_at: string;
} & PendingMeta;

type TaskLike = {
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
} & PendingMeta;

type ArtifactLike = {
  id: string;
  source_type: string;
  title?: string;
  created_at: string;
} & PendingMeta;

type CalendarEventLike = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  source: string;
  remote_id?: string | null;
} & PendingMeta;

function parseBody<T>(mutation: QueuedMutation): T | null {
  if (!mutation.body) {
    return null;
  }
  try {
    return JSON.parse(mutation.body) as T;
  } catch {
    return null;
  }
}

function pendingId(mutation: QueuedMutation): string {
  return `pending:${mutation.id}`;
}

function ordered(outbox: QueuedMutation[]): QueuedMutation[] {
  return [...outbox].sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function applyOptimisticNotes(notes: NoteLike[], outbox: QueuedMutation[]): NoteLike[] {
  const items = [...notes];

  for (const mutation of ordered(outbox)) {
    if (mutation.entity !== "note") {
      continue;
    }

    if (mutation.method === "POST" && mutation.path === "/v1/notes") {
      const payload = parseBody<{ title?: string; body_md?: string }>(mutation);
      items.unshift({
        id: pendingId(mutation),
        title: payload?.title || "Queued note",
        body_md: payload?.body_md || "",
        version: 1,
        created_at: mutation.created_at,
        updated_at: mutation.created_at,
        pending: true,
        pendingLabel: mutation.label,
      });
      continue;
    }

    if (mutation.method === "PATCH" && mutation.path.startsWith("/v1/notes/")) {
      const noteId = mutation.path.replace("/v1/notes/", "");
      const payload = parseBody<{ title?: string; body_md?: string }>(mutation);
      const index = items.findIndex((item) => item.id === noteId);
      if (index >= 0) {
        items[index] = {
          ...items[index],
          ...(payload?.title ? { title: payload.title } : {}),
          ...(payload?.body_md !== undefined ? { body_md: payload.body_md } : {}),
          updated_at: mutation.created_at,
          pending: true,
          pendingLabel: mutation.label,
        };
      }
    }
  }

  return items;
}

export function applyOptimisticTasks(tasks: TaskLike[], outbox: QueuedMutation[]): TaskLike[] {
  const items = [...tasks];

  for (const mutation of ordered(outbox)) {
    if (mutation.entity !== "task") {
      continue;
    }

    if (mutation.method === "POST" && mutation.path === "/v1/tasks") {
      const payload = parseBody<{
        title?: string;
        status?: string;
        estimate_min?: number | null;
        priority?: number;
        due_at?: string | null;
        linked_note_id?: string | null;
        source_artifact_id?: string | null;
      }>(mutation);
      items.unshift({
        id: pendingId(mutation),
        title: payload?.title || "Queued task",
        status: payload?.status || "todo",
        estimate_min: payload?.estimate_min ?? null,
        priority: payload?.priority ?? 2,
        due_at: payload?.due_at ?? null,
        linked_note_id: payload?.linked_note_id ?? null,
        source_artifact_id: payload?.source_artifact_id ?? null,
        created_at: mutation.created_at,
        updated_at: mutation.created_at,
        pending: true,
        pendingLabel: mutation.label,
      });
      continue;
    }

    if (mutation.method === "PATCH" && mutation.path.startsWith("/v1/tasks/")) {
      const taskId = mutation.path.replace("/v1/tasks/", "");
      const payload = parseBody<{
        title?: string;
        status?: string;
        estimate_min?: number | null;
        priority?: number;
        due_at?: string | null;
        linked_note_id?: string | null;
      }>(mutation);
      const index = items.findIndex((item) => item.id === taskId);
      if (index >= 0) {
        items[index] = {
          ...items[index],
          ...(payload?.title ? { title: payload.title } : {}),
          ...(payload?.status ? { status: payload.status } : {}),
          ...(payload?.estimate_min !== undefined ? { estimate_min: payload.estimate_min } : {}),
          ...(payload?.priority !== undefined ? { priority: payload.priority } : {}),
          ...(payload?.due_at !== undefined ? { due_at: payload.due_at } : {}),
          ...(payload?.linked_note_id !== undefined ? { linked_note_id: payload.linked_note_id } : {}),
          updated_at: mutation.created_at,
          pending: true,
          pendingLabel: mutation.label,
        };
      }
    }
  }

  return items;
}

export function applyOptimisticArtifacts(artifacts: ArtifactLike[], outbox: QueuedMutation[]): ArtifactLike[] {
  const items = [...artifacts];

  for (const mutation of ordered(outbox)) {
    if (mutation.entity !== "artifact" || mutation.method !== "POST" || mutation.path !== "/v1/capture") {
      continue;
    }
    const payload = parseBody<{ title?: string; source_type?: string }>(mutation);
    items.unshift({
      id: pendingId(mutation),
      title: payload?.title || "Queued clip",
      source_type: payload?.source_type || "clip_manual",
      created_at: mutation.created_at,
      pending: true,
      pendingLabel: mutation.label,
    });
  }

  return items;
}

export function applyOptimisticCalendarEvents(
  events: CalendarEventLike[],
  outbox: QueuedMutation[],
): CalendarEventLike[] {
  let items = [...events];

  for (const mutation of ordered(outbox)) {
    if (mutation.entity !== "calendar_event") {
      continue;
    }

    if (mutation.method === "POST" && mutation.path === "/v1/calendar/events") {
      const payload = parseBody<{
        title?: string;
        starts_at?: string;
        ends_at?: string;
        source?: string;
        remote_id?: string | null;
      }>(mutation);
      items = [
        {
          id: pendingId(mutation),
          title: payload?.title || "Queued event",
          starts_at: payload?.starts_at || mutation.created_at,
          ends_at: payload?.ends_at || mutation.created_at,
          source: payload?.source || "internal",
          remote_id: payload?.remote_id ?? null,
          pending: true,
          pendingLabel: mutation.label,
        },
        ...items,
      ];
      continue;
    }

    if (mutation.method === "PATCH" && mutation.path.startsWith("/v1/calendar/events/")) {
      const eventId = mutation.path.replace("/v1/calendar/events/", "");
      const payload = parseBody<{
        title?: string;
        starts_at?: string;
        ends_at?: string;
        source?: string;
      }>(mutation);
      items = items.map((item) =>
        item.id === eventId
          ? {
              ...item,
              ...(payload?.title ? { title: payload.title } : {}),
              ...(payload?.starts_at ? { starts_at: payload.starts_at } : {}),
              ...(payload?.ends_at ? { ends_at: payload.ends_at } : {}),
              ...(payload?.source ? { source: payload.source } : {}),
              pending: true,
              pendingLabel: mutation.label,
            }
          : item,
      );
      continue;
    }

    if (mutation.method === "DELETE" && mutation.path.startsWith("/v1/calendar/events/")) {
      const eventId = mutation.path.replace("/v1/calendar/events/", "");
      items = items.filter((item) => item.id !== eventId);
    }
  }

  return items;
}
