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
    last_message_at: "2026-04-21T09:10:00.000Z",
    last_preview_text: "Starlog needs a few bounded decisions.",
    messages: [],
    runs: [],
    interrupts: [],
    next_cursor: "2026-04-21T09:10:00.000Z",
    ...overrides,
  };
}

function baseInterrupt(overrides: Record<string, unknown>) {
  return {
    id: "interrupt_base",
    thread_id: "thr_primary",
    run_id: "run_base",
    status: "pending",
    interrupt_type: "form",
    tool_name: "request_due_date",
    title: "Finish task details",
    body: "Give the missing fields so Starlog can create the task without leaving the thread.",
    fields: [],
    primary_label: "Create task",
    secondary_label: "Not now",
    defer_label: "Not now",
    display_mode: "composer",
    consequence_preview: "Creates a Planner task. Time blocking can be handled next.",
    recommended_defaults: {},
    entity_ref: null,
    metadata: {},
    created_at: "2026-04-21T09:10:00.000Z",
    resolved_at: null,
    resolution: null,
    ...overrides,
  };
}

function assistantMessage(interrupt: Record<string, unknown>, index: number) {
  return {
    id: `msg_${index}`,
    thread_id: "thr_primary",
    run_id: interrupt.run_id,
    role: "assistant",
    status: "requires_action",
    parts: [
      {
        type: "text",
        id: `part_text_${index}`,
        text: `Panel ${index} is ready.`,
      },
      {
        type: "interrupt_request",
        id: `part_interrupt_${index}`,
        interrupt,
      },
    ],
    metadata: {},
    created_at: `2026-04-21T09:1${index}:00.000Z`,
    updated_at: `2026-04-21T09:1${index}:00.000Z`,
  };
}

function dynamicPanelSnapshot() {
  const interrupts = [
    baseInterrupt({
      id: "interrupt_due_date",
      run_id: "run_due_date",
      tool_name: "request_due_date",
      title: "Finish task details",
      fields: [
        { id: "due_date", kind: "date", label: "Due date", required: true },
        { id: "priority", kind: "priority", label: "Priority", value: 3, min: 1, max: 5 },
        { id: "create_time_block", kind: "toggle", label: "Create 45m block", value: false },
      ],
      recommended_defaults: { priority: 3, create_time_block: false },
    }),
    baseInterrupt({
      id: "interrupt_capture",
      run_id: "run_capture",
      interrupt_type: "form",
      tool_name: "triage_capture",
      title: "Triage this capture",
      body: "Tell Starlog what this capture is and what to do next.",
      fields: [
        {
          id: "capture_kind",
          kind: "select",
          label: "What is this?",
          required: true,
          options: [
            { label: "Reference", value: "reference" },
            { label: "Task", value: "task" },
            { label: "Review material", value: "review_material" },
          ],
        },
        {
          id: "next_step",
          kind: "select",
          label: "Best next step",
          required: true,
          options: [
            { label: "Summarize", value: "summarize" },
            { label: "Create tasks", value: "tasks" },
            { label: "Archive as reference", value: "archive" },
          ],
        },
      ],
      primary_label: "Save choice",
      display_mode: "inline",
      consequence_preview: "Routes this capture into Library, Planner, or Review without losing the original source.",
    }),
    baseInterrupt({
      id: "interrupt_conflict",
      run_id: "run_conflict",
      interrupt_type: "choice",
      tool_name: "resolve_planner_conflict",
      title: "Resolve scheduling conflict",
      body: "Choose how Starlog should resolve this overlap.",
      fields: [
        {
          id: "resolution",
          kind: "select",
          label: "Resolution",
          required: true,
          options: [
            { label: "Move Deep Work", value: "move_later" },
            { label: "Shorten Deep Work", value: "shorten" },
            { label: "Keep both", value: "keep_both" },
          ],
        },
      ],
      primary_label: "Apply choice",
      secondary_label: "Open Planner",
      defer_label: "Open Planner",
      display_mode: "sidecar",
      consequence_preview: "Moves the focus block to the next available 90-minute slot.",
      metadata: {
        conflict_payload: {
          local_title: "Deep Work",
          remote_title: "Team Sync",
        },
      },
    }),
    baseInterrupt({
      id: "interrupt_review",
      run_id: "run_review",
      interrupt_type: "choice",
      tool_name: "grade_review_recall",
      title: "Grade Recall",
      body: "How well did this recall item go?",
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
      defer_label: "Keep in Review",
      display_mode: "inline",
      consequence_preview: "Updates the review schedule for this item.",
      metadata: { review_mode: "recall" },
    }),
    baseInterrupt({
      id: "interrupt_focus",
      run_id: "run_focus",
      interrupt_type: "choice",
      tool_name: "choose_morning_focus",
      title: "Start with one thing",
      body: "Choose today's first bounded move.",
      fields: [
        {
          id: "focus",
          kind: "select",
          label: "First move",
          required: true,
          options: [
            { label: "Move project forward", value: "project" },
            { label: "Clear system friction", value: "friction" },
            { label: "Maintain learning", value: "learning" },
          ],
        },
      ],
      primary_label: "Confirm focus",
      secondary_label: "Later",
      defer_label: "Later",
      display_mode: "composer",
      consequence_preview: "I'll shape your plan around this and protect the first focus block.",
    }),
    baseInterrupt({
      id: "interrupt_defer",
      run_id: "run_defer",
      interrupt_type: "choice",
      tool_name: "defer_recommendation",
      title: "Bring this back later?",
      body: "Pick when this recommendation should return.",
      fields: [
        {
          id: "remind_at",
          kind: "select",
          label: "Remind me",
          required: true,
          options: [
            { label: "In 1 hour", value: "1h" },
            { label: "This evening", value: "evening" },
            { label: "Tomorrow morning", value: "tomorrow_morning" },
          ],
        },
      ],
      primary_label: "Set reminder",
      secondary_label: "No thanks, keep it in view",
      defer_label: "No thanks, keep it in view",
      display_mode: "bottom_sheet",
      consequence_preview: "I'll bring this back when it is more actionable.",
    }),
    baseInterrupt({
      id: "interrupt_confirm",
      run_id: "run_confirm",
      interrupt_type: "confirm",
      tool_name: "confirm_plan_change",
      title: "Apply plan change",
      body: "Starlog can update today's plan with this shift.",
      fields: [],
      primary_label: "Apply change",
      secondary_label: "Cancel",
      defer_label: "Cancel",
      display_mode: "inline",
      consequence_preview: "Updates the plan after confirmation.",
    }),
  ];

  return threadSnapshot({
    interrupts,
    messages: interrupts.map((interrupt, index) => assistantMessage(interrupt, index + 1)),
  });
}

