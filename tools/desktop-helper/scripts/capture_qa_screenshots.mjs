#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const helperSrcDir = path.join(repoRoot, "tools", "desktop-helper", "src");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "artifacts", "desktop-helper", "qa", timestamp);

await mkdir(outputDir, { recursive: true });

const server = spawn("python3", ["-m", "http.server", "4173", "--bind", "127.0.0.1"], {
  cwd: helperSrcDir,
  stdio: "ignore",
});

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry while the server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const screenshots = [];

try {
  await waitForServer("http://127.0.0.1:4173/index.html");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => "Desktop helper QA clipboard capture proof",
        writeText: async () => undefined,
      },
    });

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/capture")) {
        return new Response(
          JSON.stringify({
            artifact: {
              id: "artifact-qa-proof",
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }
      return originalFetch(input, init);
    };
  });

  await page.goto("http://127.0.0.1:4173/index.html?mode=workspace");
  await page.getByLabel("API base").fill("http://127.0.0.1:8000");
  await page.getByLabel("Bearer token").fill("qa-token");

  const workspaceConfigShot = path.join(outputDir, "desktop-helper-workspace-config.png");
  await page.screenshot({ path: workspaceConfigShot, fullPage: true });
  screenshots.push(workspaceConfigShot);

  await page.goto("http://127.0.0.1:4173/index.html?mode=quick");
  await page.getByRole("button", { name: "Clip Clipboard" }).click();
  await page.locator("#status").waitFor({ state: "visible" });
  await page.waitForTimeout(250);

  const quickPopupShot = path.join(outputDir, "desktop-helper-quick-popup.png");
  await page.screenshot({ path: quickPopupShot, fullPage: true });
  screenshots.push(quickPopupShot);

  await page.getByRole("button", { name: "Clip Screenshot" }).click();
  await page.waitForTimeout(350);

  await page.goto("http://127.0.0.1:4173/index.html?mode=workspace");
  await page.getByRole("button", { name: "Refresh Diagnostics" }).click();
  await page.waitForTimeout(250);

  const workspaceDiagnosticsShot = path.join(outputDir, "desktop-helper-workspace-diagnostics.png");
  await page.screenshot({ path: workspaceDiagnosticsShot, fullPage: true });
  screenshots.push(workspaceDiagnosticsShot);

  await browser.close();

  const metadataPath = path.join(outputDir, "screenshots.json");
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        generated_at_utc: new Date().toISOString(),
        screenshots,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`Screenshots captured in ${outputDir}`);
  for (const screenshotPath of screenshots) {
    console.log(` - ${screenshotPath}`);
  }
  console.log(` - ${metadataPath}`);
} finally {
  if (!server.killed) {
    server.kill("SIGTERM");
  }
}
