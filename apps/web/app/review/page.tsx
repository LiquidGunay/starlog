"use client";

import { useState } from "react";

import { SessionControls } from "../components/session-controls";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type Card = {
  id: string;
  prompt: string;
  answer: string;
  due_at: string;
};

export default function ReviewPage() {
  const { apiBase, token } = useSessionConfig();
  const [cards, setCards] = useState<Card[]>([]);
  const [status, setStatus] = useState("Ready");

  async function loadDue() {
    try {
      const payload = await apiRequest<Card[]>(apiBase, token, "/v1/cards/due?limit=20");
      setCards(payload);
      setStatus(`Loaded ${payload.length} due cards`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load due cards");
    }
  }

  async function review(cardId: string, rating: number) {
    try {
      await apiRequest(apiBase, token, "/v1/reviews", {
        method: "POST",
        body: JSON.stringify({ card_id: cardId, rating }),
      });
      setStatus(`Reviewed card ${cardId} with rating ${rating}`);
      await loadDue();
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
          <h1>Due card queue</h1>
          <div className="button-row">
            <button className="button" type="button" onClick={() => loadDue()}>Refresh Due Cards</button>
          </div>
          <p className="status">{status}</p>
        </div>
        <div className="panel glass">
          {cards.length === 0 ? (
            <p className="console-copy">No due cards.</p>
          ) : (
            <ul>
              {cards.map((card) => (
                <li key={card.id}>
                  <p><strong>{card.prompt}</strong></p>
                  <p className="console-copy">Answer: {card.answer}</p>
                  <div className="button-row">
                    <button className="button" type="button" onClick={() => review(card.id, 2)}>Again</button>
                    <button className="button" type="button" onClick={() => review(card.id, 4)}>Good</button>
                    <button className="button" type="button" onClick={() => review(card.id, 5)}>Easy</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
