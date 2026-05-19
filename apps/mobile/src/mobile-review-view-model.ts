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
export type MobileReviewMode = "recall" | "understanding" | "application" | "synthesis" | "judgment";

export type MobileReviewLearningInsight = {
  key: string;
  title: string;
  body: string;
  mode?: MobileReviewMode | null;
  ladder_stage?: MobileReviewMode | null;
  count: number;
  severity: "low" | "medium" | "high" | "critical" | string;
  href?: string | null;
  prompt?: string | null;
};

export type MobileReviewRecommendedDrill = {
  mode: MobileReviewMode | string;
  title: string;
  body: string;
  prompt?: string | null;
  reason: string;
  enabled: boolean;
};

export type MobileReviewLearningSignal = {
  eyebrow: string;
  title: string;
  body: string;
  detail: string;
  prompt?: string | null;
  actionLabel?: string;
  action?: {
    kind: "assistant_prompt";
    label: string;
    prompt: string;
  };
  tone: "drill" | "insight";
};

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

export type MobileReviewStudyProgress = {
  source_count: number;
  topic_count: number;
  read_topic_count: number;
  unlocked_topic_count: number;
  locked_topic_count: number;
  due_unlocked_card_count: number;
};

export type MobileReviewQueueStateKind =
  | "loaded"
  | "loading"
  | "due_available"
  | "not_loaded"
  | "blocked_by_unread_topics"
  | "empty"
  | "auth_required";

export type MobileReviewQueueState = {
  kind: MobileReviewQueueStateKind;
  title: string;
  detail: string;
  actionLabel: string;
  knownDueCount: number;
};

export type MobileReviewAutoLoadDecisionInput = {
  hasActiveCard: boolean;
  showAnswer: boolean;
  reviewedCount: number;
  dueCount: number;
  decks: MobileReviewDeckSummary[];
  studyProgress?: MobileReviewStudyProgress | null;
  status?: string;
};

export type MobileReviewAutoLoadEffectDecision = {
  shouldLoad: boolean;
  suppressionKey: string | null;
  shouldClearSuppression: boolean;
};

