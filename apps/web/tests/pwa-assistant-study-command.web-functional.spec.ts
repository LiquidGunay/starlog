import { expect, test } from "@playwright/test";

import {
  API_BASE,
  assistantThreadSnapshot,
  assistantTodaySummary,
  assistantWeeklySummary,
  routeAssistantThread,
  routeAssistantToday,
  routeAssistantWeekly,
  seedAssistantSession,
} from "./ui-functional/assistant-concept-fixtures";

async function routeAssistantMessages(
  page: import("@playwright/test").Page,
  onRequest: (body: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<void> {
  await page.route(`${API_BASE}/v1/assistant/threads/thr_primary/messages`, async (route) => {
    const body = (route.request().postDataJSON() as Record<string, unknown>) || {};
    const response = await onRequest(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}

const COMMON_TEST_METADATA = {
  surface: "assistant_web",
  client_timezone: expect.any(String),
};

test("PWA assistant visible unlock study command execution", async ({ page }) => {
  await seedAssistantSession(page);
  const requests: Array<Record<string, unknown>> = [];
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-05-01T10:00:00.000Z",
    last_preview_text: "Waiting for a study command.",
    messages: [
      {
        id: "msg_assistant_intro",
        thread_id: "thr_primary",
        run_id: null,
        role: "assistant",
        status: "complete",
        parts: [{ type: "text", id: "part_assistant_intro", text: "Try a study command and I will map it to study actions." }],
        metadata: {},
        created_at: "2026-05-01T09:59:30.000Z",
        updated_at: "2026-05-01T09:59:30.000Z",
      },
    ],
  });

  const command = "unlock Neetcode sliding window drills";

  await routeAssistantThread(page, () => snapshot);
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
  await routeAssistantMessages(page, (payload) => {
    requests.push(payload);
    snapshot = assistantThreadSnapshot({
      last_message_at: "2026-05-01T10:00:05.000Z",
      last_preview_text: "The study topic is unlocked.",
      messages: [
        ...snapshot.messages as Record<string, unknown>[],
        {
          id: "msg_user_unlock",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_unlock", text: command }],
          metadata: {},
          created_at: "2026-05-01T10:00:00.000Z",
          updated_at: "2026-05-01T10:00:00.000Z",
        },
        {
          id: "msg_assistant_unlock",
          thread_id: "thr_primary",
          run_id: "run_unlock_study",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_assistant_unlock",
              text: "I unlocked the study topic and set it to active.",
            },
          ],
          metadata: {
            assistant_command: {
              matched_intent: "unlock_study_topic",
              status: "executed",
            },
          },
          created_at: "2026-05-01T10:00:05.000Z",
          updated_at: "2026-05-01T10:00:05.000Z",
        },
      ],
    });
    const messages = snapshot.messages as Array<Record<string, unknown>>;

    return {
      thread_id: "thr_primary",
      run: {
        id: "run_unlock_study",
        thread_id: "thr_primary",
        origin_message_id: "msg_user_unlock",
        orchestrator: "hybrid",
        status: "completed",
        summary: "unlocked",
        metadata: {},
        steps: [],
        current_interrupt: null,
        created_at: "2026-05-01T10:00:00.000Z",
        updated_at: "2026-05-01T10:00:05.000Z",
      },
      user_message: {
        id: "msg_user_unlock",
        thread_id: "thr_primary",
        run_id: null,
        role: "user",
        status: "complete",
        parts: [{ type: "text", id: "part_user_unlock", text: command }],
        metadata: {},
        created_at: "2026-05-01T10:00:00.000Z",
        updated_at: "2026-05-01T10:00:00.000Z",
      },
      assistant_message: {
        id: "msg_assistant_unlock",
        thread_id: "thr_primary",
        run_id: "run_unlock_study",
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "text",
            id: "part_assistant_unlock",
            text: "I unlocked the study topic and set it to active.",
          },
        ],
        metadata: {
          assistant_command: {
            matched_intent: "unlock_study_topic",
            status: "executed",
          },
        },
        created_at: "2026-05-01T10:00:05.000Z",
        updated_at: "2026-05-01T10:00:05.000Z",
      },
      snapshot,
    };
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(command)).toBeVisible();
  await expect(page.getByText("I unlocked the study topic and set it to active.")).toBeVisible();

  expect(requests).toHaveLength(1);
  expect(requests[0].content).toBe(command);
  expect(requests[0]).toMatchObject({
    input_mode: "text",
    device_target: "web-desktop",
    metadata: COMMON_TEST_METADATA,
  });
});

