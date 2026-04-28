import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

import { API_BASE, seedAssistantSession } from "./assistant-concept-fixtures";

const reviewSummary = {
  ladder_counts: [
    { key: "recall", label: "Recall", count: 2 },
    { key: "understanding", label: "Understanding", count: 1 },
    { key: "application", label: "Application", count: 3 },
    { key: "synthesis", label: "Synthesis", count: 1 },
    { key: "judgment", label: "Judgment", count: 0 },
  ],
  total_ladder_counts: [
    { key: "recall", label: "Recall", count: 12 },
    { key: "understanding", label: "Understanding", count: 7 },
    { key: "application", label: "Application", count: 6 },
    { key: "synthesis", label: "Synthesis", count: 4 },
    { key: "judgment", label: "Judgment", count: 2 },
  ],
  deck_buckets: [
    { key: "Concepts", label: "Concepts", count: 4 },
    { key: "Projects", label: "Projects", count: 3 },
  ],
  queue_health: {
    due_count: 7,
    overdue_count: 2,
    due_soon_count: 5,
    suspended_count: 1,
    reviewed_today_count: 3,
    last_reviewed_at: "2026-04-27T15:20:00.000Z",
    average_latency_ms: 1200,
  },
  learning_insights: [
    {
      key: "repeated_application_synthesis_miss",
      title: "Application and synthesis miss pattern",
      body: "Repeated misses show answers stall when applying concepts to unfamiliar onboarding scenarios and combining evidence.",
      mode: "application",
      ladder_stage: "scenario transfer",
      count: 4,
      severity: "high",
      prompt: "Run an application drill on onboarding flow tradeoffs.",
    },
    {
      key: "judgment_evidence_gap",
      title: "Judgment needs evidence",
      body: "Recent answers evaluate options before naming the evidence that would change the decision.",
      mode: "judgment",
      ladder_stage: "judgment",
      count: 2,
      severity: "medium",
    },
    {
      key: "synthesis_connection_gap",
      title: "Synthesis links are thin",
      body: "Connections mention related ideas without explaining the mechanism between them.",
      mode: "synthesis",
      ladder_stage: "synthesis",
      count: 3,
      severity: "medium",
    },
  ],
  recommended_drill: {
    mode: "application",
    title: "Apply the onboarding evidence",
    body: "Practice turning source evidence into one concrete intervention and one tradeoff.",
    prompt: "Give me a 10 minute application drill using my missed onboarding review cards.",
    reason: "Application misses repeated 4 times across the current queue.",
    enabled: true,
  },
  generated_at: "2026-04-27T15:30:00.000Z",
};

const reviewSummaryWithoutInsights = {
  ...reviewSummary,
  learning_insights: [],
  recommended_drill: null,
};

const legacyReviewSummary = {
  ladder_counts: reviewSummary.ladder_counts,
  total_ladder_counts: reviewSummary.total_ladder_counts,
  deck_buckets: reviewSummary.deck_buckets,
  queue_health: reviewSummary.queue_health,
  generated_at: reviewSummary.generated_at,
};

const dueCards = [
  {
    id: "card_application",
    deck_id: "deck_projects",
    card_type: "scenario",
    review_mode: "application",
    prompt: "Your onboarding flow has a 62% drop-off. What do you inspect first?",
    answer: "Inspect the earliest high-friction step, compare it with session evidence, and test one focused change.",
    due_at: "2026-04-27T14:00:00.000Z",
  },
  {
    id: "card_recall",
    deck_id: "deck_concepts",
    card_type: "qa",
    review_mode: "recall",
    prompt: "What does source fidelity preserve?",
    answer: "Raw, normalized, and extracted content layers.",
    due_at: "2026-04-28T10:00:00.000Z",
  },
];

const decks = [
  {
    id: "deck_projects",
    name: "Projects",
    description: "Onboarding flow polish",
    card_count: 8,
    due_count: 3,
  },
  {
    id: "deck_concepts",
    name: "Concepts",
    description: "Core Starlog product concepts",
    card_count: 12,
    due_count: 4,
  },
];

