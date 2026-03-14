import { expect, test } from "@playwright/test";

const API_BASE = "http://api.local";
const TOKEN = "token-123";

async function seedSession(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(
    ({ apiBase, token }) => {
      window.localStorage.setItem("starlog-api-base", apiBase);
      window.localStorage.setItem("starlog-token", token);

      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, "mediaDevices", {
          value: {},
          configurable: true,
        });
      }

      navigator.mediaDevices.getUserMedia = async () => new MediaStream();

      class MockMediaRecorder {
        mimeType = "audio/webm";
        stream: MediaStream;
        ondataavailable: ((event: { data: Blob; size?: number }) => void) | null = null;
        onstop: (() => void) | null = null;

        constructor(stream: MediaStream) {
          this.stream = stream;
        }

        start(): void {
          // no-op mock
        }

        stop(): void {
          const blob = new Blob(["voice-test"], { type: this.mimeType });
          this.ondataavailable?.({ data: blob, size: blob.size });
          this.onstop?.();
        }
      }

      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        writable: true,
        value: MockMediaRecorder,
      });
    },
    { apiBase: API_BASE, token: TOKEN },
  );
}

test("replays queued assistant voice uploads from offline capture", async ({ context, page }) => {
  await seedSession(page);

  await page.route(`${API_BASE}/v1/agent/intents`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route(`${API_BASE}/v1/ai/jobs*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  let uploadCalls = 0;
  await page.route(`${API_BASE}/v1/agent/command/voice`, async (route) => {
    uploadCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "voice-job-1",
        capability: "stt",
        status: "pending",
        provider_hint: "whisper_local",
        provider_used: null,
        action: "assistant_command",
        payload: {
          title: "Web voice command",
        },
        output: {},
        error_text: null,
        created_at: "2026-03-14T18:00:00.000Z",
        finished_at: null,
      }),
    });
  });

  await page.goto("/assistant");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Start Voice Command" }).click();
  await page.getByRole("button", { name: "Stop Voice Command" }).click();
  await expect(page.getByText("Voice clip: ready", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Plan Voice" }).click();
  await expect(page.getByText("Voice upload queue: 1", { exact: false })).toBeVisible();

  await context.setOffline(false);
  await expect.poll(() => uploadCalls).toBe(1);
  await expect(page.getByText("Voice upload queue: 0", { exact: false })).toBeVisible();
  await expect(page.getByText("Uploaded 1 queued voice command(s)", { exact: false })).toBeVisible();
  await expect(page.getByText("voice-job-1", { exact: false })).toBeVisible();
});
