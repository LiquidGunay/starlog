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

export function assistantThreadActivitySnapshot(overrides: SnapshotOverrides = {}): Record<string, unknown> {
  return assistantThreadSnapshot({
    last_message_at: "2026-04-28T09:12:00.000Z",
    last_preview_text: "I checked Planner and Review, then created the task.",
    messages: [
      {
        id: "msg_user_activity",
        thread_id: "thr_primary",
        run_id: null,
        role: "user",
        status: "complete",
        parts: [{ type: "text", id: "part_user_activity", text: "Turn the launch polish note into the next task." }],
        metadata: {},
        created_at: "2026-04-28T09:10:00.000Z",
        updated_at: "2026-04-28T09:10:00.000Z",
      },
      {
        id: "msg_assistant_activity",
        thread_id: "thr_primary",
        run_id: "run_activity",
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "text",
            id: "part_activity_intro",
            text: "I found the current launch context and added the next concrete task.",
          },
          {
            type: "tool_call",
            id: "part_tool_call_planner",
            tool_call: {
              id: "tool_call_planner",
              tool_name: "search_planner",
              tool_kind: "domain_tool",
              status: "complete",
              arguments: { query: "launch polish", include_completed: false },
              title: null,
              metadata: { trace_id: "trace_planner" },
            },
          },
          {
            type: "tool_result",
            id: "part_tool_result_planner",
            tool_result: {
              id: "tool_result_planner",
              tool_call_id: "tool_call_planner",
              status: "complete",
              output: { task_count: 2, project: "Android release prep" },
              entity_ref: { entity_type: "project", entity_id: "project_android_release", href: "/planner", title: "Android release prep" },
              metadata: { tool_name: "search_planner" },
            },
          },
          {
            type: "status",
            id: "part_status_review",
            status: "running",
            label: "Checked Review",
          },
          {
            type: "tool_call",
            id: "part_tool_call_create_task",
            tool_call: {
              id: "tool_call_create_task",
              tool_name: "create_task",
              tool_kind: "domain_tool",
              status: "complete",
              arguments: { title: "Polish Android launch preview", surface: "planner" },
              title: null,
              metadata: { trace_id: "trace_create_task" },
            },
          },
          {
            type: "tool_result",
            id: "part_tool_result_create_task",
            tool_result: {
              id: "tool_result_create_task",
              tool_call_id: "tool_call_create_task",
              status: "complete",
              output: {
                task_id: "task_launch_polish",
                due_at: "2026-04-28T17:00:00.000Z",
                checklist: [
                  { label: "Review mobile screenshots", owner: "assistant" },
                  { label: "Confirm preview handoff", owner: "user" },
                ],
              },
              card: {
                kind: "task_list",
                version: 1,
                title: "Launch polish next task",
                body: "Polish Android launch preview is ready in Planner.",
                entity_ref: {
                  entity_type: "task",
                  entity_id: "task_launch_polish",
                  href: "/planner?task=task_launch_polish",
                  title: "Polish Android launch preview",
                },
                actions: [
                  {
                    id: "open_task",
                    label: "Open task",
                    kind: "navigation",
                    href: "/planner?task=task_launch_polish",
                    style: "primary",
                  },
                ],
                metadata: { task_count: 1 },
              },
              entity_ref: { entity_type: "task", entity_id: "task_launch_polish", href: "/planner?task=task_launch_polish", title: "Polish Android launch preview" },
              metadata: { tool_name: "create_task" },
            },
          },
          {
            type: "text",
            id: "part_activity_outro",
            text: "The task is now attached to Android release prep so today's plan has a clear next move.",
          },
        ],
        metadata: {},
        created_at: "2026-04-28T09:12:00.000Z",
        updated_at: "2026-04-28T09:12:00.000Z",
      },
    ],
    ...overrides,
  });
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
    body: "Choose the cleanest resolution without opening a full calendar.",
    primary_label: "Apply choice",
    secondary_label: "Open planner",
    defer_label: null,
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
            label: "Shorten block",
            value: "shorten_deep_work",
          },
          {
            label: "Keep both",
            value: "keep_both",
          },
        ],
      },
    ],
    entity_ref: {
      entity_type: "planner_conflict",
      entity_id: "conflict_team_sync",
      href: "/planner?conflict=conflict_team_sync",
      title: "Team Sync conflict",
    },
    consequence_preview: "Moves deep work to 2:15 - 3:45 PM and preserves 90m focus.",
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
      conflict_payload: {
        local_title: "Deep work block",
        local_start_label: "9:30 AM",
        local_end_label: "11:00 AM",
        conflict_label: "Conflict",
        overlap_time_label: "9:45 - 10:15 AM",
        remote_title: "Team sync",
        remote_time_label: "9:45 - 10:15 AM",
        recommended_repair: "Move deep work",
        target_slot: "2:15 - 3:45 PM",
      },
      option_descriptions: {
        move_deep_work: "Recommended - preserves your longer focus block.",
        shorten_deep_work: "Keep both, but reduce protected time.",
        keep_both: "Mark deep work flexible and decide later.",
      },
    },
  };
}

