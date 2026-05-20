import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

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

async function expectNoHorizontalOverflow(label: string, locator: Locator) {
  await expect(locator, `${label} should be visible before measuring overflow`).toBeVisible();
  const report = await locator.evaluate((rootElement) => {
    const root = rootElement as HTMLElement;
    const rootRect = root.getBoundingClientRect();
    const leftLimit = Math.max(0, rootRect.left);
    const rightLimit = Math.min(window.innerWidth, rootRect.right);
    const visibleElements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("section, article, div, ul, li, h1, h2, h3, p, span, strong, a, button"))]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });

    const overflowing = visibleElements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const scrollOverflow = Math.ceil(element.scrollWidth - element.clientWidth);
        const leftOverflow = Math.ceil(leftLimit - rect.left);
        const rightOverflow = Math.ceil(rect.right - rightLimit);
        const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90);
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          text,
          scrollOverflow,
          leftOverflow,
          rightOverflow,
        };
      })
      .filter((entry) => entry.scrollOverflow > 1 || entry.leftOverflow > 1 || entry.rightOverflow > 1)
      .slice(0, 8);

    return {
      rootClassName: typeof root.className === "string" ? root.className : "",
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      overflowing,
    };
  });

  expect(report.overflowing, `${label} horizontal overflow: ${JSON.stringify(report, null, 2)}`).toEqual([]);
}

async function captureProof(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

test("PWA assistant renders and submits a schema-driven dynamic panel", async ({ page }, testInfo) => {
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
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
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
  const ambientRow = page.getByLabel("Ambient update").filter({ hasText: "Planner found a 90m focus window" });
  await expect(ambientRow).toBeVisible();
  await expect(page.getByText("Focus mode")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/protocol|runtime|tool_call|tool_result|Diagnostics|Surface update/i);
  await expect(page.getByRole("radio", { name: /Move project forward/ })).toBeChecked();
  await expect(page.getByLabel("Protect this focus block")).toBeChecked();
  await expect(page.getByText("Planner can reserve 9:30-11:00 AM for focus.")).toBeVisible();
  await expectNoHorizontalOverflow("dynamic panel", page.getByTestId("dynamic-panel-renderer").first());

  await page.getByRole("button", { name: "Confirm focus" }).click();

  expect(submissions).toHaveLength(1);
  expect(submissions[0].values).toEqual(
    expect.objectContaining({
      focus_mode: "move_project_forward",
      protect_block: true,
      client_timezone: expect.any(String),
    }),
  );
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm focus" })).toHaveCount(0);
  await captureProof(page, testInfo, "pwa-assistant-concept-thread-panel");
});

test("PWA assistant empty state uses a clean centered thread with quiet context", async ({ page }, testInfo) => {
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
    }),
  );
  await routeAssistantWeekly(page, () => assistantWeeklySummary());

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByLabel("Assistant thread start")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible();
  await expect(page.getByLabel("Suggested next prompt")).toContainText("Finish onboarding flow polish");
  await expect(page.getByLabel("Suggested next prompt")).toContainText("A 90 minute focus block can move launch polish forward.");
  await expect(page.getByLabel("Assistant context")).toContainText("Open tasks: 5");
  await expect(page.getByLabel("Assistant context")).toContainText("Reviews due: 4");
  await expect(page.getByLabel("Assistant context")).toContainText("Weekly: 2 recovery options");
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Recommended next move" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/cockpit|observatory|Diagnostics|protocol|runtime/i);

  await page.getByRole("button", { name: "Start focus" }).click();
  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    "Start a 90 minute focus block for onboarding flow polish.",
  );
  await expectNoHorizontalOverflow("desktop clean assistant thread", page.getByLabel("Assistant thread start"));
  await expectNoHorizontalOverflow("desktop context strip", page.getByLabel("Assistant context"));
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(desktopOverflow).toBe(false);
  await captureProof(page, testInfo, "pwa-assistant-clean-thread");
});

