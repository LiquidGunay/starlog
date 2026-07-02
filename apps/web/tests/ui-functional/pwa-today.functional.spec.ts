import { expect, test } from "@playwright/test";
import { API_BASE, seedAssistantSession } from "./assistant-concept-fixtures";

const decks = [
  { id: "deck_inbox", name: "Inbox", card_count: 4, due_count: 1 },
  { id: "deck_systems", name: "Systems", card_count: 8, due_count: 0 },
];

const dueCards = [
  {
    id: "card_due_1",
    deck_id: "deck_inbox",
    card_type: "qa",
    prompt: "What is the point of making the card yourself?",
    answer: "The act of framing the prompt and answer is part of retrieval practice.",
    due_at: "2026-07-01T08:00:00.000Z",
  },
];

test("PWA today supports daily notes, manual card creation, and due review", async ({ page }, testInfo) => {
  await seedAssistantSession(page);
  const cardRequests: Array<Record<string, unknown>> = [];
  const dailyRequests: Array<Record<string, unknown>> = [];
  const reviewRequests: Array<Record<string, unknown>> = [];

  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(decks) });
  });

  await page.route(`${API_BASE}/v1/cards/due**`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dueCards) });
  });

  await page.route(`${API_BASE}/v1/daily-notes/**`, async (route) => {
    if (route.request().method() === "PUT") {
      dailyRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "dly_today",
          date: "2026-07-01",
          note_id: "nte_today",
          morning_plan_md: dailyRequests[0].morning_plan_md,
          evening_reflection_md: dailyRequests[0].evening_reflection_md,
          version: 1,
          created_at: "2026-07-01T08:00:00.000Z",
          updated_at: "2026-07-01T08:00:00.000Z",
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Daily note not found" }),
    });
  });

  await page.route(`${API_BASE}/v1/cards`, async (route) => {
    cardRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "card_new_manual",
        deck_id: "deck_inbox",
        card_type: "qa",
        prompt: cardRequests[0].prompt,
        answer: cardRequests[0].answer,
        tags: cardRequests[0].tags,
        suspended: false,
        due_at: "2026-07-02T08:00:00.000Z",
        interval_days: 1,
        repetitions: 0,
        ease_factor: 2.5,
        created_at: "2026-07-01T08:00:00.000Z",
        updated_at: "2026-07-01T08:00:00.000Z",
      }),
    });
  });

  await page.route(`${API_BASE}/v1/reviews`, async (route) => {
    reviewRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        card_id: "card_due_1",
        card_type: "qa",
        review_mode: "recall",
        next_due_at: "2026-07-04T08:00:00.000Z",
        interval_days: 3,
        repetitions: 1,
        ease_factor: 2.5,
      }),
    });
  });

  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Due queue" })).toBeVisible();
  await expect(page.getByText("What is the point of making the card yourself?")).toBeVisible();

  await page.getByLabel("Morning plan").fill("- Make three cards\n- Review the due queue");
  await page.getByLabel("Evening reflection").fill("Manual creation made the review sharper.");
  await page.getByRole("button", { name: "Save daily note" }).click();
  await expect.poll(() => dailyRequests.length).toBe(1);
  expect(dailyRequests[0]).toEqual({
    morning_plan_md: "- Make three cards\n- Review the due queue",
    evening_reflection_md: "Manual creation made the review sharper.",
  });
  await expect(page.getByText("Saved v1")).toBeVisible();

  await page.getByLabel("Prompt").fill("What should a good SRS card test?");
  await page.getByLabel("Answer").fill("One focused recall decision that I can honestly grade.");
  await page.getByLabel("Tags").fill("srs, manual");
  await page.getByRole("button", { name: "Save card" }).click();
  await expect.poll(() => cardRequests.length).toBe(1);
  expect(cardRequests[0]).toEqual({
    deck_id: "deck_inbox",
    prompt: "What should a good SRS card test?",
    answer: "One focused recall decision that I can honestly grade.",
    tags: ["srs", "manual"],
  });
  await expect(page.getByText(/Saved card\. First review:/)).toBeVisible();

  await page.getByRole("button", { name: "Reveal answer" }).click();
  await expect(page.getByText("The act of framing the prompt and answer")).toBeVisible();
  await page.getByRole("button", { name: "Good" }).click();
  await expect.poll(() => reviewRequests.length).toBe(1);
  expect(reviewRequests[0]).toEqual({ card_id: "card_due_1", rating: 4 });
  await expect(page.getByText("Recorded Good.")).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("pwa-today-desktop.png"), fullPage: true });
});

test("PWA today fits mobile viewport", async ({ page }, testInfo) => {
  await seedAssistantSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const cardRequests: Array<Record<string, unknown>> = [];

  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(decks) });
  });
  await page.route(`${API_BASE}/v1/cards/due**`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`${API_BASE}/v1/daily-notes/**`, async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Daily note not found" }) });
  });
  await page.route(`${API_BASE}/v1/cards`, async (route) => {
    cardRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "card_mobile_manual",
        deck_id: "deck_inbox",
        card_type: "qa",
        prompt: cardRequests[0].prompt,
        answer: cardRequests[0].answer,
        tags: cardRequests[0].tags,
        suspended: false,
        due_at: "2026-07-02T08:00:00.000Z",
        interval_days: 1,
        repetitions: 0,
        ease_factor: 2.5,
        created_at: "2026-07-01T08:00:00.000Z",
        updated_at: "2026-07-01T08:00:00.000Z",
      }),
    });
  });

  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New card" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan and reflection" })).toBeVisible();

  await page.getByLabel("Prompt").fill("Mobile card prompt?");
  await page.getByLabel("Answer").fill("Mobile card answer.");
  await page.getByRole("button", { name: "Save card" }).click();
  await expect.poll(() => cardRequests.length).toBe(1);
  expect(cardRequests[0]).toEqual({
    deck_id: "deck_inbox",
    prompt: "Mobile card prompt?",
    answer: "Mobile card answer.",
    tags: [],
  });
  await expect(page.getByText(/Saved card\. First review:/)).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("pwa-today-mobile.png"), fullPage: true });
});
