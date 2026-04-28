import { expect, test } from "@playwright/test";

import { API_BASE, seedAssistantSession } from "./assistant-concept-fixtures";

const plannerSummary = {
  date: "2026-04-28",
  task_buckets: [
    { key: "open_tasks", label: "Open tasks", count: 5 },
    { key: "in_progress_tasks", label: "In progress", count: 2 },
    { key: "due_today_tasks", label: "Due today", count: 3 },
    { key: "overdue_tasks", label: "Overdue", count: 1 },
    { key: "unscheduled_tasks", label: "Unscheduled", count: 2 },
  ],
  block_buckets: [
    { key: "fixed_blocks", label: "Fixed blocks", count: 2 },
    { key: "flexible_blocks", label: "Flexible blocks", count: 2 },
    { key: "focus_blocks", label: "Focus blocks", count: 1 },
    { key: "buffer_blocks", label: "Buffer blocks", count: 1 },
  ],
  calendar_event_count: 1,
  conflict_count: 3,
  focus_minutes: 90,
  buffer_minutes: 30,
  generated_at: "2026-04-28T08:30:00.000Z",
};

const blocks = [
  {
    id: "blk_focus",
    task_id: "tsk_focus",
    title: "Deep work on onboarding",
    starts_at: "2026-04-28T09:00:00+00:00",
    ends_at: "2026-04-28T10:30:00+00:00",
    locked: false,
    created_at: "2026-04-28T08:00:00+00:00",
  },
  {
    id: "blk_buffer",
    task_id: null,
    title: "Buffer and notes",
    starts_at: "2026-04-28T11:00:00+00:00",
    ends_at: "2026-04-28T11:30:00+00:00",
    locked: false,
    created_at: "2026-04-28T08:00:00+00:00",
  },
  {
    id: "blk_flexible",
    task_id: null,
    title: "Flexible admin",
    starts_at: "2026-04-28T13:00:00+00:00",
    ends_at: "2026-04-28T14:00:00+00:00",
    locked: false,
    created_at: "2026-04-28T08:00:00+00:00",
  },
];

const events = [
  {
    id: "evt_team_sync",
    title: "Team Sync",
    starts_at: "2026-04-28T10:00:00+00:00",
    ends_at: "2026-04-28T10:30:00+00:00",
    source: "google",
  },
];

const conflict = {
  id: "conflict_team_sync",
  remote_id: "google_evt_team_sync",
  strategy: "overlap_detected",
  detail: {
    title: "Team Sync overlaps deep work",
    reason: "Move or shorten the focus block before syncing.",
    time_range: "10:00 AM - 10:30 AM",
    severity: "High",
    suggested_repair: "Move deep work to 10:30 AM and keep Team Sync fixed.",
  },
  resolved: false,
  resolved_at: null,
  resolution_strategy: null,
};

const secondConflict = {
  id: "conflict_lunch",
  remote_id: "google_evt_lunch",
  strategy: "remote_changed",
  detail: {
    title: "Lunch moved over admin block",
    reason: "Google moved the lunch event into flexible admin time.",
    time_range: "1:00 PM - 2:00 PM",
    severity: "Medium",
    suggested_repair: "Use Google for lunch and move flexible admin later.",
  },
  resolved: false,
  resolved_at: null,
  resolution_strategy: null,
};

const oauthStatus = {
  connected: true,
  mode: "oauth",
  source: "google",
  expires_at: "2026-04-28T12:00:00.000Z",
  has_refresh_token: true,
  detail: "Google Calendar is connected.",
};

