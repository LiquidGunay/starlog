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

async function routeDynamicAssistantShell(
  page: import("@playwright/test").Page,
  getSnapshot: () => Record<string, unknown>,
) {
  await page.route(`${API_BASE}/v1/assistant/threads/primary`, async (route) => {
    const snapshot = getSnapshot();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/updates*`, async (route) => {
    const snapshot = getSnapshot();
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

async function routeIdleAssistantStream(page: import("@playwright/test").Page) {
  await page.route(`${API_BASE}/v1/assistant/threads/primary/stream`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": keep-alive\n\n",
    });
  });
}

test("opens an empty assistant thread to a clean centered start state", async ({ page }) => {
  await seedSession(page);
  await routeAssistantShell(
    page,
    threadSnapshot({
      interrupts: [
        {
          id: "interrupt_capture_today",
          thread_id: "thr_primary",
          run_id: "run_today",
          tool_name: "triage_capture",
          interrupt_type: "form",
          status: "pending",
          title: "Triage latest capture",
          body: "Decide where this saved source should land.",
          primary_label: "Save route",
          secondary_label: "Skip",
          defer_label: "Later",
          fields: [],
          entity_ref: {
            entity_type: "artifact",
            entity_id: "art_today",
            href: "/artifacts?artifact=art_today",
            title: "Inbox capture",
          },
          consequence_preview: null,
          resolution: null,
          created_at: "2026-04-21T09:01:00.000Z",
          resolved_at: null,
          metadata: {},
        },
      ],
    }),
  );
  await routeIdleAssistantStream(page);

  await page.goto("/assistant");

  await expect(page.getByLabel("Assistant thread start")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await expect(page.getByLabel("Suggested next prompt")).toContainText("Triage latest capture");
  await expect(page.getByLabel("Assistant context")).toContainText("Capture needs triage");
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Recommended next move" })).toHaveCount(0);

  await page.getByLabel("Suggested prompts").getByRole("button", { name: "Process latest capture" }).click();
  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    /^Process (my latest Library captures and route anything actionable\.|latest capture)$/,
  );
});

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
                {
                  type: "status",
                  id: "part_status_1",
                  status: "running",
                  label: "Planner sync is still reconciling background changes.",
                },
                {
                  type: "status",
                  id: "part_status_2",
                  status: "unlocked",
                },
                {
                  type: "tool_result",
                  id: "part_tool_result_1",
                  tool_result: {
                    id: "tool_result_1",
                    tool_call_id: "tool_1",
                    status: "complete",
                    output: {
                      job_id: "briefing_job_1",
                      status: "queued",
                      provider: "web_assistant",
                    },
                    entity_ref: {
                      entity_type: "briefing",
                      entity_id: "briefing_1",
                      href: "/planner?briefing=briefing_1",
                      title: "Morning briefing",
                    },
                    metadata: {},
                  },
                },
                {
                  type: "attachment",
                  id: "part_attachment_1",
                  attachment: {
                    id: "attachment_1",
                    kind: "audio",
                    label: "Morning briefing audio",
                    url: "/v1/media/media_briefing_1/content",
                    mime_type: "audio/mpeg",
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

  await expect(page.getByText("Planner noticed a conflict and surfaced it in the thread.")).toBeVisible();
  await expect(page.getByText("Planner conflict detected")).toBeVisible();
  await expect(page.getByText("Planner conflict", { exact: true })).toBeVisible();
  await expect(page.getByText("Planner sync is still reconciling background changes.")).toBeVisible();
  await expect(page.getByText("Ready for review")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check complete" })).toHaveCount(2);
  await expect(page.getByText("Morning briefing audio")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open audio" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/tool_name|resolve_planner_conflict|tb_1|briefing_job_1|unlocked|Raw|Diagnostics/i);
});

test("desktop helper handoff draft prefills the assistant composer", async ({ page }) => {
  await seedSession(page);
  await routeAssistantShell(page, threadSnapshot());
  await routeIdleAssistantStream(page);
  await page.route(`${API_BASE}/v1/assistant/handoffs/resolve?token=handoff_token_123`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        handoff: {
          source: "desktop_helper",
          artifact_id: "art 123/needs?review#v1",
          draft: "Help me process artifact art 123/needs?review#v1.",
        },
      }),
    });
  });

  await page.goto("/assistant?handoff=handoff_token_123");

  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    "Help me process artifact art 123/needs?review#v1.",
  );
  await expect(page.getByText("Desktop Helper handoff")).toBeVisible();
  const openInLibrary = page.getByRole("button", { name: "Open in Library" });
  await expect(openInLibrary).toBeVisible();
  await openInLibrary.click();
  await expect(page).toHaveURL(/\/library\/artifacts\/art%20123%2Fneeds%3Freview%23v1$/);
});

test("desktop helper handoff metadata is attached when the draft is sent", async ({ page }) => {
  await seedSession(page);
  const requests: Array<Record<string, unknown>> = [];
  await routeAssistantShell(page, threadSnapshot());
  await routeIdleAssistantStream(page);
  await page.route(`${API_BASE}/v1/assistant/handoffs/resolve?token=handoff_token_123`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        handoff: {
          source: "desktop_helper",
          artifact_id: "art_123",
          draft: "Help me process artifact art_123.",
        },
      }),
    });
  });
  await page.route(`${API_BASE}/v1/assistant/threads/thr_primary/messages`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        thread_id: "thr_primary",
        run: {
          id: "run_1",
          thread_id: "thr_primary",
          origin_message_id: "msg_user_1",
          orchestrator: "hybrid",
          status: "completed",
          summary: "ok",
          metadata: {},
          steps: [],
          current_interrupt: null,
          created_at: "2026-04-21T09:05:00.000Z",
          updated_at: "2026-04-21T09:05:01.000Z",
        },
        user_message: {
          id: "msg_user_1",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_1", text: "Help me process artifact art_123." }],
          metadata: {},
          created_at: "2026-04-21T09:05:00.000Z",
          updated_at: "2026-04-21T09:05:00.000Z",
        },
        assistant_message: {
          id: "msg_assistant_1",
          thread_id: "thr_primary",
          run_id: "run_1",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", id: "part_assistant_1", text: "Done." }],
          metadata: {},
          created_at: "2026-04-21T09:05:01.000Z",
          updated_at: "2026-04-21T09:05:01.000Z",
        },
        snapshot: threadSnapshot({
          last_message_at: "2026-04-21T09:05:01.000Z",
          last_preview_text: "Done.",
          messages: [
            {
              id: "msg_user_1",
              thread_id: "thr_primary",
              run_id: null,
              role: "user",
              status: "complete",
              parts: [{ type: "text", id: "part_user_1", text: "Help me process artifact art_123." }],
              metadata: {},
              created_at: "2026-04-21T09:05:00.000Z",
              updated_at: "2026-04-21T09:05:00.000Z",
            },
            {
              id: "msg_assistant_1",
              thread_id: "thr_primary",
              run_id: "run_1",
              role: "assistant",
              status: "complete",
              parts: [{ type: "text", id: "part_assistant_1", text: "Done." }],
              metadata: {},
              created_at: "2026-04-21T09:05:01.000Z",
              updated_at: "2026-04-21T09:05:01.000Z",
            },
          ],
          runs: [],
          interrupts: [],
          next_cursor: "2026-04-21T09:05:01.000Z",
        }),
      }),
    });
  });

  await page.goto("/assistant?handoff=handoff_token_123");
  await page.getByRole("button", { name: "Send" }).click();

  expect(requests).toHaveLength(1);
  expect(requests[0].metadata).toEqual(
    expect.objectContaining({
      handoff_token: "handoff_token_123",
    }),
  );
});

test("support surfaces dedupe repeated entities across the current thread tail", async ({ page }) => {
  await seedSession(page);
  await routeAssistantShell(
    page,
    threadSnapshot({
      messages: [
        {
          id: "msg_note_1",
          thread_id: "thr_primary",
          run_id: null,
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "card",
              id: "part_note_1",
              card: {
                kind: "knowledge_note",
                version: 1,
                title: "Meeting note",
                body: "First pass.",
                entity_ref: {
                  entity_type: "note",
                  entity_id: "note_dup_1",
                  href: "/artifacts?note=note_dup_1",
                  title: "Meeting note",
                },
                actions: [],
                metadata: {
                  note_id: "note_dup_1",
                },
              },
            },
          ],
          metadata: {},
          created_at: "2026-04-21T09:01:00.000Z",
          updated_at: "2026-04-21T09:01:00.000Z",
        },
        {
          id: "msg_note_2",
          thread_id: "thr_primary",
          run_id: null,
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "card",
              id: "part_note_2",
              card: {
                kind: "knowledge_note",
                version: 1,
                title: "Meeting note",
                body: "Updated pass.",
                entity_ref: {
                  entity_type: "note",
                  entity_id: "note_dup_1",
                  href: "/artifacts?note=note_dup_1",
                  title: "Meeting note",
                },
                actions: [],
                metadata: {
                  note_id: "note_dup_1",
                  version: 2,
                },
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
  await routeIdleAssistantStream(page);

  await page.goto("/assistant");

  await expect(page.getByText("1 knowledge item is active from this thread.")).toBeVisible();
  await expect(page.getByText("2 knowledge items are active from this thread.")).toHaveCount(0);
});

test("resolved planner activity no longer keeps the planner surface active", async ({ page }) => {
  await seedSession(page);
  await routeAssistantShell(
    page,
    threadSnapshot({
      interrupts: [
        {
          id: "interrupt_conflict_done_1",
          thread_id: "thr_primary",
          run_id: "run_conflict_done_1",
          status: "submitted",
          interrupt_type: "choice",
          tool_name: "resolve_planner_conflict",
          title: "Resolve scheduling conflict",
          body: "Choose how Starlog should resolve this overlap.",
          entity_ref: { entity_type: "planner_conflict", entity_id: "conflict_done_1", href: "/planner" },
          fields: [],
          primary_label: "Apply choice",
          secondary_label: "Open Planner",
          metadata: {},
          created_at: "2026-04-21T09:08:00.000Z",
          resolved_at: "2026-04-21T09:09:00.000Z",
          resolution: {
            id: "resolution_conflict_done_1",
            interrupt_id: "interrupt_conflict_done_1",
            action: "submit",
            values: {
              resolution: "local_wins",
            },
            metadata: {},
            created_at: "2026-04-21T09:09:00.000Z",
          },
        },
      ],
      messages: [
        {
          id: "msg_conflict_old",
          thread_id: "thr_primary",
          run_id: "run_conflict_done_1",
          role: "assistant",
          status: "requires_action",
          parts: [
            {
              type: "interrupt_request",
              id: "part_conflict_old",
              interrupt: {
                id: "interrupt_conflict_done_1",
                thread_id: "thr_primary",
                run_id: "run_conflict_done_1",
                status: "pending",
                interrupt_type: "choice",
                tool_name: "resolve_planner_conflict",
                title: "Resolve scheduling conflict",
                body: "Choose how Starlog should resolve this overlap.",
                entity_ref: { entity_type: "planner_conflict", entity_id: "conflict_done_1", href: "/planner" },
                fields: [],
                primary_label: "Apply choice",
                secondary_label: "Open Planner",
                metadata: {},
                created_at: "2026-04-21T09:08:00.000Z",
                resolved_at: null,
                resolution: {},
              },
            },
          ],
          metadata: {},
          created_at: "2026-04-21T09:08:00.000Z",
          updated_at: "2026-04-21T09:08:00.000Z",
        },
        {
          id: "msg_conflict_resolved",
          thread_id: "thr_primary",
          run_id: null,
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "ambient_update",
              id: "part_conflict_resolved",
              update: {
                id: "ambient_conflict_resolved",
                event_id: "evt_conflict_resolved",
                label: "Planner conflict resolved",
                body: "Team Sync was resolved in Planner with local wins.",
                entity_ref: {
                  entity_type: "planner_conflict",
                  entity_id: "conflict_done_1",
                  href: "/planner",
                  title: "Team Sync",
                },
                actions: [],
                metadata: {},
                created_at: "2026-04-21T09:09:00.000Z",
              },
            },
          ],
          metadata: {},
          created_at: "2026-04-21T09:09:00.000Z",
          updated_at: "2026-04-21T09:09:00.000Z",
        },
      ],
    }),
  );
  await routeIdleAssistantStream(page);

  await page.goto("/assistant");

  await expect(page.getByText("Planner conflict resolved")).toBeVisible();
  await expect(page.getByText("1 planning item is active from this thread.")).toHaveCount(0);
});

test("tool results can activate support surfaces without top-level cards", async ({ page }) => {
  await seedSession(page);
  await routeAssistantShell(
    page,
    threadSnapshot({
      messages: [
        {
          id: "msg_tool_only",
          thread_id: "thr_primary",
          run_id: "run_tool_only",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "tool_result",
              id: "part_tool_result_review",
              tool_result: {
                id: "tool_result_review",
                tool_call_id: "tool_call_review",
                status: "complete",
                output: {
                  cards_ready: 3,
                },
                card: {
                  kind: "review_queue",
                  version: 1,
                  title: "Review queue",
                  body: "Three cards are ready now.",
                  entity_ref: {
                    entity_type: "card",
                    entity_id: "card_from_tool_1",
                    href: "/review",
                    title: "Tool card",
                  },
                  actions: [],
                  metadata: {
                    due_count: 3,
                    card_id: "card_from_tool_1",
                  },
                },
                metadata: {},
              },
            },
            {
              type: "tool_result",
              id: "part_tool_result_planner",
              tool_result: {
                id: "tool_result_planner",
                tool_call_id: "tool_call_planner",
                status: "complete",
                output: {
                  briefing_id: "briefing_from_tool_1",
                },
                entity_ref: {
                  entity_type: "briefing",
                  entity_id: "briefing_from_tool_1",
                  href: "/planner?briefing=briefing_from_tool_1",
                  title: "2026-04-21",
                },
                metadata: {},
              },
            },
          ],
          metadata: {},
          created_at: "2026-04-21T09:10:00.000Z",
          updated_at: "2026-04-21T09:10:00.000Z",
        },
      ],
    }),
  );
  await routeIdleAssistantStream(page);

  await page.goto("/assistant");

  await expect(page.getByText("1 review item is active from this thread.")).toBeVisible();
  await expect(page.getByText("1 planning item is active from this thread.")).toBeVisible();
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
                entity_ref: {
                  entity_type: "card",
                  entity_id: "card_1",
                  href: "/review",
                  title: "Queue review",
                },
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
                metadata: {
                  due_count: 2,
                },
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
                entity_ref: {
                  entity_type: "note",
                  entity_id: "note_1",
                  href: "/artifacts?note=note_1",
                  title: "Follow-up note",
                },
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
                metadata: {
                  version: 3,
                  search_result: true,
                },
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

  await expect(page.getByText("2 due now")).toBeVisible();
  await expect(page.getByText("v3")).toBeVisible();
  await expect(page.getByText("Search match")).toBeVisible();
  await expect(page.getByText("1 review item is active from this thread.")).toBeVisible();
  await expect(page.getByText("1 knowledge item is active from this thread.")).toBeVisible();

  await page.getByRole("button", { name: "Ask follow-up" }).click();
  await expect(
    page.getByPlaceholder("Ask, capture, plan, review, or move something forward..."),
  ).toHaveValue("Summarize the current review queue and suggest the first card to grade.");

  await page.getByRole("link", { name: "Open Review" }).last().click();
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
                      entity_ref: {
                        entity_type: "briefing",
                        entity_id: "briefing_1",
                        href: "/planner?briefing=briefing_1",
                        title: "2026-04-21",
                      },
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
                      metadata: {
                        briefing_id: "briefing_1",
                        date: "2026-04-21",
                      },
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
  await expect(page.getByText("Thread prompt ready")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Morning briefing" })).toBeVisible();
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

test("library capture flows into the assistant triage interrupt", async ({ page }) => {
  await seedSession(page);

  let assistantStage: "empty" | "capture" = "empty";
  const artifact = {
    id: "artifact_cap_1",
    source_type: "clip_manual",
    title: "Reading capture",
    created_at: "2026-04-21T09:05:00.000Z",
  };

  await routeDynamicAssistantShell(page, () =>
    assistantStage === "capture"
      ? threadSnapshot({
          last_message_at: "2026-04-21T09:05:05.000Z",
          last_preview_text: "I saved Reading capture. One quick choice will help route it correctly.",
          interrupts: [
            {
              id: "interrupt_capture_1",
              thread_id: "thr_primary",
              run_id: "run_capture_1",
              status: "pending",
              interrupt_type: "form",
              tool_name: "triage_capture",
              title: "Triage this capture",
              body: "Tell Starlog what this capture is and what to do next.",
              entity_ref: { entity_type: "artifact", entity_id: artifact.id, href: `/artifacts?artifact=${artifact.id}` },
              fields: [],
              primary_label: "Save choice",
              secondary_label: "Not now",
              metadata: {},
              created_at: "2026-04-21T09:05:05.000Z",
              resolved_at: null,
              resolution: {},
            },
          ],
          messages: [
            {
              id: "msg_capture_1",
              thread_id: "thr_primary",
              run_id: "run_capture_1",
              role: "assistant",
              status: "requires_action",
              parts: [
                {
                  type: "text",
                  id: "part_capture_text",
                  text: "I saved Reading capture. One quick choice will help route it correctly.",
                },
                {
                  type: "interrupt_request",
                  id: "part_capture_interrupt",
                  interrupt: {
                    id: "interrupt_capture_1",
                    thread_id: "thr_primary",
                    run_id: "run_capture_1",
                    status: "pending",
                    interrupt_type: "form",
                    tool_name: "triage_capture",
                    title: "Triage this capture",
                    body: "Tell Starlog what this capture is and what to do next.",
                    entity_ref: { entity_type: "artifact", entity_id: artifact.id, href: `/artifacts?artifact=${artifact.id}` },
                    fields: [
                      {
                        id: "capture_kind",
                        kind: "select",
                        label: "Capture kind",
                        required: true,
                        options: [{ label: "Research source", value: "research_source" }],
                      },
                    ],
                    primary_label: "Save choice",
                    secondary_label: "Not now",
                    metadata: {},
                    created_at: "2026-04-21T09:05:05.000Z",
                    resolved_at: null,
                    resolution: {},
                  },
                },
              ],
              metadata: {},
              created_at: "2026-04-21T09:05:05.000Z",
              updated_at: "2026-04-21T09:05:05.000Z",
            },
          ],
        })
      : threadSnapshot(),
  );
  await routeIdleAssistantStream(page);

  await page.route(`${API_BASE}/v1/surfaces/library/summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status_buckets: [],
        source_breakdown: [],
        recent_artifacts: [],
        notes: { total: 0, recent_count: 0, latest_updated_at: null },
        suggested_actions: [],
        generated_at: "2026-04-21T09:05:00.000Z",
      }),
    });
  });
  await page.route(`${API_BASE}/v1/notes`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route(`${API_BASE}/v1/artifacts`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(assistantStage === "capture" ? [artifact] : []),
    });
  });
  await page.route(`${API_BASE}/v1/artifacts/${artifact.id}/graph`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        artifact,
        summaries: [],
        cards: [],
        tasks: [],
        notes: [],
        relations: [],
      }),
    });
  });
  await page.route(`${API_BASE}/v1/artifacts/${artifact.id}/versions`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summaries: [],
        card_sets: [],
        actions: [],
      }),
    });
  });
  await page.route(`${API_BASE}/v1/capture`, async (route) => {
    assistantStage = "capture";
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ artifact }),
    });
  });

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Starlog Library" })).toBeVisible();
  const captureStatus = await page.evaluate(async (apiBase) => {
    const response = await fetch(`${apiBase}/v1/capture`, {
      method: "POST",
      body: JSON.stringify({
        title: "Reading capture",
        content: "Remember the synthesis idea for tomorrow.",
        source_type: "clip_manual",
      }),
    });
    return response.status;
  }, API_BASE);
  expect(captureStatus).toBe(201);
  await page.reload();
  await expect(page.getByRole("link", { name: "Open Library detail for Reading capture" })).toBeVisible();

  await page.goto("/assistant");
  await expect(page.getByText("I saved Reading capture. One quick choice will help route it correctly.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Triage this capture" })).toBeVisible();
});