test("PWA review renders the ladder summary and supports reveal plus grading", async ({ page }) => {
  await seedAssistantSession(page);
  const assistantEvents: Array<Record<string, unknown>> = [];
  const reviewRequests: Array<Record<string, unknown>> = [];

  await page.route(`${API_BASE}/v1/surfaces/review/summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reviewSummary),
    });
  });

  await page.route(`${API_BASE}/v1/cards/due**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dueCards),
    });
  });

  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(decks),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/events`, async (route) => {
    assistantEvents.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "event_review_reveal" }),
    });
  });

  await page.route(`${API_BASE}/v1/reviews`, async (route) => {
    reviewRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });

  await page.goto("/review", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Learning ladder" })).toBeVisible();
  await expect(page.getByText("Application").first()).toBeVisible();
  await expect(page.getByText("3 due").first()).toBeVisible();
  await expect(page.getByText("Recall 2 · Understanding 1 · Application 3 · Synthesis 1")).toBeVisible();
  await expect(page.locator(".april-review-side-metrics").getByText("7", { exact: true })).toBeVisible();
  await expect(page.locator(".april-review-health-list").getByText("2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Review view status").getByText("Today")).toBeVisible();
  await expect(page.getByRole("button", { name: "All due" })).toHaveCount(0);
  await expect(page.getByText("Current queue context by card mode")).toBeVisible();
  await expect(page.getByText("Generated drills and deeper scenario flows are not active here yet.")).toHaveCount(0);
  const learningCard = page.locator(".april-review-learning-card");
  const firstInsight = learningCard.locator(".april-review-insight", { hasText: "Application and synthesis miss pattern" });
  await expect(page.getByText("Learning insights")).toBeVisible();
  await expect(firstInsight.getByText("Application and synthesis miss pattern")).toBeVisible();
  await expect(firstInsight.getByText("Repeated misses show answers stall")).toBeVisible();
  await expect(firstInsight.getByText("4x")).toBeVisible();
  await expect(firstInsight.getByText("high", { exact: true })).toBeVisible();
  await expect(firstInsight.getByText("Application", { exact: true })).toBeVisible();
  await expect(firstInsight.getByText("scenario transfer", { exact: true })).toBeVisible();
  await expect(learningCard.getByText("Recommended drill", { exact: true })).toBeVisible();
  await expect(learningCard.getByText("Apply the onboarding evidence")).toBeVisible();
  await expect(learningCard.getByText("Reason: Application misses repeated 4 times across the current queue.")).toBeVisible();
  await expect(learningCard.getByText("Give me a 10 minute application drill using my missed onboarding review cards.")).toBeVisible();
  await expect(learningCard.getByRole("link", { name: "Open in Assistant" })).toHaveAttribute(
    "href",
    "/assistant?draft=Give%20me%20a%2010%20minute%20application%20drill%20using%20my%20missed%20onboarding%20review%20cards.",
  );
  await expect(page.getByText("Projects deck")).toBeVisible();
  await expect(page.locator(".april-review-rail-deck", { hasText: "Projects" }).getByText("3 items")).toBeVisible();
  await expect(page.getByText("Onboarding flow polish")).toBeVisible();

  mkdirSync("artifacts/ui-functional", { recursive: true });
  await page.screenshot({ path: "artifacts/ui-functional/pwa-review-learning-insights.png", fullPage: true });

  const goodButton = page.getByRole("button", { name: /Good/ });
  await expect(goodButton).toBeDisabled();

  await page.getByRole("button", { name: "Reveal Answer" }).click();
  await expect(page.getByText("Inspect the earliest high-friction step")).toBeVisible();
  await expect(goodButton).toBeEnabled();
  expect(assistantEvents).toEqual([
    expect.objectContaining({
      kind: "review.answer.revealed",
      entity_ref: expect.objectContaining({ entity_id: "card_application" }),
    }),
  ]);

  await goodButton.click();
  expect(reviewRequests).toEqual([expect.objectContaining({ card_id: "card_application", rating: 4 })]);
  await expect(page.locator("[aria-live='polite']")).toHaveText("Recorded Good for card_application.");
  await expect(page.locator(".april-review-ladder-step", { hasText: "Application" }).getByText("2 due")).toBeVisible();
  await expect(page.getByText("Recall 2 · Understanding 1 · Application 2 · Synthesis 1")).toBeVisible();
  await expect(page.locator(".april-review-side-metrics").getByText("6", { exact: true })).toBeVisible();
  await expect(page.locator(".april-review-health-list").getByText("1", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".april-review-rail-deck", { hasText: "Projects" }).getByText("3 items")).toBeVisible();
  await expect(page.getByText("What does source fidelity preserve?")).toBeVisible();
});

test("PWA review hides learning signals quietly when the summary has no insights or drill", async ({ page }) => {
  await seedAssistantSession(page);

  await page.route(`${API_BASE}/v1/surfaces/review/summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reviewSummaryWithoutInsights),
    });
  });

  await page.route(`${API_BASE}/v1/cards/due**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dueCards),
    });
  });

  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(decks),
    });
  });

  await page.goto("/review", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Learning ladder" })).toBeVisible();
  await expect(page.locator(".april-review-learning-card")).toHaveCount(0);
  await expect(page.locator(".april-review-drill")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open in Assistant" })).toHaveCount(0);
  await expect(page.getByText("Generated drills and deeper scenario flows are not active here yet.")).toHaveCount(0);
});

test("PWA review remains compatible with legacy summaries that omit learning signal fields", async ({ page }) => {
  await seedAssistantSession(page);

  await page.route(`${API_BASE}/v1/surfaces/review/summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(legacyReviewSummary),
    });
  });

  await page.route(`${API_BASE}/v1/cards/due**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dueCards),
    });
  });

  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(decks),
    });
  });

  await page.goto("/review", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Learning ladder" })).toBeVisible();
  await expect(page.getByText("Recall 2 · Understanding 1 · Application 3 · Synthesis 1")).toBeVisible();
  await expect(page.locator(".april-review-learning-card")).toHaveCount(0);
  await expect(page.locator(".april-review-drill")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open in Assistant" })).toHaveCount(0);
});