test("PWA planner renders execution summary and conflict repair with mocked API data", async ({ page }) => {
  await seedAssistantSession(page);
  const resolutions: Array<Record<string, unknown>> = [];

  await page.route(`${API_BASE}/v1/surfaces/planner/summary?date=**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(plannerSummary),
    });
  });

  await page.route(`${API_BASE}/v1/planning/blocks/**`, async (route) => {
    const url = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(url.endsWith("/2026-04-28") ? blocks : []),
    });
  });

  await page.route(`${API_BASE}/v1/calendar/events`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(events) });
  });

  await page.route(`${API_BASE}/v1/calendar/sync/google/oauth/status`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(oauthStatus) });
  });

  await page.route(`${API_BASE}/v1/calendar/sync/google/conflicts`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([conflict, secondConflict]) });
  });

  await page.route(`${API_BASE}/v1/calendar/sync/google/conflicts/*/resolve`, async (route) => {
    const url = route.request().url();
    resolutions.push({
      conflictId: url.split("/conflicts/")[1]?.split("/resolve")[0],
      ...(route.request().postDataJSON() as Record<string, unknown>),
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.route(`${API_BASE}/v1/calendar/sync/google/conflicts/*/replay`, async (route) => {
    const conflictId = route.request().url().split("/conflicts/")[1]?.split("/replay")[0];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sync_run: { run_id: `sync_${conflictId}`, pushed: 0, pulled: 0, conflicts: 1, last_synced_at: "2026-04-28T08:45:00.000Z" },
        conflict,
      }),
    });
  });

  await page.goto("/planner", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Planner date controls").getByLabel("Date").fill("2026-04-28");

  await expect(page.getByRole("heading", { name: /Execution plan for Tue, Apr 28/ })).toBeVisible();
  await expect(page.getByLabel("Planner stats").getByText("90", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Planner stats").getByText("30", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Planner stats").locator("article", { hasText: "Due today" }).getByText("3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Planner stats").getByText("Meetings")).toBeVisible();
  await expect(page.getByLabel("Planner stats").getByText("Conflicts")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Focus, commitments, flexibility, and buffers" })).toBeVisible();
  await expect(page.getByText("Deep work on onboarding").first()).toBeVisible();
  await expect(page.getByText("Team Sync").first()).toBeVisible();
  await expect(page.getByText("Flexible admin").first()).toBeVisible();
  await expect(page.getByText("Buffer and notes").first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "Work grouped by execution role" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Commitments", exact: true }).getByText("Team Sync", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Focus", exact: true }).getByText("Deep work on onboarding")).toBeVisible();
  await expect(page.getByRole("region", { name: "Flexible work", exact: true }).getByText("Flexible admin")).toBeVisible();
  await expect(page.getByRole("region", { name: "Buffer", exact: true }).getByText("Buffer and notes")).toBeVisible();

  const conflictRepair = page.getByLabel("Conflict repair");
  const teamSyncConflict = conflictRepair.getByRole("article", { name: "Conflict google_evt_team_sync" });
  const lunchConflict = conflictRepair.getByRole("article", { name: "Conflict google_evt_lunch" });

  await expect(teamSyncConflict.getByText("Team Sync overlaps deep work")).toBeVisible();
  await expect(teamSyncConflict.getByText("10:00 AM - 10:30 AM")).toBeVisible();
  await expect(teamSyncConflict.getByText("Severity: High")).toBeVisible();
  await expect(teamSyncConflict.getByText("Move deep work to 10:30 AM and keep Team Sync fixed.")).toBeVisible();
  await expect(lunchConflict.getByText("Lunch moved over admin block")).toBeVisible();
  await expect(lunchConflict.getByText("1:00 PM - 2:00 PM")).toBeVisible();
  await expect(conflictRepair.getByText("1 planner conflict needs review outside calendar sync")).toBeVisible();

  await teamSyncConflict.getByRole("button", { name: "Keep Starlog" }).click();
  await lunchConflict.getByRole("button", { name: "Dismiss" }).click();
  expect(resolutions).toEqual([
    expect.objectContaining({ conflictId: "conflict_team_sync", resolution_strategy: "local_wins" }),
    expect.objectContaining({ conflictId: "conflict_lunch", resolution_strategy: "dismiss" }),
  ]);

  await expect(page.getByLabel("Planning request")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stage request" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Assistant", exact: true })).toBeVisible();
});

test("PWA planner shows summary-only conflicts without fake calendar repair actions", async ({ page }) => {
  await seedAssistantSession(page);

  await page.route(`${API_BASE}/v1/surfaces/planner/summary?date=**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...plannerSummary, conflict_count: 1 }),
    });
  });

  await page.route(`${API_BASE}/v1/planning/blocks/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(blocks) });
  });
  await page.route(`${API_BASE}/v1/calendar/events`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(events) });
  });
  await page.route(`${API_BASE}/v1/calendar/sync/google/oauth/status`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(oauthStatus) });
  });
  await page.route(`${API_BASE}/v1/calendar/sync/google/conflicts`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.goto("/planner", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Planner date controls").getByLabel("Date").fill("2026-04-28");

  const conflictRepair = page.getByLabel("Conflict repair");
  await expect(conflictRepair.getByText("1 planner conflict needs review", { exact: true })).toBeVisible();
  await expect(conflictRepair.getByText("These conflicts are not Google sync conflicts, so calendar repair actions are not available here.")).toBeVisible();
  await expect(conflictRepair.getByRole("button", { name: "Keep Starlog" })).toHaveCount(0);
  await expect(conflictRepair.getByRole("button", { name: "Use Google" })).toHaveCount(0);
  await expect(conflictRepair.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
  await expect(conflictRepair.getByRole("button", { name: "Refresh plan" })).toBeVisible();
  await expect(conflictRepair.getByRole("link", { name: "Open Assistant" })).toBeVisible();
});