export function taskDetailInterrupt(status: "pending" | "submitted" = "pending"): Record<string, unknown> {
  return {
    id: "interrupt_task_detail",
    thread_id: "thr_primary",
    run_id: "run_task_detail",
    tool_name: "request_due_date",
    interrupt_type: "form",
    status,
    title: "Finish task details",
    body: "Add the missing timing so Starlog can create the task.",
    primary_label: "Create task",
    secondary_label: "Save without date",
    defer_label: "Later",
    fields: [
      {
        id: "due_date",
        kind: "date",
        label: "Due date",
        required: true,
        value: "2026-04-28",
      },
      {
        id: "priority",
        kind: "priority",
        label: "Priority",
        value: 1,
        min: 1,
        max: 3,
        options: [
          { label: "High", value: "1" },
          { label: "Medium", value: "2" },
          { label: "Low", value: "3" },
        ],
      },
      {
        id: "create_time_block",
        kind: "toggle",
        label: "Create 45m focus block",
        value: true,
      },
    ],
    entity_ref: {
      entity_type: "task",
      entity_id: "task_onboarding_polish",
      href: "/planner?task=task_onboarding_polish",
      title: "Finish onboarding flow polish",
    },
    consequence_preview: "Blocks 9:30-10:15 AM for deep work and keeps the task visible in Planner.",
    resolution:
      status === "submitted"
        ? {
            id: "resolution_task_detail",
            interrupt_id: "interrupt_task_detail",
            action: "submit",
            values: { due_date: "2026-04-28", priority: "1", create_time_block: true, client_timezone: "UTC" },
            metadata: {},
            created_at: "2026-04-28T09:14:00.000Z",
          }
        : null,
    created_at: "2026-04-28T09:12:00.000Z",
    resolved_at: status === "submitted" ? "2026-04-28T09:14:00.000Z" : null,
    metadata: {
      task_title: "Finish onboarding flow polish",
      task_detail: "Needs due date and priority before Starlog creates it.",
    },
  };
}

export function captureTriageInterrupt(status: "pending" | "submitted" = "pending"): Record<string, unknown> {
  return {
    id: "interrupt_capture_triage",
    thread_id: "thr_primary",
    run_id: "run_capture_triage",
    tool_name: "triage_capture",
    interrupt_type: "form",
    status,
    title: "Triage this capture",
    body: "Classify the capture and choose the next step.",
    primary_label: "Save triage",
    secondary_label: "Open Library",
    defer_label: "Later",
    fields: [
      {
        id: "capture_kind",
        kind: "select",
        label: "Classify this item",
        required: true,
        value: "reference",
        options: [
          { label: "Reference", value: "reference" },
          { label: "Idea", value: "idea" },
          { label: "Task", value: "task" },
          { label: "Review material", value: "review_material" },
          { label: "Project input", value: "project_input" },
        ],
      },
      {
        id: "next_step",
        kind: "select",
        label: "Next step",
        required: true,
        value: "summarize",
        options: [
          { label: "Summarize", value: "summarize" },
          { label: "Make cards", value: "cards" },
          { label: "Create task", value: "task" },
          { label: "Append to note", value: "append_note" },
        ],
      },
    ],
    entity_ref: {
      entity_type: "artifact",
      entity_id: "artifact_inline_suggestions",
      href: "/library?artifact=artifact_inline_suggestions",
      title: "Design idea: inline AI suggestions in the editor",
    },
    consequence_preview: "Summarizes the idea, extracts key points, and saves a note in Library.",
    resolution:
      status === "submitted"
        ? {
            id: "resolution_capture_triage",
            interrupt_id: "interrupt_capture_triage",
            action: "submit",
            values: { capture_kind: "reference", next_step: "summarize", client_timezone: "UTC" },
            metadata: {},
            created_at: "2026-04-28T09:20:00.000Z",
          }
        : null,
    created_at: "2026-04-28T09:18:00.000Z",
    resolved_at: status === "submitted" ? "2026-04-28T09:20:00.000Z" : null,
    metadata: {
      capture_title: "Design idea: inline AI suggestions in the editor",
      snippet: "Use inline suggestions to keep drafting flow intact while preserving source fidelity.",
      source_label: "Chrome - starlog idea doc",
      captured_at_label: "9:12 AM",
    },
  };
}

