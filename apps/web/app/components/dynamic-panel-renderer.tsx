"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AssistantEntityRef, AssistantInterrupt, AssistantInterruptField } from "@starlog/contracts";

import { supportSurfaceActionLabel } from "../assistant/support-surfaces";
import styles from "./dynamic-panel-renderer.module.css";

type DynamicPanelRendererProps = {
  interrupt: AssistantInterrupt;
  busy: boolean;
  onSubmit: (interruptId: string, values: Record<string, unknown>) => Promise<void> | void;
  onDismiss: (interruptId: string) => Promise<void> | void;
};

type PanelTone = "task" | "capture" | "planner" | "review" | "focus" | "default";
type SetValues = Dispatch<SetStateAction<Record<string, unknown>>>;

const REVIEW_VALUES: Record<string, { label: string; hint: string }> = {
  "1": { label: "Again", hint: "Review soon" },
  "3": { label: "Hard", hint: "Keep it close" },
  "4": { label: "Good", hint: "Move forward" },
  "5": { label: "Easy", hint: "Stretch interval" },
};

function valueForField(field: AssistantInterruptField, interrupt: AssistantInterrupt): unknown {
  if (field.value !== undefined) {
    return field.value;
  }
  if (interrupt.recommended_defaults && Object.prototype.hasOwnProperty.call(interrupt.recommended_defaults, field.id)) {
    return interrupt.recommended_defaults[field.id];
  }
  if (field.kind === "toggle") {
    return false;
  }
  return "";
}

function initialValues(interrupt: AssistantInterrupt): Record<string, unknown> {
  return interrupt.fields.reduce<Record<string, unknown>>((accumulator, field) => {
    accumulator[field.id] = valueForField(field, interrupt);
    return accumulator;
  }, {});
}

function domIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function priorityOptions(field: AssistantInterruptField): Array<{ label: string; value: string }> {
  const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 1;
  const max = Number.isFinite(Number(field.max)) ? Number(field.max) : 5;
  const start = Math.max(1, Math.min(min, max));
  const end = Math.max(start, max);
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const priority = start + index;
    return { label: `Priority ${priority}`, value: String(priority) };
  });
}

