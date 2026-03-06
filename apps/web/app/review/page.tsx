"use client";

import { useMemo, useState } from "react";

import { SessionControls } from "../components/session-controls";
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

export default function ReviewPage() {
  const { apiBase, token, mutateWithQueue } = useSessionConfig();
  const [cards, setCards] = useState<Card[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stats, setStats] = useState<SessionStats>({ reviewed: 0, again: 0, good: 0, easy: 0 });
  const [status, setStatus] = useState("Ready");
  const currentCard = cards[currentIndex] ?? null;
  const duePreview = useMemo(() => cards.slice(0, 6), [cards]);

  async function loadDue() {
    try {
      const payload = await apiRequest<Card[]>(apiBase, token, "/v1/cards/due?limit=20");
      setCards(payload);
      setCurrentIndex(0);
      setShowAnswer(false);
      setStats({ reviewed: 0, again: 0, good: 0, easy: 0 });
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

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Review</p>
          <h1>Focused review session</h1>
          <div className="button-row">
            <button className="button" type="button" onClick={() => loadDue()}>Refresh Due Cards</button>
            <button
              className="button"
              type="button"
              onClick={() => setShowAnswer((previous) => !previous)}
              disabled={!currentCard}
            >
              {showAnswer ? "Hide Answer" : "Reveal Answer"}
            </button>
          </div>
          <p className="console-copy">Queue remaining: {cards.length}</p>
          <p className="status">{status}</p>
        </div>
        <div className="panel glass">
          {!currentCard ? (
            <p className="console-copy">No due cards.</p>
          ) : (
            <div>
              <p><strong>{currentCard.prompt}</strong></p>
              <p className="console-copy">Due: {new Date(currentCard.due_at).toLocaleString()}</p>
              {showAnswer ? <p className="console-copy">Answer: {currentCard.answer}</p> : null}
              <div className="button-row">
                <button className="button" type="button" onClick={() => reviewCurrent(2)}>Again</button>
                <button className="button" type="button" onClick={() => reviewCurrent(4)}>Good</button>
                <button className="button" type="button" onClick={() => reviewCurrent(5)}>Easy</button>
              </div>
            </div>
          )}

          <h2>Session metrics</h2>
          <p className="console-copy">Reviewed: {stats.reviewed}</p>
          <p className="console-copy">Again: {stats.again} / Good: {stats.good} / Easy: {stats.easy}</p>

          <h2>Queue preview</h2>
          {duePreview.length === 0 ? (
            <p className="console-copy">No queued cards.</p>
          ) : (
            <ul>
              {duePreview.map((card) => (
                <li key={card.id}>
                  <p className="console-copy">{card.prompt}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
