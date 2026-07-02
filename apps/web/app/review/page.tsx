"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

import Link from "next/link";
import { PRODUCT_SURFACES, productCopy } from "@starlog/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SURFACE_NAV_ITEMS, type SurfaceId } from "../components/observatory-navigation";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";


type ReviewWorkspaceShellProps = {
  activeSurface: SurfaceId;
  statusLabel: string;
  queueLabel?: string;
  brandMeta?: string;
  searchLabel?: string;
  searchAriaLabel?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  profileTitle?: string;
  railSlot?: ReactNode;
  children: ReactNode;
  className?: string;
};

type ReviewPanelProps = ComponentPropsWithoutRef<"section">;

function reviewClassName(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function ReviewPanel({ className, children, ...rest }: ReviewPanelProps) {
  return (
    <section className={reviewClassName(["review-panel", className])} {...rest}>
      {children}
    </section>
  );
}

function ReviewWorkspaceShell({
  activeSurface,
  statusLabel,
  queueLabel,
  brandMeta = "Focused learning system",
  searchLabel = "Review search",
  searchAriaLabel = "Search review decks",
  searchPlaceholder = "Search decks...",
  searchValue,
  onSearchChange,
  profileTitle = "Review queue",
  railSlot,
  children,
  className,
}: ReviewWorkspaceShellProps) {
  return (
    <div className={reviewClassName(["review-workspace-shell", className])}>
      <aside className="review-rail">
        <div className="review-rail-brand">
          <span className="review-rail-brand-mark">{productCopy.brand.name}</span>
          <span className="review-rail-brand-meta">{brandMeta}</span>
        </div>
        <nav className="review-rail-nav" aria-label="Primary surfaces">
          {SURFACE_NAV_ITEMS.map((surface) => (
            <Link
              key={surface.id}
              href={surface.href}
              className={reviewClassName(["review-rail-link", surface.id === activeSurface && "active"])}
            >
              <span className="review-rail-link-glyph" aria-hidden="true">
                {surface.glyph}
              </span>
              <span className="review-rail-link-label">{surface.label}</span>
            </Link>
          ))}
        </nav>
        {railSlot ? <div className="review-rail-slot">{railSlot}</div> : null}
        <div className="review-rail-footer">
          <Link className="review-rail-footer-link" href="/library">
            {PRODUCT_SURFACES.library.label}
          </Link>
          <Link className="review-rail-footer-link" href="/runtime">
            Settings
          </Link>
          <div className="review-rail-profile">
            <div className="review-rail-profile-avatar" aria-hidden="true">
              ◉
            </div>
            <div className="review-rail-profile-copy">
              <strong>{profileTitle}</strong>
              <span>{queueLabel || "Live context"}</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="review-shell-column">
        <header className="review-topbar">
          <div className="review-topbar-status">
            <span className="review-topbar-status-dot" aria-hidden="true" />
            <span>{statusLabel}</span>
          </div>
          <label className="review-topbar-search">
            <span className="review-topbar-search-label">{searchLabel}</span>
            <input
              aria-label={searchAriaLabel}
              className="review-topbar-search-input"
              type="text"
              placeholder={searchPlaceholder}
              value={searchValue ?? ""}
              onChange={(event) => onSearchChange?.(event.target.value)}
              readOnly={!onSearchChange}
            />
          </label>
          <div className="review-topbar-actions">
            <Link className="review-topbar-icon" href="/assistant" aria-label="Open Assistant">
              ✦
            </Link>
            <Link className="review-topbar-icon" href="/runtime" aria-label="Open settings">
              ⌘
            </Link>
          </div>
        </header>
        <main className="review-shell-content">{children}</main>
      </div>
    </div>
  );
}

type Card = {
  id: string;
  deck_id?: string | null;
  card_type: string;
  review_mode?: ReviewMode;
  prompt: string;
  answer: string;
  due_at: string;
};

type Deck = {
  id: string;
  name: string;
  description?: string | null;
  card_count: number;
  due_count: number;
};

type CountBucket = {
  key: string;
  label: string;
  count: number;
};

type ReviewQueueHealth = {
  due_count: number;
  overdue_count: number;
  due_soon_count: number;
  suspended_count: number;
  reviewed_today_count: number;
  last_reviewed_at?: string | null;
  average_latency_ms?: number | null;
};

type ReviewSurfaceSummary = {
  ladder_counts: CountBucket[];
  total_ladder_counts: CountBucket[];
  deck_buckets: CountBucket[];
  queue_health: ReviewQueueHealth;
  learning_insights: LearningInsight[];
  recommended_drill: RecommendedDrill | null;
  generated_at: string;
};

type LearningInsight = {
  key: string;
  title: string;
  body: string;
  mode?: ReviewMode | null;
  ladder_stage?: string | null;
  count: number;
  severity: string;
  href?: string | null;
  prompt?: string | null;
};

type RecommendedDrill = {
  mode: ReviewMode | string;
  title: string;
  body: string;
  prompt?: string | null;
  reason: string;
  enabled: boolean;
};

type SessionStats = {
  reviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
};

type ReviewMode = "recall" | "understanding" | "application" | "synthesis" | "judgment";

const REVIEW_MODE_ORDER: ReviewMode[] = ["recall", "understanding", "application", "synthesis", "judgment"];

const REVIEW_MODE_BY_CARD_TYPE: Record<string, ReviewMode> = {
  qa: "recall",
  cloze: "recall",
  recall: "recall",
  understanding: "understanding",
  explain: "understanding",
  why: "understanding",
  application: "application",
  scenario: "application",
  drill: "application",
  synthesis: "synthesis",
  compare: "synthesis",
  connect: "synthesis",
  judgment: "judgment",
  tradeoff: "judgment",
  critique: "judgment",
};

const REVIEW_MODE_LABELS: Record<ReviewMode, string> = {
  recall: "Recall",
  understanding: "Understanding",
  application: "Application",
  synthesis: "Synthesis",
  judgment: "Judgment",
};

const REVIEW_MODE_DETAILS: Record<ReviewMode, { purpose: string; schedule: string }> = {
  recall: {
    purpose: "Remember facts.",
    schedule: "Grouped by due recall cards so the next prompt stays concrete.",
  },
  understanding: {
    purpose: "Explain and connect.",
    schedule: "Grouped by explanation cards that need another pass.",
  },
  application: {
    purpose: "Apply to new situations.",
    schedule: "Grouped by scenario cards that need practice in context.",
  },
  synthesis: {
    purpose: "Combine and create.",
    schedule: "Grouped by connection cards due for review.",
  },
  judgment: {
    purpose: "Evaluate and decide.",
    schedule: "Grouped by decision cards due for review.",
  },
};

const REVIEW_OPTIONS = [
  { label: "Again", hint: "< 1m", rating: 1 as const, tone: "again" },
  { label: "Hard", hint: "1d", rating: 3 as const, tone: "hard" },
  { label: "Good", hint: "3d", rating: 4 as const, tone: "primary" },
  { label: "Easy", hint: "5d", rating: 5 as const, tone: "easy" },
];

function emptyStats(): SessionStats {
  return { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };
}

function deckProgress(deck: Deck | null): number {
  if (!deck || deck.card_count <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(((deck.card_count - deck.due_count) / deck.card_count) * 100)));
}

