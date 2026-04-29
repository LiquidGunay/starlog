import { expect, test } from "@playwright/test";

import {
  API_BASE,
  assistantThreadActivitySnapshot,
  assistantThreadSnapshot,
  morningFocusInterrupt,
  plannerConflictInterrupt,
  routeAssistantThread,
  seedAssistantSession,
} from "./assistant-concept-fixtures";

test("mobile viewport assistant keeps one inline schedule-conflict decision and planner escape", async ({ page }) => {
  await seedAssistantSession(page);

  const olderSubmittedInterrupt = morningFocusInterrupt("submitted");
  const pendingInterrupt = plannerConflictInterrupt();
  const submittedInterrupt = plannerConflictInterrupt("submitted");
  const dismissedInterrupt = {
    ...pendingInterrupt,
    status: "dismissed",
    resolved_at: "2026-04-27T09:23:00.000Z",
    resolution: null,
  };
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-04-27T09:20:00.000Z",
    last_preview_text: "Here are your best options to resolve this cleanly.",
    interrupts: [olderSubmittedInterrupt, pendingInterrupt],
    messages: [
      {
        id: "msg_old_focus",
        thread_id: "thr_primary",
        run_id: "run_morning_focus",
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "interrupt_request",
            id: "part_old_focus_interrupt",
            interrupt: olderSubmittedInterrupt,
          },
        ],
        metadata: {},
        created_at: "2026-04-27T09:10:00.000Z",
        updated_at: "2026-04-27T09:10:00.000Z",
      },
      {
        id: "msg_conflict_ambient",
        thread_id: "thr_primary",
        run_id: null,
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "ambient_update",
            id: "part_conflict_ambient",
            update: {
              id: "ambient_conflict",
              event_id: "evt_conflict",
              label: "Planner flagged a 30m overlap.",
              body: "Deep Work overlaps with Team Sync.",
              entity_ref: { entity_type: "planner_conflict", entity_id: "conflict_team_sync", href: "/planner" },
              actions: [],
              metadata: { visibility: "current" },
              created_at: "2026-04-27T09:18:00.000Z",
            },
          },
        ],
        metadata: {},
        created_at: "2026-04-27T09:18:00.000Z",
        updated_at: "2026-04-27T09:18:00.000Z",
      },
      {
        id: "msg_user_conflict",
        thread_id: "thr_primary",
        run_id: null,
        role: "user",
        status: "complete",
        parts: [
          {
            type: "text",
            id: "part_user_conflict",
            text: "My product review overlaps with deep work. What should I do?",
          },
        ],
        metadata: {},
        created_at: "2026-04-27T09:19:00.000Z",
        updated_at: "2026-04-27T09:19:00.000Z",
      },
      {
        id: "msg_assistant_conflict",
        thread_id: "thr_primary",
        run_id: "run_planner_conflict",
        role: "assistant",
        status: "requires_action",
        parts: [
          {
            type: "text",
            id: "part_conflict_text",
            text:
              "Here are your best options to resolve this cleanly.\n\nProtect the deep work if it is your highest-leverage block.\nMove the review if there is a safe later slot.\nI can resolve this in one step.",
          },
          {
            type: "interrupt_request",
            id: "part_conflict_interrupt",
            interrupt: pendingInterrupt,
          },
        ],
        metadata: {},
        created_at: "2026-04-27T09:20:00.000Z",
        updated_at: "2026-04-27T09:20:00.000Z",
      },
    ],
  });
  const submissions: Array<Record<string, unknown>> = [];
  const dismissals: string[] = [];

  await routeAssistantThread(page, () => snapshot);
  await page.route(`${API_BASE}/v1/assistant/interrupts/interrupt_planner_conflict/submit`, async (route) => {
    submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    snapshot = assistantThreadSnapshot({
      ...snapshot,
      updated_at: "2026-04-27T09:22:00.000Z",
      interrupts: [olderSubmittedInterrupt, submittedInterrupt],
      messages: [
        ...((snapshot.messages as Array<Record<string, unknown>>) || []).slice(0, 3),
        {
          ...((snapshot.messages as Array<Record<string, unknown>>) || [])[3],
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_conflict_text",
              text:
                "Here are your best options to resolve this cleanly. Protect the longer focus block and move it to a safe later slot.",
            },
            {
              type: "interrupt_request",
              id: "part_conflict_interrupt",
              interrupt: submittedInterrupt,
            },
          ],
        },
        {
          id: "msg_assistant_conflict_followup",
          thread_id: "thr_primary",
          run_id: "run_planner_conflict",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_conflict_followup",
              text: "If you want, I can also repair the rest of the afternoon.",
            },
          ],
          metadata: {},
          created_at: "2026-04-27T09:22:30.000Z",
          updated_at: "2026-04-27T09:22:30.000Z",
        },
      ],
      next_cursor: "2026-04-27T09:22:00.000Z",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });
  await page.route(`${API_BASE}/v1/assistant/interrupts/interrupt_planner_conflict/dismiss`, async (route) => {
    dismissals.push("interrupt_planner_conflict");
    snapshot = assistantThreadSnapshot({
      ...snapshot,
      updated_at: "2026-04-27T09:23:00.000Z",
      interrupts: [olderSubmittedInterrupt, dismissedInterrupt],
      messages: [
        ...((snapshot.messages as Array<Record<string, unknown>>) || []).slice(0, 3),
        {
          ...((snapshot.messages as Array<Record<string, unknown>>) || [])[3],
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_conflict_text",
              text:
                "Here are your best options to resolve this cleanly. Protect the longer focus block and move it to a safe later slot.",
            },
            {
              type: "interrupt_request",
              id: "part_conflict_interrupt",
              interrupt: dismissedInterrupt,
            },
          ],
        },
      ],
      next_cursor: "2026-04-27T09:23:00.000Z",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  const viewport = page.viewportSize();
  expect(viewport?.width).toBeLessThanOrEqual(430);
  await expect(page.getByText("Planner flagged a 30m overlap.")).toBeVisible();
  await expect(page.getByText("My product review overlaps with deep work. What should I do?")).toBeVisible();
  await expect(page.getByTestId("dynamic-panel-renderer").getByText("Planner conflict", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("dynamic-panel-renderer")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Resolve schedule conflict" })).toBeVisible();
  await expect(page.getByText("Here are your best options to resolve this cleanly.")).toBeVisible();
  const conflictPanel = page.getByTestId("dynamic-panel-renderer");
  await expect(conflictPanel.getByText("Deep work block")).toBeVisible();
  await expect(conflictPanel.getByText("9:30 AM - 11:00 AM")).toBeVisible();
  await expect(conflictPanel.getByText("Conflict", { exact: true })).toBeVisible();
  await expect(conflictPanel.getByText("9:45 - 10:15 AM").first()).toBeVisible();
  await expect(conflictPanel.getByText("Team sync")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Move deep work" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Shorten block" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Keep both" })).toBeVisible();
  await expect(page.getByText("Moves deep work to 2:15 - 3:45 PM and preserves 90m focus.")).toBeVisible();

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.locator("main")).not.toContainText(/Diagnostics|protocol|runtime|tool_call|tool_result/i);

  await page.getByRole("link", { name: "Open planner" }).click();
  expect(submissions).toHaveLength(0);
  expect(dismissals).toEqual([]);
  await expect(page.getByText("Starlog Planner")).toBeVisible();
  await page.goto("/assistant", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dynamic-panel-renderer").getByText("Planner conflict", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Apply choice" }).click();

  expect(submissions).toHaveLength(1);
  expect(submissions[0].values).toEqual(
    expect.objectContaining({
      resolution: "move_deep_work",
      client_timezone: expect.any(String),
    }),
  );
  await expect(page.getByRole("button", { name: "Apply choice" })).toHaveCount(0);
  await expect(page.getByText("move deep work")).toBeVisible();
  await expect(page.getByText("If you want, I can also repair the rest of the afternoon.")).toBeVisible();

  snapshot = assistantThreadSnapshot({
    ...(snapshot as Record<string, unknown>),
    updated_at: "2026-04-27T09:24:00.000Z",
    interrupts: [olderSubmittedInterrupt, pendingInterrupt],
    messages: [
      ...((snapshot.messages as Array<Record<string, unknown>>) || []).slice(0, 3),
      {
        ...((snapshot.messages as Array<Record<string, unknown>>) || [])[3],
        status: "requires_action",
        parts: [
          {
            type: "text",
            id: "part_conflict_text",
            text:
              "Here are your best options to resolve this cleanly.\n\nProtect the deep work if it is your highest-leverage block.\nMove the review if there is a safe later slot.\nI can resolve this in one step.",
          },
          {
            type: "interrupt_request",
            id: "part_conflict_interrupt",
            interrupt: pendingInterrupt,
          },
        ],
      },
    ],
    next_cursor: "2026-04-27T09:24:00.000Z",
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dynamic-panel-renderer").getByText("Planner conflict", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/ui-functional/mobile-assistant-concept-thread-panel.png", fullPage: true });
});

test("mobile viewport assistant keeps tool activity compact and readable", async ({ page }) => {
  await seedAssistantSession(page);

  await routeAssistantThread(page, () => assistantThreadActivitySnapshot());

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  const viewport = page.viewportSize();
  expect(viewport?.width).toBeLessThanOrEqual(430);
  const activity = page.getByLabel("Assistant activity");
  await expect(activity).toBeVisible();
  const activitySummary = activity.locator("summary");
  await expect(activitySummary.getByText("What I checked").first()).toBeVisible();
  await expect(activitySummary.getByText("Checked Planner").first()).toBeVisible();
  await expect(activitySummary.getByText("Checked Review").first()).toBeVisible();
  await expect(activitySummary.getByText("Created task").first()).toBeVisible();
  await expect(activity.getByText("tool_call")).toHaveCount(0);
  await expect(activity.getByText("tool_result")).toHaveCount(0);
  await expect(activity.getByText("domain tool").first()).toBeHidden();
  await expect(page.getByRole("heading", { name: "Launch polish next task" })).toBeVisible();

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);

  await page.screenshot({ path: "artifacts/ui-functional/mobile-assistant-tool-activity-strip.png", fullPage: true });
});
