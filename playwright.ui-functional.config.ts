import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/tests/ui-functional",
  timeout: 60_000,
  outputDir: "./artifacts/ui-functional/test-results",
  use: {
    baseURL: "http://127.0.0.1:3016",
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bash -lc 'cd apps/web && ./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3016'",
    url: "http://127.0.0.1:3016",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "pwa-chromium",
      testMatch: /pwa-(assistant-concept|library|review|planner)\.functional\.spec\.ts/,
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
