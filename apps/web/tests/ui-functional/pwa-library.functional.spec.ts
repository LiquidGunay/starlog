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
      preview: "Raw article body with source formatting and captured quote: focus is a narrow aperture.",
      character_count: 86,
      mime_type: "text/html",
      checksum_sha256: "raw-focus-checksum",
      source_filename: "focus-fallacy.html",
    },
    {
      layer: "normalized",
      present: true,
      preview: "Normalized clean text preserves paragraphs and removes page chrome.",
      character_count: 62,
      mime_type: "text/plain",
      checksum_sha256: null,
      source_filename: null,
    },
    {
      layer: "extracted",
      present: true,
      preview: "Key ideas: attention residue, single active objective, capture-to-task loop.",
      character_count: 74,
      mime_type: "text/plain",
      checksum_sha256: null,
      source_filename: null,
    },
  ],
  connections: {
    summary_version_count: 2,
    latest_summary: {
      id: "sum_focus_2",
      version: 2,
      provider: "test",
      created_at: "2026-04-27T10:18:00.000Z",
      preview: "Generated summary stays attached to the source capture and explains that multitasking fragments attention.",
      character_count: 101,
    },
    card_count: 3,
    card_set_version_count: 1,
    task_count: 1,
    note_count: 1,
    notes: [
      {
        id: "note_attention",
        title: "Attention operating notes",
        version: 3,
      },
    ],
    relation_count: 1,
    relations: [
      {
        id: "rel_focus_summary",
        artifact_id: "art_capture_focus",
        relation_type: "artifact.summary_version",
        target_type: "summary_version",
        target_id: "sum_focus_2",
        created_at: "2026-04-27T10:18:00.000Z",
      },
    ],
    action_run_count: 2,
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
    {
      kind: "summary.version_created",
      label: "Summary v2 created",
      occurred_at: "2026-04-27T10:18:00.000Z",
      entity_type: "summary_version",
      entity_id: "sum_focus_2",
      status: null,
    },
    {
      kind: "action.summarize",
      label: "Summarize action",
      occurred_at: "2026-04-27T10:19:00.000Z",
      entity_type: "action_run",
      entity_id: "act_focus_summary",
      status: "completed",
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
    {
      action: "cards",
      label: "Make cards",
      enabled: true,
      method: "POST",
      endpoint: "/v1/artifacts/art_capture_focus/actions",
      disabled_reason: null,
    },
    {
      action: "tasks",
      label: "Make tasks",
      enabled: true,
      method: "POST",
      endpoint: "/v1/artifacts/art_capture_focus/actions",
      disabled_reason: null,
    },
    {
      action: "append_note",
      label: "Append note",
      enabled: true,
      method: "POST",
      endpoint: "/v1/artifacts/art_capture_focus/actions",
      disabled_reason: null,
    },
    {
      action: "archive",
      label: "Archive",
      enabled: false,
      method: null,
      endpoint: null,
      disabled_reason: "Archive is not supported by the artifact action backend yet.",
    },
    {
      action: "link",
      label: "Link",
      enabled: false,
      method: null,
      endpoint: null,
      disabled_reason: "Manual artifact linking is not supported by the artifact action backend yet.",
    },
  ],
};

