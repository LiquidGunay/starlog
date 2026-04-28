import {
  buildReviewAnswerRevealedEventRequest,
  emitReviewAnswerRevealedEvent,
  type MobileReviewAssistantEventFetch,
} from "../src/mobile-review-assistant-events";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");

const card = {
  id: "card-123",
  card_type: "application_case",
  prompt: "Apply retrieval practice to a planning workflow.",
  due_at: "2026-04-28T12:00:00Z",
};

const request = buildReviewAnswerRevealedEventRequest({
  apiBase: " https://api.starlog.test/ ",
  token: "mobile-token",
  card,
});
const body = JSON.parse(request.init.body);

assert.equal(request.url, "https://api.starlog.test/v1/assistant/threads/primary/events");
assert.equal(request.init.method, "POST");
assert.deepEqual(request.init.headers, {
  "Content-Type": "application/json",
  Authorization: "Bearer mobile-token",
});
assert.equal(body.source_surface, "review");
assert.equal(body.kind, "review.answer.revealed");
assert.deepEqual(body.entity_ref, {
  entity_type: "card",
  entity_id: "card-123",
  href: "/review",
  title: "Apply retrieval practice to a planning workflow.",
});
assert.deepEqual(body.payload, {
  card_id: "card-123",
  card_type: "application_case",
  review_mode: "application",
  review_stage: "Application",
  prompt: "Apply retrieval practice to a planning workflow.",
  due_at: "2026-04-28T12:00:00Z",
  label: "Application answer revealed",
  body: "Review answer revealed for: Apply retrieval practice to a planning workflow.",
});
assert.equal(body.visibility, "assistant_message");

runFunctionalPaths().catch((error: unknown) => {
  throw error;
});

async function runFunctionalPaths() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const okFetch: MobileReviewAssistantEventFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true };
  };

  const emitted = await emitReviewAnswerRevealedEvent({
    apiBase: "https://api.starlog.test/",
    token: "mobile-token",
    card,
    fetchImpl: okFetch,
  });

  assert.equal(emitted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.starlog.test/v1/assistant/threads/primary/events");
  assert.equal((calls[0]?.body as { payload: { card_id: string } }).payload.card_id, "card-123");

  const guardedCalls: string[] = [];
  const guardedFetch: MobileReviewAssistantEventFetch = async (url) => {
    guardedCalls.push(url);
    return { ok: true };
  };

  assert.equal(
    await emitReviewAnswerRevealedEvent({
      apiBase: "https://api.starlog.test",
      token: "mobile-token",
      card: null,
      fetchImpl: guardedFetch,
    }),
    false,
  );
  assert.equal(
    await emitReviewAnswerRevealedEvent({
      apiBase: "https://api.starlog.test",
      token: " ",
      card,
      fetchImpl: guardedFetch,
    }),
    false,
  );
  assert.equal(
    await emitReviewAnswerRevealedEvent({
      apiBase: " ",
      token: "mobile-token",
      card,
      fetchImpl: guardedFetch,
    }),
    false,
  );
  assert.equal(guardedCalls.length, 0);

  assert.equal(
    await emitReviewAnswerRevealedEvent({
      apiBase: "https://api.starlog.test",
      token: "mobile-token",
      card,
      fetchImpl: async () => ({ ok: false }),
    }),
    false,
  );
  assert.equal(
    await emitReviewAnswerRevealedEvent({
      apiBase: "https://api.starlog.test",
      token: "mobile-token",
      card,
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
    }),
    false,
  );
}
