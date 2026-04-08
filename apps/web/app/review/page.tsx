"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AprilPanel, AprilWorkspaceShell } from "../components/april-observatory-shell";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type Card = {
  id: string;
  deck_id?: string | null;
  card_type: string;
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

type SessionStats = {
  reviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
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

function humanizeCardType(cardType: string): string {
  return cardType.replace(/_/g, " ");
}

export default function ReviewPage() {
  const { apiBase, token } = useSessionConfig();
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [status, setStatus] = useState("SRS queue idle.");
  const [stats, setStats] = useState<SessionStats>(emptyStats);
  const [attemptedInitialLoad, setAttemptedInitialLoad] = useState(false);
  const [loading, setLoading] = useState(false);

  const missingToken = !token;
  const missingApiBase = !apiBase;
  const missingConfig = missingToken || missingApiBase;
  const currentCard = cards[0] ?? null;
  const currentDeck = currentCard ? decks.find((deck) => deck.id === currentCard.deck_id) ?? null : null;
  const activeDecks = useMemo(
    () => decks.filter((deck) => deck.card_count > 0).sort((left, right) => right.due_count - left.due_count),
    [decks],
  );
  const reviewedTotal = stats.reviewed + cards.length;
  const sessionProgress = reviewedTotal > 0 ? (stats.reviewed / reviewedTotal) * 100 : 0;
  const sessionRetention = stats.reviewed > 0 ? Math.round(((stats.good + stats.easy) / stats.reviewed) * 100) : 0;
  const focusTier = currentDeck ? Math.min(4, Math.max(1, Math.ceil(currentDeck.due_count / 6))) : 1;

  const loadReviewData = useCallback(async () => {
    if (missingConfig) {
      setStatus("Open login and connect a station before starting review.");
      return;
    }

    setLoading(true);
    try {
      const [nextCards, nextDecks] = await Promise.all([
        apiRequest<Card[]>(apiBase, token, "/v1/cards/due?limit=42"),
        apiRequest<Deck[]>(apiBase, token, "/v1/cards/decks"),
      ]);
      setCards(nextCards);
      setDecks(nextDecks);
      setStats(emptyStats());
      setShowAnswer(false);
      setStatus(`Loaded ${nextCards.length} due card(s) across ${nextDecks.length} deck(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load the review queue");
    } finally {
      setLoading(false);
    }
  }, [apiBase, missingConfig, token]);

  useEffect(() => {
    if (attemptedInitialLoad || missingConfig) {
      return;
    }
    setAttemptedInitialLoad(true);
    void loadReviewData();
  }, [attemptedInitialLoad, loadReviewData, missingConfig]);

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
      setCards((previous) => previous.filter((card) => card.id !== currentCard.id));
      setStats((previous) => ({
        reviewed: previous.reviewed + 1,
        again: previous.again + (rating === 1 ? 1 : 0),
        hard: previous.hard + (rating === 3 ? 1 : 0),
        good: previous.good + (rating === 4 ? 1 : 0),
        easy: previous.easy + (rating === 5 ? 1 : 0),
      }));
      setShowAnswer(false);
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
    <AprilWorkspaceShell
      activeSurface="srs-review"
      statusLabel={currentCard ? `${currentDeck?.name ?? "Focused review"} · ${cards.length} due` : "Focused review ready"}
      queueLabel={`${cards.length} due`}
      searchPlaceholder="Search decks..."
      railSlot={(
        <>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Active Decks</span>
            <div className="april-review-rail-decks">
              {activeDecks.length === 0 ? (
                <p className="console-copy">No active decks loaded yet.</p>
              ) : (
                activeDecks.slice(0, 6).map((deck) => (
                  <div
                    key={deck.id}
                    className={deck.id === currentCard?.deck_id ? "april-review-rail-deck active" : "april-review-rail-deck"}
                  >
                    <div>
                      <strong>{deck.name}</strong>
                      <span>{deck.description || "Focused study set"}</span>
                    </div>
                    <small>{deck.due_count > 0 ? `${deck.due_count} due` : "stable"}</small>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="april-rail-section">
            <span className="april-rail-section-label">Return Points</span>
            <div className="april-rail-link-stack">
              <Link href="/review/decks">Deck Workspace</Link>
              <Link href="/notes">Knowledge Base</Link>
              <Link href={missingConfig ? "/login" : "/runtime"}>{missingConfig ? "Open Login" : "Runtime"}</Link>
            </div>
          </div>
        </>
      )}
    >
      <section className="april-review-surface">
        <div className="april-review-progress">
          <div className="april-review-progress-head">
            <div>
              <span>Session Progress</span>
              <strong>
                {currentCard ? `Card ${stats.reviewed + 1} of ${Math.max(reviewedTotal, 1)}` : "Awaiting queue"}
              </strong>
            </div>
            <span>{stats.reviewed} reviewed</span>
          </div>
          <div className="april-review-progress-bar">
            <span style={{ width: `${sessionProgress}%` }} />
          </div>
        </div>

        <div className="april-review-grid">
          <AprilPanel className="april-review-focus-panel">
            {currentCard ? (
              <>
                <div className="april-review-focus-meta">
                  <span>Complexity: Tier {focusTier}</span>
                  <span>{humanizeCardType(currentCard.card_type)}</span>
                </div>
                <div className="april-review-card-body">
                  <div className="april-review-question">
                    {currentCard.prompt}
                  </div>
                  <div className="april-review-reveal">
                    <button
                      className="april-chip-button april-review-reveal-button"
                      type="button"
                      onClick={() => setShowAnswer((previous) => !previous)}
                    >
                      {showAnswer ? "Hide Answer" : "Reveal Answer"}
                    </button>
                  </div>
                  {showAnswer ? (
                    <div className="april-review-answer">
                      <p className="status">Due {new Date(currentCard.due_at).toLocaleString()}</p>
                      <p>{currentCard.answer}</p>
                    </div>
                  ) : null}
                </div>
                <div className="april-review-card-footer">
                  <span>Card ID: {currentCard.id}</span>
                  <span>Last review window: due {new Date(currentCard.due_at).toLocaleDateString()}</span>
                </div>
                <div className="april-review-ratings">
                  {REVIEW_OPTIONS.map((option) => (
                    <button
                      key={option.label}
                      className={`april-rating-button ${option.tone}`}
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
              <div className="april-review-empty">
                <h2>{missingConfig ? "Access required" : "No due cards loaded."}</h2>
                <p>
                  {missingConfig
                    ? "Open login, link the observatory, then return to this focused review surface."
                    : "The queue is empty until you load due cards or import a deck."}
                </p>
                <div className="assistant-inline-action-row">
                  <button
                    className="april-chip-button"
                    type="button"
                    onClick={() => void loadReviewData()}
                    disabled={missingConfig || loading}
                  >
                    {loading ? "Loading..." : "Load Due Cards"}
                  </button>
                  <Link className="april-chip-button muted" href={missingConfig ? "/login" : "/review/decks"}>
                    {missingConfig ? "Open Login" : "Open Deck Workspace"}
                  </Link>
                </div>
              </div>
            )}
          </AprilPanel>

          <div className="april-review-side">
            <AprilPanel className="april-review-side-card">
              <span className="review-sidebar-kicker">Knowledge Health</span>
              <div className="april-review-side-metrics">
                <div>
                  <strong>{cards.length}</strong>
                  <span>Cards Due</span>
                </div>
                <div>
                  <strong>{sessionRetention}%</strong>
                  <span>Retention</span>
                </div>
              </div>
              <div className="review-sidebar-chart" aria-hidden="true">
                {[40, 58, 52, 76, 84, 74, 90].map((height, index) => (
                  <span key={`bar-${index}`} style={{ height: `${height}%` }} className={index >= 4 ? "active" : ""} />
                ))}
              </div>
            </AprilPanel>

            <AprilPanel className="april-review-side-card">
              <span className="review-sidebar-kicker">Session Split</span>
              <p className="review-copy">
                Again {stats.again} | Hard {stats.hard} | Good {stats.good} | Easy {stats.easy}
              </p>
              <p className="review-copy">{status}</p>
              <div className="april-review-side-actions">
                <button className="april-chip-button" type="button" onClick={() => void loadReviewData()} disabled={loading || missingConfig}>
                  Refresh Queue
                </button>
                <Link className="april-chip-button muted" href="/review/decks">Deck Workspace</Link>
              </div>
            </AprilPanel>
          </div>
        </div>

        <div className="april-review-control-bar">
          <div className="april-review-control-actions">
            <button className="april-icon-button" type="button" onClick={() => setShowAnswer((previous) => !previous)} disabled={!currentCard}>
              {showAnswer ? "Hide" : "Reveal"}
            </button>
            <button className="april-icon-button" type="button" onClick={() => void loadReviewData()} disabled={loading || missingConfig}>
              Reload Queue
            </button>
          </div>
          <div className="april-review-shortcuts">
            <span><kbd>Space</kbd> to reveal</span>
            <span><kbd>1-4</kbd> to rate</span>
            <span>Deck progress {deckProgress(currentDeck)}%</span>
          </div>
          <Link className="april-icon-button" href={missingConfig ? "/login" : "/runtime"}>
            {missingConfig ? "Open Login" : "Session Settings"}
          </Link>
        </div>
      </section>
    </AprilWorkspaceShell>
  );
}
