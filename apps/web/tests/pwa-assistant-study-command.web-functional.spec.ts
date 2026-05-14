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