test("PWA library renders the capture pipeline with mocked API data", async ({ page }) => {
  await seedAssistantSession(page);
  const actionRequests: Array<Record<string, unknown>> = [];
  const assistantEvents: Array<Record<string, unknown>> = [];

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

  await page.route(`${API_BASE}/v1/assistant/threads/primary/events`, async (route) => {
    assistantEvents.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "event_library_cards" }),
    });
  });

  await page.goto("/library", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Starlog Library" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Library sections" })).toContainText("Inbox");
  await expect(page.getByRole("navigation", { name: "Library sections" })).toContainText("Artifacts");
  await expect(page.getByRole("navigation", { name: "Library sections" })).toContainText("Notes");
  await expect(page.getByRole("navigation", { name: "Library sections" })).toContainText("Sources");
  await expect(page.getByText("capture to classify to process to link to review/use pipeline")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox / Unprocessed captures" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent artifacts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notes & saved items" })).toBeVisible();
  await expect(page.getByText("Linked/generated outputs")).toBeVisible();
  await expect(page.getByText(/observatory|runtime/i)).toHaveCount(0);

  const inboxSection = page.getByRole("region", { name: "Inbox / Unprocessed captures" });
  const artifactsSection = page.getByRole("region", { name: "Recent artifacts" });
  const notesSection = page.getByRole("region", { name: "Notes & saved items" });
  const focusCapture = inboxSection.locator("article", { hasText: "The Focus Fallacy" });

  await expect(page.getByLabel("Library stats").getByText("2", { exact: true }).first()).toBeVisible();
  await expect(focusCapture.getByRole("heading", { name: "The Focus Fallacy" })).toBeVisible();
  await expect(focusCapture.getByText("Browser Clipper")).toBeVisible();
  await expect(focusCapture.getByText("Web Clip")).toBeVisible();
  await expect(focusCapture.getByText("Unprocessed")).toBeVisible();
  await expect(focusCapture.getByText("0 linked")).toBeVisible();

  await expect(artifactsSection.getByRole("heading", { name: "Focus Fallacy summary" })).toBeVisible();
  await expect(artifactsSection.getByRole("heading", { name: "The Focus Fallacy", exact: true })).toHaveCount(0);
  await expect(artifactsSection.getByRole("heading", { name: "Walk reflection", exact: true })).toHaveCount(0);
  await expect(artifactsSection.getByText("Generated").first()).toBeVisible();
  await expect(notesSection.getByRole("heading", { name: "Attention operating notes" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await expect(page.getByText("Need attention", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick decisions")).toBeVisible();
  await expect(page.getByText("Ready to process")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent sources" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Suggestions" })).toBeVisible();

  await page.screenshot({ path: `${screenshotDir}/pwa-library-main.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Starlog Library" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Library sections" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make cards" }).first()).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/pwa-library-main-mobile.png`, fullPage: true });
  await expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(await page.getByTestId("library-surface").evaluate((surface) => {
    const rect = surface.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
  })).toBe(true);

  await page.getByRole("button", { name: "Make cards" }).first().click();
  expect(actionRequests).toEqual([expect.objectContaining({ action: "cards" })]);
  await expect.poll(() => assistantEvents).toEqual([
    expect.objectContaining({
      source_surface: "library",
      kind: "artifact.summarized",
      entity_ref: {
        entity_type: "artifact",
        entity_id: "art_capture_focus",
        href: "/library/captures/art_capture_focus",
        title: "The Focus Fallacy",
      },
      payload: expect.objectContaining({
        artifact_id: "art_capture_focus",
        artifact_title: "The Focus Fallacy",
        action: "cards",
        result_status: "completed",
        status: "completed",
        output_ref: "cards-1",
        body: "The Focus Fallacy produced review-card output from Library.",
        metadata: expect.objectContaining({
          ambient_only: true,
          output_ref: "cards-1",
          event_kind_policy: "No supported review-card-created event kind exists; Library uses artifact.summarized for card generation.",
        }),
      }),
      visibility: "ambient",
    }),
  ]);
  await expect(page.locator("[aria-live='polite']")).toHaveText("Make cards completed for The Focus Fallacy");
  await expect(focusCapture.getByRole("button", { name: "Link to project" })).toBeDisabled();
  await expect(notesSection.getByRole("button", { name: "Summarize" })).toBeDisabled();

  await page.getByLabel("Search Library").fill("walk");
  await expect(inboxSection.getByRole("heading", { name: "Walk reflection" })).toBeVisible();
  await expect(inboxSection.getByRole("heading", { name: "The Focus Fallacy" })).toHaveCount(0);
});

test("PWA library queues offline artifact actions without emitting assistant events immediately", async ({ context, page }) => {
  await seedAssistantSession(page);
  const actionRequests: Array<Record<string, unknown>> = [];
  const assistantEvents: Array<Record<string, unknown>> = [];

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

  await page.route(`${API_BASE}/v1/assistant/threads/primary/events`, async (route) => {
    assistantEvents.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "event_library_cards" }),
    });
  });

  await page.goto("/library", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Starlog Library" })).toBeVisible();
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => window.navigator.onLine)).toBe(false);

  await page.getByRole("button", { name: "Make cards" }).first().click();

  await expect(page.locator("[aria-live='polite']")).toHaveText("Make cards queued for replay on The Focus Fallacy");
  expect(actionRequests).toEqual([]);
  expect(assistantEvents).toEqual([]);

  await context.setOffline(false);
});

