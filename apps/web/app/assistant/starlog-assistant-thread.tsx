"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantDataUI,
  useAssistantToolUI,
  useComposerRuntime,
} from "@assistant-ui/react";
import { createDynamicUiViewModel } from "@starlog/dynamic-ui";
import type {
  AssistantAmbientUpdate,
  AssistantAttachment,
  AssistantCard,
  AssistantCardAction,
  AssistantEntityRef,
  AssistantInterrupt,
  AssistantInterruptField,
  AssistantThreadSnapshot,
  AssistantToolResult,
} from "@starlog/contracts";

import type { AssistantTodaySummary, AssistantWeeklySummary } from "../components/main-room-thread";
import { DynamicPanelRenderer } from "../components/dynamic-panel-renderer";
import { getConversationCardRegistryEntry } from "../components/conversation-card-registry";
import { useSessionConfig } from "../session-provider";
import { summarizeSupportSurfaces, supportSurfaceActionLabel } from "./support-surfaces";
import styles from "./starlog-assistant-thread.module.css";

type TodayItem = {
  label: string;
  href?: string;
};

export type ComposerDraftSeed = {
  id: number;
  text: string;
};

type StarlogAssistantThreadProps = {
  snapshot: AssistantThreadSnapshot | null;
  loading: boolean;
  busy: boolean;
  todaySummary?: AssistantTodaySummary | null;
  weeklySummary?: AssistantWeeklySummary | null;
  todayOpenLoops?: TodayItem[];
  todayContextItems?: TodayItem[];
  onQuickStart: (prompt: string) => void;
  inlineBusyActionIds: string[];
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
  onInterruptSubmit: (interruptId: string, values: Record<string, unknown>) => Promise<void> | void;
  onInterruptDismiss: (interruptId: string) => Promise<void> | void;
};

type StarlogAssistantComposerProps = {
  draft: ComposerDraftSeed | null;
  threadId: string | null;
  disabled: boolean;
  busy: boolean;
  error: string | null;
  onShortcut: (prompt: string) => void;
};

type DataPartProps<T> = {
  data: T;
};

type ToolPartProps = {
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
};

type DynamicUiAdapterData =
  | { source: "interrupt"; input: AssistantInterrupt }
  | { source: "card"; input: AssistantCard }
  | { source: "tool_result"; input: AssistantToolResult };

type VoiceClip = {
  id: string;
  blob: Blob;
  durationMs: number;
};

const REVIEW_GRADES = [
  { value: "1", label: "Again", hint: "Review soon" },
  { value: "3", label: "Hard", hint: "Keep it close" },
  { value: "4", label: "Good", hint: "Move forward" },
  { value: "5", label: "Easy", hint: "Stretch interval" },
];

type ReviewGradeDraft = {
  selected: string;
  supportAction: string;
};

const reviewGradeDraftValues = new Map<string, ReviewGradeDraft>();

const SHORTCUTS = [
  { label: "Capture", prompt: "Capture " },
  { label: "Plan today", prompt: "Plan today around my schedule, tasks, and open loops." },
  { label: "Process latest capture", prompt: "Process my latest Library captures and route anything actionable." },
  { label: "Start review", prompt: "Start my due review queue." },
  { label: "Create task", prompt: "Create task " },
];

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function productLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  const mapped: Record<string, string> = {
    complete: "Complete",
    completed: "Complete",
    dismissed: "Dismissed",
    error: "Needs attention",
    failed: "Needs attention",
    locked: "Locked",
    ok: "Ready",
    pending: "Waiting",
    queued: "Queued",
    requires_action: "Needs a decision",
    retry: "Retrying",
    running: "Working",
    skipped: "Dismissed",
    submitted: "Saved",
    unlocked: "Ready for review",
  };
  if (mapped[normalized]) {
    return mapped[normalized];
  }
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);
}

function percentageValue(value: unknown): string | null {
  const number = numberValue(value);
  if (number === null) {
    return null;
  }
  const normalized = number <= 1 ? number * 100 : number;
  return `${Math.round(normalized)}% confidence`;
}

function cardMetadataBadges(card: AssistantCard): string[] {
  const metadata = metadataRecord(card.metadata);
  const badges: string[] = [];

  if (card.kind === "review_queue") {
    const dueCount = numberValue(metadata.due_count);
    if (dueCount && dueCount > 0) {
      badges.push(`${dueCount} due now`);
    }
  }

  if (card.kind === "knowledge_note" || card.kind === "memory_suggestion") {
    const version = numberValue(metadata.version);
    if (version && version > 1) {
      badges.push(`v${version}`);
    }
    if (booleanValue(metadata.search_result)) {
      badges.push("Search match");
    }
  }

  if (card.kind === "briefing") {
    if (metadata.audio_ref) {
      badges.push("Audio cached");
    } else if (metadata.briefing_id) {
      badges.push("Thread prompt ready");
    }
    const date = firstText(metadata.date);
    if (date) {
      badges.push(date);
    }
  }

  if (card.kind === "task_list") {
    const taskCount = numberValue(metadata.task_count);
    if (taskCount !== null) {
      badges.push(`${taskCount} task${taskCount === 1 ? "" : "s"}`);
    }
  }

  if (card.kind === "capture_item") {
    const sourceType = firstText(metadata.source_type);
    if (sourceType) {
      badges.push(productLabel(sourceType));
    }
  }

  return badges.slice(0, 3);
}

function fieldOptions(field: AssistantInterruptField | undefined): Array<{ label: string; value: string }> {
  if (field?.options?.length) {
    return field.options;
  }
  return REVIEW_GRADES.map((grade) => ({ label: grade.label, value: grade.value }));
}

