import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const API_BASE = `http://127.0.0.1:${process.env.STARLOG_LIVE_FUNCTIONAL_API_PORT || "8035"}`;
const TEST_PASSPHRASE = "starlog-local-live-passphrase-2026";
const TEST_RUN_ID = `live-functional-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const INTERVIEW_PREP_TOPIC_TITLE = "Sliding Window";

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

type StarlogSession = {
  apiBase: string;
  token: string;
};

type AssistantCommand = {
  matched_intent: string;
  status: string;
};

type AssistantMessagePart = {
  type?: string;
  text?: string;
  card?: {
    renderer_key?: string;
    title?: string;
    body?: string;
    structured_content?: {
      reason?: string;
      recommendation_reason?: string;
    };
    metadata?: {
      recommendation_reason?: string;
    };
  };
};

type AssistantCommandMetadata = {
  metadata?: {
    assistant_command?: AssistantCommand;
  };
};

type AssistantMessagePayload = {
  user_message: {
    role: string;
  };
  assistant_message: {
    role: string;
    parts?: AssistantMessagePart[];
    metadata?: AssistantCommandMetadata["metadata"];
  };
};

type StudyTopic = {
  id: string;
  title: string;
  status: string;
};

type DueCard = {
  id: string;
  prompt: string;
  answer: string;
  card_type: string;
  review_mode: string;
};

type RecommendationHint = {
  signal_type: string;
};

type BriefingPayload = {
  id: string;
  recommendation_hints: RecommendationHint[];
};

type ReviewRevealPayload = {
  source_surface: string;
  kind: string;
  payload?: {
    card_id?: string;
  };
  entity_ref?: {
    entity_id?: string;
  };
};

type AssistantThreadSnapshotPayload = {
  interrupts?: Array<{
    tool_name?: string;
    status?: string;
    structured_content?: {
      card_id?: string;
    };
  }>;
};

type AssistantInterruptSubmitPayload = {
  values?: Record<string, unknown>;
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

function isAssistantInterruptSubmitRequest(url: string): boolean {
  return /\/v1\/assistant\/interrupts\/[\w-]+\/submit$/.test(url);
}

function isBriefingGenerateRequest(url: string): boolean {
  return url.endsWith("/v1/briefings/generate");
}

async function expectJsonWith<T>(response: JsonResponse, matcher: (payload: T) => void): Promise<void> {
  const payload = (await response.json()) as T;
  matcher(payload);
}

async function getAuthenticatedSession(page: Page): Promise<StarlogSession> {
  const session = await page.evaluate(() => ({
    apiBase: window.localStorage.getItem("starlog-api-base"),
    token: window.localStorage.getItem("starlog-token"),
  }));
  expect(session.apiBase).toBeTruthy();
  expect(session.token).toBeTruthy();
  return {
    apiBase: session.apiBase || API_BASE,
    token: session.token || "",
  };
}

async function apiGetJson<T>(page: Page, session: StarlogSession, path: string): Promise<T> {
  const response = await page.request.get(`${session.apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
    },
  });
  expect(response.status()).toBeGreaterThanOrEqual(200);
  expect(response.status()).toBeLessThan(300);
  return (await response.json()) as T;
}

async function sendAssistantMessage(
  page: Page,
  composer: Locator,
  message: string,
): Promise<AssistantMessagePayload> {
  const assistantMessageRequest = page.waitForRequest((request) =>
    request.method() === "POST" && isAssistantThreadMessageUrl(request.url()),
  );

  const assistantMessageResponse = page.waitForResponse((response) => {
    return response.request().method() === "POST"
      && isAssistantThreadMessageUrl(response.url())
      && response.status() >= 200
      && response.status() < 300;
  });

  await composer.fill(message);
  await Promise.all([
    assistantMessageRequest,
    assistantMessageResponse,
    page.getByRole("button", { name: "Send" }).click(),
  ]);

  const requestPayload = (await assistantMessageRequest).postDataJSON() as { content: string };
  expect(requestPayload.content).toBe(message);
  const response = await assistantMessageResponse;
  return (await response.json()) as AssistantMessagePayload;
}

function latestCommandMessage(page: Page, expected: string | RegExp): Locator {
  return page.locator("main").getByText(expected).last();
}

