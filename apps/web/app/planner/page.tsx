"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
const PLANNER_OAUTH_SNAPSHOT = "planner.oauth";
const PLANNER_DATE_SNAPSHOT = "planner.date";
const PLANNER_CACHE_PREFIXES = ["planner.", "calendar."];
const PLANNER_BLOCKS_ENTITY_SCOPE = "planner.blocks";
const PLANNER_EVENTS_ENTITY_SCOPE = "planner.events";
const PLANNER_CONFLICTS_ENTITY_SCOPE = "planner.conflicts";
const PLANNER_OAUTH_ENTITY_SCOPE = "planner.oauth";

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

const PLANNER_DATE_SNAPSHOT = "planner.date";
const PLANNER_BLOCKS_SNAPSHOT = "planner.blocks";
const PLANNER_EVENTS_SNAPSHOT = "planner.events";
const PLANNER_CONFLICTS_SNAPSHOT = "planner.conflicts";
const PLANNER_OAUTH_STATUS_SNAPSHOT = "planner.oauth_status";
const PLANNER_CACHE_PREFIXES = ["planner."];

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

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Planner</p>
          <h1>Time blocks and calendar sync</h1>
          <label className="label" htmlFor="planner-date">
            Date
          </label>
          <input
            id="planner-date"
            className="input"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => generate()}>
              Generate Blocks
            </button>
            <button className="button" type="button" onClick={() => load()}>
              Refresh
            </button>
            <button className="button" type="button" onClick={() => addSampleEvent()}>
              Add Event
            </button>
            <button className="button" type="button" onClick={() => runGoogleSync()}>
              Run Google Sync
            </button>
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Day board</h2>
          <p className="console-copy">
            {timeline.length} scheduled item(s) on {date}
          </p>
          {timeline.length === 0 ? (
            <p className="console-copy">No timeline items for this day yet.</p>
          ) : (
            <ul className="timeline-list">
              {timeline.map((item) => (
                <li key={item.id} className="timeline-item">
                  <div>
                    <span
                      className={`timeline-kind ${
                        item.kind === "block" ? "timeline-kind-block" : "timeline-kind-event"
                      }`}
                    >
                      {item.kind}
                    </span>
                    <strong>{item.title}</strong>
                    <p className="console-copy">{item.source}</p>
                  </div>
                  <div className="timeline-time">
                    {formatTime(item.startsAt)} - {formatTime(item.endsAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2>Blocks</h2>
          {blocks.length === 0 ? (
            <p className="console-copy">No blocks yet.</p>
          ) : (
            <ul>
              {blocks.map((block) => (
                <li key={block.id}>
                  <strong>{block.title}</strong> - {block.starts_at} to {block.ends_at}
                </li>
              ))}
            </ul>
          )}

          <h2>Calendar events</h2>
          {events.length === 0 ? (
            <p className="console-copy">No events yet.</p>
          ) : (
            <ul>
              {events.map((event) => (
                <li key={event.id}>
                  <strong>{event.title}</strong> ({event.source})
                </li>
              ))}
            </ul>
          )}

          <h2>Sync conflicts</h2>
          {conflicts.length === 0 ? (
            <p className="console-copy">No conflicts.</p>
          ) : (
            <ul>
              {conflicts.map((conflict) => (
                <li key={conflict.id}>
                  <p className="console-copy">
                    Remote {conflict.remote_id} - policy {conflict.strategy}
                  </p>
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
                </li>
              ))}
            </ul>
          )}

          <h2>Google OAuth</h2>
          {!oauthStatus ? (
            <p className="console-copy">OAuth status not loaded.</p>
          ) : (
            <div>
              <p className="console-copy">Connected: {oauthStatus.connected ? "yes" : "no"}</p>
              <p className="console-copy">Mode: {oauthStatus.mode || "n/a"}</p>
              <p className="console-copy">Source: {oauthStatus.source || "n/a"}</p>
              <p className="console-copy">Refresh token: {oauthStatus.has_refresh_token ? "yes" : "no"}</p>
              <p className="console-copy">{oauthStatus.detail}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