test("PWA library keeps artifact action success visible when assistant event sync fails", async ({ page }) => {
  await seedAssistantSession(page);
  const actionRequests: Array<Record<string, unknown>> = [];
  const assistantEvents: Array<Record<string, unknown>> = [];

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
        action: "summarize",
        status: "completed",
        output_ref: "summary-2",
      }),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/events`, async (route) => {
    assistantEvents.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Assistant event sync unavailable" }),
    });
  });

  await page.goto("/library", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Starlog Library" })).toBeVisible();

  await page.getByRole("button", { name: "Summarize" }).first().click();

  expect(actionRequests).toEqual([expect.objectContaining({ action: "summarize" })]);
  await expect.poll(() => assistantEvents).toEqual([
    expect.objectContaining({
      source_surface: "library",
      kind: "artifact.summarized",
      payload: expect.objectContaining({
        action: "summarize",
        output_ref: "summary-2",
      }),
      visibility: "ambient",
    }),
  ]);
  await expect(page.locator("[aria-live='polite']")).toHaveText("Summarize completed for The Focus Fallacy. Assistant sync failed.");
});

test("PWA library detail renders provenance, layers, connections, and conversion actions", async ({ page }) => {
  await seedAssistantSession(page);
  const actionRequests: Array<Record<string, unknown>> = [];
  const assistantEvents: Array<Record<string, unknown>> = [];

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

  await page.route(`${API_BASE}/v1/artifacts/art_capture_focus/detail`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(focusDetail),
    });
  });

  await page.route(`${API_BASE}/v1/artifacts/art_capture_focus/actions`, async (route) => {
    actionRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        artifact_id: "art_capture_focus",
        action: "summarize",
        status: "completed",
        output_ref: "summary-2",
      }),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/events`, async (route) => {
    assistantEvents.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "event_library_detail_summary" }),
    });
  });

  await page.goto("/library", { waitUntil: "domcontentloaded" });
  const focusDetailLink = page.getByRole("link", { name: "Open Library detail for The Focus Fallacy" }).first();
  await expect(focusDetailLink).toHaveAttribute("href", "/library/captures/art_capture_focus");

  await page.goto("/library/captures/art_capture_focus", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/library\/captures\/art_capture_focus$/);
  await expect(page.getByRole("banner").getByText("Loaded artifact detail")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Starlog Library" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "The Focus Fallacy" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("All captures")).toBeVisible();
  await expect(page.getByText("Capture: The Focus Fallacy")).toBeVisible();
  await expect(page.getByText(/observatory|runtime/i)).toHaveCount(0);
  const detailSection = page.getByRole("region", { name: "Artifact detail" });
  await expect(detailSection).toBeVisible();
  await expect(detailSection.getByText("Generated summary stays attached to the source capture")).toBeVisible();
  await expect(detailSection.getByText("Summary v2 · test")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Source and provenance" })).toBeVisible();
  await expect(page.getByText("Browser Clipper").first()).toBeVisible();
  await expect(page.getByText("manual clip")).toBeVisible();
  await expect(page.getByText("focus-fallacy.html").first()).toBeVisible();
  await expect(page.getByText("1 tasks / 3 review cards")).toBeVisible();
  await expect(page.getByText("Raw / normalized / extracted")).toBeVisible();

  const layerSection = page.getByRole("region", { name: "Raw, normalized, and extracted layers" });
  await expect(layerSection).toBeVisible();
  await expect(layerSection.getByText("Raw article body with source formatting")).toBeVisible();
  await expect(layerSection.getByText("Normalized clean text preserves paragraphs")).toBeVisible();
  await expect(layerSection.getByText("Key ideas: attention residue")).toBeVisible();

  const extractedSection = page.getByRole("region", { name: "Highlights and key ideas" });
  await expect(extractedSection).toBeVisible();
  await expect(extractedSection.getByText("Extracted source layer")).toBeVisible();
  await expect(extractedSection.getByText("single active objective")).toBeVisible();

  const connectionsSection = page.getByRole("region", { name: "Connections" });
  await expect(connectionsSection).toBeVisible();
  await expect(connectionsSection.getByText("Attention operating notes")).toBeVisible();
  await expect(connectionsSection.getByText("3 review cards", { exact: true })).toBeVisible();
  await expect(connectionsSection.getByText("Summary v2", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity timeline" })).toBeVisible();
  await expect(page.getByText("Artifact created")).toBeVisible();
  await expect(page.getByText("Summary v2 created")).toBeVisible();

  await expect(page.getByRole("button", { name: /Create task/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Append to note/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Extract highlights/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Link to project/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Archive/ })).toBeDisabled();
  await page.screenshot({ path: `${screenshotDir}/pwa-library-artifact-detail.png`, fullPage: true });

  await page.getByRole("button", { name: /Summarize/ }).click();
  expect(actionRequests).toEqual([expect.objectContaining({ action: "summarize" })]);
  await expect.poll(() => assistantEvents).toEqual([
    expect.objectContaining({
      source_surface: "library",
      kind: "artifact.summarized",
      entity_ref: {
        entity_type: "artifact",
        entity_id: "art_capture_focus",
        href: "/library/captures/art_capture_focus",
        title: "The Focus Fallacy",
      },
      payload: expect.objectContaining({
        artifact_id: "art_capture_focus",
        artifact_title: "The Focus Fallacy",
        action: "summarize",
        result_status: "completed",
        status: "completed",
        output_ref: "summary-2",
        body: "The Focus Fallacy was summarized from Library.",
        metadata: expect.objectContaining({
          ambient_only: true,
          output_ref: "summary-2",
        }),
      }),
      visibility: "ambient",
    }),
  ]);
  await expect(page.locator("[aria-live='polite']")).toHaveText("Loaded artifact detail");
  await expect(page.getByRole("button", { name: /Summarize/ })).toContainText("Completed");
});
