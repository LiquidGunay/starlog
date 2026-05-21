import { expect, test } from "@playwright/test";

import {
  API_BASE,
  assistantThreadSnapshot,
  assistantTodaySummary,
  assistantWeeklySummary,
  routeAssistantThread,
  routeAssistantToday,
  routeAssistantWeekly,
  seedAssistantSession,
} from "./ui-functional/assistant-concept-fixtures";

async function routeAssistantMessages(
  page: import("@playwright/test").Page,
  onRequest: (body: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<void> {
  await page.route(`${API_BASE}/v1/assistant/threads/thr_primary/messages`, async (route) => {
    const body = (route.request().postDataJSON() as Record<string, unknown>) || {};
    const response = await onRequest(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}

const COMMON_TEST_METADATA = {
  surface: "assistant_web",
  client_timezone: expect.any(String),
};

const DUE_DATE_COMMAND = "create task Review diffusion notes";
const DUE_DATE_TASK_TITLE = "Review diffusion notes";

function dueDateInterrupt(sequence: number, status: "pending" | "submitted" | "dismissed" = "pending", resolution: Record<string, unknown> | null = null): Record<string, unknown> {
  const suffix = String(sequence);
  return {
    id: `interrupt_task_due_${suffix}`,
    thread_id: "thr_primary",
    run_id: `run_task_due_${suffix}`,
    tool_name: "request_due_date",
    interrupt_type: "form",
    status,
    title: "Finish task details",
    body: "Give the missing fields so Starlog can create the task without leaving the thread.",
    primary_label: "Create task",
    secondary_label: "Not now",
    defer_label: "Not now",
    fields: [
      { id: "due_date", kind: "date", label: "Due date", required: true },
      { id: "priority", kind: "priority", label: "Priority", value: 3, min: 1, max: 5 },
      { id: "create_time_block", kind: "toggle", label: "Unsupported time block", value: false },
    ],
    display_mode: "composer",
    consequence_preview: "Creates a Planner task. Time blocking can be handled next.",
    recommended_defaults: { priority: 3, create_time_block: false },
    entity_ref: {
      entity_type: "task",
      entity_id: `draft:${DUE_DATE_TASK_TITLE}`,
      title: DUE_DATE_TASK_TITLE,
    },
    metadata: {
      planned_tool_name: "create_task",
      planned_arguments: { title: DUE_DATE_TASK_TITLE },
      display_mode: "composer",
    },
    resolution,
    created_at: `2026-05-21T10:0${sequence}:02.000Z`,
    resolved_at: status === "pending" ? null : `2026-05-21T10:0${sequence}:20.000Z`,
  };
}

function dueDateUserMessage(sequence: number): Record<string, unknown> {
  return {
    id: `msg_user_task_due_${sequence}`,
    thread_id: "thr_primary",
    run_id: null,
    role: "user",
    status: "complete",
    parts: [{ type: "text", id: `part_user_task_due_${sequence}`, text: DUE_DATE_COMMAND }],
    metadata: {},
    created_at: `2026-05-21T10:0${sequence}:00.000Z`,
    updated_at: `2026-05-21T10:0${sequence}:00.000Z`,
  };
}

function dueDateAssistantMessage(sequence: number, interrupt: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `msg_assistant_task_due_${sequence}`,
    thread_id: "thr_primary",
    run_id: interrupt.run_id,
    role: "assistant",
    status: "requires_action",
    parts: [
      {
        type: "text",
        id: `part_assistant_task_due_text_${sequence}`,
        text: "I can add that now. I only need when you want it due.",
      },
      {
        type: "interrupt_request",
        id: `part_assistant_task_due_interrupt_${sequence}`,
        interrupt,
      },
      {
        type: "status",
        id: `part_assistant_task_due_status_${sequence}`,
        status: "requires_action",
        label: "Waiting for task details",
      },
    ],
    metadata: { interrupt_id: interrupt.id },
    created_at: `2026-05-21T10:0${sequence}:02.000Z`,
    updated_at: `2026-05-21T10:0${sequence}:02.000Z`,
  };
}

function dueDateRun(sequence: number, interrupt: Record<string, unknown>, status = "interrupted"): Record<string, unknown> {
  return {
    id: interrupt.run_id,
    thread_id: "thr_primary",
    origin_message_id: `msg_user_task_due_${sequence}`,
    orchestrator: "deterministic",
    status,
    summary: `Create task ${DUE_DATE_TASK_TITLE}`,
    metadata: {},
    steps: [],
    current_interrupt: status === "interrupted" ? interrupt : null,
    created_at: `2026-05-21T10:0${sequence}:00.000Z`,
    updated_at: `2026-05-21T10:0${sequence}:02.000Z`,
  };
}

function appendDueDateInterrupt(snapshot: Record<string, unknown>, sequence: number): {
  snapshot: Record<string, unknown>;
  run: Record<string, unknown>;
  userMessage: Record<string, unknown>;
  assistantMessage: Record<string, unknown>;
} {
  const interrupt = dueDateInterrupt(sequence);
  const userMessage = dueDateUserMessage(sequence);
  const assistantMessage = dueDateAssistantMessage(sequence, interrupt);
  const run = dueDateRun(sequence, interrupt);
  const messages = [...(snapshot.messages as Record<string, unknown>[]), userMessage, assistantMessage];
  const runs = [...(snapshot.runs as Record<string, unknown>[]), run];
  const interrupts = [...(snapshot.interrupts as Record<string, unknown>[]), interrupt];

  return {
    userMessage,
    assistantMessage,
    run,
    snapshot: {
      ...snapshot,
      last_message_at: assistantMessage.created_at,
      last_preview_text: "I can add that now. I only need when you want it due.",
      messages,
      runs,
      interrupts,
      updated_at: assistantMessage.updated_at,
      next_cursor: assistantMessage.updated_at,
    },
  };
}

function resolveDueDateInterrupt(
  snapshot: Record<string, unknown>,
  action: "submit" | "dismiss",
  values: Record<string, unknown> = {},
): Record<string, unknown> {
  const interrupts = snapshot.interrupts as Record<string, unknown>[];
  const pendingInterrupt = interrupts.find((interrupt) => interrupt.tool_name === "request_due_date" && interrupt.status === "pending");
  if (!pendingInterrupt) {
    throw new Error("Expected a pending due-date interrupt.");
  }
  const resolvedInterrupt = dueDateInterrupt(
    Number(String(pendingInterrupt.id).replace("interrupt_task_due_", "")),
    action === "submit" ? "submitted" : "dismissed",
    {
      id: `resolution_${pendingInterrupt.id}`,
      interrupt_id: pendingInterrupt.id,
      action,
      values,
      metadata: {},
      created_at: "2026-05-21T10:08:20.000Z",
    },
  );
  const resolvedRuns = (snapshot.runs as Record<string, unknown>[]).map((run) =>
    run.id === pendingInterrupt.run_id
      ? { ...run, status: "completed", current_interrupt: null, updated_at: "2026-05-21T10:08:20.000Z" }
      : run,
  );
  const resolvedInterrupts = interrupts.map((interrupt) => (interrupt.id === pendingInterrupt.id ? resolvedInterrupt : interrupt));
  const confirmationMessage =
    action === "submit"
      ? {
          id: `msg_assistant_task_created_${pendingInterrupt.id}`,
          thread_id: "thr_primary",
          run_id: pendingInterrupt.run_id,
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: `part_assistant_task_created_${pendingInterrupt.id}`,
              text: `Created task ${DUE_DATE_TASK_TITLE}.`,
            },
            {
              type: "interrupt_resolution",
              id: `part_assistant_task_resolution_${pendingInterrupt.id}`,
              resolution: resolvedInterrupt.resolution,
            },
          ],
          metadata: {},
          created_at: "2026-05-21T10:08:20.000Z",
          updated_at: "2026-05-21T10:08:20.000Z",
        }
      : null;
  const messages = confirmationMessage
    ? [...(snapshot.messages as Record<string, unknown>[]), confirmationMessage]
    : (snapshot.messages as Record<string, unknown>[]);

  return {
    ...snapshot,
    last_message_at: confirmationMessage?.created_at || snapshot.last_message_at,
    last_preview_text: confirmationMessage ? `Created task ${DUE_DATE_TASK_TITLE}.` : "Task details dismissed.",
    messages,
    runs: resolvedRuns,
    interrupts: resolvedInterrupts,
    updated_at: "2026-05-21T10:08:20.000Z",
    next_cursor: "2026-05-21T10:08:20.000Z",
  };
}

test("PWA assistant creates a task through the due-date dynamic panel", async ({ page }) => {
  await seedAssistantSession(page);
  const messageRequests: Array<Record<string, unknown>> = [];
  const submissions: Array<{ url: string; values: Record<string, unknown> }> = [];
  const dismissals: string[] = [];
  let sequence = 0;
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-05-21T10:00:00.000Z",
    last_preview_text: "Ready for a Planner command.",
  });

  await routeAssistantThread(page, () => snapshot);
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
  await routeAssistantMessages(page, (payload) => {
    messageRequests.push(payload);
    sequence += 1;
    const appended = appendDueDateInterrupt(snapshot, sequence);
    snapshot = appended.snapshot;

    return {
      thread_id: "thr_primary",
      run: appended.run,
      user_message: appended.userMessage,
      assistant_message: appended.assistantMessage,
      snapshot,
    };
  });
  await page.route(`${API_BASE}/v1/assistant/interrupts/*/dismiss`, async (route) => {
    dismissals.push(route.request().url());
    snapshot = resolveDueDateInterrupt(snapshot, "dismiss");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.route(`${API_BASE}/v1/assistant/interrupts/*/submit`, async (route) => {
    const payload = route.request().postDataJSON() as { values: Record<string, unknown> };
    submissions.push({ url: route.request().url(), values: payload.values });
    snapshot = resolveDueDateInterrupt(snapshot, "submit", payload.values);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(DUE_DATE_COMMAND);
  await page.getByRole("button", { name: "Send" }).click();

  const main = page.locator("main");
  const rawProtocolText = /request_due_date|renderer_key|tool_name|starlog-interrupt-request|Fallback|Diagnostic|Raw|ui_tool|domain_tool|create_task/i;
  const firstTaskPanel = page.getByTestId("dynamic-panel-renderer").filter({ hasText: DUE_DATE_TASK_TITLE });
  await expect(firstTaskPanel).toBeVisible();
  await expect(firstTaskPanel.getByText("Task setup", { exact: true })).toBeVisible();
  await expect(firstTaskPanel.getByText("Finish task details", { exact: true })).toBeVisible();
  await expect(firstTaskPanel.getByLabel("Task preview")).toContainText(DUE_DATE_TASK_TITLE);
  await expect(firstTaskPanel.getByLabel("Due date")).toBeVisible();
  await expect(firstTaskPanel.getByRole("radio", { name: "Priority 4" })).toBeVisible();
  await expect(main).not.toContainText(rawProtocolText);

  await firstTaskPanel.getByRole("button", { name: "Not now" }).click();
  await expect.poll(() => dismissals.length).toBe(1);
  expect(dismissals[0]).toContain("/v1/assistant/interrupts/interrupt_task_due_1/dismiss");
  await expect(page.getByText("Dismissed.")).toBeVisible();
  await expect(page.getByTestId("dynamic-panel-renderer").filter({ hasText: DUE_DATE_TASK_TITLE })).toHaveCount(0);
  await expect(main).not.toContainText(rawProtocolText);

  const dueDate = "2026-05-28";
  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(DUE_DATE_COMMAND);
  await page.getByRole("button", { name: "Send" }).click();

  const secondTaskPanel = page.getByTestId("dynamic-panel-renderer").filter({ hasText: DUE_DATE_TASK_TITLE });
  await expect(secondTaskPanel).toBeVisible();
  await secondTaskPanel.getByLabel("Due date").fill(dueDate);
  await secondTaskPanel.getByRole("radio", { name: "Priority 4" }).click();
  await expect(secondTaskPanel).not.toContainText("Unsupported time block");
  await secondTaskPanel.getByRole("button", { name: "Create task" }).click();

  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].url).toContain("/v1/assistant/interrupts/interrupt_task_due_2/submit");
  expect(submissions[0].values).toMatchObject({
    due_date: dueDate,
    priority: "4",
  });
  expect(submissions[0].values).not.toHaveProperty("create_time_block");
  expect(typeof submissions[0].values.client_timezone).toBe("string");
  await expect(page.getByText(`Created task ${DUE_DATE_TASK_TITLE}.`)).toBeVisible();
  await expect(page.getByTestId("dynamic-panel-renderer").filter({ hasText: DUE_DATE_TASK_TITLE })).toHaveCount(0);
  await expect(main).not.toContainText(rawProtocolText);

  expect(messageRequests).toHaveLength(2);
  for (const request of messageRequests) {
    expect(request.content).toBe(DUE_DATE_COMMAND);
    expect(request).toMatchObject({
      input_mode: "text",
      device_target: "web-desktop",
      metadata: COMMON_TEST_METADATA,
    });
  }
});

test("PWA assistant visible unlock study command execution", async ({ page }) => {
  await seedAssistantSession(page);
  const requests: Array<Record<string, unknown>> = [];
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-05-01T10:00:00.000Z",
    last_preview_text: "Waiting for a study command.",
    messages: [
      {
        id: "msg_assistant_intro",
        thread_id: "thr_primary",
        run_id: null,
        role: "assistant",
        status: "complete",
        parts: [{ type: "text", id: "part_assistant_intro", text: "Try a study command and I will map it to study actions." }],
        metadata: {},
        created_at: "2026-05-01T09:59:30.000Z",
        updated_at: "2026-05-01T09:59:30.000Z",
      },
    ],
  });

  const command = "unlock Neetcode sliding window drills";

  await routeAssistantThread(page, () => snapshot);
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
  await routeAssistantMessages(page, (payload) => {
    requests.push(payload);
    snapshot = assistantThreadSnapshot({
      last_message_at: "2026-05-01T10:00:05.000Z",
      last_preview_text: "The study topic is unlocked.",
      messages: [
        ...snapshot.messages as Record<string, unknown>[],
        {
          id: "msg_user_unlock",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_unlock", text: command }],
          metadata: {},
          created_at: "2026-05-01T10:00:00.000Z",
          updated_at: "2026-05-01T10:00:00.000Z",
        },
        {
          id: "msg_assistant_unlock",
          thread_id: "thr_primary",
          run_id: "run_unlock_study",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_assistant_unlock",
              text: "I unlocked the study topic and set it to active.",
            },
          ],
          metadata: {
            assistant_command: {
              matched_intent: "unlock_study_topic",
              status: "executed",
            },
          },
          created_at: "2026-05-01T10:00:05.000Z",
          updated_at: "2026-05-01T10:00:05.000Z",
        },
      ],
    });
    const messages = snapshot.messages as Array<Record<string, unknown>>;

    return {
      thread_id: "thr_primary",
      run: {
        id: "run_unlock_study",
        thread_id: "thr_primary",
        origin_message_id: "msg_user_unlock",
        orchestrator: "hybrid",
        status: "completed",
        summary: "unlocked",
        metadata: {},
        steps: [],
        current_interrupt: null,
        created_at: "2026-05-01T10:00:00.000Z",
        updated_at: "2026-05-01T10:00:05.000Z",
      },
      user_message: {
        id: "msg_user_unlock",
        thread_id: "thr_primary",
        run_id: null,
        role: "user",
        status: "complete",
        parts: [{ type: "text", id: "part_user_unlock", text: command }],
        metadata: {},
        created_at: "2026-05-01T10:00:00.000Z",
        updated_at: "2026-05-01T10:00:00.000Z",
      },
      assistant_message: {
        id: "msg_assistant_unlock",
        thread_id: "thr_primary",
        run_id: "run_unlock_study",
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "text",
            id: "part_assistant_unlock",
            text: "I unlocked the study topic and set it to active.",
          },
        ],
        metadata: {
          assistant_command: {
            matched_intent: "unlock_study_topic",
            status: "executed",
          },
        },
        created_at: "2026-05-01T10:00:05.000Z",
        updated_at: "2026-05-01T10:00:05.000Z",
      },
      snapshot,
    };
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(command)).toBeVisible();
  await expect(page.getByText("I unlocked the study topic and set it to active.")).toBeVisible();

  expect(requests).toHaveLength(1);
  expect(requests[0].content).toBe(command);
  expect(requests[0]).toMatchObject({
    input_mode: "text",
    device_target: "web-desktop",
    metadata: COMMON_TEST_METADATA,
  });
});

