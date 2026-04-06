import { expect, test } from "@playwright/test";

const API_BASE = "http://api.local";
const TOKEN = "token-123";

async function seedSession(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(
    ({ apiBase, token }) => {
      window.localStorage.setItem("starlog-api-base", apiBase);
      window.localStorage.setItem("starlog-token", token);
    },
    { apiBase: API_BASE, token: TOKEN },
  );
}

test("hydrates the assistant from the server conversation and clears session state", async ({ page }) => {
  await seedSession(page);

  let sessionState: Record<string, unknown> = { last_matched_intent: "list_tasks" };
  let conversationLoads = 0;

  await page.route(`${API_BASE}/v1/agent/intents`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route(`${API_BASE}/v1/ai/jobs*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route(`${API_BASE}/v1/conversations/primary/session/reset`, async (route) => {
    sessionState = {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        thread_id: "thr_primary",
        session_state: {},
        cleared_keys: ["last_matched_intent"],
        preserved_message_count: 2,
        preserved_tool_trace_count: 1,
        updated_at: "2026-03-22T09:00:00.000Z",
      }),
    });
  });

  await page.route(`${API_BASE}/v1/conversations/primary`, async (route) => {
    conversationLoads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "thr_primary",
        slug: "primary",
        title: "Primary conversation",
        mode: "voice_native",
        session_state: sessionState,
        tool_traces: [
          {
            id: "trace_1",
            thread_id: "thr_primary",
            message_id: "msg_assistant_1",
            tool_name: "list_tasks",
            arguments: { status: "open" },
            status: "completed",
            result: { tasks: [{ id: "task_1" }] },
            metadata: {},
            created_at: "2026-03-22T08:01:02.000Z",
          },
        ],
        created_at: "2026-03-22T08:00:00.000Z",
        updated_at: "2026-03-22T08:05:00.000Z",
        messages: [
          {
            id: "msg_user_1",
            thread_id: "thr_primary",
            role: "user",
            content: "list tasks",
            cards: [],
            metadata: {},
            created_at: "2026-03-22T08:01:00.000Z",
          },
          {
            id: "msg_assistant_1",
            thread_id: "thr_primary",
            role: "assistant",
            content: "Loaded your tasks.",
            cards: [
              {
                kind: "assistant_summary",
                version: 1,
                title: "Task queue",
                body: "3 tasks need attention next.",
                metadata: {},
              },
            ],
            metadata: {
              assistant_command: {
                command: "list tasks",
                planner: "voice_native_preview",
                matched_intent: "list_tasks",
                status: "planned",
                summary: "Loaded your current tasks into the queue.",
                steps: [],
              },
            },
            created_at: "2026-03-22T08:01:02.000Z",
          },
        ],
      }),
    });
  });

  await page.goto("/assistant");

  await expect(
    page.getByRole("button", {
      name: /list_tasks .*list tasks .*Loaded your current tasks into the queue\./i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Queue state and session memory" })).toBeVisible();
  await expect(page.getByText("Loaded your current tasks into the queue.").first()).toBeVisible();
  await expect(page.getByText("1 card attached")).toBeVisible();
  await expect(page.getByText("Task queue")).toBeVisible();
  await expect(page.getByText("Used 1 tool")).toBeVisible();
  await expect(page.getByText("Short-term context live")).toBeVisible();

  await page.getByRole("button", { name: "Reset session" }).click();

  await expect(page.getByText("Session memory clear")).toBeVisible();
  await expect(page.getByText("1 key cleared; kept 2 messages and 1 traces")).toBeVisible();
  await expect.poll(() => conversationLoads).toBe(1);
});

test("navigation-style conversation cards open their target surface", async ({ page }) => {
  await seedSession(page);

  await page.route(`${API_BASE}/v1/agent/intents`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route(`${API_BASE}/v1/ai/jobs*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route(`${API_BASE}/v1/conversations/primary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "thr_primary",
        slug: "primary",
        title: "Primary conversation",
        mode: "voice_native",
        session_state: {},
        tool_traces: [],
        created_at: "2026-03-22T08:00:00.000Z",
        updated_at: "2026-03-22T08:05:00.000Z",
        messages: [
          {
            id: "msg_user_1",
            thread_id: "thr_primary",
            role: "user",
            content: "what should I study next?",
            cards: [],
            metadata: {},
            created_at: "2026-03-22T08:01:00.000Z",
          },
          {
            id: "msg_assistant_1",
            thread_id: "thr_primary",
            role: "assistant",
            content: "You have a review queue and a note worth opening.",
            cards: [
              {
                kind: "review_queue",
                version: 1,
                title: "Due cards",
                body: "2 cards are ready now.",
                metadata: {},
              },
              {
                kind: "knowledge_note",
                version: 1,
                title: "Orbit note",
                body: "Capture the reset decisions before they drift.",
                metadata: {},
              },
            ],
            metadata: {},
            created_at: "2026-03-22T08:01:02.000Z",
          },
        ],
      }),
    });
  });

  await page.goto("/assistant");

  await page.getByRole("button", { name: "Open review" }).click();
  await expect(page).toHaveURL(/\/review$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/assistant$/);

  await page.getByRole("button", { name: "Open note" }).click();
  await expect(page).toHaveURL(/\/notes$/);
});

test("collapsed assistant side panes stay hidden after reload", async ({ page }) => {
  await seedSession(page);

  await page.route(`${API_BASE}/v1/agent/intents`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route(`${API_BASE}/v1/ai/jobs*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route(`${API_BASE}/v1/conversations/primary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "thr_primary",
        slug: "primary",
        title: "Primary conversation",
        mode: "voice_native",
        session_state: {},
        tool_traces: [],
        created_at: "2026-03-22T09:00:00.000Z",
        updated_at: "2026-03-22T09:00:00.000Z",
        messages: [],
      }),
    });
  });

  await page.goto("/assistant");

  await page.getByRole("button", { name: "Hide pane" }).nth(0).click();
  await page.getByRole("button", { name: "Hide pane" }).nth(0).click();

  await expect(page.getByRole("button", { name: "Show advanced lanes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show diagnostics" })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("button", { name: "Show advanced lanes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show diagnostics" })).toBeVisible();
  await expect(page.getByText("Operator history and reusable prompts")).toHaveCount(0);
  await expect(page.getByText("Queue state and session memory")).toHaveCount(0);
});
