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
  : path.join(repoRoot, "artifacts", "desktop-helper", "rc-smoke", timestamp);

const apiBase = process.env.STARLOG_DESKTOP_HELPER_RC_API_BASE?.trim() || "http://127.0.0.1:8000";
const bearerToken = process.env.STARLOG_DESKTOP_HELPER_RC_BEARER_TOKEN?.trim();
const bridgeBase = process.env.STARLOG_DESKTOP_HELPER_RC_BRIDGE_BASE?.trim() || "http://127.0.0.1:8091";
const bridgeToken = process.env.STARLOG_DESKTOP_HELPER_RC_BRIDGE_TOKEN?.trim() || "";
const clipboardText = process.env.STARLOG_DESKTOP_HELPER_RC_CLIPBOARD_TEXT?.trim() || "Desktop helper RC smoke capture";

if (!bearerToken) {
  throw new Error("Set STARLOG_DESKTOP_HELPER_RC_BEARER_TOKEN before running capture_rc_smoke.mjs");
}

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

try {
  await waitForServer("http://127.0.0.1:4173/index.html");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });

  await page.addInitScript((text) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => text,
        writeText: async () => undefined,
      },
    });
  }, clipboardText);

  await page.goto("http://127.0.0.1:4173/index.html?mode=workspace");
  await page.getByLabel("API base").fill(apiBase);
  await page.getByLabel("Local bridge base").fill("http://127.0.0.1:8098");
  await page.getByLabel("Local bridge token").fill(bridgeToken);
  await page.getByLabel("Bearer token").fill(bearerToken);
  await page.getByRole("button", { name: "Discover Local Bridge" }).click();
  await page.locator("#status").waitFor({ state: "visible" });
  await page.waitForTimeout(350);

  const discoveredStatus = await page.locator("#status").textContent();
  const discoveredBridgeBase = await page.getByLabel("Local bridge base").inputValue();

  await page.getByRole("button", { name: "Check Local Bridge" }).click();
  await page.waitForTimeout(350);
  const bridgeDiagnostics = await page.locator("#runtimeDiagnostics").innerText();

  const configShot = path.join(outputDir, "desktop-helper-rc-config.png");
  await page.screenshot({ path: configShot, fullPage: true });

  await page.goto("http://127.0.0.1:4173/index.html?mode=quick");
  await page.getByRole("button", { name: "Clip Clipboard" }).click();
  await page.locator("#status").waitFor({ state: "visible" });
  await page.waitForTimeout(350);

  const clipStatus = await page.locator("#status").textContent();
  const quickShot = path.join(outputDir, "desktop-helper-rc-quick-popup.png");
  await page.screenshot({ path: quickShot, fullPage: true });

  await page.goto("http://127.0.0.1:4173/index.html?mode=workspace");
  await page.waitForTimeout(350);

  const recentCaptures = await page.locator("#recentCaptures").innerText();
  const diagnosticsShot = path.join(outputDir, "desktop-helper-rc-diagnostics.png");
  await page.screenshot({ path: diagnosticsShot, fullPage: true });

  await browser.close();

  const metadataPath = path.join(outputDir, "rc-smoke.json");
  const payload = {
    generated_at_utc: new Date().toISOString(),
    api_base: apiBase,
    expected_bridge_base: bridgeBase,
    discovered_bridge_base: discoveredBridgeBase,
    discovered_status: discoveredStatus?.trim() || "",
    clip_status: clipStatus?.trim() || "",
    bridge_diagnostics: bridgeDiagnostics,
    recent_captures: recentCaptures,
    screenshots: [configShot, quickShot, diagnosticsShot],
  };
  await writeFile(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

  console.log(`Desktop helper RC smoke captured in ${outputDir}`);
  console.log(` - ${metadataPath}`);
  console.log(` - ${configShot}`);
  console.log(` - ${quickShot}`);
  console.log(` - ${diagnosticsShot}`);
} finally {
  if (!server.killed) {
    server.kill("SIGTERM");
  }
}
