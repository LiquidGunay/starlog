"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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

const SURFACE_LINKS = [
  { href: "/assistant", label: "Main Room", icon: "✦" },
  { href: "/notes", label: "Knowledge Base", icon: "⌘" },
  { href: "/review", label: "SRS Review", icon: "◎" },
  { href: "/planner", label: "Agenda", icon: "◌" },
];

function emptyStats(): SessionStats {
  return { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };
}

function deckProgress(deck: Deck): number {
  if (deck.card_count <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(((deck.card_count - deck.due_count) / deck.card_count) * 100)));
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
  const sessionRetention = stats.reviewed > 0 ? Math.round(((stats.good + stats.easy) / stats.reviewed) * 100) : 0;

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
    <div className="review-station">
      <header className="review-station-topbar">
        <div className="review-topbar-brand">
          <span>Starlog</span>
        </div>
        <nav className="review-topbar-nav" aria-label="Primary review routes">
          <Link href="/artifacts">Archive</Link>
          <Link href="/review" className="active">SRS Review</Link>
          <Link href="/notes">Knowledge Base</Link>
        </nav>
        <div className="review-topbar-actions">
          <Link href="/runtime">Runtime</Link>
          <Link href="/login">{missingConfig ? "Login" : "Linked"}</Link>
        </div>
      </header>

      <aside className="review-station-rail">
        <div className="review-rail-profile">
          <div className="review-rail-avatar">◉</div>
          <div>
            <strong>The Observatory</strong>
            <span>Stellar Tier</span>
          </div>
        </div>

        <nav className="review-rail-nav" aria-label="Primary surfaces">
          {SURFACE_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={link.href === "/review" ? "review-rail-link active" : "review-rail-link"}
            >
              <span>{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>

        <section className="review-rail-section">
          <span className="review-rail-label">Active Decks</span>
          <div className="review-rail-decks">
            {activeDecks.length === 0 ? (
              <p className="review-copy">No active decks loaded yet.</p>
            ) : (
              activeDecks.slice(0, 6).map((deck) => (
                <div key={deck.id} className={deck.id === currentCard?.deck_id ? "review-rail-deck active" : "review-rail-deck"}>
                  <strong>{deck.name}</strong>
                  <span>{deck.due_count > 0 ? `${deck.due_count} due` : "stable"}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="review-rail-footer">
          <Link href="/review/decks">Deck Workspace</Link>
          <Link href="/runtime">Runtime</Link>
        </div>
      </aside>

      <main className="review-station-main">
        <section className="review-session-progress">
          <div className="review-session-progress-head">
            <div>
              <span>Session Progress</span>
              <strong>
                {currentCard ? `Card ${stats.reviewed + 1} of ${Math.max(reviewedTotal, 1)}` : "Awaiting queue"}
              </strong>
            </div>
            <span>{stats.reviewed} reviewed</span>
          </div>
          <div className="review-session-progress-bar">
            <span style={{ width: `${reviewedTotal > 0 ? (stats.reviewed / reviewedTotal) * 100 : 0}%` }} />
          </div>
        </section>

        <section className="review-focus-shell">
          <article className="review-focus-card">
            {currentCard ? (
              <>
                <div className="review-focus-meta">
                  <span>{currentDeck ? currentDeck.name : "Focused review"}</span>
                  <span>{currentCard.card_type.replace(/_/g, " ")}</span>
                </div>
                <div className="review-focus-question">
                  {currentCard.prompt}
                </div>
                <div className="review-focus-actions">
                  <button className="review-reveal-button" type="button" onClick={() => setShowAnswer((previous) => !previous)}>
                    {showAnswer ? "Hide Answer" : "Reveal Answer"}
                  </button>
                </div>
                {showAnswer ? (
                  <div className="review-focus-answer">
                    <p className="review-copy">Due {new Date(currentCard.due_at).toLocaleString()}</p>
                    <p>{currentCard.answer}</p>
                  </div>
                ) : null}
                <div className="review-rating-grid">
                  {[
                    { label: "Again", hint: "< 1m", rating: 1 as const },
                    { label: "Hard", hint: "1d", rating: 3 as const },
                    { label: "Good", hint: "3d", rating: 4 as const },
                    { label: "Easy", hint: "5d", rating: 5 as const },
                  ].map((option) => (
                    <button
                      key={option.label}
                      className={option.label === "Good" ? "review-rating-button primary" : "review-rating-button"}
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
              <div className="review-empty-state">
                <h1>{missingConfig ? "Access required" : "No due cards loaded."}</h1>
                <p>
                  {missingConfig
                    ? "Open the login screen, link the observatory, then return to this focused review surface."
                    : "The queue is empty until you load due cards or import a deck."}
                </p>
                <div className="review-inline-actions">
                  <button className="review-inline-button primary" type="button" onClick={() => void loadReviewData()} disabled={missingConfig || loading}>
                    {loading ? "Loading..." : "Load Due Cards"}
                  </button>
                  <Link className="review-inline-button" href={missingConfig ? "/login" : "/review/decks"}>
                    {missingConfig ? "Open Login" : "Open Deck Workspace"}
                  </Link>
                </div>
              </div>
            )}
          </article>

          <aside className="review-focus-sidebar">
            <section className="review-sidebar-card">
              <span className="review-sidebar-kicker">Knowledge Health</span>
              <div className="review-sidebar-metrics">
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
            </section>

            <section className="review-sidebar-card">
              <span className="review-sidebar-kicker">Session Split</span>
              <p className="review-copy">
                Again {stats.again} | Hard {stats.hard} | Good {stats.good} | Easy {stats.easy}
              </p>
              <p className="review-copy">{status}</p>
              <div className="review-inline-actions stacked">
                <button className="review-inline-button" type="button" onClick={() => void loadReviewData()} disabled={loading || missingConfig}>
                  Refresh Queue
                </button>
                <Link className="review-inline-button" href="/review/decks">Deck Workspace</Link>
              </div>
            </section>
          </aside>
        </section>

        <footer className="review-focus-footer">
          <div>
            <button className="review-footer-button" type="button" onClick={() => setShowAnswer((previous) => !previous)} disabled={!currentCard}>
              {showAnswer ? "Hide answer" : "Reveal answer"}
            </button>
            <button className="review-footer-button" type="button" onClick={() => void loadReviewData()} disabled={loading || missingConfig}>
              Reload queue
            </button>
          </div>
          <div className="review-footer-shortcuts">
            <span>Deck progress {currentDeck ? `${deckProgress(currentDeck)}%` : "0%"}</span>
            <span>{currentCard ? `Due ${new Date(currentCard.due_at).toLocaleDateString()}` : "Queue idle"}</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
