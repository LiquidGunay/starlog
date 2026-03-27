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

  await page.route(`${API_BASE}/v1/conversations/primary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "thr_primary",
        slug: "primary",
        title: "Primary conversation",
        mode: "voice_native",
        session_state: {},
        tool_traces: [],
        created_at: "2026-03-22T09:00:00.000Z",
        updated_at: "2026-03-22T09:00:00.000Z",
        messages: [],
      }),
    });
  });

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
  const holdToTalk = page.locator(".assistant-voice-button");
  await holdToTalk.dispatchEvent("pointerdown");
  await holdToTalk.dispatchEvent("pointerup");
  await expect(page.getByText("Voice clip captured and ready for upload.")).toBeVisible();

  await page.getByRole("button", { name: /Plan voice/i }).click();
  await expect(page.getByText("Upload queue: 1", { exact: false })).toBeVisible();

  await context.setOffline(false);
  await expect.poll(() => uploadCalls).toBe(1);
  await expect(page.getByText("Upload queue: 0", { exact: false })).toBeVisible();
  await expect(page.getByText("Uploaded 1 queued voice command(s)", { exact: false })).toBeVisible();
  await expect(page.getByText("voice-job-1", { exact: false })).toBeVisible();
});

test("keyboard users can hold the velvet voice control to capture a voice clip", async ({ page }) => {
  await seedSession(page);

  await page.route(`${API_BASE}/v1/conversations/primary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "thr_primary",
        slug: "primary",
        title: "Primary conversation",
        mode: "voice_native",
        session_state: {},
        tool_traces: [],
        created_at: "2026-03-22T09:00:00.000Z",
        updated_at: "2026-03-22T09:00:00.000Z",
        messages: [],
      }),
    });
  });

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

  await page.goto("/assistant");
  const holdToTalk = page.locator(".assistant-voice-button");
  await holdToTalk.focus();
  await page.keyboard.down("Space");
  await expect(page.getByText("Recording voice command...")).toBeVisible();
  await page.keyboard.up("Space");
  await expect(page.getByText("Voice command ready to upload")).toBeVisible();

  await page.getByRole("button", { name: /Plan voice/i }).click();
  await expect(page.getByText("Upload queue: 1", { exact: false })).toBeVisible();
});
