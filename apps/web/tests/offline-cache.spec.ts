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

  allowNotesApi = false;
  await context.setOffline(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Nebula Checklist" })).toBeVisible();
  await expect(page.locator(".status")).toContainText("Loaded cached notes");
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
