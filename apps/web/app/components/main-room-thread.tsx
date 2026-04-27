"use client";

import { useEffect, useMemo, useState } from "react";
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
import styles from "./main-room-thread.module.css";

type MainRoomThreadProps = {
  snapshot: AssistantThreadSnapshot | null;
  loading: boolean;
  busy: boolean;
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

type TodayMove = {
  label: string;
  prompt: string;
};

const TODAY_MOVES: TodayMove[] = [
  {
    label: "Plan today",
    prompt: "Plan today around my schedule, tasks, and open loops.",
  },
  {
    label: "Process captures",
    prompt: "Process my latest captures and route anything actionable.",
  },
  {
    label: "Start review",
    prompt: "Start a focused review session for what is due now.",
  },
  {
    label: "Create task",
    prompt: "Create a task for ",
  },
];

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

function defaultValues(interrupt: AssistantInterrupt): Record<string, unknown> {
  return interrupt.fields.reduce<Record<string, unknown>>((accumulator, field) => {
    accumulator[field.id] = field.value ?? (field.kind === "toggle" ? false : "");
    return accumulator;
  }, {});
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

function renderField(
  interrupt: AssistantInterrupt,
  values: Record<string, unknown>,
  setValues: (next: Record<string, unknown>) => void,
) {
  return interrupt.fields.map((field) => {
    const value = values[field.id] ?? "";
    const commonLabel = (
      <label key={`${interrupt.id}-${field.id}`} className={styles.field}>
        <span>{field.label}</span>
        {field.kind === "date" ? (
          <input
            type="date"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => setValues({ ...values, [field.id]: event.target.value })}
          />
        ) : null}
        {field.kind === "time" ? (
          <input
            type="time"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => setValues({ ...values, [field.id]: event.target.value })}
          />
        ) : null}
        {field.kind === "datetime" ? (
          <input
            type="datetime-local"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => setValues({ ...values, [field.id]: event.target.value })}
          />
        ) : null}
        {field.kind === "toggle" ? (
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => setValues({ ...values, [field.id]: event.target.checked })}
          />
        ) : null}
        {(field.kind === "select" || field.kind === "priority") ? (
          <select
            value={String(value || "")}
            onChange={(event) => setValues({ ...values, [field.id]: event.target.value })}
          >
            {!field.required ? <option value="">Choose…</option> : null}
            {(field.options || []).map((option) => (
              <option key={`${field.id}-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
            {field.kind === "priority" && !(field.options || []).length
              ? [1, 2, 3, 4, 5].map((option) => (
                  <option key={`${field.id}-${option}`} value={String(option)}>
                    Priority {option}
                  </option>
                ))
              : null}
          </select>
        ) : null}
        {(field.kind === "text" || field.kind === "entity_search") ? (
          <input
            type="text"
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder || ""}
            onChange={(event) => setValues({ ...values, [field.id]: event.target.value })}
          />
        ) : null}
        {field.kind === "textarea" ? (
          <textarea
            rows={4}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder || ""}
            onChange={(event) => setValues({ ...values, [field.id]: event.target.value })}
          />
        ) : null}
      </label>
    );
    return commonLabel;
  });
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
  openLoops,
  contextItems,
  busy,
  onQuickStart,
}: {
  snapshot: AssistantThreadSnapshot;
  openLoops: TodayItem[];
  contextItems: TodayItem[];
  busy: boolean;
  onQuickStart: (prompt: string) => void;
}) {
  const hasOpenLoops = openLoops.length > 0;
  const hasContext = contextItems.length > 0;

  return (
    <section className={styles.todayPanel} aria-labelledby="assistant-today-title">
      <div className={styles.todayHeader}>
        <p className={styles.todayKicker}>Today in Starlog</p>
        <h2 id="assistant-today-title">Choose the next useful move.</h2>
        <p>
          Start with planning, captures, review, or a task. Starlog will keep the work connected across
          Assistant, Library, Planner, and Review.
        </p>
      </div>

      <div className={styles.todayMoves} aria-label="Today quick starts">
        {TODAY_MOVES.map((move) => (
          <button
            key={move.label}
            type="button"
            onClick={() => onQuickStart(move.prompt)}
            disabled={busy}
          >
            {move.label}
          </button>
        ))}
      </div>

      <div className={styles.todayGrid}>
        <section className={styles.todayBlock}>
          <div className={styles.todayBlockHeader}>
            <span>Open loops</span>
            <strong>{hasOpenLoops ? openLoops.length : 0}</strong>
          </div>
          {hasOpenLoops ? (
            <ul className={styles.todayList}>
              {openLoops.map((item, index) => (
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
            <span>Useful context</span>
            <strong>{hasContext ? contextItems.length : snapshot.messages.length}</strong>
          </div>
          {hasContext ? (
            <ul className={styles.todayList}>
              {contextItems.map((item, index) => (
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
  const interruptPart = message.parts.find(
    (part): part is Extract<AssistantThreadMessage["parts"][number], { type: "interrupt_request" }> =>
      part.type === "interrupt_request",
  );
  const initialValues = useMemo(() => (interruptPart ? defaultValues(interruptPart.interrupt) : {}), [interruptPart]);
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

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
              <section key={part.id} className={styles.panel}>
                <div className={styles.cardHeader}>
                  <p className={styles.cardKind}>Decision</p>
                  <EntityLink entityRef={liveInterrupt.entity_ref} />
                </div>
                <h3>{liveInterrupt.title}</h3>
                {liveInterrupt.body ? <p>{liveInterrupt.body}</p> : null}
                <div className={styles.panelFields}>{renderField(liveInterrupt, values, setValues)}</div>
                {liveInterrupt.consequence_preview ? (
                  <p className={styles.consequencePreview}>{liveInterrupt.consequence_preview}</p>
                ) : null}
                <div className={styles.panelActions}>
                  <button
                    type="button"
                    onClick={() => void onInterruptDismiss(liveInterrupt.id)}
                    disabled={busy}
                    className={styles.secondaryButton}
                  >
                    {liveInterrupt.defer_label || liveInterrupt.secondary_label || "Dismiss"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onInterruptSubmit(liveInterrupt.id, values)}
                    disabled={busy}
                    className={styles.primaryButton}
                  >
                    {liveInterrupt.primary_label}
                  </button>
                </div>
              </section>
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
