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

function threadSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "thr_primary",
    slug: "primary",
    title: "Assistant thread",
    mode: "assistant",
    created_at: "2026-04-21T09:00:00.000Z",
    updated_at: "2026-04-21T09:00:00.000Z",
    last_message_at: null,
    last_preview_text: null,
    messages: [],
    runs: [],
    interrupts: [],
    next_cursor: "2026-04-21T09:00:00.000Z",
    ...overrides,
  };
}

async function routeAssistantShell(page: import("@playwright/test").Page, snapshot: Record<string, unknown>) {
  await page.route(`${API_BASE}/v1/assistant/threads/primary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/updates*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        thread_id: "thr_primary",
        cursor: snapshot.next_cursor,
        deltas: [],
      }),
    });
  });
}

test("renders rich assistant thread parts from the snapshot", async ({ page }) => {
  await seedSession(page);
  await page.route(`${API_BASE}/v1/assistant/threads/primary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        threadSnapshot({
          last_message_at: "2026-04-21T09:01:00.000Z",
          last_preview_text: "Planner noticed a conflict and surfaced it in the thread.",
          messages: [
            {
              id: "msg_assistant_1",
              thread_id: "thr_primary",
              run_id: null,
              role: "assistant",
              status: "complete",
              parts: [
                {
                  type: "text",
                  id: "part_text_1",
                  text: "Planner noticed a conflict and surfaced it in the thread.",
                },
                {
                  type: "ambient_update",
                  id: "part_ambient_1",
                  update: {
                    id: "ambient_1",
                    event_id: "evt_1",
                    label: "Planner conflict detected",
                    body: "Deep Work overlaps with Team Sync.",
                    entity_ref: null,
                    actions: [],
                    metadata: {},
                    created_at: "2026-04-21T09:01:00.000Z",
                  },
                },
                {
                  type: "tool_call",
                  id: "part_tool_1",
                  tool_call: {
                    id: "tool_1",
                    tool_name: "resolve_planner_conflict",
                    tool_kind: "ui_tool",
                    status: "requires_action",
                    arguments: { block_id: "tb_1" },
                    title: "Resolve overlap",
                    metadata: {},
                  },
                },
              ],
              metadata: {},
              created_at: "2026-04-21T09:01:00.000Z",
              updated_at: "2026-04-21T09:01:00.000Z",
            },
          ],
        }),
      ),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/stream`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": keep-alive\n\n",
    });
  });

  await page.goto("/assistant");

  await expect(page.getByRole("heading", { name: "Assistant thread", exact: true })).toBeVisible();
  await expect(page.getByText("Planner noticed a conflict and surfaced it in the thread.")).toBeVisible();
  await expect(page.getByText("Planner conflict detected")).toBeVisible();
  await expect(page.getByText("resolve_planner_conflict")).toBeVisible();
});

test("navigation and composer card actions stay live in the assistant thread", async ({ page }) => {
  await seedSession(page);
  await routeAssistantShell(
    page,
    threadSnapshot({
      last_message_at: "2026-04-21T09:02:00.000Z",
      last_preview_text: "Here are two next actions.",
      messages: [
        {
          id: "msg_assistant_1",
          thread_id: "thr_primary",
          run_id: null,
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_text_1",
              text: "Here are two next actions.",
            },
            {
              type: "card",
              id: "part_card_nav",
              card: {
                kind: "review_queue",
                version: 1,
                title: "Due cards",
                body: "Two cards are ready in Review.",
                entity_ref: null,
                actions: [
                  {
                    id: "open_review",
                    label: "Open Review",
                    kind: "navigate",
                    payload: { href: "/review" },
                    style: "secondary",
                    requires_confirmation: false,
                  },
                ],
                metadata: {},
              },
            },
            {
              type: "card",
              id: "part_card_compose",
              card: {
                kind: "knowledge_note",
                version: 1,
                title: "Follow-up prompt",
                body: "Ask for a tighter summary before you schedule it.",
                entity_ref: null,
                actions: [
                  {
                    id: "ask_follow_up",
                    label: "Ask follow-up",
                    kind: "composer",
                    payload: { prompt: "Summarize the current review queue and suggest the first card to grade." },
                    style: "secondary",
                    requires_confirmation: false,
                  },
                ],
                metadata: {},
              },
            },
          ],
          metadata: {},
          created_at: "2026-04-21T09:02:00.000Z",
          updated_at: "2026-04-21T09:02:00.000Z",
        },
      ],
    }),
  );

  await page.route(`${API_BASE}/v1/assistant/threads/primary/stream`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": keep-alive\n\n",
    });
  });

  await page.goto("/assistant");

  await page.getByRole("button", { name: "Ask follow-up" }).click();
  await expect(
    page.getByPlaceholder("Capture, plan, review, or ask the Assistant to move something forward."),
  ).toHaveValue("Summarize the current review queue and suggest the first card to grade.");

  await page.getByRole("button", { name: "Open Review" }).click();
  await expect(page).toHaveURL(/\/review$/);
});

test("mutation card actions confirm, execute, and refresh the thread snapshot", async ({ page }) => {
  await seedSession(page);

  let snapshotStage: "initial" | "updated" = "initial";
  let mutationCalls = 0;

  await page.route(`${API_BASE}/v1/assistant/threads/primary`, async (route) => {
    const snapshot =
      snapshotStage === "initial"
        ? threadSnapshot({
            last_message_at: "2026-04-21T09:03:00.000Z",
            last_preview_text: "You can cache the morning briefing audio.",
            messages: [
              {
                id: "msg_assistant_1",
                thread_id: "thr_primary",
                run_id: null,
                role: "assistant",
                status: "complete",
                parts: [
                  {
                    type: "text",
                    id: "part_text_1",
                    text: "You can cache the morning briefing audio.",
                  },
                  {
                    type: "card",
                    id: "part_card_1",
                    card: {
                      kind: "briefing",
                      version: 1,
                      title: "Morning briefing",
                      body: "The spoken briefing is ready to cache.",
                      entity_ref: null,
                      actions: [
                        {
                          id: "cache_audio",
                          label: "Cache audio",
                          kind: "mutation",
                          payload: {
                            endpoint: "/v1/briefings/briefing_1/audio/render",
                            method: "POST",
                            body: { provider_hint: "web_assistant" },
                          },
                          style: "primary",
                          requires_confirmation: true,
                        },
                      ],
                      metadata: {},
                    },
                  },
                ],
                metadata: {},
                created_at: "2026-04-21T09:03:00.000Z",
                updated_at: "2026-04-21T09:03:00.000Z",
              },
            ],
          })
        : threadSnapshot({
            last_message_at: "2026-04-21T09:03:10.000Z",
            last_preview_text: "Briefing audio cached for offline playback.",
            messages: [
              {
                id: "msg_assistant_2",
                thread_id: "thr_primary",
                run_id: null,
                role: "assistant",
                status: "complete",
                parts: [
                  {
                    type: "ambient_update",
                    id: "part_ambient_1",
                    update: {
                      id: "ambient_1",
                      event_id: "evt_1",
                      label: "Briefing audio cached",
                      body: "Offline playback is ready on this device.",
                      entity_ref: null,
                      actions: [],
                      metadata: {},
                      created_at: "2026-04-21T09:03:10.000Z",
                    },
                  },
                ],
                metadata: {},
                created_at: "2026-04-21T09:03:10.000Z",
                updated_at: "2026-04-21T09:03:10.000Z",
              },
            ],
          });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/updates*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        thread_id: "thr_primary",
        cursor: "2026-04-21T09:03:10.000Z",
        deltas: [],
      }),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/stream`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": keep-alive\n\n",
    });
  });

  await page.route(`${API_BASE}/v1/briefings/briefing_1/audio/render`, async (route) => {
    mutationCalls += 1;
    snapshotStage = "updated";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "queued" }),
    });
  });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain('Run "Cache audio"?');
    await dialog.accept();
  });

  await page.goto("/assistant");
  await page.getByRole("button", { name: "Cache audio" }).click();

  await expect.poll(() => mutationCalls).toBe(1);
  await expect(page.getByText("Briefing audio cached")).toBeVisible();
  await expect(page.getByText("Offline playback is ready on this device.")).toBeVisible();
});

