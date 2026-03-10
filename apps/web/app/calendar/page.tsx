"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { SessionControls } from "../components/session-controls";
import {
  ENTITY_CACHE_INVALIDATION_EVENT,
  cachePrefixesIntersect,
  clearEntityCachesStale,
  hasStaleEntityCache,
  readEntitySnapshot,
  readEntitySnapshotAsync,
  writeEntitySnapshot,
} from "../lib/entity-snapshot";
import { applyOptimisticCalendarEvents } from "../lib/optimistic-state";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type CalendarEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  source: string;
  remote_id?: string | null;
  pending?: boolean;
  pendingLabel?: string;
};

type GoogleSyncResult = {
  run_id: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  last_synced_at: string;
};

type CalendarConflict = {
  id: string;
  remote_id: string;
  strategy: string;
  resolved: boolean;
};

type ConflictReplayResult = {
  sync_run: {
    run_id: string;
    pushed: number;
    pulled: number;
    conflicts: number;
    last_synced_at: string;
  };
  conflict?: CalendarConflict | null;
};

const CALENDAR_EVENTS_SNAPSHOT = "calendar.events";
const CALENDAR_CONFLICTS_SNAPSHOT = "calendar.conflicts";
const CALENDAR_LAST_SYNC_SNAPSHOT = "calendar.last_sync";
const CALENDAR_SELECTED_DAY_SNAPSHOT = "calendar.selected_day";
const CALENDAR_CACHE_PREFIXES = ["calendar."];

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toDateTimeLocal(value: string): string {
  if (!value) {
    return "";
  }
  return value.slice(0, 16);
}