function escapedRegExp(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

test("live PWA user flow covers study loop + review + briefing hints and alarm", async ({ page }, testInfo) => {
  const studyTag = `run:${TEST_RUN_ID}-w${testInfo.workerIndex}-r${testInfo.retry}`;
  const assistantSmokeText = `Live functional smoke checks interview-prep study loop validation (${studyTag})`;

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

  const capabilityPrompt = "show me what UI actions you can take";
  const capabilityResponse = await sendAssistantMessage(page, composer, capabilityPrompt);
  expect(capabilityResponse.assistant_message.metadata?.assistant_command).toMatchObject({
    matched_intent: "list_dynamic_ui_capabilities",
    status: "executed",
  });
  await expect(latestCommandMessage(page, capabilityPrompt)).toBeVisible();
  await expect(page.getByText(/Starlog dynamic UI/i)).toBeVisible();
  await expect(page.getByText(/topic unlock\/read/i)).toBeVisible();
  await expect(page.getByText(/review grading/i)).toBeVisible();
  await screenshot(page, testInfo, "02-assistant-capability-prompt");

  const assistantSmokeResponse = await sendAssistantMessage(page, composer, assistantSmokeText);
  expect(assistantSmokeResponse.user_message.role).toBe("user");
  expect(assistantSmokeResponse.assistant_message.role).toBe("assistant");
  await expect(composer).toHaveValue("");
  await expect(latestCommandMessage(page, /live functional smoke checks interview-prep study loop/i)).toBeVisible();
  await screenshot(page, testInfo, "03-assistant-opened");

  const session = await getAuthenticatedSession(page);
  const studyTopics = await apiGetJson<StudyTopic[]>(page, session, "/v1/study/topics?limit=120");
  expect(studyTopics.length).toBeGreaterThan(0);
  const studyTopic = studyTopics.find((topic) => topic.title === INTERVIEW_PREP_TOPIC_TITLE);
  if (!studyTopic) {
    throw new Error(`Expected seeded topic '${INTERVIEW_PREP_TOPIC_TITLE}' to be present in study topics.`);
  }
  expect(studyTopic.title).toBe(INTERVIEW_PREP_TOPIC_TITLE);

  const unlockCommand = `unlock ${studyTopic.title}`;
  const unlockResponse = await sendAssistantMessage(page, composer, unlockCommand);
  const unlockCommandMetadata = unlockResponse.assistant_message.metadata?.assistant_command;
  expect(unlockCommandMetadata).toMatchObject({
    matched_intent: "unlock_study_topic",
    status: "executed",
  });
  await expect(latestCommandMessage(page, escapedRegExp(studyTopic.title))).toBeVisible();

  const readCommand = `I read ${studyTopic.title}`;
  const readResponse = await sendAssistantMessage(page, composer, readCommand);
  const readCommandMetadata = readResponse.assistant_message.metadata?.assistant_command;
  expect(readCommandMetadata).toMatchObject({
    matched_intent: "mark_study_topic_read",
    status: "executed",
  });
  await expect(latestCommandMessage(page, escapedRegExp(studyTopic.title))).toBeVisible();

  const quizCommand = `quiz me on ${studyTopic.title}`;
  const quizResponse = await sendAssistantMessage(page, composer, quizCommand);
  const quizCommandMetadata = quizResponse.assistant_message.metadata?.assistant_command;
  expect(quizCommandMetadata).toMatchObject({
    matched_intent: "create_study_question_request",
    status: "executed",
  });
  await expect(latestCommandMessage(page, /request study questions/i)).toBeVisible();
  await screenshot(page, testInfo, "04-study-commands");

  const dueCards = await apiGetJson<DueCard[]>(page, session, "/v1/cards/due?limit=20");
  expect(dueCards.length).toBeGreaterThan(0);
  const expectedDueCard = dueCards[0];

  await page.goto("/review");
  await expect(page.getByRole("button", { name: "Reveal Answer" })).toBeVisible();

  const reviewRevealRequest = page.waitForRequest((request) =>
    request.method() === "POST" && isReviewRevealRequest(request.url()),
  );
  const reviewRevealResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && isReviewRevealRequest(response.url()) && response.status() >= 200
      && response.status() < 300,
  );
  const [revealRequest, revealResponse] = await Promise.all([
    reviewRevealRequest,
    reviewRevealResponse,
    page.getByRole("button", { name: "Reveal Answer" }).click(),
  ]);
  const revealPayload = revealRequest.postDataJSON() as ReviewRevealPayload;
  expect(revealPayload).toMatchObject({
    source_surface: "review",
    kind: "review.answer.revealed",
  });

  const revealedCardId = revealPayload.payload?.card_id || revealPayload.entity_ref?.entity_id;
  const dueCardIds = new Set(dueCards.map((card) => card.id));
  expect(revealedCardId).toBeTruthy();
  expect(dueCardIds.has(revealedCardId || "")).toBe(true);
  const expectedRevealedCardId = revealedCardId || "";
  const expectedRevealedCard = dueCards.find((card) => card.id === expectedRevealedCardId) ?? expectedDueCard;
  const revealSnapshot = (await revealResponse.json()) as AssistantThreadSnapshotPayload;
  expect(
    revealSnapshot.interrupts?.some((interrupt) =>
      interrupt.tool_name === "grade_review_recall"
      && interrupt.status === "pending"
      && interrupt.structured_content?.card_id === expectedRevealedCardId,
    ),
  ).toBe(true);
  await expect(page.getByText(expectedRevealedCard.answer.split("\n")[0], { exact: false }).first()).toBeVisible();
  await screenshot(page, testInfo, "05-review-reveal");

  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Starlog Assistant" })).toBeVisible();
  await expect(composer).toBeEnabled();
  const reviewGradePanel = page.locator(
    '[data-testid="dynamic-panel-renderer"][data-panel-tool="grade_review_recall"]',
  );
  await expect(reviewGradePanel).toBeVisible();
  await expect(reviewGradePanel).toContainText("Review grade");
  await expect(reviewGradePanel).toContainText("Keep in Review");
  await expect(reviewGradePanel).toContainText(expectedRevealedCard.prompt);
  await expect(reviewGradePanel.getByLabel("Review prompt")).toBeVisible();
  await expect(reviewGradePanel.getByLabel("Review prompt")).toContainText(expectedRevealedCard.prompt);
  await expect(page.getByText("Review grade").first()).toBeVisible();
  await expect(page.getByRole("radio", { name: "Good" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save grade" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep in Review" })).toBeVisible();
  await screenshot(page, testInfo, "06-assistant-review-grade-controls");

  const assistantGradeRequest = page.waitForRequest((request) =>
    request.method() === "POST" && isAssistantInterruptSubmitRequest(request.url()),
  );
  const assistantGradeResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && isAssistantInterruptSubmitRequest(response.url()) && response.status() >= 200
      && response.status() < 300,
  );
  await page.getByRole("radio", { name: "Good" }).click();
  await Promise.all([
    assistantGradeRequest,
    assistantGradeResponse,
    page.getByRole("button", { name: "Save grade" }).click(),
  ]);

  const assistantGradePayload = (await assistantGradeRequest).postDataJSON() as AssistantInterruptSubmitPayload;
  expect(assistantGradePayload.values).toMatchObject({
    rating: "4",
  });

  const reviewResponse = await assistantGradeResponse;
  await expectJsonWith<{
    messages: Array<{
      parts: Array<{
        type: string;
        text?: string;
        tool_result?: {
          renderer_key?: string;
          structured_content?: {
            card_id?: string;
            grade?: string;
            next_due_at?: string;
          };
          ui_meta?: {
            rating_label?: string;
            review_mode?: string;
          };
        };
      }>;
    }>;
  }>(
    reviewResponse,
    (payload) => {
      const textParts = payload.messages.flatMap((message) => message.parts.filter((part) => part.type === "text"));
      expect(textParts.some((part) => /Recorded Good for .+ review/i.test(part.text || ""))).toBe(true);
      const reviewToolResults = payload.messages.flatMap((message) =>
        message.parts
          .map((part) => part.tool_result)
          .filter((part): part is NonNullable<typeof part> => Boolean(part) && part.renderer_key === "interview.review_grade"),
      );
      expect(reviewToolResults.length).toBeGreaterThan(0);
      const latestReviewToolResult = reviewToolResults[reviewToolResults.length - 1];
      expect(latestReviewToolResult).toBeTruthy();
      expect(latestReviewToolResult?.structured_content).toMatchObject({
        card_id: expectedRevealedCardId,
        grade: "4",
        next_due_at: expect.any(String),
      });
      expect(Number.isNaN(Date.parse(String(latestReviewToolResult?.structured_content?.next_due_at || "")))).toBe(false);
      expect(latestReviewToolResult?.ui_meta).toMatchObject({
        rating_label: "Good",
        review_mode: expect.any(String),
      });
    },
  );
  await expect(page.getByText(/Recorded Good for .+ review/i)).toBeVisible();
  await screenshot(page, testInfo, "07-assistant-review-graded");

  await page.goto("/planner");
  await expect(page.getByRole("heading", { name: /Execution plan for/ })).toBeVisible();

  const briefingCreateResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && isBriefingGenerateRequest(response.url()),
  );
  await page.getByRole("button", { name: "Prepare briefing" }).click();
  const briefingResponse = await briefingCreateResponse;
  const briefingPayload = (await briefingResponse.json()) as BriefingPayload;
  expect(briefingPayload.id).toBeTruthy();
  expect(Array.isArray(briefingPayload.recommendation_hints)).toBe(true);
  expect(briefingPayload.recommendation_hints.length).toBeGreaterThan(0);
  expect(
    briefingPayload.recommendation_hints.some((hint) =>
      ["briefing_review", "briefing_study", "assistant_review", "briefing_focus", "briefing_schedule"].includes(hint.signal_type),
    ),
  ).toBeTruthy();
  await screenshot(page, testInfo, "08-briefing-generated");
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
  await screenshot(page, testInfo, "09-alarm-scheduled");
});
