import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

import { API_BASE, seedAssistantSession } from "./assistant-concept-fixtures";

const screenshotDir = "artifacts/ui-functional";

test.beforeAll(() => {
  mkdirSync(screenshotDir, { recursive: true });
});

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
    { key: "total_artifacts", label: "Artifacts", count: 2 },
    { key: "unprocessed_artifacts", label: "Unprocessed captures", count: 1 },
    { key: "summarized_artifacts", label: "Summarized", count: 1 },
    { key: "card_ready_artifacts", label: "Cards ready", count: 1 },
  ],
  source_breakdown: [
    { key: "web_clip", label: "Web Clip", count: 1 },
    { key: "summary", label: "Summary", count: 1 },
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
    total: 0,
    recent_count: 0,
    latest_updated_at: null,
  },
  suggested_actions: [
    { action: "summarize", label: "Summarize unprocessed sources", count: 1 },
    { action: "cards", label: "Generate review cards", count: 1 },
  ],
  generated_at: "2026-04-27T10:30:00.000Z",
};

const focusDetail = {
  artifact: {
    id: "art_capture_focus",
    source_type: "web_clip",
    title: "The Focus Fallacy",
    created_at: "2026-04-27T10:15:00.000Z",
    updated_at: "2026-04-27T10:20:00.000Z",
  },
  capture: {
    source_app: "browser_clipper",
    source_type: "web_clip",
    source_url: "https://example.test/focus",
    source_file: "focus-fallacy.html",
    capture_method: "manual clip",
    captured_at: "2026-04-27T10:15:00.000Z",
    tags: ["focus", "attention"],
  },
  source_layers: [
    {
      layer: "raw",
      present: true,
      preview: "Raw source text for mobile Library validation.",
      character_count: 46,
      mime_type: "text/html",
      checksum_sha256: "raw-focus-checksum",
      source_filename: "focus-fallacy.html",
    },
    {
      layer: "normalized",
      present: true,
      preview: "Normalized text preserves the useful reading content.",
      character_count: 53,
      mime_type: "text/plain",
      checksum_sha256: null,
      source_filename: null,
    },
  ],
  connections: {
    summary_version_count: 1,
    latest_summary: {
      id: "sum_focus_1",
      version: 1,
      provider: "test",
      created_at: "2026-04-27T10:18:00.000Z",
      preview: "Generated summary stays attached to the source capture.",
      character_count: 57,
    },
    card_count: 3,
    card_set_version_count: 1,
    task_count: 1,
    note_count: 0,
    notes: [],
    relation_count: 0,
    relations: [],
    action_run_count: 1,
  },
  timeline: [
    {
      kind: "artifact.created",
      label: "Artifact created",
      occurred_at: "2026-04-27T10:15:00.000Z",
      entity_type: "artifact",
      entity_id: "art_capture_focus",
      status: null,
    },
  ],
  suggested_actions: [
    {
      action: "summarize",
      label: "Summarize",
      enabled: true,
      method: "POST",
      endpoint: "/v1/artifacts/art_capture_focus/actions",
      disabled_reason: null,
    },
  ],
};

test("mobile viewport Library main stays compact and keeps artifact detail reachable", async ({ page }) => {
  await seedAssistantSession(page);

  await page.route(`${API_BASE}/v1/surfaces/library/summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(librarySummary) });
  });
  await page.route(`${API_BASE}/v1/artifacts`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(artifacts) });
  });
  await page.route(`${API_BASE}/v1/notes`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`${API_BASE}/v1/artifacts/art_capture_focus/detail`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(focusDetail) });
  });

  await page.goto("/library", { waitUntil: "domcontentloaded" });

  const nav = page.getByRole("navigation", { name: "Library sections" });
  await expect(page.getByRole("heading", { name: "Starlog Library" })).toBeVisible();
  await expect(nav).toContainText("Inbox");
  await expect(nav).toContainText("Artifacts");
  await expect(nav).toContainText("Notes");
  await expect(nav).toContainText("Sources");
  await expect(page.getByRole("heading", { name: "Inbox / Unprocessed captures" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent artifacts" })).toBeVisible();

  await expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(await nav.getByRole("button").evaluateAll((buttons) => {
    const boxes = buttons.map((button) => button.getBoundingClientRect());
    return boxes.every((box, index) => index === 0 || box.left >= boxes[index - 1].right - 1);
  })).toBe(true);

  await page.screenshot({ path: `${screenshotDir}/mobile-library-main.png`, fullPage: true });

  const focusDetailLink = page.getByRole("link", { name: "Open Library detail for The Focus Fallacy" }).first();
  await expect(focusDetailLink).toHaveAttribute("href", "/library/captures/art_capture_focus");
  await focusDetailLink.click();
  await expect(page).toHaveURL(/\/library\/captures\/art_capture_focus$/);
  await expect(page.getByRole("heading", { name: "The Focus Fallacy" })).toBeVisible();
});
