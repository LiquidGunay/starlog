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
  await expect(page.getByText("Session Context")).toBeVisible();
  await expect(page.getByText("Loaded your current tasks into the queue.").first()).toBeVisible();
  await expect(page.getByText("Attached cards")).toBeVisible();
  await expect(page.getByText("Task queue")).toBeVisible();
  await expect(page.getByText("Runtime trace", { exact: true })).toBeVisible();
  await expect(page.getByText("1 live keys")).toBeVisible();
  await expect(page.getByText("No voice command jobs yet.")).toBeVisible();

  await page.getByRole("button", { name: "Reset session memory" }).click();

  await expect(page.getByText("0 live keys")).toBeVisible();
  await expect(page.getByText("Cleared: last_matched_intent")).toBeVisible();
  await expect.poll(() => conversationLoads).toBe(1);
});
