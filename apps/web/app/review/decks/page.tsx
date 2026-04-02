"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest } from "../../lib/starlog-client";
import { useSessionConfig } from "../../session-provider";

type DeckSchedule = {
  new_cards_due_offset_hours: number;
  initial_interval_days: number;
  initial_ease_factor: number;
};

type Deck = {
  id: string;
  name: string;
  description?: string | null;
  schedule: DeckSchedule;
  card_count: number;
  due_count: number;
  created_at: string;
  updated_at: string;
};

type Card = {
  id: string;
  deck_id?: string | null;
  prompt: string;
  answer: string;
  tags: string[];
  suspended: boolean;
  due_at: string;
  interval_days: number;
  repetitions: number;
  ease_factor: number;
  created_at: string;
  updated_at?: string | null;
};

const DEFAULT_SCHEDULE: DeckSchedule = {
  new_cards_due_offset_hours: 24,
  initial_interval_days: 1,
  initial_ease_factor: 2.5,
};

export default function DeckBrowserPage() {
  const { apiBase, token } = useSessionConfig();
  const missingToken = !token;
  const missingApiBase = !apiBase;
  const missingConfig = missingToken || missingApiBase;
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [status, setStatus] = useState("Ready");
  const [selectedDeckFilter, setSelectedDeckFilter] = useState("all");
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [selectedCardId, setSelectedCardId] = useState("");

  const [deckName, setDeckName] = useState("");
  const [deckDescription, setDeckDescription] = useState("");
  const [deckSchedule, setDeckSchedule] = useState<DeckSchedule>(DEFAULT_SCHEDULE);

  const [cardPrompt, setCardPrompt] = useState("");
  const [cardAnswer, setCardAnswer] = useState("");
  const [cardTags, setCardTags] = useState("");
  const [cardDeckId, setCardDeckId] = useState("");
  const [cardDueAt, setCardDueAt] = useState("");
  const [cardIntervalDays, setCardIntervalDays] = useState("1");
  const [cardRepetitions, setCardRepetitions] = useState("0");
  const [cardEaseFactor, setCardEaseFactor] = useState("2.5");
  const [cardSuspended, setCardSuspended] = useState(false);

  const deckMap = useMemo(() => new Map(decks.map((deck) => [deck.id, deck])), [decks]);
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? null;
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;

  const loadDecks = useCallback(async () => {
    if (missingConfig) {
      setDecks([]);
      return [];
    }
    const payload = await apiRequest<Deck[]>(apiBase, token, "/v1/cards/decks");
    setDecks(payload);
    if (!selectedDeckId && payload[0]) {
      setSelectedDeckId(payload[0].id);
      setCardDeckId(payload[0].id);
    }
    return payload;
  }, [apiBase, missingConfig, selectedDeckId, token]);

  const loadCards = useCallback(async (nextDeckFilter = selectedDeckFilter) => {
    if (missingConfig) {
      setCards([]);
      return [];
    }
    const params = new URLSearchParams({ limit: "500" });
    if (nextDeckFilter !== "all") {
      params.set("deck_id", nextDeckFilter);
    }
    const payload = await apiRequest<Card[]>(apiBase, token, `/v1/cards?${params.toString()}`);
    setCards(payload);
    return payload;
  }, [apiBase, missingConfig, selectedDeckFilter, token]);

  const reload = useCallback(async (nextDeckFilter = selectedDeckFilter) => {
    if (missingConfig) {
      setDecks([]);
      setCards([]);
      setStatus("Connect to the API to load decks and cards.");
      return;
    }
    try {
      const [nextDecks, nextCards] = await Promise.all([loadDecks(), loadCards(nextDeckFilter)]);
      setStatus(`Loaded ${nextDecks.length} decks and ${nextCards.length} cards`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load decks and cards");
    }
  }, [loadCards, loadDecks, missingConfig, selectedDeckFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selectedDeck) {
      return;
    }
    setDeckName(selectedDeck.name);
    setDeckDescription(selectedDeck.description || "");
    setDeckSchedule(selectedDeck.schedule);
  }, [selectedDeck]);

  useEffect(() => {
    if (!selectedCard) {
      return;
    }
    setCardPrompt(selectedCard.prompt);
    setCardAnswer(selectedCard.answer);
    setCardTags(selectedCard.tags.join(", "));
    setCardDeckId(selectedCard.deck_id || "");
    setCardDueAt(selectedCard.due_at.slice(0, 16));
    setCardIntervalDays(String(selectedCard.interval_days));
    setCardRepetitions(String(selectedCard.repetitions));
    setCardEaseFactor(String(selectedCard.ease_factor));
    setCardSuspended(selectedCard.suspended);
  }, [selectedCard]);

  function clearDeckEditor() {
    setSelectedDeckId("");
    setDeckName("");
    setDeckDescription("");
    setDeckSchedule(DEFAULT_SCHEDULE);
  }

  function clearCardEditor(deckId = cardDeckId || selectedDeckFilter) {
    setSelectedCardId("");
    setCardPrompt("");
    setCardAnswer("");
    setCardTags("");
    setCardDeckId(deckId === "all" ? "" : deckId);
    setCardDueAt("");
    setCardIntervalDays("1");
    setCardRepetitions("0");
    setCardEaseFactor("2.5");
    setCardSuspended(false);
  }

  async function createDeck() {
    if (missingConfig) {
      setStatus("Connect to the API before creating decks.");
      return;
    }
    try {
      const created = await apiRequest<Deck>(apiBase, token, "/v1/cards/decks", {
        method: "POST",
        body: JSON.stringify({
          name: deckName.trim() || "New Deck",
          description: deckDescription.trim() || null,
          schedule: deckSchedule,
        }),
      });
      setSelectedDeckId(created.id);
      setCardDeckId(created.id);
      setStatus(`Created deck ${created.name}`);
      await reload(selectedDeckFilter);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create deck");
    }
  }

  async function saveDeck() {
    if (!selectedDeckId) {
      setStatus("Select a deck or create a new one");
      return;
    }
    if (missingConfig) {
      setStatus("Connect to the API before saving decks.");
      return;
    }
    try {
      const updated = await apiRequest<Deck>(apiBase, token, `/v1/cards/decks/${selectedDeckId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: deckName.trim() || undefined,
          description: deckDescription.trim() || null,
          schedule: deckSchedule,
        }),
      });
      setStatus(`Saved deck ${updated.name}`);
      await reload(selectedDeckFilter);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save deck");
    }
  }

  async function createCard() {
    if (missingConfig) {
      setStatus("Connect to the API before creating cards.");
      return;
    }
    try {
      const created = await apiRequest<Card>(apiBase, token, "/v1/cards", {
        method: "POST",
        body: JSON.stringify({
          deck_id: cardDeckId || null,
          prompt: cardPrompt.trim() || "New prompt",
          answer: cardAnswer.trim() || "New answer",
          tags: cardTags.split(",").map((item) => item.trim()).filter(Boolean),
          due_at: cardDueAt ? new Date(cardDueAt).toISOString() : undefined,
          interval_days: Number(cardIntervalDays || "1"),
          repetitions: Number(cardRepetitions || "0"),
          ease_factor: Number(cardEaseFactor || "2.5"),
          suspended: cardSuspended,
        }),
      });
      setSelectedCardId(created.id);
      setStatus(`Created card ${created.id}`);
      await reload(selectedDeckFilter);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create card");
    }
  }

  async function saveCard() {
    if (!selectedCardId) {
      setStatus("Select a card or create a new one");
      return;
    }
    if (missingConfig) {
      setStatus("Connect to the API before saving cards.");
      return;
    }
    try {
      const updated = await apiRequest<Card>(apiBase, token, `/v1/cards/${selectedCardId}`, {
        method: "PATCH",
        body: JSON.stringify({
          deck_id: cardDeckId || null,
          prompt: cardPrompt.trim() || undefined,
          answer: cardAnswer.trim() || undefined,
          tags: cardTags.split(",").map((item) => item.trim()).filter(Boolean),
          due_at: cardDueAt ? new Date(cardDueAt).toISOString() : undefined,
          interval_days: Number(cardIntervalDays || "1"),
          repetitions: Number(cardRepetitions || "0"),
          ease_factor: Number(cardEaseFactor || "2.5"),
          suspended: cardSuspended,
        }),
      });
      setStatus(`Saved card ${updated.id}`);
      await reload(selectedDeckFilter);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save card");
    }
  }

  return (
    <main className="shell">
      <section className="workspace glass">
        <div className="panel glass review-browser-hero">
          <div>
            <p className="eyebrow">Neural Sync</p>
            <h1>Deck Browser</h1>
            <p className="console-copy">
              Browse every card, create focused decks, tag items, and tune the initial schedule without waiting for cards to become due.
            </p>
          </div>
          <div className="button-row">
            <Link className="button" href="/review">Due Queue</Link>
            <button className="button" type="button" onClick={() => reload(selectedDeckFilter)} disabled={missingConfig}>Refresh</button>
            <button className="button" type="button" onClick={() => clearDeckEditor()} disabled={missingConfig}>New Deck</button>
            <button className="button" type="button" onClick={() => clearCardEditor()} disabled={missingConfig}>New Card</button>
            {missingConfig ? <Link className="button" href="/runtime">Open Runtime</Link> : null}
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass review-browser-deck-strip">
          <h2>Deck filters</h2>
          <div className="button-row">
            <button
              className="button"
              type="button"
              onClick={() => {
                setSelectedDeckFilter("all");
                void reload("all");
              }}
              disabled={missingConfig}
            >
              All decks
            </button>
            {decks.map((deck) => (
              <button
                key={deck.id}
                className="button"
                type="button"
                onClick={() => {
                  setSelectedDeckFilter(deck.id);
                  setSelectedDeckId(deck.id);
                  setCardDeckId(deck.id);
                  void reload(deck.id);
                }}
                disabled={missingConfig}
              >
                {deck.name} ({deck.card_count})
              </button>
            ))}
          </div>
        </div>

        <div className="console-grid">
          <div className="panel glass">
            <h2>Decks</h2>
            {decks.length === 0 ? (
              <p className="console-copy">
                {missingConfig ? "Connect to the API to load decks." : "No decks loaded yet."}
              </p>
            ) : (
              <ul className="review-browser-list">
                {decks.map((deck) => (
                  <li key={deck.id} className={deck.id === selectedDeckId ? "review-browser-item active" : "review-browser-item"}>
                    <button className="button" type="button" onClick={() => setSelectedDeckId(deck.id)}>
                      {deck.name}
                    </button>
                    <p className="console-copy">
                      {deck.card_count} cards | {deck.due_count} due
                    </p>
                    {deck.description ? <p className="console-copy">{deck.description}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel glass">
            <h2>Deck editor</h2>
            <label className="label" htmlFor="deck-name">Deck name</label>
            <input id="deck-name" className="input" value={deckName} onChange={(event) => setDeckName(event.target.value)} />
            <label className="label" htmlFor="deck-description">Description</label>
            <textarea
              id="deck-description"
              className="textarea"
              value={deckDescription}
              onChange={(event) => setDeckDescription(event.target.value)}
            />
            <label className="label" htmlFor="deck-offset">New card due offset (hours)</label>
            <input
              id="deck-offset"
              className="input"
              type="number"
              value={deckSchedule.new_cards_due_offset_hours}
              onChange={(event) => setDeckSchedule((previous) => ({
                ...previous,
                new_cards_due_offset_hours: Number(event.target.value || "0"),
              }))}
            />
            <label className="label" htmlFor="deck-interval">Initial interval (days)</label>
            <input
              id="deck-interval"
              className="input"
              type="number"
              value={deckSchedule.initial_interval_days}
              onChange={(event) => setDeckSchedule((previous) => ({
                ...previous,
                initial_interval_days: Number(event.target.value || "1"),
              }))}
            />
            <label className="label" htmlFor="deck-ease">Initial ease factor</label>
            <input
              id="deck-ease"
              className="input"
              type="number"
              step="0.1"
              value={deckSchedule.initial_ease_factor}
              onChange={(event) => setDeckSchedule((previous) => ({
                ...previous,
                initial_ease_factor: Number(event.target.value || "2.5"),
              }))}
            />
            <div className="button-row">
              <button className="button" type="button" onClick={() => createDeck()} disabled={missingConfig}>Create Deck</button>
              <button className="button" type="button" onClick={() => saveDeck()} disabled={missingConfig}>Save Selected</button>
            </div>
          </div>

          <div className="panel glass">
            <h2>Cards</h2>
            {cards.length === 0 ? (
              <p className="console-copy">
                {missingConfig ? "Connect to the API to load cards." : "No cards loaded for this filter."}
              </p>
            ) : (
              <ul className="review-browser-list scroll-panel">
                {cards.map((card) => (
                  <li key={card.id} className={card.id === selectedCardId ? "review-browser-item active" : "review-browser-item"}>
                    <button className="button" type="button" onClick={() => setSelectedCardId(card.id)}>
                      {card.prompt}
                    </button>
                    <p className="console-copy">
                      Deck: {deckMap.get(card.deck_id || "")?.name || "Inbox"} | Due: {new Date(card.due_at).toLocaleString()}
                    </p>
                    <div className="chips">
                      {card.tags.map((tag) => <span key={`${card.id}-${tag}`} className="chip">{tag}</span>)}
                      {card.suspended ? <span className="chip">suspended</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel glass">
            <h2>Card editor</h2>
            <label className="label" htmlFor="card-deck">Deck</label>
            <select
              id="card-deck"
              className="input"
              value={cardDeckId}
              onChange={(event) => setCardDeckId(event.target.value)}
            >
              <option value="">Inbox</option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>{deck.name}</option>
              ))}
            </select>
            <label className="label" htmlFor="card-prompt">Prompt</label>
            <textarea id="card-prompt" className="textarea" value={cardPrompt} onChange={(event) => setCardPrompt(event.target.value)} />
            <label className="label" htmlFor="card-answer">Answer</label>
            <textarea id="card-answer" className="textarea" value={cardAnswer} onChange={(event) => setCardAnswer(event.target.value)} />
            <label className="label" htmlFor="card-tags">Tags (comma separated)</label>
            <input id="card-tags" className="input" value={cardTags} onChange={(event) => setCardTags(event.target.value)} />
            <label className="label" htmlFor="card-due">Due at</label>
            <input id="card-due" className="input" type="datetime-local" value={cardDueAt} onChange={(event) => setCardDueAt(event.target.value)} />
            <label className="label" htmlFor="card-interval">Interval days</label>
            <input id="card-interval" className="input" type="number" value={cardIntervalDays} onChange={(event) => setCardIntervalDays(event.target.value)} />
            <label className="label" htmlFor="card-repetitions">Repetitions</label>
            <input id="card-repetitions" className="input" type="number" value={cardRepetitions} onChange={(event) => setCardRepetitions(event.target.value)} />
            <label className="label" htmlFor="card-ease">Ease factor</label>
            <input id="card-ease" className="input" type="number" step="0.1" value={cardEaseFactor} onChange={(event) => setCardEaseFactor(event.target.value)} />
            <label className="label review-browser-checkbox">
              <input type="checkbox" checked={cardSuspended} onChange={(event) => setCardSuspended(event.target.checked)} />
              Suspend this card
            </label>
            <div className="button-row">
              <button className="button" type="button" onClick={() => createCard()} disabled={missingConfig}>Create Card</button>
              <button className="button" type="button" onClick={() => saveCard()} disabled={missingConfig}>Save Selected</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
