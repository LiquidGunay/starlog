import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const API_APP_DIR = path.join(REPO_ROOT, "services/api");
const API_PYTHON_VERSION = process.env.STARLOG_ASSISTANT_E2E_API_PYTHON_VERSION || "3.12";
const API_HEALTH_TIMEOUT_MS = 30_000;
const TEST_PASSPHRASE = `assistant-dynamic-ui-e2e-${process.pid}-${Date.now()}`;

let apiBase = "";
let apiDbPath = "";
let apiProcess: ChildProcessWithoutNullStreams | null = null;
let apiOutput = "";
let mockRuntimeBase = "";
let mockRuntimeServer: Server | null = null;
const mockRuntimeRequests: Array<Record<string, unknown>> = [];
let mockReviewCardTarget: { cardId: string; prompt: string; cardType: string; reviewMode: string } | null = null;

type AuthResponse = {
  access_token: string;
};

type TaskResponse = {
  title: string;
  priority: number;
  due_at: string | null;
};

type CardResponse = {
  id: string;
  card_type: string;
  review_mode: string;
  prompt: string;
  due_at: string;
  interval_days: number;
  repetitions: number;
  ease_factor: number;
};

type AssistantThreadSnapshot = {
  session_state: Record<string, unknown>;
  runs: Array<{
    id: string;
    status: string;
    current_interrupt: unknown | null;
    steps: Array<{ step_index: number; tool_name: string | null; arguments: Record<string, unknown> }>;
  }>;
};

function getApiPythonCommand(): { command: string; args: string[] } {
  const explicitPython = process.env.STARLOG_ASSISTANT_E2E_API_PYTHON;
  if (explicitPython) {
    return { command: explicitPython, args: [] };
  }

  return {
    command: "uv",
    args: [
      "run",
      "--project",
      API_APP_DIR,
      "--extra",
      "dev",
      "--python",
      API_PYTHON_VERSION,
      "python",
    ],
  };
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) {
          resolve(address.port);
          return;
        }
        reject(new Error("Unable to allocate a local API port"));
      });
    });
  });
}