export function reviewGradeInterrupt(status: "pending" | "submitted" = "pending"): Record<string, unknown> {
  return {
    id: "interrupt_review_grade",
    thread_id: "thr_primary",
    run_id: "run_review_grade",
    tool_name: "grade_review_recall",
    interrupt_type: "form",
    status,
    title: "Grade this review",
    body: "You are missing application, not recall.",
    primary_label: "Save grade",
    secondary_label: "Keep in Review",
    defer_label: "Later",
    fields: [
      {
        id: "grade",
        kind: "select",
        label: "Grade",
        required: true,
        value: "3",
        options: [
          { label: "Again", value: "1" },
          { label: "Hard", value: "3" },
          { label: "Good", value: "4" },
          { label: "Easy", value: "5" },
        ],
      },
      {
        id: "support_action",
        kind: "select",
        label: "Support action",
        required: false,
        value: "",
        options: [
          { label: "Show worked example", value: "worked_example" },
          { label: "Switch to explanation", value: "explanation" },
        ],
      },
    ],
    entity_ref: {
      entity_type: "review_item",
      entity_id: "review_feature_flag_perf",
      href: "/review?item=review_feature_flag_perf",
      title: "Feature flag degradation",
    },
    consequence_preview: "Updates the review interval and keeps the card in the right queue.",
    resolution:
      status === "submitted"
        ? {
            id: "resolution_review_grade",
            interrupt_id: "interrupt_review_grade",
            action: "submit",
            values: { grade: "3", client_timezone: "UTC" },
            metadata: {},
            created_at: "2026-04-28T10:11:00.000Z",
          }
        : null,
    created_at: "2026-04-28T10:10:00.000Z",
    resolved_at: status === "submitted" ? "2026-04-28T10:11:00.000Z" : null,
    metadata: {
      prompt: "What's the most effective action when a feature flag causes performance degradation in production?",
      insight: "You are missing application, not recall.",
    },
  };
}

export function scheduleClarificationInterrupt(status: "pending" | "submitted" = "pending"): Record<string, unknown> {
  return {
    id: "interrupt_schedule_clarify",
    thread_id: "thr_primary",
    run_id: "run_schedule_clarify",
    tool_name: "clarify_schedule_time",
    interrupt_type: "form",
    status,
    title: "What time should I schedule this?",
    body: "I only need the start time before creating the block.",
    primary_label: "Confirm time",
    secondary_label: "Not now",
    defer_label: "Later",
    fields: [
      {
        id: "scheduled_time",
        kind: "select",
        label: "Schedule time",
        required: true,
        value: "09:30",
        options: [
          { label: "9:30 AM", value: "09:30" },
          { label: "10:00 AM", value: "10:00" },
          { label: "10:30 AM", value: "10:30" },
          { label: "11:00 AM", value: "11:00" },
          { label: "Pick custom time", value: "custom" },
        ],
      },
      {
        id: "reuse_for_similar_blocks",
        kind: "toggle",
        label: "Use this time for similar blocks",
        value: true,
      },
    ],
    consequence_preview: "Creates the block at the selected time without opening Planner.",
    resolution:
      status === "submitted"
        ? {
            id: "resolution_schedule_clarify",
            interrupt_id: "interrupt_schedule_clarify",
            action: "submit",
            values: { scheduled_time: "09:30", reuse_for_similar_blocks: true, client_timezone: "UTC" },
            metadata: {},
            created_at: "2026-04-28T10:20:00.000Z",
          }
        : null,
    created_at: "2026-04-28T10:18:00.000Z",
    resolved_at: status === "submitted" ? "2026-04-28T10:20:00.000Z" : null,
    metadata: {
      question: "What time should I schedule this?",
      detail: "One missing detail.",
    },
  };
}

