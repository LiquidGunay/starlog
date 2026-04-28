import { expect, test } from "@playwright/test";

import {
  API_BASE,
  assistantTodaySummary,
  assistantThreadActivitySnapshot,
  assistantThreadSnapshot,
  assistantWeeklySummary,
  morningFocusInterrupt,
  routeAssistantToday,
  routeAssistantThread,
  routeAssistantWeekly,
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
  await expect(page.locator("main")).not.toContainText(/protocol|runtime|tool_call|tool_result|Diagnostics/i);
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
  await page.screenshot({ path: "artifacts/ui-functional/pwa-assistant-concept-thread-panel.png", fullPage: true });
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

  await expect(page.getByRole("region", { name: "Recommended next move" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Recommended next move" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish onboarding flow polish" })).toBeVisible();
  await expect(page.getByLabel("Why this recommendation").getByText("5 open tasks include launch polish")).toBeVisible();
  await expect(page.getByLabel("Why this recommendation").getByText("4 reviews are due after the focus block")).toBeVisible();
  await expect(page.getByLabel("At a glance").getByText("Planner")).toBeVisible();
  await expect(page.getByLabel("At a glance").getByText("5", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Secondary options").getByRole("link", { name: "Adjust plan" })).toHaveAttribute("href", "/planner");
  const todayRail = page.locator("aside article", { hasText: "Now" }).first();
  await expect(todayRail.getByRole("heading", { name: "Now" })).toBeVisible();
  await expect(todayRail.getByText("Finish onboarding flow polish")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/Online|Offline|Assistant is|Connecting|Reconnecting|Sign in needed|Diagnostics|protocol|runtime/i);

  await page.getByRole("button", { name: "Start focus" }).click();
  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    "Start a 90 minute focus block for onboarding flow polish.",
  );
  await expect(page.getByLabel("Quick actions").getByRole("link", { name: "Open Review" })).toHaveAttribute("href", "/review");
  await page.screenshot({ path: "artifacts/ui-functional/pwa-assistant-concept-cockpit.png", fullPage: true });
});

