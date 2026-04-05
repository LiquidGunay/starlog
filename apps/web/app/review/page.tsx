"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ObservatoryPageShell, ObservatoryPanel } from "../components/observatory-shell";
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
  good: number;
  easy: number;
};

const REVIEW_CARDS_SNAPSHOT = "review.cards";
const REVIEW_SHOW_ANSWER_SNAPSHOT = "review.show_answer";
const REVIEW_CURRENT_INDEX_SNAPSHOT = "review.current_index";
const REVIEW_STATS_SNAPSHOT = "review.stats";
const REVIEW_SIDECAR_PANE_SNAPSHOT = "review.pane.sidecar";

export default function ReviewPage() {
  const { apiBase, token, mutateWithQueue } = useSessionConfig();
  const sidecarPane = usePaneCollapsed(REVIEW_SIDECAR_PANE_SNAPSHOT);
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
    () => readEntitySnapshot<SessionStats>(REVIEW_STATS_SNAPSHOT, { reviewed: 0, again: 0, good: 0, easy: 0 }),
  );
  const [status, setStatus] = useState("Ready");
  const currentCard = cards[currentIndex] ?? null;
  const duePreview = useMemo(() => cards.slice(0, 6), [cards]);

  useEffect(() => {
    setCards((previous) => previous.length > 0 ? previous : readEntitySnapshot<Card[]>(REVIEW_CARDS_SNAPSHOT, []));
    setShowAnswer((previous) => previous || readEntitySnapshot<boolean>(REVIEW_SHOW_ANSWER_SNAPSHOT, false));
    setCurrentIndex((previous) => previous || readEntitySnapshot<number>(REVIEW_CURRENT_INDEX_SNAPSHOT, 0));
    setStats((previous) => (
      previous.reviewed > 0 || previous.again > 0 || previous.good > 0 || previous.easy > 0
        ? previous
        : readEntitySnapshot<SessionStats>(REVIEW_STATS_SNAPSHOT, { reviewed: 0, again: 0, good: 0, easy: 0 })
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
        readEntitySnapshotAsync<SessionStats>(REVIEW_STATS_SNAPSHOT, { reviewed: 0, again: 0, good: 0, easy: 0 }),
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

  async function loadDue() {
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
      const nextStats = { reviewed: 0, again: 0, good: 0, easy: 0 };
      setStats(nextStats);
      writeEntitySnapshot(REVIEW_CARDS_SNAPSHOT, payload);
      writeEntitySnapshot(REVIEW_CURRENT_INDEX_SNAPSHOT, 0);
      writeEntitySnapshot(REVIEW_SHOW_ANSWER_SNAPSHOT, false);
      writeEntitySnapshot(REVIEW_STATS_SNAPSHOT, nextStats);
      setStatus(`Loaded ${payload.length} due cards`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load due cards");
    }
  }

  async function reviewCurrent(rating: 2 | 4 | 5) {
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
        again: previous.again + (rating === 2 ? 1 : 0),
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
    <ObservatoryPageShell
      eyebrow="SRS Review"
      title="Focus on one card at a time, with deck context off to the side."
      description="Keep the review surface immersive, but leave queue state, deck health, and the route back to the Main Room within one click."
      stats={[
        { label: "Due now", value: String(cards.length) },
        { label: "Reviewed", value: String(stats.reviewed) },
        { label: "Again / Good", value: `${stats.again} / ${stats.good}` },
      ]}
      actions={
        <div className="button-row">
          <Link className="button" href="/assistant">Open Main Room</Link>
          <button className="button" type="button" onClick={() => loadDue()} disabled={missingConfig}>Refresh due cards</button>
        </div>
      }
    >
      <PaneRestoreStrip
        actions={sidecarPane.collapsed ? [{ id: "review-sidecar", label: "Show deck sidecar", onClick: sidecarPane.expand }] : []}
      />

      <section className="observatory-grid observatory-grid-wide">
        <ObservatoryPanel
          kicker="Focus Session"
          title={currentCard ? "Current review card" : "Review queue empty"}
          meta="Reveal the answer, rate the card, and keep the rest of the deck out of the way until you need it."
        >
          {currentCard ? (
            <>
              <span className="sync-tag">due now</span>
              <div className="sync-prompt">
                <span>
                  {currentCard.prompt.split(" ").map((word, index) => (
                    <span key={`${word}-${index}`} className={index % 7 === 0 ? "sync-highlight" : ""}>
                      {word}
                      {" "}
                    </span>
                  ))}
                </span>
              </div>
              <div className="button-row">
                <button
                  className="button"
                  type="button"
                  onClick={() => setShowAnswer((previous) => !previous)}
                >
                  {showAnswer ? "Hide answer" : "Reveal answer"}
                </button>
              </div>
              {showAnswer ? (
                <div className="sync-answer">
                  <p className="console-copy">Due: {new Date(currentCard.due_at).toLocaleString()}</p>
                  <p>{currentCard.answer}</p>
                </div>
              ) : null}
              <div className="sync-rating-row">
                <button className="sync-rating-btn again" type="button" onClick={() => reviewCurrent(2)} disabled={!currentCard}>
                  <span>Again</span>
                  <small>{"< 1m"}</small>
                </button>
                <button className="sync-rating-btn" type="button" onClick={() => reviewCurrent(2)} disabled={!currentCard}>
                  <span>Hard</span>
                  <small>1d</small>
                </button>
                <button className="sync-rating-btn" type="button" onClick={() => reviewCurrent(4)} disabled={!currentCard}>
                  <span>Good</span>
                  <small>3d</small>
                </button>
                <button className="sync-rating-btn easy" type="button" onClick={() => reviewCurrent(5)} disabled={!currentCard}>
                  <span>Easy</span>
                  <small>5d</small>
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="sync-tag">queue empty</span>
              <div className="sync-prompt">No due cards.</div>
              <p className="console-copy">
                {missingConfig
                  ? "Connect to the API and load the queue to start reviewing."
                  : "Load due cards to resume review."}
              </p>
              {missingConfig ? (
                <div className="button-row">
                  <Link className="button" href="/runtime">Open runtime</Link>
                  <Link className="button" href="/assistant">Open Main Room</Link>
                </div>
              ) : null}
            </>
          )}
          <p className="status">{status}</p>
        </ObservatoryPanel>

        {!sidecarPane.collapsed ? (
          <ObservatoryPanel
            kicker="Deck Sidecar"
            title="Queue and session health"
            meta="Keep a short preview of what is due next, plus current session progress."
            actions={<PaneToggleButton label="Hide pane" onClick={sidecarPane.collapse} />}
          >
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
            <p className="console-copy">Again: {stats.again} | Good: {stats.good} | Easy: {stats.easy}</p>
            <div className="button-row">
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
          </ObservatoryPanel>
        ) : null}
      </section>
    </ObservatoryPageShell>
  );
}