function fieldValue(field: AssistantInterruptField | undefined, interrupt: AssistantInterrupt): string {
  if (!field) {
    return "4";
  }
  if (typeof field.value === "string" || typeof field.value === "number") {
    return String(field.value);
  }
  const recommended = interrupt.recommended_defaults?.[field.id];
  if (typeof recommended === "string" || typeof recommended === "number") {
    return String(recommended);
  }
  return "4";
}

function isSupportField(field: AssistantInterruptField): boolean {
  return field.id === "support_action" || /support|help|mode/i.test(field.id);
}

function dynamicUiViewModel(data: DynamicUiAdapterData) {
  if (data.source === "interrupt") {
    return createDynamicUiViewModel("interrupt", data.input);
  }
  if (data.source === "tool_result") {
    return createDynamicUiViewModel("tool_result", data.input);
  }
  return createDynamicUiViewModel("card", data.input);
}

function dynamicUiInput(data: DynamicUiAdapterData): AssistantInterrupt | AssistantCard | AssistantToolResult {
  return data.input;
}

function dynamicUiCard(data: DynamicUiAdapterData): AssistantCard | null {
  if (data.source === "card") {
    return data.input;
  }
  if (data.source === "tool_result") {
    return data.input.card || null;
  }
  return null;
}

function roleLabel(role: string): string {
  if (role === "user") {
    return "You";
  }
  if (role === "assistant") {
    return "Assistant";
  }
  return "Update";
}

function toolLabel(toolName: string): string {
  if (toolName === "grade_review_recall") {
    return "Review grading";
  }
  if (toolName === "resolve_planner_conflict") {
    return "Planner conflict";
  }
  if (toolName === "triage_capture") {
    return "Capture triage";
  }
  if (toolName === "request_due_date") {
    return "Task details";
  }
  if (toolName === "search_planner") {
    return "Checked Planner";
  }
  if (toolName === "search_review") {
    return "Checked Review";
  }
  if (toolName === "create_task") {
    return "Created task";
  }
  return "Assistant check";
}

function EntityLink({ entityRef }: { entityRef?: AssistantEntityRef | null }) {
  if (!entityRef?.href) {
    return null;
  }
  return (
    <a className={styles.entityLink} href={entityRef.href}>
      {supportSurfaceActionLabel(entityRef)}
    </a>
  );
}

