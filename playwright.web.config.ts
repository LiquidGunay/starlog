import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/tests",
  testIgnore: ["hosted-smoke.spec.ts", "ui-functional/**"],
  timeout: 60_000,
  outputDir: "./artifacts/pwa-release-gate/test-results",
  use: {
    baseURL: "http://127.0.0.1:3005",
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "bash -lc 'cd apps/web && ./node_modules/.bin/next build && ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3005'",
    url: "http://127.0.0.1:3005",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
