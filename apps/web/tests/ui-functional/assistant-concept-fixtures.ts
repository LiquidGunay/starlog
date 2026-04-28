import type { Page } from "@playwright/test";

export const API_BASE = "http://api.local";
export const TOKEN = "token-ui-functional";

type SnapshotOverrides = Record<string, unknown>;

export async function seedAssistantSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ apiBase, token }) => {
      window.localStorage.setItem("starlog-api-base", apiBase);
      window.localStorage.setItem("starlog-token", token);
    },
    { apiBase: API_BASE, token: TOKEN },
  );
}

export function assistantThreadSnapshot(overrides: SnapshotOverrides = {}): Record<string, unknown> {
  return {
    id: "thr_primary",
    slug: "primary",
    title: "Assistant thread",
    mode: "assistant",
    created_at: "2026-04-27T09:00:00.000Z",
    updated_at: "2026-04-27T09:00:00.000Z",
    last_message_at: null,
    last_preview_text: null,
    messages: [],
    runs: [],
    interrupts: [],
    next_cursor: "2026-04-27T09:00:00.000Z",
    ...overrides,
  };
}

export function assistantTodaySummary(overrides: SnapshotOverrides = {}): Record<string, unknown> {
  return {
    date: "2026-04-28",
    thread_id: "thr_primary",
    active_run_count: 0,
    open_interrupt_count: 0,
    recent_surface_event_count: 0,
    open_loops: [
      { key: "open_tasks", label: "Open tasks", count: 0, href: "/planner" },
      { key: "overdue_tasks", label: "Overdue tasks", count: 0, href: "/planner" },
      { key: "due_reviews", label: "Reviews due", count: 0, href: "/review" },
      { key: "unprocessed_library", label: "Library inbox", count: 0, href: "/library" },
      { key: "open_commitments", label: "Open commitments", count: 0, href: "/planner" },
    ],
    recommended_next_move: {
      key: "plan_today",
      title: "Plan today",
      body: "No urgent open loops are visible; choose the next focus for today.",
      surface: "planner",
      href: "/planner",
      action_label: "Plan today",
      prompt: "Help me plan today.",
      priority: 10,
      urgency: "low",
    },
    reason_stack: ["No pending interrupts, overdue tasks, unprocessed captures, or due reviews are visible."],
    at_a_glance: [
      { key: "planner", label: "Planner", count: 0, href: "/planner" },
      { key: "library", label: "Library inbox", count: 0, href: "/library" },
      { key: "review", label: "Review due", count: 0, href: "/review" },
      { key: "commitments", label: "Open commitments", count: 0, href: "/planner" },
    ],
    quick_actions: [
      {
        key: "plan_today",
        title: "Plan today",
        surface: "planner",
        href: "/planner",
        action_label: "Plan today",
        prompt: "Help me plan today.",
        enabled: true,
        count: 0,
        reason: null,
        priority: 10,
      },
    ],
    generated_at: "2026-04-28T09:00:00.000Z",
    ...overrides,
  };
}

export function assistantWeeklySummary(overrides: SnapshotOverrides = {}): Record<string, unknown> {
  return {
    week_start: "2026-04-27",
    week_end: "2026-05-03",
    progress: {
      tasks_completed: 3,
      review_session_count: 4,
      review_item_count: 12,
      captures_created: 2,
      captures_processed: 1,
      captures_summarized: 1,
      cards_created: 5,
      artifact_tasks_created: 1,
      goals_updated: 1,
      goals_reviewed: 0,
      projects_updated: 2,
      projects_reviewed: 1,
    },
    slippage: {
      overdue_tasks: 2,
      overdue_commitments: 1,
      unprocessed_captures: 1,
      due_review_cards: 4,
      stale_active_projects: 1,
      stale_active_goals: 0,
      projects_missing_next_action: 1,
    },
    adaptation_options: [
      {
        key: "rebalance_week",
        title: "Rebalance the week",
        body: "2 overdue tasks and 1 overdue commitment need recovery.",
        surface: "planner",
        prompt: "Help me rebalance this week around the slipped planning blocks.",
        enabled: true,
        priority: 100,
      },
      {
        key: "open_review",
        title: "Open Review",
        body: "4 review cards are due.",
        surface: "review",
        href: "/review",
        enabled: true,
        priority: 80,
      },
      {
        key: "waiting_for_calendar",
        title: "Calendar sync pending",
        body: "Waiting for calendar sync.",
        surface: "planner",
        enabled: false,
        priority: 60,
      },
      {
        key: "hidden_fourth",
        title: "Fourth option stays hidden",
        body: "This should not render.",
        surface: "planner",
        prompt: "This should not render.",
        enabled: true,
        priority: 50,
      },
    ],
    attention_items: [
      {
        key: "overdue_tasks",
        kind: "task_slippage",
        title: "Overdue tasks",
        body: "Open tasks are overdue.",
        surface: "planner",
        href: "/planner",
        priority: 100,
        count: 2,
      },
    ],
    system_health: {
      progress_signal_count: 11,
      slippage_signal_count: 6,
    },
    generated_at: "2026-04-28T09:00:00.000Z",
    ...overrides,
  };
}

