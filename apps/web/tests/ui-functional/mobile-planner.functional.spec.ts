import { expect, test } from "@playwright/test";

import { API_BASE, seedAssistantSession } from "./assistant-concept-fixtures";

const plannerSummary = {
  date: "2026-04-28",
  task_buckets: [
    { key: "open_tasks", label: "Open tasks", count: 5 },
    { key: "due_today_tasks", label: "Due today", count: 3 },
    { key: "overdue_tasks", label: "Overdue", count: 1 },
    { key: "unscheduled_tasks", label: "Unscheduled", count: 2 },
  ],
  block_buckets: [
    { key: "fixed_blocks", label: "Fixed blocks", count: 1 },
    { key: "flexible_blocks", label: "Flexible blocks", count: 1 },
    { key: "focus_blocks", label: "Focus blocks", count: 1 },
    { key: "buffer_blocks", label: "Buffer blocks", count: 1 },
  ],
  calendar_event_count: 1,
  conflict_count: 1,
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

const oauthStatus = {
  connected: true,
  mode: "oauth",
  source: "google",
  expires_at: "2026-04-28T12:00:00.000Z",
  has_refresh_token: true,
  detail: "Google Calendar is connected.",
};

function assistantDraftHref(draft: string): string {
  return `/assistant?draft=${encodeURIComponent(draft)}`;
}

const expectedPlannerDraftHref = assistantDraftHref(
  "Review my plan for 2026-04-28: 5 open tasks, 3 due today, 1 overdue, 2 unscheduled, 1 calendar commitment, 1 conflict, 90 focus minutes, and 30 buffer minutes. Check today's blocks, open tasks, conflicts, and unscheduled tasks, then propose the next bounded move.",
);

const expectedSummaryConflictDraftHref = assistantDraftHref(
  "Inspect the planner conflicts for 2026-04-28. There is 1 planner conflict not shown as calendar sync repairs. Propose clear repair options and the safest next step.",
);

test("mobile planner exposes action-oriented Assistant handoff drafts", async ({ page }) => {
  await seedAssistantSession(page);

  await page.route(`${API_BASE}/v1/surfaces/planner/summary?date=**`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plannerSummary) });
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

  await expect(page.getByRole("link", { name: "Review plan in Assistant" })).toHaveAttribute("href", expectedPlannerDraftHref);
  await expect(page.getByLabel("Conflict repair").getByRole("link", { name: "Review conflicts in Assistant" })).toHaveAttribute(
    "href",
    expectedSummaryConflictDraftHref,
  );

  await page.screenshot({ path: "artifacts/ui-functional/mobile-planner-assistant-handoff.png", fullPage: true });
});
