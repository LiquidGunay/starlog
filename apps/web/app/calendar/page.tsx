"use client";

import { useMemo, useState } from "react";

import { SessionControls } from "../components/session-controls";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type CalendarEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  source: string;
  remote_id?: string | null;
};

type GoogleSyncResult = {
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

export default function CalendarPage() {
  const { apiBase, token } = useSessionConfig();
  const initialDay = useMemo(() => isoDate(new Date()), []);
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [conflicts, setConflicts] = useState<CalendarConflict[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("Focus block");
  const [startsAt, setStartsAt] = useState(`${initialDay}T08:00`);
  const [endsAt, setEndsAt] = useState(`${initialDay}T09:00`);
  const [status, setStatus] = useState("Ready");
  const [lastSync, setLastSync] = useState<GoogleSyncResult | null>(null);

  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDay);
    return Array.from({ length: 7 }).map((_, index) => {
      const next = new Date(start);
      next.setDate(start.getDate() + index);
      return isoDate(next);
    });
  }, [selectedDay]);

  const eventsByDay = useMemo(() => {
    const buckets = new Map<string, CalendarEvent[]>();
    for (const day of weekDays) {
      buckets.set(day, []);
    }
    for (const event of events) {
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
  }, [events, weekDays]);

  async function refresh() {
    try {
      const [eventPayload, conflictPayload] = await Promise.all([
        apiRequest<CalendarEvent[]>(apiBase, token, "/v1/calendar/events"),
        apiRequest<CalendarConflict[]>(apiBase, token, "/v1/calendar/sync/google/conflicts"),
      ]);
      setEvents(eventPayload);
      setConflicts(conflictPayload);
      setStatus(`Loaded ${eventPayload.length} events`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Calendar load failed");
    }
  }

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
        await apiRequest<CalendarEvent>(apiBase, token, `/v1/calendar/events/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setStatus("Event updated");
      } else {
        await apiRequest<CalendarEvent>(apiBase, token, "/v1/calendar/events", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setStatus("Event created");
      }
      setEditingId(null);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Event save failed");
    }
  }

  function startEdit(event: CalendarEvent) {
    setEditingId(event.id);
    setTitle(event.title);
    setStartsAt(toDateTimeLocal(event.starts_at));
    setEndsAt(toDateTimeLocal(event.ends_at));
    setSelectedDay(event.starts_at.slice(0, 10));
    setStatus(`Editing ${event.title}`);
  }

  async function removeEvent(eventId: string) {
    try {
      await apiRequest(apiBase, token, `/v1/calendar/events/${eventId}`, {
        method: "DELETE",
      });
      if (editingId === eventId) {
        setEditingId(null);
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
      await refresh();
      setStatus(`Sync pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Google sync failed");
    }
  }

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
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
