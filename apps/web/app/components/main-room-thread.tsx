import type { ReactNode, RefObject } from "react";

import { getConversationCardRegistryEntry } from "./conversation-card-registry";

type AgentCommandStep = {
  tool_name: string;
  arguments: Record<string, unknown>;
  status: "planned" | "ok" | "dry_run" | "failed";
  message?: string | null;
  result: unknown;
};

type AgentCommandResponse = {
  command: string;
  planner: string;
  matched_intent: string;
  status: "planned" | "executed" | "failed";
  summary: string;
  steps: AgentCommandStep[];
};

type ConversationCard = {
  kind: string;
  version: number;
  title?: string | null;
  body?: string | null;
  metadata: Record<string, unknown>;
};

type ConversationMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  cards: ConversationCard[];
  metadata: {
    assistant_command?: AgentCommandResponse;
  } & Record<string, unknown>;
  created_at: string;
};

type ConversationToolTrace = {
  id: string;
  thread_id: string;
  message_id?: string | null;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: string;
  result: unknown;
  metadata: Record<string, unknown>;
  created_at: string;
};

type MainRoomThreadProps = {
  messages: ConversationMessage[];
  traces: ConversationToolTrace[];
  expandedCards: Record<string, boolean>;
  expandedTraces: Record<string, boolean>;
  onToggleCards: (key: string) => void;
  onToggleTraces: (key: string) => void;
  onReuseCommand: (command: string) => void;
  onOpenSurface: (href: string) => void;
  emptyTitle: string;
  emptyBody: string;
  emptyActions: string[];
  transcriptEndRef?: RefObject<HTMLDivElement | null>;
};

function summarizeTraceValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (value && typeof value === "object") {
    return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  }
  return "No structured payload";
}

function summarizeTraceArguments(argumentsValue: Record<string, unknown>): string {
  const keys = Object.keys(argumentsValue);
  if (keys.length === 0) {
    return "No arguments";
  }
  const preview = keys.slice(0, 3).map((key) => `${key}: ${summarizeTraceValue(argumentsValue[key])}`);
  return keys.length > 3 ? `${preview.join(" · ")} · +${keys.length - 3} more` : preview.join(" · ");
}

function cardMetaText(card: ConversationCard): string {
  const parts = [`v${card.version}`];
  const metadata = card.metadata ?? {};
  const source = typeof metadata.projection_source === "string" ? metadata.projection_source : "";
  const updatedAt = typeof metadata.projection_updated_at === "string" ? metadata.projection_updated_at : "";
  if (updatedAt) {
    const parsed = new Date(updatedAt);
    if (!Number.isNaN(parsed.getTime())) {
      parts.push(`updated ${parsed.toLocaleString()}`);
    }
  }
  if (source) {
    parts.push(`source ${source.replace(/_/g, " ")}`);
  }
  return parts.join(" · ");
}

function cardPresentation(card: ConversationCard): { label: string; tone: string } {
  const entry = getConversationCardRegistryEntry(card.kind, card.title);
  return { label: entry.label, tone: entry.tone };
}

function cardGlyph(card: ConversationCard): string {
  return getConversationCardRegistryEntry(card.kind, card.title).glyph || "•";
}

