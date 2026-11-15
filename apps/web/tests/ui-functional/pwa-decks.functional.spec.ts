import { expect, test } from "@playwright/test";

import { API_BASE, seedAssistantSession } from "./assistant-concept-fixtures";

const decks = [
  {
    id: "deck_inbox",
    name: "Inbox",
    description: "Default deck",
    schedule: { new_cards_due_offset_hours: 24, initial_interval_days: 1, initial_ease_factor: 2.5 },
    card_count: 2,
    due_count: 1,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "deck_interview",
    name: "Interview Prep",
    description: "Separate deck",
    schedule: { new_cards_due_offset_hours: 24, initial_interval_days: 1, initial_ease_factor: 2.5 },
    card_count: 1,
    due_count: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  },
];

const cardsByDeck: Record<string, unknown[]> = {
  all: [
    {
      id: "card_chip",
      deck_id: "deck_inbox",
      card_type: "qa",
      prompt: "Chip Huyen ML systems question",
      answer: "Production ML needs monitoring and data feedback loops.",
      tags: ["ml"],
      suspended: false,
      due_at: "2026-07-02T08:00:00.000Z",
      interval_days: 1,
      repetitions: 0,
      ease_factor: 2.5,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "card_interview",
      deck_id: "deck_interview",
      card_type: "qa",
      prompt: "Explain the deterministic review loop.",
      answer: "Seed, reveal, grade, and confirm the due queue changed.",
      tags: ["interview"],
      suspended: false,
      due_at: "2026-07-03T08:00:00.000Z",
      interval_days: 1,
      repetitions: 0,
      ease_factor: 2.5,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
  ],
  deck_inbox: [],
  deck_interview: [],
};

cardsByDeck.deck_inbox = [cardsByDeck.all[0]];
cardsByDeck.deck_interview = [cardsByDeck.all[1]];

test("PWA deck browser loads separate decks and opens a card", async ({ page }, testInfo) => {
  await seedAssistantSession(page);

  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(decks) });
  });
  await page.route(`${API_BASE}/v1/cards?**`, async (route) => {
    const url = new URL(route.request().url());
    const deckId = url.searchParams.get("deck_id") || "all";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cardsByDeck[deckId] || []),
    });
  });

  await page.goto("/review/decks", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Decks", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inbox 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Interview Prep 1" })).toBeVisible();

  await page.getByRole("button", { name: "Interview Prep 1" }).click();
  await expect(page.getByRole("button", { name: /Explain the deterministic/ })).toBeVisible();
  await page.getByRole("button", { name: /Explain the deterministic/ }).click();
  await expect(page.getByLabel("Prompt")).toHaveValue("Explain the deterministic review loop.");
  await expect(page.getByLabel("Answer")).toHaveValue("Seed, reveal, grade, and confirm the due queue changed.");

  await page.getByPlaceholder("chip, gradient, leakage...").fill("chip");
  await expect(page.getByText("No cards here")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("pwa-decks-browser.png"), fullPage: true });
});

test("PWA deck browser fits mobile viewport", async ({ page }, testInfo) => {
  await seedAssistantSession(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(decks) });
  });
  await page.route(`${API_BASE}/v1/cards?**`, async (route) => {
    const url = new URL(route.request().url());
    const deckId = url.searchParams.get("deck_id") || "all";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cardsByDeck[deckId] || []),
    });
  });

  await page.goto("/review/decks", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Decks", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inbox 2" })).toBeVisible();
  await page.getByRole("button", { name: "Inbox 2" }).click();
  await expect(page.getByRole("button", { name: /Chip Huyen ML systems/ })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("pwa-decks-browser-mobile.png"), fullPage: true });
});