test("PWA assistant Today cockpit renders compact strategic context actions", async ({ page }) => {
  await seedAssistantSession(page);

  await routeAssistantThread(page, () => assistantThreadSnapshot());
  await routeAssistantToday(page, () =>
    assistantTodaySummary({
      open_loops: [
        { key: "open_tasks", label: "Open tasks", count: 1, href: "/planner" },
        { key: "overdue_tasks", label: "Overdue tasks", count: 0, href: "/planner" },
        { key: "due_reviews", label: "Reviews due", count: 0, href: "/review" },
        { key: "unprocessed_library", label: "Library inbox", count: 0, href: "/library" },
        { key: "open_commitments", label: "Open commitments", count: 1, href: "/planner" },
      ],
      recommended_next_move: {
        key: "define_project_next_action",
        title: "Define next project action",
        body: "1 active project missing a next action.",
        surface: "planner",
        href: "/planner",
        action_label: "Open planner",
        prompt: "Help me define next actions for active projects.",
        priority: 85,
        urgency: "medium",
      },
      reason_stack: ["1 active project missing a next action", "1 commitment open", "1 task open"],
      strategic_context: {
        active_goal_count: 2,
        active_project_count: 2,
        open_commitment_count: 1,
        overdue_commitment_count: 0,
        project_missing_next_action_count: 1,
        attention_count: 3,
        active_goals: [
          {
            id: "goal_launch",
            title: "Ship a calm Android preview",
            horizon: "quarter",
            review_cadence: "weekly",
            updated_at: "2026-04-27T09:00:00.000Z",
            last_reviewed_at: null,
          },
          {
            id: "goal_ignored",
            title: "Second active goal should stay hidden",
            horizon: "month",
            review_cadence: "weekly",
            updated_at: "2026-04-27T09:00:00.000Z",
            last_reviewed_at: null,
          },
        ],
        active_projects: [
          {
            id: "project_android_release",
            goal_id: "goal_launch",
            title: "Android release prep",
            next_action_id: null,
            updated_at: "2026-04-27T09:00:00.000Z",
            last_reviewed_at: null,
          },
          {
            id: "project_ignored",
            goal_id: "goal_launch",
            title: "Second active project should stay hidden",
            next_action_id: "task_existing_next_action",
            updated_at: "2026-04-27T09:00:00.000Z",
            last_reviewed_at: null,
          },
        ],
        open_commitments: [
          {
            id: "commitment_feedback",
            source_type: "assistant",
            source_id: null,
            title: "Send preview feedback bundle",
            promised_to: "tester group",
            due_at: null,
            updated_at: "2026-04-27T09:00:00.000Z",
          },
        ],
        attention_items: [
          {
            key: "project_missing_next_action:project_android_release",
            kind: "project_missing_next_action",
            title: "Android release prep",
            body: "Active project has no next action.",
            entity_type: "project",
            entity_id: "project_android_release",
            surface: "planner",
            href: "/planner",
            priority: 85,
            due_at: null,
          },
          {
            key: "goal_review_due:goal_launch",
            kind: "goal_review_due",
            title: "Ship a calm Android preview",
            body: "Active goal has not been reviewed within its weekly cadence.",
            entity_type: "goal",
            entity_id: "goal_launch",
            surface: "planner",
            href: "/planner",
            priority: 50,
            due_at: null,
          },
          {
            key: "project_stale:project_ignored",
            kind: "project_stale",
            title: "Third attention item should stay hidden",
            body: "Active project has not been reviewed in 14 days.",
            entity_type: "project",
            entity_id: "project_ignored",
            surface: "planner",
            href: "/planner",
            priority: 55,
            due_at: null,
          },
        ],
      },
    }),
  );

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Define next project action" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open planner" })).toHaveAttribute("href", "/planner");

  const strategicContext = page.getByLabel("Strategic context");
  const goalRow = strategicContext.locator("article").filter({ hasText: /^Goal/ });
  const projectRow = strategicContext.locator("article").filter({ hasText: /^Project/ });
  const commitmentRow = strategicContext.locator("article").filter({ hasText: /^Commitment/ });
  await expect(goalRow.getByText("Ship a calm Android preview")).toBeVisible();
  await expect(projectRow.getByText("Android release prep", { exact: true })).toBeVisible();
  await expect(commitmentRow.getByText("Send preview feedback bundle")).toBeVisible();
  await expect(projectRow.getByText("No next action yet.")).toBeVisible();
  await expect(strategicContext.getByText("Active project has no next action.")).toBeVisible();
  await expect(strategicContext.getByText("Active goal has not been reviewed within its weekly cadence.")).toBeVisible();
  await expect(strategicContext).not.toContainText("Second active goal should stay hidden");
  await expect(strategicContext).not.toContainText("Second active project should stay hidden");
  await expect(strategicContext).not.toContainText("Third attention item should stay hidden");
  await expect(strategicContext.getByRole("link", { name: "Open" }).first()).toHaveAttribute("href", "/planner");

  await projectRow.getByRole("button", { name: "Discuss" }).click();
  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    'Help me choose the next action for "Android release prep".',
  );
  await page.screenshot({ path: "artifacts/ui-functional/pwa-assistant-strategic-context.png", fullPage: true });
});

