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

test("review deck context pane stays collapsed after reload", async ({ page }) => {
  await seedSession(page);

  await page.goto("/review");

  await page.getByRole("button", { name: "Hide pane" }).click();
  await expect(page.getByRole("button", { name: "Show deck context" })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("button", { name: "Show deck context" })).toBeVisible();
  await expect(page.getByText("Queue and session health")).toHaveCount(0);
});

test("planner sidecar pane stays collapsed after reload", async ({ page }) => {
  await seedSession(page);

  await page.goto("/planner");

  await page.getByRole("button", { name: "Hide pane" }).click();
  await expect(page.getByRole("button", { name: "Show ritual sidecar" })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("button", { name: "Show ritual sidecar" })).toBeVisible();
  await expect(page.getByText("Unscheduled pool and sync drift")).toHaveCount(0);
});
