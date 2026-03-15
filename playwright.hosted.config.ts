import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/tests",
  testMatch: "hosted-smoke.spec.ts",
  timeout: 90_000,
  outputDir: "./artifacts/pwa-hosted-smoke/test-results",
  use: {
    baseURL: "http://127.0.0.1:3007",
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "bash -lc 'cd apps/web && ./node_modules/.bin/next build && ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3007'",
    url: "http://127.0.0.1:3007",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
