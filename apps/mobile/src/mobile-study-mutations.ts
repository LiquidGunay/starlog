export type MobileStudyMutationAction = "unlock" | "read";
export type MobileStudyQuestionMode = "recall" | "application";

export type MobileStudyTopicRef = {
  id: string;
  title: string;
};

export type MobileStudyMutationFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json?: () => Promise<unknown>;
}>;

export type MobileStudyMutationRequest = {
  url: string;
  init: {
    method: "POST";
    headers: Record<string, string>;
    body?: string;
  };
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export function studyQuestionPrompt(
  topic: Pick<MobileStudyTopicRef, "title">,
  mode: MobileStudyQuestionMode,
): string {
  if (mode === "application") {
    return `Create one application interview question for "${topic.title}" that forces me to use the idea in a realistic coding or system-design scenario.`;
  }
  return `Create one concise recall question for "${topic.title}" and keep it answerable from the source material.`;
}

export function buildUpdateStudyTopicRequest(input: {
  apiBase: string;
  token: string;
  topic: Pick<MobileStudyTopicRef, "id">;
  action: MobileStudyMutationAction;
}): MobileStudyMutationRequest {
  const apiBase = normalizeBaseUrl(input.apiBase);
  return {
    url: `${apiBase}/v1/study/topics/${encodeURIComponent(input.topic.id)}/${input.action}`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
      },
    },
  };
}

export function buildStudyQuestionRequest(input: {
  apiBase: string;
  token: string;
  topic: Pick<MobileStudyTopicRef, "id" | "title">;
  mode: MobileStudyQuestionMode;
}): MobileStudyMutationRequest {
  const apiBase = normalizeBaseUrl(input.apiBase);
  return {
    url: `${apiBase}/v1/study/question-requests`,
    init: {
      method: "POST",
      headers: jsonHeaders(input.token),
      body: JSON.stringify({
        topic_id: input.topic.id,
        question: studyQuestionPrompt(input.topic, input.mode),
        response: {
          question_preference: input.mode,
        },
      }),
    },
  };
}

export async function executeUpdateStudyTopicMutation<UpdatedTopic>(input: {
  apiBase: string;
  token: string;
  topic: Pick<MobileStudyTopicRef, "id">;
  action: MobileStudyMutationAction;
  fetchImpl?: MobileStudyMutationFetch;
}): Promise<UpdatedTopic> {
  const request = buildUpdateStudyTopicRequest(input);
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(request.url, request.init);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Study topic ${input.action} failed: ${response.status} ${errorBody}`);
  }

  if (typeof response.json !== "function") {
    throw new Error(`Study topic ${input.action} response missing JSON body`);
  }

  return (await response.json()) as UpdatedTopic;
}

export async function executeRequestStudyQuestion(input: {
  apiBase: string;
  token: string;
  topic: Pick<MobileStudyTopicRef, "id" | "title">;
  mode: MobileStudyQuestionMode;
  fetchImpl?: MobileStudyMutationFetch;
}): Promise<void> {
  const request = buildStudyQuestionRequest(input);
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(request.url, request.init);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Study question request failed: ${response.status} ${errorBody}`);
  }
}