test("PWA assistant submits visible study reading command payload", async ({ page }) => {
  await seedAssistantSession(page);
  const requests: Array<Record<string, unknown>> = [];
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-05-01T12:00:00.000Z",
    last_preview_text: "Waiting for study progress.",
    messages: [
      {
        id: "msg_assistant_reading_intro",
        thread_id: "thr_primary",
        run_id: null,
        role: "assistant",
        status: "complete",
        parts: [{ type: "text", id: "part_assistant_reading_intro", text: "Tell me what you read and I will update your study log." }],
        metadata: {},
        created_at: "2026-05-01T11:59:30.000Z",
        updated_at: "2026-05-01T11:59:30.000Z",
      },
    ],
  });

  const command = "I read Sliding Window";

  await routeAssistantThread(page, () => snapshot);
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
  await routeAssistantMessages(page, (payload) => {
    requests.push(payload);
    snapshot = assistantThreadSnapshot({
      last_message_at: "2026-05-01T12:00:05.000Z",
      last_preview_text: "Logged study progress.",
      messages: [
        ...(snapshot.messages as Record<string, unknown>[]),
        {
          id: "msg_user_reading",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_reading", text: command }],
          metadata: {},
          created_at: "2026-05-01T12:00:00.000Z",
          updated_at: "2026-05-01T12:00:00.000Z",
        },
        {
          id: "msg_assistant_reading",
          thread_id: "thr_primary",
          run_id: "run_reading_study",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_assistant_reading",
              text: "Logged Sliding Window in your study progress.",
            },
          ],
          metadata: {
            assistant_command: {
              matched_intent: "mark_study_topic_read",
              status: "executed",
            },
          },
          created_at: "2026-05-01T12:00:05.000Z",
          updated_at: "2026-05-01T12:00:05.000Z",
        },
      ],
    });
    const messages = snapshot.messages as Array<Record<string, unknown>>;

    return {
      thread_id: "thr_primary",
      run: {
        id: "run_reading_study",
        thread_id: "thr_primary",
        origin_message_id: "msg_user_reading",
        orchestrator: "hybrid",
        status: "completed",
        summary: "logged",
        metadata: {},
        steps: [],
        current_interrupt: null,
        created_at: "2026-05-01T12:00:00.000Z",
        updated_at: "2026-05-01T12:00:05.000Z",
      },
      user_message: {
        id: "msg_user_reading",
        thread_id: "thr_primary",
        run_id: null,
        role: "user",
        status: "complete",
        parts: [{ type: "text", id: "part_user_reading", text: command }],
        metadata: {},
        created_at: "2026-05-01T12:00:00.000Z",
        updated_at: "2026-05-01T12:00:00.000Z",
      },
      assistant_message: {
        id: "msg_assistant_reading",
        thread_id: "thr_primary",
        run_id: "run_reading_study",
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "text",
            id: "part_assistant_reading",
            text: "Logged Sliding Window in your study progress.",
          },
        ],
        metadata: {
          assistant_command: {
            matched_intent: "mark_study_topic_read",
            status: "executed",
          },
        },
        created_at: "2026-05-01T12:00:05.000Z",
        updated_at: "2026-05-01T12:00:05.000Z",
      },
      snapshot,
    };
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(command)).toBeVisible();
  await expect(page.getByText("Logged Sliding Window in your study progress.")).toBeVisible();

  expect(requests).toEqual([
    expect.objectContaining({
      content: command,
      input_mode: "text",
      device_target: "web-desktop",
      metadata: COMMON_TEST_METADATA,
    }),
  ]);
});

