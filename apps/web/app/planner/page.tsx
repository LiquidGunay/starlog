"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";

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
import styles from "./page.module.css";

type CountBucket = {
  key: string;
  label: string;
  count: number;
};

type PlannerSurfaceSummary = {
  date: string;
  task_buckets: CountBucket[];
  block_buckets: CountBucket[];
  calendar_event_count: number;
  conflict_count: number;
  focus_minutes: number;
  buffer_minutes: number;
  generated_at: string;
};

type Block = {
  id: string;
  task_id?: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  locked?: boolean;
  created_at?: string;
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

type BriefingPackage = {
  id: string;
  date: string;
  text: string;
  audio_ref?: string | null;
};

type SyncSummary = {
  run_id: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  last_synced_at?: string | null;
};

type TimelineItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  kind: "focus" | "commitment" | "flexible" | "buffer" | "conflict";
  source: string;
  detail: string;
};

type PlanGroup = {
  id: "commitments" | "focus" | "flexible" | "buffer";
  title: string;
  description: string;
  items: TimelineItem[];
};

const PLANNER_BLOCKS_SNAPSHOT = "planner.blocks";
const PLANNER_EVENTS_SNAPSHOT = "planner.events";
const PLANNER_CONFLICTS_SNAPSHOT = "planner.conflicts";
const PLANNER_OAUTH_STATUS_SNAPSHOT = "planner.oauth_status";
const PLANNER_SUMMARY_SNAPSHOT = "planner.summary";
const PLANNER_DATE_SNAPSHOT = "planner.date";
const PLANNER_CACHE_PREFIXES = ["planner.", "calendar."];
const PLANNER_BLOCKS_ENTITY_SCOPE = "planner.blocks";
const PLANNER_EVENTS_ENTITY_SCOPE = "planner.events";
const PLANNER_CONFLICTS_ENTITY_SCOPE = "planner.conflicts";
const PLANNER_OAUTH_ENTITY_SCOPE = "planner.oauth";
const PLANNER_SIDECAR_PANE_SNAPSHOT = "planner.sidecar_pane.collapsed";
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;
const HOUR_HEIGHT = 76;
const EMPTY_SUMMARY: PlannerSurfaceSummary = {
  date: "",
  task_buckets: [],
  block_buckets: [],
  calendar_event_count: 0,
  conflict_count: 0,
  focus_minutes: 0,
  buffer_minutes: 0,
  generated_at: "",
};

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

function formatDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isoDateFromOffset(baseDate: string, offset: number): string {
  const stamp = new Date(`${baseDate}T00:00:00`);
  stamp.setDate(stamp.getDate() + offset);
  return stamp.toISOString().slice(0, 10);
}

function bucketCount(summary: PlannerSurfaceSummary | null, collection: "task_buckets" | "block_buckets", key: string): number {
  return summary?.[collection].find((bucket) => bucket.key === key)?.count ?? 0;
}

function classifyBlock(block: Block): TimelineItem["kind"] {
  const lowerTitle = block.title.toLowerCase();
  if (lowerTitle.includes("buffer")) {
    return "buffer";
  }
  if (block.locked) {
    return "commitment";
  }
  if (block.task_id) {
    return "focus";
  }
  return "flexible";
}

function timelineTop(iso: string): number {
  const minutes = Math.max(0, toMinutes(iso) - DAY_START_HOUR * 60);
  return Math.round((minutes / 60) * HOUR_HEIGHT);
}

function timelineHeight(startsAt: string, endsAt: string): number {
  const minutes = Math.max(30, toMinutes(endsAt) - toMinutes(startsAt));
  return Math.max(46, Math.round((minutes / 60) * HOUR_HEIGHT) - 6);
}

function itemClassName(kind: TimelineItem["kind"]): string {
  return [styles.timelineItem, styles[kind]].join(" ");
}

