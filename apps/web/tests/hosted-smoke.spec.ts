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
  const routeChecks: Array<{ path: string; heading: string }> = [
    { path: "/notes", heading: "Primary note workspace" },
    { path: "/tasks", heading: "Execution workspace" },
    { path: "/calendar", heading: "Weekly board and event lifecycle" },
    { path: "/artifacts", heading: "Clip inbox and references" },
    { path: "/sync-center", heading: "PWA outbox and replay log" },
  ];

  for (const check of routeChecks) {
    await page.goto(check.path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(check.heading);
    await expect(page.locator("#session-api-base")).toHaveValue(API_BASE);
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