function duplicateFieldIdSnapshot() {
  const interrupts = [
    baseInterrupt({
      id: "interrupt_due_date_a",
      run_id: "run_due_date_a",
      title: "First task details",
      fields: [
        { id: "due_date", kind: "date", label: "Due date", required: true },
        { id: "priority", kind: "priority", label: "Priority", value: 2, min: 1, max: 5 },
      ],
    }),
    baseInterrupt({
      id: "interrupt_due_date_b",
      run_id: "run_due_date_b",
      title: "Second task details",
      fields: [
        { id: "due_date", kind: "date", label: "Due date", required: true },
        { id: "priority", kind: "priority", label: "Priority", value: 4, min: 1, max: 5 },
      ],
    }),
  ];

  return threadSnapshot({
    interrupts,
    messages: interrupts.map((interrupt, index) => assistantMessage(interrupt, index + 1)),
  });
}

function priorityWithoutOptionsSnapshot() {
  const interrupt = baseInterrupt({
    id: "interrupt_priority_planner",
    run_id: "run_priority_planner",
    interrupt_type: "choice",
    tool_name: "resolve_planner_conflict",
    title: "Prioritize conflict response",
    body: "Choose how urgent this scheduling conflict is.",
    fields: [{ id: "priority", kind: "priority", label: "Conflict priority", required: true, min: 1, max: 3 }],
    primary_label: "Apply priority",
    secondary_label: "Open Planner",
    defer_label: "Open Planner",
    display_mode: "sidecar",
    consequence_preview: "Updates the planner conflict priority.",
    metadata: {
      conflict_payload: {
        local_title: "Deep Work",
        remote_title: "Team Sync",
      },
    },
  });

  return threadSnapshot({
    interrupts: [interrupt],
    messages: [assistantMessage(interrupt, 1)],
  });
}

async function routeAssistant(page: import("@playwright/test").Page, snapshot: Record<string, unknown>) {
  await page.route(`${API_BASE}/v1/assistant/threads/primary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.route(`${API_BASE}/v1/assistant/threads/primary/updates*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ thread_id: "thr_primary", cursor: snapshot.next_cursor, deltas: [] }),
    });
  });
  await page.route(`${API_BASE}/v1/assistant/threads/primary/stream`, async (route) => {
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ": keep-alive\n\n" });
  });
}

