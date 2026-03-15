import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __copiedDiagnostics?: string;
  }
}

test("persists helper config across reloads", async ({ page }) => {
  await page.goto("/index.html");

  await page.getByLabel("API base").fill("https://starlog.example");
  await page.getByLabel("Bearer token").fill("token-123");
  await page.reload();

  await expect(page.getByLabel("API base")).toHaveValue("https://starlog.example");
  await expect(page.getByLabel("Bearer token")).toHaveValue("token-123");
});

test("quick popup can switch to workspace in browser fallback", async ({ page }) => {
  await page.goto("/index.html?mode=quick");
  await expect(page.locator("body")).toHaveAttribute("data-helper-mode", "quick");

  await page.getByRole("button", { name: "Open Workspace" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-helper-mode", "workspace");
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

test("browser runtime diagnostics can refresh and copy a redacted snapshot", async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedDiagnostics = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => "diagnostics clipboard text",
        writeText: async (text) => {
          window.__copiedDiagnostics = text;
        },
      },
    });
  });

  await page.goto("/index.html");
  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Window-local shortcuts are active while the helper window is focused.",
  );

  await page.getByRole("button", { name: "Refresh Diagnostics" }).click();
  await expect(page.locator("#status")).toHaveText("Browser diagnostics refreshed");

  await page.getByRole("button", { name: "Copy Diagnostics" }).click();
  await expect(page.locator("#status")).toHaveText("Diagnostics copied to clipboard");

  const copiedDiagnostics = await page.evaluate(() => window.__copiedDiagnostics);
  expect(copiedDiagnostics).toContain('"runtime": "browser"');
  expect(copiedDiagnostics).toContain('"apiBase": "http://localhost:8000"');
  expect(copiedDiagnostics).not.toContain("token-");
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
  await expect(page.locator("#recentCaptures")).toContainText("Capture backend: browser-clipboard");
  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Last window-local shortcut: CommandOrControl+Shift+C via window-keydown.",
  );
  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Last clipboard capture succeeded via browser-clipboard.",
  );
});

test("clipboard failure updates runtime diagnostics note", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => {
          throw new Error("Permission denied");
        },
      },
    });
  });

  await page.goto("/index.html?mode=quick");
  await page.getByRole("button", { name: "Clip Clipboard" }).click();

  await expect(page.locator("#status")).toContainText("Permission denied");
  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Last clipboard capture failed. Permission denied",
  );
  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Focus the helper window and allow clipboard access, or use the native Tauri runtime.",
  );
});

test("browser screenshot attempt records the fallback note", async ({ page }) => {
  await page.goto("/index.html?mode=quick");
  await page.getByRole("button", { name: "Clip Screenshot" }).click();

  await expect(page.locator("#status")).toHaveText("Screenshot clip requires Tauri runtime");
  await expect(page.locator("#runtimeDiagnostics")).toContainText(
    "Last screenshot attempt failed because the helper is not running in the Tauri runtime.",
  );
});

test("copy diagnostics includes the latest runtime note without the token", async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedDiagnostics = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copiedDiagnostics = String(value);
        },
      },
    });
  });

  await page.goto("/index.html?mode=quick");
  await page.getByRole("button", { name: "Clip Screenshot" }).click();
  await page.getByRole("button", { name: "Open Workspace" }).click();
  await page.getByLabel("Bearer token").fill("token-123");
  await page.getByRole("button", { name: "Copy Diagnostics" }).click();

  await expect(page.locator("#status")).toHaveText("Diagnostics copied to clipboard");

  const copiedDiagnostics = await page.evaluate(() => window.__copiedDiagnostics || "");
  expect(copiedDiagnostics).toContain("\"runtime\"");
  expect(copiedDiagnostics).toContain(
    "Last screenshot attempt failed because the helper is not running in the Tauri runtime.",
  );
  expect(copiedDiagnostics).not.toContain("token-123");
});

test("copy setup checklist redacts the token and includes readiness guidance", async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedDiagnostics = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copiedDiagnostics = String(value);
        },
      },
    });
  });

  await page.goto("/index.html");
  await page.getByLabel("API base").fill("https://starlog.example");
  await page.getByLabel("Bearer token").fill("token-123");
  await page.getByRole("button", { name: "Copy Setup Checklist" }).click();

  await expect(page.locator("#status")).toHaveText("Setup checklist copied to clipboard");

  const copiedChecklist = await page.evaluate(() => window.__copiedDiagnostics || "");
  expect(copiedChecklist).toContain("Starlog Desktop Helper Setup Checklist");
  expect(copiedChecklist).toContain("API base: https://starlog.example");
  expect(copiedChecklist).toContain("Bearer token configured: yes");
  expect(copiedChecklist).toContain("Reset Local State");
  expect(copiedChecklist).not.toContain("token-123");
});

test("reset local state clears config, recent captures, and quick surface preference", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "starlog.desktop-helper.recent-captures.v1",
      JSON.stringify([
        {
          artifactId: "artifact-reset",
          title: "Desktop clip",
          kind: "clipboard",
          capturedAt: "2026-03-15T18:00:00.000Z",
          appName: "Codex",
          windowTitle: "Setup Reset Test",
        },
      ]),
    );
  });

  await page.goto("/index.html?mode=quick");
  await page.getByRole("button", { name: "Open Workspace" }).click();
  await page.getByLabel("API base").fill("https://starlog.example");
  await page.getByLabel("Bearer token").fill("token-123");
  await expect(page.locator("#recentCaptures")).toContainText("artifact-reset");

  await page.getByRole("button", { name: "Reset Local State" }).click();

  await expect(page.locator("#status")).toHaveText("Local setup reset to defaults");
  await expect(page.getByLabel("API base")).toHaveValue("http://localhost:8000");
  await expect(page.getByLabel("Bearer token")).toHaveValue("");
  await expect(page.locator("body")).toHaveAttribute("data-helper-mode", "workspace");
  await expect(page.locator("#recentCaptures")).toContainText("No captures yet.");
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
