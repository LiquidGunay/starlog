export type MobileReviewDeckSummary = {
  id: string;
  name: string;
  description?: string | null;
  due_count: number;
  card_count: number;
};

export type MobileReviewStats = {
  reviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
};

export type MobileReviewStage = "Recall" | "Understanding" | "Application" | "Synthesis" | "Judgment";

export type MobileReviewStageChip = {
  label: MobileReviewStage;
  active: boolean;
  countLabel: string;
  tone: "quiet" | "due" | "active" | "mastered";
};

export type MobileReviewStatusChip = {
  label: "Today" | "All due" | "Upcoming" | "Mastered" | "Insights";
  value: string;
  active: boolean;
};

export type MobileReviewGradeOption = {
  label: "Again" | "Hard" | "Good" | "Easy";
  rating: 1 | 3 | 4 | 5;
  intervalLabel: string;
  enabled: boolean;
  tone: "again" | "hard" | "good" | "easy";
};

export type MobileReviewAnswerChoice = {
  key: string;
  label: string;
};

export type MobileReviewViewModel = {
  syncedLabel: string;
  activeStage: MobileReviewStage;
  statusChips: MobileReviewStatusChip[];
  ladder: MobileReviewStageChip[];
  answerChoices: MobileReviewAnswerChoice[];
  gradeOptions: MobileReviewGradeOption[];
  cardProgressLabel: string;
  dueStateLabel: string;
  revealLabel: string;
  answerStateLabel: string;
  whyThisNow: string;
  correctExplanation: string;
  health: {
    label: string;
    value: string;
    detail: string;
  };
  queueLadder: {
    label: MobileReviewStage;
    value: string;
    active: boolean;
  }[];
  session: {
    label: string;
    detail: string;
    progressRatio: number;
  };
};

const REVIEW_STAGES: MobileReviewStage[] = ["Recall", "Understanding", "Application", "Synthesis", "Judgment"];

export function deriveMobileReviewViewModel(input: {
  prompt: string;
  answer: string;
  dueCount: number;
  cardType: string;
  meta: string;
  retentionLabel: string;
  stats: MobileReviewStats;
  decks: MobileReviewDeckSummary[];
  showAnswer: boolean;
  hasReviewCard: boolean;
  status?: string;
}): MobileReviewViewModel {
  const activeStage = deriveReviewStage(input.cardType, input.prompt);
  const dueCount = Math.max(0, input.dueCount);
  const totalCards = input.decks.reduce((sum, deck) => sum + Math.max(0, deck.card_count), 0);
  const totalDue = input.decks.reduce((sum, deck) => sum + Math.max(0, deck.due_count), 0);
  const reviewed = Math.max(0, input.stats.reviewed);
  const mastered = Math.max(0, input.stats.good + input.stats.easy);
  const answerChoices = parseAnswerChoices(input.prompt, input.answer);

  return {
    syncedLabel: input.status?.trim() || "Ready",
    activeStage,
    statusChips: [
      { label: "Today", value: dueCount > 0 ? String(dueCount) : "Clear", active: true },
      { label: "All due", value: String(totalDue || dueCount), active: false },
      { label: "Upcoming", value: String(upcomingCount(input.decks, dueCount)), active: false },
      { label: "Mastered", value: reviewed > 0 ? String(mastered) : "0", active: false },
      { label: "Insights", value: input.retentionLabel || "0%", active: false },
    ],
    ladder: REVIEW_STAGES.map((stage) => {
      const stageCount = stageDueCount(stage, input.decks, activeStage, dueCount);
      const active = stage === activeStage;
      return {
        label: stage,
        active,
        countLabel: stageCount > 0 ? `${stageCount} due` : active && input.hasReviewCard ? "Now" : "Stable",
        tone: active ? "active" : stageCount > 0 ? "due" : "quiet",
      };
    }),
    answerChoices,
    gradeOptions: [
      { label: "Again", rating: 1, intervalLabel: "1m", enabled: input.hasReviewCard && input.showAnswer, tone: "again" },
      { label: "Hard", rating: 3, intervalLabel: "1d", enabled: input.hasReviewCard && input.showAnswer, tone: "hard" },
      { label: "Good", rating: 4, intervalLabel: "3d", enabled: input.hasReviewCard && input.showAnswer, tone: "good" },
      { label: "Easy", rating: 5, intervalLabel: "5d", enabled: input.hasReviewCard && input.showAnswer, tone: "easy" },
    ],
    cardProgressLabel: input.hasReviewCard
      ? `${reviewed + 1} of ${reviewed + dueCount}`
      : dueCount > 0
        ? `${dueCount} waiting`
        : "No active item",
    dueStateLabel: input.hasReviewCard ? input.meta : dueCount > 0 ? `${dueCount} due` : "Queue clear",
    revealLabel: input.showAnswer ? "Explanation shown" : "Reveal answer",
    answerStateLabel: input.showAnswer ? "Answer open" : "Try retrieval first",
    whyThisNow: buildWhyThisNow(input.prompt, input.meta, input.decks, dueCount),
    correctExplanation: input.showAnswer
      ? compactAnswer(input.answer)
      : "Reveal the answer when you have committed to a retrieval attempt.",
    health: {
      label: totalDue > 0 || dueCount > 0 ? "Needs attention" : "Stable",
      value: input.retentionLabel || "0%",
      detail: reviewed > 0
        ? `${reviewed} reviewed this session; ${mastered} landed as Good or Easy.`
        : totalCards > 0
          ? `${Math.max(totalDue, dueCount)} due across ${input.decks.length} active deck${input.decks.length === 1 ? "" : "s"}.`
          : "Load the due queue to measure current knowledge health.",
    },
    queueLadder: REVIEW_STAGES.map((stage) => ({
      label: stage,
      value: stageDueCount(stage, input.decks, activeStage, dueCount) > 0
        ? String(stageDueCount(stage, input.decks, activeStage, dueCount))
        : stage === activeStage && input.hasReviewCard
          ? "1"
          : "0",
      active: stage === activeStage,
    })),
    session: {
      label: reviewed > 0 ? `${reviewed} reviewed` : "Session not started",
      detail: reviewed > 0
        ? `${input.stats.again} again / ${input.stats.hard} hard / ${input.stats.good} good / ${input.stats.easy} easy`
        : "Reveal one item, grade it, then the next due card moves into focus.",
      progressRatio: Math.max(0, Math.min(1, reviewed / Math.max(1, reviewed + dueCount))),
    },
  };
}