test("PWA assistant visible quiz study request command execution", async ({ page }) => {
  await seedAssistantSession(page);
  const requests: Array<Record<string, unknown>> = [];
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-05-01T11:00:00.000Z",
    last_preview_text: "Waiting for a study request.",
  });

  const command = "quiz me on application questions for embeddings";

  await routeAssistantThread(page, () => snapshot);
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
  await routeAssistantMessages(page, (payload) => {
    requests.push(payload);
    snapshot = assistantThreadSnapshot({
      last_message_at: "2026-05-01T11:00:05.000Z",
      last_preview_text: "I queued a study question request.",
      messages: [
        ...snapshot.messages as Record<string, unknown>[],
        {
          id: "msg_user_quiz",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_quiz", text: command }],
          metadata: {},
          created_at: "2026-05-01T11:00:00.000Z",
          updated_at: "2026-05-01T11:00:00.000Z",
        },
        {
          id: "msg_assistant_quiz",
          thread_id: "thr_primary",
          run_id: "run_quiz_study",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_assistant_quiz",
              text: "I queued a study question request for application-focused prompts.",
            },
          ],
          metadata: {
            assistant_command: {
              matched_intent: "create_study_question_request",
              status: "executed",
            },
          },
          created_at: "2026-05-01T11:00:05.000Z",
          updated_at: "2026-05-01T11:00:05.000Z",
        },
      ],
    });

    return {
      thread_id: "thr_primary",
      run: {
        id: "run_quiz_study",
        thread_id: "thr_primary",
        origin_message_id: "msg_user_quiz",
        orchestrator: "hybrid",
        status: "completed",
        summary: "requested",
        metadata: {},
        steps: [],
        current_interrupt: null,
        created_at: "2026-05-01T11:00:00.000Z",
        updated_at: "2026-05-01T11:00:05.000Z",
      },
      user_message: {
        id: "msg_user_quiz",
        thread_id: "thr_primary",
        run_id: null,
        role: "user",
        status: "complete",
        parts: [{ type: "text", id: "part_user_quiz", text: command }],
        metadata: {},
        created_at: "2026-05-01T11:00:00.000Z",
        updated_at: "2026-05-01T11:00:00.000Z",
      },
      assistant_message: {
        id: "msg_assistant_quiz",
        thread_id: "thr_primary",
        run_id: "run_quiz_study",
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "text",
            id: "part_assistant_quiz",
            text: "I queued a study question request for application-focused prompts.",
          },
        ],
        metadata: {
          assistant_command: {
            matched_intent: "create_study_question_request",
            status: "executed",
          },
        },
        created_at: "2026-05-01T11:00:05.000Z",
        updated_at: "2026-05-01T11:00:05.000Z",
      },
      snapshot,
    };
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(command)).toBeVisible();
  await expect(page.getByText("I queued a study question request for application-focused prompts.")).toBeVisible();

  expect(requests).toHaveLength(1);
  expect(requests[0].content).toBe(command);
  expect(requests[0]).toMatchObject({
    input_mode: "text",
    device_target: "web-desktop",
    metadata: COMMON_TEST_METADATA,
  });
});

