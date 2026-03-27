#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const outputDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "artifacts", "cross-surface-proof", new Date().toISOString().replace(/[:.]/g, "-"));

const apiBase = process.env.STARLOG_CROSS_SURFACE_API_BASE?.trim() || "http://127.0.0.1:8011";
const token = process.env.STARLOG_CROSS_SURFACE_TOKEN?.trim();
const assistantMarker = process.env.STARLOG_CROSS_SURFACE_ASSISTANT_MARKER?.trim()
  || "Cross-surface reply marker visible from the PWA against the same thread.";
const artifactTitle = process.env.STARLOG_CROSS_SURFACE_ARTIFACT_TITLE?.trim() || "Desktop clip";
const artifactMarker = process.env.STARLOG_CROSS_SURFACE_ARTIFACT_MARKER?.trim()
  || "WI-593 desktop clip marker for cross-surface proof";
const webPort = process.env.STARLOG_CROSS_SURFACE_WEB_PORT?.trim() || "3007";
const markerWaitMs = 30_000;

if (!token) {
  throw new Error("Set STARLOG_CROSS_SURFACE_TOKEN before running cross_surface_web_proof.mjs");
}

await mkdir(outputDir, { recursive: true });

const webServerCommand =
  "cd apps/web && ./node_modules/.bin/next build && ./node_modules/.bin/next start --hostname 127.0.0.1 --port "
  + webPort;
const server = spawn("bash", ["-lc", webServerCommand], {
  cwd: repoRoot,
  stdio: "ignore",
});

async function waitFor(url) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Wait for the static server to come up.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForBodyText(page, expectedText, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bodyText = await page.locator("body").innerText();
    if (bodyText.includes(expectedText)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for body text to include "${expectedText}"`);
}

function markerRecord(name, expected, visible) {
  return {
    name,
    expected,
    visible,
    passed: visible,
  };
}

let browser;
try {
  await waitFor(`http://127.0.0.1:${webPort}`);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

  await page.addInitScript(
    ({ configuredApiBase, configuredToken }) => {
      window.localStorage.setItem("starlog-api-base", configuredApiBase);
      window.localStorage.setItem("starlog-token", configuredToken);
    },
    { configuredApiBase: apiBase, configuredToken: token },
  );

  await page.goto(`http://127.0.0.1:${webPort}/assistant`);
  await page.getByRole("heading", { name: "Turn the whole day into one brief and one next move." }).waitFor({ timeout: 15_000 });
  let assistantMarkerVisible = false;
  try {
    await waitForBodyText(page, assistantMarker, markerWaitMs);
    assistantMarkerVisible = true;
  } catch {
    assistantMarkerVisible = false;
  }
  const assistantPath = path.join(outputDir, "pwa-assistant-thread.png");
  await page.screenshot({ path: assistantPath, fullPage: true });

  await page.goto(`http://127.0.0.1:${webPort}/artifacts`);
  await page.getByRole("heading", { name: "Reading room and lineage" }).waitFor({ timeout: 15_000 });
  let artifactMarkerVisible = false;
  try {
    await waitForBodyText(page, artifactTitle, markerWaitMs);
    await waitForBodyText(page, artifactMarker, markerWaitMs);
    artifactMarkerVisible = true;
  } catch {
    artifactMarkerVisible = false;
  }
  const artifactsPath = path.join(outputDir, "pwa-artifacts-desktop-clip.png");
  await page.screenshot({ path: artifactsPath, fullPage: true });

  const proofChecks = [
    markerRecord("assistant_marker", assistantMarker, assistantMarkerVisible),
    markerRecord("artifact_marker", artifactMarker, artifactMarkerVisible),
  ];
  const failedChecks = proofChecks.filter((check) => !check.passed);
  const proofPassed = failedChecks.length === 0;

  const summaryPath = path.join(outputDir, "pwa-proof.json");
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        generated_at_utc: new Date().toISOString(),
        api_base: apiBase,
        status: proofPassed ? "passed" : "failed",
        assistant_marker: assistantMarker,
        assistant_marker_visible: assistantMarkerVisible,
        artifact_title: artifactTitle,
        artifact_marker: artifactMarker,
        artifact_marker_visible: artifactMarkerVisible,
        proof_passed: proofPassed,
        checks: proofChecks,
        screenshots: [assistantPath, artifactsPath],
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  if (!proofPassed) {
    throw new Error(
      `Cross-surface proof failed: ${failedChecks.map((check) => `${check.name} missing expected marker "${check.expected}"`).join("; ")}`,
    );
  }

  console.log(`Cross-surface PWA proof passed in ${outputDir}`);
  console.log(` - ${assistantPath}`);
  console.log(` - ${artifactsPath}`);
  console.log(` - ${summaryPath}`);
} finally {
  if (browser) {
    await browser.close();
  }
  if (!server.killed) {
    server.kill("SIGTERM");
  }
}
