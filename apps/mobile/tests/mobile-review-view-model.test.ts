import {
  deriveMobileReviewViewModel,
  deriveReviewStage,
  parseAnswerChoices,
} from "../src/mobile-review-view-model";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");

const prompt = [
  "Your team's onboarding flow has a 62% drop-off between the plan selection screen and workspace setup.",
  "Which change is most likely to reduce drop-off without adding friction earlier in the flow?",
  "A. Add a feature tour before workspace setup",
  "B. Move workspace setup earlier in the flow",
  "C. Pre-fill workspace defaults and allow skip",
  "D. Require team invites before setup",
].join("\n");

const hidden = deriveMobileReviewViewModel({
  prompt,
  answer: "C. Pre-fill workspace defaults and allow skip",
  dueCount: 6,
  cardType: "application_case",
  meta: "Due Apr 28, 2026, 12:00 PM",
  retentionLabel: "67%",
  stats: { reviewed: 2, again: 1, hard: 0, good: 1, easy: 0 },
  decks: [
    {
      id: "deck-1",
      name: "Application transfer",
      description: "Product judgment and current project transfer",
      due_count: 4,
      card_count: 9,
    },
    {
      id: "deck-2",
      name: "Recall basics",
      description: "Recall",
      due_count: 2,
      card_count: 8,
    },
  ],
  showAnswer: false,
  hasReviewCard: true,
  status: "Loaded 6 due card(s)",
});

assert.equal(hidden.activeStage, "Application");
assert.deepEqual(hidden.statusChips.map((chip) => chip.label), ["Today", "All due", "Upcoming", "Mastered", "Insights"]);
assert.equal(hidden.statusChips[0].value, "6");
assert.equal(hidden.ladder.find((stage) => stage.label === "Application")?.active, true);
assert.equal(hidden.ladder.find((stage) => stage.label === "Recall")?.countLabel, "2 due");
assert.deepEqual(hidden.answerChoices, [
  { key: "A", label: "Add a feature tour before workspace setup" },
  { key: "B", label: "Move workspace setup earlier in the flow" },
  { key: "C", label: "Pre-fill workspace defaults and allow skip" },
  { key: "D", label: "Require team invites before setup" },
]);
assert.equal(hidden.gradeOptions.every((option) => !option.enabled), true);
assert.equal(hidden.health.label, "Needs attention");
assert.equal(hidden.session.label, "2 reviewed");
assert.equal(hidden.session.progressRatio, 0.25);
assert.equal(hidden.correctExplanation, "Reveal the answer when you have committed to a retrieval attempt.");
assert.equal(hidden.learningSignal, null);

const productionSummaryShape = deriveMobileReviewViewModel({
  ...hiddenInputBase(),
  learningInsights: [
    {
      key: "recent_low_rating_application",
      title: "Application cards are slipping",
      body: "Recent low ratings are clustered in application cards.",
      mode: "application",
      ladder_stage: "application",
      count: 2,
      severity: "medium",
      href: null,
      prompt: "Help me practice application cards I recently missed.",
    },
  ],
  recommendedDrill: {
    mode: "application",
    title: "Application drill",
    body: "Practice cards with 2 recent low ratings before returning to the full queue.",
    prompt: "Start an application drill from cards I recently rated low.",
    reason: "2 recent low ratings on application cards.",
    enabled: true,
  },
});

assert.equal(productionSummaryShape.learningSignal?.eyebrow, "Application drill");
assert.equal(productionSummaryShape.learningSignal?.title, "Application drill");
assert.equal(productionSummaryShape.learningSignal?.prompt, "Start an application drill from cards I recently rated low.");
assert.equal(productionSummaryShape.learningSignal?.tone, "drill");
assert.deepEqual(productionSummaryShape.learningSignal?.action, {
  kind: "assistant_prompt",
  label: "Ask Assistant",
  prompt: "Start an application drill from cards I recently rated low.",
});

const recommendedDrillPriority = deriveMobileReviewViewModel({
  ...hiddenInputBase(),
  learningInsights: [
    {
      key: "recent_low_rating_judgment",
      title: "Judgment needs calibration",
      body: "Judgment cards have the larger count.",
      mode: "judgment",
      ladder_stage: "judgment",
      count: 9,
      severity: "high",
      prompt: "Help me calibrate judgment cards.",
    },
  ],
  recommendedDrill: {
    mode: "synthesis",
    title: "Synthesis drill",
    body: "Practice cards with 2 recent low ratings before returning to the full queue.",
    prompt: "Start a synthesis drill from cards I recently rated low.",
    reason: "2 recent low ratings on synthesis cards.",
    enabled: true,
  },
});

assert.equal(recommendedDrillPriority.learningSignal?.eyebrow, "Synthesis drill");
assert.equal(recommendedDrillPriority.learningSignal?.prompt, "Start a synthesis drill from cards I recently rated low.");
assert.equal(recommendedDrillPriority.learningSignal?.action?.kind, "assistant_prompt");
assert.equal(recommendedDrillPriority.learningSignal?.action?.prompt, "Start a synthesis drill from cards I recently rated low.");

