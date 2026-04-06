"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AprilPanel, AprilWorkspaceShell } from "../components/april-observatory-shell";
import { PaneRestoreStrip, PaneToggleButton } from "../components/pane-controls";
import { readEntitySnapshot, readEntitySnapshotAsync, writeEntitySnapshot } from "../lib/entity-snapshot";
import { usePaneCollapsed } from "../lib/pane-state";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type Card = {
  id: string;
  prompt: string;
  answer: string;
  due_at: string;
};

type SessionStats = {
  reviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
};

const REVIEW_CARDS_SNAPSHOT = "review.cards";
const REVIEW_SHOW_ANSWER_SNAPSHOT = "review.show_answer";
const REVIEW_CURRENT_INDEX_SNAPSHOT = "review.current_index";
const REVIEW_STATS_SNAPSHOT = "review.stats";
const REVIEW_CONTEXT_PANE_SNAPSHOT = "review.context_pane.collapsed";

export default function ReviewPage() {
  const { apiBase, token, mutateWithQueue } = useSessionConfig();
  const missingToken = !token;
  const missingApiBase = !apiBase;
  const missingConfig = missingToken || missingApiBase;
  const [cards, setCards] = useState<Card[]>(() => readEntitySnapshot<Card[]>(REVIEW_CARDS_SNAPSHOT, []));
  const [showAnswer, setShowAnswer] = useState(
    () => readEntitySnapshot<boolean>(REVIEW_SHOW_ANSWER_SNAPSHOT, false),
  );
  const [currentIndex, setCurrentIndex] = useState(
    () => readEntitySnapshot<number>(REVIEW_CURRENT_INDEX_SNAPSHOT, 0),
  );
  const [stats, setStats] = useState<SessionStats>(
    () => readEntitySnapshot<SessionStats>(REVIEW_STATS_SNAPSHOT, { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 }),
  );
  const [status, setStatus] = useState("Ready");
  const [attemptedInitialLoad, setAttemptedInitialLoad] = useState(false);
  const contextPane = usePaneCollapsed(REVIEW_CONTEXT_PANE_SNAPSHOT);
  const currentCard = cards[currentIndex] ?? null;
  const duePreview = useMemo(() => cards.slice(0, 6), [cards]);

  useEffect(() => {
    setCards((previous) => previous.length > 0 ? previous : readEntitySnapshot<Card[]>(REVIEW_CARDS_SNAPSHOT, []));
    setShowAnswer((previous) => previous || readEntitySnapshot<boolean>(REVIEW_SHOW_ANSWER_SNAPSHOT, false));
    setCurrentIndex((previous) => previous || readEntitySnapshot<number>(REVIEW_CURRENT_INDEX_SNAPSHOT, 0));
    setStats((previous) => (
      previous.reviewed > 0 || previous.again > 0 || previous.hard > 0 || previous.good > 0 || previous.easy > 0
        ? previous
        : readEntitySnapshot<SessionStats>(REVIEW_STATS_SNAPSHOT, { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 })
    ));
  }, []);

  useEffect(() => {
    if (missingConfig && cards.length === 0) {
      setStatus("Connect to the API to load the review queue.");
    }
  }, [cards.length, missingConfig]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cachedCards, cachedShowAnswer, cachedCurrentIndex, cachedStats] = await Promise.all([
        readEntitySnapshotAsync<Card[]>(REVIEW_CARDS_SNAPSHOT, []),
        readEntitySnapshotAsync<boolean>(REVIEW_SHOW_ANSWER_SNAPSHOT, false),
        readEntitySnapshotAsync<number>(REVIEW_CURRENT_INDEX_SNAPSHOT, 0),
        readEntitySnapshotAsync<SessionStats>(REVIEW_STATS_SNAPSHOT, { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 }),
      ]);

      if (cancelled) {
        return;
      }

      if (cachedCards.length > 0) {
        setCards(cachedCards);
      }
      setShowAnswer(cachedShowAnswer);
      setCurrentIndex(cachedCurrentIndex);
      setStats(cachedStats);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadDue = useCallback(async () => {
    if (missingApiBase) {
      setStatus("API base missing. Set it in Runtime or Main Room.");
      return;
    }
    if (missingToken) {
      setStatus("Bearer token missing. Add it in Runtime or Main Room.");
      return;
    }
    try {
      const payload = await apiRequest<Card[]>(apiBase, token, "/v1/cards/due?limit=20");
      setCards(payload);
      setCurrentIndex(0);
      setShowAnswer(false);
      const nextStats = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };
      setStats(nextStats);
      writeEntitySnapshot(REVIEW_CARDS_SNAPSHOT, payload);
      writeEntitySnapshot(REVIEW_CURRENT_INDEX_SNAPSHOT, 0);
      writeEntitySnapshot(REVIEW_SHOW_ANSWER_SNAPSHOT, false);
      writeEntitySnapshot(REVIEW_STATS_SNAPSHOT, nextStats);
      setStatus(`Loaded ${payload.length} due cards`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load due cards");
    }
  }, [apiBase, missingApiBase, missingToken, token]);

  useEffect(() => {
    if (missingConfig || cards.length > 0 || attemptedInitialLoad) {
      return;
    }
    setAttemptedInitialLoad(true);
    void loadDue();
  }, [attemptedInitialLoad, cards.length, loadDue, missingConfig]);

  async function reviewCurrent(rating: 1 | 3 | 4 | 5) {
    if (!currentCard) {
      setStatus("No active card");
      return;
    }

    try {
      const result = await mutateWithQueue(
        "/v1/reviews",
        {
          method: "POST",
          body: JSON.stringify({ card_id: currentCard.id, rating }),
        },
        {
          label: `Review card ${currentCard.id}`,
          entity: "review",
          op: "create",
        },
      );
      setStats((previous) => ({
        reviewed: previous.reviewed + 1,
        again: previous.again + (rating === 1 ? 1 : 0),
        hard: previous.hard + (rating === 3 ? 1 : 0),
        good: previous.good + (rating === 4 ? 1 : 0),
        easy: previous.easy + (rating === 5 ? 1 : 0),
      }));
      setCards((previous) => previous.filter((card) => card.id !== currentCard.id));
      setCurrentIndex(0);
      setShowAnswer(false);
      setStatus(
        result.queued
          ? `Queued review for ${currentCard.id} with rating ${rating}`
          : `Reviewed card ${currentCard.id} with rating ${rating}`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Review failed");
    }
  }

  useEffect(() => {
    if (cards.length > 0 && currentIndex >= cards.length) {
      setCurrentIndex(0);
    }
  }, [cards.length, currentIndex]);

  useEffect(() => {
    writeEntitySnapshot(REVIEW_CARDS_SNAPSHOT, cards);
  }, [cards]);

  useEffect(() => {
    writeEntitySnapshot(REVIEW_SHOW_ANSWER_SNAPSHOT, showAnswer);
  }, [showAnswer]);

  useEffect(() => {
    writeEntitySnapshot(REVIEW_CURRENT_INDEX_SNAPSHOT, currentIndex);
  }, [currentIndex]);

  useEffect(() => {
    writeEntitySnapshot(REVIEW_STATS_SNAPSHOT, stats);
  }, [stats]);

  const reviewedTotal = stats.reviewed + cards.length;
  const progressSegments = 5;
  const progressActive = reviewedTotal === 0 ? 0 : Math.min(progressSegments, Math.round((stats.reviewed / reviewedTotal) * progressSegments));

  return (
    <AprilWorkspaceShell
      activeSurface="srs-review"
      statusLabel={currentCard ? "Review live" : "Queue waiting"}
      queueLabel={`${cards.length} due`}
      searchPlaceholder="Search decks and prompts..."
      railSlot={(
        <>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Active decks</span>
            <div className="april-rail-deck-list">
              {duePreview.length === 0 ? (
                <p className="console-copy">No active due queue.</p>
              ) : (
                duePreview.map((card) => (
                  <div key={card.id} className="april-rail-deck-item">
                    <strong>{card.prompt.slice(0, 32)}{card.prompt.length > 32 ? "..." : ""}</strong>
                    <span>Due now</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Session split</span>
            <div className="april-rail-metric-stack">
              <div className="april-rail-metric-card">
                <strong>{stats.reviewed}</strong>
                <span>Reviewed</span>
              </div>
              <div className="april-rail-metric-card">
                <strong>{stats.good}</strong>
                <span>Good</span>
              </div>
            </div>
          </div>
        </>
      )}
    >
      <section className="april-review-layout">
        <div className="april-page-heading">
          <span className="april-page-kicker">SRS Review</span>
          <h1>Hold one card in focus.</h1>
          <p>
            Keep the answer hidden until you commit to retrieval. Deck state and progress stay peripheral unless you
            intentionally open them.
          </p>
        </div>

        <div className="april-review-progress">
          <div className="april-review-progress-head">
            <div>
              <span>Session progress</span>
              <strong>{currentCard ? `Card ${currentIndex + 1} of ${Math.max(cards.length, 1)}` : "Awaiting queue"}</strong>
            </div>
            <span>{stats.reviewed} reviewed</span>
          </div>
          <div className="april-review-progress-bar">
            <span style={{ width: `${reviewedTotal === 0 ? 0 : Math.min(100, (stats.reviewed / reviewedTotal) * 100)}%` }} />
          </div>
        </div>

        <div className="april-review-grid">
          <AprilPanel className="april-review-card-panel">
          {currentCard ? (
            <>
              <div className="april-review-card-meta">
                <span className="april-panel-kicker">Complexity: Tier 3</span>
                <span className="console-copy">{reviewMetaText(currentCard.due_at)}</span>
              </div>
              <div className="april-review-question">{currentCard.prompt}</div>
              <div className="april-review-reveal">
                <button className="april-hero-button" type="button" onClick={() => setShowAnswer((previous) => !previous)}>
                  {showAnswer ? "Hide answer" : "Reveal answer"}
                </button>
              </div>
              {showAnswer ? (
                <div className="april-review-answer">
                  <p className="console-copy">Due: {new Date(currentCard.due_at).toLocaleString()}</p>
                  <p>{currentCard.answer}</p>
                </div>
              ) : null}
              <div className="april-review-ratings">
                <button className="april-rating-button again" type="button" onClick={() => reviewCurrent(1)} disabled={!currentCard}>
                  <span>Again</span>
                  <small>{"< 1m"}</small>
                </button>
                <button className="april-rating-button" type="button" onClick={() => reviewCurrent(3)} disabled={!currentCard}>
                  <span>Hard</span>
                  <small>1d</small>
                </button>
                <button className="april-rating-button primary" type="button" onClick={() => reviewCurrent(4)} disabled={!currentCard}>
                  <span>Good</span>
                  <small>3d</small>
                </button>
                <button className="april-rating-button easy" type="button" onClick={() => reviewCurrent(5)} disabled={!currentCard}>
                  <span>Easy</span>
                  <small>5d</small>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="april-review-question">No due cards loaded.</div>
              <p className="console-copy">{missingConfig ? "Connect runtime and load the queue." : "Load due cards to resume review."}</p>
              <div className="button-row">
                {missingConfig ? <Link className="button" href="/runtime">Open runtime</Link> : <button className="button" type="button" onClick={() => loadDue()}>Load due cards</button>}
                <Link className="button" href="/review/decks">Open deck workspace</Link>
                <Link className="button" href="/assistant">Open Main Room</Link>
              </div>
            </>
          )}
          <p className="status">{status}</p>
          </AprilPanel>

          <div className="april-review-side">
            <PaneRestoreStrip
              actions={contextPane.collapsed ? [{ id: "review-context", label: "Show deck context", onClick: contextPane.expand }] : []}
            />
            {!contextPane.collapsed ? (
              <AprilPanel className="april-review-context">
                <div className="april-panel-head">
                  <div>
                    <span className="april-panel-kicker">Deck context</span>
                    <h2>Queue and session health</h2>
                  </div>
                  <PaneToggleButton label="Hide pane" onClick={contextPane.collapse} />
                </div>
            <div className="neural-sync-progress">
              <span>Progress</span>
              <span className="sync-bars">
                {Array.from({ length: progressSegments }).map((_, index) => (
                  <span key={`segment-${index}`} className={index < progressActive ? "active" : ""} />
                ))}
              </span>
              <strong>{stats.reviewed}/{Math.max(reviewedTotal, 1)}</strong>
            </div>
            <p className="console-copy">Queue remaining: {cards.length}</p>
            <p className="console-copy">Again: {stats.again} | Hard: {stats.hard} | Good: {stats.good} | Easy: {stats.easy}</p>
            <div className="button-row">
              <Link className="button" href="/review/decks">Open deck workspace</Link>
              <button className="button" type="button" onClick={() => loadDue()} disabled={missingConfig}>Refresh due cards</button>
              <button
                className="button"
                type="button"
                onClick={() => setShowAnswer((previous) => !previous)}
                disabled={!currentCard}
              >
                {showAnswer ? "Hide answer" : "Reveal answer"}
              </button>
            </div>
            <h3 className="observatory-panel-title">Queue preview</h3>
            {duePreview.length === 0 ? (
              <p className="console-copy">
                {missingConfig ? "Connect to the API to load the review queue." : "No queued cards."}
              </p>
            ) : (
              <div className="scroll-panel">
                {duePreview.map((card) => (
                  <p key={card.id} className="console-copy">{card.prompt}</p>
                ))}
              </div>
            )}
              </AprilPanel>
            ) : null}
          </div>
        </div>
      </section>
    </AprilWorkspaceShell>
  );
}

function reviewMetaText(dueAt: string): string {
  return `Last review target ${new Date(dueAt).toLocaleDateString()}`;
}
