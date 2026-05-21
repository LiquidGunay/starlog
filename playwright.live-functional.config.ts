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

const apiPort = Number(process.env.STARLOG_LIVE_FUNCTIONAL_API_PORT || "8035");
const webPort = Number(process.env.STARLOG_LIVE_FUNCTIONAL_WEB_PORT || "3017");
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
  process.env.STARLOG_LIVE_FUNCTIONAL_OUTPUT_DIR || path.join(repoRoot, ".localdata", "live-functional", "latest", "test-results"),
  "live-functional",
  "STARLOG_LIVE_FUNCTIONAL_OUTPUT_DIR",
);
const runRoot =
  process.env.STARLOG_LIVE_FUNCTIONAL_RUN_ROOT ||
  path.join(repoRoot, ".localdata", "pwa-live-functional", `${Date.now()}`);
const dbPath = path.join(runRoot, "starlog.db");
const mediaDir = path.join(runRoot, "media");
const webDistDir = path.join(runRoot, "web-dist");
const nextProjectRoot = path.join(repoRoot, "apps", "web");
const webTsConfigPath = path.join(nextProjectRoot, `tsconfig.live-functional.${Date.now()}.json`);
const webTsConfigRelativePath = path.relative(nextProjectRoot, webTsConfigPath);
const seedScriptPath = path.join(repoRoot, "scripts", "interview_prep_loop_seed.py");
const interviewSeedTopicTitle = "Sliding Window";
const apiPythonVersion = process.env.STARLOG_LIVE_FUNCTIONAL_API_PYTHON_VERSION || "3.12";
const apiPythonSpecifier = `--python ${shellQuote(apiPythonVersion)}`;

function ensureDir(target: string): void {
  fs.mkdirSync(target, { recursive: true });
}

function snapshotTsConfig(): void {
  ensureDir(nextProjectRoot);
  const sourceTsConfig = path.join(nextProjectRoot, "tsconfig.json");
  const rawSource = fs.readFileSync(sourceTsConfig, "utf8");
  fs.writeFileSync(webTsConfigPath, rawSource, "utf8");
}

snapshotTsConfig();

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const apiPythonCommand = process.env.STARLOG_LIVE_FUNCTIONAL_API_PYTHON
  ? shellQuote(process.env.STARLOG_LIVE_FUNCTIONAL_API_PYTHON)
  : [
      "uv run",
      `--project ${shellQuote(path.join(repoRoot, "services/api"))}`,
      "--extra dev",
      apiPythonSpecifier,
      "python",
    ].join(" ");

export default defineConfig({
  testDir: path.join(repoRoot, "apps/web/tests/live-functional"),
  timeout: 150_000,
  outputDir,
  expect: { timeout: 20_000 },
  retries: 1,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: [
        `mkdir -p ${shellQuote(mediaDir)}`,
        [
          `${apiPythonCommand} ${shellQuote(seedScriptPath)}`,
          `--db-path ${shellQuote(dbPath)}`,
          `--media-dir ${shellQuote(mediaDir)}`,
          `--topic-title ${shellQuote(interviewSeedTopicTitle)}`,
        ].join(" "),
        [
          `STARLOG_ENV=prod`,
          `STARLOG_DB_PATH=${shellQuote(dbPath)}`,
          `STARLOG_MEDIA_DIR=${shellQuote(mediaDir)}`,
          `STARLOG_SECRETS_MASTER_KEY=${shellQuote(`pwa-live-functional-${Date.now()}`)}`,
          `PYTHONPATH=${shellQuote(path.join(repoRoot, "services/api"))}`,
          `${apiPythonCommand} -m uvicorn app.main:app --host 127.0.0.1`,
          `--port ${apiPort}`,
          `--app-dir ${shellQuote(path.join(repoRoot, "services/api"))}`,
        ].join(" "),
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/v1/health`,
      reuseExistingServer: false,
      timeout: 150_000,
    },
    {
      command: [
        `STARLOG_LIVE_FUNCTIONAL_WEB_DIST_DIR=${shellQuote(webDistDir)}`,
        `STARLOG_LIVE_FUNCTIONAL_TSCONFIG_PATH=${shellQuote(webTsConfigRelativePath)}`,
        `bash -lc ${shellQuote(`cd ${shellQuote(nextProjectRoot)} && ./node_modules/.bin/next dev --hostname 127.0.0.1 --port ${webPort}`)}`,
      ].join(" "),
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: "pwa-live-chromium",
      testMatch: /pwa-live-user-flow\.spec\.ts/,
      use: {
        viewport: { width: 1440, height: 960 },
      },
    },
  ],
});