test("PWA assistant submits visible study reading command payload", async ({ page }) => {
  await seedAssistantSession(page);
  const requests: Array<Record<string, unknown>> = [];
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-05-01T12:00:00.000Z",
    last_preview_text: "Waiting for study progress.",
    messages: [
      {
        id: "msg_assistant_reading_intro",
        thread_id: "thr_primary",
        run_id: null,
        role: "assistant",
        status: "complete",
        parts: [{ type: "text", id: "part_assistant_reading_intro", text: "Tell me what you read and I will update your study log." }],
        metadata: {},
        created_at: "2026-05-01T11:59:30.000Z",
        updated_at: "2026-05-01T11:59:30.000Z",
      },
    ],
  });

  const command = "I read Sliding Window";

  await routeAssistantThread(page, () => snapshot);
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
  await routeAssistantMessages(page, (payload) => {
    requests.push(payload);
    snapshot = assistantThreadSnapshot({
      last_message_at: "2026-05-01T12:00:05.000Z",
      last_preview_text: "Logged study progress.",
      messages: [
        ...(snapshot.messages as Record<string, unknown>[]),
        {
          id: "msg_user_reading",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_reading", text: command }],
          metadata: {},
          created_at: "2026-05-01T12:00:00.000Z",
          updated_at: "2026-05-01T12:00:00.000Z",
        },
        {
          id: "msg_assistant_reading",
          thread_id: "thr_primary",
          run_id: "run_reading_study",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_assistant_reading",
              text: "Logged Sliding Window in your study progress.",
            },
          ],
          metadata: {
            assistant_command: {
              matched_intent: "mark_study_topic_read",
              status: "executed",
            },
          },
          created_at: "2026-05-01T12:00:05.000Z",
          updated_at: "2026-05-01T12:00:05.000Z",
        },
      ],
    });
    const messages = snapshot.messages as Array<Record<string, unknown>>;

    return {
      thread_id: "thr_primary",
      run: {
        id: "run_reading_study",
        thread_id: "thr_primary",
        origin_message_id: "msg_user_reading",
        orchestrator: "hybrid",
        status: "completed",
        summary: "logged",
        metadata: {},
        steps: [],
        current_interrupt: null,
        created_at: "2026-05-01T12:00:00.000Z",
        updated_at: "2026-05-01T12:00:05.000Z",
      },
      user_message: {
        id: "msg_user_reading",
        thread_id: "thr_primary",
        run_id: null,
        role: "user",
        status: "complete",
        parts: [{ type: "text", id: "part_user_reading", text: command }],
        metadata: {},
        created_at: "2026-05-01T12:00:00.000Z",
        updated_at: "2026-05-01T12:00:00.000Z",
      },
      assistant_message: {
        id: "msg_assistant_reading",
        thread_id: "thr_primary",
        run_id: "run_reading_study",
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "text",
            id: "part_assistant_reading",
            text: "Logged Sliding Window in your study progress.",
          },
        ],
        metadata: {
          assistant_command: {
            matched_intent: "mark_study_topic_read",
            status: "executed",
          },
        },
        created_at: "2026-05-01T12:00:05.000Z",
        updated_at: "2026-05-01T12:00:05.000Z",
      },
      snapshot,
    };
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(command)).toBeVisible();
  await expect(page.getByText("Logged Sliding Window in your study progress.")).toBeVisible();

  expect(requests).toEqual([
    expect.objectContaining({
      content: command,
      input_mode: "text",
      device_target: "web-desktop",
      metadata: COMMON_TEST_METADATA,
    }),
  ]);
});

