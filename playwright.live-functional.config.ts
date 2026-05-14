import fs from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const apiPort = Number(process.env.STARLOG_LIVE_FUNCTIONAL_API_PORT || "8035");
const webPort = Number(process.env.STARLOG_LIVE_FUNCTIONAL_WEB_PORT || "3017");
const runRoot =
  process.env.STARLOG_LIVE_FUNCTIONAL_RUN_ROOT ||
  path.join(process.cwd(), ".localdata", "pwa-live-functional", `${Date.now()}`);
const dbPath = path.join(runRoot, "starlog.db");
const mediaDir = path.join(runRoot, "media");
const webDistDir = path.join(runRoot, "web-dist");
const nextProjectRoot = path.join(process.cwd(), "apps", "web");
const webTsConfigPath = path.join(nextProjectRoot, `tsconfig.live-functional.${Date.now()}.json`);
const webTsConfigRelativePath = path.relative(nextProjectRoot, webTsConfigPath);
const seedScriptPath = path.join(process.cwd(), "scripts", "interview_prep_loop_seed.py");
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
      `--project ${shellQuote(path.join(process.cwd(), "services/api"))}`,
      "--extra dev",
      apiPythonSpecifier,
      "python",
    ].join(" ");

export default defineConfig({
  testDir: "./apps/web/tests/live-functional",
  timeout: 150_000,
  outputDir: "./artifacts/live-functional/test-results",
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
          `PYTHONPATH=${shellQuote(path.join(process.cwd(), "services/api"))}`,
          `${apiPythonCommand} -m uvicorn app.main:app --host 127.0.0.1`,
          `--port ${apiPort}`,
          `--app-dir ${shellQuote(path.join(process.cwd(), "services/api"))}`,
        ].join(" "),
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/v1/health`,
      reuseExistingServer: false,
      timeout: 150_000,
    },
    {
      command: `STARLOG_LIVE_FUNCTIONAL_WEB_DIST_DIR=${shellQuote(webDistDir)} STARLOG_LIVE_FUNCTIONAL_TSCONFIG_PATH=${shellQuote(webTsConfigRelativePath)} bash -lc 'cd apps/web && ./node_modules/.bin/next dev --hostname 127.0.0.1 --port ${webPort}'`,
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