function bodyLines(body?: string | null): string[] {
  return (body || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderCardBody(card: ConversationCard): ReactNode {
  const lines = bodyLines(card.body);
  const metadata = card.metadata ?? {};

  if (card.kind === "review_queue") {
    return (
      <div className="assistant-card-ritual assistant-card-ritual-review">
        {card.title ? <h4>{card.title}</h4> : null}
        {card.body ? <p className="assistant-card-lede">{card.body}</p> : null}
        <div className="assistant-card-rate-row" aria-hidden="true">
          <span>Hard</span>
          <span>Good</span>
          <span>Reveal</span>
        </div>
      </div>
    );
  }

  if (card.kind === "briefing") {
    return (
      <div className="assistant-card-ritual assistant-card-ritual-briefing">
        {card.title ? <h4>{card.title}</h4> : null}
        {card.body ? <p className="assistant-card-lede">{card.body}</p> : null}
        <div className="assistant-card-waveform" aria-hidden="true">
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={`wave-${index}`} style={{ height: `${14 + ((index * 11) % 28)}px` }} />
          ))}
        </div>
      </div>
    );
  }

  if (card.kind === "knowledge_note") {
    return (
      <div className="assistant-card-ritual assistant-card-ritual-knowledge">
        <div className="assistant-card-knowledge-copy">
          {card.title ? <h4>{card.title}</h4> : null}
          {card.body ? <p className="assistant-card-lede">{card.body}</p> : null}
        </div>
        <div className="assistant-card-knowledge-glow" aria-hidden="true" />
      </div>
    );
  }

  if (card.kind === "task_list" && lines.length > 0) {
    return (
      <div className="assistant-card-ritual assistant-card-ritual-task">
        {card.title ? <h4>{card.title}</h4> : null}
        <ul className="assistant-card-checklist">
          {lines.slice(0, 4).map((line) => (
            <li key={line}>{line.replace(/^[-*]\s*/, "")}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (card.kind === "assistant_summary") {
    return (
      <div className="assistant-card-ritual">
        {card.title ? <h4>{card.title}</h4> : null}
        {card.body ? <p className="assistant-card-lede">{card.body}</p> : null}
        {typeof metadata.status === "string" ? (
          <span className="assistant-card-status">{metadata.status.replace(/_/g, " ")}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="assistant-card-ritual">
      {card.title ? <h4>{card.title}</h4> : null}
      {card.body ? <p className="assistant-card-lede">{card.body}</p> : null}
    </div>
  );
}

export function MainRoomThread({
  messages,
  traces,
  expandedCards,
  expandedTraces,
  onToggleCards,
  onToggleTraces,
  onReuseCommand,
  onOpenSurface,
  emptyTitle,
  emptyBody,
  emptyActions,
  transcriptEndRef,
}: MainRoomThreadProps) {
  return (
    <div className="assistant-thread-feed">
      {messages.length === 0 ? (
        <div className="assistant-empty-thread">
          <p className="assistant-empty-kicker">No messages yet</p>
          <h3>{emptyTitle}</h3>
          <p>{emptyBody}</p>
          <ul className="command-story-list">
            {emptyActions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : (
        messages.map((message) => {
          const assistantCommand = message.metadata?.assistant_command;
          const messageTraces = traces.filter((trace) => trace.message_id === message.id);
          const cardToggleKey = `${message.id}-cards`;
          const traceToggleKey = `${message.id}-traces`;
          const cardsExpanded = !!expandedCards[cardToggleKey];
          const tracesExpanded = !!expandedTraces[traceToggleKey];
          const pendingMessage = Boolean(message.metadata?.pending);
          const fallbackBody = assistantCommand?.summary || "No message content recorded.";
          const thinkingMessage = pendingMessage && message.role === "assistant";
          const body = pendingMessage && message.role === "assistant"
            ? "Observatory reply forming..."
            : message.content.trim() || fallbackBody;
          return (
            <article key={message.id} className={`assistant-thread-message role-${message.role}${pendingMessage ? " pending" : ""}`}>
              <div className="assistant-thread-message-meta">
                <span className={`assistant-sigil assistant-sigil-${message.role}`} aria-hidden="true">
                  {message.role === "assistant" ? "✦" : message.role === "user" ? "◉" : "◌"}
                </span>
                <span className="assistant-role-chip">{message.role}</span>
                <span>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div className="assistant-thread-bubble">
                {thinkingMessage ? (
                  <div className="assistant-thinking-block">
                    <span className="assistant-thinking-pill">Latent thinking</span>
                    <p>{body}</p>
                  </div>
                ) : (
                  <p>{body}</p>
                )}
                {message.cards.length > 0 ? (
                  <div className="assistant-inline-card assistant-inline-card-stack">
                    <div className="assistant-inline-card-head">
                      <span>{message.cards.length} card{message.cards.length === 1 ? "" : "s"} attached</span>
                      <span className="assistant-inline-card-actions">
                        <button
                          className="assistant-inline-card-toggle"
                          type="button"
                          onClick={() => onToggleCards(cardToggleKey)}
                        >
                          {cardsExpanded ? "Collapse" : "Expand"}
                        </button>
                      </span>
                    </div>
                    <div className="assistant-inline-card-steps">
                      {message.cards.map((card, index) => {
                        const entry = getConversationCardRegistryEntry(card.kind, card.title);
                        const presentation = cardPresentation(card);
                        const actionLabel = entry.actionLabel;
                        const reusableText = card.body?.trim() || card.title?.trim() || "";
                        const canReuse = entry.actionKind !== "navigate" && !!reusableText;
                        const canNavigate = entry.actionKind === "navigate" && typeof entry.href === "string";
                        return (
                          <div
                            key={`${message.id}-card-${card.kind}-${index}`}
                            className={`assistant-inline-step assistant-inline-step-card tone-${presentation.tone}`}
                          >
                            <div>
                              <div className="assistant-inline-step-head">
                                <strong>
                                  <span className="assistant-inline-step-glyph" aria-hidden="true">{cardGlyph(card)}</span>
                                  {presentation.label}
                                </strong>
                                <span className="assistant-inline-card-meta">{cardMetaText(card)}</span>
                              </div>
                              {!cardsExpanded ? (
                                <>
                                  {card.title ? <p className="assistant-inline-card-title">{card.title}</p> : null}
                                  {card.body ? <p className="assistant-inline-card-preview">{card.body}</p> : null}
                                </>
                              ) : renderCardBody(card)}
                              {canReuse || canNavigate ? (
                                <div className="assistant-inline-action-row">
                                  <button
                                    className="assistant-inline-card-toggle"
                                    type="button"
                                    onClick={() => {
                                      if (canNavigate && entry.href) {
                                        onOpenSurface(entry.href);
                                        return;
                                      }
                                      if (canReuse) {
                                        onReuseCommand(reusableText);
                                      }
                                    }}
                                  >
                                    {actionLabel || "Reuse in composer"}
                                  </button>
                                </div>
                              ) : null}
                              {cardsExpanded && Object.keys(card.metadata ?? {}).length > 0 ? (
                                <code className="assistant-inline-card-json">
                                  {JSON.stringify(card.metadata, null, 2)}
                                </code>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {messageTraces.length > 0 ? (
                  <div className="assistant-inline-card assistant-inline-card-stack">
                    <div className="assistant-inline-card-head">
                      <span>Used {messageTraces.length} tool{messageTraces.length === 1 ? "" : "s"}</span>
                      <span className="assistant-inline-card-actions">
                        <button
                          className="assistant-inline-card-toggle"
                          type="button"
                          onClick={() => onToggleTraces(traceToggleKey)}
                        >
                          {tracesExpanded ? "Collapse" : "Expand"}
                        </button>
                      </span>
                    </div>
                    <div className="assistant-inline-card-steps">
                      {messageTraces.map((trace) => (
                        <div key={trace.id} className="assistant-inline-step assistant-inline-step-trace">
                          <div className="assistant-inline-step-copy">
                            <div className="assistant-inline-step-head">
                              <strong>{trace.tool_name}</strong>
                              <span className={`assistant-trace-status assistant-trace-status-${trace.status}`}>{trace.status}</span>
                            </div>
                            <p>{summarizeTraceArguments(trace.arguments)}</p>
                            <p>Result: {summarizeTraceValue(trace.result)}</p>
                            {tracesExpanded && Object.keys(trace.arguments).length > 0 ? (
                              <code>{JSON.stringify(trace.arguments, null, 2)}</code>
                            ) : null}
                            {tracesExpanded ? (
                              <code>{JSON.stringify(trace.result, null, 2)}</code>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {assistantCommand ? (
                  <div className="assistant-inline-card">
                    <div className="assistant-inline-card-head">
                      <span>{assistantCommand.matched_intent}</span>
                      <span>{assistantCommand.status}</span>
                    </div>
                    <p>{assistantCommand.summary}</p>
                    <div className="assistant-inline-card-steps">
                      {assistantCommand.steps.slice(0, 3).map((step, index) => (
                        <div key={`${assistantCommand.command}-${step.tool_name}-${index}`} className="assistant-inline-step">
                          <strong>{step.tool_name}</strong>
                          <span>{step.status}</span>
                        </div>
                      ))}
                    </div>
                    <div className="button-row">
                      <button className="button" type="button" onClick={() => onReuseCommand(assistantCommand.command)}>
                        Reuse command
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })
      )}
      {transcriptEndRef ? <div ref={transcriptEndRef} /> : null}
    </div>
  );
}
