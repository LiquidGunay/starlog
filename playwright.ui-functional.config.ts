import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = path.resolve(__dirname);

function realPathForSafety(target: string): string {
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

function isPathInside(target: string, root: string): boolean {
  const relativePath = path.relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function requireSafeOutputDir(outputDir: string, lane: string, envName: string): string {
  if (!path.isAbsolute(outputDir)) {
    throw new Error(`${envName} must be absolute: ${outputDir}`);
  }
  const resolved = path.resolve(outputDir);
  const realResolved = realPathForSafety(resolved);
  const localdataRoot = path.join(repoRoot, ".localdata");
  const artifactsRoot = path.join(repoRoot, "artifacts");
  const broadDirs = new Set([path.parse(resolved).root, path.resolve("/tmp"), repoRoot, localdataRoot]);
  const requiredSuffix = path.join(".localdata", lane, "latest", "test-results").split(path.sep);
  const actualParts = resolved.split(path.sep);
  const realParts = realResolved.split(path.sep);
  const hasRequiredSuffix = requiredSuffix.every(
    (part, index) => actualParts[actualParts.length - requiredSuffix.length + index] === part,
  );
  const realHasRequiredSuffix = requiredSuffix.every(
    (part, index) => realParts[realParts.length - requiredSuffix.length + index] === part,
  );

  if (broadDirs.has(resolved) || broadDirs.has(realResolved)) {
    throw new Error(`${envName} points at an unsafe broad output directory: ${resolved}`);
  }
  if (isPathInside(resolved, artifactsRoot) || isPathInside(realResolved, artifactsRoot)) {
    throw new Error(`${envName} must not point under tracked artifacts: ${resolved}`);
  }
  if (isPathInside(resolved, path.resolve("/tmp")) || isPathInside(realResolved, path.resolve("/tmp"))) {
    throw new Error(`${envName} must not point under /tmp: ${resolved}`);
  }
  if (!hasRequiredSuffix || !realHasRequiredSuffix) {
    throw new Error(`${envName} must end with .localdata/${lane}/latest/test-results: ${resolved}`);
  }
  return resolved;
}

const outputDir = requireSafeOutputDir(
  process.env.STARLOG_UI_FUNCTIONAL_OUTPUT_DIR || path.join(repoRoot, ".localdata", "ui-functional", "latest", "test-results"),
  "ui-functional",
  "STARLOG_UI_FUNCTIONAL_OUTPUT_DIR",
);

export default defineConfig({
  testDir: path.join(repoRoot, "apps/web/tests/ui-functional"),
  timeout: 60_000,
  outputDir,
  use: {
    baseURL: "http://127.0.0.1:3016",
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bash -lc "cd ${path.join(repoRoot, "apps/web")} && ./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3016"`,
    url: "http://127.0.0.1:3016",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "pwa-chromium",
      testMatch: /pwa-(assistant-concept|library|review|planner|today)\.functional\.spec\.ts/,
      use: {
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: "mobile-chromium",
      testMatch: /mobile-(assistant-concept|library|planner)\.functional\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