test("PWA assistant normal thread renders ambient updates as thin rows", async ({ page }, testInfo) => {
  await seedAssistantSession(page);

  await routeAssistantThread(page, () =>
    assistantThreadSnapshot({
      last_message_at: "2026-04-28T09:24:00.000Z",
      last_preview_text: "Here is the afternoon plan.",
      messages: [
        {
          id: "msg_user_plan",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_plan", text: "Help me plan my afternoon." }],
          metadata: {},
          created_at: "2026-04-28T09:20:00.000Z",
          updated_at: "2026-04-28T09:20:00.000Z",
        },
        {
          id: "msg_assistant_plan",
          thread_id: "thr_primary",
          run_id: "run_plan",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_plan_text",
              text: "Start with the onboarding focus block, then clear the review queue while energy is still high.",
            },
            {
              type: "card",
              id: "part_plan_card",
              card: {
                kind: "task_list",
                version: 1,
                title: "Suggested next step",
                body: "Start the focus block and keep the review pass bounded.",
                entity_ref: { entity_type: "plan", entity_id: "plan_today", href: "/planner", title: "Today's plan" },
                actions: [
                  {
                    id: "open_planner",
                    label: "Open Planner",
                    kind: "navigate",
                    style: "secondary",
                    payload: { href: "/planner" },
                  },
                ],
                metadata: { task_count: 2 },
              },
            },
            {
              type: "ambient_update",
              id: "part_plan_ambient",
              update: {
                id: "ambient_deep_work",
                event_id: "evt_deep_work",
                label: "Planner started Deep Work block",
                body: "2 x 90m at 1:00 - 4:00 PM.",
                entity_ref: { entity_type: "time_block", entity_id: "block_afternoon", href: "/planner" },
                actions: [],
                metadata: { visibility: "current" },
                created_at: "2026-04-28T09:21:00.000Z",
              },
            },
          ],
          metadata: {},
          created_at: "2026-04-28T09:22:00.000Z",
          updated_at: "2026-04-28T09:22:00.000Z",
        },
      ],
    }),
  );
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Start with the onboarding focus block")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Suggested next step" })).toBeVisible();
  const ambientRow = page.getByLabel("Ambient update").filter({ hasText: "Planner started Deep Work block" });
  await expect(ambientRow).toBeVisible();
  await expect(ambientRow).toContainText("Update");
  await expect(page.locator("main")).not.toContainText(/Surface update|protocol|runtime|tool_call|tool_result|Diagnostics/i);
  await captureProof(page, testInfo, "pwa-assistant-normal-thread-ambient-row");
});

test("PWA assistant clean thread stays readable on mobile", async ({ page }, testInfo) => {
  await seedAssistantSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const longRecommendationTitle =
    "FinishLaunchPackagingPassWithAnUnbrokenRecommendationTitleThatMustWrapInsideTheThreadInsteadOfOverflowing";

  await routeAssistantThread(page, () => assistantThreadSnapshot());
  await routeAssistantToday(page, () =>
    assistantTodaySummary({
      open_interrupt_count: 1,
      open_loops: [
        { key: "open_tasks", label: "Open tasks", count: 8, href: "/planner" },
        { key: "overdue_tasks", label: "Overdue tasks", count: 6, href: "/planner" },
        { key: "due_reviews", label: "Reviews due", count: 4, href: "/review" },
        { key: "unprocessed_library", label: "Library inbox", count: 3, href: "/library" },
      ],
      recommended_next_move: {
        key: "focus_packaging",
        title: longRecommendationTitle,
        body: "A 90 minute focus block is available before team sync.",
        surface: "planner",
        href: null,
        action_label: "Start focus",
        prompt: "Start a 90 minute focus block for launch packaging.",
        priority: 95,
        urgency: "high",
      },
    }),
  );
  await routeAssistantWeekly(page, () => assistantWeeklySummary());

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByLabel("Suggested next prompt")).toContainText(longRecommendationTitle);
  await expect(page.getByLabel("Assistant context")).toContainText("Weekly: 2 recovery options");
  await expectNoHorizontalOverflow("mobile clean assistant thread", page.getByLabel("Assistant thread start"));
  await expectNoHorizontalOverflow("mobile context strip", page.getByLabel("Assistant context"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);

  await page.getByRole("button", { name: "Start focus" }).click();
  await expect(page.getByPlaceholder("Ask, capture, plan, review, or move something forward...")).toHaveValue(
    "Start a 90 minute focus block for launch packaging.",
  );
  await captureProof(page, testInfo, "pwa-assistant-clean-thread-mobile");
});

test("PWA assistant renders compact tool activity without console-like labels", async ({ page }, testInfo) => {
  await seedAssistantSession(page);

  await routeAssistantThread(page, () => assistantThreadActivitySnapshot());
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("I found the current launch context and added the next concrete task.")).toBeVisible();
  const activityRows = page.getByLabel("Assistant activity");
  await expect(activityRows.first()).toBeVisible();
  await expect(activityRows.filter({ hasText: "Checked Planner" }).first()).toBeVisible();
  await expect(activityRows.filter({ hasText: "Created task" }).first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/tool_call|tool_result|domain tool|task_id|Raw result|Raw arguments/i);

  await expect(page.getByRole("heading", { name: "Launch polish next task" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open task" })).toBeVisible();
  await expect(page.getByText("The task is now attached to Android release prep")).toBeVisible();

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);

  await captureProof(page, testInfo, "pwa-assistant-tool-activity-strip");
});
