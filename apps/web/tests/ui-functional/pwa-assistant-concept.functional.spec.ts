import { expect, test } from "@playwright/test";

import {
  API_BASE,
  assistantThreadSnapshot,
  morningFocusInterrupt,
  routeAssistantThread,
  seedAssistantSession,
} from "./assistant-concept-fixtures";

test("PWA assistant renders and submits a schema-driven dynamic panel", async ({ page }) => {
  await seedAssistantSession(page);

  const pendingInterrupt = morningFocusInterrupt();
  const submittedInterrupt = morningFocusInterrupt("submitted");
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-04-27T09:04:00.000Z",
    last_preview_text: "Here is what makes the most sense this morning.",
    interrupts: [pendingInterrupt],
    messages: [
      {
        id: "msg_user_focus",
        thread_id: "thr_primary",
        run_id: null,
        role: "user",
        status: "complete",
        parts: [{ type: "text", id: "part_user_focus", text: "What should I focus on this morning?" }],
        metadata: {},
        created_at: "2026-04-27T09:02:00.000Z",
        updated_at: "2026-04-27T09:02:00.000Z",
      },
      {
        id: "msg_assistant_focus",
        thread_id: "thr_primary",
        run_id: "run_morning_focus",
        role: "assistant",
        status: "requires_action",
        parts: [
          {
            type: "text",
            id: "part_focus_text",
            text:
              "Here is what makes the most sense this morning: use the 90 minute deep work window to move onboarding flow polish forward.",
          },
          {
            type: "interrupt_request",
            id: "part_focus_interrupt",
            interrupt: pendingInterrupt,
          },
          {
            type: "ambient_update",
            id: "part_focus_ambient",
            update: {
              id: "ambient_focus_window",
              event_id: "evt_focus_window",
              label: "Planner found a 90m focus window",
              body: "9:30-11:00 AM is currently open.",
              entity_ref: { entity_type: "time_block", entity_id: "block_morning", href: "/planner" },
              actions: [],
              metadata: { visibility: "current" },
              created_at: "2026-04-27T09:04:00.000Z",
            },
          },
        ],
        metadata: {},
        created_at: "2026-04-27T09:04:00.000Z",
        updated_at: "2026-04-27T09:04:00.000Z",
      },
    ],
  });
  const submissions: Array<Record<string, unknown>> = [];

  await routeAssistantThread(page, () => snapshot);
  await page.route(`${API_BASE}/v1/assistant/interrupts/interrupt_morning_focus/submit`, async (route) => {
    submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    snapshot = assistantThreadSnapshot({
      ...snapshot,
      updated_at: "2026-04-27T09:06:00.000Z",
      interrupts: [submittedInterrupt],
      messages: [
        ...((snapshot.messages as Array<Record<string, unknown>>) || []).slice(0, 1),
        {
          ...((snapshot.messages as Array<Record<string, unknown>>) || [])[1],
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_focus_text",
              text:
                "Here is what makes the most sense this morning: use the 90 minute deep work window to move onboarding flow polish forward.",
            },
            {
              type: "interrupt_request",
              id: "part_focus_interrupt",
              interrupt: submittedInterrupt,
            },
          ],
        },
      ],
      next_cursor: "2026-04-27T09:06:00.000Z",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Choose morning focus" })).toBeVisible();
  await expect(page.getByText("What should I focus on this morning?")).toBeVisible();
  await expect(page.getByText("Here is what makes the most sense this morning")).toBeVisible();
  await expect(page.getByText("Planner found a 90m focus window")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose morning focus" })).toBeVisible();
  await expect(page.getByText("Focus mode")).toBeVisible();
  await expect(page.locator("select").filter({ hasText: "Move project forward" })).toHaveValue("move_project_forward");
  await expect(page.getByLabel("Protect this focus block")).toBeChecked();
  await expect(page.getByText("Planner can reserve 9:30-11:00 AM for focus.")).toBeVisible();

  await page.getByRole("button", { name: "Confirm focus" }).click();

  expect(submissions).toHaveLength(1);
  expect(submissions[0].values).toEqual(
    expect.objectContaining({
      focus_mode: "move_project_forward",
      protect_block: true,
      client_timezone: expect.any(String),
    }),
  );
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm focus" })).toHaveCount(0);
});
