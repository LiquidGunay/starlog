import { expect, test } from "@playwright/test";

import {
  API_BASE,
  assistantTodaySummary,
  assistantThreadSnapshot,
  morningFocusInterrupt,
  routeAssistantToday,
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
  await routeAssistantToday(page, () => assistantTodaySummary({ open_interrupt_count: 1 }));
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
  await expect(page.getByRole("radio", { name: /Move project forward/ })).toBeChecked();
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

test("PWA assistant empty state renders the Today cockpit recommendation from enriched summary", async ({ page }) => {
  await seedAssistantSession(page);

  await routeAssistantThread(page, () => assistantThreadSnapshot());
  await routeAssistantToday(page, () =>
    assistantTodaySummary({
      active_run_count: 1,
      open_interrupt_count: 2,
      recent_surface_event_count: 3,
      open_loops: [
        { key: "open_tasks", label: "Open tasks", count: 5, href: "/planner" },
        { key: "overdue_tasks", label: "Overdue tasks", count: 1, href: "/planner" },
        { key: "due_reviews", label: "Reviews due", count: 4, href: "/review" },
        { key: "unprocessed_library", label: "Library inbox", count: 2, href: "/library" },
        { key: "open_commitments", label: "Open commitments", count: 1, href: "/planner" },
      ],
      recommended_next_move: {
        key: "finish_onboarding",
        title: "Finish onboarding flow polish",
        body: "A 90 minute focus block can move launch polish forward.",
        surface: "planner",
        href: null,
        action_label: "Start focus",
        prompt: "Start a 90 minute focus block for onboarding flow polish.",
        priority: 95,
        urgency: "high",
      },
      reason_stack: [
        "5 open tasks include launch polish",
        "4 reviews are due after the focus block",
        "2 Library inbox items can wait",
      ],
      at_a_glance: [
        { key: "planner", label: "Planner", count: 5, href: "/planner" },
        { key: "library", label: "Library inbox", count: 2, href: "/library" },
        { key: "review", label: "Review due", count: 4, href: "/review" },
        { key: "commitments", label: "Open commitments", count: 1, href: "/planner" },
      ],
      quick_actions: [
        {
          key: "adjust_plan",
          title: "Adjust plan",
          surface: "planner",
          href: "/planner",
          action_label: "Adjust plan",
          prompt: "Adjust today around onboarding flow polish.",
          enabled: true,
          count: 5,
          reason: null,
          priority: 10,
        },
        {
          key: "open_review",
          title: "Open Review",
          surface: "review",
          href: "/review",
          action_label: "Open Review",
          prompt: null,
          enabled: true,
          count: 4,
          reason: null,
          priority: 20,
        },
        {
          key: "process_inbox",
          title: "Process inbox",
          surface: "library",
          href: "/library",
          action_label: "Process inbox",
          prompt: "Process my latest Library captures and route anything actionable.",
          enabled: true,
          count: 2,
          reason: null,
          priority: 30,
        },
      ],
    }),
  );

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Recommended next move" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish onboarding flow polish" })).toBeVisible();
  await expect(page.getByLabel("Why this recommendation").getByText("5 open tasks include launch polish")).toBeVisible();
  await expect(page.getByLabel("Why this recommendation").getByText("4 reviews are due after the focus block")).toBeVisible();
  await expect(page.getByLabel("At a glance").getByText("Planner")).toBeVisible();
  await expect(page.getByLabel("At a glance").getByText("5", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Secondary options").getByRole("link", { name: "Adjust plan" })).toHaveAttribute("href", "/planner");
  const todayRail = page.locator("aside article", { hasText: "Today" }).first();
  await expect(todayRail.getByRole("heading", { name: "Now" })).toBeVisible();
  await expect(todayRail.getByText("Finish onboarding flow polish")).toBeVisible();
  await expect(todayRail).not.toContainText(/Online|Offline|Assistant is|Connecting|Reconnecting|Synced|Sign in needed/);

  await page.getByRole("button", { name: "Start focus" }).click();
  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    "Start a 90 minute focus block for onboarding flow polish.",
  );
  await expect(page.getByLabel("Quick actions").getByRole("link", { name: "Open Review" })).toHaveAttribute("href", "/review");
});

test("PWA assistant Today cockpit falls back to count-derived recommendation without enriched fields", async ({ page }) => {
  await seedAssistantSession(page);

  await routeAssistantThread(page, () => assistantThreadSnapshot());
  await routeAssistantToday(page, () =>
    assistantTodaySummary({
      open_interrupt_count: 0,
      recommended_next_move: null,
      reason_stack: undefined,
      at_a_glance: undefined,
      quick_actions: undefined,
      open_loops: [
        { key: "open_tasks", label: "Open tasks", count: 6, href: "/planner" },
        { key: "overdue_tasks", label: "Overdue tasks", count: 2, href: "/planner" },
        { key: "due_reviews", label: "Reviews due", count: 3, href: "/review" },
        { key: "unprocessed_library", label: "Library inbox", count: 1, href: "/library" },
      ],
    }),
  );

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Triage overdue tasks" })).toBeVisible();
  await expect(page.getByLabel("Why this recommendation").getByText("2 tasks overdue")).toBeVisible();
  await expect(page.getByLabel("Why this recommendation").getByText("6 open tasks total")).toBeVisible();
  await expect(page.getByLabel("At a glance").getByText("Overdue tasks")).toBeVisible();

  await page.getByRole("button", { name: "Plan recovery" }).click();
  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    "Triage my overdue tasks and propose the next bounded move.",
  );
});
