import { expect, test } from "@playwright/test";

const API_BASE = process.env.STARLOG_E2E_API_BASE ?? "http://127.0.0.1:8000";
const TOKEN = process.env.STARLOG_E2E_TOKEN ?? "";
const SMOKE_LABEL = process.env.STARLOG_SMOKE_LABEL ?? "Hosted Smoke";

test.beforeEach(async ({ page }) => {
  test.skip(!TOKEN, "STARLOG_E2E_TOKEN is required for hosted smoke tests");
  await page.addInitScript(
    ({ apiBase, token }) => {
      window.localStorage.setItem("starlog-api-base", apiBase);
      window.localStorage.setItem("starlog-token", token);
    },
    { apiBase: API_BASE, token: TOKEN },
  );
});

test("loads core PWA routes with hosted API session state", async ({ page }) => {
  await page.goto("/runtime");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Central session and sync configuration");
  await expect(page.locator("#session-api-base")).toHaveValue(API_BASE);

  const routeChecks: Array<{ path: string; assertion: () => Promise<void> }> = [
    {
      path: "/notes",
      assertion: async () => {
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Primary note workspace");
      },
    },
    {
      path: "/tasks",
      assertion: async () => {
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Execution workspace");
      },
    },
    {
      path: "/calendar",
      assertion: async () => {
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Weekly board and event lifecycle");
      },
    },
    {
      path: "/artifacts",
      assertion: async () => {
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Clip inbox and references");
      },
    },
    {
      path: "/sync-center",
      assertion: async () => {
        await expect(page.getByText("Sync Progress")).toBeVisible();
      },
    },
  ];

  for (const check of routeChecks) {
    await page.goto(check.path);
    await check.assertion();
  }
});

test("shows seeded hosted smoke entities", async ({ page }) => {
  await page.goto("/notes");
  await expect(page.getByText(`${SMOKE_LABEL} Note`)).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText(`${SMOKE_LABEL} Task`)).toBeVisible();

  await page.goto("/artifacts");
  await expect(page.getByText(`${SMOKE_LABEL} Artifact`)).toBeVisible();
});
