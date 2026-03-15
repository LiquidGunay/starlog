import { expect, test } from "@playwright/test";

const API_BASE = "http://api.local";
const TOKEN = "token-123";

async function seedSession(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(
    ({ apiBase, token }) => {
      window.localStorage.setItem("starlog-api-base", apiBase);
      window.localStorage.setItem("starlog-token", token);
    },
    { apiBase: API_BASE, token: TOKEN },
  );
}

async function waitForOfflineShell(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    if (registration.active?.state === "activated") {
      return;
    }

    await new Promise<void>((resolve) => {
      const worker = registration.installing || registration.waiting || registration.active;
      if (!worker) {
        resolve();
        return;
      }

      const done = () => resolve();
      worker.addEventListener("statechange", done, { once: true });
      window.setTimeout(done, 1_000);
    });
  });

  await page.waitForTimeout(500);
}

test("keeps cached notes readable after an offline reload", async ({ context, page }) => {
  await seedSession(page);
  let allowNotesApi = true;

  await page.route(`${API_BASE}/v1/notes`, async (route) => {
    if (!allowNotesApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "note-1",
          title: "Nebula Checklist",
          body_md: "Pack telescope, battery, and journal.",
          version: 3,
          created_at: "2026-03-10T08:00:00.000Z",
          updated_at: "2026-03-10T09:15:00.000Z",
        },
      ]),
    });
  });

  await page.goto("/notes");
  await expect(page.getByRole("button", { name: "Nebula Checklist" })).toBeVisible();

  await waitForOfflineShell(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Nebula Checklist" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Nebula Checklist");
  await expect(page.getByLabel("Body")).toHaveValue("Pack telescope, battery, and journal.");

  allowNotesApi = false;
  await context.setOffline(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Nebula Checklist" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Nebula Checklist");
  await expect(page.getByLabel("Body")).toHaveValue("Pack telescope, battery, and journal.");
  await expect(page.locator(".status")).toContainText("Loaded cached notes");
});

test("keeps the canonical task cache available after a filtered refresh goes offline", async ({
  context,
  page,
}) => {
  await seedSession(page);
  let allowTasksApi = true;

  await page.route(`${API_BASE}/v1/tasks*`, async (route) => {
    if (!allowTasksApi) {
      await route.abort();
      return;
    }

    const url = new URL(route.request().url());
    const status = url.searchParams.get("status");
    const tasks = [
      {
        id: "task-1",
        title: "Pack tripod",
        status: "todo",
        estimate_min: 20,
        priority: 4,
        due_at: "2026-03-11T08:00:00.000Z",
        created_at: "2026-03-10T08:00:00.000Z",
        updated_at: "2026-03-10T08:30:00.000Z",
      },
      {
        id: "task-2",
        title: "Calibrate mount",
        status: "done",
        estimate_min: 45,
        priority: 3,
        due_at: null,
        created_at: "2026-03-09T18:00:00.000Z",
        updated_at: "2026-03-10T07:00:00.000Z",
      },
    ];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status ? tasks.filter((task) => task.status === status) : tasks),
    });
  });

  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Pack tripod" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Calibrate mount" })).toBeVisible();

  await page.locator(".panel .button-row").first().getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".status")).toContainText("Loaded 1 tasks");
  await expect(page.getByRole("button", { name: "Calibrate mount" })).toBeVisible();

  allowTasksApi = false;
  await context.setOffline(true);

  await page.locator(".panel .button-row").first().getByRole("button", { name: "All" }).click();
  await expect(page.getByRole("button", { name: "Pack tripod" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Calibrate mount" })).toBeVisible();
  await expect(page.locator(".status")).toContainText("Loaded cached tasks");
});

test("keeps artifact detail and offline search available from the local cache", async ({
  context,
  page,
}) => {
  await seedSession(page);
  let allowArtifactApi = true;

  await page.route(`${API_BASE}/v1/artifacts`, async (route) => {
    if (!allowArtifactApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "artifact-1",
          source_type: "clip_manual",
          title: "Orion briefing",
          created_at: "2026-03-10T07:00:00.000Z",
        },
      ]),
    });
  });

  await page.route(`${API_BASE}/v1/artifacts/artifact-1/graph`, async (route) => {
    if (!allowArtifactApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        artifact: {
          id: "artifact-1",
          source_type: "clip_manual",
          title: "Orion briefing",
          created_at: "2026-03-10T07:00:00.000Z",
        },
        summaries: [
          {
            id: "summary-1",
            version: 2,
            content: "Nebula summary for the Orion field briefing.",
          },
        ],
        cards: [
          {
            id: "card-1",
            prompt: "What should you review before sunrise?",
          },
        ],
        tasks: [
          {
            id: "task-1",
            title: "Charge the field recorder",
            status: "todo",
          },
        ],
        notes: [
          {
            id: "note-2",
            title: "Field observations",
          },
        ],
        relations: [],
      }),
    });
  });

  await page.route(`${API_BASE}/v1/artifacts/artifact-1/versions`, async (route) => {
    if (!allowArtifactApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summaries: [
          {
            id: "summary-1",
            version: 2,
            created_at: "2026-03-10T07:10:00.000Z",
          },
        ],
        card_sets: [],
        actions: [
          {
            id: "action-1",
            action: "summarize",
            status: "completed",
            output_ref: "summary-1",
            created_at: "2026-03-10T07:10:00.000Z",
          },
        ],
      }),
    });
  });

  await page.goto("/artifacts?artifact=artifact-1");
  await expect(page.getByText("Summaries: 1")).toBeVisible();
  await expect(page.getByText("Summary versions: 1")).toBeVisible();

  await waitForOfflineShell(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Summaries: 1")).toBeVisible();
  await expect(page.getByText("Summary versions: 1")).toBeVisible();

  allowArtifactApi = false;
  await context.setOffline(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Summaries: 1")).toBeVisible();
  await expect(page.getByText("Summary versions: 1")).toBeVisible();
  await expect(page.locator(".status")).toContainText("Loaded cached graph");

  await page.goto("/search");
  await page.getByLabel("Query").fill("nebula");
  await page.getByRole("button", { name: "Run Search" }).click();

  await expect(page.getByRole("link", { name: "Orion briefing" })).toBeVisible();
  await expect(page.locator(".panel")).toContainText("Nebula summary for the Orion field briefing.");
});

