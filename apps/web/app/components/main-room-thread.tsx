"use client";

import type {
  AssistantAttachment,
  AssistantAmbientUpdate,
  AssistantCard,
  AssistantCardAction,
  AssistantEntityRef,
  AssistantInterrupt,
  AssistantMessagePart,
  AssistantStatusPart,
  AssistantToolCall,
  AssistantToolResult,
  AssistantThreadMessage,
  AssistantThreadSnapshot,
} from "@starlog/contracts";

import { supportSurfaceActionLabel } from "../assistant/support-surfaces";
import { getConversationCardRegistryEntry } from "./conversation-card-registry";
import { DynamicPanelRenderer } from "./dynamic-panel-renderer";
import styles from "./main-room-thread.module.css";

type MainRoomThreadProps = {
  snapshot: AssistantThreadSnapshot | null;
  loading: boolean;
  busy: boolean;
  todaySummary?: AssistantTodaySummary | null;
  weeklySummary?: AssistantWeeklySummary | null;
  todayOpenLoops?: TodayItem[];
  todayContextItems?: TodayItem[];
  onQuickStart: (prompt: string) => void;
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
  onInterruptSubmit: (interruptId: string, values: Record<string, unknown>) => Promise<void> | void;
  onInterruptDismiss: (interruptId: string) => Promise<void> | void;
};

type TodayItem = {
  label: string;
  href?: string;
};

type TodayAction = {
  label: string;
  prompt?: string;
  href?: string;
  enabled?: boolean;
  count?: number;
  reason?: string | null;
};

type WeeklySummaryItem = {
  key?: string;
  title?: string;
  label?: string;
  body?: string | null;
  summary?: string | null;
  detail?: string | null;
  count?: number | null;
};

type WeeklyAdaptationOption = {
  key?: string;
  title?: string;
  label?: string;
  body?: string | null;
  surface?: string | null;
  action_label?: string | null;
  href?: string | null;
  prompt?: string | null;
  enabled?: boolean;
  status?: string | null;
  reason?: string | null;
  priority?: number | null;
};

type WeeklyAttentionItem = {
  key?: string;
  kind?: string;
  title?: string;
  body?: string | null;
  surface?: string | null;
  href?: string | null;
  priority?: number | null;
  count?: number | null;
};

type WeeklySignalCounts = Record<string, number | null | undefined>;

type WeeklySystemHealth = {
  progress_signal_count?: number | null;
  slippage_signal_count?: number | null;
};

export type AssistantWeeklySummary = {
  week_start?: string | null;
  week_end?: string | null;
  generated_at?: string | null;
  progress?: Array<string | WeeklySummaryItem> | WeeklySignalCounts;
  slippage?: Array<string | WeeklySummaryItem> | WeeklySignalCounts;
  adaptation_options?: WeeklyAdaptationOption[];
  attention_items?: WeeklyAttentionItem[];
  system_health?: WeeklySystemHealth | null;
};

type TodayOpenLoopSummary = {
  key: string;
  label: string;
  count: number;
  href?: string | null;
};

type StrategicContextItem = {
  id?: string;
  key?: string;
  kind?: string;
  title?: string;
  label?: string;
  body?: string | null;
  summary?: string | null;
  detail?: string | null;
  href?: string | null;
  prompt?: string | null;
  action_label?: string | null;
  status?: string | null;
  horizon?: string | null;
  review_cadence?: string | null;
  goal_id?: string | null;
  next_action_id?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  promised_to?: string | null;
  due_at?: string | null;
  reason?: string | null;
  severity?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  surface?: string | null;
  priority?: number | null;
  updated_at?: string | null;
  last_reviewed_at?: string | null;
};

type AssistantStrategicContext = {
  active_goal_count?: number;
  active_project_count?: number;
  open_commitment_count?: number;
  overdue_commitment_count?: number;
  project_missing_next_action_count?: number;
  attention_count?: number;
  active_goal?: StrategicContextItem | null;
  active_goals?: StrategicContextItem[];
  active_project?: StrategicContextItem | null;
  active_projects?: StrategicContextItem[];
  open_commitment?: StrategicContextItem | null;
  open_commitments?: StrategicContextItem[];
  attention_items?: StrategicContextItem[];
};

export type AssistantTodaySummary = {
  date: string;
  thread_id?: string | null;
  active_run_count?: number;
  open_interrupt_count?: number;
  recent_surface_event_count?: number;
  open_loops?: TodayOpenLoopSummary[];
  recommended_next_move?: {
    key?: string;
    title?: string;
    body?: string;
    surface?: string;
    href?: string | null;
    action_label?: string | null;
    prompt?: string | null;
    priority?: number;
    urgency?: string;
  } | null;
  reason_stack?: string[];
  at_a_glance?: TodayOpenLoopSummary[];
  quick_actions?: Array<{
    key?: string;
    title: string;
    surface?: string;
    href?: string | null;
    action_label?: string | null;
    prompt?: string | null;
    enabled?: boolean;
    count?: number;
    reason?: string | null;
    priority?: number;
  }>;
  strategic_context?: AssistantStrategicContext | null;
  generated_at?: string;
};

type RecommendedMove = {
  title: string;
  reasons: string[];
  primaryAction: TodayAction;
  secondaryActions: TodayAction[];
};

type StrategicContextRow = {
  key: string;
  eyebrow: string;
  title: string;
  detail?: string;
  href?: string;
  prompt?: string;
  actionLabel?: string;
};

type WeeklyDisplayItem = {
  key: string;
  title: string;
  detail?: string;
};

type WeeklyDisplayAction = {
  key: string;
  label: string;
  href?: string;
  prompt?: string;
  disabled: boolean;
  reason?: string;
};

type ActivityPart =
  | Extract<AssistantMessagePart, { type: "tool_call" }>
  | Extract<AssistantMessagePart, { type: "tool_result" }>
  | Extract<AssistantMessagePart, { type: "status" }>;

type MessagePartGroup =
  | { kind: "activity"; id: string; parts: ActivityPart[] }
  | { kind: "part"; part: AssistantMessagePart };

const REVIEW_MODE_ORDER = ["recall", "understanding", "application", "synthesis", "judgment"] as const;

const REVIEW_MODE_LABELS: Record<(typeof REVIEW_MODE_ORDER)[number], string> = {
  recall: "Recall",
  understanding: "Understanding",
  application: "Application",
  synthesis: "Synthesis",
  judgment: "Judgment",
};

function reviewModeBadges(modeCounts: unknown): string[] {
  if (!modeCounts || typeof modeCounts !== "object") {
    return [];
  }
  return REVIEW_MODE_ORDER
    .map((mode) => {
      const count = Number((modeCounts as Record<string, unknown>)[mode]);
      return Number.isFinite(count) && count > 0 ? `${REVIEW_MODE_LABELS[mode]} ${count}` : null;
    })
    .filter((badge): badge is string => Boolean(badge))
    .slice(0, 3);
}