function toApiDateTime(value: string): string {
  if (!value) {
    return "";
  }
  const stamp = new Date(value);
  return stamp.toISOString();
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function startOfWeek(day: string): Date {
  const value = new Date(`${day}T00:00:00`);
  const weekday = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - weekday);
  return value;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CalendarPageContent() {
  const searchParams = useSearchParams();
  const { apiBase, token, outbox, mutateWithQueue } = useSessionConfig();
  const initialDay = useMemo(() => readEntitySnapshot<string>(CALENDAR_SELECTED_DAY_SNAPSHOT, isoDate(new Date())), []);
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [events, setEvents] = useState<CalendarEvent[]>(() => readEntitySnapshot<CalendarEvent[]>(CALENDAR_EVENTS_SNAPSHOT, []));
  const [conflicts, setConflicts] = useState<CalendarConflict[]>(() => readEntitySnapshot<CalendarConflict[]>(CALENDAR_CONFLICTS_SNAPSHOT, []));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("Focus block");
  const [startsAt, setStartsAt] = useState(`${initialDay}T08:00`);
  const [endsAt, setEndsAt] = useState(`${initialDay}T09:00`);
  const [status, setStatus] = useState("Ready");
  const [lastSync, setLastSync] = useState<GoogleSyncResult | null>(() => readEntitySnapshot<GoogleSyncResult | null>(CALENDAR_LAST_SYNC_SNAPSHOT, null));

  useEffect(() => {
    setEvents((previous) => previous.length > 0 ? previous : readEntitySnapshot<CalendarEvent[]>(CALENDAR_EVENTS_SNAPSHOT, []));
    setConflicts((previous) => previous.length > 0 ? previous : readEntitySnapshot<CalendarConflict[]>(CALENDAR_CONFLICTS_SNAPSHOT, []));
    setLastSync((previous) => previous ?? readEntitySnapshot<GoogleSyncResult | null>(CALENDAR_LAST_SYNC_SNAPSHOT, null));
    setSelectedDay((previous) => previous || readEntitySnapshot<string>(CALENDAR_SELECTED_DAY_SNAPSHOT, isoDate(new Date())));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cachedEvents, cachedConflicts, cachedLastSync, cachedSelectedDay] = await Promise.all([
        readEntitySnapshotAsync<CalendarEvent[]>(CALENDAR_EVENTS_SNAPSHOT, []),
        readEntitySnapshotAsync<CalendarConflict[]>(CALENDAR_CONFLICTS_SNAPSHOT, []),
        readEntitySnapshotAsync<GoogleSyncResult | null>(CALENDAR_LAST_SYNC_SNAPSHOT, null),
        readEntitySnapshotAsync<string>(CALENDAR_SELECTED_DAY_SNAPSHOT, isoDate(new Date())),
      ]);

      if (cancelled) {
        return;
      }

      if (cachedEvents.length > 0) {
        setEvents(cachedEvents);
      }
      if (cachedConflicts.length > 0) {
        setConflicts(cachedConflicts);
      }
      if (cachedLastSync) {
        setLastSync(cachedLastSync);
      }
      if (cachedSelectedDay) {
        setSelectedDay((previous) => previous || cachedSelectedDay);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDay);
    return Array.from({ length: 7 }).map((_, index) => {
      const next = new Date(start);
      next.setDate(start.getDate() + index);
      return isoDate(next);
    });
  }, [selectedDay]);

  const visibleEvents = useMemo(
    () => applyOptimisticCalendarEvents(events, outbox),
    [events, outbox],
  );

  const eventsByDay = useMemo(() => {
    const buckets = new Map<string, CalendarEvent[]>();
    for (const day of weekDays) {
      buckets.set(day, []);
    }
    for (const event of visibleEvents) {
      const day = event.starts_at.slice(0, 10);
      const bucket = buckets.get(day);
      if (!bucket) {
        continue;
      }
      bucket.push(event);
    }
    for (const day of weekDays) {
      buckets.get(day)?.sort((left, right) => left.starts_at.localeCompare(right.starts_at));
    }
    return buckets;
  }, [visibleEvents, weekDays]);

  const refresh = useCallback(async () => {
    try {
      const [eventPayload, conflictPayload] = await Promise.all([
        apiRequest<CalendarEvent[]>(apiBase, token, "/v1/calendar/events"),
        apiRequest<CalendarConflict[]>(apiBase, token, "/v1/calendar/sync/google/conflicts"),
      ]);
      setEvents(eventPayload);
      setConflicts(conflictPayload);
      writeEntitySnapshot(CALENDAR_EVENTS_SNAPSHOT, eventPayload);
      writeEntitySnapshot(CALENDAR_CONFLICTS_SNAPSHOT, conflictPayload);
      clearEntityCachesStale(CALENDAR_CACHE_PREFIXES);
      setStatus(`Loaded ${eventPayload.length} events`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Calendar load failed";
      setStatus(events.length > 0 ? `Loaded cached calendar. ${detail}` : detail);
    }
  }, [apiBase, events.length, token]);

  async function submitEvent() {
    if (!title.trim()) {
      setStatus("Event title is required");
      return;
    }
    if (!startsAt || !endsAt) {
      setStatus("Start and end times are required");
      return;
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setStatus("End time must be after start time");
      return;
    }

    const payload = {
      title: title.trim(),
      starts_at: toApiDateTime(startsAt),
      ends_at: toApiDateTime(endsAt),
      source: "internal",
    };

    try {
      if (editingId) {
        const result = await mutateWithQueue<CalendarEvent>(
          `/v1/calendar/events/${editingId}`,
          {
            method: "PATCH",
            body: JSON.stringify(payload),
          },
          {
            label: `Update calendar event: ${title.trim()}`,
            entity: "calendar_event",
            op: "update",
          },
        );
        if (result.queued) {
          setEditingId(null);
          clearForm();
          setStatus("Event update queued for replay");
          return;
        }
        setStatus("Event updated");
      } else {
        const result = await mutateWithQueue<CalendarEvent>(
          "/v1/calendar/events",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          {
            label: `Create calendar event: ${title.trim()}`,
            entity: "calendar_event",
            op: "create",
          },
        );
        if (result.queued) {
          clearForm();
          setStatus("Event create queued for replay");
          return;
        }
        setStatus("Event created");
      }
      setEditingId(null);
      clearForm();
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Event save failed");
    }
  }

  function startEdit(event: CalendarEvent) {
    if (event.id.startsWith("pending:")) {
      setStatus("Replay queued event creation before editing it");
      return;
    }
    setEditingId(event.id);
    setTitle(event.title);
    setStartsAt(toDateTimeLocal(event.starts_at));
    setEndsAt(toDateTimeLocal(event.ends_at));
    setSelectedDay(event.starts_at.slice(0, 10));
    setStatus(`Editing ${event.title}`);
  }

  async function removeEvent(eventId: string) {
    if (eventId.startsWith("pending:")) {
      setStatus("Drop the queued event from Sync if you want to remove it before replay");
      return;
    }
    try {
      const result = await mutateWithQueue(
        `/v1/calendar/events/${eventId}`,
        {
          method: "DELETE",
        },
        {
          label: `Delete calendar event: ${eventId}`,
          entity: "calendar_event",
          op: "delete",
        },
      );
      if (editingId === eventId) {
        setEditingId(null);
      }
      if (result.queued) {
        setStatus("Event delete queued for replay");
        return;
      }
      await refresh();
      setStatus("Event deleted");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
    }
  }

  function clearForm() {
    setEditingId(null);
    setTitle("Focus block");
    setStartsAt(`${selectedDay}T08:00`);
    setEndsAt(`${selectedDay}T09:00`);
  }

  async function runSync() {
    try {
      const result = await apiRequest<GoogleSyncResult>(apiBase, token, "/v1/calendar/sync/google/run", {
        method: "POST",
      });
      setLastSync(result);
      writeEntitySnapshot(CALENDAR_LAST_SYNC_SNAPSHOT, result);
      await refresh();
      setStatus(`Sync ${result.run_id}: pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Google sync failed");
    }
  }

  useEffect(() => {
    writeEntitySnapshot(CALENDAR_SELECTED_DAY_SNAPSHOT, selectedDay);
  }, [selectedDay]);

  useEffect(() => {
    if (!token) {
      return;
    }
    refresh().catch(() => undefined);
  }, [refresh, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const refreshIfStale = () => {
      if (!window.navigator.onLine || !hasStaleEntityCache(CALENDAR_CACHE_PREFIXES)) {
        return;
      }
      refresh().catch(() => undefined);
    };

    refreshIfStale();

    const onInvalidation = (event: Event) => {
      const detail = (event as CustomEvent<{ prefixes: string[] }>).detail;
      if (detail && cachePrefixesIntersect(detail.prefixes, CALENDAR_CACHE_PREFIXES)) {
        refreshIfStale();
      }
    };

    window.addEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    return () => {
      window.removeEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    };
  }, [refresh, token]);

  async function replayConflict(conflictId: string) {
    try {
      const payload = await apiRequest<ConflictReplayResult>(
        apiBase,
        token,
        `/v1/calendar/sync/google/conflicts/${conflictId}/replay`,
        { method: "POST" },
      );
      setLastSync({
        run_id: payload.sync_run.run_id,
        pushed: payload.sync_run.pushed,
        pulled: payload.sync_run.pulled,
        conflicts: payload.sync_run.conflicts,
        last_synced_at: payload.sync_run.last_synced_at,
      });
      await refresh();
      setStatus(
        payload.conflict
          ? `Replayed conflict ${conflictId} in sync ${payload.sync_run.run_id}; conflict still present`
          : `Replayed conflict ${conflictId} in sync ${payload.sync_run.run_id}; no unresolved conflict remains`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Conflict replay failed");
    }
  }

  useEffect(() => {
    const requestedId = searchParams.get("event");
    if (!requestedId) {
      return;
    }
    const requestedEvent = visibleEvents.find((event) => event.id === requestedId);
    if (!requestedEvent) {
      return;
    }
    setSelectedDay(requestedEvent.starts_at.slice(0, 10));
    if (!requestedEvent.id.startsWith("pending:")) {
      setEditingId(requestedEvent.id);
      setTitle(requestedEvent.title);
      setStartsAt(toDateTimeLocal(requestedEvent.starts_at));
      setEndsAt(toDateTimeLocal(requestedEvent.ends_at));
    }
  }, [searchParams, visibleEvents]);

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Calendar</p>
          <h1>Weekly board and event lifecycle</h1>
          <p className="console-copy">
            Create, update, delete, and sync events while keeping conflict visibility in one workspace.
          </p>
          <label className="label" htmlFor="calendar-day">Anchor day</label>
          <input
            id="calendar-day"
            className="input"
            value={selectedDay}
            onChange={(event) => setSelectedDay(event.target.value)}
          />

          <label className="label" htmlFor="calendar-title">Event title</label>
          <input
            id="calendar-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <label className="label" htmlFor="calendar-start">Starts at</label>
          <input
            id="calendar-start"
            className="input"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
          <label className="label" htmlFor="calendar-end">Ends at</label>
          <input
            id="calendar-end"
            className="input"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />

          <div className="button-row">
            <button className="button" type="button" onClick={() => submitEvent()}>
              {editingId ? "Save Event" : "Create Event"}
            </button>
            <button className="button" type="button" onClick={() => clearForm()}>Clear Form</button>
            <button className="button" type="button" onClick={() => refresh()}>Refresh</button>
            <button className="button" type="button" onClick={() => runSync()}>Run Google Sync</button>
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Week board</h2>
          <div className="calendar-board">
            {weekDays.map((day) => {
              const dayEvents = eventsByDay.get(day) || [];
              return (
                <article key={day} className="calendar-day">
                  <h3>{dayLabel(day)}</h3>
                  {dayEvents.length === 0 ? (
                    <p className="console-copy">No events</p>
                  ) : (
                    <ul className="timeline-list">
                      {dayEvents.map((event) => (
                        <li key={event.id} className="timeline-item">
                          <div>
                            <strong>{event.title}</strong>
                            <p className="console-copy">
                              {formatTime(event.starts_at)} - {formatTime(event.ends_at)}
                            </p>
                            <p className="console-copy">Source: {event.source}</p>
                            {event.pending ? (
                              <p className="console-copy">Pending: {event.pendingLabel || "queued mutation"}</p>
                            ) : null}
                          </div>
                          <div className="button-row">
                            <button className="button" type="button" onClick={() => startEdit(event)}>
                              Edit
                            </button>
                            <button className="button" type="button" onClick={() => removeEvent(event.id)}>
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>

          <h2>Sync summary</h2>
          {lastSync ? (
            <div>
              <p className="console-copy">Pushed: {lastSync.pushed}</p>
              <p className="console-copy">Pulled: {lastSync.pulled}</p>
              <p className="console-copy">Conflicts: {lastSync.conflicts}</p>
              <p className="console-copy">Run id: {lastSync.run_id}</p>
              <p className="console-copy">Last sync: {lastSync.last_synced_at}</p>
            </div>
          ) : (
            <p className="console-copy">Run sync to populate live stats.</p>
          )}

          <h2>Unresolved conflicts</h2>
          {conflicts.length === 0 ? (
            <p className="console-copy">No unresolved conflicts.</p>
          ) : (
            <ul>
              {conflicts.map((conflict) => (
                <li key={conflict.id}>
                  <p className="console-copy">
                    {conflict.remote_id} ({conflict.strategy})
                  </p>
                  <div className="button-row">
                    <button className="button" type="button" onClick={() => replayConflict(conflict.id)}>
                      Replay Sync
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<main className="shell"><section className="workspace glass"><p className="status">Loading calendar...</p></section></main>}>
      <CalendarPageContent />
    </Suspense>
  );
}
