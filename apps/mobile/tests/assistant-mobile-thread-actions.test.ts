import type { AssistantCard, AssistantCardAction } from "@starlog/contracts";
import { handleAssistantCardActionOnMobile } from "../src/assistant-mobile-thread-actions";
import type { MobileTab } from "../src/navigation";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");

type FetchCall = {
  url: string;
  init: RequestInit;
};

type Harness = {
  activated: MobileTab[];
  drafts: string[];
  statuses: string[];
  webPaths: Array<{ path: string; failureLabel: string }>;
  reloadConversationCount: number;
  reloadArtifactsCount: number;
  reloadDueCardsCount: number;
  options: Parameters<typeof handleAssistantCardActionOnMobile>[2];
};

function card(overrides: Partial<AssistantCard> = {}): AssistantCard {
  return {
    kind: "briefing",
    version: 1,
    title: "Morning briefing",
    body: "Review your calendar and the cards due today.",
    actions: [],
    metadata: {},
    ...overrides,
  };
}

function action(overrides: Partial<AssistantCardAction>): AssistantCardAction {
  return {
    id: "action-1",
    label: "Open",
    kind: "navigate",
    payload: {},
    ...overrides,
  };
}

function createHarness(): Harness {
  const harness: Harness = {
    activated: [],
    drafts: [],
    statuses: [],
    webPaths: [],
    reloadConversationCount: 0,
    reloadArtifactsCount: 0,
    reloadDueCardsCount: 0,
    options: {
      apiBase: "https://api.starlog.test",
      token: "mobile-token",
      activateSurface: (tab) => {
        harness.activated.push(tab);
      },
      setHomeDraft: (value) => {
        harness.drafts.push(value);
      },
      setStatus: (value) => {
        harness.statuses.push(value);
      },
      openWebPath: async (path, failureLabel) => {
        harness.webPaths.push({ path, failureLabel });
      },
      reloadConversation: async () => {
        harness.reloadConversationCount += 1;
      },
      reloadArtifacts: () => {
        harness.reloadArtifactsCount += 1;
      },
      reloadDueCards: () => {
        harness.reloadDueCardsCount += 1;
      },
    },
  };
  return harness;
}

async function withFetch(
  fetchImpl: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "text">>,
  run: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchImpl(String(input), init || {}) as Promise<Response>;
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runTests() {
  {
    const harness = createHarness();

    await handleAssistantCardActionOnMobile(
      action({
        id: "open-review",
        label: "Open Review",
        kind: "navigate",
        payload: { href: "/review?mode=due" },
      }),
      card({ kind: "review_queue" }),
      harness.options,
    );

    assert.deepEqual(harness.activated, ["review"]);
    assert.deepEqual(harness.webPaths, []);
    assert.deepEqual(harness.statuses, []);
  }

  {
    const harness = createHarness();

    await handleAssistantCardActionOnMobile(
      action({
        id: "open-library",
        label: "Open Library",
        kind: "navigate",
        payload: { href: "/library?artifact=artifact-123" },
      }),
      card({ kind: "knowledge_note" }),
      harness.options,
    );

    assert.deepEqual(harness.activated, ["library"]);
    assert.deepEqual(harness.webPaths, []);
    assert.deepEqual(harness.statuses, []);
  }

  {
    const harness = createHarness();

    await handleAssistantCardActionOnMobile(
      action({
        id: "ask-briefing",
        label: "Ask Assistant",
        kind: "composer",
        payload: { prompt: "Help me turn this briefing into a plan." },
      }),
      card({ kind: "briefing", body: "Fallback briefing body." }),
      harness.options,
    );

    assert.deepEqual(harness.activated, ["assistant"]);
    assert.deepEqual(harness.drafts, ["Help me turn this briefing into a plan."]);
    assert.deepEqual(harness.statuses, ['Loaded "Ask Assistant" into Assistant']);
  }

  {
    const harness = createHarness();
    const calls: FetchCall[] = [];

    await withFetch(
      async (url, init) => {
        calls.push({ url, init });
        return { ok: true, text: async () => "" };
      },
      async () => {
        await handleAssistantCardActionOnMobile(
          action({
            id: "snooze-review",
            label: "Snooze",
            kind: "mutation",
            payload: {
              endpoint: "/v1/review/cards/card-123/snooze",
              method: "PATCH",
              body: { until: "tomorrow" },
            },
          }),
          card({ kind: "review_queue", title: "Due review cards" }),
          harness.options,
        );
      },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://api.starlog.test/v1/review/cards/card-123/snooze");
    assert.equal(calls[0]?.init.method, "PATCH");
    assert.deepEqual(calls[0]?.init.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer mobile-token",
    });
    assert.equal(calls[0]?.init.body, JSON.stringify({ until: "tomorrow" }));
    assert.deepEqual(harness.statuses, ["Snooze...", "Snooze complete"]);
    assert.equal(harness.reloadConversationCount, 1);
    assert.equal(harness.reloadArtifactsCount, 0);
    assert.equal(harness.reloadDueCardsCount, 1);
  }

  {
    const harness = createHarness();
    let fetchCalled = false;

    await withFetch(
      async () => {
        fetchCalled = true;
        return { ok: true, text: async () => "" };
      },
      async () => {
        await handleAssistantCardActionOnMobile(
          action({
            id: "active-thread-panel",
            label: "Choose focus",
            kind: "interrupt",
            payload: {},
          }),
          card({ kind: "briefing" }),
          harness.options,
        );
      },
    );

    assert.equal(fetchCalled, false);
    assert.deepEqual(harness.statuses, ['Action "Choose focus" is missing an endpoint']);
    assert.equal(harness.reloadConversationCount, 0);
    assert.equal(harness.reloadArtifactsCount, 0);
    assert.equal(harness.reloadDueCardsCount, 0);
  }
}

runTests().catch((error: unknown) => {
  throw error;
});
