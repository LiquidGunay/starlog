import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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

type AuthResponse = {
  access_token: string;
};

type TaskResponse = {
  title: string;
  priority: number;
  due_at: string | null;
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
  expect(bootstrap.status()).toBe(201);

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

test.beforeAll(async () => {
  await startApiServer();
});

test.afterAll(async () => {
  await stopApiServer();
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
