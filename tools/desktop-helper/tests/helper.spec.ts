import { expect, test } from "@playwright/test";

test("persists helper config across reloads", async ({ page }) => {
  await page.goto("/index.html");

  await page.getByLabel("API base").fill("https://starlog.example");
  await page.getByLabel("Bearer token").fill("token-123");
  await page.reload();

  await expect(page.getByLabel("API base")).toHaveValue("https://starlog.example");
  await expect(page.getByLabel("Bearer token")).toHaveValue("token-123");
});

test("browser runtime diagnostics show fallback capability state", async ({ page }) => {
  await page.goto("/index.html");

  await expect(page.locator("#runtimeDiagnostics")).toContainText("Browser fallback");
  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Browser clipboard capture is available while the helper window is focused.",
  );
  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Screenshot capture requires the native Tauri desktop runtime.",
  );
  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Window-local shortcuts are active while the helper window is focused.",
  );
});

test("browser runtime diagnostics report clipboard unavailability clearly", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/index.html");

  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Clipboard capture is unavailable in this browser runtime.",
  );
  await expect(page.locator("#runtimeDiagnostics .diagnostic-badge.unavailable").first()).toHaveText(
    "Unavailable",
  );
});

test("window shortcut clips clipboard text", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => "Playwright clipboard text",
      },
    });

    window.fetch = async (input) => {
      const url = String(input);
      if (!url.endsWith("/v1/capture")) {
        throw new Error(`Unexpected fetch: ${url}`);
      }

      return new Response(
        JSON.stringify({
          artifact: {
            id: "artifact-123",
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };
  });

  await page.goto("/index.html");
  await page.getByLabel("Bearer token").fill("token-123");
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "C",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
  });

  await expect(page.locator("#status")).toHaveText("Clip saved: artifact-123");
  await expect(page.locator("#recentCaptures")).toContainText("Desktop clip");
  await expect(page.locator("#recentCaptures")).toContainText("Browser runtime");
  await expect(page.locator("#recentCaptures")).toContainText("Playwright clipboard text");
});

test("recent helper captures persist across reloads", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => "Persisted helper clipboard text",
      },
    });

    window.fetch = async () =>
      new Response(
        JSON.stringify({
          artifact: {
            id: "artifact-persisted",
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
  });

  await page.goto("/index.html");
  await page.getByLabel("Bearer token").fill("token-123");
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "C",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
  });

  await expect(page.locator("#recentCaptures")).toContainText("artifact-persisted");
  await page.reload();
  await expect(page.locator("#recentCaptures")).toContainText("artifact-persisted");
  await expect(page.locator("#recentCaptures")).toContainText("Persisted helper clipboard text");
});

test("recent screenshot captures render stored previews", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "starlog.desktop-helper.recent-captures.v1",
      JSON.stringify([
        {
          artifactId: "artifact-shot",
          title: "Desktop screenshot",
          kind: "screenshot",
          capturedAt: "2026-03-09T12:00:00.000Z",
          appName: "Browser runtime",
          windowTitle: "Preview Test",
          contextBackend: "browser",
          platform: "test",
          ocrEngine: "tesseract",
          summary: "Screenshot preview summary",
          previewDataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAukB9pJzi10AAAAASUVORK5CYII=",
        },
      ]),
    );
  });

  await page.goto("/index.html");

  await expect(page.locator("#recentCaptures")).toContainText("Desktop screenshot");
  await expect(page.locator("#recentCaptures")).toContainText("Screenshot preview summary");
  await expect(page.locator("#recentCaptures")).toContainText("OCR: tesseract");
  await expect(page.locator("#recentCaptures img.recent-preview-image")).toHaveAttribute(
    "src",
    /data:image\/png;base64/i,
  );
});
