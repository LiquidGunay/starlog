import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tools/desktop-helper/tests",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
  },
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1",
    cwd: "tools/desktop-helper/src",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: false,
  },
});