function detailValue(detail: Record<string, unknown>, key: string): string | null {
  const value = detail[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function assistantDraftHref(draft: string): string {
  return `/assistant?draft=${encodeURIComponent(draft)}`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function PlannerPage() {
  const { apiBase, token, mutateWithQueue } = useSessionConfig();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const initialDate = useMemo(() => readEntitySnapshot<string>(PLANNER_DATE_SNAPSHOT, today), [today]);
  const [date, setDate] = useState(initialDate);
  const [summary, setSummary] = useState<PlannerSurfaceSummary | null>(
    () => readEntitySnapshot<PlannerSurfaceSummary | null>(PLANNER_SUMMARY_SNAPSHOT, null),
  );
  const [blocks, setBlocks] = useState<Block[]>(() => readEntitySnapshot<Block[]>(PLANNER_BLOCKS_SNAPSHOT, []));
  const [events, setEvents] = useState<EventItem[]>(() => readEntitySnapshot<EventItem[]>(PLANNER_EVENTS_SNAPSHOT, []));
  const [conflicts, setConflicts] = useState<Conflict[]>(() => readEntitySnapshot<Conflict[]>(PLANNER_CONFLICTS_SNAPSHOT, []));
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(
    () => readEntitySnapshot<OAuthStatus | null>(PLANNER_OAUTH_STATUS_SNAPSHOT, null),
  );
  const [latestBriefing, setLatestBriefing] = useState<BriefingPackage | null>(null);
  const [latestSyncSummary, setLatestSyncSummary] = useState<SyncSummary | null>(null);
  const [status, setStatus] = useState("Ready");
  const sidecarPane = usePaneCollapsed(PLANNER_SIDECAR_PANE_SNAPSHOT);

  const activeSummary = summary || EMPTY_SUMMARY;
  const unresolvedConflicts = useMemo(() => conflicts.filter((conflict) => !conflict.resolved), [conflicts]);
  const repairableConflictCount = unresolvedConflicts.length;
  const summaryOnlyConflictCount = Math.max(0, activeSummary.conflict_count - repairableConflictCount);
  const conflictCount = Math.max(activeSummary.conflict_count, repairableConflictCount);

  const timeline = useMemo<TimelineItem[]>(() => {
    const blockItems = blocks
      .filter((block) => isSameDay(block.starts_at, date))
      .map<TimelineItem>((block) => {
        const kind = classifyBlock(block);
        const label = kind === "focus" ? "Focus block" : kind === "buffer" ? "Buffer" : kind === "commitment" ? "Fixed block" : "Flexible block";
        return {
          id: `blk-${block.id}`,
          title: block.title,
          startsAt: block.starts_at,
          endsAt: block.ends_at,
          kind,
          source: "planner",
          detail: label,
        };
      });
    const eventItems = events
      .filter((event) => isSameDay(event.starts_at, date))
      .map<TimelineItem>((event) => ({
        id: `evt-${event.id}`,
        title: event.title,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        kind: "commitment",
        source: event.source,
        detail: `${event.source || "calendar"} commitment`,
      }));
    const conflictItems = unresolvedConflicts.slice(0, 2).map<TimelineItem>((conflict, index) => ({
      id: `conflict-${conflict.id}`,
      title: detailValue(conflict.detail, "title") || `Conflict ${conflict.remote_id}`,
      startsAt: `${date}T${String(10 + index).padStart(2, "0")}:00:00+00:00`,
      endsAt: `${date}T${String(10 + index).padStart(2, "0")}:30:00+00:00`,
      kind: "conflict",
      source: "calendar",
      detail: `Needs repair: ${conflict.strategy}`,
    }));

    return [...blockItems, ...eventItems, ...conflictItems].sort(
      (left, right) => toMinutes(left.startsAt) - toMinutes(right.startsAt),
    );
  }, [blocks, events, date, unresolvedConflicts]);

  const planGroups = useMemo<PlanGroup[]>(() => [
    {
      id: "commitments",
      title: "Commitments",
      description: "Fixed meetings and locked blocks that the plan must work around.",
      items: timeline.filter((item) => item.kind === "commitment"),
    },
    {
      id: "focus",
      title: "Focus",
      description: "Protected work blocks connected to tasks.",
      items: timeline.filter((item) => item.kind === "focus"),
    },
    {
      id: "flexible",
      title: "Flexible work",
      description: "Moveable blocks that can absorb changes.",
      items: timeline.filter((item) => item.kind === "flexible"),
    },
    {
      id: "buffer",
      title: "Buffer",
      description: "Recovery space and overflow protection.",
      items: timeline.filter((item) => item.kind === "buffer"),
    },
  ], [timeline]);

  const loadSummary = useCallback(async () => {
    const payload = await apiRequest<PlannerSurfaceSummary>(
      apiBase,
      token,
      `/v1/surfaces/planner/summary?date=${encodeURIComponent(date)}`,
    );
    setSummary(payload);
    writeEntitySnapshot(PLANNER_SUMMARY_SNAPSHOT, payload);
    return payload;
  }, [apiBase, date, token]);

  useEffect(() => {
    setDate((previous) => previous || readEntitySnapshot<string>(PLANNER_DATE_SNAPSHOT, today));
    setSummary((previous) => previous ?? readEntitySnapshot<PlannerSurfaceSummary | null>(PLANNER_SUMMARY_SNAPSHOT, null));
    setBlocks((previous) => previous.length > 0 ? previous : readEntitySnapshot<Block[]>(PLANNER_BLOCKS_SNAPSHOT, []));
    setEvents((previous) => previous.length > 0 ? previous : readEntitySnapshot<EventItem[]>(PLANNER_EVENTS_SNAPSHOT, []));
    setConflicts((previous) => previous.length > 0 ? previous : readEntitySnapshot<Conflict[]>(PLANNER_CONFLICTS_SNAPSHOT, []));
    setOauthStatus((previous) => previous ?? readEntitySnapshot<OAuthStatus | null>(PLANNER_OAUTH_STATUS_SNAPSHOT, null));
  }, [today]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cachedDate, cachedSummary, cachedBlocks, cachedEvents, cachedConflicts, cachedOauth] = await Promise.all([
        readEntitySnapshotAsync<string>(PLANNER_DATE_SNAPSHOT, today),
        readEntitySnapshotAsync<PlannerSurfaceSummary | null>(PLANNER_SUMMARY_SNAPSHOT, null),
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
      if (cachedSummary) {
        setSummary(cachedSummary);
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
      await loadSummary();
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
      const [summaryPayload, blockPayload, eventPayload, conflictPayload, oauthPayload] = await Promise.all([
        loadSummary(),
        apiRequest<Block[]>(apiBase, token, `/v1/planning/blocks/${date}`),
        apiRequest<EventItem[]>(apiBase, token, "/v1/calendar/events"),
        apiRequest<Conflict[]>(apiBase, token, "/v1/calendar/sync/google/conflicts"),
        apiRequest<OAuthStatus>(apiBase, token, "/v1/calendar/sync/google/oauth/status"),
      ]);
      setBlocks(blockPayload);
      setEvents(eventPayload);
      setConflicts(conflictPayload);
      setOauthStatus(oauthPayload);
      writeEntitySnapshot(PLANNER_BLOCKS_SNAPSHOT, blockPayload);
      writeEntitySnapshot(PLANNER_EVENTS_SNAPSHOT, eventPayload);
      writeEntitySnapshot(PLANNER_CONFLICTS_SNAPSHOT, conflictPayload);
      writeEntitySnapshot(PLANNER_OAUTH_STATUS_SNAPSHOT, oauthPayload);
      cachePlannerBlocks(blockPayload);
      cachePlannerEvents(eventPayload);
      cachePlannerConflicts(conflictPayload);
      cachePlannerOauthStatus(oauthPayload);
      clearEntityCachesStale(PLANNER_CACHE_PREFIXES);
      setStatus(`Loaded ${summaryPayload.date}: ${blockPayload.length} blocks and ${eventPayload.length} commitments`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Load failed");
    }
  }, [apiBase, date, loadSummary, token]);

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

  async function generateBriefing() {
    try {
      const briefing = await apiRequest<BriefingPackage>(apiBase, token, "/v1/briefings/generate", {
        method: "POST",
        body: JSON.stringify({ date, provider: "planner_web" }),
      });
      setLatestBriefing(briefing);
      setStatus(`Prepared briefing for ${briefing.date}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Briefing generation failed");
    }
  }

  async function runGoogleSync() {
    try {
      const result = await apiRequest<SyncSummary>(
        apiBase,
        token,
        "/v1/calendar/sync/google/run",
        { method: "POST" },
      );
      setLatestSyncSummary(result);
      setStatus(`Google sync ${result.run_id} completed`);
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
      setStatus(`Resolved conflict ${conflictId}`);
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
          ? `Replayed conflict ${conflictId}; repair still needed`
          : `Replayed conflict ${conflictId}; repair cleared`,
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
    load().catch(() => undefined);
  }, [load, token]);

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

  const dayOptions = useMemo(
    () => [
      { label: "Yesterday", date: isoDateFromOffset(date, -1) },
      { label: "Today", date: today },
      { label: "Tomorrow", date: isoDateFromOffset(date, 1) },
    ],
    [date, today],
  );

  const timelineHours = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, index) => DAY_START_HOUR + index),
    [],
  );

  const openTasks = bucketCount(summary, "task_buckets", "open_tasks");
  const dueTodayTasks = bucketCount(summary, "task_buckets", "due_today_tasks");
  const overdueTasks = bucketCount(summary, "task_buckets", "overdue_tasks");
  const unscheduledTasks = bucketCount(summary, "task_buckets", "unscheduled_tasks");
  const fixedBlocks = bucketCount(summary, "block_buckets", "fixed_blocks");
  const flexibleBlocks = bucketCount(summary, "block_buckets", "flexible_blocks");
  const focusBlocks = bucketCount(summary, "block_buckets", "focus_blocks");
  const bufferBlocks = bucketCount(summary, "block_buckets", "buffer_blocks");
  const totalKnownBlocks = fixedBlocks + flexibleBlocks;
  const focusHours = Math.round((activeSummary.focus_minutes / 60) * 10) / 10;
  const generalPlannerDraft = useMemo(
    () => assistantDraftHref(
      `Review my plan for ${date}: ${countLabel(openTasks, "open task")}, ${dueTodayTasks} due today, ${overdueTasks} overdue, ${unscheduledTasks} unscheduled, ${countLabel(activeSummary.calendar_event_count, "calendar commitment")}, ${countLabel(conflictCount, "conflict")}, ${activeSummary.focus_minutes} focus minutes, and ${activeSummary.buffer_minutes} buffer minutes. Check today's blocks, open tasks, conflicts, and unscheduled tasks, then propose the next bounded move.`,
    ),
    [
      activeSummary.buffer_minutes,
      activeSummary.calendar_event_count,
      activeSummary.focus_minutes,
      conflictCount,
      date,
      dueTodayTasks,
      openTasks,
      overdueTasks,
      unscheduledTasks,
    ],
  );
  const summaryConflictDraft = useMemo(
    () => assistantDraftHref(
      `Inspect the planner conflicts for ${date}. There ${summaryOnlyConflictCount === 1 ? "is" : "are"} ${countLabel(summaryOnlyConflictCount, "planner conflict")} not shown as calendar sync repairs. Propose clear repair options and the safest next step.`,
    ),
    [date, summaryOnlyConflictCount],
  );
  const conflictAssistantDrafts = useMemo(
    () => Object.fromEntries(
      unresolvedConflicts.map((conflict) => {
        const title = detailValue(conflict.detail, "title") || `Remote ${conflict.remote_id}`;
        const suggestedRepair = detailValue(conflict.detail, "suggested_repair") || "No suggested repair provided.";
        return [
          conflict.id,
          assistantDraftHref(
            `Help repair this calendar conflict for ${date}: ${title}. Remote id: ${conflict.remote_id}. Suggested repair: ${suggestedRepair} Compare the plan impact and propose repair options before I choose Keep Starlog, Use Google, or Dismiss.`,
          ),
        ];
      }),
    ),
    [date, unresolvedConflicts],
  );

  return (
    <AprilWorkspaceShell
      activeSurface="planner"
      statusLabel={conflictCount > 0 ? `${conflictCount} plan repair${conflictCount === 1 ? "" : "s"} needed` : "Plan ready"}
      queueLabel={`${openTasks} open tasks`}
      brandMeta="Execution planner"
      ctaLabel="New block"
      searchLabel="Planner search"
      searchAriaLabel="Search Planner"
      searchPlaceholder="Search tasks, blocks, commitments"
      profileTitle="Planning context"
      railSlot={(
        <>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Today</span>
            <div className="april-rail-metric-stack">
              <div className="april-rail-metric-card">
                <strong>{focusBlocks}</strong>
                <span>Focus blocks</span>
              </div>
              <div className="april-rail-metric-card">
                <strong>{bufferBlocks}</strong>
                <span>Buffers</span>
              </div>
            </div>
          </div>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Suggestion</span>
            <p className="console-copy">
              {repairableConflictCount > 0
                ? "Repair calendar sync conflicts before adding more work."
                : summaryOnlyConflictCount > 0
                  ? "Planner reports conflicts that need a refresh or assistant review."
                  : unscheduledTasks > 0
                    ? "Place unscheduled tasks into the flexible parts of the day."
                    : "Protect the focus blocks and keep buffers open."}
            </p>
          </div>
        </>
      )}
    >
      <section className={styles.surface} aria-labelledby="planner-title">
        <div className={styles.heroPanel}>
          <div>
            <span className={styles.kicker}>Starlog Planner</span>
            <h1 id="planner-title">Execution plan for {formatDateLabel(date)}</h1>
            <p>
              Balance fixed commitments, focus work, flexible tasks, and buffer time before the day starts drifting.
            </p>
          </div>
          <div className={styles.dateControls} aria-label="Planner date controls">
            <button className="button" type="button" onClick={() => setDate(isoDateFromOffset(date, -1))}>Previous day</button>
            <label className={styles.dateInputLabel}>
              <span>Date</span>
              <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <button className="button" type="button" onClick={() => setDate(today)}>Today</button>
            <button className="button" type="button" onClick={() => setDate(isoDateFromOffset(date, 1))}>Next day</button>
          </div>
        </div>

        <section className={styles.metricGrid} aria-label="Planner stats">
          <article>
            <strong>{activeSummary.focus_minutes}</strong>
            <span>Focus minutes</span>
          </article>
          <article>
            <strong>{activeSummary.buffer_minutes}</strong>
            <span>Buffer minutes</span>
          </article>
          <article>
            <strong>{activeSummary.calendar_event_count}</strong>
            <span>Meetings</span>
          </article>
          <article>
            <strong>{dueTodayTasks}</strong>
            <span>Due today</span>
          </article>
          <article className={conflictCount > 0 ? styles.warningMetric : undefined}>
            <strong>{conflictCount}</strong>
            <span>Conflicts</span>
          </article>
        </section>

        <div className={styles.workspaceGrid}>
          <div className={styles.mainColumn}>
            <AprilPanel className={styles.timelinePanel} aria-labelledby="day-timeline-heading">
              <div className="april-panel-head">
                <div>
                  <span className="april-panel-kicker">Day timeline</span>
                  <h2 id="day-timeline-heading">Focus, commitments, flexibility, and buffers</h2>
                </div>
                <div className="button-row">
                  <button className="button" type="button" onClick={() => load()}>Refresh plan</button>
                  <button className="button" type="button" onClick={() => generate()}>Generate blocks</button>
                </div>
              </div>
              <div className={styles.timelineCanvas}>
                <div className={styles.hourRail} aria-hidden="true">
                  {timelineHours.map((hour) => (
                    <span key={hour}>{String(hour).padStart(2, "0")}:00</span>
                  ))}
                </div>
                <div className={styles.timelineTrack} style={{ minHeight: (DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT }}>
                  {timelineHours.map((hour) => (
                    <span key={hour} className={styles.timelineLine} style={{ top: (hour - DAY_START_HOUR) * HOUR_HEIGHT }} />
                  ))}
                  {timeline.length === 0 ? (
                    <div className={styles.emptyTimeline}>No blocks or commitments loaded for this day.</div>
                  ) : (
                    timeline.map((item) => (
                      <article
                        key={item.id}
                        className={itemClassName(item.kind)}
                        style={{ top: timelineTop(item.startsAt), minHeight: timelineHeight(item.startsAt, item.endsAt) }}
                      >
                        <span>{formatTime(item.startsAt)} - {formatTime(item.endsAt)}</span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </article>
                    ))
                  )}
                </div>
              </div>
              <div className={styles.legend} aria-label="Timeline legend">
                <span><i className={styles.focusDot} />Focus</span>
                <span><i className={styles.commitmentDot} />Commitment</span>
                <span><i className={styles.flexibleDot} />Flexible</span>
                <span><i className={styles.bufferDot} />Buffer</span>
                <span><i className={styles.conflictDot} />Conflict</span>
              </div>
            </AprilPanel>

            <AprilPanel className={styles.groupPanel} aria-labelledby="today-plan-heading">
              <div className="april-panel-head">
                <div>
                  <span className="april-panel-kicker">Today plan</span>
                  <h2 id="today-plan-heading">Work grouped by execution role</h2>
                </div>
                <span className={styles.generatedAt}>{summary?.generated_at ? `Updated ${formatTime(summary.generated_at)}` : "Waiting for summary"}</span>
              </div>
              <div className={styles.groupGrid}>
                {planGroups.map((group) => (
                  <section key={group.id} className={styles.planGroup} aria-label={group.title}>
                    <div>
                      <h3>{group.title}</h3>
                      <p>{group.description}</p>
                    </div>
                    {group.items.length === 0 ? (
                      <span className={styles.emptyGroup}>None scheduled</span>
                    ) : (
                      group.items.map((item) => (
                        <article key={item.id} className={styles.groupItem}>
                          <strong>{item.title}</strong>
                          <small>{formatTime(item.startsAt)} - {formatTime(item.endsAt)}</small>
                        </article>
                      ))
                    )}
                  </section>
                ))}
              </div>
            </AprilPanel>

            <AprilPanel className={styles.composerPanel} aria-labelledby="planner-composer-heading">
              <div>
                <span className="april-panel-kicker">Planning assistant</span>
                <h2 id="planner-composer-heading">Ask in Assistant with this plan in mind</h2>
                <p className="console-copy">Ask Assistant to review the day, weigh tradeoffs, and suggest one bounded next move before you change the plan.</p>
              </div>
              <div className={styles.composerRow}>
                <Link className="button primary" href={generalPlannerDraft}>Review plan in Assistant</Link>
                <button className="button" type="button" onClick={() => load()}>Refresh plan context</button>
              </div>
            </AprilPanel>
          </div>

          <aside className={styles.sideColumn}>
            <PaneRestoreStrip
              actions={sidecarPane.collapsed ? [{ id: "planner-sidecar", label: "Show planner context", onClick: sidecarPane.expand }] : []}
            />
            {!sidecarPane.collapsed ? (
              <AprilPanel className={styles.sidePanel} aria-labelledby="planner-context-heading">
                <div className="april-panel-head">
                  <div>
                    <span className="april-panel-kicker">Context</span>
                    <h2 id="planner-context-heading">Plan pressure</h2>
                  </div>
                  <PaneToggleButton label="Hide pane" onClick={sidecarPane.collapse} />
                </div>

                <section className={styles.pressureCard}>
                  <span className="chronos-pool-tag">Workload</span>
                  <strong>{openTasks} open tasks</strong>
                  <small>{dueTodayTasks} due today, {overdueTasks} overdue, {unscheduledTasks} unscheduled</small>
                </section>

                <section className={styles.pressureCard}>
                  <span className="chronos-pool-tag">Capacity</span>
                  <strong>{focusHours} focus hours</strong>
                  <small>{totalKnownBlocks} fixed or flexible blocks, {activeSummary.calendar_event_count} calendar commitments</small>
                </section>

                <section className={conflictCount > 0 ? styles.conflictCard : styles.pressureCard} aria-label="Conflict repair">
                  <span className={conflictCount > 0 ? "chronos-pool-tag conflict" : "chronos-pool-tag"}>Conflict repair</span>
                  {repairableConflictCount > 0 ? (
                    <div className={styles.conflictList}>
                      {unresolvedConflicts.map((conflict) => {
                        const conflictRange = detailValue(conflict.detail, "time_range") || detailValue(conflict.detail, "window") || "Affected time needs review";
                        const conflictSeverity = detailValue(conflict.detail, "severity") || (conflictCount > 1 ? "High" : "Medium");
                        const conflictRepair = detailValue(conflict.detail, "suggested_repair") || "Choose the source of truth or replay sync after adjusting the block.";

                        return (
                          <article key={conflict.id} className={styles.conflictItem} aria-label={`Conflict ${conflict.remote_id}`}>
                            <strong>{detailValue(conflict.detail, "title") || `Remote ${conflict.remote_id}`}</strong>
                            <small>{conflictRange}</small>
                            <small>Severity: {conflictSeverity}</small>
                            <small>{detailValue(conflict.detail, "reason") || `Strategy: ${conflict.strategy}`}</small>
                            <p>{conflictRepair}</p>
                            <div className={styles.repairActions}>
                              <Link className="button" href={conflictAssistantDrafts[conflict.id] || summaryConflictDraft}>Ask Assistant</Link>
                              <button className="button" type="button" onClick={() => replayConflict(conflict.id)}>Replay sync</button>
                              <button className="button" type="button" onClick={() => resolveConflict(conflict.id, "local_wins")}>Keep Starlog</button>
                              <button className="button" type="button" onClick={() => resolveConflict(conflict.id, "remote_wins")}>Use Google</button>
                              <button className="button" type="button" onClick={() => resolveConflict(conflict.id, "dismiss")}>Dismiss</button>
                            </div>
                          </article>
                        );
                      })}
                      {summaryOnlyConflictCount > 0 ? (
                        <article className={styles.summaryConflictNotice}>
                          <strong>{summaryOnlyConflictCount} planner conflict{summaryOnlyConflictCount === 1 ? " needs" : "s need"} review outside calendar sync</strong>
                          <small>Refresh the plan or ask Assistant to compare task and block repair options.</small>
                          <Link className="button" href={summaryConflictDraft}>Review conflicts in Assistant</Link>
                        </article>
                      ) : null}
                    </div>
                  ) : summaryOnlyConflictCount > 0 ? (
                    <>
                      <strong>{summaryOnlyConflictCount} planner conflict{summaryOnlyConflictCount === 1 ? " needs" : "s need"} review</strong>
                      <small>These conflicts are not Google sync conflicts, so calendar repair actions are not available here.</small>
                      <div className={styles.repairActions}>
                        <button className="button" type="button" onClick={() => load()}>Refresh plan</button>
                        <Link className="button" href={summaryConflictDraft}>Review conflicts in Assistant</Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <strong>No active conflicts</strong>
                      <small>Calendar and planner state are aligned.</small>
                    </>
                  )}
                </section>

                <section className={styles.suggestionList} aria-label="Planner suggestions">
                  <h3>Suggestions</h3>
                  <article>
                    <strong>{repairableConflictCount > 0 ? "Repair calendar conflicts" : summaryOnlyConflictCount > 0 ? "Review planner conflicts" : "Protect focus"}</strong>
                    <small>{repairableConflictCount > 0 ? "Resolve every listed calendar conflict before generating more blocks." : summaryOnlyConflictCount > 0 ? "Some task or block conflicts need Assistant review or a plan refresh." : "Keep task-backed focus blocks stable unless a commitment moves."}</small>
                  </article>
                  <article>
                    <strong>{activeSummary.buffer_minutes < 30 ? "Add buffer" : "Use buffer carefully"}</strong>
                    <small>{activeSummary.buffer_minutes < 30 ? "The day has less than 30 minutes of recovery space." : `${activeSummary.buffer_minutes} minutes are available for overflow.`}</small>
                  </article>
                  <article>
                    <strong>{unscheduledTasks > 0 ? "Place loose tasks" : "No loose tasks"}</strong>
                    <small>{unscheduledTasks > 0 ? `${unscheduledTasks} tasks still need a block or a deliberate defer.` : "Task placement is clear for this date."}</small>
                  </article>
                </section>

                <section className={styles.syncActions}>
                  <h3>Calendar sync</h3>
                  <p className="console-copy">{oauthStatus?.detail || "Internal planner mode is available without Google Calendar."}</p>
                  {latestSyncSummary ? (
                    <p className="status">Latest sync {latestSyncSummary.run_id}: pushed {latestSyncSummary.pushed}, pulled {latestSyncSummary.pulled}, conflicts {latestSyncSummary.conflicts}</p>
                  ) : null}
                  {latestBriefing ? (
                    <p className="status">Briefing prepared for {latestBriefing.date}</p>
                  ) : null}
                  <div className="button-row">
                    <button className="button" type="button" onClick={() => runGoogleSync()}>Run Google sync</button>
                    <button className="button" type="button" onClick={() => addSampleEvent()}>Add event</button>
                    <button className="button" type="button" onClick={() => generateBriefing()}>Prepare briefing</button>
                  </div>
                </section>
              </AprilPanel>
            ) : null}
          </aside>
        </div>

        <p className="status" aria-live="polite">{status}</p>

        <div className={styles.quickDates} aria-label="Quick date choices">
          {dayOptions.map((option) => (
            <button
              key={`${option.label}-${option.date}`}
              className={option.date === date ? styles.activeQuickDate : undefined}
              type="button"
              onClick={() => setDate(option.date)}
            >
              <strong>{option.label}</strong>
              <span>{formatDateLabel(option.date)}</span>
            </button>
          ))}
        </div>
      </section>
    </AprilWorkspaceShell>
  );
}
