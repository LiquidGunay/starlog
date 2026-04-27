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