test("planner briefing generation feeds the morning focus interrupt", async ({ page }) => {
  await seedSession(page);

  let assistantStage: "empty" | "briefing" = "empty";
  const briefing = {
    id: "briefing_1",
    date: "2026-04-21",
    text: "Morning briefing text.",
    audio_ref: null,
  };
  const oauthStatus = {
    connected: true,
    mode: "oauth_google",
    source: "google_oauth",
    expires_at: "2026-04-22T09:00:00.000Z",
    has_refresh_token: true,
    detail: "Google calendar link active",
  };

  await routeDynamicAssistantShell(page, () =>
    assistantStage === "briefing"
      ? threadSnapshot({
          last_message_at: "2026-04-21T09:06:00.000Z",
          last_preview_text: "Here is your morning briefing. Choose one focused way to start.",
          interrupts: [
            {
              id: "interrupt_briefing_1",
              thread_id: "thr_primary",
              run_id: "run_briefing_1",
              status: "pending",
              interrupt_type: "choice",
              tool_name: "choose_morning_focus",
              title: "Start with one thing",
              body: "Choose today’s first bounded move.",
              entity_ref: { entity_type: "briefing", entity_id: briefing.id, href: `/planner?briefing=${briefing.id}` },
              fields: [],
              primary_label: "Begin",
              secondary_label: "Later",
              metadata: {},
              created_at: "2026-04-21T09:06:00.000Z",
              resolved_at: null,
              resolution: {},
            },
          ],
          messages: [
            {
              id: "msg_briefing_1",
              thread_id: "thr_primary",
              run_id: "run_briefing_1",
              role: "assistant",
              status: "requires_action",
              parts: [
                {
                  type: "text",
                  id: "part_briefing_text",
                  text: "Here is your morning briefing. Choose one focused way to start.",
                },
                {
                  type: "interrupt_request",
                  id: "part_briefing_interrupt",
                  interrupt: {
                    id: "interrupt_briefing_1",
                    thread_id: "thr_primary",
                    run_id: "run_briefing_1",
                    status: "pending",
                    interrupt_type: "choice",
                    tool_name: "choose_morning_focus",
                    title: "Start with one thing",
                    body: "Choose today’s first bounded move.",
                    entity_ref: { entity_type: "briefing", entity_id: briefing.id, href: `/planner?briefing=${briefing.id}` },
                    fields: [
                      {
                        id: "focus",
                        kind: "select",
                        label: "First move",
                        required: true,
                        options: [{ label: "30m review queue", value: "review" }],
                      },
                    ],
                    primary_label: "Begin",
                    secondary_label: "Later",
                    metadata: {},
                    created_at: "2026-04-21T09:06:00.000Z",
                    resolved_at: null,
                    resolution: {},
                  },
                },
              ],
              metadata: {},
              created_at: "2026-04-21T09:06:00.000Z",
              updated_at: "2026-04-21T09:06:00.000Z",
            },
          ],
        })
      : threadSnapshot(),
  );
  await routeIdleAssistantStream(page);

  await page.route(`${API_BASE}/v1/planning/blocks/*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`${API_BASE}/v1/calendar/events`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`${API_BASE}/v1/calendar/sync/google/oauth/status`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(oauthStatus) });
  });
  await page.route(`${API_BASE}/v1/briefings/generate`, async (route) => {
    assistantStage = "briefing";
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(briefing),
    });
  });

  await page.goto("/planner");
  await page.getByRole("button", { name: "Prepare briefing" }).click();
  await expect(page.getByText(`Prepared briefing for ${briefing.date}`)).toBeVisible();

  await page.goto("/assistant");
  await expect(page.getByText("Here is your morning briefing. Choose one focused way to start.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with one thing" })).toBeVisible();
});

test("planner sync conflicts surface a resolve-planner-conflict interrupt", async ({ page }) => {
  await seedSession(page);

  let assistantStage: "empty" | "conflict" = "empty";
  const oauthStatus = {
    connected: true,
    mode: "oauth_google",
    source: "google_oauth",
    expires_at: "2026-04-22T09:00:00.000Z",
    has_refresh_token: true,
    detail: "Google calendar link active",
  };
  const conflict = {
    id: "cnf_1",
    remote_id: "remote_evt_1",
    strategy: "prefer_local",
    detail: { title: "Team Sync" },
    resolved: false,
    resolved_at: null,
    resolution_strategy: null,
  };

  await routeDynamicAssistantShell(page, () =>
    assistantStage === "conflict"
      ? threadSnapshot({
          last_message_at: "2026-04-21T09:07:00.000Z",
          last_preview_text: "remote_evt_1 needs a quick planner decision.",
          interrupts: [
            {
              id: "interrupt_conflict_1",
              thread_id: "thr_primary",
              run_id: "run_conflict_1",
              status: "pending",
              interrupt_type: "choice",
              tool_name: "resolve_planner_conflict",
              title: "Resolve scheduling conflict",
              body: "Choose how Starlog should resolve this overlap.",
              entity_ref: { entity_type: "planner_conflict", entity_id: conflict.id, href: "/planner" },
              fields: [],
              primary_label: "Apply choice",
              secondary_label: "Open Planner",
              metadata: {},
              created_at: "2026-04-21T09:07:00.000Z",
              resolved_at: null,
              resolution: {},
            },
          ],
          messages: [
            {
              id: "msg_conflict_1",
              thread_id: "thr_primary",
              run_id: "run_conflict_1",
              role: "assistant",
              status: "requires_action",
              parts: [
                {
                  type: "text",
                  id: "part_conflict_text",
                  text: "remote_evt_1 needs a quick planner decision.",
                },
                {
                  type: "interrupt_request",
                  id: "part_conflict_interrupt",
                  interrupt: {
                    id: "interrupt_conflict_1",
                    thread_id: "thr_primary",
                    run_id: "run_conflict_1",
                    status: "pending",
                    interrupt_type: "choice",
                    tool_name: "resolve_planner_conflict",
                    title: "Resolve scheduling conflict",
                    body: "Choose how Starlog should resolve this overlap.",
                    entity_ref: { entity_type: "planner_conflict", entity_id: conflict.id, href: "/planner" },
                    fields: [
                      {
                        id: "resolution",
                        kind: "select",
                        label: "Resolution",
                        required: true,
                        options: [{ label: "Prefer local", value: "local_wins" }],
                      },
                    ],
                    primary_label: "Apply choice",
                    secondary_label: "Open Planner",
                    metadata: {},
                    created_at: "2026-04-21T09:07:00.000Z",
                    resolved_at: null,
                    resolution: {},
                  },
                },
              ],
              metadata: {},
              created_at: "2026-04-21T09:07:00.000Z",
              updated_at: "2026-04-21T09:07:00.000Z",
            },
          ],
        })
      : threadSnapshot(),
  );
  await routeIdleAssistantStream(page);

  await page.route(`${API_BASE}/v1/planning/blocks/*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`${API_BASE}/v1/calendar/events`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`${API_BASE}/v1/calendar/sync/google/oauth/status`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(oauthStatus) });
  });
  await page.route(`${API_BASE}/v1/calendar/sync/google/run`, async (route) => {
    assistantStage = "conflict";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run_id: "sync_1",
        pushed: 0,
        pulled: 1,
        conflicts: 1,
        last_synced_at: "2026-04-21T09:07:00.000Z",
      }),
    });
  });
  await page.route(`${API_BASE}/v1/calendar/sync/google/conflicts`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([conflict]),
    });
  });

  await page.goto("/planner");
  await page.getByRole("button", { name: "Run Google sync" }).click();
  await expect(page.getByText(/Latest sync sync_1: pushed 0, pulled 1, conflicts 1/)).toBeVisible();

  await page.goto("/assistant");
  await expect(page.getByText("remote_evt_1 needs a quick planner decision.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resolve scheduling conflict" })).toBeVisible();
});

test("planner conflict resolution clears the assistant interrupt and leaves a follow-up update", async ({ page }) => {
  await seedSession(page);

  const conflict = {
    id: "cnf_resolved_1",
    remote_id: "remote_evt_2",
    strategy: "prefer_local",
    detail: { title: "Team Sync" },
    resolved: false,
    resolved_at: null,
    resolution_strategy: null,
  };

  await routeAssistantShell(
    page,
    threadSnapshot({
      last_message_at: "2026-04-21T09:09:00.000Z",
      last_preview_text: "Planner conflict resolved",
      interrupts: [
        {
          id: "interrupt_conflict_resolved_1",
          thread_id: "thr_primary",
          run_id: "run_conflict_resolved_1",
          status: "submitted",
          interrupt_type: "choice",
          tool_name: "resolve_planner_conflict",
          title: "Resolve scheduling conflict",
          body: "Choose how Starlog should resolve this overlap.",
          entity_ref: { entity_type: "planner_conflict", entity_id: conflict.id, href: "/planner" },
          fields: [],
          primary_label: "Apply choice",
          secondary_label: "Open Planner",
          metadata: {},
          created_at: "2026-04-21T09:08:00.000Z",
          resolved_at: "2026-04-21T09:09:00.000Z",
          resolution: {
            id: "resolution_conflict_resolved_1",
            interrupt_id: "interrupt_conflict_resolved_1",
            action: "submit",
            values: {
              resolution: "local_wins",
              resolution_source: "planner_surface",
            },
            metadata: {},
            created_at: "2026-04-21T09:09:00.000Z",
          },
        },
      ],
      messages: [
        {
          id: "msg_conflict_resolved_1",
          thread_id: "thr_primary",
          run_id: "run_conflict_resolved_1",
          role: "assistant",
          status: "requires_action",
          parts: [
            {
              type: "text",
              id: "part_conflict_resolved_text",
              text: "remote_evt_2 needs a quick planner decision.",
            },
            {
              type: "interrupt_request",
              id: "part_conflict_resolved_interrupt",
              interrupt: {
                id: "interrupt_conflict_resolved_1",
                thread_id: "thr_primary",
                run_id: "run_conflict_resolved_1",
                status: "pending",
                interrupt_type: "choice",
                tool_name: "resolve_planner_conflict",
                title: "Resolve scheduling conflict",
                body: "Choose how Starlog should resolve this overlap.",
                entity_ref: { entity_type: "planner_conflict", entity_id: conflict.id, href: "/planner" },
                fields: [],
                primary_label: "Apply choice",
                secondary_label: "Open Planner",
                metadata: {},
                created_at: "2026-04-21T09:08:00.000Z",
                resolved_at: null,
                resolution: {},
              },
            },
          ],
          metadata: {},
          created_at: "2026-04-21T09:08:00.000Z",
          updated_at: "2026-04-21T09:08:00.000Z",
        },
        {
          id: "msg_conflict_resolved_2",
          thread_id: "thr_primary",
          run_id: null,
          role: "system",
          status: "complete",
          parts: [
            {
              type: "ambient_update",
              id: "part_conflict_resolved_ambient",
              update: {
                id: "ambient_conflict_resolved_1",
                event_id: "event_conflict_resolved_1",
                label: "Planner conflict resolved",
                body: "remote_evt_2 was resolved in Planner with local wins.",
                entity_ref: { entity_type: "planner_conflict", entity_id: conflict.id, href: "/planner" },
                actions: [],
                metadata: {},
                created_at: "2026-04-21T09:09:00.000Z",
              },
            },
          ],
          metadata: {},
          created_at: "2026-04-21T09:09:00.000Z",
          updated_at: "2026-04-21T09:09:00.000Z",
        },
      ],
    }),
  );
  await routeIdleAssistantStream(page);

  await page.goto("/assistant");
  await expect(page.getByText("Planner conflict resolved")).toBeVisible();
  await expect(page.getByText("remote_evt_2 was resolved in Planner with local wins.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply choice" })).toHaveCount(0);
});

test("assistant-ui interview review data UI submits a grade without raw protocol labels", async ({ page }) => {
  await seedSession(page);
  const submissions: Array<Record<string, unknown>> = [];
  const reviewInterrupt = {
    id: "interrupt_interview_review_1",
    thread_id: "thr_primary",
    run_id: "run_interview_review_1",
    status: "pending",
    interrupt_type: "choice",
    tool_name: "grade_review_recall",
    renderer_key: "interview.review_grade",
    renderer_version: 1,
    placement: "sidecar",
    structured_content: {
      card_id: "card_interview_1",
      prompt: "How would you explain the event loop to a product engineer?",
      answer: "It coordinates queued work and callbacks without blocking the main thread.",
      recommendation_reason: "Recent misses on async JavaScript make a short recall grade the highest-value next step.",
    },
    ui_meta: { tone: "review" },
    title: "Grade interview recall",
    body: "Pick the grade that matches your recall.",
    entity_ref: { entity_type: "card", entity_id: "card_interview_1", href: "/review?card=card_interview_1", title: "Event loop card" },
    fields: [
      {
        id: "rating",
        kind: "select",
        label: "Recall quality",
        required: true,
        options: [
          { label: "Again", value: "1" },
          { label: "Hard", value: "3" },
          { label: "Good", value: "4" },
          { label: "Easy", value: "5" },
        ],
      },
    ],
    primary_label: "Save grade",
    secondary_label: "Keep in Review",
    consequence_preview: "Updates the next review interval.",
    recommended_defaults: { rating: "3" },
    metadata: {},
    created_at: "2026-04-21T09:12:00.000Z",
    resolved_at: null,
    resolution: null,
  };

  await routeDynamicAssistantShell(page, () =>
    threadSnapshot({
      last_message_at: "2026-04-21T09:12:00.000Z",
      last_preview_text: "Grade this interview recall.",
      interrupts: [reviewInterrupt],
      messages: [
        {
          id: "msg_interview_review_1",
          thread_id: "thr_primary",
          run_id: "run_interview_review_1",
          role: "assistant",
          status: "requires_action",
          parts: [
            {
              type: "text",
              id: "part_interview_review_text",
              text: "Grade this interview recall so I can schedule the next pass.",
            },
            {
              type: "interrupt_request",
              id: "part_interview_review_interrupt",
              interrupt: reviewInterrupt,
            },
          ],
          metadata: {},
          created_at: "2026-04-21T09:12:00.000Z",
          updated_at: "2026-04-21T09:12:00.000Z",
        },
      ],
    }),
  );
  await routeIdleAssistantStream(page);
  await page.route(`${API_BASE}/v1/assistant/interrupts/interrupt_interview_review_1/submit`, async (route) => {
    submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        threadSnapshot({
          messages: [
            {
              id: "msg_interview_done",
              thread_id: "thr_primary",
              run_id: null,
              role: "assistant",
              status: "complete",
              parts: [{ type: "text", id: "part_interview_done", text: "Saved the interview review grade." }],
              metadata: {},
              created_at: "2026-04-21T09:13:00.000Z",
              updated_at: "2026-04-21T09:13:00.000Z",
            },
          ],
          interrupts: [],
          next_cursor: "2026-04-21T09:13:00.000Z",
        }),
      ),
    });
  });

  await page.goto("/assistant");

  await expect(page.getByText("Grade this interview recall so I can schedule the next pass.")).toBeVisible();
  await expect(page.getByTestId("assistant-ui-review-grade")).toHaveAttribute("data-dynamic-ui-renderer", "interview.review_grade");
  await expect(page.getByText("Interview review")).toBeVisible();
  await expect(page.getByText("How would you explain the event loop to a product engineer?")).toBeVisible();
  await expect(page.getByText("Recent misses on async JavaScript make a short recall grade the highest-value next step.")).toBeVisible();
  await page.getByRole("radio", { name: "Good" }).click();
  await page.getByRole("button", { name: "Save grade" }).click();

  expect(submissions).toHaveLength(1);
  expect(submissions[0].values).toEqual(expect.objectContaining({ rating: "4" }));
  await expect(page.getByText("Saved the interview review grade.")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/grade_review_recall|renderer_key|structured_content|tool_name|card_interview_1|Raw|Diagnostic/i);
});

test("assistant-ui interview dynamic UI adapters hide raw renderer keys", async ({ page }) => {
  await seedSession(page);
  await routeAssistantShell(
    page,
    threadSnapshot({
      last_message_at: "2026-04-21T09:14:00.000Z",
      last_preview_text: "Interview learning updates are ready.",
      messages: [
        {
          id: "msg_interview_dynamic_ui_1",
          thread_id: "thr_primary",
          run_id: "run_interview_dynamic_ui_1",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "tool_result",
              id: "part_topic_unlock_result",
              tool_result: {
                id: "tool_result_topic_unlock",
                tool_call_id: "tool_topic_unlock",
                status: "complete",
                renderer_key: "interview.topic_unlock",
                renderer_version: 1,
                placement: "thread",
                structured_content: {
                  topic_id: "topic-dp",
                  topic_title: "Dynamic programming patterns",
                  unlock_reason: "You cleared the prerequisite recursion cards.",
                },
                ui_meta: { tone: "study" },
                output: {
                  topic_id: "topic-dp",
                  topic_title: "Dynamic programming patterns",
                  unlock_reason: "You cleared the prerequisite recursion cards.",
                },
                entity_ref: {
                  entity_type: "study_topic",
                  entity_id: "topic-dp",
                  href: "/review?topic=topic-dp",
                  title: "Dynamic programming patterns",
                },
                metadata: {},
              },
            },
            {
              type: "card",
              id: "part_question_request_card",
              card: {
                kind: "learning_drill",
                version: 1,
                renderer_key: "interview.question_request",
                renderer_version: 1,
                placement: "thread",
                title: "Generate an interview prompt",
                body: "Prepare one application question for the unlocked topic.",
                structured_content: {
                  topic_id: "topic-dp",
                  topic_title: "Dynamic programming patterns",
                  question_type: "application",
                  prompt: "Ask me to derive a state transition for a bounded DP problem.",
                },
                ui_meta: { density: "compact" },
                entity_ref: {
                  entity_type: "study_topic",
                  entity_id: "topic-dp",
                  href: "/review?topic=topic-dp",
                  title: "Dynamic programming patterns",
                },
                actions: [],
                metadata: {},
              },
            },
            {
              type: "card",
              id: "part_recommendation_reason_card",
              card: {
                kind: "learning_drill",
                version: 1,
                renderer_key: "interview.recommendation_reason",
                renderer_version: 1,
                placement: "thread",
                title: "Application quiz ready",
                body: "Reason: You just unlocked this topic and one application card is due now.",
                structured_content: {
                  reason: "You just unlocked this topic and one application card is due now.",
                  evidence: ["Unlocked topic: Dynamic programming patterns", "Due application cards: 1"],
                  confidence: 0.92,
                },
                ui_meta: { tone: "study" },
                entity_ref: {
                  entity_type: "study_topic",
                  entity_id: "topic-dp",
                  href: "/review?topic=topic-dp",
                  title: "Dynamic programming patterns",
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
                metadata: {},
              },
            },
          ],
          metadata: {},
          created_at: "2026-04-21T09:14:00.000Z",
          updated_at: "2026-04-21T09:14:00.000Z",
        },
      ],
    }),
  );
  await routeIdleAssistantStream(page);

  await page.goto("/assistant");

  await expect(page.getByTestId("assistant-ui-topic-unlock")).toHaveAttribute("data-dynamic-ui-renderer", "interview.topic_unlock");
  await expect(page.getByTestId("assistant-ui-topic-unlock")).toContainText("Dynamic programming patterns");
  await expect(page.getByText("You cleared the prerequisite recursion cards.")).toBeVisible();
  await expect(page.getByTestId("assistant-ui-question-request")).toHaveAttribute(
    "data-dynamic-ui-renderer",
    "interview.question_request",
  );
  await expect(page.getByText("Ask me to derive a state transition for a bounded DP problem.")).toBeVisible();
  await expect(page.getByTestId("assistant-ui-recommendation-reason")).toHaveAttribute(
    "data-dynamic-ui-renderer",
    "interview.recommendation_reason",
  );
  await expect(page.getByText("Due application cards: 1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Review" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(
    /interview\.topic_unlock|interview\.question_request|interview\.recommendation_reason|renderer_key|structured_content|tool_result|Raw|Diagnostic/i,
  );
});
