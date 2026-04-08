"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AprilPanel, AprilWorkspaceShell } from "../components/april-observatory-shell";
import { PaneRestoreStrip, PaneToggleButton } from "../components/pane-controls";
import { replaceEntityCacheScope } from "../lib/entity-cache";
import {
  ENTITY_CACHE_INVALIDATION_EVENT,
  cachePrefixesIntersect,
  clearEntityCachesStale,
  hasStaleEntityCache,
  readEntitySnapshot,
  readEntitySnapshotAsync,
  writeEntitySnapshot,
} from "../lib/entity-snapshot";
import { usePaneCollapsed } from "../lib/pane-state";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type Block = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
};

type EventItem = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  source: string;
};

type Conflict = {
  id: string;
  remote_id: string;
  strategy: string;
  detail: Record<string, unknown>;
  resolved: boolean;
  resolved_at?: string | null;
  resolution_strategy?: string | null;
};

type OAuthStatus = {
  connected: boolean;
  mode?: string | null;
  source?: string | null;
  expires_at?: string | null;
  has_refresh_token: boolean;
  detail: string;
};

type ConflictReplayResult = {
  sync_run: {
    run_id: string;
    pushed: number;
    pulled: number;
    conflicts: number;
    last_synced_at: string;
  };
  conflict?: Conflict | null;
};

type TimelineItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  kind: "block" | "event";
  source: string;
};

const PLANNER_BLOCKS_SNAPSHOT = "planner.blocks";
const PLANNER_EVENTS_SNAPSHOT = "planner.events";
const PLANNER_CONFLICTS_SNAPSHOT = "planner.conflicts";
const PLANNER_OAUTH_STATUS_SNAPSHOT = "planner.oauth_status";
const PLANNER_DATE_SNAPSHOT = "planner.date";
const PLANNER_CACHE_PREFIXES = ["planner.", "calendar."];
const PLANNER_BLOCKS_ENTITY_SCOPE = "planner.blocks";
const PLANNER_EVENTS_ENTITY_SCOPE = "planner.events";
const PLANNER_CONFLICTS_ENTITY_SCOPE = "planner.conflicts";
const PLANNER_OAUTH_ENTITY_SCOPE = "planner.oauth";
const PLANNER_SIDECAR_PANE_SNAPSHOT = "planner.sidecar_pane.collapsed";

function cachePlannerBlocks(blocks: Block[]): void {
  void replaceEntityCacheScope(
    PLANNER_BLOCKS_ENTITY_SCOPE,
    blocks.map((block) => ({
      id: block.id,
      value: block,
      updated_at: block.ends_at,
      search_text: `${block.title} ${block.starts_at} ${block.ends_at}`,
    })),
  );
}

function cachePlannerEvents(events: EventItem[]): void {
  void replaceEntityCacheScope(
    PLANNER_EVENTS_ENTITY_SCOPE,
    events.map((event) => ({
      id: event.id,
      value: event,
      updated_at: event.ends_at,
      search_text: `${event.title} ${event.source} ${event.starts_at} ${event.ends_at}`,
    })),
  );
}

function cachePlannerConflicts(conflicts: Conflict[]): void {
  const recordedAt = new Date().toISOString();
  void replaceEntityCacheScope(
    PLANNER_CONFLICTS_ENTITY_SCOPE,
    conflicts.map((conflict) => ({
      id: conflict.id,
      value: conflict,
      updated_at: conflict.resolved_at || recordedAt,
      search_text: `${conflict.remote_id} ${conflict.strategy} ${conflict.resolution_strategy || ""}`,
    })),
  );
}

function cachePlannerOauthStatus(oauthStatus: OAuthStatus | null): void {
  if (!oauthStatus) {
    void replaceEntityCacheScope(PLANNER_OAUTH_ENTITY_SCOPE, []);
    return;
  }

  void replaceEntityCacheScope(PLANNER_OAUTH_ENTITY_SCOPE, [
    {
      id: "google_oauth",
      value: oauthStatus,
      updated_at: oauthStatus.expires_at || new Date().toISOString(),
      search_text: `${oauthStatus.connected ? "connected" : "disconnected"} ${oauthStatus.mode || ""} ${oauthStatus.source || ""} ${oauthStatus.detail}`,
    },
  ]);
}