async function startMockRuntimeServer(): Promise<void> {
  const port = await getFreePort();
  mockRuntimeBase = `http://127.0.0.1:${port}`;
  mockRuntimeRequests.length = 0;

  mockRuntimeServer = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/execute") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = body ? JSON.parse(body) as Record<string, unknown> : {};
      mockRuntimeRequests.push(payload);
      const command = String(payload.text || "");
      if (mockReviewCardTarget && /review|grade|interview/i.test(command)) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          workflow: "chat_turn",
          provider_used: "mock_codex_bridge",
          model: "mock-agent-interview-review",
          response_text: "I can record that review result once you choose how it went.",
          parts: [
            {
              type: "text",
              id: "part_mock_agent_review_grade_text",
              text: "I can record that review result once you choose how it went.",
            },
          ],
          interrupts: [
            {
              tool_call_id: "toolcall_mock_agent_review_grade",
              tool_name: "grade_review_recall",
              interrupt_type: "choice",
              title: "Grade application review",
              body: "Choose the grade for the interview-prep card you just answered.",
              primary_label: "Record grade",
              secondary_label: "Not now",
              defer_label: "Not now",
              fields: [
                {
                  id: "rating",
                  kind: "select",
                  label: "Review quality",
                  value: "3",
                  required: true,
                  options: [
                    { label: "Again", value: "1" },
                    { label: "Hard", value: "3" },
                    { label: "Good", value: "4" },
                    { label: "Easy", value: "5" },
                  ],
                },
              ],
              display_mode: "composer",
              renderer_key: "interview.review_grade",
              renderer_version: 1,
              placement: "inline",
              structured_content: {
                card_id: mockReviewCardTarget.cardId,
                prompt: mockReviewCardTarget.prompt,
                review_mode: mockReviewCardTarget.reviewMode,
              },
              ui_meta: {
                tone: "review",
                review_mode: mockReviewCardTarget.reviewMode,
                card_type: mockReviewCardTarget.cardType,
              },
              consequence_preview: "Updates the SRS schedule for this interview-prep card.",
              recommended_defaults: { rating: "4" },
              entity_ref: {
                entity_type: "card",
                entity_id: mockReviewCardTarget.cardId,
                title: mockReviewCardTarget.prompt,
                href: "/review",
              },
              metadata: {
                card_id: mockReviewCardTarget.cardId,
                card_type: mockReviewCardTarget.cardType,
                review_mode: mockReviewCardTarget.reviewMode,
                prompt: mockReviewCardTarget.prompt,
                planned_tool_name: "grade_review_recall",
                planned_arguments: { card_id: mockReviewCardTarget.cardId },
                display_mode: "composer",
                option_descriptions: {
                  "1": "Review soon.",
                  "3": "Keep it close.",
                  "4": "Move forward.",
                  "5": "Stretch interval.",
                },
              },
            },
          ],
        }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        workflow: "chat_turn",
        provider_used: "mock_codex_bridge",
        model: "mock-agent-dynamic-panel",
        response_text: "I can create that Planner task once you pick a due date.",
        parts: [
          {
            type: "text",
            id: "part_mock_agent_due_date_text",
            text: "I can create that Planner task once you pick a due date.",
          },
        ],
        interrupts: [
          {
            tool_call_id: "toolcall_mock_agent_due_date",
            tool_name: "request_due_date",
            interrupt_type: "form",
            title: "Finish task details",
            body: "Pick a due date so the mocked agent can create the task.",
            primary_label: "Create task",
            secondary_label: "Not now",
            defer_label: "Not now",
            fields: [
              { id: "due_date", kind: "date", label: "Due date", required: true },
              { id: "priority", kind: "priority", label: "Priority", value: 2, min: 1, max: 5 },
            ],
            display_mode: "composer",
            consequence_preview: "Creates a Planner task after confirmation.",
            recommended_defaults: { priority: 2 },
            entity_ref: {
              entity_type: "task",
              entity_id: "draft:Prepare diffusion follow-up",
              title: "Prepare diffusion follow-up",
            },
            metadata: {
              planned_tool_name: "create_task",
              planned_arguments: { title: "Prepare diffusion follow-up", priority: 2 },
              user_content: command,
              display_mode: "composer",
            },
          },
        ],
      }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    mockRuntimeServer?.once("error", reject);
    mockRuntimeServer?.listen(port, "127.0.0.1", () => resolve());
  });
}

async function stopMockRuntimeServer(): Promise<void> {
  if (!mockRuntimeServer) {
    return;
  }
  await new Promise<void>((resolve) => {
    mockRuntimeServer?.close(() => resolve());
    setTimeout(resolve, 3_000);
  });
  mockRuntimeServer = null;
  mockRuntimeBase = "";
}

async function waitForApiHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + API_HEALTH_TIMEOUT_MS;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/v1/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Timed out waiting for Starlog API at ${baseUrl}. Last error: ${String(lastError)}\n${apiOutput}`,
  );
}

async function startApiServer(): Promise<void> {
  const port = await getFreePort();
  apiBase = `http://127.0.0.1:${port}`;
  apiDbPath = path.join(tmpdir(), `starlog-assistant-dynamic-ui-e2e-${process.pid}-${Date.now()}.db`);
  const apiPython = getApiPythonCommand();
  apiProcess = spawn(
    apiPython.command,
    [
      ...apiPython.args,
      "-m",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--app-dir",
      API_APP_DIR,
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: API_APP_DIR,
        STARLOG_DB_PATH: apiDbPath,
        STARLOG_AI_RUNTIME_BASE_URL: mockRuntimeBase || process.env.STARLOG_AI_RUNTIME_BASE_URL || "",
        STARLOG_CORS_ALLOW_ORIGINS: "http://127.0.0.1:3005,http://localhost:3005",
      },
    },
  );

  apiProcess.stdout.on("data", (chunk) => {
    apiOutput += chunk.toString();
  });
  apiProcess.stderr.on("data", (chunk) => {
    apiOutput += chunk.toString();
  });
  apiProcess.once("error", (error) => {
    apiOutput += `\nFailed to start Starlog API command ${apiPython.command}: ${error.message}`;
  });

  apiProcess.once("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      apiOutput += `\nStarlog API exited unexpectedly with code ${code} and signal ${signal}.`;
    }
  });

  await waitForApiHealth(apiBase);
}

