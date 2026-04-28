import { expect, test } from "@playwright/test";

import { API_BASE, seedAssistantSession } from "./assistant-concept-fixtures";

const artifacts = [
  {
    id: "art_capture_focus",
    source_type: "web_clip",
    title: "The Focus Fallacy",
    raw_content: "Captured article text",
    normalized_content: "Captured article text",
    extracted_content: null,
    metadata: {
      capture: {
        capture_source: "browser_clipper",
        source_url: "https://example.test/focus",
        tags: ["focus"],
      },
    },
    created_at: "2026-04-27T10:15:00.000Z",
    updated_at: "2026-04-27T10:15:00.000Z",
  },
  {
    id: "art_capture_voice",
    source_type: "voice_note",
    title: "Walk reflection",
    raw_content: null,
    normalized_content: "Walking note transcript",
    extracted_content: null,
    metadata: {
      capture: {
        capture_source: "mobile_voice",
        tags: [],
      },
    },
    created_at: "2026-04-27T09:40:00.000Z",
    updated_at: "2026-04-27T09:42:00.000Z",
  },
  {
    id: "art_summary_focus",
    source_type: "summary",
    title: "Focus Fallacy summary",
    raw_content: "Original focus source",
    normalized_content: "Original focus source",
    extracted_content: "Summary source",
    metadata: {},
    created_at: "2026-04-26T18:20:00.000Z",
    updated_at: "2026-04-26T18:24:00.000Z",
  },
];

const librarySummary = {
  status_buckets: [
    { key: "total_artifacts", label: "Artifacts", count: 3 },
    { key: "unprocessed_artifacts", label: "Unprocessed captures", count: 2 },
    { key: "summarized_artifacts", label: "Summarized", count: 1 },
    { key: "card_ready_artifacts", label: "Cards ready", count: 1 },
    { key: "task_linked_artifacts", label: "Tasks linked", count: 1 },
    { key: "note_linked_artifacts", label: "Notes linked", count: 1 },
  ],
  source_breakdown: [
    { key: "web_clip", label: "Web Clip", count: 2 },
    { key: "voice_note", label: "Voice Note", count: 1 },
  ],
  recent_artifacts: [
    {
      id: "art_capture_focus",
      title: "The Focus Fallacy",
      source_type: "web_clip",
      created_at: "2026-04-27T10:15:00.000Z",
      updated_at: "2026-04-27T10:15:00.000Z",
      summary_count: 0,
      card_count: 0,
      task_count: 0,
      note_count: 0,
    },
    {
      id: "art_capture_voice",
      title: "Walk reflection",
      source_type: "voice_note",
      created_at: "2026-04-27T09:40:00.000Z",
      updated_at: "2026-04-27T09:42:00.000Z",
      summary_count: 0,
      card_count: 0,
      task_count: 0,
      note_count: 0,
    },
    {
      id: "art_summary_focus",
      title: "Focus Fallacy summary",
      source_type: "summary",
      created_at: "2026-04-26T18:20:00.000Z",
      updated_at: "2026-04-26T18:24:00.000Z",
      summary_count: 1,
      card_count: 3,
      task_count: 1,
      note_count: 1,
    },
  ],
  notes: {
    total: 1,
    recent_count: 1,
    latest_updated_at: "2026-04-27T08:00:00.000Z",
  },
  suggested_actions: [
    { action: "summarize", label: "Summarize unprocessed sources", count: 2 },
    { action: "cards", label: "Generate review cards", count: 2 },
    { action: "tasks", label: "Extract tasks", count: 2 },
    { action: "append_note", label: "Append to notes", count: 2 },
  ],
  generated_at: "2026-04-27T10:30:00.000Z",
};

const notes = [
  {
    id: "note_attention",
    title: "Attention operating notes",
    body_md: "Keep capture processing close to projects, then convert stable insights into cards.",
    version: 3,
    created_at: "2026-04-24T12:00:00.000Z",
    updated_at: "2026-04-27T08:00:00.000Z",
  },
];

test("PWA library renders the capture pipeline with mocked API data", async ({ page }) => {
  await seedAssistantSession(page);
  const actionRequests: Array<Record<string, unknown>> = [];

  await page.route(`${API_BASE}/v1/surfaces/library/summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(librarySummary),
    });
  });

  await page.route(`${API_BASE}/v1/artifacts`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(artifacts),
    });
  });

  await page.route(`${API_BASE}/v1/notes`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(notes),
    });
  });

  await page.route(`${API_BASE}/v1/artifacts/art_capture_focus/actions`, async (route) => {
    actionRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        artifact_id: "art_capture_focus",
        action: "cards",
        status: "completed",
        output_ref: "cards-1",
      }),
    });
  });

  await page.goto("/library", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Capture pipeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unprocessed captures" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent artifacts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notes and saved items" })).toBeVisible();

  const inboxSection = page.getByRole("region", { name: "Unprocessed captures" });
  const artifactsSection = page.getByRole("region", { name: "Recent artifacts" });
  const notesSection = page.getByRole("region", { name: "Notes and saved items" });
  const focusCapture = inboxSection.locator("article", { hasText: "The Focus Fallacy" });

  await expect(page.getByLabel("Library stats").getByText("2", { exact: true }).first()).toBeVisible();
  await expect(focusCapture.getByRole("heading", { name: "The Focus Fallacy" })).toBeVisible();
  await expect(focusCapture.getByText("Browser Clipper")).toBeVisible();
  await expect(focusCapture.getByText("Web Clip")).toBeVisible();
  await expect(focusCapture.getByText("Unprocessed")).toBeVisible();
  await expect(focusCapture.getByText("0 linked")).toBeVisible();

  await expect(artifactsSection.getByRole("heading", { name: "Focus Fallacy summary" })).toBeVisible();
  await expect(artifactsSection.getByText("Generated").first()).toBeVisible();
  await expect(notesSection.getByRole("heading", { name: "Attention operating notes" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Capture types" })).toBeVisible();
  await expect(page.getByText("Where captures came from")).toBeVisible();
  await expect(page.getByText("Next conversions")).toBeVisible();

  await page.getByRole("button", { name: "Make cards" }).first().click();
  expect(actionRequests).toEqual([expect.objectContaining({ action: "cards" })]);
  await expect(page.locator("[aria-live='polite']")).toHaveText("Make cards completed for The Focus Fallacy");
  await expect(focusCapture.getByRole("button", { name: "Link to project" })).toBeDisabled();
  await expect(notesSection.getByRole("button", { name: "Summarize" })).toBeDisabled();

  await page.getByLabel("Search Library").fill("walk");
  await expect(inboxSection.getByRole("heading", { name: "Walk reflection" })).toBeVisible();
  await expect(inboxSection.getByRole("heading", { name: "The Focus Fallacy" })).toHaveCount(0);
});