function isSameDay(iso: string, date: string): boolean {
  return iso.slice(0, 10) === date;
}

function toMinutes(iso: string): number {
  const stamp = new Date(iso);
  return stamp.getHours() * 60 + stamp.getMinutes();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isoDateFromOffset(baseDate: string, offset: number): string {
  const stamp = new Date(`${baseDate}T00:00:00`);
  stamp.setDate(stamp.getDate() + offset);
  return stamp.toISOString().slice(0, 10);
}

export default function PlannerPage() {
  const { apiBase, token, mutateWithQueue } = useSessionConfig();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const initialDate = useMemo(() => readEntitySnapshot<string>(PLANNER_DATE_SNAPSHOT, today), [today]);
  const [date, setDate] = useState(initialDate);
  const [blocks, setBlocks] = useState<Block[]>(() => readEntitySnapshot<Block[]>(PLANNER_BLOCKS_SNAPSHOT, []));
  const [events, setEvents] = useState<EventItem[]>(() => readEntitySnapshot<EventItem[]>(PLANNER_EVENTS_SNAPSHOT, []));
  const [conflicts, setConflicts] = useState<Conflict[]>(() => readEntitySnapshot<Conflict[]>(PLANNER_CONFLICTS_SNAPSHOT, []));
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(
    () => readEntitySnapshot<OAuthStatus | null>(PLANNER_OAUTH_STATUS_SNAPSHOT, null),
  );
  const [status, setStatus] = useState("Ready");
  const sidecarPane = usePaneCollapsed(PLANNER_SIDECAR_PANE_SNAPSHOT);
  const timeline = useMemo<TimelineItem[]>(() => {
    const blockItems = blocks
      .filter((block) => isSameDay(block.starts_at, date))
      .map<TimelineItem>((block) => ({
        id: `blk-${block.id}`,
        title: block.title,
        startsAt: block.starts_at,
        endsAt: block.ends_at,
        kind: "block",
        source: "planner",
      }));
    const eventItems = events
      .filter((event) => isSameDay(event.starts_at, date))
      .map<TimelineItem>((event) => ({
        id: `evt-${event.id}`,
        title: event.title,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        kind: "event",
        source: event.source,
      }));

    return [...blockItems, ...eventItems].sort(
      (left, right) => toMinutes(left.startsAt) - toMinutes(right.startsAt),
    );
  }, [blocks, events, date]);

  useEffect(() => {
    setDate((previous) => previous || readEntitySnapshot<string>(PLANNER_DATE_SNAPSHOT, today));
    setBlocks((previous) => previous.length > 0 ? previous : readEntitySnapshot<Block[]>(PLANNER_BLOCKS_SNAPSHOT, []));
    setEvents((previous) => previous.length > 0 ? previous : readEntitySnapshot<EventItem[]>(PLANNER_EVENTS_SNAPSHOT, []));
    setConflicts((previous) => previous.length > 0 ? previous : readEntitySnapshot<Conflict[]>(PLANNER_CONFLICTS_SNAPSHOT, []));
    setOauthStatus((previous) => previous ?? readEntitySnapshot<OAuthStatus | null>(PLANNER_OAUTH_STATUS_SNAPSHOT, null));
  }, [today]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cachedDate, cachedBlocks, cachedEvents, cachedConflicts, cachedOauth] = await Promise.all([
        readEntitySnapshotAsync<string>(PLANNER_DATE_SNAPSHOT, today),
        readEntitySnapshotAsync<Block[]>(PLANNER_BLOCKS_SNAPSHOT, []),
        readEntitySnapshotAsync<EventItem[]>(PLANNER_EVENTS_SNAPSHOT, []),
        readEntitySnapshotAsync<Conflict[]>(PLANNER_CONFLICTS_SNAPSHOT, []),
        readEntitySnapshotAsync<OAuthStatus | null>(PLANNER_OAUTH_STATUS_SNAPSHOT, null),
      ]);

      if (cancelled) {
        return;
      }

      if (cachedDate) {
        setDate(cachedDate);
      }
      if (cachedBlocks.length > 0) {
        setBlocks(cachedBlocks);
      }
      if (cachedEvents.length > 0) {
        setEvents(cachedEvents);
      }
      if (cachedConflicts.length > 0) {
        setConflicts(cachedConflicts);
      }
      if (cachedOauth) {
        setOauthStatus(cachedOauth);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [today]);

  async function generate() {
    try {
      const payload = await apiRequest<{ generated: number; blocks: Block[] }>(
        apiBase,
        token,
        "/v1/planning/blocks/generate",
        {
          method: "POST",
          body: JSON.stringify({ date, day_start_hour: 8, day_end_hour: 20 }),
        },
      );
      setBlocks(payload.blocks);
      writeEntitySnapshot(PLANNER_BLOCKS_SNAPSHOT, payload.blocks);
      cachePlannerBlocks(payload.blocks);
      clearEntityCachesStale(PLANNER_CACHE_PREFIXES);
      setStatus(`Generated ${payload.generated} blocks for ${date}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Generation failed");
    }
  }

  async function loadOauthStatus() {
    try {
      const payload = await apiRequest<OAuthStatus>(apiBase, token, "/v1/calendar/sync/google/oauth/status");
      setOauthStatus(payload);
      writeEntitySnapshot(PLANNER_OAUTH_STATUS_SNAPSHOT, payload);
      cachePlannerOauthStatus(payload);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "OAuth status load failed");
    }
  }

  const load = useCallback(async () => {
    try {
      const [blockPayload, eventPayload, oauthPayload] = await Promise.all([
        apiRequest<Block[]>(apiBase, token, `/v1/planning/blocks/${date}`),
        apiRequest<EventItem[]>(apiBase, token, "/v1/calendar/events"),
        apiRequest<OAuthStatus>(apiBase, token, "/v1/calendar/sync/google/oauth/status"),
      ]);
      setBlocks(blockPayload);
      setEvents(eventPayload);
      setOauthStatus(oauthPayload);
      writeEntitySnapshot(PLANNER_BLOCKS_SNAPSHOT, blockPayload);
      writeEntitySnapshot(PLANNER_EVENTS_SNAPSHOT, eventPayload);
      writeEntitySnapshot(PLANNER_OAUTH_STATUS_SNAPSHOT, oauthPayload);
      cachePlannerBlocks(blockPayload);
      cachePlannerEvents(eventPayload);
      cachePlannerOauthStatus(oauthPayload);
      clearEntityCachesStale(PLANNER_CACHE_PREFIXES);
      setStatus(`Loaded ${blockPayload.length} blocks and ${eventPayload.length} events`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Load failed");
    }
  }, [apiBase, date, token]);

  async function addSampleEvent() {
    try {
      const result = await mutateWithQueue(
        "/v1/calendar/events",
        {
          method: "POST",
          body: JSON.stringify({
            title: "Focus Block",
            starts_at: `${date}T08:00:00+00:00`,
            ends_at: `${date}T09:00:00+00:00`,
            source: "internal",
          }),
        },
        {
          label: `Create sample focus block for ${date}`,
          entity: "calendar_event",
          op: "create",
        },
      );
      if (result.queued) {
        setStatus("Sample event queued for replay");
        return;
      }
      setStatus("Created sample calendar event");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Event create failed");
    }
  }

  async function runGoogleSync() {
    try {
      const result = await apiRequest<{ run_id: string; pushed: number; pulled: number; conflicts: number }>(
        apiBase,
        token,
        "/v1/calendar/sync/google/run",
        { method: "POST" },
      );
      setStatus(
        `Google sync ${result.run_id}: pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts}`,
      );
      const conflictPayload = await apiRequest<Conflict[]>(apiBase, token, "/v1/calendar/sync/google/conflicts");
      setConflicts(conflictPayload);
      writeEntitySnapshot(PLANNER_CONFLICTS_SNAPSHOT, conflictPayload);
      cachePlannerConflicts(conflictPayload);
      await Promise.all([load(), loadOauthStatus()]);
      clearEntityCachesStale(PLANNER_CACHE_PREFIXES);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Google sync failed");
    }
  }

  async function resolveConflict(
    conflictId: string,
    resolutionStrategy: "local_wins" | "remote_wins" | "dismiss",
  ) {
    try {
      await apiRequest(apiBase, token, `/v1/calendar/sync/google/conflicts/${conflictId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution_strategy: resolutionStrategy }),
      });
      setStatus(`Resolved conflict ${conflictId} with ${resolutionStrategy}`);
      const conflictPayload = await apiRequest<Conflict[]>(apiBase, token, "/v1/calendar/sync/google/conflicts");
      setConflicts(conflictPayload);
      writeEntitySnapshot(PLANNER_CONFLICTS_SNAPSHOT, conflictPayload);
      cachePlannerConflicts(conflictPayload);
      await load();
      clearEntityCachesStale(PLANNER_CACHE_PREFIXES);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Conflict resolution failed");
    }
  }

  async function replayConflict(conflictId: string) {
    try {
      const payload = await apiRequest<ConflictReplayResult>(
        apiBase,
        token,
        `/v1/calendar/sync/google/conflicts/${conflictId}/replay`,
        { method: "POST" },
      );
      const conflictPayload = await apiRequest<Conflict[]>(apiBase, token, "/v1/calendar/sync/google/conflicts");
      setConflicts(conflictPayload);
      writeEntitySnapshot(PLANNER_CONFLICTS_SNAPSHOT, conflictPayload);
      cachePlannerConflicts(conflictPayload);
      await load();
      clearEntityCachesStale(PLANNER_CACHE_PREFIXES);
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
    writeEntitySnapshot(PLANNER_DATE_SNAPSHOT, date);
  }, [date]);

  useEffect(() => {
    writeEntitySnapshot(PLANNER_CONFLICTS_SNAPSHOT, conflicts);
    cachePlannerConflicts(conflicts);
  }, [conflicts]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const refreshIfStale = () => {
      if (!window.navigator.onLine || !hasStaleEntityCache(PLANNER_CACHE_PREFIXES)) {
        return;
      }
      load().catch(() => undefined);
    };

    refreshIfStale();

    const onInvalidation = (event: Event) => {
      const detail = (event as CustomEvent<{ prefixes: string[] }>).detail;
      if (detail && cachePrefixesIntersect(detail.prefixes, PLANNER_CACHE_PREFIXES)) {
        refreshIfStale();
      }
    };

    window.addEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    return () => {
      window.removeEventListener(ENTITY_CACHE_INVALIDATION_EVENT, onInvalidation as EventListener);
    };
  }, [load, token]);

  const cycleDays = useMemo(
    () => [
      { id: "cycle1", label: "Cycle 1", offsetLabel: "T-0", date: isoDateFromOffset(date, 0) },
      { id: "cycle2", label: "Cycle 2", offsetLabel: "T+1", date: isoDateFromOffset(date, 1) },
      { id: "cycle3", label: "Cycle 3", offsetLabel: "T+2", date: isoDateFromOffset(date, 2) },
    ],
    [date],
  );

  const unscheduledPool = useMemo(() => {
    const unresolvedConflicts = conflicts
      .filter((conflict) => !conflict.resolved)
      .slice(0, 3)
      .map((conflict) => ({
        id: conflict.id,
        title: `Resolve ${conflict.remote_id}`,
        subtitle: `policy ${conflict.strategy}`,
        type: "conflict" as const,
      }));
    if (unresolvedConflicts.length > 0) {
      return unresolvedConflicts;
    }
    return events
      .filter((event) => !cycleDays.some((cycleDay) => isSameDay(event.starts_at, cycleDay.date)))
      .slice(0, 3)
      .map((event) => ({
        id: event.id,
        title: event.title,
        subtitle: `${event.source} • ${formatTime(event.starts_at)}`,
        type: "event" as const,
      }));
  }, [conflicts, cycleDays, events]);

  const calendarMonth = useMemo(() => {
    const selected = new Date(`${date}T00:00:00`);
    const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const firstWeekday = (monthStart.getDay() + 6) % 7;
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - firstWeekday);

    const days = Array.from({ length: 35 }, (_, index) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      const iso = day.toISOString().slice(0, 10);
      const itemCount = [...blocks, ...events].filter((item) => isSameDay(item.starts_at, iso)).length;
      return {
        iso,
        label: day.getDate(),
        inMonth: day.getMonth() === selected.getMonth(),
        current: iso === date,
        itemCount,
      };
    });

    return {
      heading: selected.toLocaleDateString([], { month: "long", year: "numeric" }),
      days,
    };
  }, [blocks, date, events]);

  const agendaItems = useMemo(
    () => timeline.map((item) => ({
      id: item.id,
      time: formatTime(item.startsAt),
      title: item.title,
      detail: item.kind === "event" ? `${item.source} event` : "focus block",
      critical: item.kind === "event",
    })),
    [timeline],
  );
  const ritualCompletion = useMemo(() => {
    const connected = oauthStatus?.connected ? 1 : 0;
    const loadFactor = timeline.length > 0 ? 1 : 0;
    const syncFactor = conflicts.some((conflict) => !conflict.resolved) ? 0 : 1;
    const ratio = (connected + loadFactor + syncFactor) / 3;
    return Math.round(ratio * 100);
  }, [conflicts, oauthStatus?.connected, timeline.length]);
  const ritualChecklist = useMemo(
    () => [
      {
        id: "briefing",
        title: "Morning briefing ready",
        done: timeline.length > 0,
        detail: timeline.length > 0 ? `${timeline.length} scheduled item(s) staged` : "Generate or load blocks first",
      },
      {
        id: "sync",
        title: "Calendar sync stable",
        done: Boolean(oauthStatus?.connected) && !conflicts.some((conflict) => !conflict.resolved),
        detail: oauthStatus?.connected ? "Google calendar link active" : "Internal agenda mode",
      },
      {
        id: "pool",
        title: "Ritual pool triaged",
        done: unscheduledPool.length === 0,
        detail: unscheduledPool.length === 0 ? "No unscheduled drift" : `${unscheduledPool.length} item(s) still waiting`,
      },
    ],
    [conflicts, oauthStatus?.connected, timeline.length, unscheduledPool.length],
  );

  function shiftMonth(offset: number) {
    const stamp = new Date(`${date}T00:00:00`);
    stamp.setMonth(stamp.getMonth() + offset);
    setDate(stamp.toISOString().slice(0, 10));
  }

  return (
    <AprilWorkspaceShell
      activeSurface="agenda"
      statusLabel={oauthStatus?.connected ? "Calendar sync connected" : "Internal agenda only"}
      queueLabel={`${timeline.length} scheduled`}
      searchPlaceholder="Search agenda..."
      railSlot={(
        <>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Agenda rhythm</span>
            <div className="april-rail-metric-stack">
              <div className="april-rail-metric-card">
                <strong>{timeline.length}</strong>
                <span>Scheduled</span>
              </div>
              <div className="april-rail-metric-card">
                <strong>{unscheduledPool.length}</strong>
                <span>Pool items</span>
              </div>
            </div>
          </div>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Briefing readiness</span>
            <p className="console-copy">{oauthStatus?.detail || "Internal blocks can still guide the next ritual cycle."}</p>
          </div>
        </>
      )}
    >
      <section className="april-agenda-layout">
        <div className="april-agenda-grid">
          <div className="april-agenda-main">
            <AprilPanel className="april-briefing-panel">
              <div className="april-briefing-copy">
                <span className="april-panel-kicker">System transmission</span>
                <h2>Morning Briefing</h2>
                <p>{oauthStatus?.detail || "Good morning. Today's forecast is clear for focus and synthesis."}</p>
                <div className="april-briefing-wave">
                  {Array.from({ length: 18 }, (_, index) => (
                    <span key={`brief-wave-${index}`} style={{ height: `${28 + ((index * 11) % 42)}%` }} />
                  ))}
                </div>
                <div className="chronos-summary-grid">
                  <article className="chronos-summary-card">
                    <strong>{timeline.length}</strong>
                    <span>scheduled items</span>
                  </article>
                  <article className="chronos-summary-card">
                    <strong>{conflicts.filter((conflict) => !conflict.resolved).length}</strong>
                    <span>open conflicts</span>
                  </article>
                  <article className="chronos-summary-card">
                    <strong>{oauthStatus?.connected ? "Live" : "Local"}</strong>
                    <span>calendar mode</span>
                  </article>
                </div>
              </div>
              <div className="april-briefing-controls">
                <button className="april-icon-button" type="button">◂</button>
                <button className="april-play-button" type="button">Play</button>
                <button className="april-icon-button" type="button">▸</button>
              </div>
            </AprilPanel>

            <AprilPanel className="april-calendar-panel">
              <div className="april-panel-head">
                <div>
                  <span className="april-panel-kicker">Agenda ritual</span>
                  <h2>Calendar constellation</h2>
                </div>
                <div className="button-row">
                  <button className="button" type="button" onClick={() => load()}>Refresh agenda</button>
                  <button className="button" type="button" onClick={() => runGoogleSync()}>Run Google sync</button>
                </div>
              </div>
              <div className="april-month-head">
                <div>
                  <h3>{calendarMonth.heading}</h3>
                  <p>{oauthStatus?.connected ? "Lunar cycle synced" : "Internal orbit mode"}</p>
                </div>
                <div className="button-row">
                  <button className="button" type="button" onClick={() => shiftMonth(-1)}>Previous</button>
                  <button className="button" type="button" onClick={() => shiftMonth(1)}>Next</button>
                </div>
              </div>
              <div className="april-month-grid">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                  <span key={day} className="april-month-grid-label">{day}</span>
                ))}
                {calendarMonth.days.map((day) => (
                  <button
                    key={day.iso}
                    type="button"
                    className={day.current ? "april-month-cell active" : day.inMonth ? "april-month-cell" : "april-month-cell muted"}
                    onClick={() => setDate(day.iso)}
                  >
                    <strong>{day.label}</strong>
                    {day.itemCount > 0 ? <small>{day.itemCount} item{day.itemCount === 1 ? "" : "s"}</small> : null}
                  </button>
                ))}
              </div>
            </AprilPanel>

            <AprilPanel className="april-timeline-panel">
              <div className="april-panel-head">
                <div>
                  <span className="april-panel-kicker">Today&apos;s agenda</span>
                  <h2>Ritual timeline</h2>
                </div>
              </div>
              <div className="april-agenda-list">
                {agendaItems.length === 0 ? (
                  <p className="console-copy">No timeline items for this day yet.</p>
                ) : (
                  agendaItems.map((item) => (
                    <article key={item.id} className={item.critical ? "april-agenda-item critical" : "april-agenda-item"}>
                      <div className="april-agenda-item-track">
                        <span />
                      </div>
                      <div className="april-agenda-item-card">
                        <div className="april-agenda-item-head">
                          <strong>{item.time}</strong>
                          {item.critical ? <small>Critical</small> : null}
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.detail}</p>
                      </div>
                    </article>
                  ))
                )}
              </div>
              <div className="button-row">
                <button className="button" type="button" onClick={() => generate()}>Generate Blocks</button>
                <button className="button" type="button" onClick={() => addSampleEvent()}>Add Event</button>
              </div>
              <p className="status">{status}</p>
            </AprilPanel>
          </div>

          <div className="april-agenda-side">
            <PaneRestoreStrip
              actions={sidecarPane.collapsed ? [{ id: "planner-sidecar", label: "Show ritual sidecar", onClick: sidecarPane.expand }] : []}
            />
            {!sidecarPane.collapsed ? (
              <AprilPanel className="april-ritual-panel">
                <div className="april-panel-head">
                  <div>
                    <span className="april-panel-kicker">Daily rituals</span>
                    <h2>Ritual readiness and sync drift</h2>
                  </div>
                  <PaneToggleButton label="Hide pane" onClick={sidecarPane.collapse} />
                </div>
                <div className="chronos-pool">
                  <section className="april-ritual-progress-card">
                    <div className="april-ritual-progress-ring" aria-hidden="true">
                      <svg viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="44" />
                        <circle
                          className="active"
                          cx="60"
                          cy="60"
                          r="44"
                          pathLength="100"
                          strokeDasharray="100"
                          strokeDashoffset={100 - ritualCompletion}
                        />
                      </svg>
                      <strong>{ritualCompletion}%</strong>
                    </div>
                    <div className="april-ritual-progress-copy">
                      <span className="chronos-pool-tag">daily return point</span>
                      <h3>{date}</h3>
                      <p>{oauthStatus?.connected ? "Google sync connected and feeding the ritual cycle." : "Internal agenda mode active for this ritual cycle."}</p>
                    </div>
                  </section>

                  <section className="april-ritual-checklist">
                    {ritualChecklist.map((item) => (
                      <article key={item.id} className={item.done ? "april-ritual-checkpoint done" : "april-ritual-checkpoint"}>
                        <span className="april-ritual-check-glyph" aria-hidden="true">{item.done ? "●" : "○"}</span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </div>
                      </article>
                    ))}
                  </section>

                  <article className="chronos-pool-card">
                    <strong>{timeline.length} scheduled item(s)</strong>
                    <small>Across {cycleDays.length} ritual cycles</small>
                  </article>

                  <h2>Unscheduled pool</h2>
                  {unscheduledPool.length === 0 ? (
                    <p className="console-copy">No unscheduled tasks or conflicts.</p>
                  ) : (
                    unscheduledPool.map((item) => (
                      <article key={item.id} className="chronos-pool-card">
                        <span className={item.type === "conflict" ? "chronos-pool-tag conflict" : "chronos-pool-tag"}>
                          {item.type === "conflict" ? "sync conflict" : "event spillover"}
                        </span>
                        <strong>{item.title}</strong>
                        <small>{item.subtitle}</small>
                      </article>
                    ))
                  )}

                  <article className="chronos-pool-card">
                    <strong>{timeline.length} scheduled item(s) on {date}</strong>
                    <small>Blocks: {blocks.length} • Calendar events: {events.length}</small>
                  </article>

                  <details>
                    <summary className="label">Sync conflicts</summary>
                    {conflicts.length === 0 ? (
                      <p className="console-copy">No conflicts.</p>
                    ) : (
                      conflicts.map((conflict) => (
                        <article key={conflict.id} className="chronos-pool-card">
                          <strong>Remote {conflict.remote_id}</strong>
                          <small>policy {conflict.strategy}</small>
                          <div className="button-row">
                            <button className="button" type="button" onClick={() => replayConflict(conflict.id)}>
                              Replay Sync
                            </button>
                            <button
                              className="button"
                              type="button"
                              onClick={() => resolveConflict(conflict.id, "local_wins")}
                            >
                              Local Wins
                            </button>
                            <button
                              className="button"
                              type="button"
                              onClick={() => resolveConflict(conflict.id, "remote_wins")}
                            >
                              Remote Wins
                            </button>
                            <button className="button" type="button" onClick={() => resolveConflict(conflict.id, "dismiss")}>
                              Dismiss
                            </button>
                          </div>
                        </article>
                      ))
                    )}
                  </details>

                  <details>
                    <summary className="label">Google OAuth</summary>
                    {!oauthStatus ? (
                      <p className="console-copy">OAuth status not loaded.</p>
                    ) : (
                      <>
                        <p className="console-copy">Connected: {oauthStatus.connected ? "yes" : "no"}</p>
                        <p className="console-copy">Mode: {oauthStatus.mode || "n/a"}</p>
                        <p className="console-copy">Source: {oauthStatus.source || "n/a"}</p>
                        <p className="console-copy">Refresh token: {oauthStatus.has_refresh_token ? "yes" : "no"}</p>
                        <p className="console-copy">{oauthStatus.detail}</p>
                      </>
                    )}
                  </details>
                </div>
              </AprilPanel>
            ) : null}
          </div>
        </div>
      </section>
    </AprilWorkspaceShell>
  );
}