export function deriveReviewStage(cardType: string, prompt: string): MobileReviewStage {
  const text = `${cardType} ${prompt}`.toLowerCase();
  if (/\b(judg(e|ment)|critique|trade-?off|decide|should|risk)\b/.test(text)) {
    return "Judgment";
  }
  if (/\b(synthesi[sz]e|combine|compare|relationship|connect)\b/.test(text)) {
    return "Synthesis";
  }
  if (/\b(apply|scenario|which change|what would|case|project|workflow|onboarding|implementation)\b/.test(text)) {
    return "Application";
  }
  if (/\b(explain|why|how|understand|principle)\b/.test(text)) {
    return "Understanding";
  }
  return "Recall";
}

export function parseAnswerChoices(prompt: string, answer: string): MobileReviewAnswerChoice[] {
  const source = `${prompt}\n${answer}`;
  const choices = Array.from(source.matchAll(/(?:^|\n)\s*([A-D])[\).]\s+([^\n]+)/g)).map((match) => ({
    key: match[1],
    label: match[2].trim(),
  }));
  const unique = new Map<string, MobileReviewAnswerChoice>();
  choices.forEach((choice) => {
    if (!unique.has(choice.key)) {
      unique.set(choice.key, choice);
    }
  });
  return Array.from(unique.values()).slice(0, 4);
}

function stageDueCount(
  stage: MobileReviewStage,
  decks: MobileReviewDeckSummary[],
  activeStage: MobileReviewStage,
  dueCount: number,
): number {
  const direct = decks
    .filter((deck) => deckMatchesStage(deck, stage))
    .reduce((sum, deck) => sum + Math.max(0, deck.due_count), 0);
  if (direct > 0) {
    return direct;
  }
  return stage === activeStage ? Math.max(0, dueCount) : 0;
}

function deckMatchesStage(deck: MobileReviewDeckSummary, stage: MobileReviewStage): boolean {
  const text = `${deck.name} ${deck.description ?? ""}`.toLowerCase();
  return text.includes(stage.toLowerCase());
}

function upcomingCount(decks: MobileReviewDeckSummary[], dueCount: number): number {
  const totalCards = decks.reduce((sum, deck) => sum + Math.max(0, deck.card_count), 0);
  const totalDue = decks.reduce((sum, deck) => sum + Math.max(0, deck.due_count), 0) || dueCount;
  return Math.max(0, totalCards - totalDue);
}

function buildWhyThisNow(
  prompt: string,
  meta: string,
  decks: MobileReviewDeckSummary[],
  dueCount: number,
): string {
  const deck = decks.find((candidate) => candidate.due_count > 0) ?? decks[0];
  if (deck) {
    return `${deck.name} is the highest-pressure review source right now. This card connects the queue to live judgment instead of passive recall.`;
  }
  if (dueCount > 0) {
    return "This is the next due item in the shared review queue, so it is the smallest useful step before more intake.";
  }
  if (prompt.trim()) {
    return "This item is ready for a focused review pass when the due queue is loaded.";
  }
  return meta.trim() || "Load due cards to see why the next item is being scheduled now.";
}

function compactAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (!trimmed) {
    return "No answer text is available for this card.";
  }
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}
