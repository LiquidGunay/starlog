import { deriveReviewStage } from "./mobile-review-view-model";

export type MobileReviewAssistantEventCard = {
  id: string;
  card_type?: string | null;
  review_mode?: string | null;
  prompt?: string | null;
  due_at?: string | null;
};

export type MobileReviewAssistantEventFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean }>;

const REVIEW_MODE_BY_CARD_TYPE: Record<string, string> = {
  qa: "recall",
  cloze: "recall",
  recall: "recall",
  understanding: "understanding",
  explain: "understanding",
  why: "understanding",
  application: "application",
  scenario: "application",
  drill: "application",
  synthesis: "synthesis",
  compare: "synthesis",
  connect: "synthesis",
  judgment: "judgment",
  tradeoff: "judgment",
  critique: "judgment",
};

export function buildReviewAnswerRevealedEventRequest(input: {
  apiBase: string;
  token: string;
  card: MobileReviewAssistantEventCard;
}) {
  const apiBase = normalizeBaseUrl(input.apiBase);
  const cardType = input.card.card_type?.trim() || "";
  const prompt = input.card.prompt?.trim() || "Review card";
  const reviewMode = input.card.review_mode?.trim() || reviewModeForCardType(cardType);
  const reviewStage = deriveReviewStage(cardType, prompt);

  return {
    url: `${apiBase}/v1/assistant/threads/primary/events`,
    init: {
      method: "POST" as const,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        source_surface: "review",
        kind: "review.answer.revealed",
        entity_ref: {
          entity_type: "card",
          entity_id: input.card.id,
          href: "/review",
          title: prompt,
        },
        payload: {
          card_id: input.card.id,
          card_type: cardType || undefined,
          review_mode: reviewMode,
          review_stage: reviewStage,
          prompt,
          due_at: input.card.due_at || undefined,
          label: `${reviewStage} answer revealed`,
          body: `Review answer revealed for: ${prompt}`,
        },
        visibility: "assistant_message",
      }),
    },
  };
}

export async function emitReviewAnswerRevealedEvent(input: {
  apiBase: string;
  token: string;
  card: MobileReviewAssistantEventCard | null | undefined;
  fetchImpl?: MobileReviewAssistantEventFetch;
}): Promise<boolean> {
  if (!input.card || !input.token.trim() || !input.apiBase.trim()) {
    return false;
  }

  try {
    const request = buildReviewAnswerRevealedEventRequest({
      apiBase: input.apiBase,
      token: input.token,
      card: input.card,
    });
    const fetchImpl = input.fetchImpl || fetch;
    const response = await fetchImpl(request.url, request.init);
    return response.ok;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function reviewModeForCardType(cardType: string): string {
  const normalized = cardType.trim().toLowerCase();
  if (REVIEW_MODE_BY_CARD_TYPE[normalized]) {
    return REVIEW_MODE_BY_CARD_TYPE[normalized];
  }
  if (normalized.includes("judgment") || normalized.includes("tradeoff") || normalized.includes("critique")) {
    return "judgment";
  }
  if (normalized.includes("synthesis") || normalized.includes("compare") || normalized.includes("connect")) {
    return "synthesis";
  }
  if (normalized.includes("application") || normalized.includes("scenario") || normalized.includes("drill")) {
    return "application";
  }
  if (normalized.includes("understanding") || normalized.includes("explain") || normalized.includes("why")) {
    return "understanding";
  }
  return "recall";
}