function fieldOptions(field: AssistantInterruptField): Array<{ label: string; value: string }> {
  if (field.options && field.options.length > 0) {
    return field.options;
  }
  if (field.kind === "priority") {
    return priorityOptions(field);
  }
  return [];
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function metadataString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstMetadataString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function isTaskDetailPanel(interrupt: AssistantInterrupt): boolean {
  return interrupt.tool_name === "request_due_date" || /missing.*(task|detail)|task.*missing/i.test(interrupt.tool_name);
}

function isCaptureTriagePanel(interrupt: AssistantInterrupt): boolean {
  return interrupt.tool_name === "triage_capture" || /capture.*(triage|enrich|summar)/i.test(interrupt.tool_name);
}

function optionDescription(interrupt: AssistantInterrupt, field: AssistantInterruptField, option: { label: string; value: string }): string | null {
  const fieldDescriptions = metadataRecord(field.metadata?.option_descriptions);
  const interruptDescriptions = metadataRecord(interrupt.metadata?.option_descriptions);
  const direct =
    fieldDescriptions[option.value] ||
    interruptDescriptions[option.value] ||
    fieldDescriptions[option.label] ||
    interruptDescriptions[option.label];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  if (interrupt.tool_name === "resolve_planner_conflict") {
    if (option.value.includes("move") || /move/i.test(option.label)) {
      return "Recommended - preserves your longer focus block.";
    }
    if (option.value.includes("shorten") || /shorten/i.test(option.label)) {
      return "Keep both, but reduce protected time.";
    }
    if (option.value.includes("keep") || /keep/i.test(option.label)) {
      return "Mark deep work flexible and decide later.";
    }
  }
  if (isTaskDetailPanel(interrupt)) {
    if (option.value === "1" || /high/i.test(option.label)) {
      return "Do this before lower-priority tasks.";
    }
    if (option.value === "3" || /medium/i.test(option.label)) {
      return "Keep it visible without taking over today.";
    }
    if (option.value === "5" || /low/i.test(option.label)) {
      return "Track it without protecting time yet.";
    }
  }
  if (isCaptureTriagePanel(interrupt)) {
    if (/reference|source/i.test(option.label) || option.value.includes("reference")) {
      return "Keep source context for later lookup.";
    }
    if (/idea|fleeting/i.test(option.label) || option.value.includes("idea")) {
      return "Save as a thought to develop.";
    }
    if (/task|action/i.test(option.label) || option.value.includes("task")) {
      return "Route it toward Planner.";
    }
    if (/review/i.test(option.label) || option.value.includes("review")) {
      return "Use it for recall or practice.";
    }
    if (/project/i.test(option.label) || option.value.includes("project")) {
      return "Attach it to active work.";
    }
  }
  return null;
}

function panelTone(interrupt: AssistantInterrupt): PanelTone {
  if (isTaskDetailPanel(interrupt)) {
    return "task";
  }
  if (isCaptureTriagePanel(interrupt)) {
    return "capture";
  }
  if (interrupt.tool_name === "resolve_planner_conflict") {
    return "planner";
  }
  if (interrupt.tool_name === "grade_review_recall") {
    return "review";
  }
  if (interrupt.tool_name === "choose_morning_focus") {
    return "focus";
  }
  return "default";
}

function panelLabel(interrupt: AssistantInterrupt): string {
  if (isTaskDetailPanel(interrupt)) {
    return "Task setup";
  }
  if (isCaptureTriagePanel(interrupt)) {
    return "Capture triage";
  }
  if (interrupt.tool_name === "resolve_planner_conflict") {
    return "Planner conflict";
  }
  if (interrupt.tool_name === "grade_review_recall") {
    return "Review grade";
  }
  if (interrupt.tool_name === "choose_morning_focus") {
    return "Morning focus";
  }
  if (interrupt.interrupt_type === "confirm") {
    return "Confirm";
  }
  if (interrupt.interrupt_type === "choice") {
    return "Choose";
  }
  return "Decision";
}

function displayModeLabel(interrupt: AssistantInterrupt): string | null {
  if (!interrupt.display_mode) {
    return null;
  }
  if (interrupt.display_mode === "bottom_sheet") {
    return "Bottom sheet";
  }
  return interrupt.display_mode.charAt(0).toUpperCase() + interrupt.display_mode.slice(1);
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

function todayIso(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function setFieldValue(
  setValues: SetValues,
  fieldId: string,
  value: unknown,
) {
  setValues((current) => ({ ...current, [fieldId]: value }));
}

function OptionCards({
  interrupt,
  field,
  values,
  setValues,
  variant,
}: {
  interrupt: AssistantInterrupt;
  field: AssistantInterruptField;
  values: Record<string, unknown>;
  setValues: SetValues;
  variant: PanelTone;
}) {
  const current = String(values[field.id] ?? "");
  const options = fieldOptions(field);
  if (options.length === 0) {
    return null;
  }

  return (
    <div className={styles.optionGrid} role="radiogroup" aria-label={field.label}>
      {options.map((option) => {
        const selected = current === option.value;
        const review = variant === "review" ? REVIEW_VALUES[option.value] : null;
        const description = optionDescription(interrupt, field, option);
        return (
          <button
            key={`${field.id}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={review?.label || option.label}
            className={`${styles.optionCard} ${selected ? styles.optionCardSelected : ""}`}
            onClick={() => setFieldValue(setValues, field.id, option.value)}
          >
            <span>{review?.label || option.label}</span>
            {review?.hint ? <small>{review.hint}</small> : null}
            {variant === "focus" ? <small>Protect the first useful block.</small> : null}
            {description ? <small>{description}</small> : null}
          </button>
        );
      })}
    </div>
  );
}

function DateField({
  field,
  values,
  setValues,
  controlId,
}: {
  field: AssistantInterruptField;
  values: Record<string, unknown>;
  setValues: SetValues;
  controlId: string;
}) {
  const value = values[field.id];
  const stringValue = typeof value === "string" ? value : "";

  return (
    <div className={styles.dateField}>
      <div className={styles.quickDates}>
        <button type="button" onClick={() => setFieldValue(setValues, field.id, todayIso(0))}>
          Today
        </button>
        <button type="button" onClick={() => setFieldValue(setValues, field.id, todayIso(1))}>
          Tomorrow
        </button>
      </div>
      <input
        id={controlId}
        type="date"
        value={stringValue}
        onChange={(event) => setFieldValue(setValues, field.id, event.target.value)}
      />
    </div>
  );
}

function FieldControl({
  interrupt,
  field,
  values,
  setValues,
  variant,
  controlId,
}: {
  interrupt: AssistantInterrupt;
  field: AssistantInterruptField;
  values: Record<string, unknown>;
  setValues: SetValues;
  variant: PanelTone;
  controlId: string;
}) {
  const value = values[field.id] ?? "";
  const stringValue = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const useOptionCards =
    (field.kind === "select" || field.kind === "priority") &&
    (variant === "focus" ||
      variant === "planner" ||
      variant === "review" ||
      isTaskDetailPanel(interrupt) ||
      isCaptureTriagePanel(interrupt) ||
      field.options?.length === 2);

  if (useOptionCards) {
    return <OptionCards interrupt={interrupt} field={field} values={values} setValues={setValues} variant={variant} />;
  }

  if (field.kind === "date") {
    return <DateField field={field} values={values} setValues={setValues} controlId={controlId} />;
  }

  if (field.kind === "time") {
    return (
      <input
        id={controlId}
        type="time"
        value={stringValue}
        onChange={(event) => setFieldValue(setValues, field.id, event.target.value)}
      />
    );
  }

  if (field.kind === "datetime") {
    return (
      <input
        id={controlId}
        type="datetime-local"
        value={stringValue}
        onChange={(event) => setFieldValue(setValues, field.id, event.target.value)}
      />
    );
  }

  if (field.kind === "toggle") {
    return (
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => setFieldValue(setValues, field.id, event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.kind === "select" || field.kind === "priority") {
    const options = fieldOptions(field);

    return (
      <select id={controlId} value={stringValue} onChange={(event) => setFieldValue(setValues, field.id, event.target.value)}>
        {!field.required ? <option value="">Choose</option> : null}
        {options.map((option) => (
          <option key={`${field.id}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === "textarea") {
    return (
      <textarea
        id={controlId}
        rows={4}
        value={stringValue}
        placeholder={field.placeholder || ""}
        onChange={(event) => setFieldValue(setValues, field.id, event.target.value)}
      />
    );
  }

  return (
    <input
      id={controlId}
      type="text"
      value={stringValue}
      placeholder={field.placeholder || ""}
      onChange={(event) => setFieldValue(setValues, field.id, event.target.value)}
    />
  );
}

function FieldRow({
  interrupt,
  field,
  values,
  setValues,
  variant,
  interruptId,
}: {
  interrupt: AssistantInterrupt;
  field: AssistantInterruptField;
  values: Record<string, unknown>;
  setValues: SetValues;
  variant: PanelTone;
  interruptId: string;
}) {
  const controlId = `dynamic-panel-${domIdSegment(interruptId)}-${domIdSegment(field.id)}`;
  if (field.kind === "toggle") {
    return <FieldControl interrupt={interrupt} field={field} values={values} setValues={setValues} variant={variant} controlId={controlId} />;
  }

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={controlId}>
        {field.label}
      </label>
      <FieldControl interrupt={interrupt} field={field} values={values} setValues={setValues} variant={variant} controlId={controlId} />
    </div>
  );
}

function RecommendedDefaults({ interrupt }: { interrupt: AssistantInterrupt }) {
  const defaults = Object.entries(interrupt.recommended_defaults || {}).filter((entry) => entry[1] !== undefined && entry[1] !== null);
  if (defaults.length === 0) {
    return null;
  }

  return (
    <div className={styles.defaults} aria-label="Recommended defaults">
      {defaults.map(([key, value]) => (
        <span key={key}>
          {key.replace(/_/g, " ")}: {typeof value === "boolean" ? (value ? "yes" : "no") : String(value)}
        </span>
      ))}
    </div>
  );
}

function TaskDetailPreview({ interrupt }: { interrupt: AssistantInterrupt }) {
  if (!isTaskDetailPanel(interrupt)) {
    return null;
  }
  const task = metadataRecord(interrupt.metadata?.task);
  const draft = metadataRecord(interrupt.metadata?.task_draft);
  const argumentsRecord = metadataRecord(interrupt.metadata?.arguments);
  const title =
    firstMetadataString(
      interrupt.entity_ref?.title,
      interrupt.metadata?.task_title,
      task.title,
      draft.title,
      argumentsRecord.task_title,
      interrupt.title,
    ) || "New task";
  const detail = firstMetadataString(interrupt.metadata?.task_detail, task.detail, draft.detail, draft.body, interrupt.body);

  return (
    <div className={styles.itemPreview} aria-label="Task preview">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function CaptureTriagePreview({ interrupt }: { interrupt: AssistantInterrupt }) {
  if (!isCaptureTriagePanel(interrupt)) {
    return null;
  }
  const capture = metadataRecord(interrupt.metadata?.capture);
  const artifact = metadataRecord(interrupt.metadata?.artifact);
  const source = metadataRecord(interrupt.metadata?.source);
  const argumentsRecord = metadataRecord(interrupt.metadata?.arguments);
  const title =
    firstMetadataString(
      interrupt.entity_ref?.title,
      interrupt.metadata?.capture_title,
      capture.title,
      artifact.title,
      argumentsRecord.title,
      interrupt.title,
    ) || "New capture";
  const snippet = firstMetadataString(
    interrupt.metadata?.snippet,
    interrupt.metadata?.capture_snippet,
    capture.snippet,
    capture.preview,
    artifact.snippet,
    artifact.preview,
    argumentsRecord.snippet,
    interrupt.body,
  );
  const sourceLabel = firstMetadataString(
    interrupt.metadata?.source_label,
    interrupt.metadata?.capture_source,
    source.label,
    source.title,
    capture.source_label,
    capture.source_type,
    artifact.source_label,
  );
  const capturedAtLabel = firstMetadataString(
    interrupt.metadata?.captured_at_label,
    capture.captured_at_label,
    artifact.captured_at_label,
    capture.captured_at,
    artifact.created_at,
  );

  return (
    <div className={styles.itemPreview} aria-label="Capture preview">
      <strong>{title}</strong>
      {snippet ? <span>{snippet}</span> : null}
      {sourceLabel || capturedAtLabel ? <small>{[sourceLabel, capturedAtLabel].filter(Boolean).join(" · ")}</small> : null}
    </div>
  );
}

function PlannerConflictPreview({ interrupt }: { interrupt: AssistantInterrupt }) {
  if (interrupt.tool_name !== "resolve_planner_conflict") {
    return null;
  }
  const payload = metadataRecord(interrupt.metadata?.conflict_payload);
  const detail = metadataRecord(payload.detail);
  const localTitle = metadataString(payload.local_title) || metadataString(payload.block_title) || metadataString(detail.local_title) || "Starlog focus block";
  const localTime =
    metadataString(payload.local_time_label) ||
    metadataString(payload.local_time) ||
    [metadataString(payload.local_start_label), metadataString(payload.local_end_label)].filter(Boolean).join(" - ") ||
    metadataString(detail.local_time_label) ||
    null;
  const conflictTitle = metadataString(payload.conflict_label) || metadataString(payload.overlap_label) || "Conflict";
  const overlapTime =
    metadataString(payload.overlap_time_label) ||
    metadataString(payload.conflict_time_label) ||
    metadataString(detail.overlap_time_label) ||
    metadataString(detail.conflict_time_label) ||
    null;
  const remoteTitle = metadataString(payload.remote_title) || metadataString(payload.title) || metadataString(detail.remote_title) || "Calendar event";
  const remoteTime =
    metadataString(payload.remote_time_label) ||
    metadataString(payload.remote_time) ||
    [metadataString(payload.remote_start_label), metadataString(payload.remote_end_label)].filter(Boolean).join(" - ") ||
    metadataString(detail.remote_time_label) ||
    null;
  const rows = [
    { title: localTitle, time: localTime, alert: false },
    { title: conflictTitle, time: overlapTime, alert: true },
    { title: remoteTitle, time: remoteTime, alert: false },
  ];

  return (
    <div className={styles.conflictPreview} aria-label="Conflict preview">
      {rows.map((row) => (
        <div key={`${row.title}-${row.time || "none"}`} className={`${styles.conflictRow} ${row.alert ? styles.conflictRowAlert : ""}`}>
          <span>{row.title}</span>
          {row.time ? <strong>{row.time}</strong> : null}
        </div>
      ))}
    </div>
  );
}

function EmptyConfirmPanel() {
  return <p className={styles.confirmCopy}>Confirm this change before Starlog applies it.</p>;
}

export function DynamicPanelRenderer({ interrupt, busy, onSubmit, onDismiss }: DynamicPanelRendererProps) {
  const defaults = useMemo(() => initialValues(interrupt), [interrupt]);
  const [values, setValues] = useState<Record<string, unknown>>(defaults);
  const variant = panelTone(interrupt);
  const modeLabel = displayModeLabel(interrupt);
  const secondaryLabel = interrupt.secondary_label || interrupt.defer_label || "Not now";
  const secondaryHref = /\b(open|view)\s+planner\b/i.test(secondaryLabel)
    ? interrupt.entity_ref?.href || "/planner"
    : /\b(open|view)\s+library\b/i.test(secondaryLabel)
      ? interrupt.entity_ref?.href || "/library"
      : null;

  useEffect(() => {
    setValues(defaults);
  }, [defaults]);

  return (
    <section
      className={`${styles.panel} ${styles[`tone_${variant}`]} ${styles[`mode_${interrupt.display_mode || "inline"}`] || ""}`}
      data-testid="dynamic-panel-renderer"
      data-panel-tool={interrupt.tool_name}
    >
      <div className={styles.header}>
        <div className={styles.eyebrowRow}>
          <p>{panelLabel(interrupt)}</p>
          {modeLabel ? <span>{modeLabel}</span> : null}
        </div>
        <EntityLink entityRef={interrupt.entity_ref} />
      </div>

      <div className={styles.copy}>
        <h3>{interrupt.title}</h3>
        {interrupt.body ? <p>{interrupt.body}</p> : null}
      </div>

      <TaskDetailPreview interrupt={interrupt} />
      <CaptureTriagePreview interrupt={interrupt} />
      <PlannerConflictPreview interrupt={interrupt} />

      {interrupt.fields.length > 0 ? (
        <div className={styles.fields}>
          {interrupt.fields.map((field) => (
            <FieldRow
              key={`${interrupt.id}-${field.id}`}
              interrupt={interrupt}
              field={field}
              values={values}
              setValues={setValues}
              variant={variant}
              interruptId={interrupt.id}
            />
          ))}
        </div>
      ) : (
        <EmptyConfirmPanel />
      )}

      <RecommendedDefaults interrupt={interrupt} />

      {interrupt.consequence_preview ? (
        <p className={styles.consequencePreview}>{interrupt.consequence_preview}</p>
      ) : null}

      <div className={styles.actions}>
        {secondaryHref ? (
          <a className={`${styles.secondaryButton} ${styles.secondaryLink}`} href={secondaryHref}>
            {secondaryLabel}
          </a>
        ) : (
          <button
            type="button"
            onClick={() => void onDismiss(interrupt.id)}
            disabled={busy}
            className={styles.secondaryButton}
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => void onSubmit(interrupt.id, values)}
          disabled={busy}
          className={interrupt.destructive ? styles.dangerButton : styles.primaryButton}
        >
          {interrupt.primary_label}
        </button>
      </div>
    </section>
  );
}
