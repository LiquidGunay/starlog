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
assert.equal(idle.health.detail, "Load the due queue to measure current knowledge health.");
assert.equal(idle.gradeOptions.every((option) => !option.enabled), true);

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
  };
}