test("PWA assistant empty cockpit renders weekly systems review with real actions", async ({ page }) => {
  await seedAssistantSession(page);

  const weeklyRequests: string[] = [];
  await routeAssistantThread(page, () => assistantThreadSnapshot());
  await routeAssistantToday(page, () =>
    assistantTodaySummary({
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
      reason_stack: ["5 open tasks include launch polish"],
    }),
  );
  await page.route(`${API_BASE}/v1/surfaces/assistant/weekly*`, async (route) => {
    weeklyRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(assistantWeeklySummary()),
    });
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Finish onboarding flow polish" })).toBeVisible();
  const weeklyReview = page.getByLabel("Weekly systems review");
  await expect(weeklyReview).toBeVisible();
  await expect(weeklyReview.getByText("3 tasks completed")).toBeVisible();
  await expect(weeklyReview.getByText("4 review sessions")).toBeVisible();
  await expect(weeklyReview.getByText("12 review items")).toBeVisible();
  await expect(weeklyReview.getByText("2 overdue tasks")).toBeVisible();
  await expect(weeklyReview.getByText("1 overdue commitment")).toBeVisible();
  await expect(weeklyReview.getByText("1 unprocessed capture")).toBeVisible();
  await expect(weeklyReview.getByRole("button", { name: "Rebalance the week" })).toBeVisible();
  await expect(weeklyReview.getByRole("link", { name: "Open Review" })).toHaveAttribute("href", "/review");
  await expect(weeklyReview.getByText("Calendar sync pending")).toBeVisible();
  await expect(weeklyReview.getByText("Waiting for calendar sync.")).toBeVisible();
  await expect(weeklyReview.getByRole("button", { name: "Calendar sync pending" })).toHaveCount(0);
  await expect(weeklyReview.getByRole("link", { name: "Calendar sync pending" })).toHaveCount(0);
  await expect(weeklyReview).not.toContainText("Fourth option stays hidden");
  expect(weeklyRequests[0]).toContain("week_start=2026-04-27");

  await weeklyReview.getByRole("button", { name: "Rebalance the week" }).click();
  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    "Help me rebalance this week around the slipped planning blocks.",
  );
  await page.screenshot({ path: "artifacts/ui-functional/pwa-assistant-weekly-systems-review.png", fullPage: true });
});

test("PWA assistant weekly systems review hides when endpoint fails or has no content", async ({ page }) => {
  await seedAssistantSession(page);

  await routeAssistantThread(page, () => assistantThreadSnapshot());
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => ({ detail: "weekly endpoint unavailable" }), { status: 500 });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Recommended next move" })).toBeVisible();
  await expect(page.getByLabel("Weekly systems review")).toHaveCount(0);

  await page.unroute(`${API_BASE}/v1/surfaces/assistant/weekly*`);
  await routeAssistantWeekly(page, () =>
    assistantWeeklySummary({
      progress: {
        tasks_completed: 0,
        review_session_count: 0,
        review_item_count: 0,
        captures_created: 0,
        captures_processed: 0,
        captures_summarized: 0,
        cards_created: 0,
        artifact_tasks_created: 0,
        goals_updated: 0,
        goals_reviewed: 0,
        projects_updated: 0,
        projects_reviewed: 0,
      },
      slippage: {
        overdue_tasks: 0,
        overdue_commitments: 0,
        unprocessed_captures: 0,
        due_review_cards: 0,
        stale_active_projects: 0,
        stale_active_goals: 0,
        projects_missing_next_action: 0,
      },
      adaptation_options: [],
      attention_items: [],
      system_health: {
        progress_signal_count: 0,
        slippage_signal_count: 0,
      },
    }),
  );
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Recommended next move" })).toBeVisible();
  await expect(page.getByLabel("Weekly systems review")).toHaveCount(0);
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
  await expect(page.getByLabel("Strategic context")).toHaveCount(0);

  await page.getByRole("button", { name: "Plan recovery" }).click();
  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    "Triage my overdue tasks and propose the next bounded move.",
  );
});

test("PWA assistant renders compact tool activity without console-like labels", async ({ page }) => {
  await seedAssistantSession(page);

  await routeAssistantThread(page, () => assistantThreadActivitySnapshot());
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("I found the current launch context and added the next concrete task.")).toBeVisible();
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
  await expect(activity.getByText("task_id").first()).toBeHidden();

  await expect(page.getByRole("heading", { name: "Launch polish next task" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open task" })).toBeVisible();
  await expect(page.getByText("The task is now attached to Android release prep")).toBeVisible();

  await activitySummary.click();
  await expect(activity.getByText("domain tool").first()).toBeVisible();
  await expect(activity.getByText("task_id").first()).toBeVisible();
  await expect(activity.getByText("checklist")).toBeVisible();
  await expect(activity.getByText("Review mobile screenshots")).toBeVisible();
  await expect(activity.getByText("Confirm preview handoff")).toBeVisible();

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);

  await page.screenshot({ path: "artifacts/ui-functional/pwa-assistant-tool-activity-strip.png", fullPage: true });
});