function pendingInterruptTodayLabel(interrupt: AssistantInterrupt): string {
  if (interrupt.tool_name === "request_due_date") {
    return "Task details needed";
  }
  if (interrupt.tool_name === "triage_capture") {
    return "Capture triage ready";
  }
  if (interrupt.tool_name === "choose_morning_focus") {
    return "Morning focus waiting";
  }
  if (interrupt.tool_name === "resolve_planner_conflict") {
    return "Planner conflict to resolve";
  }
  if (interrupt.tool_name === "grade_review_recall") {
    return "Review grade pending";
  }
  return interrupt.title;
}

function cardTodayLabel(card: AssistantCard): string | null {
  if (card.kind === "task_list") {
    return card.title ? `Planner: ${card.title}` : "Planner update ready";
  }
  if (card.kind === "review_queue") {
    return card.title ? `Review: ${card.title}` : "Review queue ready";
  }
  if (card.kind === "capture_item") {
    return card.title ? `Capture: ${card.title}` : "Capture ready to process";
  }
  if (card.kind === "briefing") {
    return card.title ? `Briefing: ${card.title}` : "Briefing ready";
  }
  if (card.kind === "knowledge_note") {
    return card.title ? `Library: ${card.title}` : "Relevant note ready";
  }
  return null;
}

