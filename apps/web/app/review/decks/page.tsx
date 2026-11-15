"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest } from "../../lib/starlog-client";
import { useSessionConfig } from "../../session-provider";
import styles from "./deck-browser.module.css";

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
};

const DEFAULT_SCHEDULE: DeckSchedule = {
  new_cards_due_offset_hours: 24,
  initial_interval_days: 1,
  initial_ease_factor: 2.5,
};

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatDue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Due time unavailable";
  }
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function localDateTimeValue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const offsetMillis = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offsetMillis).toISOString().slice(0, 16);
}

export default function DeckBrowserPage() {
  const { apiBase, token } = useSessionConfig();
  const missingConfig = !apiBase || !token;
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState("all");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading decks...");
  const [loading, setLoading] = useState(false);

  const [deckName, setDeckName] = useState("");
  const [deckDescription, setDeckDescription] = useState("");
  const [deckSchedule, setDeckSchedule] = useState<DeckSchedule>(DEFAULT_SCHEDULE);
  const [editingDeckId, setEditingDeckId] = useState("");

  const [cardDeckId, setCardDeckId] = useState("");
  const [cardPrompt, setCardPrompt] = useState("");
  const [cardAnswer, setCardAnswer] = useState("");
  const [cardTags, setCardTags] = useState("");
  const [cardDueAt, setCardDueAt] = useState("");
  const [cardIntervalDays, setCardIntervalDays] = useState("1");
  const [cardRepetitions, setCardRepetitions] = useState("0");
  const [cardEaseFactor, setCardEaseFactor] = useState("2.5");
  const [cardSuspended, setCardSuspended] = useState(false);

  const selectedDeck = selectedDeckId === "all" ? null : decks.find((deck) => deck.id === selectedDeckId) ?? null;
  const editingDeck = decks.find((deck) => deck.id === editingDeckId) ?? null;
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;
  const deckById = useMemo(() => new Map(decks.map((deck) => [deck.id, deck])), [decks]);

  const visibleCards = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return cards;
    }
    return cards.filter((card) =>
      [
        card.prompt,
        card.answer,
        deckById.get(card.deck_id || "")?.name || "Inbox",
        ...(card.tags || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [cards, deckById, search]);

  const loadDecks = useCallback(async () => {
    const payload = await apiRequest<Deck[]>(apiBase, token, "/v1/cards/decks");
    setDecks(payload);
    setCardDeckId((previous) => previous || payload[0]?.id || "");
    setEditingDeckId((previous) => previous || payload[0]?.id || "");
    return payload;
  }, [apiBase, token]);

  const loadCards = useCallback(async (deckId: string) => {
    const params = new URLSearchParams({ limit: "500" });
    if (deckId !== "all") {
      params.set("deck_id", deckId);
    }
    const payload = await apiRequest<Card[]>(apiBase, token, `/v1/cards?${params.toString()}`);
    setCards(payload);
    setSelectedCardId((previous) => (payload.some((card) => card.id === previous) ? previous : payload[0]?.id || ""));
    return payload;
  }, [apiBase, token]);

  const reload = useCallback(async (deckId = selectedDeckId) => {
    if (missingConfig) {
      setDecks([]);
      setCards([]);
      setStatus("Sign in to load decks.");
      return;
    }
    setLoading(true);
    try {
      const [nextDecks, nextCards] = await Promise.all([loadDecks(), loadCards(deckId)]);
      const deckLabel = deckId === "all" ? "all decks" : nextDecks.find((deck) => deck.id === deckId)?.name || "selected deck";
      setStatus(`Loaded ${nextCards.length} cards from ${deckLabel}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load decks.");
    } finally {
      setLoading(false);
    }
  }, [loadCards, loadDecks, missingConfig, selectedDeckId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!editingDeck) {
      return;
    }
    setDeckName(editingDeck.name);
    setDeckDescription(editingDeck.description || "");
    setDeckSchedule(editingDeck.schedule);
  }, [editingDeck]);

  useEffect(() => {
    if (!selectedCard) {
      return;
    }
    setCardDeckId(selectedCard.deck_id || decks[0]?.id || "");
    setCardPrompt(selectedCard.prompt);
    setCardAnswer(selectedCard.answer);
    setCardTags((selectedCard.tags || []).join(", "));
    setCardDueAt(localDateTimeValue(selectedCard.due_at));
    setCardIntervalDays(String(selectedCard.interval_days));
    setCardRepetitions(String(selectedCard.repetitions));
    setCardEaseFactor(String(selectedCard.ease_factor));
    setCardSuspended(selectedCard.suspended);
  }, [decks, selectedCard]);

  function selectDeck(deckId: string) {
    setSelectedDeckId(deckId);
    setSelectedCardId("");
    if (deckId !== "all") {
      setCardDeckId(deckId);
      setEditingDeckId(deckId);
    }
    void reload(deckId);
  }

  function startNewDeck() {
    setEditingDeckId("");
    setDeckName("");
    setDeckDescription("");
    setDeckSchedule(DEFAULT_SCHEDULE);
  }

  function startNewCard() {
    setSelectedCardId("");
    setCardDeckId(selectedDeck?.id || decks[0]?.id || "");
    setCardPrompt("");
    setCardAnswer("");
    setCardTags("");
    setCardDueAt("");
    setCardIntervalDays("1");
    setCardRepetitions("0");
    setCardEaseFactor("2.5");
    setCardSuspended(false);
  }

  async function createDeck() {
    if (missingConfig) {
      setStatus("Sign in before creating decks.");
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
      setEditingDeckId(created.id);
      setSelectedDeckId(created.id);
      setCardDeckId(created.id);
      setStatus(`Created ${created.name}.`);
      await reload(created.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create deck.");
    }
  }

  async function saveDeck() {
    if (!editingDeckId) {
      await createDeck();
      return;
    }
    if (missingConfig) {
      setStatus("Sign in before saving decks.");
      return;
    }
    try {
      const updated = await apiRequest<Deck>(apiBase, token, `/v1/cards/decks/${editingDeckId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: deckName.trim() || undefined,
          description: deckDescription.trim() || null,
          schedule: deckSchedule,
        }),
      });
      setStatus(`Saved ${updated.name}.`);
      await reload(selectedDeckId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save deck.");
    }
  }

  async function createCard() {
    if (missingConfig) {
      setStatus("Sign in before creating cards.");
      return;
    }
    if (!cardPrompt.trim() || !cardAnswer.trim()) {
      setStatus("Prompt and answer are required.");
      return;
    }
    try {
      const created = await apiRequest<Card>(apiBase, token, "/v1/cards", {
        method: "POST",
        body: JSON.stringify({
          deck_id: cardDeckId || null,
          prompt: cardPrompt.trim(),
          answer: cardAnswer.trim(),
          tags: parseTags(cardTags),
          due_at: cardDueAt ? new Date(cardDueAt).toISOString() : undefined,
          interval_days: Number(cardIntervalDays || "1"),
          repetitions: Number(cardRepetitions || "0"),
          ease_factor: Number(cardEaseFactor || "2.5"),
          suspended: cardSuspended,
        }),
      });
      setSelectedCardId(created.id);
      setStatus(`Created card. First review: ${formatDue(created.due_at)}.`);
      await reload(selectedDeckId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create card.");
    }
  }

  async function saveCard() {
    if (!selectedCardId) {
      await createCard();
      return;
    }
    if (missingConfig) {
      setStatus("Sign in before saving cards.");
      return;
    }
    try {
      const updated = await apiRequest<Card>(apiBase, token, `/v1/cards/${selectedCardId}`, {
        method: "PATCH",
        body: JSON.stringify({
          deck_id: cardDeckId || null,
          prompt: cardPrompt.trim() || undefined,
          answer: cardAnswer.trim() || undefined,
          tags: parseTags(cardTags),
          due_at: cardDueAt ? new Date(cardDueAt).toISOString() : undefined,
          interval_days: Number(cardIntervalDays || "1"),
          repetitions: Number(cardRepetitions || "0"),
          ease_factor: Number(cardEaseFactor || "2.5"),
          suspended: cardSuspended,
        }),
      });
      setStatus(`Saved ${updated.id}.`);
      await reload(selectedDeckId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save card.");
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link className={styles.brand} href="/today">Starlog</Link>
          <h1>Decks</h1>
          <p>{status}</p>
        </div>
        <nav className={styles.nav} aria-label="Deck navigation">
          <Link href="/today">Today</Link>
          <Link href="/review">Review</Link>
          <Link href="/library">Library</Link>
          <Link href="/assistant">Assistant</Link>
        </nav>
      </header>

      <section className={styles.overview} aria-label="Deck summary">
        <div>
          <span>Decks</span>
          <strong>{decks.length}</strong>
          <small>{selectedDeck?.name || "All decks"}</small>
        </div>
        <div>
          <span>Cards</span>
          <strong>{cards.length}</strong>
          <small>{visibleCards.length} visible</small>
        </div>
        <div>
          <span>Due</span>
          <strong>{selectedDeck?.due_count ?? decks.reduce((total, deck) => total + deck.due_count, 0)}</strong>
          <small>ready now</small>
        </div>
      </section>

      <section className={styles.deckStrip} aria-label="Deck filters">
        <button data-active={selectedDeckId === "all"} type="button" onClick={() => selectDeck("all")}>
          All decks
          <span>{decks.reduce((total, deck) => total + deck.card_count, 0)}</span>
        </button>
        {decks.map((deck) => (
          <button
            key={deck.id}
            data-active={selectedDeckId === deck.id}
            type="button"
            onClick={() => selectDeck(deck.id)}
          >
            {deck.name}
            <span>{deck.card_count}</span>
          </button>
        ))}
        <button type="button" onClick={startNewDeck}>New deck</button>
        <button type="button" onClick={startNewCard}>New card</button>
        <button type="button" onClick={() => void reload()} disabled={loading}>Refresh</button>
      </section>

      <section className={styles.workspace}>
        <section className={styles.panel} aria-labelledby="deck-list-title">
          <div className={styles.panelHead}>
            <div>
              <p>Browse</p>
              <h2 id="deck-list-title">Cards</h2>
            </div>
            <label className={styles.searchField}>
              <span>Search</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="chip, gradient, leakage..." />
            </label>
          </div>
          {visibleCards.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>No cards here</h3>
              <p>{missingConfig ? "Sign in to load cards." : "Try another deck or clear search."}</p>
            </div>
          ) : (
            <ul className={styles.cardList}>
              {visibleCards.map((card) => (
                <li key={card.id}>
                  <button
                    className={selectedCardId === card.id ? styles.selectedCard : ""}
                    type="button"
                    onClick={() => setSelectedCardId(card.id)}
                  >
                    <strong>{card.prompt}</strong>
                    <span>{deckById.get(card.deck_id || "")?.name || "Inbox"} | {formatDue(card.due_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="card-editor-title">
          <div className={styles.panelHead}>
            <div>
              <p>{selectedCard ? "Edit" : "Create"}</p>
              <h2 id="card-editor-title">{selectedCard ? "Selected card" : "New card"}</h2>
            </div>
            <button type="button" onClick={startNewCard}>Clear</button>
          </div>
          <label className={styles.field}>
            <span>Deck</span>
            <select value={cardDeckId} onChange={(event) => setCardDeckId(event.target.value)}>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>{deck.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Prompt</span>
            <textarea value={cardPrompt} onChange={(event) => setCardPrompt(event.target.value)} rows={5} />
          </label>
          <label className={styles.field}>
            <span>Answer</span>
            <textarea value={cardAnswer} onChange={(event) => setCardAnswer(event.target.value)} rows={6} />
          </label>
          <label className={styles.field}>
            <span>Tags</span>
            <input value={cardTags} onChange={(event) => setCardTags(event.target.value)} placeholder="comma separated" />
          </label>
          <details className={styles.details}>
            <summary>Advanced schedule</summary>
            <label className={styles.field}>
              <span>Due at</span>
              <input type="datetime-local" value={cardDueAt} onChange={(event) => setCardDueAt(event.target.value)} />
            </label>
            <div className={styles.threeColumn}>
              <label className={styles.field}>
                <span>Interval days</span>
                <input type="number" value={cardIntervalDays} onChange={(event) => setCardIntervalDays(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Repetitions</span>
                <input type="number" value={cardRepetitions} onChange={(event) => setCardRepetitions(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Ease</span>
                <input type="number" step="0.1" value={cardEaseFactor} onChange={(event) => setCardEaseFactor(event.target.value)} />
              </label>
            </div>
            <label className={styles.checkField}>
              <input type="checkbox" checked={cardSuspended} onChange={(event) => setCardSuspended(event.target.checked)} />
              Suspended
            </label>
          </details>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} type="button" onClick={() => void saveCard()}>
              {selectedCard ? "Save card" : "Create card"}
            </button>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.deckEditor}`} aria-labelledby="deck-editor-title">
          <div className={styles.panelHead}>
            <div>
              <p>Deck</p>
              <h2 id="deck-editor-title">{editingDeck ? "Selected deck" : "New deck"}</h2>
            </div>
            <button type="button" onClick={startNewDeck}>Clear</button>
          </div>
          <label className={styles.field}>
            <span>Name</span>
            <input value={deckName} onChange={(event) => setDeckName(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Description</span>
            <textarea value={deckDescription} onChange={(event) => setDeckDescription(event.target.value)} rows={4} />
          </label>
          <details className={styles.details}>
            <summary>Deck schedule</summary>
            <div className={styles.threeColumn}>
              <label className={styles.field}>
                <span>New card due offset</span>
                <input
                  type="number"
                  value={deckSchedule.new_cards_due_offset_hours}
                  onChange={(event) => setDeckSchedule((previous) => ({ ...previous, new_cards_due_offset_hours: Number(event.target.value || 0) }))}
                />
              </label>
              <label className={styles.field}>
                <span>Initial interval</span>
                <input
                  type="number"
                  value={deckSchedule.initial_interval_days}
                  onChange={(event) => setDeckSchedule((previous) => ({ ...previous, initial_interval_days: Number(event.target.value || 1) }))}
                />
              </label>
              <label className={styles.field}>
                <span>Initial ease</span>
                <input
                  type="number"
                  step="0.1"
                  value={deckSchedule.initial_ease_factor}
                  onChange={(event) => setDeckSchedule((previous) => ({ ...previous, initial_ease_factor: Number(event.target.value || 2.5) }))}
                />
              </label>
            </div>
          </details>
          <button className={styles.primaryButton} type="button" onClick={() => void saveDeck()}>
            {editingDeck ? "Save deck" : "Create deck"}
          </button>
        </section>
      </section>
    </main>
  );
}