async function stopApiServer(): Promise<void> {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      apiProcess?.once("exit", resolve);
      setTimeout(resolve, 3_000);
    });
  }
  apiProcess = null;

  if (apiDbPath) {
    for (const dbFile of [apiDbPath, `${apiDbPath}-shm`, `${apiDbPath}-wal`]) {
      if (existsSync(dbFile)) {
        rmSync(dbFile, { force: true });
      }
    }
  }
  apiDbPath = "";
}

async function bootstrapAndLogin(request: APIRequestContext): Promise<string> {
  const bootstrap = await request.post(`${apiBase}/v1/auth/bootstrap`, {
    data: { passphrase: TEST_PASSPHRASE },
  });
  expect([201, 409]).toContain(bootstrap.status());

  const login = await request.post(`${apiBase}/v1/auth/login`, {
    data: { passphrase: TEST_PASSPHRASE },
  });
  expect(login.ok()).toBeTruthy();

  return ((await login.json()) as AuthResponse).access_token;
}

async function seedBrowserSession(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ({ baseUrl, accessToken }) => {
      window.localStorage.setItem("starlog-api-base", baseUrl);
      window.localStorage.setItem("starlog-token", accessToken);
    },
    { baseUrl: apiBase, accessToken: token },
  );
}
async function seedBrowserVoiceCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
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
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(stream: MediaStream) {
        this.stream = stream;
      }

      start(): void {
        // The Assistant voice UI only needs a non-empty recording for this e2e proof.
      }

      stop(): void {
        const blob = new Blob(["voice-review-grade-command"], { type: this.mimeType });
        this.ondataavailable?.({ data: blob });
        this.onstop?.();
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });
  });
}


test.beforeAll(async () => {
  await startMockRuntimeServer();
  await startApiServer();
});

test.afterAll(async () => {
  await stopApiServer();
  await stopMockRuntimeServer();
});

