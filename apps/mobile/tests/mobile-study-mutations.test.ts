import {
  executeRequestStudyQuestion,
  executeUpdateStudyTopicMutation,
  buildStudyQuestionRequest,
  buildUpdateStudyTopicRequest,
  studyQuestionPrompt,
  type MobileStudyMutationFetch,
} from "../src/mobile-study-mutations";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
  rejects: (...args: unknown[]) => Promise<unknown>;
};

const assert = require("node:assert/strict");

const topic = {
  id: "topic-1",
  title: "Binary Search for Interview Prep",
};

assert.equal(
  studyQuestionPrompt(topic, "recall"),
  'Create one concise recall question for "Binary Search for Interview Prep" and keep it answerable from the source material.',
);
assert.equal(
  studyQuestionPrompt(topic, "application"),
  'Create one application interview question for "Binary Search for Interview Prep" that forces me to use the idea in a realistic coding or system-design scenario.',
);

const updateRequest = buildUpdateStudyTopicRequest({
  apiBase: " https://api.starlog.test/ ",
  token: "mobile-token",
  topic,
  action: "unlock",
});
assert.equal(updateRequest.url, "https://api.starlog.test/v1/study/topics/topic-1/unlock");
assert.deepEqual(updateRequest.init, {
  method: "POST",
  headers: {
    Authorization: "Bearer mobile-token",
  },
});

const questionRequest = buildStudyQuestionRequest({
  apiBase: "https://api.starlog.test",
  token: "mobile-token",
  topic,
  mode: "application",
});
assert.equal(questionRequest.url, "https://api.starlog.test/v1/study/question-requests");
assert.deepEqual(questionRequest.init.headers, {
  "Content-Type": "application/json",
  Authorization: "Bearer mobile-token",
});

const questionBody = JSON.parse(questionRequest.init.body || "{}");
assert.deepEqual(questionBody, {
  topic_id: "topic-1",
  question:
    'Create one application interview question for "Binary Search for Interview Prep" that forces me to use the idea in a realistic coding or system-design scenario.',
  response: {
    question_preference: "application",
  },
});

runFunctionalPaths().catch((error: unknown) => {
  throw error;
});

async function runFunctionalPaths() {
  const calls: Array<{ url: string; body: string }> = [];
  const okFetch: MobileStudyMutationFetch = async (url, init) => {
    calls.push({ url, body: init.body || "" });
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ id: "topic-1", status: "unlocked" }),
    };
  };

  const updated = await executeUpdateStudyTopicMutation<{
    id: string;
    status: "unlocked";
  }>({
    apiBase: "https://api.starlog.test",
    token: "mobile-token",
    topic,
    action: "unlock",
    fetchImpl: okFetch,
  });

  assert.deepEqual(updated, { id: "topic-1", status: "unlocked" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.starlog.test/v1/study/topics/topic-1/unlock");

  await executeRequestStudyQuestion({
    apiBase: "https://api.starlog.test",
    token: "mobile-token",
    topic,
    mode: "recall",
    fetchImpl: okFetch,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, "https://api.starlog.test/v1/study/question-requests");
  const requestPayload = JSON.parse(calls[1]?.body || "{}");
  assert.equal(requestPayload.topic_id, "topic-1");
  assert.equal(requestPayload.response.question_preference, "recall");

  const guardedFetch: MobileStudyMutationFetch = async () => ({
    ok: false,
    status: 503,
    text: async () => "server down",
  });

  await assert.rejects(
    () =>
      executeUpdateStudyTopicMutation({
        apiBase: "https://api.starlog.test",
        token: "mobile-token",
        topic,
        action: "read",
        fetchImpl: guardedFetch,
      }),
    { message: "Study topic read failed: 503 server down" },
  );

  await assert.rejects(
    () =>
      executeRequestStudyQuestion({
        apiBase: "https://api.starlog.test",
        token: "mobile-token",
        topic,
        mode: "application",
        fetchImpl: guardedFetch,
      }),
    { message: "Study question request failed: 503 server down" },
  );

  const missingJsonFetch: MobileStudyMutationFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  });

  await assert.rejects(
    () =>
      executeUpdateStudyTopicMutation({
        apiBase: "https://api.starlog.test",
        token: "mobile-token",
        topic,
        action: "read",
        fetchImpl: missingJsonFetch,
      }),
    { message: "Study topic read response missing JSON body" },
  );

  console.log("mobile study mutation tests passed");
}
