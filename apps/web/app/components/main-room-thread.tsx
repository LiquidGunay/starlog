"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssistantInterrupt, AssistantThreadMessage, AssistantThreadSnapshot } from "@starlog/contracts";

import styles from "./main-room-thread.module.css";

type MainRoomThreadProps = {
  snapshot: AssistantThreadSnapshot | null;
  loading: boolean;
  busy: boolean;
  onInterruptSubmit: (interruptId: string, values: Record<string, unknown>) => Promise<void> | void;
  onInterruptDismiss: (interruptId: string) => Promise<void> | void;
};

function defaultValues(interrupt: AssistantInterrupt): Record<string, unknown> {
  return interrupt.fields.reduce<Record<string, unknown>>((accumulator, field) => {
    accumulator[field.id] = field.value ?? (field.kind === "toggle" ? false : "");
    return accumulator;
  }, {});
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

function MessagePart({
  message,
  busy,
  onInterruptSubmit,
  onInterruptDismiss,
}: {
  message: AssistantThreadMessage;
  busy: boolean;
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
        <span>{message.role}</span>
        <span>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <span>{message.status}</span>
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
              <div key={part.id} className={styles.ambient}>
                <strong>{part.update.label}</strong>
                {part.update.body ? <span>{part.update.body}</span> : null}
              </div>
            );
          }
          if (part.type === "card") {
            return (
              <section key={part.id} className={styles.card}>
                <p className={styles.cardKind}>{part.card.kind.replace(/_/g, " ")}</p>
                {part.card.title ? <h3>{part.card.title}</h3> : null}
                {part.card.body ? <p>{part.card.body}</p> : null}
                {part.card.actions.length > 0 ? (
                  <div className={styles.actions}>
                    {part.card.actions.map((action) => (
                      <span key={action.id} className={styles.actionChip}>
                        {action.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          }
          if (part.type === "tool_call") {
            return (
              <div key={part.id} className={styles.toolCall}>
                <strong>{part.tool_call.tool_name}</strong>
                <span>{part.tool_call.status}</span>
              </div>
            );
          }
          if (part.type === "tool_result") {
            return (
              <div key={part.id} className={styles.toolResult}>
                <strong>Tool result</strong>
                <span>{Object.keys(part.tool_result.output || {}).length} fields returned</span>
              </div>
            );
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
              <div key={part.id} className={styles.status}>
                {part.label || part.status}
              </div>
            );
          }
          if (part.type === "attachment") {
            return (
              <div key={part.id} className={styles.attachment}>
                {part.attachment.label}
              </div>
            );
          }
          if (part.type === "interrupt_request") {
            return (
              <section key={part.id} className={styles.panel}>
                <p className={styles.cardKind}>{part.interrupt.tool_name.replace(/_/g, " ")}</p>
                <h3>{part.interrupt.title}</h3>
                {part.interrupt.body ? <p>{part.interrupt.body}</p> : null}
                <div className={styles.panelFields}>{renderField(part.interrupt, values, setValues)}</div>
                <div className={styles.panelActions}>
                  <button
                    type="button"
                    onClick={() => void onInterruptDismiss(part.interrupt.id)}
                    disabled={busy}
                    className={styles.secondaryButton}
                  >
                    {part.interrupt.secondary_label || "Dismiss"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onInterruptSubmit(part.interrupt.id, values)}
                    disabled={busy}
                    className={styles.primaryButton}
                  >
                    {part.interrupt.primary_label}
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
  onInterruptSubmit,
  onInterruptDismiss,
}: MainRoomThreadProps) {
  if (loading && !snapshot) {
    return <section className={styles.threadShell}>Loading assistant thread…</section>;
  }

  if (!snapshot) {
    return <section className={styles.threadShell}>Assistant thread unavailable.</section>;
  }

  return (
    <section className={styles.threadShell}>
      {snapshot.messages.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No messages yet.</p>
          <h2>The Assistant thread is ready for capture, planning, review, and follow-through.</h2>
        </div>
      ) : (
        snapshot.messages.map((message) => (
          <MessagePart
            key={message.id}
            message={message}
            busy={busy}
            onInterruptSubmit={onInterruptSubmit}
            onInterruptDismiss={onInterruptDismiss}
          />
        ))
      )}
    </section>
  );
}
