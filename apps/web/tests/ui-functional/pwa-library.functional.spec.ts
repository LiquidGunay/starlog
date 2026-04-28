import { expect, test } from "@playwright/test";

import { API_BASE, seedAssistantSession } from "./assistant-concept-fixtures";

const artifacts = [
  {
    id: "art_capture_focus",
    source_type: "web_clip",
    capture_type: "article",
    title: "The Focus Fallacy",
    source: "Browser clipper",
    source_url: "https://example.test/focus",
    created_at: "2026-04-27T10:15:00.000Z",
    updated_at: "2026-04-27T10:15:00.000Z",
    processing_state: "needs_decision",
    linked_project_count: 1,
    linked_note_count: 0,
    linked_task_count: 0,
    linked_card_count: 0,
  },
  {
    id: "art_capture_voice",
    source_type: "voice_note",
    capture_type: "audio",
    title: "Walk reflection",
    source: "Mobile share",
    created_at: "2026-04-27T09:40:00.000Z",
    updated_at: "2026-04-27T09:42:00.000Z",
    processing_state: "ready_to_process",
    linked_project_count: 0,
    linked_note_count: 1,
    linked_task_count: 0,
    linked_card_count: 0,
  },
  {
    id: "art_summary_focus",
    source_type: "summary",
    capture_type: "summary",
    title: "Focus Fallacy summary",
    source: "The Focus Fallacy",
    created_at: "2026-04-26T18:20:00.000Z",
    updated_at: "2026-04-26T18:24:00.000Z",
    processing_state: "generated",
    linked_project_count: 1,
    linked_note_count: 1,
    linked_task_count: 1,
    linked_card_count: 3,
  },
];

const notes = [
  {
    id: "note_attention",
    title: "Attention operating notes",
    body_md: "Keep capture processing close to projects, then convert stable insights into cards.",
    version: 3,
    source: "Starlog",
    source_type: "note",
    created_at: "2026-04-24T12:00:00.000Z",
    updated_at: "2026-04-27T08:00:00.000Z",
    linked_project_count: 2,
  },
];

test("PWA library renders the capture pipeline with mocked API data", async ({ page }) => {
  await seedAssistantSession(page);

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
  await expect(focusCapture.getByText("Browser clipper")).toBeVisible();
  await expect(focusCapture.getByText("Article")).toBeVisible();
  await expect(focusCapture.getByText("Needs Decision")).toBeVisible();
  await expect(focusCapture.getByText("1 linked")).toBeVisible();

  await expect(artifactsSection.getByRole("heading", { name: "Focus Fallacy summary" })).toBeVisible();
  await expect(artifactsSection.getByText("Generated").first()).toBeVisible();
  await expect(notesSection.getByRole("heading", { name: "Attention operating notes" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Capture types" })).toBeVisible();
  await expect(page.getByText("Where captures came from")).toBeVisible();
  await expect(page.getByText("Next conversions")).toBeVisible();

  await page.getByRole("button", { name: "Make cards" }).first().click();
  await expect(page.locator("[aria-live='polite']")).toHaveText("Make cards prepared for The Focus Fallacy");

  await page.getByLabel("Search Library").fill("walk");
  await expect(inboxSection.getByRole("heading", { name: "Walk reflection" })).toBeVisible();
  await expect(inboxSection.getByRole("heading", { name: "The Focus Fallacy" })).toHaveCount(0);
});