function reviewModeForCard(card: Pick<Card, "card_type" | "review_mode">): ReviewMode {
  if (card.review_mode && REVIEW_MODE_ORDER.includes(card.review_mode)) {
    return card.review_mode;
  }
  const normalized = card.card_type.trim().toLowerCase().replace(/\s+/g, "_");
  return REVIEW_MODE_BY_CARD_TYPE[normalized] ?? "recall";
}

function reviewModeCounts(cards: Card[]): Record<ReviewMode, number> {
  return cards.reduce<Record<ReviewMode, number>>(
    (counts, card) => {
      counts[reviewModeForCard(card)] += 1;
      return counts;
    },
    { recall: 0, understanding: 0, application: 0, synthesis: 0, judgment: 0 },
  );
}

function primaryReviewMode(counts: Record<ReviewMode, number>): ReviewMode {
  return REVIEW_MODE_ORDER.reduce((primary, mode) => (counts[mode] > counts[primary] ? mode : primary), "recall");
}

function queueSplitSummary(counts: Record<ReviewMode, number>): string {
  const parts = REVIEW_MODE_ORDER
    .filter((mode) => counts[mode] > 0)
    .map((mode) => `${REVIEW_MODE_LABELS[mode]} ${counts[mode]}`);
  return parts.length > 0 ? parts.join(" · ") : "No ladder items due";
}