test("PWA interview prep loop unlocks from Assistant and completes one Review card", async ({ page }) => {
  await seedAssistantSession(page);
  const assistantRequests: Array<Record<string, unknown>> = [];
  const revealEvents: Array<Record<string, unknown>> = [];
  const studyQuestionRequests: Array<Record<string, unknown>> = [];
  const reviewSubmissions: Array<Record<string, unknown>> = [];
  const topicTitle = "Sliding Window Interview Patterns";
  const command = `unlock ${topicTitle}`;
  let studyTopicStatus: "locked" | "unlocked" | "read" = "locked";
  let reviewCards = [
    {
      id: "card-sliding-window-application",
      deck_id: "deck-interview-application",
      card_type: "application_case",
      review_mode: "application",
      prompt: "You need the longest subarray with at most two distinct values. Which window invariant keeps the algorithm linear?",
      answer: "Maintain counts inside the current window and shrink from the left whenever more than two distinct values are present.",
      due_at: "2026-05-20T12:00:00.000Z",
    },
  ];
  let reviewSummary = {
    ladder_counts: [{ key: "application", label: "Application", count: 1 }],
    total_ladder_counts: [{ key: "application", label: "Application", count: 1 }],
    deck_buckets: [{ key: "deck-interview-application", label: "Interview application", count: 1 }],
    queue_health: {
      due_count: 1,
      overdue_count: 0,
      due_soon_count: 1,
      suspended_count: 0,
      reviewed_today_count: 0,
      last_reviewed_at: "2026-05-15T09:00:00.000Z",
      average_latency_ms: 240,
    },
    learning_insights: [],
    recommended_drill: {
      mode: "application",
      title: "Sliding window application drill",
      body: "Practice the unlocked interview topic before adding another source.",
      prompt: `Quiz me on application questions for ${topicTitle}.`,
      reason: "You just unlocked this interview-prep topic and one application card is due now.",
      enabled: true,
    },
    generated_at: "2026-05-15T09:00:00.000Z",
  };
  const decks = [
    {
      id: "deck-interview-application",
      name: "Interview application",
      description: "Application transfer for coding interviews",
      card_count: 1,
      due_count: 1,
    },
  ];
  const studyProgress = () => ({
    source_count: 1,
    topic_count: 1,
    read_topic_count: studyTopicStatus === "read" ? 1 : 0,
    unlocked_topic_count: studyTopicStatus === "locked" ? 0 : 1,
    locked_topic_count: studyTopicStatus === "locked" ? 1 : 0,
    due_unlocked_card_count: reviewCards.length,
  });
  const studyTopics = () => [
    {
      id: "topic-sliding-window",
      source_id: "source-neetcode",
      parent_topic_id: null,
      title: topicTitle,
      summary: "Window boundaries, counts, and shrink conditions for interview problems.",
      display_order: 1,
      status: studyTopicStatus,
      manually_unlocked: studyTopicStatus !== "locked",
      unlocked_at: studyTopicStatus === "locked" ? null : "2026-05-15T09:01:00.000Z",
      read_at: studyTopicStatus === "read" ? "2026-05-15T09:02:00.000Z" : null,
      created_at: "2026-05-15T08:55:00.000Z",
      updated_at: "2026-05-15T09:01:00.000Z",
    },
  ];
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-05-15T09:00:00.000Z",
    last_preview_text: "Unlock the interview topic when you are ready.",
    messages: [
      {
        id: "msg_assistant_interview_intro",
        thread_id: "thr_primary",
        run_id: null,
        role: "assistant",
        status: "complete",
        parts: [{ type: "text", id: "part_assistant_interview_intro", text: "One interview-prep topic is ready to unlock." }],
        metadata: {},
        created_at: "2026-05-15T09:00:00.000Z",
        updated_at: "2026-05-15T09:00:00.000Z",
      },
    ],
  });

  await routeAssistantThread(page, () => snapshot);
  await routeAssistantToday(page, () => assistantTodaySummary({
    open_loops: [
      { key: "open_tasks", label: "Open tasks", count: 0, href: "/planner" },
      { key: "due_reviews", label: "Reviews due", count: 1, href: "/review" },
      { key: "locked_interview_topics", label: "Locked interview topics", count: 1, href: "/review" },
    ],
    recommended_next_move: {
      key: "unlock_interview_topic",
      title: "Unlock the next interview topic",
      body: "Sliding Window has one application card ready after unlock.",
      surface: "review",
      href: "/review",
      action_label: "Open Review",
      priority: 95,
      urgency: "high",
    },
    reason_stack: [
      "One locked interview-prep topic is blocking its linked review card.",
      "Application practice is the highest-value next step.",
    ],
    at_a_glance: [
      { key: "review", label: "Review due", count: 1, href: "/review" },
      { key: "locked_interview_topics", label: "Locked interview topics", count: 1, href: "/review" },
    ],
    quick_actions: [
      {
        key: "open_review",
        title: "Open Review",
        surface: "review",
        href: "/review",
        action_label: "Open Review",
        enabled: true,
        count: 1,
        reason: "Interview topic can be unlocked from Review.",
        priority: 95,
      },
    ],
  }));
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
  await routeAssistantMessages(page, (payload) => {
    assistantRequests.push(payload);
    studyTopicStatus = "unlocked";
    snapshot = assistantThreadSnapshot({
      last_message_at: "2026-05-15T09:01:00.000Z",
      last_preview_text: "Unlocked the interview topic and queued its application card.",
      messages: [
        ...(snapshot.messages as Record<string, unknown>[]),
        {
          id: "msg_user_interview_unlock",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_interview_unlock", text: command }],
          metadata: {},
          created_at: "2026-05-15T09:00:55.000Z",
          updated_at: "2026-05-15T09:00:55.000Z",
        },
        {
          id: "msg_assistant_interview_unlock",
          thread_id: "thr_primary",
          run_id: "run_interview_unlock",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_assistant_interview_unlock",
              text: "I unlocked Sliding Window Interview Patterns and queued one application review card.",
            },
            {
              type: "card",
              id: "part_card_interview_quiz",
              card: {
                kind: "learning_drill",
                version: 1,
                renderer_key: "interview.recommendation_reason",
                renderer_version: 1,
                placement: "thread",
                title: "Application quiz ready",
                body: "You just unlocked this interview-prep topic and one application card is due now.",
                structured_content: {
                  reason: "You just unlocked this interview-prep topic and one application card is due now.",
                  evidence: ["Unlocked topic: Sliding Window Interview Patterns", "Due application cards: 1"],
                  confidence: 0.92,
                },
                ui_meta: {
                  tone: "study",
                },
                entity_ref: {
                  entity_type: "study_topic",
                  entity_id: "topic-sliding-window",
                  href: "/review",
                  title: topicTitle,
                },
                actions: [
                  {
                    id: "open_interview_review",
                    label: "Open Review",
                    kind: "navigate",
                    payload: { href: "/review" },
                    style: "primary",
                  },
                ],
                metadata: {
                  topic_id: "topic-sliding-window",
                  card_id: "card-sliding-window-application",
                  review_mode: "application",
                  recommendation_reason: "You just unlocked this interview-prep topic and one application card is due now.",
                },
              },
            },
          ],
          metadata: {
            assistant_command: {
              matched_intent: "unlock_study_topic",
              status: "executed",
            },
          },
          created_at: "2026-05-15T09:01:00.000Z",
          updated_at: "2026-05-15T09:01:00.000Z",
        },
      ],
    });

    const messages = snapshot.messages as Array<Record<string, unknown>>;

    return {
      thread_id: "thr_primary",
      run: {
        id: "run_interview_unlock",
        thread_id: "thr_primary",
        origin_message_id: "msg_user_interview_unlock",
        orchestrator: "hybrid",
        status: "completed",
        summary: "unlocked interview topic",
        metadata: {},
        steps: [],
        current_interrupt: null,
        created_at: "2026-05-15T09:00:55.000Z",
        updated_at: "2026-05-15T09:01:00.000Z",
      },
      user_message: messages.find((message) => message.id === "msg_user_interview_unlock"),
      assistant_message: messages.find((message) => message.id === "msg_assistant_interview_unlock"),
      snapshot,
    };
  });
  await page.route(`${API_BASE}/v1/surfaces/review/summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewSummary) });
  });
  await page.route(`${API_BASE}/v1/cards/due*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewCards) });
  });
  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(decks) });
  });
  await page.route(`${API_BASE}/v1/study/progress`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(studyProgress()) });
  });
  await page.route(`${API_BASE}/v1/study/topics*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(studyTopics()) });
  });
  await page.route(`${API_BASE}/v1/study/question-requests`, async (route) => {
    studyQuestionRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });
  await page.route(`${API_BASE}/v1/assistant/threads/primary/events`, async (route) => {
    revealEvents.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });
  await page.route(`${API_BASE}/v1/reviews`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    reviewSubmissions.push(payload);
    reviewCards = reviewCards.filter((card) => card.id !== payload.card_id);
    reviewSummary = {
      ...reviewSummary,
      ladder_counts: [{ key: "application", label: "Application", count: 0 }],
      queue_health: {
        ...reviewSummary.queue_health,
        due_count: 0,
        due_soon_count: 0,
        reviewed_today_count: 1,
        last_reviewed_at: "2026-05-15T09:05:00.000Z",
      },
    };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "review-1" }) });
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Unlock the next interview topic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sliding Window has one application card ready after unlock." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Locked interview topics: 1" })).toBeVisible();

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(command)).toBeVisible();
  await expect(page.getByText("I unlocked Sliding Window Interview Patterns and queued one application review card.")).toBeVisible();
  const quizCard = page.locator("section").filter({ hasText: "Application quiz ready" });
  await expect(quizCard.getByText("You just unlocked this interview-prep topic and one application card is due now.")).toBeVisible();
  await quizCard.getByRole("link", { name: "Open Review" }).click();

  await expect(page).toHaveURL(/\/review$/);
  const studyTopic = page.locator(".april-review-study-topic");
  await expect(studyTopic.getByText("Sliding Window Interview Patterns", { exact: true })).toBeVisible();
  await expect(studyTopic.getByText("Ready to study", { exact: true })).toBeVisible();
  await expect(page.getByText("Reason: You just unlocked this interview-prep topic and one application card is due now.")).toBeVisible();
  await expect(page.getByText("You need the longest subarray with at most two distinct values.")).toBeVisible();
  await expect(page.getByText("Maintain counts inside the current window")).toHaveCount(0);

  await page.getByRole("button", { name: "Application Question" }).click();
  await expect(page.getByText("Requested an application question for Sliding Window Interview Patterns.")).toBeVisible();
  expect(studyQuestionRequests).toEqual([
    expect.objectContaining({
      topic_id: "topic-sliding-window",
      response: { question_preference: "application" },
    }),
  ]);

  await page.getByRole("button", { name: "Reveal Answer" }).click();
  await expect(page.getByText("Maintain counts inside the current window")).toBeVisible();
  expect(revealEvents).toHaveLength(1);
  expect(revealEvents[0]).toMatchObject({
    source_surface: "review",
    kind: "review.answer.revealed",
    payload: {
      card_id: "card-sliding-window-application",
      review_mode: "application",
    },
  });

  await page.getByRole("button", { name: "Good 3d" }).click();
  await expect(page.getByText("Recorded Good for card-sliding-window-application.")).toBeVisible();
  await expect(page.getByText("No due cards loaded.")).toBeVisible();
  await expect(page.getByText("Again 0 | Hard 0 | Good 1 | Easy 0")).toBeVisible();
  await expect(page.getByText("Reviewed today")).toBeVisible();
  await expect(page.getByText("1 reviewed")).toBeVisible();
  expect(reviewSubmissions).toEqual([{ card_id: "card-sliding-window-application", rating: 4 }]);
  expect(assistantRequests[0]).toMatchObject({
    content: command,
    input_mode: "text",
    device_target: "web-desktop",
    metadata: COMMON_TEST_METADATA,
  });
});