const synthesisInsightFallback = deriveMobileReviewViewModel({
  ...hiddenInputBase(),
  learningInsights: [
    {
      key: "recent_low_rating_application",
      title: "Application wobble",
      body: "Application cards need a short pass.",
      mode: "application",
      ladder_stage: "application",
      count: 4,
      severity: "medium",
    },
    {
      key: "recent_low_rating_synthesis",
      title: "Synthesis needs attention",
      body: "Synthesis cards are generating the strongest misses.",
      mode: "synthesis",
      ladder_stage: "synthesis",
      count: 3,
      severity: "high",
      prompt: "Help me connect the synthesis cards I recently missed.",
    },
  ],
  recommendedDrill: {
    mode: "recall",
    title: "No drill recommended",
    body: "No due cards or repeated low-rating patterns are visible right now.",
    prompt: null,
    reason: "No due cards or recent low ratings found.",
    enabled: false,
  },
});

assert.equal(synthesisInsightFallback.learningSignal?.eyebrow, "Synthesis signal");
assert.equal(synthesisInsightFallback.learningSignal?.title, "Synthesis needs attention");
assert.equal(synthesisInsightFallback.learningSignal?.detail, "High severity - 3 signals");
assert.equal(synthesisInsightFallback.learningSignal?.prompt, "Help me connect the synthesis cards I recently missed.");

const applicationInsightCountTiebreaker = deriveMobileReviewViewModel({
  ...hiddenInputBase(),
  learningInsights: [
    {
      key: "recent_low_rating_judgment",
      title: "Judgment misses",
      body: "Judgment cards need a pass.",
      mode: "judgment",
      ladder_stage: "judgment",
      count: 2,
      severity: "medium",
    },
    {
      key: "recent_low_rating_application",
      title: "Application misses",
      body: "Application cards have the larger medium-severity cluster.",
      mode: "application",
      ladder_stage: "application",
      count: 5,
      severity: "medium",
    },
  ],
});

assert.equal(applicationInsightCountTiebreaker.learningSignal?.eyebrow, "Application signal");
assert.equal(applicationInsightCountTiebreaker.learningSignal?.title, "Application misses");

const priorityWording = deriveMobileReviewViewModel({
  ...hiddenInputBase(),
  decks: [
    {
      id: "deck-low",
      name: "Recall warmup",
      description: "Recall",
      due_count: 1,
      card_count: 10,
    },
    {
      id: "deck-high",
      name: "Judgment transfer",
      description: "Judgment",
      due_count: 7,
      card_count: 12,
    },
  ],
  showAnswer: false,
  hasReviewCard: true,
});

assert.equal(priorityWording.whyThisNow.includes("Judgment transfer is the highest-pressure review source"), true);
assert.equal(priorityWording.whyThisNow.includes("Recall warmup is the highest-pressure review source"), false);

const revealed = deriveMobileReviewViewModel({
  ...hiddenInputBase(),
  showAnswer: true,
  hasReviewCard: true,
});

assert.equal(revealed.gradeOptions.every((option) => option.enabled), true);
assert.equal(revealed.gradeOptions.map((option) => option.rating).join(","), "1,3,4,5");
assert.equal(revealed.revealLabel, "Explanation shown");
assert.equal(revealed.correctExplanation, "C. Pre-fill workspace defaults and allow skip");
assert.equal(revealed.queueLadder.find((stage) => stage.label === "Application")?.value, "4");

const idle = deriveMobileReviewViewModel({
  ...hiddenInputBase(),
  dueCount: 0,
  decks: [],
  stats: { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 },
  showAnswer: false,
  hasReviewCard: false,
});

assert.equal(idle.statusChips[0].value, "Clear");
assert.equal(idle.health.detail, "No due cards loaded.");
assert.equal(idle.session.detail, "No review session running.");
assert.equal(idle.gradeOptions.every((option) => !option.enabled), true);
assert.equal(idle.learningSignal, null);

assert.equal(deriveReviewStage("judgment_prompt", "Should this design trade off speed for accuracy?"), "Judgment");
assert.equal(deriveReviewStage("basic", "Explain why retrieval practice works"), "Understanding");
assert.deepEqual(parseAnswerChoices("No choices here", "Short answer"), []);

console.log("mobile review view model tests passed");

function hiddenInputBase() {
  return {
    prompt,
    answer: "C. Pre-fill workspace defaults and allow skip",
    dueCount: 6,
    cardType: "application_case",
    meta: "Due Apr 28, 2026, 12:00 PM",
    retentionLabel: "67%",
    stats: { reviewed: 2, again: 1, hard: 0, good: 1, easy: 0 },
    decks: [
      {
        id: "deck-1",
        name: "Application transfer",
        description: "Product judgment and current project transfer",
        due_count: 4,
        card_count: 9,
      },
      {
        id: "deck-2",
        name: "Recall basics",
        description: "Recall",
        due_count: 2,
        card_count: 8,
      },
    ],
    status: "Loaded 6 due card(s)",
    showAnswer: false,
    hasReviewCard: true,
  };
}
