import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

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

function requireSafeArtifactDir(artifactDir: string, lane: string, envName: string): string {
  if (!path.isAbsolute(artifactDir)) {
    throw new Error(`${envName} must be absolute: ${artifactDir}`);
  }
  const resolved = path.resolve(artifactDir);
  const realResolved = realPathForSafety(resolved);
  const localdataRoot = path.join(repoRoot, ".localdata");
  const artifactsRoot = path.join(repoRoot, "artifacts");
  const broadDirs = new Set([path.parse(resolved).root, path.resolve("/tmp"), repoRoot, localdataRoot]);
  const requiredSuffix = path.join(".localdata", lane, "latest").split(path.sep);
  const actualParts = resolved.split(path.sep);
  const realParts = realResolved.split(path.sep);
  const hasRequiredSuffix = requiredSuffix.every(
    (part, index) => actualParts[actualParts.length - requiredSuffix.length + index] === part,
  );
  const realHasRequiredSuffix = requiredSuffix.every(
    (part, index) => realParts[realParts.length - requiredSuffix.length + index] === part,
  );

  if (broadDirs.has(resolved) || broadDirs.has(realResolved)) {
    throw new Error(`${envName} points at an unsafe broad artifact directory: ${resolved}`);
  }
  if (isPathInside(resolved, artifactsRoot) || isPathInside(realResolved, artifactsRoot)) {
    throw new Error(`${envName} must not point under tracked artifacts: ${resolved}`);
  }
  if (isPathInside(resolved, path.resolve("/tmp")) || isPathInside(realResolved, path.resolve("/tmp"))) {
    throw new Error(`${envName} must not point under /tmp: ${resolved}`);
  }
  if (!hasRequiredSuffix || !realHasRequiredSuffix) {
    throw new Error(`${envName} must end with .localdata/${lane}/latest: ${resolved}`);
  }
  return resolved;
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

const artifactDir = requireSafeArtifactDir(
  process.env.STARLOG_PWA_RELEASE_GATE_ARTIFACT_DIR ?? path.join(repoRoot, ".localdata", "pwa-release-gate", "latest"),
  "pwa-release-gate",
  "STARLOG_PWA_RELEASE_GATE_ARTIFACT_DIR",
);
const testResultsDir = requireSafeOutputDir(
  process.env.STARLOG_PWA_RELEASE_GATE_TEST_RESULTS_DIR ?? path.join(artifactDir, "test-results"),
  "pwa-release-gate",
  "STARLOG_PWA_RELEASE_GATE_TEST_RESULTS_DIR",
);

export default defineConfig({
  testDir: path.join(repoRoot, "apps/web/tests"),
  testIgnore: ["hosted-smoke.spec.ts", "ui-functional/**", "live-functional/**"],
  timeout: 60_000,
  outputDir: testResultsDir,
  use: {
    baseURL: "http://127.0.0.1:3005",
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bash -lc "cd ${path.join(repoRoot, "apps/web")} && ./node_modules/.bin/next build && ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3005"`,
    url: "http://127.0.0.1:3005",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
