import { expect, test } from "@playwright/test";

const API_BASE = "http://api.local";
const TOKEN = "token-auth-gate";

const assistantThreadShell = {
  id: "thr_primary",
  slug: "primary",
  title: "Assistant thread",
  mode: "assistant",
  created_at: "2026-05-09T09:00:00.000Z",
  updated_at: "2026-05-09T09:00:00.000Z",
  last_message_at: null,
  last_preview_text: null,
  messages: [],
  runs: [],
  interrupts: [],
  next_cursor: "2026-05-09T09:00:00.000Z",
};

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

test("sign-in on pre-login experience routes to assistant", async ({ page }) => {
  await page.route(`${API_BASE}/v1/auth/login`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ access_token: TOKEN, expires_at: "2099-01-01T00:00:00Z", token_type: "bearer" }),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(assistantThreadShell),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/updates*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        thread_id: "thr_primary",
        cursor: assistantThreadShell.next_cursor,
        deltas: [],
      }),
    });
  });

  await page.route(`${API_BASE}/v1/assistant/threads/primary/stream`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": keep-alive\n\n",
    });
  });

  await page.goto("/assistant");
  await page.getByLabel("Passphrase").fill("unit-test-passphrase");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL("/assistant");
  await expect(page.getByRole("heading", { name: "Starlog Assistant" })).toBeVisible();
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