test("renders assistant-ui-compatible dynamic panel variants without diagnostic labels", async ({ page }) => {
  await seedSession(page);
  await routeAssistant(page, dynamicPanelSnapshot());

  await page.goto("/assistant");

  await expect(page.getByTestId("dynamic-panel-renderer")).toHaveCount(7);
  await expect(page.locator('[data-panel-tool="request_due_date"]')).toContainText("Task setup");
  await expect(page.locator('[data-panel-tool="triage_capture"]')).toContainText("Capture triage");
  await expect(page.locator('[data-panel-tool="resolve_planner_conflict"]')).toContainText("Deep Work");
  await expect(page.locator('[data-panel-tool="resolve_planner_conflict"]')).toContainText("Overlap");
  await expect(page.locator('[data-panel-tool="grade_review_recall"]')).toContainText("Again");
  await expect(page.locator('[data-panel-tool="grade_review_recall"]')).toContainText("Good");
  await expect(page.locator('[data-panel-tool="choose_morning_focus"]')).toContainText("Protect the first useful block.");
  await expect(page.locator('[data-panel-tool="defer_recommendation"]')).toContainText("No thanks, keep it in view");
  await expect(page.locator('[data-panel-tool="confirm_plan_change"]')).toContainText("Confirm this change before Starlog applies it.");
  await expect(page.getByText("Decision", { exact: true })).toHaveCount(0);
});

test("submits and dismisses dynamic panels through existing assistant interrupt APIs", async ({ page }) => {
  await seedSession(page);
  const snapshot = dynamicPanelSnapshot();
  const submissions: Array<{ url: string; values: Record<string, unknown> }> = [];
  const dismissals: string[] = [];

  await routeAssistant(page, snapshot);
  await page.route(`${API_BASE}/v1/assistant/interrupts/*/submit`, async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as { values: Record<string, unknown> };
    submissions.push({ url: request.url(), values: payload.values });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.route(`${API_BASE}/v1/assistant/interrupts/*/dismiss`, async (route) => {
    dismissals.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  await page.goto("/assistant");

  const taskPanel = page.locator('[data-panel-tool="request_due_date"]');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  await taskPanel.getByRole("button", { name: "Tomorrow", exact: true }).click();
  await taskPanel.getByLabel("Priority").selectOption("4");
  await taskPanel.getByLabel("Create 45m block").check();
  await taskPanel.getByRole("button", { name: "Create task" }).click();

  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].url).toContain("/v1/assistant/interrupts/interrupt_due_date/submit");
  expect(submissions[0].values).toMatchObject({
    due_date: tomorrowIso,
    priority: "4",
    create_time_block: true,
  });
  expect(typeof submissions[0].values.client_timezone).toBe("string");

  const reviewPanel = page.locator('[data-panel-tool="grade_review_recall"]');
  await reviewPanel.getByRole("radio", { name: /Good/ }).click();
  await reviewPanel.getByRole("button", { name: "Save grade" }).click();

  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1].url).toContain("/v1/assistant/interrupts/interrupt_review/submit");
  expect(submissions[1].values).toMatchObject({ rating: "4" });

  await page.locator('[data-panel-tool="defer_recommendation"]').getByRole("button", { name: "No thanks, keep it in view" }).click();
  await expect.poll(() => dismissals.length).toBe(1);
  expect(dismissals[0]).toContain("/v1/assistant/interrupts/interrupt_defer/dismiss");
});

test("keeps control ids unique when pending panels reuse field ids", async ({ page }) => {
  await seedSession(page);
  await routeAssistant(page, duplicateFieldIdSnapshot());

  await page.goto("/assistant");
  await expect(page.getByTestId("dynamic-panel-renderer")).toHaveCount(2);

  const controlIds = await page.locator('[id^="dynamic-panel-"]').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).id),
  );
  expect(controlIds).toContain("dynamic-panel-interrupt_due_date_a-due_date");
  expect(controlIds).toContain("dynamic-panel-interrupt_due_date_b-due_date");
  expect(new Set(controlIds).size).toBe(controlIds.length);

  const secondPanel = page.locator('[data-panel-tool="request_due_date"]').nth(1);
  await secondPanel.locator("label", { hasText: "Priority" }).click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement instanceof HTMLElement ? document.activeElement.id : ""))
    .toBe("dynamic-panel-interrupt_due_date_b-priority");
});

test("renders priority choices for option-card panel tones when options are omitted", async ({ page }) => {
  await seedSession(page);
  const snapshot = priorityWithoutOptionsSnapshot();
  const submissions: Array<{ values: Record<string, unknown> }> = [];

  await routeAssistant(page, snapshot);
  await page.route(`${API_BASE}/v1/assistant/interrupts/*/submit`, async (route) => {
    const payload = route.request().postDataJSON() as { values: Record<string, unknown> };
    submissions.push({ values: payload.values });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  await page.goto("/assistant");

  const plannerPanel = page.locator('[data-panel-tool="resolve_planner_conflict"]');
  await expect(plannerPanel.getByRole("radio", { name: /Priority 1/ })).toBeVisible();
  await expect(plannerPanel.getByRole("radio", { name: /Priority 2/ })).toBeVisible();
  await expect(plannerPanel.getByRole("radio", { name: /Priority 3/ })).toBeVisible();

  await plannerPanel.getByRole("radio", { name: /Priority 2/ }).click();
  await plannerPanel.getByRole("button", { name: "Apply priority" }).click();

  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].values).toMatchObject({ priority: "2" });
});
