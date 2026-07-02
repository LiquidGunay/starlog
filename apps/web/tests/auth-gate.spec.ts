import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const API_BASE = "http://api.local";
const TOKEN = "token-auth-gate";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ apiBase }) => {
      window.localStorage.setItem("starlog-api-base", apiBase);
      window.localStorage.removeItem("starlog-token");
    },
    { apiBase: API_BASE },
  );
});

test("unauthenticated direct route access shows sign-in experience only", async ({ page }) => {
  await page.goto("/assistant");

  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Today in Starlog");
  await expect(page.getByRole("link", { name: "Assistant" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Library" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Review" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Planner" })).toHaveCount(0);
});

test("unauthenticated today route returns to login with next target", async ({ page }) => {
  await page.goto("/today");

  await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

async function routeTodayShell(page: Page) {
  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "deck_inbox", name: "Inbox", card_count: 0, due_count: 0 }]),
    });
  });
  await page.route(`${API_BASE}/v1/cards/due**`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`${API_BASE}/v1/daily-notes/**`, async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Daily note not found" }) });
  });
}

test("sign-in on login experience routes to today by default", async ({ page }) => {
  await page.route(`${API_BASE}/v1/auth/login`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ access_token: TOKEN, expires_at: "2099-01-01T00:00:00Z", token_type: "bearer" }),
    });
  });

  await routeTodayShell(page);

  await page.goto("/login");
  const passphrase = page.getByLabel("Passphrase");
  await expect(passphrase).toBeVisible();
  await passphrase.fill("unit-test-passphrase");
  await expect(passphrase).toHaveValue("unit-test-passphrase");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL("/today");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});

test("sign-in preserves deep links after auth", async ({ page }) => {
  await page.route(`${API_BASE}/v1/auth/login`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ access_token: TOKEN, expires_at: "2099-01-01T00:00:00Z", token_type: "bearer" }),
    });
  });

  await page.route(`${API_BASE}/v1/surfaces/review/summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ladder_counts: [],
        total_ladder_counts: [],
        deck_buckets: [],
        queue_health: { due_count: 0, overdue_count: 0, due_soon_count: 0, suspended_count: 0, reviewed_today_count: 0 },
        learning_insights: [],
        recommended_drill: null,
        generated_at: "2026-07-01T00:00:00.000Z",
      }),
    });
  });
  await page.route(`${API_BASE}/v1/cards/due**`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(`${API_BASE}/v1/cards/decks`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.goto("/review");
  await expect(page).toHaveURL(/\/login\?next=%2Freview$/);
  await page.getByLabel("Passphrase").fill("unit-test-passphrase");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL("/review");
  await expect(page.getByRole("heading", { name: "Focused review" })).toBeVisible();
});

test("setup on an existing Starlog reports the passphrase recovery path", async ({ page }) => {
  await page.route(`${API_BASE}/v1/auth/bootstrap`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ detail: "User already bootstrapped" }),
    });
  });

  await page.route(`${API_BASE}/v1/auth/login`, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invalid credentials" }),
    });
  });

  await page.goto("/login");
  await page.getByLabel("Passphrase").fill("wrong-existing-passphrase");
  await page.getByRole("button", { name: "Set Up Starlog" }).click();

  await expect(page.getByText("Passphrase not accepted for this Starlog.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("stale authenticated sessions are cleared when the API rejects the token", async ({ page }) => {
  await page.addInitScript(
    ({ token }) => {
      window.localStorage.setItem("starlog-token", token);
    },
    { token: "stale-token-after-reset" },
  );

  await page.route(`${API_BASE}/v1/assistant/threads/primary`, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invalid auth token" }),
    });
  });

  await page.goto("/assistant");

  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?next=%2Fassistant$/);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("starlog-token"))).toBe("");
});