export async function routeAssistantToday(page: Page, getSummary: () => Record<string, unknown>): Promise<void> {
  await page.route(`${API_BASE}/v1/surfaces/assistant/today*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getSummary()),
    });
  });
}

export async function routeAssistantWeekly(
  page: Page,
  getSummary: () => Record<string, unknown>,
  options: { status?: number } = {},
): Promise<void> {
  await page.route(`${API_BASE}/v1/surfaces/assistant/weekly*`, async (route) => {
    await route.fulfill({
      status: options.status || 200,
      contentType: "application/json",
      body: JSON.stringify(getSummary()),
    });
  });
}

export async function routeAssistantThread(page: Page, getSnapshot: () => Record<string, unknown>): Promise<void> {
  await page.route(`${API_BASE}/v1/assistant/threads/primary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getSnapshot()),
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

  await page.route(`${API_BASE}/v1/assistant/threads/primary/stream`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": keep-alive\n\n",
    });
  });
}

export function morningFocusInterrupt(status: "pending" | "submitted" = "pending"): Record<string, unknown> {
  return {
    id: "interrupt_morning_focus",
    thread_id: "thr_primary",
    run_id: "run_morning_focus",
    tool_name: "choose_morning_focus",
    interrupt_type: "choice",
    status,
    title: "Choose morning focus",
    body:
      "Pick the focus Starlog should turn into a 90 minute plan. Move project forward is recommended because the deep work window is available now.",
    primary_label: "Confirm focus",
    secondary_label: "Adjust options",
    defer_label: "Later",
    fields: [
      {
        id: "focus_mode",
        kind: "select",
        label: "Focus mode",
        required: true,
        value: "move_project_forward",
        options: [
          {
            label: "Move project forward",
            value: "move_project_forward",
          },
          {
            label: "Clear system friction",
            value: "clear_system_friction",
          },
          {
            label: "Maintain learning",
            value: "maintain_learning",
          },
        ],
      },
      {
        id: "protect_block",
        kind: "toggle",
        label: "Protect this focus block",
        value: true,
      },
    ],
    entity_ref: {
      entity_type: "project",
      entity_id: "project_onboarding",
      href: "/planner?project=project_onboarding",
      title: "Onboarding flow polish",
    },
    consequence_preview: "Planner can reserve 9:30-11:00 AM for focus.",
    resolution:
      status === "submitted"
        ? {
            id: "resolution_morning_focus",
            interrupt_id: "interrupt_morning_focus",
            action: "submit",
            values: { focus_mode: "move_project_forward", client_timezone: "UTC" },
            metadata: {},
            created_at: "2026-04-27T09:06:00.000Z",
          }
        : null,
    created_at: "2026-04-27T09:03:00.000Z",
    resolved_at: status === "submitted" ? "2026-04-27T09:06:00.000Z" : null,
    metadata: {
      concept_surface: "assistant_mobile_morning_focus",
      recommended_option: "move_project_forward",
    },
  };
}

export function plannerConflictInterrupt(status: "pending" | "submitted" = "pending"): Record<string, unknown> {
  return {
    id: "interrupt_planner_conflict",
    thread_id: "thr_primary",
    run_id: "run_planner_conflict",
    tool_name: "resolve_planner_conflict",
    interrupt_type: "choice",
    status,
    title: "Resolve schedule conflict",
    body: "Deep work overlaps with Team Sync from 9:45-10:15 AM. Choose the cleanest resolution.",
    primary_label: "Apply resolution",
    secondary_label: "Open Planner",
    defer_label: "Later",
    fields: [
      {
        id: "resolution",
        kind: "select",
        label: "Resolution",
        required: true,
        value: "move_deep_work",
        options: [
          {
            label: "Move deep work",
            value: "move_deep_work",
          },
          {
            label: "Move team sync",
            value: "move_team_sync",
          },
          {
            label: "Shorten deep work",
            value: "shorten_deep_work",
          },
        ],
      },
      {
        id: "notify_participants",
        kind: "toggle",
        label: "Notify participants",
        value: true,
      },
    ],
    entity_ref: {
      entity_type: "planner_conflict",
      entity_id: "conflict_team_sync",
      href: "/planner?conflict=conflict_team_sync",
      title: "Team Sync conflict",
    },
    consequence_preview: "Starlog can move deep work to 10:30 AM and keep the Team Sync unchanged.",
    resolution:
      status === "submitted"
        ? {
            id: "resolution_planner_conflict",
            interrupt_id: "interrupt_planner_conflict",
            action: "submit",
            values: { resolution: "move_deep_work", client_timezone: "UTC" },
            metadata: {},
            created_at: "2026-04-27T09:22:00.000Z",
          }
        : null,
    created_at: "2026-04-27T09:18:00.000Z",
    resolved_at: status === "submitted" ? "2026-04-27T09:22:00.000Z" : null,
    metadata: {
      concept_surface: "assistant_mobile_schedule_conflict",
      conflict_window: "09:45-10:15",
    },
  };
}