function bucketCount(buckets: CountBucket[] | undefined, key: string): number {
  return buckets?.find((bucket) => bucket.key === key)?.count ?? 0;
}

function bucketCountsByMode(buckets: CountBucket[] | undefined, fallback: Record<ReviewMode, number>): Record<ReviewMode, number> {
  return REVIEW_MODE_ORDER.reduce<Record<ReviewMode, number>>((counts, mode) => {
    counts[mode] = bucketCount(buckets, mode) || fallback[mode] || 0;
    return counts;
  }, { recall: 0, understanding: 0, application: 0, synthesis: 0, judgment: 0 });
}

function reviewModeLabel(mode?: string | null): string | null {
  if (!mode) {
    return null;
  }
  return REVIEW_MODE_LABELS[mode as ReviewMode] ?? machineLabel(mode);
}

function machineLabel(value?: string | null): string | null {
  const normalized = value?.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return null;
  }
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function reviewCardTypeLabel(card: Pick<Card, "card_type" | "review_mode">): string {
  const modeLabel = reviewModeLabel(card.review_mode);
  if (modeLabel) {
    return modeLabel;
  }

  const normalizedCardType = card.card_type.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const mode = REVIEW_MODE_BY_CARD_TYPE[normalizedCardType];
  if (mode) {
    return REVIEW_MODE_LABELS[mode];
  }

  return machineLabel(card.card_type) ?? "Review card";
}