test("PWA assistant visible quiz study request command execution", async ({ page }) => {
  await seedAssistantSession(page);
  const requests: Array<Record<string, unknown>> = [];
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-05-01T11:00:00.000Z",
    last_preview_text: "Waiting for a study request.",
  });

  const command = "quiz me on application questions for embeddings";

  await routeAssistantThread(page, () => snapshot);
  await routeAssistantToday(page, () => assistantTodaySummary());
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
  await routeAssistantMessages(page, (payload) => {
    requests.push(payload);
    snapshot = assistantThreadSnapshot({
      last_message_at: "2026-05-01T11:00:05.000Z",
      last_preview_text: "I queued a study question request.",
      messages: [
        ...snapshot.messages as Record<string, unknown>[],
        {
          id: "msg_user_quiz",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_quiz", text: command }],
          metadata: {},
          created_at: "2026-05-01T11:00:00.000Z",
          updated_at: "2026-05-01T11:00:00.000Z",
        },
        {
          id: "msg_assistant_quiz",
          thread_id: "thr_primary",
          run_id: "run_quiz_study",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_assistant_quiz",
              text: "I queued a study question request for application-focused prompts.",
            },
          ],
          metadata: {
            assistant_command: {
              matched_intent: "create_study_question_request",
              status: "executed",
            },
          },
          created_at: "2026-05-01T11:00:05.000Z",
          updated_at: "2026-05-01T11:00:05.000Z",
        },
      ],
    });

    return {
      thread_id: "thr_primary",
      run: {
        id: "run_quiz_study",
        thread_id: "thr_primary",
        origin_message_id: "msg_user_quiz",
        orchestrator: "hybrid",
        status: "completed",
        summary: "requested",
        metadata: {},
        steps: [],
        current_interrupt: null,
        created_at: "2026-05-01T11:00:00.000Z",
        updated_at: "2026-05-01T11:00:05.000Z",
      },
      user_message: {
        id: "msg_user_quiz",
        thread_id: "thr_primary",
        run_id: null,
        role: "user",
        status: "complete",
        parts: [{ type: "text", id: "part_user_quiz", text: command }],
        metadata: {},
        created_at: "2026-05-01T11:00:00.000Z",
        updated_at: "2026-05-01T11:00:00.000Z",
      },
      assistant_message: {
        id: "msg_assistant_quiz",
        thread_id: "thr_primary",
        run_id: "run_quiz_study",
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "text",
            id: "part_assistant_quiz",
            text: "I queued a study question request for application-focused prompts.",
          },
        ],
        metadata: {
          assistant_command: {
            matched_intent: "create_study_question_request",
            status: "executed",
          },
        },
        created_at: "2026-05-01T11:00:05.000Z",
        updated_at: "2026-05-01T11:00:05.000Z",
      },
      snapshot,
    };
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(command)).toBeVisible();
  await expect(page.getByText("I queued a study question request for application-focused prompts.")).toBeVisible();

  expect(requests).toHaveLength(1);
  expect(requests[0].content).toBe(command);
  expect(requests[0]).toMatchObject({
    input_mode: "text",
    device_target: "web-desktop",
    metadata: COMMON_TEST_METADATA,
  });
});

