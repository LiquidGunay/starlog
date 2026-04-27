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

function panelTone(interrupt: AssistantInterrupt): PanelTone {
  if (interrupt.tool_name === "request_due_date") {
    return "task";
  }
  if (interrupt.tool_name === "triage_capture") {
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
  if (interrupt.tool_name === "request_due_date") {
    return "Task setup";
  }
  if (interrupt.tool_name === "triage_capture") {
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
  field,
  values,
  setValues,
  variant,
}: {
  field: AssistantInterruptField;
  values: Record<string, unknown>;
  setValues: SetValues;
  variant: PanelTone;
}) {
  const current = String(values[field.id] ?? "");
  const options = field.options || [];
  if (options.length === 0) {
    return null;
  }

  return (
    <div className={styles.optionGrid} role="radiogroup" aria-label={field.label}>
      {options.map((option) => {
        const selected = current === option.value;
        const review = variant === "review" ? REVIEW_VALUES[option.value] : null;
        return (
          <button
            key={`${field.id}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`${styles.optionCard} ${selected ? styles.optionCardSelected : ""}`}
            onClick={() => setFieldValue(setValues, field.id, option.value)}
          >
            <span>{review?.label || option.label}</span>
            {review?.hint ? <small>{review.hint}</small> : null}
            {variant === "focus" ? <small>Protect the first useful block.</small> : null}
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
  field,
  values,
  setValues,
  variant,
  controlId,
}: {
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
    (variant === "focus" || variant === "planner" || variant === "review" || field.options?.length === 2);

  if (useOptionCards) {
    return <OptionCards field={field} values={values} setValues={setValues} variant={variant} />;
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
    const priorityOptions =
      field.kind === "priority" && !(field.options || []).length
        ? Array.from({ length: Math.max(1, Number(field.max || 5)) }, (_, index) => {
            const priority = index + 1;
            return { label: `Priority ${priority}`, value: String(priority) };
          })
        : field.options || [];

    return (
      <select id={controlId} value={stringValue} onChange={(event) => setFieldValue(setValues, field.id, event.target.value)}>
        {!field.required ? <option value="">Choose</option> : null}
        {priorityOptions.map((option) => (
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
  field,
  values,
  setValues,
  variant,
}: {
  field: AssistantInterruptField;
  values: Record<string, unknown>;
  setValues: SetValues;
  variant: PanelTone;
}) {
  const controlId = `dynamic-panel-${field.id}`;
  if (field.kind === "toggle") {
    return <FieldControl field={field} values={values} setValues={setValues} variant={variant} controlId={controlId} />;
  }

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={controlId}>
        {field.label}
      </label>
      <FieldControl field={field} values={values} setValues={setValues} variant={variant} controlId={controlId} />
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

function PlannerConflictPreview({ interrupt }: { interrupt: AssistantInterrupt }) {
  if (interrupt.tool_name !== "resolve_planner_conflict") {
    return null;
  }
  const payload =
    interrupt.metadata?.conflict_payload && typeof interrupt.metadata.conflict_payload === "object"
      ? (interrupt.metadata.conflict_payload as Record<string, unknown>)
      : null;
  const remoteTitle =
    payload && typeof payload.remote_title === "string"
      ? payload.remote_title
      : payload && typeof payload.title === "string"
        ? payload.title
        : "Calendar event";
  const localTitle =
    payload && typeof payload.local_title === "string"
      ? payload.local_title
      : payload && typeof payload.block_title === "string"
        ? payload.block_title
        : "Starlog focus block";

  return (
    <div className={styles.conflictPreview} aria-label="Conflict preview">
      <span>{localTitle}</span>
      <strong>Overlap</strong>
      <span>{remoteTitle}</span>
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

      <PlannerConflictPreview interrupt={interrupt} />

      {interrupt.fields.length > 0 ? (
        <div className={styles.fields}>
          {interrupt.fields.map((field) => (
            <FieldRow
              key={`${interrupt.id}-${field.id}`}
              field={field}
              values={values}
              setValues={setValues}
              variant={variant}
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
        <button
          type="button"
          onClick={() => void onDismiss(interrupt.id)}
          disabled={busy}
          className={styles.secondaryButton}
        >
          {interrupt.defer_label || interrupt.secondary_label || "Not now"}
        </button>
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