function CardDataPart({
  data,
  busy,
  inlineBusyActionIds,
  onCardAction,
}: DataPartProps<AssistantCard> & {
  busy: boolean;
  inlineBusyActionIds: string[];
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
}) {
  const registry = getConversationCardRegistryEntry(data.kind, data.title);
  const badges = cardMetadataBadges(data);

  return (
    <section className={styles.cardPart}>
      <div className={styles.partHeader}>
        <span>{registry.label}</span>
        <EntityLink entityRef={data.entity_ref} />
      </div>
      {data.title ? <h3>{data.title}</h3> : null}
      {data.body ? <p>{data.body}</p> : null}
      {badges.length > 0 ? (
        <div className={styles.badgeRow}>
          {badges.map((badge) => (
            <span key={badge} className={styles.badge}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}
      {data.actions.length > 0 ? (
        <div className={styles.cardActions}>
          {data.actions.map((action) => {
            const actionBusy = inlineBusyActionIds.includes(action.id);
            if (action.kind === "navigate" && typeof action.payload?.href === "string") {
              return (
                <a key={action.id} href={action.payload.href}>
                  {action.label}
                </a>
              );
            }
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => void onCardAction(action)}
                disabled={busy || actionBusy}
              >
                {actionBusy ? `Running ${action.label}` : action.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function AmbientDataPart({
  data,
  busy,
  inlineBusyActionIds,
  onCardAction,
}: DataPartProps<AssistantAmbientUpdate> & {
  busy: boolean;
  inlineBusyActionIds: string[];
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
}) {
  return (
    <section className={styles.ambientRow} aria-label="Ambient update">
      <div className={styles.partHeader}>
        <span>Update</span>
        <EntityLink entityRef={data.entity_ref} />
      </div>
      <h3>{data.label}</h3>
      {data.body ? <p>{data.body}</p> : null}
      {data.actions?.length ? (
        <div className={styles.cardActions}>
          {data.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={busy || inlineBusyActionIds.includes(action.id)}
              onClick={() => void onCardAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ToolResultDataPart({ data }: DataPartProps<AssistantToolResult>) {
  const metadata = metadataRecord(data.metadata);
  const toolName = firstText(metadata.tool_name) || "assistant_check";
  return (
    <section className={styles.toolCard} aria-label="Assistant activity">
      <div className={styles.partHeader}>
        <span>{toolLabel(toolName)}</span>
        <EntityLink entityRef={data.entity_ref} />
      </div>
      <h3>{data.status === "error" ? "Check failed" : "Check complete"}</h3>
      {data.card ? <CardDataPart data={data.card} busy={false} inlineBusyActionIds={[]} onCardAction={() => undefined} /> : null}
    </section>
  );
}

function AttachmentDataPart({ data }: DataPartProps<AssistantAttachment>) {
  const actionLabel =
    data.kind === "audio"
      ? "Open audio"
      : data.kind === "image"
        ? "Open image"
        : data.kind === "citation"
          ? "Open source"
          : "Open attachment";
  return (
    <section className={styles.dataCard}>
      <div className={styles.partHeader}>
        <span>Attachment</span>
        {data.url ? (
          <a className={styles.entityLink} href={data.url}>
            {actionLabel}
          </a>
        ) : null}
      </div>
      <h3>{data.label}</h3>
      <div className={styles.badgeRow}>
        <span className={styles.badge}>{data.kind}</span>
        {data.mime_type ? <span className={styles.badge}>{data.mime_type}</span> : null}
      </div>
    </section>
  );
}

function StatusDataPart({ data }: DataPartProps<{ status?: string; label?: string }>) {
  const status = data.label || (data.status ? productLabel(data.status) : "Working");
  return (
    <section className={styles.dataCard}>
      <div className={styles.partHeader}>
        <span>Status</span>
      </div>
      <p>{status}</p>
    </section>
  );
}

function ResolutionDataPart({ data }: DataPartProps<{ action?: string; values?: Record<string, unknown> }>) {
  const resolution = firstText(data.values?.resolution, data.action) || "Saved";
  return (
    <section className={styles.dataCard}>
      <div className={styles.partHeader}>
        <span>Resolved</span>
      </div>
      <p>{productLabel(resolution)}</p>
    </section>
  );
}

function UnknownDataPart({ name, data }: { name?: string; data?: unknown }) {
  void name;
  void data;
  return null;
}

function ReviewGradeDataPart({
  interrupt,
  busy,
  onSubmit,
  onDismiss,
}: {
  interrupt: AssistantInterrupt;
  busy: boolean;
  onSubmit: (interruptId: string, values: Record<string, unknown>) => Promise<void> | void;
  onDismiss: (interruptId: string) => Promise<void> | void;
}) {
  const viewModel = createDynamicUiViewModel("interrupt", interrupt);
  const metadata = metadataRecord(interrupt.metadata);
  const structuredContent = metadataRecord(viewModel.structuredContent);
  const ratingField =
    interrupt.fields.find((field) => (field.id === "rating" || field.id === "grade") && !isSupportField(field)) ||
    interrupt.fields.find((field) => (field.kind === "select" || field.kind === "priority") && !isSupportField(field));
  const supportField = interrupt.fields.find(isSupportField);
  const options = fieldOptions(ratingField);
  const ratingFieldId = ratingField?.id || "rating";
  const supportFieldId = supportField?.id || null;
  const initialSupportAction = () => {
    const value = supportField ? fieldValue(supportField, interrupt) : "";
    return supportField?.options?.some((option) => option.value === value) ? value : "";
  };
  const initialDraft = (): ReviewGradeDraft =>
    reviewGradeDraftValues.get(interrupt.id) || {
      selected: fieldValue(ratingField, interrupt),
      supportAction: initialSupportAction(),
    };
  const [selected, setSelectedState] = useState(() => initialDraft().selected);
  const [supportAction, setSupportActionState] = useState(() => initialDraft().supportAction);
  const setSelected = (value: string) => {
    reviewGradeDraftValues.set(interrupt.id, { selected: value, supportAction });
    setSelectedState(value);
  };
  const setSupportAction = (action: SetStateAction<string>) => {
    const nextSupportAction = typeof action === "function" ? action(supportAction) : action;
    reviewGradeDraftValues.set(interrupt.id, { selected, supportAction: nextSupportAction });
    setSupportActionState(nextSupportAction);
  };
  const prompt =
    firstText(
      metadata.prompt,
      structuredContent.prompt,
      structuredContent.question,
      metadata.question,
      metadata.review_prompt,
      metadata.interview_question,
      viewModel.title,
      interrupt.entity_ref?.title,
      interrupt.title,
    ) || "Review this interview item";
  const answer = firstText(structuredContent.answer, metadata.answer, metadata.expected_answer, metadata.model_answer, metadata.notes);
  const reason =
    firstText(
      structuredContent.recommendation_reason,
      structuredContent.reason,
      metadata.recommendation_reason,
      metadata.reason,
      metadata.diagnosis,
      metadata.feedback,
      interrupt.consequence_preview,
    ) || "This grade updates the next review interval and keeps the interview loop focused on weak recall.";

  useEffect(() => {
    const nextDraft = initialDraft();
    setSelectedState(nextDraft.selected);
    setSupportActionState(nextDraft.supportAction);
  }, [interrupt.id, ratingFieldId, supportFieldId]);

  const submit = () => {
    const values = interrupt.fields.reduce<Record<string, unknown>>((accumulator, field) => {
      if (field.value !== undefined) {
        accumulator[field.id] = field.value;
      }
      if (interrupt.recommended_defaults && Object.prototype.hasOwnProperty.call(interrupt.recommended_defaults, field.id)) {
        accumulator[field.id] = interrupt.recommended_defaults[field.id];
      }
      return accumulator;
    }, {});
    values[ratingFieldId] = selected;
    if (supportField && supportAction) {
      values[supportField.id] = supportAction;
    }
    void onSubmit(interrupt.id, values);
  };

  if (interrupt.status !== "pending") {
    return (
      <section className={styles.reviewCard}>
        <div className={styles.partHeader}>
          <span>Interview review</span>
          <EntityLink entityRef={interrupt.entity_ref} />
        </div>
        <p>{interrupt.status === "submitted" ? "Grade saved." : "Review skipped."}</p>
      </section>
    );
  }

  return (
    <section className={styles.reviewCard} data-testid="assistant-ui-review-grade" data-dynamic-ui-renderer={viewModel.rendererKey}>
      <div className={styles.partHeader}>
        <span>Interview review</span>
        <EntityLink entityRef={interrupt.entity_ref} />
      </div>
      <div className={styles.reviewPrompt} aria-label="Interview review prompt">
        <p className={styles.eyebrow}>Question</p>
        <h3>{prompt}</h3>
        {answer ? <p>{answer}</p> : null}
      </div>
      <div className={styles.gradeGrid} role="radiogroup" aria-label={ratingField?.label || "Recall quality"}>
        {options.map((option) => {
          const grade = REVIEW_GRADES.find((candidate) => candidate.value === option.value);
          const selectedOption = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selectedOption}
              aria-label={grade?.label || option.label}
              className={`${styles.gradeButton} ${selectedOption ? styles.gradeButtonSelected : ""}`}
              onClick={() => setSelected(option.value)}
            >
              <strong>{grade?.label || option.label}</strong>
              <small>{grade?.hint || "Update the next interval"}</small>
            </button>
          );
        })}
      </div>
      <div className={styles.reasonBox}>
        <span className={styles.eyebrow}>Recommendation reason</span>
        <p>{reason}</p>
      </div>
      {supportField?.options?.length ? (
        <div className={styles.supportActions} aria-label={supportField.label || "Review support"}>
          {supportField.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.supportButton} ${supportAction === option.value ? styles.supportButtonSelected : ""}`}
              aria-pressed={supportAction === option.value}
              onClick={() => setSupportAction((current) => (current === option.value ? "" : option.value))}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void onDismiss(interrupt.id)}>
          {interrupt.secondary_label || interrupt.defer_label || "Not now"}
        </button>
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={submit}>
          {interrupt.primary_label || "Save grade"}
        </button>
      </div>
    </section>
  );
}

function ToolCallPart({ toolName, args, result, isError }: ToolPartProps) {
  void args;
  return (
    <section className={styles.toolCard} aria-label="Assistant activity">
      <div className={styles.partHeader}>
        <span>{toolLabel(toolName)}</span>
      </div>
      <h3>{isError ? "Check needs attention" : result ? "Check complete" : "Checking context"}</h3>
    </section>
  );
}

function ResolvedInterruptDataPart({ interrupt }: { interrupt: AssistantInterrupt }) {
  return (
    <section className={styles.dataCard}>
      <div className={styles.partHeader}>
        <span>Assistant decision</span>
        <EntityLink entityRef={interrupt.entity_ref} />
      </div>
      <p>{interrupt.status === "submitted" ? "Saved." : "Dismissed."}</p>
    </section>
  );
}

function ReviewToolPart(props: ToolPartProps) {
  const args = metadataRecord(props.args);
  const result = metadataRecord(props.result);
  const question = firstText(args.prompt, args.question, args.review_prompt, result.prompt, result.question) || "Interview review";
  const reason =
    firstText(args.recommendation_reason, result.recommendation_reason, result.reason) ||
    "Starlog is preparing the grade UI from the review context.";
  return (
    <section className={styles.reviewCard}>
      <div className={styles.partHeader}>
        <span>Interview review</span>
      </div>
      <div className={styles.reviewPrompt}>
        <h3>{question}</h3>
      </div>
      <div className={styles.reasonBox}>
        <span className={styles.eyebrow}>Recommendation reason</span>
        <p>{reason}</p>
      </div>
    </section>
  );
}

function DynamicUiActionRow({
  card,
  busy,
  inlineBusyActionIds,
  onCardAction,
}: {
  card: AssistantCard | null;
  busy: boolean;
  inlineBusyActionIds: string[];
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
}) {
  if (!card?.actions.length) {
    return null;
  }

  return (
    <div className={styles.cardActions}>
      {card.actions.map((action) => {
        const actionBusy = inlineBusyActionIds.includes(action.id);
        if (action.kind === "navigate" && typeof action.payload?.href === "string") {
          return (
            <a key={action.id} href={action.payload.href}>
              {action.label}
            </a>
          );
        }
        return (
          <button
            key={action.id}
            type="button"
            disabled={busy || actionBusy}
            onClick={() => void onCardAction(action)}
          >
            {actionBusy ? `Running ${action.label}` : action.label}
          </button>
        );
      })}
    </div>
  );
}

function InterviewTopicUnlockDataPart({
  data,
  busy,
  inlineBusyActionIds,
  onCardAction,
}: DataPartProps<DynamicUiAdapterData> & {
  busy: boolean;
  inlineBusyActionIds: string[];
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
}) {
  const viewModel = dynamicUiViewModel(data);
  const input = dynamicUiInput(data);
  const structuredContent = metadataRecord(viewModel.structuredContent);
  const card = dynamicUiCard(data);
  const topicTitle =
    firstText(structuredContent.topic_title, input.entity_ref?.title, viewModel.title, card?.title) || "Topic unlocked";
  const reason =
    firstText(structuredContent.unlock_reason, structuredContent.reason, viewModel.body, card?.body) ||
    "Starlog unlocked this topic from your current learning context.";

  return (
    <section className={styles.dataCard} data-testid="assistant-ui-topic-unlock" data-dynamic-ui-renderer={viewModel.rendererKey}>
      <div className={styles.partHeader}>
        <span>Topic unlock</span>
        <EntityLink entityRef={viewModel.entityRef} />
      </div>
      <h3>{topicTitle}</h3>
      <p>{reason}</p>
      <DynamicUiActionRow card={card} busy={busy} inlineBusyActionIds={inlineBusyActionIds} onCardAction={onCardAction} />
    </section>
  );
}

function InterviewQuestionRequestDataPart({
  data,
  busy,
  onSubmit,
  onDismiss,
}: DataPartProps<DynamicUiAdapterData> & {
  busy: boolean;
  onSubmit: (interruptId: string, values: Record<string, unknown>) => Promise<void> | void;
  onDismiss: (interruptId: string) => Promise<void> | void;
}) {
  if (data.source === "interrupt" && data.input.status === "pending") {
    return <DynamicPanelRenderer interrupt={data.input} busy={busy} onSubmit={onSubmit} onDismiss={onDismiss} />;
  }

  const viewModel = dynamicUiViewModel(data);
  const input = dynamicUiInput(data);
  const structuredContent = metadataRecord(viewModel.structuredContent);
  const prompt =
    firstText(structuredContent.prompt, structuredContent.question, viewModel.body, input.entity_ref?.title, viewModel.title) ||
    "Question ready";
  const topic = firstText(structuredContent.topic_title, input.entity_ref?.title);
  const questionType = firstText(structuredContent.question_type, structuredContent.mode);

  return (
    <section className={styles.dataCard} data-testid="assistant-ui-question-request" data-dynamic-ui-renderer={viewModel.rendererKey}>
      <div className={styles.partHeader}>
        <span>Question request</span>
        <EntityLink entityRef={viewModel.entityRef} />
      </div>
      <h3>{prompt}</h3>
      {topic || questionType ? (
        <div className={styles.badgeRow}>
          {topic ? <span className={styles.badge}>{topic}</span> : null}
          {questionType ? <span className={styles.badge}>{productLabel(questionType)}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function InterviewReviewGradeDataPart({
  data,
  busy,
  onSubmit,
  onDismiss,
}: DataPartProps<DynamicUiAdapterData> & {
  busy: boolean;
  onSubmit: (interruptId: string, values: Record<string, unknown>) => Promise<void> | void;
  onDismiss: (interruptId: string) => Promise<void> | void;
}) {
  if (data.source === "interrupt") {
    return <ReviewGradeDataPart interrupt={data.input} busy={busy} onSubmit={onSubmit} onDismiss={onDismiss} />;
  }

  const viewModel = dynamicUiViewModel(data);
  const structuredContent = metadataRecord(viewModel.structuredContent);
  const grade = firstText(structuredContent.grade, structuredContent.rating, viewModel.status);
  const nextDue = firstText(structuredContent.next_due_at, structuredContent.next_due_label);

  return (
    <section className={styles.reviewCard} data-testid="assistant-ui-review-grade" data-dynamic-ui-renderer={viewModel.rendererKey}>
      <div className={styles.partHeader}>
        <span>Interview review</span>
        <EntityLink entityRef={viewModel.entityRef} />
      </div>
      <div className={styles.reviewPrompt}>
        <h3>{viewModel.title || "Review grade saved"}</h3>
        {viewModel.body ? <p>{viewModel.body}</p> : null}
      </div>
      {grade || nextDue ? (
        <div className={styles.badgeRow}>
          {grade ? <span className={styles.badge}>{productLabel(grade)}</span> : null}
          {nextDue ? <span className={styles.badge}>{nextDue}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function InterviewRecommendationReasonDataPart({
  data,
  busy,
  inlineBusyActionIds,
  onCardAction,
}: DataPartProps<DynamicUiAdapterData> & {
  busy: boolean;
  inlineBusyActionIds: string[];
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
}) {
  const viewModel = dynamicUiViewModel(data);
  const input = dynamicUiInput(data);
  const structuredContent = metadataRecord(viewModel.structuredContent);
  const card = dynamicUiCard(data);
  const reason =
    firstText(
      structuredContent.reason,
      structuredContent.recommendation_reason,
      viewModel.body,
      card?.metadata.recommendation_reason,
      input.metadata.recommendation_reason,
    ) || "Starlog has enough signal to recommend this next review move.";
  const evidence = stringList(structuredContent.evidence);
  const confidence = percentageValue(structuredContent.confidence);

  return (
    <section
      className={styles.dataCard}
      data-testid="assistant-ui-recommendation-reason"
      data-dynamic-ui-renderer={viewModel.rendererKey}
    >
      <div className={styles.partHeader}>
        <span>Recommendation reason</span>
        <EntityLink entityRef={viewModel.entityRef} />
      </div>
      <h3>{viewModel.title || "Why this is next"}</h3>
      <p>{reason}</p>
      {evidence.length > 0 || confidence ? (
        <div className={styles.badgeRow}>
          {evidence.map((item) => (
            <span key={item} className={styles.badge}>
              {item}
            </span>
          ))}
          {confidence ? <span className={styles.badge}>{confidence}</span> : null}
        </div>
      ) : null}
      <DynamicUiActionRow card={card} busy={busy} inlineBusyActionIds={inlineBusyActionIds} onCardAction={onCardAction} />
    </section>
  );
}

function useStarlogAssistantUiRegistration({
  interruptById,
  busy,
  inlineBusyActionIds,
  onCardAction,
  onInterruptSubmit,
  onInterruptDismiss,
}: {
  interruptById: Record<string, AssistantInterrupt>;
  busy: boolean;
  inlineBusyActionIds: string[];
  onCardAction: (action: AssistantCardAction) => Promise<void> | void;
  onInterruptSubmit: (interruptId: string, values: Record<string, unknown>) => Promise<void> | void;
  onInterruptDismiss: (interruptId: string) => Promise<void> | void;
}) {
  const InterruptRenderer = useMemo(
    () =>
      function InterruptRenderer({ data }: DataPartProps<AssistantInterrupt>) {
        const liveInterrupt = interruptById[data.id] || data;
        if (liveInterrupt.status !== "pending") {
          return <ResolvedInterruptDataPart interrupt={liveInterrupt} />;
        }
        return (
          <DynamicPanelRenderer
            interrupt={liveInterrupt}
            busy={busy}
            onSubmit={onInterruptSubmit}
            onDismiss={onInterruptDismiss}
          />
        );
      },
    [busy, interruptById, onInterruptDismiss, onInterruptSubmit],
  );

  const CardRenderer = useMemo(
    () =>
      function CardRenderer({ data }: DataPartProps<AssistantCard>) {
        return (
          <CardDataPart
            data={data}
            busy={busy}
            inlineBusyActionIds={inlineBusyActionIds}
            onCardAction={onCardAction}
          />
        );
      },
    [busy, inlineBusyActionIds, onCardAction],
  );

  const AmbientRenderer = useMemo(
    () =>
      function AmbientRenderer({ data }: DataPartProps<AssistantAmbientUpdate>) {
        return (
          <AmbientDataPart
            data={data}
            busy={busy}
            inlineBusyActionIds={inlineBusyActionIds}
            onCardAction={onCardAction}
          />
        );
      },
    [busy, inlineBusyActionIds, onCardAction],
  );

  const TopicUnlockRenderer = useMemo(
    () =>
      function TopicUnlockRenderer({ data }: DataPartProps<DynamicUiAdapterData>) {
        return (
          <InterviewTopicUnlockDataPart
            data={data}
            busy={busy}
            inlineBusyActionIds={inlineBusyActionIds}
            onCardAction={onCardAction}
          />
        );
      },
    [busy, inlineBusyActionIds, onCardAction],
  );

  const QuestionRequestRenderer = useMemo(
    () =>
      function QuestionRequestRenderer({ data }: DataPartProps<DynamicUiAdapterData>) {
        return (
          <InterviewQuestionRequestDataPart
            data={data}
            busy={busy}
            onSubmit={onInterruptSubmit}
            onDismiss={onInterruptDismiss}
          />
        );
      },
    [busy, onInterruptDismiss, onInterruptSubmit],
  );

  const ReviewGradeRenderer = useMemo(
    () =>
      function ReviewGradeRenderer({ data }: DataPartProps<DynamicUiAdapterData>) {
        return (
          <InterviewReviewGradeDataPart
            data={data}
            busy={busy}
            onSubmit={onInterruptSubmit}
            onDismiss={onInterruptDismiss}
          />
        );
      },
    [busy, onInterruptDismiss, onInterruptSubmit],
  );

  const RecommendationReasonRenderer = useMemo(
    () =>
      function RecommendationReasonRenderer({ data }: DataPartProps<DynamicUiAdapterData>) {
        return (
          <InterviewRecommendationReasonDataPart
            data={data}
            busy={busy}
            inlineBusyActionIds={inlineBusyActionIds}
            onCardAction={onCardAction}
          />
        );
      },
    [busy, inlineBusyActionIds, onCardAction],
  );

  useAssistantDataUI({ name: "interview.topic_unlock", render: TopicUnlockRenderer });
  useAssistantDataUI({ name: "interview.question_request", render: QuestionRequestRenderer });
  useAssistantDataUI({ name: "interview.review_grade", render: ReviewGradeRenderer });
  useAssistantDataUI({ name: "interview.recommendation_reason", render: RecommendationReasonRenderer });
  useAssistantDataUI({ name: "starlog-interrupt-request", render: InterruptRenderer });
  useAssistantDataUI({ name: "starlog-card", render: CardRenderer });
  useAssistantDataUI({ name: "starlog-ambient-update", render: AmbientRenderer });
  useAssistantDataUI({ name: "starlog-tool-result", render: ToolResultDataPart });
  useAssistantDataUI({ name: "starlog-attachment", render: AttachmentDataPart });
  useAssistantDataUI({ name: "starlog-status", render: StatusDataPart });
  useAssistantDataUI({ name: "starlog-interrupt-resolution", render: ResolutionDataPart });
  useAssistantToolUI({ toolName: "grade_review_recall", render: ReviewToolPart });
}

function SupportSurfaceSummary({
  snapshot,
  onQuickStart,
}: {
  snapshot: AssistantThreadSnapshot | null;
  onQuickStart: (prompt: string) => void;
}) {
  const surfaces = useMemo(
    () => summarizeSupportSurfaces(snapshot, null).filter((surface) => surface.active),
    [snapshot],
  );

  if (surfaces.length === 0) {
    return null;
  }

  return (
    <section className={styles.supportSurfaces} aria-label="Assistant support surfaces">
      {surfaces.map((surface) => (
        <article key={surface.key} className={styles.supportSurface}>
          <div>
            <h3>{surface.title}</h3>
            <p>{surface.summary}</p>
          </div>
          <div className={styles.supportSurfaceActions}>
            <a href={surface.href}>Open {surface.title}</a>
            {surface.key === "review" ? (
              <button type="button" onClick={() => onQuickStart("Start my due review queue.")}>
                Start review
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}

function pendingStartPrompt(interrupt: AssistantInterrupt): string {
  if (interrupt.tool_name === "triage_capture") {
    return "Process latest capture";
  }
  if (interrupt.tool_name === "request_due_date") {
    return "Finish task details";
  }
  if (interrupt.tool_name === "choose_morning_focus") {
    return "Pick my morning focus";
  }
  if (interrupt.tool_name === "resolve_planner_conflict") {
    return "Resolve the planner conflict";
  }
  if (interrupt.tool_name === "grade_review_recall") {
    return "Start review";
  }
  return interrupt.title;
}

function uniqueStartActions(actions: Array<{ label: string; prompt: string }>): Array<{ label: string; prompt: string }> {
  const seen = new Set<string>();
  const out: Array<{ label: string; prompt: string }> = [];
  for (const action of actions) {
    const label = action.label.trim();
    const prompt = action.prompt.trim();
    if (!label || !prompt || seen.has(label)) {
      continue;
    }
    seen.add(label);
    out.push({ label, prompt });
    if (out.length >= 4) {
      break;
    }
  }
  return out;
}

function AssistantThreadStart({
  snapshot,
  todaySummary,
  todayOpenLoops,
  todayContextItems,
  busy,
  onQuickStart,
}: {
  snapshot: AssistantThreadSnapshot;
  todaySummary?: AssistantTodaySummary | null;
  todayOpenLoops?: TodayItem[];
  todayContextItems?: TodayItem[];
  busy: boolean;
  onQuickStart: (prompt: string) => void;
}) {
  const pendingInterrupt = snapshot.interrupts.find((interrupt) => interrupt.status === "pending");
  const recommendedMove = todaySummary?.recommended_next_move || null;
  const title = pendingInterrupt?.title || recommendedMove?.title || "What should we work on?";
  const body =
    pendingInterrupt?.body ||
    recommendedMove?.body ||
    "Use this thread for capture, planning, review, and follow-through. Context stays nearby without taking over the conversation.";
  const actions = uniqueStartActions([
    ...(pendingInterrupt ? [{ label: pendingStartPrompt(pendingInterrupt), prompt: pendingStartPrompt(pendingInterrupt) }] : []),
    ...(recommendedMove?.prompt
      ? [{ label: recommendedMove.action_label || "Start", prompt: recommendedMove.prompt }]
      : []),
    { label: "Plan today", prompt: "Plan today around my schedule, tasks, and open loops." },
    { label: "Process latest capture", prompt: "Process my latest Library captures and route anything actionable." },
    { label: "Start review", prompt: "Start my due review queue." },
  ]);
  const contextItems = [...(todayOpenLoops || []), ...(todayContextItems || [])]
    .filter((item) => item.label !== "No open loops in this thread")
    .slice(0, 4);

  return (
    <section className={styles.threadStart} aria-label="Assistant thread start">
      <div className={styles.startCopy}>
        <p className={styles.eyebrow}>Assistant</p>
        <h2>What should we work on?</h2>
        <p>Talk naturally. Starlog will keep the thread centered and surface decisions only when they need action.</p>
      </div>
      <article className={styles.startSuggestion} aria-label="Suggested next prompt">
        <span>{pendingInterrupt ? "Needs attention" : recommendedMove ? "Suggested" : "Ready"}</span>
        <strong>{title}</strong>
        <p>{body}</p>
      </article>
      <div className={styles.startActions} aria-label="Suggested prompts">
        {actions.map((action) => (
          <button key={action.label} type="button" disabled={busy} onClick={() => onQuickStart(action.prompt)}>
            {action.label}
          </button>
        ))}
      </div>
      {contextItems.length > 0 ? (
        <div className={styles.startContext} aria-label="Thread context">
          {contextItems.map((item, index) =>
            item.href ? (
              <a key={`${item.label}-${index}`} href={item.href}>
                {item.label}
              </a>
            ) : (
              <span key={`${item.label}-${index}`}>{item.label}</span>
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

function StarlogTextPart({ text }: { text: string }) {
  return <p className={styles.textPart}>{text}</p>;
}

function StarlogMessage({ message }: { message: { role: string; createdAt: Date } }) {
  return (
    <MessagePrimitive.Root className={`${styles.message} ${styles[`message_${message.role}`] || ""}`}>
      <div className={styles.meta}>
        <span>{roleLabel(message.role)}</span>
        <span>{message.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className={styles.bubble}>
        <MessagePrimitive.Content
          components={{
            Text: StarlogTextPart,
            tools: { Fallback: ToolCallPart },
            data: { Fallback: UnknownDataPart },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function ComposerDraftController({ draft }: { draft: ComposerDraftSeed | null }) {
  const runtime = useComposerRuntime({ optional: true });

  useEffect(() => {
    if (!draft || !runtime) {
      return;
    }
    runtime.setText(draft.text);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("[data-starlog-composer-input='true']")?.focus();
    });
  }, [draft, runtime]);

  return null;
}

export function StarlogAssistantComposer({ draft, threadId, disabled, busy, error, onShortcut }: StarlogAssistantComposerProps) {
  const { apiBase, token } = useSessionConfig();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number>(0);
  const uploadInFlightRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [voiceClip, setVoiceClip] = useState<VoiceClip | null>(null);
  const [voiceQueue, setVoiceQueue] = useState<VoiceClip[]>([]);
  const [voiceStatus, setVoiceStatus] = useState("Hold to talk when voice is easier.");
  const [uploadedJobIds, setUploadedJobIds] = useState<string[]>([]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const uploadVoiceQueue = useCallback(async (clips: VoiceClip[]) => {
    if (uploadInFlightRef.current || clips.length === 0 || !navigator.onLine || !threadId || !token) {
      return;
    }

    uploadInFlightRef.current = true;
    const uploadedIds: string[] = [];
    const uploadedClipIds: string[] = [];
    const remainingIds: string[] = [];

    for (const clip of clips) {
      try {
        const formData = new FormData();
        formData.append("title", "Web voice command");
        formData.append("duration_ms", String(clip.durationMs));
        formData.append("execute", "true");
        formData.append("device_target", "web-desktop");
        formData.append("provider_hint", "whisper_local");
        formData.append("file", clip.blob, `voice-command-${clip.id}.webm`);

        const response = await fetch(
          `${apiBase.replace(/\/$/, "")}/v1/assistant/threads/${encodeURIComponent(threadId)}/voice`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          },
        );
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as { id?: string };
        uploadedClipIds.push(clip.id);
        if (payload.id) {
          uploadedIds.push(payload.id);
        }
      } catch {
        remainingIds.push(clip.id);
      }
    }

    if (uploadedClipIds.length > 0) {
      const uploadedClipIdSet = new Set(uploadedClipIds);
      setVoiceQueue((current) => current.filter((clip) => !uploadedClipIdSet.has(clip.id)));
    }
    if (uploadedIds.length > 0) {
      setUploadedJobIds((current) => [...uploadedIds, ...current].slice(0, 5));
      setVoiceStatus(`Uploaded ${uploadedIds.length} queued voice command(s).`);
    } else if (remainingIds.length > 0) {
      setVoiceStatus("Voice upload paused; queued for retry.");
    }
    uploadInFlightRef.current = false;
  }, [apiBase, threadId, token]);

  useEffect(() => {
    const onOnline = () => {
      void uploadVoiceQueue(voiceQueue);
    };
    window.addEventListener("online", onOnline);
    if (navigator.onLine) {
      void uploadVoiceQueue(voiceQueue);
    }
    return () => window.removeEventListener("online", onOnline);
  }, [uploadVoiceQueue, voiceQueue]);

  useEffect(() => {
    return () => {
      recorderRef.current = null;
      stopStream();
    };
  }, [stopStream]);

  const beginVoiceCapture = useCallback(async () => {
    if (disabled || busy || recording) {
      return;
    }
    stopRequestedRef.current = false;
    try {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        stopRequestedRef.current = false;
        setVoiceStatus("Voice capture is unavailable in this browser.");
        return;
      }
      const stream = await mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const durationMs = Math.max(1, Date.now() - recordingStartedAtRef.current);
        setRecording(false);
        stopStream();
        if (blob.size === 0) {
          setVoiceStatus("Voice capture was empty.");
          return;
        }
        setVoiceClip({ id: String(Date.now()), blob, durationMs });
        setVoiceStatus("Voice clip captured and ready for upload.");
      };
      recorder.start();
      setRecording(true);
      setVoiceStatus("Recording voice command...");
      if (stopRequestedRef.current) {
        recorder.stop();
        recorderRef.current = null;
      }
    } catch {
      stopRequestedRef.current = false;
      setRecording(false);
      stopStream();
      setVoiceStatus("Voice capture could not start.");
    }
  }, [busy, disabled, recording, stopStream]);

  const endVoiceCapture = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || !recording) {
      stopRequestedRef.current = true;
      return;
    }
    stopRequestedRef.current = false;
    recorder.stop();
    recorderRef.current = null;
  }, [recording]);

  const planVoiceClip = useCallback(() => {
    if (!voiceClip) {
      return;
    }
    setVoiceQueue((current) => [voiceClip, ...current]);
    setVoiceClip(null);
    setVoiceStatus("Voice command ready to upload");
  }, [voiceClip]);

  return (
    <ComposerPrimitive.Root className={styles.composer}>
      <ComposerDraftController draft={draft} />
      <div className={styles.composerChips} aria-label="Assistant shortcuts">
        {SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.label}
            type="button"
            onClick={() => onShortcut(shortcut.prompt)}
            disabled={disabled || busy}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
      <div className={styles.voiceDock}>
        <button
          type="button"
          className={`${styles.voiceButton} ${recording ? styles.voiceButtonRecording : ""}`}
          data-testid="assistant-voice-control"
          disabled={disabled || busy}
          onPointerDown={() => void beginVoiceCapture()}
          onPointerUp={endVoiceCapture}
          onPointerCancel={endVoiceCapture}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              void beginVoiceCapture();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              endVoiceCapture();
            }
          }}
        >
          <span className={styles.voiceButtonLabel}>{recording ? "Listening" : "Hold to talk"}</span>
          <span className={styles.voiceButtonMeta}>Upload queue {voiceQueue.length}</span>
        </button>
        <div className={styles.voiceStatus} aria-live="polite">
          <span>{voiceStatus}</span>
          {uploadedJobIds.length > 0 ? <small>{uploadedJobIds.join(", ")}</small> : null}
        </div>
        <button type="button" className={styles.planVoiceButton} disabled={!voiceClip || disabled || busy} onClick={planVoiceClip}>
          Plan voice
        </button>
      </div>
      <ComposerPrimitive.Input
        className={styles.composerInput}
        data-starlog-composer-input="true"
        placeholder="Ask, capture, plan, review, or move something forward..."
        rows={4}
        disabled={disabled || busy}
      />
      <div className={styles.composerBar}>
        <span>{error || (busy ? "Starlog is working..." : "Message, capture, plan, or review from this thread.")}</span>
        <ComposerPrimitive.Send disabled={disabled || busy}>Send</ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

export function StarlogAssistantThread({
  snapshot,
  loading,
  busy,
  todaySummary,
  todayOpenLoops,
  todayContextItems,
  onQuickStart,
  inlineBusyActionIds,
  onCardAction,
  onInterruptSubmit,
  onInterruptDismiss,
}: StarlogAssistantThreadProps) {
  const interruptById = useMemo(
    () => Object.fromEntries((snapshot?.interrupts || []).map((interrupt) => [interrupt.id, interrupt])),
    [snapshot?.interrupts],
  );

  useStarlogAssistantUiRegistration({
    interruptById,
    busy,
    inlineBusyActionIds,
    onCardAction,
    onInterruptSubmit,
    onInterruptDismiss,
  });

  if (loading && !snapshot) {
    return <section className={styles.threadShell}>Loading assistant thread...</section>;
  }

  if (!snapshot) {
    return <section className={styles.threadShell}>Assistant thread unavailable.</section>;
  }

  if (snapshot.messages.length === 0) {
    return (
      <section className={styles.threadShell}>
        <AssistantThreadStart
          snapshot={snapshot}
          todaySummary={todaySummary}
          todayOpenLoops={todayOpenLoops}
          todayContextItems={todayContextItems}
          busy={busy}
          onQuickStart={onQuickStart}
        />
      </section>
    );
  }

  return (
    <section className={styles.threadShell}>
      <SupportSurfaceSummary snapshot={snapshot} onQuickStart={onQuickStart} />
      <ThreadPrimitive.Root className={styles.primitiveRoot}>
        <ThreadPrimitive.Viewport className={styles.viewport}>
          <ThreadPrimitive.Messages>
            {({ message }) => <StarlogMessage message={{ role: message.role, createdAt: message.createdAt }} />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </section>
  );
}
