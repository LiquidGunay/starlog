import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/tests",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3005",
    headless: true,
  },
  webServer: {
    command:
      "bash -lc 'cd /home/ubuntu/starlog/apps/web && ./node_modules/.bin/next build && ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3005'",
    url: "http://127.0.0.1:3005",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