function countForLoop(todaySummary: AssistantTodaySummary | null | undefined, key: string): number {
  const rawCount = todaySummary?.open_loops?.find((loop) => loop.key === key)?.count;
  return Number.isFinite(rawCount) ? Number(rawCount) : 0;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildFallbackRecommendedMove(
  todaySummary: AssistantTodaySummary | null | undefined,
  openLoops: TodayItem[],
  contextItems: TodayItem[],
  snapshot: AssistantThreadSnapshot,
): RecommendedMove {
  const openInterrupts = Number(todaySummary?.open_interrupt_count || 0);
  const activeRuns = Number(todaySummary?.active_run_count || 0);
  const overdueTasks = countForLoop(todaySummary, "overdue_tasks");
  const dueReviews = countForLoop(todaySummary, "due_reviews");
  const libraryInbox = countForLoop(todaySummary, "unprocessed_library");
  const openTasks = countForLoop(todaySummary, "open_tasks");
  const openCommitments = countForLoop(todaySummary, "open_commitments");

  if (openInterrupts > 0 || (!todaySummary && openLoops.length > 0)) {
    return {
      title: "Resolve the waiting decision",
      reasons: [
        openInterrupts > 0
          ? `${formatCount(openInterrupts, "Assistant decision")} waiting`
          : `${formatCount(openLoops.length, "open loop")} in the thread`,
        activeRuns > 0 ? `${formatCount(activeRuns, "active run")} may continue after this` : "Clearing it keeps the cockpit current",
        openTasks > 0 ? `${formatCount(openTasks, "open task")} still needs planning` : "No separate dashboard step needed",
      ],
      primaryAction: {
        label: "Review decision",
        prompt: "Help me resolve the pending Assistant decision and explain the next step.",
      },
      secondaryActions: [
        { label: "Open Planner", href: "/planner" },
        { label: "Show options", prompt: "Show me the other reasonable next moves for today." },
      ],
    };
  }

  if (overdueTasks > 0) {
    return {
      title: "Triage overdue tasks",
      reasons: [
        `${formatCount(overdueTasks, "task")} overdue`,
        openTasks > overdueTasks ? `${formatCount(openTasks, "open task")} total` : "Planner pressure is the clearest signal",
        dueReviews > 0 ? `${formatCount(dueReviews, "review")} also due` : "Review queue is not the first blocker",
      ],
      primaryAction: { label: "Plan recovery", prompt: "Triage my overdue tasks and propose the next bounded move." },
      secondaryActions: [
        { label: "Open Planner", href: "/planner" },
        { label: "Start review", href: "/review" },
      ],
    };
  }

  if (dueReviews > 0) {
    return {
      title: "Clear the review queue",
      reasons: [
        `${formatCount(dueReviews, "review")} due now`,
        openTasks > 0 ? `${formatCount(openTasks, "open task")} can wait behind a short review pass` : "No higher task pressure is visible",
        "A focused review session keeps learning fresh",
      ],
      primaryAction: { label: "Start review", href: "/review" },
      secondaryActions: [
        { label: "Plan today", prompt: "Plan today around my schedule, tasks, and open loops." },
        { label: "Show options", prompt: "Show me the other reasonable next moves for today." },
      ],
    };
  }

  if (libraryInbox > 0) {
    return {
      title: "Process the Library inbox",
      reasons: [
        `${formatCount(libraryInbox, "capture")} still needs routing`,
        openTasks > 0 ? `${formatCount(openTasks, "open task")} may be linked to captured material` : "Processing captures can create the right tasks",
        "Source fidelity stays intact when captures are routed early",
      ],
      primaryAction: { label: "Process captures", prompt: "Process my latest Library captures and route anything actionable." },
      secondaryActions: [
        { label: "Open Library", href: "/library" },
        { label: "Create task", prompt: "Create a task for " },
      ],
    };
  }

  return {
    title: openTasks > 0 || openCommitments > 0 ? "Shape today’s plan" : "Set the first useful move",
    reasons: [
      openTasks > 0 ? `${formatCount(openTasks, "open task")} available to schedule` : "No urgent open loop is visible",
      openCommitments > 0 ? `${formatCount(openCommitments, "open commitment")} needs follow-through` : "Commitment pressure is low",
      contextItems.length > 0 || snapshot.messages.length > 0
        ? "Starlog has current context to work from"
        : "A short plan gives the day a clean starting point",
    ],
    primaryAction: { label: "Plan today", prompt: "Plan today around my schedule, tasks, and open loops." },
    secondaryActions: [
      { label: "Open Planner", href: "/planner" },
      { label: "Capture something", prompt: "Capture this for Starlog: " },
    ],
  };
}

function buildRecommendedMove(
  todaySummary: AssistantTodaySummary | null | undefined,
  openLoops: TodayItem[],
  contextItems: TodayItem[],
  snapshot: AssistantThreadSnapshot,
): RecommendedMove {
  const enriched = todaySummary?.recommended_next_move;
  const title = enriched?.title;
  const primaryLabel = enriched?.action_label || title;
  const primaryHref = enriched?.href || undefined;
  const primaryPrompt = enriched?.prompt || undefined;
  if (title && primaryLabel && (primaryHref || primaryPrompt)) {
    return {
      title,
      reasons: [
        ...(todaySummary?.reason_stack || []).filter(Boolean),
        ...(enriched.body ? [enriched.body] : []),
      ].slice(0, 4),
      primaryAction: {
        label: primaryLabel,
        href: primaryHref,
        prompt: primaryPrompt,
      },
      secondaryActions: buildQuickActions(todaySummary)
        .filter((action) => action.label !== primaryLabel && (action.href || action.prompt))
        .slice(0, 3),
    };
  }
  return buildFallbackRecommendedMove(todaySummary, openLoops, contextItems, snapshot);
}

function buildAtAGlanceItems(
  todaySummary: AssistantTodaySummary | null | undefined,
  openLoops: TodayItem[],
  contextItems: TodayItem[],
): Array<{ label: string; value: number }> {
  const loops = todaySummary?.at_a_glance?.length ? todaySummary.at_a_glance : todaySummary?.open_loops || [];
  if (loops.length > 0) {
    return loops.slice(0, 5).map((loop) => ({
      label: loop.label,
      value: Number.isFinite(loop.count) ? loop.count : 0,
    }));
  }
  return [
    { label: "Open loops", value: openLoops.length },
    { label: "Current context", value: contextItems.length },
  ];
}

function buildQuickActions(todaySummary: AssistantTodaySummary | null | undefined): TodayAction[] {
  const enrichedActions = (todaySummary?.quick_actions || [])
    .map((action) => ({
      label: action.action_label || action.title,
      href: action.href || undefined,
      prompt: action.prompt || undefined,
      enabled: action.enabled ?? true,
      count: action.count,
      reason: action.reason,
    }))
    .filter((action) => action.label && action.enabled !== false && (action.href || action.prompt))
    .slice(0, 4);
  if (enrichedActions.length > 0) {
    return enrichedActions;
  }
  return [
    { label: "Plan today", prompt: "Plan today around my schedule, tasks, and open loops." },
    { label: "Open Planner", href: "/planner" },
    { label: "Start review", href: "/review" },
    { label: "Process captures", prompt: "Process my latest Library captures and route anything actionable." },
  ];
}

function firstStrategicItem(...items: Array<StrategicContextItem | StrategicContextItem[] | null | undefined>): StrategicContextItem | null {
  for (const item of items) {
    if (Array.isArray(item)) {
      const first = item.find(Boolean);
      if (first) {
        return first;
      }
    } else if (item) {
      return item;
    }
  }
  return null;
}

function cleanStrategicText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function strategicItemTitle(item: StrategicContextItem): string | undefined {
  return cleanStrategicText(item.title) || cleanStrategicText(item.label);
}

function strategicItemDetail(item: StrategicContextItem): string | undefined {
  const explicitDetail =
    cleanStrategicText(item.body) || cleanStrategicText(item.summary) || cleanStrategicText(item.detail) || cleanStrategicText(item.reason);
  if (explicitDetail) {
    return explicitDetail;
  }
  if (item.horizon) {
    return `${item.horizon.replace(/_/g, " ")} goal`;
  }
  if (Object.prototype.hasOwnProperty.call(item, "next_action_id") && !item.next_action_id) {
    return "No next action yet.";
  }
  if (item.promised_to) {
    return `Promised to ${item.promised_to}.`;
  }
  if (item.due_at) {
    return "Due commitment.";
  }
  return undefined;
}

function strategicFallbackPrompt(kind: string, title: string): string {
  if (kind === "Goal") {
    return `Help me turn the active goal "${title}" into the next useful move.`;
  }
  if (kind === "Project") {
    return `Help me choose the next action for "${title}".`;
  }
  if (kind === "Commitment") {
    return `Help me follow through on the open commitment "${title}".`;
  }
  return `Help me resolve this active context item: ${title}.`;
}

function strategicContextRow(kind: string, item: StrategicContextItem | null, index = 0): StrategicContextRow | null {
  if (!item) {
    return null;
  }
  const title = strategicItemTitle(item);
  if (!title) {
    return null;
  }
  return {
    key: `${kind}-${item.id || item.key || title}-${index}`,
    eyebrow: kind,
    title,
    detail: strategicItemDetail(item),
    href: item.href || undefined,
    prompt: item.prompt || strategicFallbackPrompt(kind, title),
    actionLabel: item.action_label || (item.href ? "Open" : "Discuss"),
  };
}

function buildStrategicContextRows(todaySummary: AssistantTodaySummary | null | undefined): StrategicContextRow[] {
  const strategicContext = todaySummary?.strategic_context;
  if (!strategicContext) {
    return [];
  }

  const rows = [
    strategicContextRow("Goal", firstStrategicItem(strategicContext.active_goal, strategicContext.active_goals)),
    strategicContextRow("Project", firstStrategicItem(strategicContext.active_project, strategicContext.active_projects)),
    strategicContextRow("Commitment", firstStrategicItem(strategicContext.open_commitment, strategicContext.open_commitments)),
    ...(strategicContext.attention_items || [])
      .slice(0, 2)
      .map((item, index) => strategicContextRow("Attention", item, index)),
  ].filter((row): row is StrategicContextRow => Boolean(row));

  return rows;
}

function cleanWeeklyText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function weeklyItemTitle(item: string | WeeklySummaryItem): string | undefined {
  if (typeof item === "string") {
    return cleanWeeklyText(item);
  }
  const countPrefix = typeof item.count === "number" && item.count > 0 ? `${item.count} ` : "";
  const title = cleanWeeklyText(item.title) || cleanWeeklyText(item.label);
  return title ? `${countPrefix}${title}` : undefined;
}

function weeklyItemDetail(item: string | WeeklySummaryItem): string | undefined {
  if (typeof item === "string") {
    return undefined;
  }
  return cleanWeeklyText(item.body) || cleanWeeklyText(item.summary) || cleanWeeklyText(item.detail);
}

function formatWeeklyCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const WEEKLY_PROGRESS_LABELS: Record<string, { singular: string; plural?: string }> = {
  tasks_completed: { singular: "task completed", plural: "tasks completed" },
  review_session_count: { singular: "review session" },
  review_item_count: { singular: "review item" },
  captures_created: { singular: "capture created", plural: "captures created" },
  captures_processed: { singular: "capture processed", plural: "captures processed" },
  captures_summarized: { singular: "capture summarized", plural: "captures summarized" },
  cards_created: { singular: "card created", plural: "cards created" },
  artifact_tasks_created: { singular: "artifact task created", plural: "artifact tasks created" },
  goals_updated: { singular: "goal updated", plural: "goals updated" },
  goals_reviewed: { singular: "goal reviewed", plural: "goals reviewed" },
  projects_updated: { singular: "project updated", plural: "projects updated" },
  projects_reviewed: { singular: "project reviewed", plural: "projects reviewed" },
};

const WEEKLY_SLIPPAGE_LABELS: Record<string, { singular: string; plural?: string }> = {
  overdue_tasks: { singular: "overdue task" },
  overdue_commitments: { singular: "overdue commitment" },
  unprocessed_captures: { singular: "unprocessed capture" },
  due_review_cards: { singular: "due review card" },
  stale_active_projects: { singular: "stale active project" },
  stale_active_goals: { singular: "goal due for review", plural: "goals due for review" },
  projects_missing_next_action: { singular: "project missing a next action", plural: "projects missing next actions" },
};

function weeklyCountTitle(key: string, count: number, labels: Record<string, { singular: string; plural?: string }>): string {
  const label = labels[key];
  if (label) {
    return formatWeeklyCount(count, label.singular, label.plural);
  }
  return formatWeeklyCount(count, key.replace(/_/g, " "));
}

function buildWeeklyCountItems(
  counts: WeeklySignalCounts,
  prefix: string,
  labels: Record<string, { singular: string; plural?: string }>,
): WeeklyDisplayItem[] {
  return Object.entries(counts)
    .flatMap(([key, value]) => {
      const count = Number(value);
      if (!Number.isFinite(count) || count <= 0) {
        return [];
      }
      return [
        {
          key: `${prefix}-${key}`,
          title: weeklyCountTitle(key, count, labels),
        },
      ];
    })
    .slice(0, 3);
}

function buildWeeklyItems(
  items: Array<string | WeeklySummaryItem> | WeeklySignalCounts | undefined,
  prefix: string,
  labels: Record<string, { singular: string; plural?: string }>,
): WeeklyDisplayItem[] {
  if (!items) {
    return [];
  }
  if (!Array.isArray(items)) {
    return buildWeeklyCountItems(items, prefix, labels);
  }
  return items
    .flatMap((item, index) => {
      const title = weeklyItemTitle(item);
      if (!title) {
        return [];
      }
      const itemKey = typeof item === "string" ? item : item.key || item.title || item.label || title;
      return [
        {
          key: `${prefix}-${itemKey}-${index}`,
          title,
          detail: weeklyItemDetail(item),
        },
      ];
    })
    .slice(0, 3);
}

function buildWeeklyActions(options: WeeklyAdaptationOption[] | undefined): WeeklyDisplayAction[] {
  return (options || [])
    .flatMap((option, index) => {
      const label = cleanWeeklyText(option.action_label || undefined) || cleanWeeklyText(option.title) || cleanWeeklyText(option.label);
      if (!label) {
        return [];
      }
      const href = cleanWeeklyText(option.href || undefined);
      const prompt = cleanWeeklyText(option.prompt || undefined);
      const disabled = option.enabled === false || (!href && !prompt);
      return [
        {
          key: `${option.key || label}-${index}`,
          label,
          href: disabled ? undefined : href,
          prompt: disabled ? undefined : prompt,
          disabled,
          reason: cleanWeeklyText(option.reason) || cleanWeeklyText(option.status) || cleanWeeklyText(option.body),
        },
      ];
    })
    .slice(0, 3);
}

function hasWeeklyContent(weeklySummary: AssistantWeeklySummary | null | undefined): boolean {
  if (!weeklySummary) {
    return false;
  }
  return (
    buildWeeklyItems(weeklySummary.progress, "progress", WEEKLY_PROGRESS_LABELS).length > 0 ||
    buildWeeklyItems(weeklySummary.slippage, "slippage", WEEKLY_SLIPPAGE_LABELS).length > 0 ||
    buildWeeklyActions(weeklySummary.adaptation_options).length > 0
  );
}

function collectTodayOpenLoops(snapshot: AssistantThreadSnapshot, providedItems: TodayItem[] | undefined): TodayItem[] {
  const explicitItems = (providedItems || []).filter((item) => item.label !== "No open loops in this thread").slice(0, 4);
  if (explicitItems.length > 0) {
    return explicitItems;
  }
  return snapshot.interrupts
    .filter((interrupt) => interrupt.status === "pending")
    .slice(0, 4)
    .map((interrupt) => ({
      label: pendingInterruptTodayLabel(interrupt),
      href: interrupt.entity_ref?.href || undefined,
    }));
}

function collectTodayContext(snapshot: AssistantThreadSnapshot, providedItems: TodayItem[] | undefined): TodayItem[] {
  const explicitItems = (providedItems || []).slice(0, 4);
  if (explicitItems.length > 0) {
    return explicitItems;
  }

  const context: TodayItem[] = [];
  for (const message of [...snapshot.messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (part.type !== "card") {
        continue;
      }
      const label = cardTodayLabel(part.card);
      if (!label) {
        continue;
      }
      context.push({
        label,
        href: part.card.entity_ref?.href || undefined,
      });
      if (context.length >= 4) {
        return context;
      }
    }
  }
  return context;
}

function cardMetadataBadges(card: AssistantCard): string[] {
  const metadata = card.metadata || {};
  const badges: string[] = [];

  if (card.kind === "review_queue") {
    const dueCount = Number(metadata.due_count);
    if (Number.isFinite(dueCount) && dueCount > 0) {
      badges.push(`${dueCount} due now`);
    }
    badges.push(...reviewModeBadges(metadata.mode_counts));
  }

  if (card.kind === "task_list") {
    const taskCount = Number(metadata.task_count);
    if (Number.isFinite(taskCount) && taskCount > 0) {
      badges.push(`${taskCount} task${taskCount === 1 ? "" : "s"}`);
    }
  }

  if (card.kind === "briefing") {
    if (typeof metadata.date === "string" && metadata.date.trim()) {
      badges.push(metadata.date.trim());
    }
    if (typeof metadata.audio_ref === "string" && metadata.audio_ref.trim()) {
      badges.push("Audio cached");
    } else if (typeof metadata.briefing_id === "string" && metadata.briefing_id.trim()) {
      badges.push("Thread prompt ready");
    }
  }

  if (card.kind === "capture_item") {
    if (typeof metadata.source_type === "string" && metadata.source_type.trim()) {
      badges.push(metadata.source_type.trim().replace(/_/g, " "));
    }
    if (typeof metadata.artifact_id === "string" && metadata.artifact_id.trim()) {
      badges.push(`Artifact ${metadata.artifact_id.trim()}`);
    }
  }

  if (card.kind === "knowledge_note") {
    const version = Number(metadata.version);
    if (Number.isFinite(version) && version > 0) {
      badges.push(`v${version}`);
    }
    if (metadata.search_result === true) {
      badges.push("Search match");
    }
  }

  if (card.kind === "memory_suggestion") {
    if (typeof metadata.suggestion_type === "string" && metadata.suggestion_type.trim()) {
      badges.push(metadata.suggestion_type.trim().replace(/_/g, " "));
    }
    const weight = Number(metadata.weight);
    if (Number.isFinite(weight) && weight > 0) {
      badges.push(`Weight ${weight.toFixed(1)}`);
    }
  }

  if (metadata.draft === true) {
    badges.push("Draft");
  }

  return badges;
}

function EntityLink({ entityRef }: { entityRef: AssistantEntityRef | null | undefined }) {
  if (!entityRef?.href) {
    return null;
  }

  return (
    <a className={styles.entityLink} href={entityRef.href}>
      {supportSurfaceActionLabel(entityRef)}
    </a>
  );
}

function attachmentActionLabel(attachment: AssistantAttachment): string {
  if (attachment.kind === "audio") {
    return "Open audio";
  }
  if (attachment.kind === "image") {
    return "Open image";
  }
  if (attachment.kind === "citation") {
    return "Open source";
  }
  if (attachment.kind === "artifact") {
    return "Open artifact";
  }
  return "Open attachment";
}

function summarizeOutput(output: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(output)
    .filter((entry) => entry[1] !== null && entry[1] !== undefined)
    .slice(0, 4)
    .map(([key, value]) => {
      if (typeof value === "string") {
        return [key, value];
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return [key, String(value)];
      }
      if (Array.isArray(value)) {
        return [key, `${value.length} item${value.length === 1 ? "" : "s"}`];
      }
      if (typeof value === "object" && value) {
        const fieldCount = Object.keys(value).length;
        return [key, `${fieldCount} field${fieldCount === 1 ? "" : "s"}`];
      }
      return [key, String(value)];
    });
}

function toolStatusSummary(toolCall: AssistantToolCall): string {
  if (toolCall.status === "requires_action") {
    return "Awaiting thread decision";
  }
  if (toolCall.status === "running") {
    return "Running now";
  }
  if (toolCall.status === "queued") {
    return "Queued to run";
  }
  if (toolCall.status === "error") {
    return "Tool execution failed";
  }
  if (toolCall.status === "cancelled") {
    return "Tool execution cancelled";
  }
  return "Completed";
}

function roleLabel(role: AssistantThreadMessage["role"]): string {
  if (role === "assistant") {
    return "Starlog";
  }
  if (role === "user") {
    return "You";
  }
  if (role === "system") {
    return "Update";
  }
  return "Activity";
}

function toolActionLabel(toolName: string): string {
  const normalized = toolName.replace(/_/g, " ");
  if (toolName === "create_task") {
    return "Created task";
  }
  if (toolName === "update_task") {
    return "Updated task";
  }
  if (toolName === "list_due_cards") {
    return "Checked review queue";
  }
  if (toolName === "generate_briefing") {
    return "Prepared briefing";
  }
  if (toolName === "capture_text_as_artifact") {
    return "Saved capture";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function toolSurfaceLabel(toolName: string): string | null {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("planner") || normalized.includes("task") || normalized.includes("calendar") || normalized.includes("schedule")) {
    return "Planner";
  }
  if (normalized.includes("review") || normalized.includes("card") || normalized.includes("recall")) {
    return "Review";
  }
  if (normalized.includes("library") || normalized.includes("artifact") || normalized.includes("capture") || normalized.includes("note")) {
    return "Library";
  }
  if (normalized.includes("brief")) {
    return "briefing";
  }
  return null;
}

function toolCallActivityLabel(toolCall: AssistantToolCall): string {
  if (toolCall.title) {
    return toolCall.title;
  }
  if (toolCall.tool_name === "create_task" || toolCall.tool_name === "update_task") {
    return toolActionLabel(toolCall.tool_name);
  }
  const surface = toolSurfaceLabel(toolCall.tool_name);
  if (toolCall.status === "running" || toolCall.status === "queued") {
    return surface ? `Checking ${surface}` : toolActionLabel(toolCall.tool_name);
  }
  if (toolCall.status === "requires_action") {
    return "Needs your decision";
  }
  if (toolCall.status === "error") {
    return "Check failed";
  }
  if (toolCall.status === "cancelled") {
    return "Check cancelled";
  }
  return surface ? `Checked ${surface}` : toolActionLabel(toolCall.tool_name);
}

function toolResultActivityLabel(result: AssistantToolResult): string {
  const toolName = typeof result.metadata?.tool_name === "string" ? result.metadata.tool_name : "tool";
  if (result.status === "error") {
    const surface = toolSurfaceLabel(toolName);
    return surface ? `${surface} check failed` : "Check failed";
  }
  return toolActionLabel(toolName);
}

function statusActivityLabel(part: AssistantStatusPart): string {
  if (part.label?.trim()) {
    return part.label.trim();
  }
  if (part.status === "running") {
    return "Working";
  }
  if (part.status === "requires_action") {
    return "Needs your decision";
  }
  if (part.status === "error") {
    return "Needs attention";
  }
  if (part.status === "pending") {
    return "Waiting";
  }
  return "Done";
}

function activityPartLabel(part: ActivityPart): string {
  if (part.type === "tool_call") {
    return toolCallActivityLabel(part.tool_call);
  }
  if (part.type === "tool_result") {
    return toolResultActivityLabel(part.tool_result);
  }
  return statusActivityLabel(part);
}

function activityStripTitle(parts: ActivityPart[]): string {
  if (parts.length === 1) {
    return "What I checked";
  }
  const hasResult = parts.some((part) => part.type === "tool_result");
  const hasRunning = parts.some(
    (part) =>
      (part.type === "tool_call" && (part.tool_call.status === "running" || part.tool_call.status === "queued")) ||
      (part.type === "status" && (part.status === "running" || part.status === "pending")),
  );
  if (hasRunning && !hasResult) {
    return "What I'm checking";
  }
  return "What I checked";
}

function formattedJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

function groupMessageParts(parts: AssistantMessagePart[]): MessagePartGroup[] {
  const groups: MessagePartGroup[] = [];
  let activityParts: ActivityPart[] = [];
  let activityStartIndex = 0;

  const flushActivity = () => {
    if (activityParts.length === 0) {
      return;
    }
    groups.push({
      kind: "activity",
      id: `activity-group:${activityStartIndex}:${activityParts.map((part) => part.id).join(":")}`,
      parts: activityParts,
    });
    activityParts = [];
  };

  for (const [index, part] of parts.entries()) {
    if (part.type === "tool_call" || part.type === "tool_result" || part.type === "status") {
      if (activityParts.length === 0) {
        activityStartIndex = index;
      }
      activityParts.push(part);
      continue;
    }
    flushActivity();
    groups.push({ kind: "part", part });
  }

  flushActivity();
  return groups;
}

function CardSection({
  card,
  busy,
  onCardAction,
}: {
  card: AssistantCard;
  busy: boolean;
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
}) {
  const registry = getConversationCardRegistryEntry(card.kind, card.title);
  const badges = cardMetadataBadges(card);

  return (
    <section className={`${styles.card} ${styles[`cardTone_${registry.tone}`] || ""}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardEyebrow}>
          <span className={styles.cardGlyph}>{registry.glyph || "•"}</span>
          <span>{registry.label}</span>
        </div>
        <EntityLink entityRef={card.entity_ref} />
      </div>
      {card.title ? <h3>{card.title}</h3> : null}
      {card.body ? <p className={styles.cardBody}>{card.body}</p> : null}
      {badges.length > 0 ? (
        <div className={styles.badges}>
          {badges.map((badge) => (
            <span key={`${card.kind}-${badge}`} className={styles.badge}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}
      {card.actions.length > 0 ? (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`${styles.actionButton} ${styles[`action_${action.style || "secondary"}`]}`}
              onClick={() => void onCardAction(action)}
              disabled={busy}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AmbientUpdateSection({
  update,
  busy,
  onCardAction,
}: {
  update: AssistantAmbientUpdate;
  busy: boolean;
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
}) {
  return (
    <div className={styles.ambientDetail}>
      <div className={styles.ambientCopy}>
        <div className={styles.ambientTitleRow}>
          <strong>{update.label}</strong>
          <EntityLink entityRef={update.entity_ref} />
        </div>
        {update.body ? <span>{update.body}</span> : null}
      </div>
      {update.actions && update.actions.length > 0 ? (
        <div className={styles.actions}>
          {update.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`${styles.actionButton} ${styles[`action_${action.style || "secondary"}`]}`}
              onClick={() => void onCardAction(action)}
              disabled={busy}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolResultSection({
  result,
  busy,
  onCardAction,
}: {
  result: AssistantToolResult;
  busy: boolean;
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
}) {
  const rows = summarizeOutput(result.output || {});
  const badges = [result.status.replace(/_/g, " "), `${Object.keys(result.output || {}).length} field${Object.keys(result.output || {}).length === 1 ? "" : "s"}`];
  const toolName = typeof result.metadata?.tool_name === "string" ? result.metadata.tool_name : "tool";

  return (
    <section className={styles.toolResultPanel}>
      <details className={styles.activityDetails}>
        <summary>
          <span>{toolActionLabel(toolName)}</span>
          <EntityLink entityRef={result.entity_ref} />
        </summary>
        <div className={styles.badges}>
          {badges.map((badge) => (
            <span key={`${result.id}-${badge}`} className={styles.badge}>
              {badge}
            </span>
          ))}
        </div>
        {rows.length > 0 ? (
          <dl className={styles.outputGrid}>
            {rows.map(([key, value]) => (
              <div key={`${result.id}-${key}`} className={styles.outputRow}>
                <dt>{key.replace(/_/g, " ")}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </details>
      {result.card ? <CardSection card={result.card} busy={busy} onCardAction={onCardAction} /> : null}
    </section>
  );
}

function ToolCallSection({ toolCall }: { toolCall: AssistantToolCall }) {
  const argumentRows = summarizeOutput(toolCall.arguments || {});
  const badges = [toolCall.tool_kind.replace(/_/g, " "), toolCall.status.replace(/_/g, " ")];

  return (
    <details className={styles.toolCallPanel}>
      <summary>
        <span>{toolActionLabel(toolCall.tool_name)}</span>
        <small>{toolStatusSummary(toolCall)}</small>
      </summary>
      <div className={styles.badges}>
        {badges.map((badge) => (
          <span key={`${toolCall.id}-${badge}`} className={styles.badge}>
            {badge}
          </span>
        ))}
      </div>
      {argumentRows.length > 0 ? (
        <dl className={styles.outputGrid}>
          {argumentRows.map(([key, value]) => (
            <div key={`${toolCall.id}-${key}`} className={styles.outputRow}>
              <dt>{key.replace(/_/g, " ")}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </details>
  );
}

function ActivityTechnicalDetails({ part }: { part: ActivityPart }) {
  if (part.type === "tool_call") {
    const badges = [part.tool_call.tool_kind.replace(/_/g, " "), part.tool_call.status.replace(/_/g, " ")];
    return (
      <section className={styles.activityTechnicalSection}>
        <div className={styles.cardHeader}>
          <strong>{toolActionLabel(part.tool_call.tool_name)}</strong>
          <small>{toolStatusSummary(part.tool_call)}</small>
        </div>
        <div className={styles.badges}>
          {badges.map((badge) => (
            <span key={`${part.id}-${badge}`} className={styles.badge}>
              {badge}
            </span>
          ))}
        </div>
        <div className={styles.rawJsonBlock}>
          <span>Raw arguments</span>
          <pre>{formattedJson(part.tool_call.arguments || {})}</pre>
        </div>
      </section>
    );
  }

  if (part.type === "tool_result") {
    const outputCount = Object.keys(part.tool_result.output || {}).length;
    const badges = [part.tool_result.status.replace(/_/g, " "), `${outputCount} field${outputCount === 1 ? "" : "s"}`];
    return (
      <section className={styles.activityTechnicalSection}>
        <div className={styles.cardHeader}>
          <strong>{toolResultActivityLabel(part.tool_result)}</strong>
          <EntityLink entityRef={part.tool_result.entity_ref} />
        </div>
        <div className={styles.badges}>
          {badges.map((badge) => (
            <span key={`${part.id}-${badge}`} className={styles.badge}>
              {badge}
            </span>
          ))}
        </div>
        <div className={styles.rawJsonBlock}>
          <span>Raw result</span>
          <pre>{formattedJson(part.tool_result.output || {})}</pre>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.activityTechnicalSection}>
      <div className={styles.cardHeader}>
        <strong>{statusActivityLabel(part)}</strong>
        <small>{part.status.replace(/_/g, " ")}</small>
      </div>
      <div className={styles.rawJsonBlock}>
        <span>Raw status</span>
        <pre>{formattedJson({ status: part.status, label: part.label || null })}</pre>
      </div>
    </section>
  );
}

function ActivityStrip({
  parts,
  busy,
  onCardAction,
}: {
  parts: ActivityPart[];
  busy: boolean;
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
}) {
  return (
    <section className={styles.activityStrip} aria-label="Assistant activity">
      <details className={styles.activityStripDetails}>
        <summary>
          <span>{activityStripTitle(parts)}</span>
          <span className={styles.activityChips}>
            {parts.slice(0, 5).map((part) => (
              <span key={`activity-chip:${part.id}`}>{activityPartLabel(part)}</span>
            ))}
          </span>
        </summary>
        <div className={styles.activityTechnicalList}>
          {parts.map((part) => (
            <ActivityTechnicalDetails key={`activity-detail:${part.id}`} part={part} />
          ))}
        </div>
      </details>
      {parts.map((part) =>
        part.type === "tool_result" && part.tool_result.card ? (
          <CardSection key={`${part.id}-card`} card={part.tool_result.card} busy={busy} onCardAction={onCardAction} />
        ) : null,
      )}
    </section>
  );
}

function AttachmentSection({ attachment }: { attachment: AssistantAttachment }) {
  const badges: string[] = [attachment.kind];
  if (attachment.mime_type) {
    badges.push(attachment.mime_type);
  }

  return (
    <section className={styles.attachmentPanel}>
      <div className={styles.cardHeader}>
        <div className={styles.cardEyebrow}>
          <span className={styles.cardGlyph}>⎘</span>
          <span>Attachment</span>
        </div>
        {attachment.url ? (
          <a className={styles.entityLink} href={attachment.url}>
            {attachmentActionLabel(attachment)}
          </a>
        ) : null}
      </div>
      <strong>{attachment.label}</strong>
      <div className={styles.badges}>
        {badges.map((badge) => (
          <span key={`${attachment.id}-${badge}`} className={styles.badge}>
            {badge}
          </span>
        ))}
      </div>
    </section>
  );
}

function TodayPanel({
  snapshot,
  todaySummary,
  weeklySummary,
  openLoops,
  contextItems,
  busy,
  onQuickStart,
}: {
  snapshot: AssistantThreadSnapshot;
  todaySummary?: AssistantTodaySummary | null;
  weeklySummary?: AssistantWeeklySummary | null;
  openLoops: TodayItem[];
  contextItems: TodayItem[];
  busy: boolean;
  onQuickStart: (prompt: string) => void;
}) {
  const recommendedMove = buildRecommendedMove(todaySummary, openLoops, contextItems, snapshot);
  const reasons = recommendedMove.reasons.length > 0 ? recommendedMove.reasons : ["Starlog has enough current context to recommend one next move."];
  const atAGlanceItems = buildAtAGlanceItems(todaySummary, openLoops, contextItems);
  const quickActions = buildQuickActions(todaySummary);
  const strategicRows = buildStrategicContextRows(todaySummary);
  const weeklyProgress = buildWeeklyItems(weeklySummary?.progress, "progress", WEEKLY_PROGRESS_LABELS);
  const weeklySlippage = buildWeeklyItems(weeklySummary?.slippage, "slippage", WEEKLY_SLIPPAGE_LABELS);
  const weeklyActions = buildWeeklyActions(weeklySummary?.adaptation_options);
  const showWeeklySummary = hasWeeklyContent(weeklySummary);

  const renderAction = (action: TodayAction, className?: string) => {
    if (action.href) {
      return (
        <a className={className} href={action.href}>
          {action.label}
        </a>
      );
    }
    return (
      <button
        className={className}
        type="button"
        onClick={() => onQuickStart(action.prompt || "")}
        disabled={busy || !action.prompt}
      >
        {action.label}
      </button>
    );
  };

  const renderWeeklyAction = (action: WeeklyDisplayAction) => {
    if (action.href) {
      return (
        <a href={action.href}>
          {action.label}
        </a>
      );
    }
    if (action.prompt) {
      return (
        <button type="button" onClick={() => onQuickStart(action.prompt || "")} disabled={busy}>
          {action.label}
        </button>
      );
    }
    return (
      <span className={styles.weeklyDisabledAction} aria-disabled="true" title={action.reason}>
        {action.label}
      </span>
    );
  };

  return (
    <section className={styles.todayPanel} aria-labelledby="assistant-today-title">
      <div className={styles.todayHeader}>
        <p className={styles.todayKicker}>Today in Starlog</p>
        <h2 id="assistant-today-title">Recommended next move</h2>
      </div>

      <article className={styles.recommendedMove}>
        <div className={styles.recommendedMoveCopy}>
          <p className={styles.recommendedMoveLabel}>Do this next</p>
          <h3>{recommendedMove.title}</h3>
          <div className={styles.reasonStack} aria-label="Why this recommendation">
            <span>Why</span>
            <ul>
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className={styles.recommendedActions}>
          {renderAction(recommendedMove.primaryAction, styles.primaryAction)}
          {recommendedMove.secondaryActions.length > 0 ? (
            <div className={styles.secondaryActions} aria-label="Secondary options">
              {recommendedMove.secondaryActions.map((action) => (
                <span key={`${action.label}-${action.href || action.prompt}`}>{renderAction(action)}</span>
              ))}
            </div>
          ) : null}
        </div>
      </article>

      {showWeeklySummary ? (
        <section className={styles.weeklyReview} aria-labelledby="assistant-weekly-systems-title">
          <div className={styles.todayBlockHeader}>
            <span id="assistant-weekly-systems-title">Weekly systems review</span>
            <strong>{weeklyActions.length}</strong>
          </div>
          <div className={styles.weeklyReviewGrid}>
            <div className={styles.weeklyReviewColumn}>
              <span>Progress</span>
              {weeklyProgress.length > 0 ? (
                <ul>
                  {weeklyProgress.map((item) => (
                    <li key={item.key}>
                      <strong>{item.title}</strong>
                      {item.detail ? <small>{item.detail}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No clear progress signal yet.</p>
              )}
            </div>
            <div className={styles.weeklyReviewColumn}>
              <span>Slippage</span>
              {weeklySlippage.length > 0 ? (
                <ul>
                  {weeklySlippage.map((item) => (
                    <li key={item.key}>
                      <strong>{item.title}</strong>
                      {item.detail ? <small>{item.detail}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No material slip detected.</p>
              )}
            </div>
          </div>
          {weeklyActions.length > 0 ? (
            <div className={styles.weeklyActions} aria-label="Weekly adaptation actions">
              {weeklyActions.map((action) => (
                <span key={action.key}>
                  {renderWeeklyAction(action)}
                  {action.disabled && action.reason ? <small>{action.reason}</small> : null}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className={styles.atAGlance} aria-label="At a glance">
        {atAGlanceItems.map((item) => (
          <div key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      {strategicRows.length > 0 ? (
        <section className={styles.strategicContext} aria-labelledby="assistant-strategic-context-title">
          <div className={styles.todayBlockHeader}>
            <span id="assistant-strategic-context-title">Strategic context</span>
            <strong>{strategicRows.length}</strong>
          </div>
          <div className={styles.strategicContextList}>
            {strategicRows.map((item) => (
              <article key={item.key} className={styles.strategicContextItem}>
                <div className={styles.strategicContextCopy}>
                  <span>{item.eyebrow}</span>
                  <strong>{item.title}</strong>
                  {item.detail ? <p>{item.detail}</p> : null}
                </div>
                {item.href ? (
                  <a href={item.href}>{item.actionLabel || "Open"}</a>
                ) : item.prompt ? (
                  <button type="button" onClick={() => onQuickStart(item.prompt || "")} disabled={busy}>
                    {item.actionLabel || "Discuss"}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className={styles.quickActions} aria-label="Quick actions">
        {quickActions.map((action) => (
          <span key={`${action.label}-${action.href || action.prompt}`}>
            {renderAction(action)}
            {typeof action.count === "number" && action.count > 0 ? <small>{action.count}</small> : null}
          </span>
        ))}
      </div>

      <div className={styles.todayGrid}>
        <section className={styles.todayBlock}>
          <div className={styles.todayBlockHeader}>
            <span>Needs attention</span>
            <strong>{openLoops.length}</strong>
          </div>
          {openLoops.length > 0 ? (
            <ul className={styles.todayList}>
              {openLoops.slice(0, 4).map((item, index) => (
                <li key={`loop-${item.label}-${index}`}>
                  {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.todayEmptyCopy}>No pending decisions right now.</p>
          )}
        </section>

        <section className={styles.todayBlock}>
          <div className={styles.todayBlockHeader}>
            <span>Current context</span>
            <strong>{contextItems.length}</strong>
          </div>
          {contextItems.length > 0 ? (
            <ul className={styles.todayList}>
              {contextItems.slice(0, 4).map((item, index) => (
                <li key={`context-${item.label}-${index}`}>
                  {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.todayEmptyCopy}>No active items yet. Start with a plan, capture, review, or task.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function MessagePart({
  message,
  interruptById,
  busy,
  onCardAction,
  onInterruptSubmit,
  onInterruptDismiss,
}: {
  message: AssistantThreadMessage;
  interruptById: Record<string, AssistantInterrupt>;
  busy: boolean;
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
  onInterruptSubmit: (interruptId: string, values: Record<string, unknown>) => Promise<void> | void;
  onInterruptDismiss: (interruptId: string) => Promise<void> | void;
}) {
  const partGroups = groupMessageParts(message.parts);

  const renderPart = (part: AssistantMessagePart) => {
    if (part.type === "text") {
      return (
        <p key={part.id} className={styles.textPart}>
          {part.text}
        </p>
      );
    }
    if (part.type === "ambient_update") {
      return (
        <AmbientUpdateSection
          key={part.id}
          update={part.update}
          busy={busy}
          onCardAction={onCardAction}
        />
      );
    }
    if (part.type === "card") {
      return <CardSection key={part.id} card={part.card} busy={busy} onCardAction={onCardAction} />;
    }
    if (part.type === "tool_call") {
      return <ToolCallSection key={part.id} toolCall={part.tool_call} />;
    }
    if (part.type === "tool_result") {
      return <ToolResultSection key={part.id} result={part.tool_result} busy={busy} onCardAction={onCardAction} />;
    }
    if (part.type === "interrupt_resolution") {
      return (
        <div key={part.id} className={styles.resolution}>
          <strong>Saved</strong>
          <span>{part.resolution.action}</span>
        </div>
      );
    }
    if (part.type === "status") {
      return (
        <div key={part.id} className={styles.statusPanel}>
          <strong>Status</strong>
          <span>{part.label || part.status}</span>
        </div>
      );
    }
    if (part.type === "attachment") {
      return <AttachmentSection key={part.id} attachment={part.attachment} />;
    }
    if (part.type === "interrupt_request") {
      const liveInterrupt = interruptById[part.interrupt.id] || part.interrupt;
      if (liveInterrupt.status !== "pending") {
        const resolutionRecord =
          liveInterrupt.resolution && typeof liveInterrupt.resolution === "object"
            ? (liveInterrupt.resolution as { values?: Record<string, unknown> })
            : null;
        const resolutionValue = resolutionRecord?.values?.resolution;
        const detail =
          typeof resolutionValue === "string" && resolutionValue
            ? resolutionValue.replace(/_/g, " ")
            : liveInterrupt.status === "submitted"
              ? "resolved from another surface"
              : "no longer pending";
        return (
          <div key={part.id} className={styles.resolution}>
            <strong>{liveInterrupt.status === "submitted" ? "Resolved" : "Dismissed"}</strong>
            <span>{detail}</span>
          </div>
        );
      }
      return (
        <DynamicPanelRenderer
          key={part.id}
          interrupt={liveInterrupt}
          busy={busy}
          onSubmit={onInterruptSubmit}
          onDismiss={onInterruptDismiss}
        />
      );
    }
    return null;
  };

  return (
    <article className={`${styles.message} ${styles[`role_${message.role}`]}`}>
      <div className={styles.meta}>
        <span>{roleLabel(message.role)}</span>
        <span>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        {message.status !== "complete" ? <span>{message.status.replace(/_/g, " ")}</span> : null}
      </div>
      <div className={styles.bubble}>
        {partGroups.map((group) =>
          group.kind === "activity" ? (
            <ActivityStrip key={group.id} parts={group.parts} busy={busy} onCardAction={onCardAction} />
          ) : (
            renderPart(group.part)
          ),
        )}
      </div>
    </article>
  );
}

export function MainRoomThread({
  snapshot,
  loading,
  busy,
  todaySummary,
  weeklySummary,
  todayOpenLoops,
  todayContextItems,
  onQuickStart,
  onCardAction,
  onInterruptSubmit,
  onInterruptDismiss,
}: MainRoomThreadProps) {
  if (loading && !snapshot) {
    return <section className={styles.threadShell}>Loading assistant thread…</section>;
  }

  if (!snapshot) {
    return <section className={styles.threadShell}>Assistant thread unavailable.</section>;
  }

  const interruptById = Object.fromEntries(snapshot.interrupts.map((interrupt) => [interrupt.id, interrupt]));
  const openLoops = collectTodayOpenLoops(snapshot, todayOpenLoops);
  const contextItems = collectTodayContext(snapshot, todayContextItems);

  return (
    <section className={styles.threadShell}>
      {snapshot.messages.length === 0 ? (
        <TodayPanel
          snapshot={snapshot}
          todaySummary={todaySummary}
          weeklySummary={weeklySummary}
          openLoops={openLoops}
          contextItems={contextItems}
          busy={busy}
          onQuickStart={onQuickStart}
        />
      ) : (
        snapshot.messages.map((message) => (
          <MessagePart
            key={message.id}
            message={message}
            interruptById={interruptById}
            busy={busy}
            onCardAction={onCardAction}
            onInterruptSubmit={onInterruptSubmit}
            onInterruptDismiss={onInterruptDismiss}
          />
        ))
      )}
    </section>
  );
}