test("queued mutation replay preserves custom headers and raw body semantics", async ({ page }) => {
  await seedSession(page);

  const mutationRequests: Array<{ headers: Record<string, string>; body: string | null }> = [];

  await routeAssistantShell(
    page,
    threadSnapshot({
      last_message_at: "2026-04-21T09:04:00.000Z",
      last_preview_text: "Render the briefing payload.",
      messages: [
        {
          id: "msg_assistant_1",
          thread_id: "thr_primary",
          run_id: null,
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_text_1",
              text: "Render the briefing payload.",
            },
            {
              type: "card",
              id: "part_card_1",
              card: {
                kind: "briefing",
                version: 1,
                title: "Render briefing",
                body: "Send the payload with a custom replay header.",
                entity_ref: null,
                actions: [
                  {
                    id: "render_payload",
                    label: "Render payload",
                    kind: "mutation",
                    payload: {
                      endpoint: "/v1/briefings/briefing_2/audio/render",
                      method: "POST",
                      body: "render=this",
                      headers: {
                        "X-Starlog-Replay": "preserve-me",
                      },
                    },
                    style: "primary",
                    requires_confirmation: false,
                  },
                ],
                metadata: {},
              },
            },
          ],
        },
      ],
    }),
  );

  await page.route(`${API_BASE}/v1/briefings/briefing_2/audio/render`, async (route) => {
    mutationRequests.push({
      headers: await route.request().allHeaders(),
      body: route.request().postData(),
    });
    await route.fulfill({
      status: mutationRequests.length === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify({ status: mutationRequests.length === 1 ? "retry" : "ok" }),
    });
  });

  await page.goto("/assistant");
  await page.getByRole("button", { name: "Render payload" }).click();

  await expect(page.getByText('Queued "Render payload" for replay.')).toBeVisible();

  await expect.poll(() => mutationRequests.length).toBe(2);

  for (const request of mutationRequests) {
    expect(request.headers["x-starlog-replay"]).toBe("preserve-me");
    expect(request.headers["content-type"]).toContain("text/plain");
    expect(request.body).toBe("render=this");
  }
});
