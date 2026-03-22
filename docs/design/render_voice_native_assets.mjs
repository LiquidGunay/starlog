import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "/home/ubuntu/starlog/node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core/index.mjs";

const root = path.resolve(process.cwd(), "docs/design");
const htmlPath = path.join(root, "voice_native_artboards.html");
const outputDir = path.join(root, "assets");

const targets = [
  ["#moodboard", "voice_native_moodboard_board.png"],
  ["#pwa-screen", "voice_native_pwa_chat_comp.png"],
  ["#mobile-screen", "voice_native_mobile_voice_comp.png"],
  ["#desktop-helper-screen", "voice_native_desktop_helper_comp.png"],
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  deviceScaleFactor: 2,
  viewport: { width: 1800, height: 1500 },
});

await page.goto(pathToFileURL(htmlPath).href);
await page.setViewportSize({ width: 1800, height: 1500 });

for (const [selector, filename] of targets) {
  const element = page.locator(selector);
  await element.screenshot({
    path: path.join(outputDir, filename),
    animations: "disabled",
  });
}

await browser.close();