export function deferRecommendationInterrupt(status: "pending" | "submitted" = "pending"): Record<string, unknown> {
  return {
    id: "interrupt_defer_recommendation",
    thread_id: "thr_primary",
    run_id: "run_defer_recommendation",
    tool_name: "defer_recommendation",
    interrupt_type: "choice",
    status,
    title: "Remind me later",
    body: "Choose when this should come back.",
    primary_label: "Set reminder",
    secondary_label: "No thanks, keep it in view",
    defer_label: "No thanks, keep it in view",
    fields: [
      {
        id: "remind_at",
        kind: "select",
        label: "Reminder",
        required: true,
        value: "in_1_hour",
        options: [
          { label: "In 1 hour", value: "in_1_hour" },
          { label: "This evening", value: "this_evening" },
          { label: "Tomorrow morning", value: "tomorrow_morning" },
          { label: "No thanks, keep it in view", value: "keep_in_view" },
        ],
      },
    ],
    consequence_preview: "Keeps momentum without nagging.",
    resolution:
      status === "submitted"
        ? {
            id: "resolution_defer_recommendation",
            interrupt_id: "interrupt_defer_recommendation",
            action: "submit",
            values: { remind_at: "tomorrow_morning", client_timezone: "UTC" },
            metadata: {},
            created_at: "2026-04-28T10:30:00.000Z",
          }
        : null,
    created_at: "2026-04-28T10:28:00.000Z",
    resolved_at: status === "submitted" ? "2026-04-28T10:30:00.000Z" : null,
    metadata: {},
  };
}

export function projectPickerInterrupt(status: "pending" | "submitted" = "pending"): Record<string, unknown> {
  return {
    id: "interrupt_project_picker",
    thread_id: "thr_primary",
    run_id: "run_project_picker",
    tool_name: "link_capture_project",
    interrupt_type: "form",
    status,
    title: "Link to project",
    body: "This capture looks related to active work.",
    primary_label: "Link item",
    secondary_label: "Open Library",
    defer_label: "Later",
    fields: [
      {
        id: "project_id",
        kind: "entity_search",
        label: "Suggested projects",
        required: true,
        value: "project_assistant_v2",
        options: [
          { label: "Assistant v2.0 launch", value: "project_assistant_v2" },
          { label: "AI suggestions engine", value: "project_ai_suggestions" },
          { label: "Onboarding experience", value: "project_onboarding" },
          { label: "Analytics revamp", value: "project_analytics" },
        ],
      },
    ],
    entity_ref: {
      entity_type: "artifact",
      entity_id: "artifact_inline_suggestions",
      href: "/library?artifact=artifact_inline_suggestions",
      title: "Design idea: inline AI suggestions in the editor",
    },
    consequence_preview: "Links this capture to the selected project and keeps provenance intact.",
    resolution:
      status === "submitted"
        ? {
            id: "resolution_project_picker",
            interrupt_id: "interrupt_project_picker",
            action: "submit",
            values: { project_id: "project_ai_suggestions", client_timezone: "UTC" },
            metadata: {},
            created_at: "2026-04-28T10:42:00.000Z",
          }
        : null,
    created_at: "2026-04-28T10:40:00.000Z",
    resolved_at: status === "submitted" ? "2026-04-28T10:42:00.000Z" : null,
    metadata: {
      item_title: "Design idea: inline AI suggestions in the editor",
    },
  };
}