test("PWA interview prep loop unlocks from Assistant and completes one Review card", async ({ page }) => {
  await seedAssistantSession(page);
  const assistantRequests: Array<Record<string, unknown>> = [];
  const revealEvents: Array<Record<string, unknown>> = [];
  const studyQuestionRequests: Array<Record<string, unknown>> = [];
  const reviewSubmissions: Array<Record<string, unknown>> = [];
  const topicTitle = "Sliding Window Interview Patterns";
  const command = `unlock ${topicTitle}`;
  let studyTopicStatus: "locked" | "unlocked" | "read" = "locked";
  let reviewCards = [
    {
      id: "card-sliding-window-application",
      deck_id: "deck-interview-application",
      card_type: "application_case",
      review_mode: "application",
      prompt: "You need the longest subarray with at most two distinct values. Which window invariant keeps the algorithm linear?",
      answer: "Maintain counts inside the current window and shrink from the left whenever more than two distinct values are present.",
      due_at: "2026-05-20T12:00:00.000Z",
    },
  ];
  let reviewSummary = {
    ladder_counts: [{ key: "application", label: "Application", count: 1 }],
    total_ladder_counts: [{ key: "application", label: "Application", count: 1 }],
    deck_buckets: [{ key: "deck-interview-application", label: "Interview application", count: 1 }],
    queue_health: {
      due_count: 1,
      overdue_count: 0,
      due_soon_count: 1,
      suspended_count: 0,
      reviewed_today_count: 0,
      last_reviewed_at: "2026-05-15T09:00:00.000Z",
      average_latency_ms: 240,
    },
    learning_insights: [],
    recommended_drill: {
      mode: "application",
      title: "Sliding window application drill",
      body: "Practice the unlocked interview topic before adding another source.",
      prompt: `Quiz me on application questions for ${topicTitle}.`,
      reason: "You just unlocked this interview-prep topic and one application card is due now.",
      enabled: true,
    },
    generated_at: "2026-05-15T09:00:00.000Z",
  };
  const decks = [
    {
      id: "deck-interview-application",
      name: "Interview application",
      description: "Application transfer for coding interviews",
      card_count: 1,
      due_count: 1,
    },
  ];
  const studyProgress = () => ({
    source_count: 1,
    topic_count: 1,
    read_topic_count: studyTopicStatus === "read" ? 1 : 0,
    unlocked_topic_count: studyTopicStatus === "locked" ? 0 : 1,
    locked_topic_count: studyTopicStatus === "locked" ? 1 : 0,
    due_unlocked_card_count: reviewCards.length,
  });
  const studyTopics = () => [
    {
      id: "topic-sliding-window",
      source_id: "source-neetcode",
      parent_topic_id: null,
      title: topicTitle,
      summary: "Window boundaries, counts, and shrink conditions for interview problems.",
      display_order: 1,
      status: studyTopicStatus,
      manually_unlocked: studyTopicStatus !== "locked",
      unlocked_at: studyTopicStatus === "locked" ? null : "2026-05-15T09:01:00.000Z",
      read_at: studyTopicStatus === "read" ? "2026-05-15T09:02:00.000Z" : null,
      created_at: "2026-05-15T08:55:00.000Z",
      updated_at: "2026-05-15T09:01:00.000Z",
    },
  ];
  let snapshot = assistantThreadSnapshot({
    last_message_at: "2026-05-15T09:00:00.000Z",
    last_preview_text: "Unlock the interview topic when you are ready.",
    messages: [
      {
        id: "msg_assistant_interview_intro",
        thread_id: "thr_primary",
        run_id: null,
        role: "assistant",
        status: "complete",
        parts: [{ type: "text", id: "part_assistant_interview_intro", text: "One interview-prep topic is ready to unlock." }],
        metadata: {},
        created_at: "2026-05-15T09:00:00.000Z",
        updated_at: "2026-05-15T09:00:00.000Z",
      },
    ],
  });

  await routeAssistantThread(page, () => snapshot);
  await routeAssistantToday(page, () => assistantTodaySummary({
    open_loops: [
      { key: "open_tasks", label: "Open tasks", count: 0, href: "/planner" },
      { key: "due_reviews", label: "Reviews due", count: 1, href: "/review" },
      { key: "locked_interview_topics", label: "Locked interview topics", count: 1, href: "/review" },
    ],
    recommended_next_move: {
      key: "unlock_interview_topic",
      title: "Unlock the next interview topic",
      body: "Sliding Window has one application card ready after unlock.",
      surface: "review",
      href: "/review",
      action_label: "Open Review",
      priority: 95,
      urgency: "high",
    },
    reason_stack: [
      "One locked interview-prep topic is blocking its linked review card.",
      "Application practice is the highest-value next step.",
    ],
    at_a_glance: [
      { key: "review", label: "Review due", count: 1, href: "/review" },
      { key: "locked_interview_topics", label: "Locked interview topics", count: 1, href: "/review" },
    ],
    quick_actions: [
      {
        key: "open_review",
        title: "Open Review",
        surface: "review",
        href: "/review",
        action_label: "Open Review",
        enabled: true,
        count: 1,
        reason: "Interview topic can be unlocked from Review.",
        priority: 95,
      },
    ],
  }));
  await routeAssistantWeekly(page, () => assistantWeeklySummary());
  await routeAssistantMessages(page, (payload) => {
    assistantRequests.push(payload);
    studyTopicStatus = "unlocked";
    snapshot = assistantThreadSnapshot({
      last_message_at: "2026-05-15T09:01:00.000Z",
      last_preview_text: "Unlocked the interview topic and queued its application card.",
      messages: [
        ...(snapshot.messages as Record<string, unknown>[]),
        {
          id: "msg_user_interview_unlock",
          thread_id: "thr_primary",
          run_id: null,
          role: "user",
          status: "complete",
          parts: [{ type: "text", id: "part_user_interview_unlock", text: command }],
          metadata: {},
          created_at: "2026-05-15T09:00:55.000Z",
          updated_at: "2026-05-15T09:00:55.000Z",
        },
        {
          id: "msg_assistant_interview_unlock",
          thread_id: "thr_primary",
          run_id: "run_interview_unlock",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "text",
              id: "part_assistant_interview_unlock",
              text: "I unlocked Sliding Window Interview Patterns and queued one application review card.",
            },
            {
              type: "card",
              id: "part_card_interview_quiz",
              card: {
                kind: "learning_drill",
                version: 1,
                renderer_key: "interview.recommendation_reason",
                renderer_version: 1,
                placement: "thread",
                title: "Application quiz ready",
                body: "You just unlocked this interview-prep topic and one application card is due now.",
                structured_content: {
                  reason: "You just unlocked this interview-prep topic and one application card is due now.",
                  evidence: ["Unlocked topic: Sliding Window Interview Patterns", "Due application cards: 1"],
                  confidence: 0.92,
                },
                ui_meta: {
                  tone: "study",
                },
                entity_ref: {
                  entity_type: "study_topic",
                  entity_id: "topic-sliding-window",
                  href: "/review",
                  title: topicTitle,
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
                metadata: {
                  topic_id: "topic-sliding-window",
                  card_id: "card-sliding-window-application",
                  review_mode: "application",
                  recommendation_reason: "You just unlocked this interview-prep topic and one application card is due now.",
                },
              },
            },
          ],
          metadata: {
            assistant_command: {
              matched_intent: "unlock_study_topic",
              status: "executed",
            },
          },
          created_at: "2026-05-15T09:01:00.000Z",
          updated_at: "2026-05-15T09:01:00.000Z",
        },
      ],
    });

    const messages = snapshot.messages as Array<Record<string, unknown>>;

    return {
      thread_id: "thr_primary",
      run: {
        id: "run_interview_unlock",
        thread_id: "thr_primary",
        origin_message_id: "msg_user_interview_unlock",
        orchestrator: "hybrid",
        status: "completed",
        summary: "unlocked interview topic",
        metadata: {},
        steps: [],
        current_interrupt: null,
        created_at: "2026-05-15T09:00:55.000Z",
        updated_at: "2026-05-15T09:01:00.000Z",
      },
      user_message: messages.find((message) => message.id === "msg_user_interview_unlock"),
      assistant_message: messages.find((message) => message.id === "msg_assistant_interview_unlock"),
      snapshot,
    };
  });
  await page.route(`${API_BASE}/v1/surfaces/review/summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewSummary) });
  });
  await page.route(`${API_BASE}/v1/cards/due*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewCards) });
  });
  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(decks) });
  });
  await page.route(`${API_BASE}/v1/study/progress`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(studyProgress()) });
  });
  await page.route(`${API_BASE}/v1/study/topics*`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(studyTopics()) });
  });
  await page.route(`${API_BASE}/v1/study/question-requests`, async (route) => {
    studyQuestionRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });
  await page.route(`${API_BASE}/v1/assistant/threads/primary/events`, async (route) => {
    revealEvents.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });
  await page.route(`${API_BASE}/v1/reviews`, async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    reviewSubmissions.push(payload);
    reviewCards = reviewCards.filter((card) => card.id !== payload.card_id);
    reviewSummary = {
      ...reviewSummary,
      ladder_counts: [{ key: "application", label: "Application", count: 0 }],
      queue_health: {
        ...reviewSummary.queue_health,
        due_count: 0,
        due_soon_count: 0,
        reviewed_today_count: 1,
        last_reviewed_at: "2026-05-15T09:05:00.000Z",
      },
    };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "review-1" }) });
  });

  await page.goto("/assistant", { waitUntil: "domcontentloaded" });
  const assistantContext = page.getByLabel("Assistant context");
  await expect(assistantContext.getByRole("button", { name: "Unlock the next interview topic" })).toBeVisible();
  await expect(assistantContext.getByRole("button", { name: "Locked interview topics: 1" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recommended next move" })).toHaveCount(0);

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(command)).toBeVisible();
  await expect(page.getByText("I unlocked Sliding Window Interview Patterns and queued one application review card.")).toBeVisible();
  const quizCard = page.locator("section").filter({ hasText: "Application quiz ready" });
  await expect(quizCard.getByText("You just unlocked this interview-prep topic and one application card is due now.")).toBeVisible();
  await quizCard.getByRole("link", { name: "Open Review" }).click();

  await expect(page).toHaveURL(/\/review$/);
  const studyTopic = page.locator(".review-study-topic");
  await expect(studyTopic.getByText("Sliding Window Interview Patterns", { exact: true })).toBeVisible();
  await expect(studyTopic.getByText("Ready to study", { exact: true })).toBeVisible();
  await expect(page.getByText("Reason: You just unlocked this interview-prep topic and one application card is due now.")).toBeVisible();
  await expect(page.getByText("You need the longest subarray with at most two distinct values.")).toBeVisible();
  await expect(page.getByText("Maintain counts inside the current window")).toHaveCount(0);

  await page.getByRole("button", { name: "Application question" }).click();
  await expect(page.getByText("Requested an application question for Sliding Window Interview Patterns.")).toBeVisible();
  expect(studyQuestionRequests).toEqual([
    expect.objectContaining({
      topic_id: "topic-sliding-window",
      response: { question_preference: "application" },
    }),
  ]);

  await page.getByRole("button", { name: "Reveal answer" }).click();
  await expect(page.getByText("Maintain counts inside the current window")).toBeVisible();
  expect(revealEvents).toHaveLength(1);
  expect(revealEvents[0]).toMatchObject({
    source_surface: "review",
    kind: "review.answer.revealed",
    payload: {
      card_id: "card-sliding-window-application",
      review_mode: "application",
    },
  });

  await page.getByRole("button", { name: "Good 3d" }).click();
  await expect(page.getByText("Recorded Good for card-sliding-window-application.")).toBeVisible();
  await expect(page.getByText("No due cards loaded.")).toBeVisible();
  await expect(page.getByText("Again 0 | Hard 0 | Good 1 | Easy 0")).toBeVisible();
  await expect(page.getByText("Reviewed today")).toBeVisible();
  await expect(page.getByText("1 reviewed")).toBeVisible();
  expect(reviewSubmissions).toEqual([{ card_id: "card-sliding-window-application", rating: 4 }]);
  expect(assistantRequests[0]).toMatchObject({
    content: command,
    input_mode: "text",
    device_target: "web-desktop",
    metadata: COMMON_TEST_METADATA,
  });
});
