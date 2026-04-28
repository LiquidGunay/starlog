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

const focusDetail = {
  artifact: {
    id: "art_capture_focus",
    title: "The Focus Fallacy",
    artifact_type: "Web clip",
    status: "needs_decision",
    source: "Browser Clipper",
    source_url: "https://example.test/focus",
    captured_at: "2026-04-27T10:15:00.000Z",
    updated_at: "2026-04-27T10:20:00.000Z",
    tags: ["focus", "attention"],
    summary: "Generated summary stays attached to the source capture and explains that multitasking fragments attention.",
    key_ideas: [
      {
        title: "Attention residue drives context switching cost",
        detail: "Use smaller capture-to-task loops before planning deep work.",
        provenance: "Extracted from normalized paragraph 3",
      },
      {
        title: "Protect a single active objective",
        detail: "The source argues against parallel priority lists.",
        provenance: "Extracted from raw article section 2",
      },
    ],
    quick_note: "Compare this with the onboarding focus block.",
  },
  provenance: {
    source_app: "Browser Clipper",
    url: "https://example.test/focus",
    capture_method: "manual clip",
    capture_time: "2026-04-27T10:15:00.000Z",
    captured_by: "Taylor",
    device: "ThinkPad PWA",
    location: "Desk",
    linked_project: "Onboarding flow polish",
    used_in_tasks: "1 task",
    used_in_review: "3 review cards",
  },
  layers: {
    raw: {
      title: "Raw HTML text",
      content: "Raw article body with source formatting and captured quote: focus is a narrow aperture.",
      format: "html",
    },
    normalized: {
      title: "Normalized article text",
      content: "Normalized clean text preserves paragraphs and removes page chrome.",
      format: "text",
    },
    extracted: {
      title: "Extracted ideas",
      content: "Key ideas: attention residue, single active objective, capture-to-task loop.",
      format: "json",
    },
  },
  actions: [
    {
      action: "summarize",
      label: "Summarize",
      description: "Generate concise summary with key points.",
      supported: true,
      status: "ready",
    },
    {
      action: "cards",
      label: "Make cards",
      description: "Create atomic review items.",
      supported: true,
      status: "ready",
    },
    {
      action: "tasks",
      label: "Create task",
      description: "Turn insight into an actionable task.",
      supported: true,
      status: "ready",
    },
    {
      action: "append_note",
      label: "Append to note",
      description: "Add this artifact to an existing note.",
      supported: true,
      status: "ready",
    },
    {
      action: "extract_highlights",
      label: "Extract highlights",
      description: "Find and save key quotes or passages.",
      supported: false,
      disabled_reason: "Highlight extraction is not enabled.",
    },
  ],
  connections: [
    {
      id: "project_onboarding",
      kind: "project",
      title: "Onboarding flow polish",
      href: "/planner?project=project_onboarding",
      detail: "Used as research context.",
    },
    {
      id: "note_attention",
      kind: "note",
      title: "Attention operating notes",
      detail: "Summary appended as version 3.",
    },
    {
      id: "review_focus_cards",
      kind: "review",
      title: "Focus review cards",
      detail: "3 cards generated.",
    },
  ],
  activity: [
    {
      id: "capture",
      label: "Captured from browser",
      detail: "Browser clipper saved raw and normalized layers.",
      actor: "Taylor",
      created_at: "2026-04-27T10:15:00.000Z",
    },
    {
      id: "summary",
      label: "Summary generated",
      detail: "OpenAI-primary summarization created the current summary.",
      actor: "Starlog",
      created_at: "2026-04-27T10:18:00.000Z",
    },
  ],
};

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

test("PWA library detail renders provenance, layers, connections, and conversion actions", async ({ page }) => {
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

  await page.goto("/library", { waitUntil: "domcontentloaded" });
  const focusDetailLink = page.getByRole("link", { name: "Open Library detail for The Focus Fallacy" }).first();
  await expect(focusDetailLink).toHaveAttribute("href", "/library/captures/art_capture_focus");

  await page.goto("/library/captures/art_capture_focus", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/library\/captures\/art_capture_focus$/);
  await expect(page.getByRole("heading", { name: "The Focus Fallacy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Artifact detail" })).toBeVisible();
  await expect(page.getByText("Generated summary stays attached to the source capture")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Source and provenance" })).toBeVisible();
  await expect(page.getByText("Browser Clipper").first()).toBeVisible();
  await expect(page.getByText("manual clip")).toBeVisible();
  await expect(page.getByText("ThinkPad PWA")).toBeVisible();
  await expect(page.getByText("Onboarding flow polish").first()).toBeVisible();

  const layerSection = page.getByRole("region", { name: "Raw, normalized, and extracted layers" });
  await expect(layerSection).toBeVisible();
  await expect(layerSection.getByText("Raw article body with source formatting")).toBeVisible();
  await expect(layerSection.getByText("Normalized clean text preserves paragraphs")).toBeVisible();
  await expect(layerSection.getByText("Key ideas: attention residue")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Highlights and key ideas" })).toBeVisible();
  await expect(page.getByText("Extracted from normalized paragraph 3")).toBeVisible();
  await expect(page.getByText("Protect a single active objective")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(page.getByText("Attention operating notes")).toBeVisible();
  await expect(page.getByText("Focus review cards")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity timeline" })).toBeVisible();
  await expect(page.getByText("Captured from browser")).toBeVisible();
  await expect(page.getByText("Summary generated")).toBeVisible();

  await expect(page.getByRole("button", { name: /Extract highlights/ })).toBeDisabled();
  await page.getByRole("button", { name: /Summarize/ }).click();
  expect(actionRequests).toEqual([expect.objectContaining({ action: "summarize" })]);
  await expect(page.locator("[aria-live='polite']")).toHaveText("Loaded artifact detail");
  await expect(page.getByRole("button", { name: /Summarize/ })).toContainText("Completed");
});
