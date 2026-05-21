#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const helperSrcDir = path.join(repoRoot, "tools", "desktop-helper", "src");
const defaultOutputDir = path.join(repoRoot, ".localdata", "desktop-helper", "qa", "latest");

function realPathForSafety(target) {
  let cursor = target;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return path.resolve(target);
    }
    cursor = parent;
  }
  const relativeTail = path.relative(cursor, target);
  return path.resolve(fs.realpathSync.native(cursor), relativeTail);
}

function isPathInside(target, root) {
  const relativePath = path.relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function requireSafeOutputDir(candidate) {
  const outputRoot = path.resolve(candidate);
  const realOutputRoot = realPathForSafety(outputRoot);
  const localdataRoot = path.join(repoRoot, ".localdata");
  const laneRoot = path.join(localdataRoot, "desktop-helper", "qa");
  const artifactsRoot = path.join(repoRoot, "artifacts");
  const broadDirs = new Set([path.parse(outputRoot).root, path.resolve("/tmp"), repoRoot, localdataRoot, laneRoot]);
  const requiredSuffix = path.join(".localdata", "desktop-helper", "qa", "latest").split(path.sep);
  const outputParts = outputRoot.split(path.sep);
  const realOutputParts = realOutputRoot.split(path.sep);
  const hasRequiredSuffix = requiredSuffix.every(
    (part, index) => outputParts[outputParts.length - requiredSuffix.length + index] === part,
  );
  const realHasRequiredSuffix = requiredSuffix.every(
    (part, index) => realOutputParts[realOutputParts.length - requiredSuffix.length + index] === part,
  );

  if (broadDirs.has(outputRoot) || broadDirs.has(realOutputRoot)) {
    throw new Error(`Refusing unsafe broad QA screenshot output directory: ${outputRoot}`);
  }
  if (isPathInside(outputRoot, artifactsRoot) || isPathInside(realOutputRoot, artifactsRoot)) {
    throw new Error(`QA screenshot output must not point under tracked artifacts: ${outputRoot}`);
  }
  if (isPathInside(outputRoot, path.resolve("/tmp")) || isPathInside(realOutputRoot, path.resolve("/tmp"))) {
    throw new Error(`QA screenshot output must not point under /tmp: ${outputRoot}`);
  }
  if (!hasRequiredSuffix || !realHasRequiredSuffix || !isPathInside(realOutputRoot, laneRoot)) {
    throw new Error(`QA screenshot output must resolve to .localdata/desktop-helper/qa/latest: ${outputRoot}`);
  }
  return outputRoot;
}

const outputDir = requireSafeOutputDir(process.argv[2] ? path.resolve(process.argv[2]) : defaultOutputDir);

await rm(outputDir, { recursive: true, force: true });
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