function summaryDeckBuckets(summary: ReviewSurfaceSummary | null, decks: Deck[]): CountBucket[] {
  if (summary?.deck_buckets.length) {
    return summary.deck_buckets;
  }
  return decks
    .filter((deck) => deck.card_count > 0)
    .map((deck) => ({ key: deck.name, label: deck.name, count: deck.due_count }))
    .sort((left, right) => right.count - left.count);
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "No reviews recorded";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatLatency(milliseconds?: number | null): string {
  if (milliseconds == null) {
    return "No latency sample";
  }
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function decrementBucket(buckets: CountBucket[], keyCandidates: string[]): CountBucket[] {
  const keys = new Set(keyCandidates.filter(Boolean));
  return buckets.map((bucket) => (
    keys.has(bucket.key) || keys.has(bucket.label)
      ? { ...bucket, count: Math.max(0, bucket.count - 1) }
      : bucket
  ));
}

function reconcileSummaryAfterReview(
  currentSummary: ReviewSurfaceSummary | null,
  card: Card,
): ReviewSurfaceSummary | null {
  if (!currentSummary) {
    return null;
  }

  const mode = reviewModeForCard(card);
  const wasOverdue = new Date(card.due_at).getTime() < Date.now();

  return {
    ...currentSummary,
    ladder_counts: decrementBucket(currentSummary.ladder_counts, [mode]),
    queue_health: {
      ...currentSummary.queue_health,
      due_count: Math.max(0, currentSummary.queue_health.due_count - 1),
      overdue_count: wasOverdue ? Math.max(0, currentSummary.queue_health.overdue_count - 1) : currentSummary.queue_health.overdue_count,
      reviewed_today_count: currentSummary.queue_health.reviewed_today_count + 1,
      last_reviewed_at: new Date().toISOString(),
    },
  };
}

export default function ReviewPage() {
  const { apiBase, token } = useSessionConfig();
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [summary, setSummary] = useState<ReviewSurfaceSummary | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [revealedCardId, setRevealedCardId] = useState<string | null>(null);
  const [status, setStatus] = useState("SRS queue idle.");
  const [stats, setStats] = useState<SessionStats>(emptyStats);
  const [attemptedInitialLoad, setAttemptedInitialLoad] = useState(false);
  const [loading, setLoading] = useState(false);

  const missingToken = !token;
  const missingApiBase = !apiBase;
  const missingConfig = missingToken || missingApiBase;
  const currentCard = cards[0] ?? null;
  const currentDeck = currentCard ? decks.find((deck) => deck.id === currentCard.deck_id) ?? null : null;
  const reviewedTotal = stats.reviewed + cards.length;
  const sessionProgress = reviewedTotal > 0 ? (stats.reviewed / reviewedTotal) * 100 : 0;
  const focusTier = currentDeck ? Math.min(4, Math.max(1, Math.ceil(currentDeck.due_count / 6))) : 1;
  const modeCounts = useMemo(() => reviewModeCounts(cards), [cards]);
  const ladderCounts = useMemo(() => bucketCountsByMode(summary?.ladder_counts, modeCounts), [modeCounts, summary]);
  const totalLadderCounts = useMemo(() => bucketCountsByMode(summary?.total_ladder_counts, ladderCounts), [ladderCounts, summary]);
  const primaryMode = primaryReviewMode(ladderCounts);
  const currentMode = currentCard ? reviewModeForCard(currentCard) : primaryMode;
  const queueSplit = queueSplitSummary(ladderCounts);
  const deckBuckets = useMemo(() => summaryDeckBuckets(summary, decks), [decks, summary]);
  const health = summary?.queue_health;
  const dueCount = health?.due_count ?? cards.length;
  const overdueCount = health?.overdue_count ?? cards.filter((card) => new Date(card.due_at).getTime() < Date.now()).length;
  const dueSoonCount = health?.due_soon_count ?? 0;
  const suspendedCount = health?.suspended_count ?? 0;
  const reviewedTodayCount = health?.reviewed_today_count ?? stats.reviewed;
  const learningInsights = (summary?.learning_insights ?? []).slice(0, 3);
  const recommendedDrill = summary?.recommended_drill ?? null;
  const whyThisNow = recommendedDrill?.reason
    || learningInsights[0]?.body
    || (overdueCount > 0
      ? `${overdueCount} item(s) are overdue, so due review gets priority before adding new material.`
      : `${dueCount} item(s) are due in the current ladder queue.`);

  const loadReviewQueueData = useCallback(async () => {
    const [summaryPayload, nextCards, nextDecks] = await Promise.all([
      apiRequest<ReviewSurfaceSummary>(apiBase, token, "/v1/surfaces/review/summary"),
      apiRequest<Card[]>(apiBase, token, "/v1/cards/due?limit=42"),
      apiRequest<Deck[]>(apiBase, token, "/v1/cards/decks"),
    ]);
    setSummary(summaryPayload);
    setCards(nextCards);
    setDecks(nextDecks);
    return { summaryPayload, nextCards, nextDecks };
  }, [apiBase, token]);

  const loadReviewData = useCallback(async () => {
    if (missingConfig) {
      setStatus("Open login and connect a station before starting review.");
      return;
    }

    setLoading(true);
    try {
      const { summaryPayload, nextDecks } = await loadReviewQueueData();
      setStats(emptyStats());
      setShowAnswer(false);
      setRevealedCardId(null);
      setStatus(`Loaded ${summaryPayload.queue_health.due_count} due card(s) across ${nextDecks.length} deck(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load the review queue");
    } finally {
      setLoading(false);
    }
  }, [loadReviewQueueData, missingConfig]);

  useEffect(() => {
    if (attemptedInitialLoad || missingConfig) {
      return;
    }
    setAttemptedInitialLoad(true);
    void loadReviewData();
  }, [attemptedInitialLoad, loadReviewData, missingConfig]);

  async function emitReviewReveal(card: Card) {
    if (missingConfig) {
      return;
    }
    try {
      await apiRequest(apiBase, token, "/v1/assistant/threads/primary/events", {
        method: "POST",
        body: JSON.stringify({
          source_surface: "review",
          kind: "review.answer.revealed",
          entity_ref: {
            entity_type: "card",
            entity_id: card.id,
            href: "/review",
            title: card.prompt,
          },
          payload: {
            card_id: card.id,
            prompt: card.prompt,
            card_type: card.card_type,
            review_mode: reviewModeForCard(card),
            due_at: card.due_at,
          },
          visibility: "assistant_message",
        }),
      });
    } catch {
      // The review surface remains usable even if assistant reflection fails.
    }
  }

  async function reviewCurrent(rating: 1 | 3 | 4 | 5) {
    if (!currentCard) {
      setStatus("Load due cards to start reviewing.");
      return;
    }
    if (missingConfig) {
      setStatus("Open login and connect a station before submitting ratings.");
      return;
    }

    try {
      await apiRequest(apiBase, token, "/v1/reviews", {
        method: "POST",
        body: JSON.stringify({ card_id: currentCard.id, rating }),
      });
      const reviewedCard = currentCard;
      setCards((previous) => previous.filter((card) => card.id !== currentCard.id));
      setSummary((previous) => reconcileSummaryAfterReview(previous, reviewedCard));
      setStats((previous) => ({
        reviewed: previous.reviewed + 1,
        again: previous.again + (rating === 1 ? 1 : 0),
        hard: previous.hard + (rating === 3 ? 1 : 0),
        good: previous.good + (rating === 4 ? 1 : 0),
        easy: previous.easy + (rating === 5 ? 1 : 0),
      }));
      setShowAnswer(false);
      setRevealedCardId(null);
      setDecks((previous) => previous.map((deck) => (
        deck.id === currentCard.deck_id
          ? { ...deck, due_count: Math.max(0, deck.due_count - 1) }
          : deck
      )));
      setStatus(`Recorded ${rating === 1 ? "Again" : rating === 3 ? "Hard" : rating === 4 ? "Good" : "Easy"} for ${currentCard.id}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to submit review");
    }
  }

  return (
    <ReviewWorkspaceShell
      activeSurface="review"
      statusLabel={currentCard ? `${currentDeck?.name ?? "Focused review"} · ${REVIEW_MODE_LABELS[currentMode]} · ${dueCount} due` : "Focused review ready"}
      queueLabel={`${dueCount} due`}
      searchPlaceholder="Search decks..."
      className="review-primary-shell"
      railSlot={(
        <>
          <div className="review-rail-section">
            <span className="review-rail-section-label">Queue health</span>
            <div className="review-rail-health">
              <div><strong>{dueCount}</strong><span>Due</span></div>
              <div><strong>{overdueCount}</strong><span>Overdue</span></div>
              <div><strong>{reviewedTodayCount}</strong><span>Reviewed today</span></div>
            </div>
          </div>
          <div className="review-rail-section">
            <span className="review-rail-section-label">Deck buckets</span>
            <div className="review-rail-decks">
              {deckBuckets.length === 0 ? (
                <p className="console-copy">No deck buckets loaded yet.</p>
              ) : (
                deckBuckets.slice(0, 6).map((deck) => (
                  <div
                    key={deck.key}
                    className={deck.key === currentDeck?.name || deck.key === currentDeck?.id ? "review-rail-deck active" : "review-rail-deck"}
                  >
                    <div>
                      <strong>{deck.label}</strong>
                      <span>Deck bucket</span>
                    </div>
                    <small>{deck.count > 0 ? `${deck.count} items` : "stable"}</small>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="review-rail-section">
            <span className="review-rail-section-label">Return points</span>
            <div className="review-rail-link-stack">
              <Link href="/review/decks">Deck workspace</Link>
              <Link href="/library">Library</Link>
              <Link href="/today">Today</Link>
              <Link href={missingConfig ? "/login" : "/runtime"}>{missingConfig ? "Open login" : "Runtime"}</Link>
            </div>
          </div>
        </>
      )}
    >
      <section className="review-surface">
        <div className="review-heading">
          <div>
            <p className="review-heading-kicker">Review</p>
            <h1>Focused review</h1>
          </div>
          <div className="review-tabs" aria-label="Review view status">
            {["Today", "All due", "Upcoming", "Mastered", "Insights"].map((label, index) => (
              <span key={label} className={index === 0 ? "active" : ""} aria-current={index === 0 ? "page" : undefined}>
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="review-progress">
          <div className="review-progress-head">
            <div>
              <span>Session progress</span>
              <strong>
                {currentCard ? `Card ${stats.reviewed + 1} of ${Math.max(reviewedTotal, 1)}` : "Awaiting queue"}
              </strong>
            </div>
            <span>
              {stats.reviewed} reviewed
            </span>
          </div>
          <div className="review-progress-bar">
            <span style={{ width: `${sessionProgress}%` }} />
          </div>
        </div>

        <div className="review-grid">
          <ReviewPanel className="review-ladder-panel">
            <div className="review-panel-head">
              <div>
                <span className="review-sidebar-kicker">Learning path</span>
                <h2>Review depth</h2>
                <p className="review-copy">Queue context by card mode, keeping the review path focused on due cards.</p>
              </div>
            </div>
            <div className="review-ladder-list">
              {REVIEW_MODE_ORDER.map((mode) => {
                const due = ladderCounts[mode];
                const total = totalLadderCounts[mode];
                const isActive = mode === currentMode;
                return (
                  <div key={mode} className={isActive ? "review-ladder-step active" : "review-ladder-step"}>
                    <div className="review-ladder-step-head">
                      <strong>{REVIEW_MODE_LABELS[mode]}</strong>
                      <span>{due} due</span>
                    </div>
                    <p>{REVIEW_MODE_DETAILS[mode].purpose}</p>
                    <small>{total} total · {REVIEW_MODE_DETAILS[mode].schedule}</small>
                  </div>
                );
              })}
            </div>
          </ReviewPanel>

          <ReviewPanel className="review-focus-panel">
            {currentCard ? (
              <>
                <div className="review-focus-meta">
                  <span>Complexity: Tier {focusTier}</span>
                  <span>{REVIEW_MODE_LABELS[currentMode]}</span>
                </div>
                <div className="review-card-body">
                  <div className="review-question">
                    {currentCard.prompt}
                  </div>
                  <div className="review-reveal">
                    <button
                      className="review-chip-button review-reveal-button"
                      type="button"
                      onClick={() => {
                        const nextShowAnswer = !showAnswer;
                        setShowAnswer(nextShowAnswer);
                        if (nextShowAnswer && currentCard && revealedCardId !== currentCard.id) {
                          setRevealedCardId(currentCard.id);
                          void emitReviewReveal(currentCard);
                        }
                      }}
                    >
                      {showAnswer ? "Hide answer" : "Reveal answer"}
                    </button>
                  </div>
                  {showAnswer ? (
                    <div className="review-answer">
                      <p className="status">Due {new Date(currentCard.due_at).toLocaleString()}</p>
                      <p>{currentCard.answer}</p>
                    </div>
                  ) : null}
                </div>
                <div className="review-card-footer">
                  <span>Card {currentCard.id}</span>
                  <span>Last review window: due {new Date(currentCard.due_at).toLocaleDateString()}</span>
                </div>
                <div className="review-context-grid" aria-label="Review context">
                  <div>
                    <span className="review-sidebar-kicker">Why this now</span>
                    <p>{whyThisNow}</p>
                  </div>
                  <div>
                    <span className="review-sidebar-kicker">Source trace</span>
                    <p>{currentDeck?.name ? `${currentDeck.name} deck` : `Card ${currentCard.id}`} · {reviewCardTypeLabel(currentCard)}</p>
                  </div>
                  <div>
                    <span className="review-sidebar-kicker">Project context</span>
                    <p>{currentDeck?.description || "No linked project context is available on this card yet."}</p>
                  </div>
                </div>
                <div className="review-ratings">
                  {REVIEW_OPTIONS.map((option) => (
                    <button
                      key={option.label}
                      className={`review-rating-button ${option.tone}`}
                      type="button"
                      disabled={!showAnswer}
                      onClick={() => reviewCurrent(option.rating)}
                    >
                      <span>{option.label}</span>
                      <small>{option.hint}</small>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="review-empty">
                <h2>{missingConfig ? "Access required" : "No due cards loaded."}</h2>
                <p>
                  {missingConfig
                    ? "Open login, sign in to Starlog, then return to this focused review surface."
                    : "The queue is empty until you load due cards or import a deck."}
                </p>
                <div className="review-inline-actions">
                  <button
                    className="review-chip-button"
                    type="button"
                    onClick={() => void loadReviewData()}
                    disabled={missingConfig || loading}
                  >
                    {loading ? "Loading..." : "Load due cards"}
                  </button>
                  <Link className="review-chip-button muted" href={missingConfig ? "/login" : "/review/decks"}>
                    {missingConfig ? "Open login" : "Open deck workspace"}
                  </Link>
                </div>
              </div>
            )}
          </ReviewPanel>

          <div className="review-side">
            <ReviewPanel className="review-side-card">
              <span className="review-sidebar-kicker">Knowledge health</span>
              <div className="review-side-metrics">
                <div>
                  <strong>{dueCount}</strong>
                  <span>Cards due</span>
                </div>
                <div>
                  <span className="review-mode-chip">{REVIEW_MODE_LABELS[primaryMode]}</span>
                  <span>Primary mode</span>
                </div>
              </div>
              <div className="review-sidebar-chart" aria-hidden="true">
                {[40, 58, 52, 76, 84, 74, 90].map((height, index) => (
                  <span key={`bar-${index}`} style={{ height: `${height}%` }} className={index >= 4 ? "active" : ""} />
                ))}
              </div>
            </ReviewPanel>

            <ReviewPanel className="review-side-card">
              <span className="review-sidebar-kicker">Queue mix</span>
              <p className="review-copy">{queueSplit}</p>
              <div className="review-health-list">
                <div><span>Overdue</span><strong>{overdueCount}</strong></div>
                <div><span>Due soon</span><strong>{dueSoonCount}</strong></div>
                <div><span>Suspended</span><strong>{suspendedCount}</strong></div>
                <div><span>Latency</span><strong>{formatLatency(health?.average_latency_ms)}</strong></div>
              </div>
              <p className="review-copy">Last reviewed: {formatDateTime(health?.last_reviewed_at)}</p>
              <span className="review-sidebar-kicker">Session grades</span>
              <p className="review-copy">
                Again {stats.again} | Hard {stats.hard} | Good {stats.good} | Easy {stats.easy}
              </p>
              <p className="review-copy" aria-live="polite">{status}</p>
              <div className="review-side-actions">
                <button className="review-chip-button" type="button" onClick={() => void loadReviewData()} disabled={loading || missingConfig}>
                  Refresh queue
                </button>
                <Link className="review-chip-button muted" href="/review/decks">Deck workspace</Link>
              </div>
            </ReviewPanel>

          </div>
        </div>

        <div className="review-control-bar">
          <div className="review-control-actions">
            <button className="review-icon-button" type="button" onClick={() => setShowAnswer((previous) => !previous)} disabled={!currentCard}>
              {showAnswer ? "Hide" : "Reveal"}
            </button>
            <button className="review-icon-button" type="button" onClick={() => void loadReviewData()} disabled={loading || missingConfig}>
              Reload queue
            </button>
          </div>
          <div className="review-shortcuts">
            <span><kbd>Space</kbd> to reveal</span>
            <span><kbd>1-4</kbd> to rate</span>
            <span>Deck progress {deckProgress(currentDeck)}%</span>
          </div>
          <Link className="review-icon-button" href={missingConfig ? "/login" : "/runtime"}>
            {missingConfig ? "Open login" : "Session settings"}
          </Link>
        </div>
      </section>
    </ReviewWorkspaceShell>
  );
}
