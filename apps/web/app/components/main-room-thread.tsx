import { useState, type CSSProperties, type ReactNode } from "react";
import type {
  AssistantCard as ConversationCard,
  AssistantCardAction,
  AssistantConversationToolTrace as ConversationToolTrace,
} from "@starlog/contracts";

import { getConversationCardRegistryEntry } from "./conversation-card-registry";

const DIAGNOSTIC_CARD_KINDS = new Set(["thread_context", "tool_step"]);

type AgentCommandResponse = {
  command: string;
  planner: string;
  matched_intent: string;
  status: "planned" | "executed" | "failed";
  summary: string;
  steps: Array<{
    tool_name: string;
    arguments: Record<string, unknown>;
    status: "planned" | "ok" | "dry_run" | "failed" | "completed" | "confirmation_required";
    message?: string | null;
    result: unknown;
  }>;
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

type MainRoomThreadProps = {
  messages: ConversationMessage[];
  traces: ConversationToolTrace[];
  expandedCards: Record<string, boolean>;
  expandedTraces: Record<string, boolean>;
  onToggleCards: (key: string) => void;
  onToggleTraces: (key: string) => void;
  onReuseCommand: (command: string) => void;
  onCardAction: (action: AssistantCardAction, card: ConversationCard) => void;
  emptyTitle: string;
  emptyBody: string;
  emptyActions: string[];
  transcriptEndRef?: (node: HTMLDivElement | null) => void;
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
  const parts: string[] = [];
  const metadata = card.metadata ?? {};
  const source = typeof metadata.projection_source === "string" ? metadata.projection_source : "";
  const updatedAt = typeof metadata.projection_updated_at === "string" ? metadata.projection_updated_at : "";
  if (updatedAt) {
    const parsed = new Date(updatedAt);
    if (!Number.isNaN(parsed.getTime())) {
      parts.push(parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }
  }
  if (source) {
    parts.push(source.replace(/_/g, " "));
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

function isDiagnosticCard(card: ConversationCard): boolean {
  return DIAGNOSTIC_CARD_KINDS.has(card.kind);
}

function renderCardBody(card: ConversationCard): ReactNode {
  const lines = bodyLines(card.body);
  const metadata = card.metadata ?? {};

  if (card.kind === "review_queue") {
    return (
      <div className="assistant-card-ritual assistant-card-preview-group assistant-card-ritual-review">
        {card.body ? <p className="assistant-card-lede">{card.body}</p> : null}
        <div className="assistant-card-pill-row" aria-hidden="true">
          <span>Hard</span>
          <span>Good</span>
          <span>Reveal</span>
        </div>
      </div>
    );
  }

  if (card.kind === "briefing") {
    return (
      <div className="assistant-card-ritual assistant-card-preview-group assistant-card-ritual-briefing">
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
      <div className="assistant-card-ritual assistant-card-preview-group assistant-card-ritual-knowledge">
        {card.body ? <p className="assistant-card-lede">{card.body}</p> : null}
        {lines.length > 0 ? (
          <blockquote className="assistant-card-knowledge-quote">{lines[0]}</blockquote>
        ) : null}
      </div>
    );
  }

  if (card.kind === "task_list" && lines.length > 0) {
    return (
      <div className="assistant-card-ritual assistant-card-preview-group assistant-card-ritual-task">
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
      <div className="assistant-card-ritual assistant-card-preview-group">
        {card.body ? <p className="assistant-card-lede">{card.body}</p> : null}
        {typeof metadata.status === "string" ? (
          <span className="assistant-card-status">{metadata.status.replace(/_/g, " ")}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="assistant-card-ritual assistant-card-preview-group">
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
  onCardAction,
  emptyTitle,
  emptyBody,
  emptyActions,
  transcriptEndRef,
}: MainRoomThreadProps) {
  const [revealedReviewCards, setRevealedReviewCards] = useState<Record<string, boolean>>({});

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
        messages.map((message, messageIndex) => {
          const previousRole = messages[messageIndex - 1]?.role;
          const assistantCommand = message.metadata?.assistant_command;
          const messageTraces = traces.filter((trace) => trace.message_id === message.id);
          const cardToggleKey = `${message.id}-cards`;
          const traceToggleKey = `${message.id}-traces`;
          const cardsExpanded = !!expandedCards[cardToggleKey];
          const tracesExpanded = !!expandedTraces[traceToggleKey];
          const primaryCards = message.cards.filter((card) => !isDiagnosticCard(card));
          const diagnosticCards = message.cards.filter(isDiagnosticCard);
          const pendingMessage = Boolean(message.metadata?.pending);
          const fallbackBody = assistantCommand?.summary || "No message content recorded.";
          const thinkingMessage = pendingMessage && message.role === "assistant";
          const body = pendingMessage && message.role === "assistant"
            ? "Assistant reply in progress..."
            : message.content.trim() || fallbackBody;
          const hasDiagnostics = diagnosticCards.length > 0 || messageTraces.length > 0 || Boolean(assistantCommand);
          const hiddenDiagnosticCount = diagnosticCards.length + messageTraces.length + (assistantCommand ? 1 : 0);
          const showRoleChip = message.role === "system" || message.role === "tool";
          const showAssistantMarker = message.role === "assistant" && previousRole !== "assistant";
          const showUserMarker = message.role === "user" && previousRole !== "user";
          const timestampLabel = new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return (
            <article
              key={message.id}
              className={`assistant-thread-message role-${message.role}${pendingMessage ? " pending" : ""}${showAssistantMarker || showUserMarker ? " cluster-start" : ""}`}
              style={{ "--thread-index": messageIndex } as CSSProperties}
            >
              <div className="assistant-thread-message-meta">
                <span className={`assistant-sigil assistant-sigil-${message.role}`} aria-hidden="true">
                  {message.role === "assistant" ? "✦" : message.role === "user" ? "◉" : "◌"}
                </span>
                {showRoleChip ? <span className="assistant-role-chip">{message.role}</span> : null}
                <span>{timestampLabel}</span>
              </div>
              <div className="assistant-thread-bubble">
                {showAssistantMarker ? (
                  <div className="assistant-thread-marker assistant-thread-marker-assistant">
                    <span className="assistant-thread-marker-dot" aria-hidden="true" />
                    <span>Assistant</span>
                    <span className="assistant-thread-marker-time">{timestampLabel}</span>
                  </div>
                ) : null}
                {showUserMarker ? (
                  <div className="assistant-thread-marker assistant-thread-marker-user">
                    <span>You</span>
                    <span className="assistant-thread-marker-time">{timestampLabel}</span>
                  </div>
                ) : null}
                {thinkingMessage ? (
                  <div className="assistant-thinking-block">
                    <span className="assistant-thinking-pill">Latent thinking</span>
                    <p>{body}</p>
                  </div>
                ) : (
                  <p>{body}</p>
                )}
                {primaryCards.length > 0 ? (
                  <div className="assistant-attachment-stack">
                    {primaryCards.map((card, index) => {
                        const presentation = cardPresentation(card);
                        const reusableText = card.body?.trim() || card.title?.trim() || "";
                        const cardKey = `${message.id}-card-${card.kind}-${index}`;
                        const reviewAnswer = typeof card.metadata?.answer === "string" ? card.metadata.answer : "";
                        const revealActive = !!revealedReviewCards[cardKey];
                        const metaText = cardMetaText(card);
                        const navigateAction = card.actions.find((action) => action.kind === "navigate");
                        return (
                          <article
                            key={cardKey}
                            className={`assistant-attachment assistant-inline-step-card tone-${presentation.tone}`}
                            style={{ "--attachment-index": index } as CSSProperties}
                          >
                            <div className="assistant-attachment-rail" aria-hidden="true" />
                            <div className="assistant-attachment-shell">
                              <div className="assistant-attachment-topline">
                                <strong className="assistant-attachment-label">
                                  <span className="assistant-inline-step-glyph" aria-hidden="true">{cardGlyph(card)}</span>
                                  {presentation.label}
                                </strong>
                                {metaText ? <span className="assistant-attachment-meta">{metaText}</span> : null}
                              </div>
                              <div className="assistant-attachment-heading">
                                {card.title ? <h4 className="assistant-inline-card-title">{card.title}</h4> : null}
                                {navigateAction ? <span className="assistant-attachment-jump">Open</span> : null}
                              </div>
                              {renderCardBody(card)}
                              {card.kind === "review_queue" && reviewAnswer && revealActive ? (
                                <code className="assistant-inline-card-json">{reviewAnswer}</code>
                              ) : null}
                              {card.actions.length > 0 || (card.kind === "review_queue" && reviewAnswer) || reusableText ? (
                                <div className="assistant-inline-action-row assistant-attachment-actions">
                                  {card.kind === "review_queue" && reviewAnswer ? (
                                    <button
                                      className="assistant-inline-card-toggle"
                                      type="button"
                                      onClick={() => {
                                        setRevealedReviewCards((previous) => ({ ...previous, [cardKey]: !previous[cardKey] }));
                                      }}
                                    >
                                      {revealActive ? "Hide answer" : "Reveal"}
                                    </button>
                                  ) : null}
                                  {card.actions.map((action) => (
                                    <button
                                      key={`${cardKey}-${action.id}`}
                                      className="assistant-inline-card-toggle"
                                      type="button"
                                      onClick={() => onCardAction(action, card)}
                                    >
                                      {action.label}
                                    </button>
                                  ))}
                                  {card.actions.length === 0 && reusableText ? (
                                    <button
                                      className="assistant-inline-card-toggle"
                                      type="button"
                                      onClick={() => onReuseCommand(reusableText)}
                                    >
                                      Reuse in Assistant
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                  </div>
                ) : null}
                {hasDiagnostics ? (
                    <div className="assistant-diagnostic-inline">
                      <div className="assistant-inline-card-head assistant-diagnostic-head">
                      <span>System trace {cardsExpanded ? "shown" : "collapsed"} · {hiddenDiagnosticCount} hidden</span>
                      <span className="assistant-inline-card-actions assistant-diagnostic-actions">
                        {cardsExpanded && messageTraces.length > 0 ? (
                          <button
                            className="assistant-inline-card-toggle"
                            type="button"
                            onClick={() => onToggleTraces(traceToggleKey)}
                          >
                            {tracesExpanded ? "Compact" : "Details"}
                          </button>
                        ) : null}
                        <button
                          className="assistant-inline-card-toggle"
                          type="button"
                          onClick={() => onToggleCards(cardToggleKey)}
                        >
                          {cardsExpanded ? "Hide" : "Show"}
                        </button>
                      </span>
                    </div>
                    {cardsExpanded ? (
                      <div className="assistant-diagnostic-panel">
                        {diagnosticCards.map((card, index) => (
                          <div key={`${message.id}-diagnostic-card-${index}-${card.kind}`} className="assistant-inline-step assistant-inline-step-trace">
                            <div className="assistant-inline-step-copy">
                              <div className="assistant-inline-step-head">
                                <strong>{cardPresentation(card).label}</strong>
                                <span className="assistant-inline-card-meta">{cardMetaText(card)}</span>
                              </div>
                              <p>{card.title || card.body || "Diagnostic detail available."}</p>
                              {card.body && card.title ? <p>{card.body}</p> : null}
                            </div>
                          </div>
                        ))}
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
                        {assistantCommand ? (
                          <div className="assistant-inline-step assistant-inline-step-trace">
                            <div className="assistant-inline-step-copy">
                              <div className="assistant-inline-step-head">
                                <strong>{assistantCommand.matched_intent}</strong>
                                <span className={`assistant-trace-status assistant-trace-status-${assistantCommand.status}`}>{assistantCommand.status}</span>
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
                              <div className="assistant-inline-action-row">
                                <button
                                  className="assistant-side-action compact muted"
                                  type="button"
                                  onClick={() => onReuseCommand(assistantCommand.command)}
                                >
                                  <strong>Reuse command</strong>
                                  <span>Load this matched intent back into the composer.</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
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