test("creates a task through the deterministic Assistant due-date dynamic panel", async ({ page, request }) => {
  const token = await bootstrapAndLogin(request);
  await seedBrowserSession(page, token);

  const dueDate = "2026-05-14";
  await page.goto("/assistant");

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill("create task Review the diffusion notes");
  await page.getByRole("button", { name: "Send" }).click();

  const taskPanel = page.locator('[data-panel-tool="request_due_date"]');
  await expect(taskPanel).toBeVisible();
  await expect(taskPanel).toContainText("Task setup");
  await expect(taskPanel.getByLabel("Task preview")).toContainText("Review the diffusion notes");

  await taskPanel.getByLabel("Due date").fill(dueDate);
  await taskPanel.getByRole("radio", { name: "Priority 4" }).click();

  const expectedDueAt = await page.evaluate((selectedDueDate) => new Date(`${selectedDueDate}T00:00:00`).toISOString(), dueDate);
  await taskPanel.getByRole("button", { name: "Create task" }).click();

  const createdTaskConfirmation = page.getByText("Created task Review the diffusion notes.");
  await expect(createdTaskConfirmation.first()).toBeVisible();
  await expect(taskPanel).toHaveCount(0);

  const tasksResponse = await request.get(`${apiBase}/v1/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(tasksResponse.ok()).toBeTruthy();

  const tasks = (await tasksResponse.json()) as TaskResponse[];
  const createdTask = tasks.find((task) => task.title === "Review the diffusion notes");
  expect(createdTask).toBeTruthy();
  expect(createdTask?.priority).toBe(4);
  expect(createdTask?.due_at ? new Date(createdTask.due_at).toISOString() : null).toBe(expectedDueAt);
});

test("creates a task through a mocked agent-emitted dynamic panel", async ({ page, request }) => {
  const token = await bootstrapAndLogin(request);
  await seedBrowserSession(page, token);

  const command = "help me schedule the diffusion follow-up";
  const dueDate = "2026-05-29";
  await page.goto("/assistant");

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  const taskPanel = page.locator('[data-panel-tool="request_due_date"]');
  await expect(taskPanel).toBeVisible();
  await expect(taskPanel).toContainText("Task setup");
  await expect(taskPanel.getByLabel("Task preview")).toContainText("Prepare diffusion follow-up");
  await expect(taskPanel).toContainText("Pick a due date so the mocked agent can create the task.");

  expect(mockRuntimeRequests).toHaveLength(1);
  expect(mockRuntimeRequests[0].text).toBe(command);
  expect(mockRuntimeRequests[0].context).toEqual(
    expect.objectContaining({
      ui_capabilities: expect.objectContaining({ version: expect.any(String) }),
    }),
  );

  await taskPanel.getByLabel("Due date").fill(dueDate);
  await taskPanel.getByRole("radio", { name: "Priority 5" }).click();

  const expectedDueAt = await page.evaluate((selectedDueDate) => new Date(`${selectedDueDate}T00:00:00`).toISOString(), dueDate);
  await taskPanel.getByRole("button", { name: "Create task" }).click();

  await expect(page.getByText("Created task Prepare diffusion follow-up.").first()).toBeVisible();
  await expect(taskPanel).toHaveCount(0);

  const tasksResponse = await request.get(`${apiBase}/v1/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(tasksResponse.ok()).toBeTruthy();

  const tasks = (await tasksResponse.json()) as TaskResponse[];
  const createdTask = tasks.find((task) => task.title === "Prepare diffusion follow-up");
  expect(createdTask).toBeTruthy();
  expect(createdTask?.priority).toBe(5);
  expect(createdTask?.due_at ? new Date(createdTask.due_at).toISOString() : null).toBe(expectedDueAt);

  const threadResponse = await request.get(`${apiBase}/v1/assistant/threads/primary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(threadResponse.ok()).toBeTruthy();
  const thread = (await threadResponse.json()) as AssistantThreadSnapshot;
  const runtimeRun = thread.runs.find((run) =>
    run.steps.some((step) => step.tool_name === "chat_turn_runtime") &&
    run.steps.some((step) => step.tool_name === "create_task" && step.arguments.title === "Prepare diffusion follow-up"),
  );
  expect(runtimeRun).toBeTruthy();
  expect(runtimeRun?.status).toBe("completed");
  expect(runtimeRun?.current_interrupt).toBeNull();
  expect(runtimeRun?.steps.map((step) => step.step_index)).toEqual([0, 1, 2]);
  expect(runtimeRun?.steps.map((step) => step.tool_name)).toEqual(["request_due_date", "chat_turn_runtime", "create_task"]);
});

test("grades an interview-prep review card through a mocked agent-emitted dynamic panel", async ({ page, request }) => {
  const token = await bootstrapAndLogin(request);
  await seedBrowserSession(page, token);

  const prompt = "Apply sliding window invariants to a longest-subarray interview problem.";
  const createCardResponse = await request.post(`${apiBase}/v1/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      prompt,
      answer: "Maintain a valid window, advance the left bound when invalid, and update the best length after restoring validity.",
      card_type: "scenario",
      due_at: "2026-05-01T00:00:00.000Z",
      interval_days: 1,
      repetitions: 0,
      ease_factor: 2.5,
      tags: ["interview-prep", "sliding-window"],
    },
  });
  expect(createCardResponse.ok()).toBeTruthy();
  const card = (await createCardResponse.json()) as CardResponse;
  mockReviewCardTarget = {
    cardId: card.id,
    prompt: card.prompt,
    cardType: card.card_type,
    reviewMode: card.review_mode,
  };

  const dueBeforeResponse = await request.get(`${apiBase}/v1/cards/due`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(dueBeforeResponse.ok()).toBeTruthy();
  const dueBefore = (await dueBeforeResponse.json()) as CardResponse[];
  expect(dueBefore.some((dueCard) => dueCard.id === card.id)).toBeTruthy();

  mockRuntimeRequests.length = 0;
  const command = "I answered the current interview prep review card; grade it";
  await page.goto("/assistant");

  await page.getByPlaceholder("Ask, capture, plan, review, or move something forward...").fill(command);
  await page.getByRole("button", { name: "Send" }).click();

  const main = page.locator("main");
  const rawProtocolText = /renderer_key|tool_name|tool_call|tool_result|starlog-interrupt-request|Fallback|Diagnostic|Raw|ui_tool|domain_tool|grade_review_recall/i;
  const reviewPanel = page.getByTestId("assistant-ui-review-grade");
  await expect(reviewPanel).toHaveAttribute("data-dynamic-ui-renderer", "interview.review_grade");
  await expect(reviewPanel.getByText("Interview review", { exact: true })).toBeVisible();
  await expect(reviewPanel.getByLabel("Interview review prompt")).toContainText(prompt);
  await expect(reviewPanel.getByText("Updates the SRS schedule for this interview-prep card.")).toBeVisible();
  await expect(reviewPanel.getByRole("radiogroup", { name: "Review quality" })).toBeVisible();
  await expect(main).not.toContainText(rawProtocolText);

  expect(mockRuntimeRequests).toHaveLength(1);
  expect(mockRuntimeRequests[0].text).toBe(command);
  expect(mockRuntimeRequests[0].context).toEqual(
    expect.objectContaining({
      ui_capabilities: expect.objectContaining({ version: expect.any(String) }),
    }),
  );

  await reviewPanel.getByRole("radio", { name: "Good" }).click();
  await reviewPanel.getByRole("button", { name: "Record grade" }).click();

  await expect(page.getByText(`Recorded Good for ${card.review_mode} review: ${prompt}`).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Record grade" })).toHaveCount(0);
  await expect(main).not.toContainText(rawProtocolText);

  const cardsResponse = await request.get(`${apiBase}/v1/cards`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(cardsResponse.ok()).toBeTruthy();
  const cards = (await cardsResponse.json()) as CardResponse[];
  const reviewedCard = cards.find((candidate) => candidate.id === card.id);
  expect(reviewedCard).toBeTruthy();
  expect(reviewedCard?.repetitions).toBe(1);
  expect(reviewedCard?.interval_days).toBe(1);
  expect(reviewedCard?.due_at ? Date.parse(reviewedCard.due_at) : 0).toBeGreaterThan(Date.parse(card.due_at));

  const dueAfterResponse = await request.get(`${apiBase}/v1/cards/due`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(dueAfterResponse.ok()).toBeTruthy();
  const dueAfter = (await dueAfterResponse.json()) as CardResponse[];
  expect(dueAfter.some((dueCard) => dueCard.id === card.id)).toBeFalsy();

  const threadResponse = await request.get(`${apiBase}/v1/assistant/threads/primary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(threadResponse.ok()).toBeTruthy();
  const thread = (await threadResponse.json()) as AssistantThreadSnapshot;
  const reviewRun = thread.runs.find((run) =>
    run.steps.some((step) => step.tool_name === "chat_turn_runtime") &&
    run.steps.some((step) => step.tool_name === "grade_review_recall" && step.arguments.rating === 4),
  );
  expect(reviewRun).toBeTruthy();
  expect(reviewRun?.status).toBe("completed");
  expect(reviewRun?.current_interrupt).toBeNull();
  expect(reviewRun?.steps.map((step) => step.step_index)).toEqual([0, 1, 2]);
  expect(reviewRun?.steps.map((step) => step.tool_name)).toEqual(["grade_review_recall", "chat_turn_runtime", "grade_review_recall"]);
  expect(thread.session_state).toEqual(
    expect.objectContaining({
      last_turn_kind: "chat_turn",
      last_user_message: command,
      last_matched_intent: "grade_review_recall",
      last_status: "executed",
      last_tool_names: ["grade_review_recall"],
      last_chat_turn_provider: "mock_codex_bridge",
      last_chat_turn_model: "mock-agent-interview-review",
      last_assistant_response: expect.stringContaining(`Recorded Good for ${card.review_mode} review: ${prompt}`),
      last_review_grade: expect.objectContaining({
        card_id: card.id,
        rating: 4,
        rating_label: "Good",
        review_mode: card.review_mode,
      }),
    }),
  );

  mockReviewCardTarget = null;
});


test("grades an interview-prep review card from a PWA voice command through the Assistant thread", async ({ page, request }) => {
  const token = await bootstrapAndLogin(request);
  await seedBrowserSession(page, token);
  await seedBrowserVoiceCapture(page);

  const prompt = "Use two pointers to explain a minimum-window interview prompt.";
  const createCardResponse = await request.post(`${apiBase}/v1/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      prompt,
      answer: "Expand the right pointer, count needed characters, then shrink the left pointer while preserving validity.",
      card_type: "scenario",
      due_at: "2026-05-01T00:00:00.000Z",
      interval_days: 1,
      repetitions: 0,
      ease_factor: 2.5,
      tags: ["interview-prep", "two-pointers", "voice"],
    },
  });
  expect(createCardResponse.ok()).toBeTruthy();
  const card = (await createCardResponse.json()) as CardResponse;
  mockReviewCardTarget = {
    cardId: card.id,
    prompt: card.prompt,
    cardType: card.card_type,
    reviewMode: card.review_mode,
  };

  const dueBeforeResponse = await request.get(`${apiBase}/v1/cards/due`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(dueBeforeResponse.ok()).toBeTruthy();
  const dueBefore = (await dueBeforeResponse.json()) as CardResponse[];
  expect(dueBefore.some((dueCard) => dueCard.id === card.id)).toBeTruthy();

  mockRuntimeRequests.length = 0;
  const transcript = "I answered the current interview prep review card; grade it from voice";
  await page.goto("/assistant");

  const holdToTalk = page.getByTestId("assistant-voice-control");
  await expect(holdToTalk).toBeEnabled();
  await holdToTalk.focus();
  await expect(holdToTalk).toBeFocused();
  await page.keyboard.down("Space");
  await expect(page.getByText("Recording voice command...")).toBeVisible();
  await page.keyboard.up("Space");
  await expect(page.getByText("Voice clip captured and ready for upload.")).toBeVisible();

  const voiceUploadResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/voice"),
  );
  await page.getByRole("button", { name: /Plan voice/i }).click();
  const upload = await voiceUploadResponse;
  expect(upload.status()).toBe(201);
  const voiceJob = (await upload.json()) as { id: string; action: string; status: string };
  expect(voiceJob.action).toBe("assistant_thread_voice");
  await expect(page.getByText(/Uploaded 1 queued voice command/i)).toBeVisible();
  await expect(page.getByText(voiceJob.id, { exact: false })).toBeVisible();

  const claim = await request.post(`${apiBase}/v1/ai/jobs/${voiceJob.id}/claim`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { worker_id: "pwa-voice-thread-e2e" },
  });
  expect(claim.ok()).toBeTruthy();

  const complete = await request.post(`${apiBase}/v1/ai/jobs/${voiceJob.id}/complete`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      worker_id: "pwa-voice-thread-e2e",
      provider_used: "whisper_local_mock",
      output: { transcript },
    },
  });
  expect(complete.ok()).toBeTruthy();
  const completedPayload = await complete.json() as {
    output: { assistant_thread: { run_status: string; transcript: string } };
  };
  expect(completedPayload.output.assistant_thread.run_status).toBe("interrupted");
  expect(completedPayload.output.assistant_thread.transcript).toBe(transcript);

  await page.reload();

  const main = page.locator("main");
  const rawProtocolText = /renderer_key|tool_name|tool_call|tool_result|starlog-interrupt-request|Fallback|Diagnostic|Raw|ui_tool|domain_tool|grade_review_recall/i;
  const reviewPanel = page.getByTestId("assistant-ui-review-grade").filter({ hasText: prompt });
  await expect(reviewPanel).toHaveAttribute("data-dynamic-ui-renderer", "interview.review_grade");
  await expect(reviewPanel.getByText("Interview review", { exact: true })).toBeVisible();
  await expect(reviewPanel.getByLabel("Interview review prompt")).toContainText(prompt);
  await expect(reviewPanel.getByText("Updates the SRS schedule for this interview-prep card.")).toBeVisible();
  await expect(reviewPanel.getByRole("radiogroup", { name: "Review quality" })).toBeVisible();
  await expect(main).not.toContainText(rawProtocolText);

  expect(mockRuntimeRequests).toHaveLength(1);
  expect(mockRuntimeRequests[0].text).toBe(transcript);
  expect(mockRuntimeRequests[0].context).toEqual(
    expect.objectContaining({
      ui_capabilities: expect.objectContaining({ version: expect.any(String) }),
    }),
  );

  await reviewPanel.getByRole("radio", { name: "Good" }).click();
  await reviewPanel.getByRole("button", { name: "Record grade" }).click();

  await expect(page.getByText(`Recorded Good for ${card.review_mode} review: ${prompt}`).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Record grade" })).toHaveCount(0);
  await expect(main).not.toContainText(rawProtocolText);

  const cardsResponse = await request.get(`${apiBase}/v1/cards`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(cardsResponse.ok()).toBeTruthy();
  const cards = (await cardsResponse.json()) as CardResponse[];
  const reviewedCard = cards.find((candidate) => candidate.id === card.id);
  expect(reviewedCard).toBeTruthy();
  expect(reviewedCard?.repetitions).toBe(1);
  expect(reviewedCard?.interval_days).toBe(1);
  expect(reviewedCard?.due_at ? Date.parse(reviewedCard.due_at) : 0).toBeGreaterThan(Date.parse(card.due_at));

  const dueAfterResponse = await request.get(`${apiBase}/v1/cards/due`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(dueAfterResponse.ok()).toBeTruthy();
  const dueAfter = (await dueAfterResponse.json()) as CardResponse[];
  expect(dueAfter.some((dueCard) => dueCard.id === card.id)).toBeFalsy();

  const threadResponse = await request.get(`${apiBase}/v1/assistant/threads/primary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(threadResponse.ok()).toBeTruthy();
  const thread = (await threadResponse.json()) as AssistantThreadSnapshot;
  const reviewRun = thread.runs.find((run) =>
    run.steps.some((step) => step.tool_name === "chat_turn_runtime") &&
    run.steps.some((step) => step.tool_name === "grade_review_recall" && step.arguments.rating === 4),
  );
  expect(reviewRun).toBeTruthy();
  expect(reviewRun?.status).toBe("completed");
  expect(reviewRun?.current_interrupt).toBeNull();
  expect(reviewRun?.steps.map((step) => step.step_index)).toEqual([0, 1, 2]);
  expect(reviewRun?.steps.map((step) => step.tool_name)).toEqual(["grade_review_recall", "chat_turn_runtime", "grade_review_recall"]);
  expect(thread.session_state).toEqual(
    expect.objectContaining({
      last_turn_kind: "chat_turn",
      last_user_message: transcript,
      last_matched_intent: "grade_review_recall",
      last_status: "executed",
      last_tool_names: ["grade_review_recall"],
      last_chat_turn_provider: "mock_codex_bridge",
      last_chat_turn_model: "mock-agent-interview-review",
      last_assistant_response: expect.stringContaining(`Recorded Good for ${card.review_mode} review: ${prompt}`),
      last_review_grade: expect.objectContaining({
        card_id: card.id,
        rating: 4,
        rating_label: "Good",
        review_mode: card.review_mode,
      }),
    }),
  );

  mockReviewCardTarget = null;
});

