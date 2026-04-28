"use client";

import type {
  AssistantAttachment,
  AssistantAmbientUpdate,
  AssistantCard,
  AssistantCardAction,
  AssistantEntityRef,
  AssistantInterrupt,
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

type TodayOpenLoopSummary = {
  key: string;
  label: string;
  count: number;
  href?: string | null;
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
  generated_at?: string;
};

type RecommendedMove = {
  title: string;
  reasons: string[];
  primaryAction: TodayAction;
  secondaryActions: TodayAction[];
};

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
  openLoops,
  contextItems,
  busy,
  onQuickStart,
}: {
  snapshot: AssistantThreadSnapshot;
  todaySummary?: AssistantTodaySummary | null;
  openLoops: TodayItem[];
  contextItems: TodayItem[];
  busy: boolean;
  onQuickStart: (prompt: string) => void;
}) {
  const recommendedMove = buildRecommendedMove(todaySummary, openLoops, contextItems, snapshot);
  const reasons = recommendedMove.reasons.length > 0 ? recommendedMove.reasons : ["Starlog has enough current context to recommend one next move."];
  const atAGlanceItems = buildAtAGlanceItems(todaySummary, openLoops, contextItems);
  const quickActions = buildQuickActions(todaySummary);

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

      <div className={styles.atAGlance} aria-label="At a glance">
        {atAGlanceItems.map((item) => (
          <div key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

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
  return (
    <article className={`${styles.message} ${styles[`role_${message.role}`]}`}>
      <div className={styles.meta}>
        <span>{roleLabel(message.role)}</span>
        <span>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        {message.status !== "complete" ? <span>{message.status.replace(/_/g, " ")}</span> : null}
      </div>
      <div className={styles.bubble}>
        {message.parts.map((part) => {
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
        })}
      </div>
    </article>
  );
}

export function MainRoomThread({
  snapshot,
  loading,
  busy,
  todaySummary,
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
