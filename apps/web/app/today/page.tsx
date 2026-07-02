"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";
import styles from "./today.module.css";

type Deck = {
  id: string;
  name: string;
  description?: string | null;
  card_count: number;
  due_count: number;
};

type Card = {
  id: string;
  deck_id?: string | null;
  card_type: string;
  prompt: string;
  answer: string;
  due_at: string;
};

type DailyNote = {
  id: string;
  date: string;
  note_id: string;
  morning_plan_md: string;
  evening_reflection_md: string;
  version: number;
  created_at: string;
  updated_at: string;
};

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatDue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Due time unavailable";
  }
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function tagsFromInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function TodayPage() {
  const { apiBase, token } = useSessionConfig();
  const [date, setDate] = useState(todayIsoDate);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [dueCards, setDueCards] = useState<Card[]>([]);
  const [dailyNote, setDailyNote] = useState<DailyNote | null>(null);
  const [morningPlan, setMorningPlan] = useState("");
  const [eveningReflection, setEveningReflection] = useState("");
  const [cardDeckId, setCardDeckId] = useState("");
  const [cardPrompt, setCardPrompt] = useState("");
  const [cardAnswer, setCardAnswer] = useState("");
  const [cardTags, setCardTags] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [status, setStatus] = useState("Loading today...");
  const [dailyStatus, setDailyStatus] = useState("Draft ready");
  const [cardStatus, setCardStatus] = useState("Manual card ready");
  const [reviewStatus, setReviewStatus] = useState("Review queue ready");
  const [loading, setLoading] = useState(false);
  const [savingDaily, setSavingDaily] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);
  const currentCard = dueCards[0] ?? null;

  const deckById = useMemo(() => new Map(decks.map((deck) => [deck.id, deck])), [decks]);
  const selectedDeck = decks.find((deck) => deck.id === cardDeckId) ?? decks[0] ?? null;
  const dueCount = dueCards.length;

  const loadDecks = useCallback(async () => {
    const payload = await apiRequest<Deck[]>(apiBase, token, "/v1/cards/decks");
    setDecks(payload);
    setCardDeckId((previous) => previous || payload[0]?.id || "");
    return payload;
  }, [apiBase, token]);

  const loadDueCards = useCallback(async () => {
    const payload = await apiRequest<Card[]>(apiBase, token, "/v1/cards/due?limit=12");
    setDueCards(payload);
    setShowAnswer(false);
    return payload;
  }, [apiBase, token]);

  const loadDailyNote = useCallback(async (entryDate: string) => {
    try {
      const payload = await apiRequest<DailyNote>(apiBase, token, `/v1/daily-notes/${entryDate}`);
      setDailyNote(payload);
      setMorningPlan(payload.morning_plan_md);
      setEveningReflection(payload.evening_reflection_md);
      setDailyStatus(`Loaded v${payload.version}`);
      return payload;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setDailyNote(null);
        setMorningPlan("");
        setEveningReflection("");
        setDailyStatus("No entry saved yet");
        return null;
      }
      throw error;
    }
  }, [apiBase, token]);

  const loadToday = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const [, cards] = await Promise.all([loadDecks(), loadDueCards(), loadDailyNote(date)]);
      setStatus(`${cards.length} due card${cards.length === 1 ? "" : "s"} loaded for ${formatShortDate(date)}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load today");
    } finally {
      setLoading(false);
    }
  }, [date, loadDailyNote, loadDecks, loadDueCards, token]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  async function saveDailyNote() {
    setSavingDaily(true);
    try {
      const payload = await apiRequest<DailyNote>(apiBase, token, `/v1/daily-notes/${date}`, {
        method: "PUT",
        body: JSON.stringify({
          morning_plan_md: morningPlan,
          evening_reflection_md: eveningReflection,
        }),
      });
      setDailyNote(payload);
      setDailyStatus(`Saved v${payload.version}`);
    } catch (error) {
      setDailyStatus(error instanceof Error ? error.message : "Failed to save daily note");
    } finally {
      setSavingDaily(false);
    }
  }

  async function createCard() {
    if (!cardPrompt.trim() || !cardAnswer.trim()) {
      setCardStatus("Prompt and answer are required.");
      return;
    }
    setCreatingCard(true);
    try {
      const created = await apiRequest<Card>(apiBase, token, "/v1/cards", {
        method: "POST",
        body: JSON.stringify({
          deck_id: cardDeckId || null,
          prompt: cardPrompt.trim(),
          answer: cardAnswer.trim(),
          tags: tagsFromInput(cardTags),
        }),
      });
      setCardPrompt("");
      setCardAnswer("");
      setCardTags("");
      setCardStatus(`Saved card. First review: ${formatDue(created.due_at)}.`);
      await loadDecks();
    } catch (error) {
      setCardStatus(error instanceof Error ? error.message : "Failed to create card");
    } finally {
      setCreatingCard(false);
    }
  }

  async function gradeCurrentCard(rating: 1 | 3 | 4 | 5) {
    if (!currentCard) {
      setReviewStatus("No due card selected.");
      return;
    }
    try {
      await apiRequest(apiBase, token, "/v1/reviews", {
        method: "POST",
        body: JSON.stringify({ card_id: currentCard.id, rating }),
      });
      const label = rating === 1 ? "Again" : rating === 3 ? "Hard" : rating === 4 ? "Good" : "Easy";
      setDueCards((previous) => previous.filter((card) => card.id !== currentCard.id));
      setShowAnswer(false);
      setReviewStatus(`Recorded ${label}.`);
    } catch (error) {
      setReviewStatus(error instanceof Error ? error.message : "Failed to save review");
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link className={styles.brand} href="/today">Starlog</Link>
          <h1>Today</h1>
          <p>{status}</p>
        </div>
        <nav className={styles.nav} aria-label="Focused navigation">
          <Link href="/review">Review</Link>
          <Link href="/review/decks">Decks</Link>
          <Link href="/library">Library</Link>
          <Link href="/assistant">Assistant</Link>
        </nav>
      </header>

      <section className={styles.overview} aria-label="Today summary">
        <div>
          <span>Due</span>
          <strong>{dueCount}</strong>
          <small>cards</small>
        </div>
        <div>
          <span>Decks</span>
          <strong>{decks.length}</strong>
          <small>{selectedDeck?.name ?? "Inbox"}</small>
        </div>
        <div>
          <span>Daily</span>
          <strong>{dailyNote ? `v${dailyNote.version}` : "new"}</strong>
          <small>{formatShortDate(date)}</small>
        </div>
      </section>

      <section className={styles.workspace}>
        <section className={`${styles.panel} ${styles.reviewPanel}`} aria-labelledby="today-review-title">
          <div className={styles.panelHead}>
            <div>
              <p>Review</p>
              <h2 id="today-review-title">Due queue</h2>
            </div>
            <button type="button" onClick={() => void loadDueCards()} disabled={loading}>
              Refresh
            </button>
          </div>

          {currentCard ? (
            <div className={styles.reviewBody}>
              <span className={styles.deckLabel}>{deckById.get(currentCard.deck_id || "")?.name || "Inbox"}</span>
              <h3>{currentCard.prompt}</h3>
              <button className={styles.primaryButton} type="button" onClick={() => setShowAnswer((value) => !value)}>
                {showAnswer ? "Hide answer" : "Reveal answer"}
              </button>
              {showAnswer ? (
                <div className={styles.answer}>
                  <span>{formatDue(currentCard.due_at)}</span>
                  <p>{currentCard.answer}</p>
                </div>
              ) : null}
              <div className={styles.ratingRow}>
                <button type="button" disabled={!showAnswer} onClick={() => void gradeCurrentCard(1)}>Again</button>
                <button type="button" disabled={!showAnswer} onClick={() => void gradeCurrentCard(3)}>Hard</button>
                <button type="button" disabled={!showAnswer} onClick={() => void gradeCurrentCard(4)}>Good</button>
                <button type="button" disabled={!showAnswer} onClick={() => void gradeCurrentCard(5)}>Easy</button>
              </div>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <h3>No due cards</h3>
              <p>Create cards today; by default they enter review tomorrow.</p>
              <Link href="/review">Open Review</Link>
            </div>
          )}
          <p className={styles.status} aria-live="polite">{reviewStatus}</p>
        </section>

        <section className={styles.panel} aria-labelledby="today-card-title">
          <div className={styles.panelHead}>
            <div>
              <p>Create</p>
              <h2 id="today-card-title">New card</h2>
            </div>
            <Link href="/review/decks">Decks</Link>
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
            <textarea value={cardPrompt} onChange={(event) => setCardPrompt(event.target.value)} rows={4} />
          </label>
          <label className={styles.field}>
            <span>Answer</span>
            <textarea value={cardAnswer} onChange={(event) => setCardAnswer(event.target.value)} rows={5} />
          </label>
          <label className={styles.field}>
            <span>Tags</span>
            <input value={cardTags} onChange={(event) => setCardTags(event.target.value)} placeholder="comma separated" />
          </label>
          <details className={styles.details}>
            <summary>Advanced schedule</summary>
            <p>New cards use the selected deck schedule. Open Decks to edit due date, interval, ease, or suspension.</p>
          </details>
          <button className={styles.primaryButton} type="button" onClick={() => void createCard()} disabled={creatingCard}>
            {creatingCard ? "Saving..." : "Save card"}
          </button>
          <p className={styles.status} aria-live="polite">{cardStatus}</p>
        </section>

        <section className={`${styles.panel} ${styles.dailyPanel}`} aria-labelledby="today-daily-title">
          <div className={styles.panelHead}>
            <div>
              <p>Daily note</p>
              <h2 id="today-daily-title">Plan and reflection</h2>
            </div>
            <label className={styles.dateField}>
              <span>Date</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value || todayIsoDate())} />
            </label>
          </div>
          <label className={styles.field}>
            <span>Morning plan</span>
            <textarea value={morningPlan} onChange={(event) => setMorningPlan(event.target.value)} rows={8} />
          </label>
          <label className={styles.field}>
            <span>Evening reflection</span>
            <textarea value={eveningReflection} onChange={(event) => setEveningReflection(event.target.value)} rows={8} />
          </label>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} type="button" onClick={() => void saveDailyNote()} disabled={savingDaily}>
              {savingDaily ? "Saving..." : "Save daily note"}
            </button>
            {dailyNote ? <Link href="/library#library-notes">Open library</Link> : null}
          </div>
          <p className={styles.status} aria-live="polite">{dailyStatus}</p>
        </section>
      </section>
    </main>
  );
}
