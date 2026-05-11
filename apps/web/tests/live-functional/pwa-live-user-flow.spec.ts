import { expect, test, type Page, type TestInfo } from "@playwright/test";

const API_BASE = `http://127.0.0.1:${process.env.STARLOG_LIVE_FUNCTIONAL_API_PORT || "8035"}`;
const TEST_PASSPHRASE = "starlog-local-live-passphrase-2026";
const TEST_RUN_ID = `live-functional-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CARD_PROMPT = "What did the live PWA functional smoke verify?";
const CARD_ANSWER = "Assistant interaction, review card setup, review grading, and alarm scheduling.";
const DECK_NAME = `Live functional deck ${TEST_RUN_ID}`;

function nowOffsetMinutes(minutes: number): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + minutes);
  return now.toISOString().slice(0, 16);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

type JsonResponse = {
  json: () => Promise<unknown>;
};

function isAssistantThreadMessageUrl(url: string): boolean {
  return /\/v1\/assistant\/threads\/[\w-]+\/messages$/.test(url);
}

function isAlarmCreateRequest(url: string): boolean {
  return url.endsWith("/v1/alarms") && url.includes("/v1/");
}

function isReviewRevealRequest(url: string): boolean {
  return url.endsWith("/v1/assistant/threads/primary/events");
}

function isReviewGradingRequest(url: string): boolean {
  return url.endsWith("/v1/reviews");
}

function isBriefingGenerateRequest(url: string): boolean {
  return url.endsWith("/v1/briefings/generate");
}

async function expectJsonWith<T>(response: JsonResponse, matcher: (payload: T) => void): Promise<void> {
  const payload = (await response.json()) as T;
  matcher(payload);
}

test("live PWA user flow covers assistant, review setup, review, and alarm", async ({ page }, testInfo) => {
  const runDeckName = `${DECK_NAME}-w${testInfo.workerIndex}-r${testInfo.retry}`;
  const runCardPrompt = `${CARD_PROMPT} (w${testInfo.workerIndex} r${testInfo.retry})`;

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Universal Identifier").fill(API_BASE);
  await page.getByLabel("Passphrase").fill(TEST_PASSPHRASE);
  const setupButton = page.getByRole("button", { name: /^Set Up Starlog$/ });
  const signInButton = page.getByRole("button", { name: /^Sign In$/ });

  const useSetup = (await setupButton.count()) > 0;
  const authAction = useSetup ? setupButton : signInButton;
  await expect(authAction).toBeVisible();
  await Promise.all([page.waitForURL(/\/assistant/), authAction.click()]);
  await expect(page.getByRole("heading", { name: "Starlog Assistant" })).toBeVisible();
  await screenshot(page, testInfo, "01-assistant-open");

  const composer = page.getByPlaceholder("Ask, capture, plan, review, or move something forward...");
  await expect(composer).toBeEnabled();
  const assistantMessageText =
    "Remember that this live functional smoke is checking the Assistant, Review, and alarm paths.";
  await composer.fill(assistantMessageText);

  const assistantMessageRequest = page.waitForRequest((request) =>
    request.method() === "POST" && isAssistantThreadMessageUrl(request.url()),
  );

  const assistantMessageResponse = page.waitForResponse((response) => {
    return response.request().method() === "POST"
      && isAssistantThreadMessageUrl(response.url())
      && response.status() >= 200
      && response.status() < 300;
  });
  await Promise.all([
    assistantMessageRequest,
    assistantMessageResponse,
    page.getByRole("button", { name: "Send" }).click(),
  ]);

  const assistantSendPayload = (await assistantMessageRequest).postDataJSON() as { content: string };
  expect(assistantSendPayload.content).toBe(assistantMessageText);

  await expectJsonWith<{ user_message: { role: string }; assistant_message: { role: string } }>(
    await assistantMessageResponse,
    (payload) => {
      expect(payload.user_message.role).toBe("user");
      expect(payload.assistant_message.role).toBe("assistant");
    },
  );

  await expect(composer).toHaveValue("");
  await expect(
    page
      .locator("main article")
      .filter({ has: page.getByText("You", { exact: false }) })
      .filter({ hasText: /live functional smoke is checking/i })
      .first(),
  ).toBeVisible();
  await screenshot(page, testInfo, "02-assistant-message-sent");

  await page.goto("/review/decks");
  await expect(page.getByRole("heading", { name: "Deck Browser" })).toBeVisible();
  const deckEditor = page.locator("div.panel.glass", { has: page.getByRole("heading", { name: "Deck editor" }) });
  const cardEditor = page.locator("div.panel.glass", { has: page.getByRole("heading", { name: "Card editor" }) });
  const deckListPanel = page.locator("div.panel.glass").filter({ has: page.locator("ul.review-browser-list") });
  const cardListPanel = page.locator("div.panel.glass").filter({ has: page.locator("ul.review-browser-list.scroll-panel") });
  const deckNameInput = deckEditor.locator("#deck-name");
  const deckDescriptionInput = deckEditor.locator("#deck-description");
  const deckSubmitButton = deckEditor.getByRole("button", { name: "Create Deck" });
  const cardPromptInput = cardEditor.locator("#card-prompt");
  const cardAnswerInput = cardEditor.locator("#card-answer");
  const cardTagsInput = cardEditor.locator("#card-tags");
  const cardDueInput = cardEditor.locator("#card-due");
  const cardSubmitButton = cardEditor.getByRole("button", { name: "Create Card" });

  const deckButton = deckListPanel.getByRole("button", { name: runDeckName, exact: true });
  const deckExists = (await deckButton.count()) > 0;
  if (!deckExists) {
    const createDeckRequest = page.waitForRequest((request) =>
      request.url().endsWith("/v1/cards/decks") && request.method() === "POST",
    );
    const createDeckResponse = page.waitForResponse((response) =>
      response.url().endsWith("/v1/cards/decks") && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "New Deck" }).click();
    await deckNameInput.fill(runDeckName);
    await deckNameInput.blur();
    await expect(deckNameInput).toHaveValue(runDeckName);
    await deckDescriptionInput.fill("Created through the browser during live functional validation.");

    await Promise.all([
      deckSubmitButton.click(),
      createDeckRequest,
      createDeckResponse,
    ]);

    const createDeckResponsePayload = await createDeckResponse;
    const createDeckRequestPayload = (await createDeckRequest).postDataJSON() as Record<string, unknown>;
    expect(createDeckRequestPayload).toMatchObject({ name: runDeckName });
    expect(createDeckResponsePayload.status()).toBe(201);

    await expect(deckButton).toBeVisible();
  }
  await expect(deckButton).toBeVisible();
  await deckButton.click();

  const cardButton = cardListPanel.getByRole("button", { name: runCardPrompt, exact: true });
  const cardExists = (await cardButton.count()) > 0;
  if (!cardExists) {
    const createCardRequest = page.waitForRequest((request) =>
      request.url().endsWith("/v1/cards") && request.method() === "POST",
    );
    const createCardResponse = page.waitForResponse((response) =>
      response.url().endsWith("/v1/cards") && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "New Card" }).click();
    await cardPromptInput.fill(runCardPrompt);
    await expect(cardPromptInput).toHaveValue(runCardPrompt);
    await cardAnswerInput.fill(CARD_ANSWER);
    await cardTagsInput.fill("live-functional, pwa");
    await cardDueInput.fill(nowOffsetMinutes(-5));

    await Promise.all([
      createCardRequest,
      createCardResponse,
      cardSubmitButton.click(),
    ]);

    const createCardRequestPayload = (await createCardRequest).postDataJSON() as Record<string, unknown>;
    expect(createCardRequestPayload).toMatchObject({ prompt: runCardPrompt });
  }
  await expect(cardButton).toBeVisible();
  await screenshot(page, testInfo, "03-review-card-created");

  await page.goto("/review");
  await expect(page.getByText(runCardPrompt)).toBeVisible();

  const reviewRevealRequest = page.waitForRequest((request) =>
    request.method() === "POST" && isReviewRevealRequest(request.url()),
  );
  await page.getByRole("button", { name: "Reveal Answer" }).click();
  const revealRequest = await reviewRevealRequest;
  expect(await revealRequest.postDataJSON()).toMatchObject({
    source_surface: "review",
    kind: "review.answer.revealed",
  });

  await expect(page.getByText(CARD_ANSWER)).toBeVisible();

  const reviewGradeRequest = page.waitForRequest((request) =>
    request.method() === "POST" && isReviewGradingRequest(request.url()),
  );
  const reviewGradeResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && isReviewGradingRequest(response.url()) && response.status() === 201,
  );
  await Promise.all([
    page.getByRole("button", { name: "Good" }).click(),
    reviewGradeRequest,
    reviewGradeResponse,
  ]);
  const reviewRequestPayload = (await reviewGradeRequest).postDataJSON() as {
    card_id: string;
    rating: number;
  };
  const reviewResponse = await reviewGradeResponse;

  expect(reviewRequestPayload).toMatchObject({
    card_id: expect.any(String),
    rating: 4,
  });

  await expectJsonWith<{
    card_id: string;
    card_type: string | null;
    review_mode: string;
    next_due_at: string;
    interval_days: number;
    repetitions: number;
    ease_factor: number;
  }>(
    reviewResponse,
    (payload) => {
      expect(payload.card_id).toBe(reviewRequestPayload.card_id);
      expect(payload).toHaveProperty("card_type");
      expect(payload.card_type === null || typeof payload.card_type === "string").toBe(true);
      expect(payload.review_mode).toBeTruthy();
      expect(payload.next_due_at).toEqual(expect.any(String));
      expect(payload.interval_days).toBeGreaterThanOrEqual(1);
      expect(payload.repetitions).toBeGreaterThan(0);
      expect(payload.ease_factor).toBeGreaterThan(1.2);
      expect(Number.isNaN(Date.parse(payload.next_due_at))).toBe(false);
    },
  );

  await expect(page.getByText(/Recorded Good/i)).toBeVisible();
  await screenshot(page, testInfo, "04-review-card-graded");

  await page.goto("/planner");
  await expect(page.getByRole("heading", { name: /Execution plan for/ })).toBeVisible();

  const briefingCreateResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && isBriefingGenerateRequest(response.url())
  );
  await page.getByRole("button", { name: "Prepare briefing" }).click();
  const briefingResponse = await briefingCreateResponse;

  const briefingPayload = (await briefingResponse.json()) as { id: string };
  expect(briefingPayload.id).toBeTruthy();

  await expect(page.getByText(/Briefing prepared for/)).toBeVisible();

  const createAlarmRequest = page.waitForRequest((request) =>
    request.method() === "POST" && isAlarmCreateRequest(request.url()),
  );
  const createAlarmResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && isAlarmCreateRequest(response.url()) && response.status() >= 200
      && response.status() < 300,
  );
  await page.getByLabel("Alarm time").fill(nowOffsetMinutes(120));
  await Promise.all([page.getByRole("button", { name: /Schedule alarm/i }).click(), createAlarmRequest, createAlarmResponse]);

  const scheduleRequest = await createAlarmRequest;
  const scheduleResponse = await createAlarmResponse;
  const scheduledAlarmPayload = (await scheduleRequest.postDataJSON()) as {
    briefing_package_id: string;
    trigger_at: string;
    device_target: string;
  };

  expect(scheduleResponse.status()).toBe(201);
  expect(scheduledAlarmPayload.briefing_package_id).toBe(briefingPayload.id);
  expect(scheduledAlarmPayload.device_target).toBe("pwa");
  expect(typeof scheduledAlarmPayload.trigger_at).toBe("string");

  await expect(page.getByText(/Alarm scheduled/i)).toBeVisible();
  await expect(page.locator("article", { hasText: /pwa/i })).toBeVisible();
  await screenshot(page, testInfo, "05-alarm-scheduled");
});