export type MobileReviewViewModel = {
  syncedLabel: string;
  activeStage: MobileReviewStage;
  queueState: MobileReviewQueueState;
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
  learningSignal: MobileReviewLearningSignal | null;
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
  studyProgress?: MobileReviewStudyProgress | null;
  learningInsights?: MobileReviewLearningInsight[];
  recommendedDrill?: MobileReviewRecommendedDrill | null;
}): MobileReviewViewModel {
  const activeStage = deriveReviewStage(input.cardType, input.prompt);
  const dueCount = Math.max(0, input.dueCount);
  const totalCards = input.decks.reduce((sum, deck) => sum + Math.max(0, deck.card_count), 0);
  const totalDue = input.decks.reduce((sum, deck) => sum + Math.max(0, deck.due_count), 0);
  const progressDue = Math.max(0, input.studyProgress?.due_unlocked_card_count ?? 0);
  const recordedRemaining = parseRecordedRemainingDue(input.status ?? "");
  const loadedDueCount = parseLoadedDue(input.status ?? "");
  const hintDueCount = Math.max(dueCount, totalDue, progressDue);
  const knownDueCount = recordedRemaining === null
    ? Math.max(hintDueCount, loadedDueCount ?? 0)
    : Math.max(dueCount, recordedRemaining);
  const reviewed = Math.max(0, input.stats.reviewed);
  const mastered = Math.max(0, input.stats.good + input.stats.easy);
  const answerChoices = parseAnswerChoices(input.prompt, input.answer);
  const queueState = deriveQueueState({
    hasReviewCard: input.hasReviewCard,
    activeStage,
    status: input.status ?? "",
    meta: input.meta,
    dueCount,
    totalDue,
    knownDueCount,
    decks: input.decks,
    studyProgress: input.studyProgress ?? null,
  });

  return {
    syncedLabel: input.status?.trim() || "Ready",
    activeStage,
    queueState,
    statusChips: [
      { label: "Today", value: knownDueCount > 0 ? String(knownDueCount) : "Clear", active: true },
      { label: "All due", value: String(Math.max(totalDue, knownDueCount)), active: false },
      { label: "Upcoming", value: String(upcomingCount(input.decks, knownDueCount)), active: false },
      { label: "Mastered", value: reviewed > 0 ? String(mastered) : "0", active: false },
      { label: "Insights", value: input.retentionLabel || "0%", active: false },
    ],
    ladder: REVIEW_STAGES.map((stage) => {
      const stageCount = stageDueCount(stage, input.decks, activeStage, knownDueCount);
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
      ? `${reviewed + 1} of ${reviewed + Math.max(1, dueCount)}`
      : knownDueCount > 0
        ? `${knownDueCount} waiting`
        : "No active item",
    dueStateLabel: input.hasReviewCard ? input.meta : queueState.kind === "empty" ? "Queue clear" : queueState.detail,
    revealLabel: input.showAnswer ? "Explanation shown" : "Reveal answer",
    answerStateLabel: input.showAnswer ? "Answer open" : "Try retrieval first",
    whyThisNow: buildWhyThisNow(input.prompt, input.meta, input.decks, knownDueCount),
    correctExplanation: input.showAnswer
      ? compactAnswer(input.answer)
      : "Reveal the answer when you have committed to a retrieval attempt.",
    health: {
      label: knownDueCount > 0 ? "Needs attention" : "Stable",
      value: input.retentionLabel || "0%",
      detail: reviewed > 0
        ? `${reviewed} reviewed this session; ${mastered} landed as Good or Easy.`
        : knownDueCount > 0
          ? input.decks.length > 0
            ? `${knownDueCount} due across ${input.decks.length} active deck${input.decks.length === 1 ? "" : "s"}.`
            : `${knownDueCount} due interview card${knownDueCount === 1 ? "" : "s"} ready to load.`
          : totalCards > 0
            ? "No due cards are currently eligible."
            : queueState.detail,
    },
    queueLadder: REVIEW_STAGES.map((stage) => ({
      label: stage,
      value: stageDueCount(stage, input.decks, activeStage, knownDueCount) > 0
        ? String(stageDueCount(stage, input.decks, activeStage, knownDueCount))
        : stage === activeStage && input.hasReviewCard
          ? "1"
          : "0",
      active: stage === activeStage,
    })),
    session: {
      label: reviewed > 0 ? `${reviewed} reviewed` : "Session not started",
      detail: reviewed > 0
        ? `${input.stats.again} again / ${input.stats.hard} hard / ${input.stats.good} good / ${input.stats.easy} easy`
        : input.hasReviewCard ? "Reveal one item, then grade it." : queueState.detail,
      progressRatio: Math.max(0, Math.min(1, reviewed / Math.max(1, reviewed + knownDueCount))),
    },
    learningSignal: deriveLearningSignal(input.recommendedDrill, input.learningInsights ?? []),
  };
}

export function deriveReviewStage(cardType: string, prompt: string): MobileReviewStage {
  const text = `${cardType} ${prompt}`.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(judg(e|ment)|critique|trade-?off|decide|should|risk)\b/.test(text)) {
    return "Judgment";
  }
  if (/\b(synthesi[sz]e|combine|compare|relationship|connect)\b/.test(text)) {
    return "Synthesis";
  }
  if (/\b(apply|application|scenario|which change|what would|case|project|workflow|onboarding|implementation)\b/.test(text)) {
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

export function shouldAutoLoadReviewDueCardsOnEntry(input: MobileReviewAutoLoadDecisionInput): boolean {
  if (input.hasActiveCard || input.showAnswer || input.reviewedCount > 0) {
    return false;
  }

  const status = input.status?.trim() ?? "";
  if (/add api token|add api credentials|loading|fetching|refreshing/i.test(status)) {
    return false;
  }

  const loadedDueCount = parseLoadedDue(status);
  const knownDueCount = Math.max(
    0,
    input.dueCount,
    loadedDueCount ?? 0,
    input.studyProgress?.due_unlocked_card_count ?? 0,
    ...input.decks.map((deck) => Math.max(0, deck.due_count)),
  );
  if (knownDueCount > 0) {
    return true;
  }

  if (loadedDueCount === 0) {
    return false;
  }

  return !/loaded\s+\d+\s+due card/i.test(status);
}

export function deriveMobileReviewAutoLoadEffectDecision(
  input: MobileReviewAutoLoadDecisionInput & {
    suppressedEmptyLoadKey?: string | null;
  },
): MobileReviewAutoLoadEffectDecision {
  const suppressionKey = mobileReviewAutoLoadSuppressionKey(input);
  if (!suppressionKey) {
    return {
      shouldLoad: shouldAutoLoadReviewDueCardsOnEntry(input),
      suppressionKey: null,
      shouldClearSuppression: Boolean(input.suppressedEmptyLoadKey),
    };
  }

  if (suppressionKey && input.suppressedEmptyLoadKey === suppressionKey) {
    return { shouldLoad: false, suppressionKey, shouldClearSuppression: false };
  }

  return {
    shouldLoad: shouldAutoLoadReviewDueCardsOnEntry(input),
    suppressionKey,
    shouldClearSuppression: false,
  };
}

export function mobileReviewAutoLoadSuppressionKey(input: MobileReviewAutoLoadDecisionInput): string | null {
  const deckDueCount = input.decks.reduce((sum, deck) => sum + Math.max(0, deck.due_count), 0);
  const studyDueCount = Math.max(0, input.studyProgress?.due_unlocked_card_count ?? 0);
  const dueHintCount = Math.max(0, input.dueCount, deckDueCount, studyDueCount);
  if (dueHintCount <= 0) {
    return null;
  }
  return `due:${dueHintCount}|deck:${deckDueCount}|study:${studyDueCount}`;
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

function parseRecordedRemainingDue(status: string): number | null {
  const match = status.match(/Recorded rating\s+\d+\.\s+(\d+)\s+due card/i);
  if (!match) {
    return null;
  }
  return Math.max(0, Number.parseInt(match[1], 10));
}

function parseLoadedDue(status: string): number | null {
  const match = status.match(/Loaded\s+(\d+)\s+due card/i);
  if (!match) {
    return null;
  }
  return Math.max(0, Number.parseInt(match[1], 10));
}

function deriveQueueState(input: {
  hasReviewCard: boolean;
  activeStage: MobileReviewStage;
  status: string;
  meta: string;
  dueCount: number;
  totalDue: number;
  knownDueCount: number;
  decks: MobileReviewDeckSummary[];
  studyProgress: MobileReviewStudyProgress | null;
}): MobileReviewQueueState {
  if (input.hasReviewCard) {
    return {
      kind: "loaded",
      title: `${input.activeStage} review`,
      detail: input.meta.trim() || "Card loaded and ready for retrieval.",
      actionLabel: "Reveal answer",
      knownDueCount: input.knownDueCount,
    };
  }

  if (/add api token|add api credentials/i.test(input.status)) {
    return {
      kind: "auth_required",
      title: "Review data unavailable",
      detail: "Add API credentials to load the native review queue.",
      actionLabel: "Check queue",
      knownDueCount: 0,
    };
  }

  if (/\b(loading|fetching|refreshing)\b/i.test(input.status)) {
    return {
      kind: "loading",
      title: "Loading review queue",
      detail: "Checking native due cards and interview topic gates.",
      actionLabel: "Refresh",
      knownDueCount: input.knownDueCount,
    };
  }

  if (input.knownDueCount > 0) {
    return {
      kind: "due_available",
      title: `${input.knownDueCount} due card${input.knownDueCount === 1 ? "" : "s"} ready`,
      detail: input.studyProgress?.due_unlocked_card_count
        ? "Read interview topics have due cards. Load due cards to stage the next prompt."
        : "Due cards are visible in Review metadata. Load due cards to stage the next prompt.",
      actionLabel: "Load due cards",
      knownDueCount: input.knownDueCount,
    };
  }

  if (!input.studyProgress && input.decks.length === 0 && !/loaded 0 due card/i.test(input.status)) {
    return {
      kind: "not_loaded",
      title: "Review data not loaded",
      detail: "Load due cards to check the native queue.",
      actionLabel: "Load due cards",
      knownDueCount: 0,
    };
  }

  if (input.studyProgress) {
    const unreadTopicCount = Math.max(0, input.studyProgress.topic_count - input.studyProgress.read_topic_count);
    if (input.studyProgress.topic_count > 0 && input.studyProgress.read_topic_count === 0) {
      return {
        kind: "blocked_by_unread_topics",
        title: "No eligible read topics",
        detail: "Marked-read topics release interview cards. Mark a topic read, then load due cards.",
        actionLabel: "Refresh queue",
        knownDueCount: 0,
      };
    }
    if (unreadTopicCount > 0 && input.totalDue === 0) {
      return {
        kind: "blocked_by_unread_topics",
        title: "Review blocked by unread topics",
        detail: `${unreadTopicCount} unread topic${unreadTopicCount === 1 ? "" : "s"} can still release cards once marked read.`,
        actionLabel: "Refresh queue",
        knownDueCount: 0,
      };
    }
  }

  return {
    kind: "empty",
    title: "Review queue clear",
    detail: "No due cards are currently eligible.",
    actionLabel: "Refresh queue",
    knownDueCount: 0,
  };
}

function buildWhyThisNow(
  prompt: string,
  meta: string,
  decks: MobileReviewDeckSummary[],
  dueCount: number,
): string {
  const deck = [...decks]
    .filter((candidate) => candidate.due_count > 0)
    .sort((left, right) => right.due_count - left.due_count)[0] ?? decks[0];
  if (deck) {
    return `${deck.name} is the highest-pressure review source right now. This card connects the queue to live judgment instead of passive recall.`;
  }
  if (dueCount > 0) {
    return "This is the next due item in the shared review queue, so it is the smallest useful step before more intake.";
  }
  if (prompt.trim()) {
    return "This item is ready for a focused review pass when the due queue is loaded.";
  }
  return meta.trim() || "No due card loaded.";
}

function compactAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (!trimmed) {
    return "No answer text is available for this card.";
  }
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}

function deriveLearningSignal(
  recommendedDrill: MobileReviewRecommendedDrill | null | undefined,
  learningInsights: MobileReviewLearningInsight[],
): MobileReviewLearningSignal | null {
  if (recommendedDrill?.enabled) {
    const mode = reviewModeLabel(recommendedDrill.mode);
    const prompt = recommendedDrill.prompt?.trim() || undefined;
    return {
      eyebrow: `${mode} drill`,
      title: recommendedDrill.title.trim() || `${mode} drill`,
      body: recommendedDrill.body.trim() || recommendedDrill.reason.trim(),
      detail: recommendedDrill.reason.trim() || "Recommended from current review patterns.",
      prompt,
      actionLabel: prompt ? "Ask Assistant" : undefined,
      action: prompt ? { kind: "assistant_prompt", label: "Ask Assistant", prompt } : undefined,
      tone: "drill",
    };
  }

  const insight = selectLearningInsight(learningInsights);
  if (!insight) {
    return null;
  }

  const mode = reviewModeLabel(insight.mode ?? insight.ladder_stage ?? "");
  const prompt = insight.prompt?.trim() || undefined;
  return {
    eyebrow: `${mode} signal`,
    title: insight.title.trim() || `${mode} queue issue`,
    body: insight.body.trim() || `${insight.count} review pattern${insight.count === 1 ? "" : "s"} need attention.`,
    detail: `${severityLabel(insight.severity)} severity - ${Math.max(0, insight.count)} signal${insight.count === 1 ? "" : "s"}`,
    prompt,
    actionLabel: prompt ? "Ask Assistant" : undefined,
    action: prompt ? { kind: "assistant_prompt", label: "Ask Assistant", prompt } : undefined,
    tone: "insight",
  };
}

function selectLearningInsight(insights: MobileReviewLearningInsight[]): MobileReviewLearningInsight | null {
  return [...insights]
    .filter((insight) => insight.count > 0)
    .sort((left, right) => {
      const severityDelta = severityRank(right.severity) - severityRank(left.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return Math.max(0, right.count) - Math.max(0, left.count);
    })[0] ?? null;
}

function reviewModeLabel(mode: string): string {
  const normalized = mode.toLowerCase();
  if (normalized === "application") {
    return "Application";
  }
  if (normalized === "synthesis") {
    return "Synthesis";
  }
  if (normalized === "judgment") {
    return "Judgment";
  }
  if (normalized === "understanding") {
    return "Understanding";
  }
  return "Recall";
}

function severityRank(severity: string): number {
  switch (severity.toLowerCase()) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function severityLabel(severity: string): string {
  const normalized = severity.toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Low";
}