test("keeps planner timeline data available when refresh goes offline", async ({ context, page }) => {
  await seedSession(page);
  let allowPlannerApi = true;

  await page.route(`${API_BASE}/v1/planning/blocks/*`, async (route) => {
    if (!allowPlannerApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "block-1",
          title: "Morning planning",
          starts_at: "2026-03-12T08:00:00.000Z",
          ends_at: "2026-03-12T09:00:00.000Z",
        },
      ]),
    });
  });

  await page.route(`${API_BASE}/v1/calendar/events`, async (route) => {
    if (!allowPlannerApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "event-1",
          title: "Orbit review",
          starts_at: "2026-03-12T10:00:00.000Z",
          ends_at: "2026-03-12T11:00:00.000Z",
          source: "internal",
        },
      ]),
    });
  });

  await page.route(`${API_BASE}/v1/calendar/sync/google/oauth/status`, async (route) => {
    if (!allowPlannerApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connected: true,
        mode: "oauth",
        source: "google",
        has_refresh_token: true,
        detail: "Connected",
      }),
    });
  });

  await page.goto("/planner");
  await page.getByLabel("Date").fill("2026-03-12");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Morning planning").first()).toBeVisible();
  await expect(page.getByText("Orbit review").first()).toBeVisible();

  allowPlannerApi = false;
  await context.setOffline(true);
  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Morning planning").first()).toBeVisible();
  await expect(page.getByText("Orbit review").first()).toBeVisible();
});

test("keeps integration provider data readable when refresh goes offline", async ({ context, page }) => {
  await seedSession(page);
  let allowIntegrationsApi = true;

  await page.route(`${API_BASE}/v1/integrations/providers*`, async (route) => {
    if (!allowIntegrationsApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          provider_name: "local_llm",
          enabled: true,
          mode: "local_first",
          config: { model: "qwen2.5" },
          updated_at: "2026-03-12T07:00:00.000Z",
        },
      ]),
    });
  });

  await page.route(`${API_BASE}/v1/integrations/execution-policy`, async (route) => {
    if (!allowIntegrationsApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 3,
        llm: ["on_device", "api_fallback"],
        stt: ["on_device", "api_fallback"],
        tts: ["on_device", "api_fallback"],
        ocr: ["on_device"],
        available_targets: {
          llm: ["on_device", "api_fallback"],
          stt: ["on_device", "api_fallback"],
          tts: ["on_device", "api_fallback"],
          ocr: ["on_device"],
        },
        updated_at: "2026-03-12T07:00:00.000Z",
      }),
    });
  });

  await page.route(`${API_BASE}/v1/integrations/providers/codex_bridge/contract`, async (route) => {
    if (!allowIntegrationsApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider_name: "codex_bridge",
        summary: "Experimental bridge contract",
        feature_flag_key: "codex_bridge_enabled",
        supported_adapter_kinds: ["openai_compatible"],
        configured_adapter_kind: "openai_compatible",
        supported_auth: ["api_key"],
        supported_capabilities: ["llm"],
        unsupported_capabilities: ["oauth"],
        required_config: ["api_base"],
        optional_config: ["api_key"],
        native_oauth_supported: false,
        safe_fallback: "Use local/api providers",
        configured: true,
        enabled: true,
        execute_enabled: true,
        missing_requirements: [],
        derived_endpoints: {},
      }),
    });
  });

  await page.route(`${API_BASE}/v1/integrations/providers/local_llm/health`, async (route) => {
    if (!allowIntegrationsApi) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider_name: "local_llm",
        healthy: true,
        detail: "ok",
        checks: { model: true },
        secure_storage: "none",
        probe: { ping: "ok" },
        auth_probe: { token: "n/a" },
      }),
    });
  });

  await page.goto("/integrations");
  await page.getByRole("button", { name: "Refresh List" }).click();
  await expect(page.locator(".status")).toContainText("Loaded 1 provider config(s)");
  await expect(page.getByText("local_llm", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Health: ok (ok)")).toBeVisible();

  allowIntegrationsApi = false;
  await context.setOffline(true);
  await page.getByRole("button", { name: "Refresh List" }).click();

  await expect(page.getByText("local_llm", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Health: ok (ok)")).toBeVisible();
});
