export const STARLOG_DYNAMIC_RENDERER_KEYS = [
  "interview.topic_unlock",
  "interview.topic_read",
  "interview.question_request",
  "interview.review_grade",
  "interview.recommendation_reason",
  "interview.why_this_now",
] as const;

export const STARLOG_COMPATIBILITY_RENDERER_KEYS = [
  "request_due_date",
  "triage_capture",
  "resolve_planner_conflict",
  "grade_review_recall",
  "choose_morning_focus",
] as const;

export const FALLBACK_RENDERER_KEY = "fallback.unknown" as const;

export type StarlogDynamicRendererKey = (typeof STARLOG_DYNAMIC_RENDERER_KEYS)[number];
export type StarlogCompatibilityRendererKey = (typeof STARLOG_COMPATIBILITY_RENDERER_KEYS)[number];
export type StarlogKnownRendererKey = StarlogDynamicRendererKey | StarlogCompatibilityRendererKey;
export type StarlogRendererKey = StarlogKnownRendererKey | (string & {});

export function isStarlogKnownRendererKey(key: string | null | undefined): key is StarlogKnownRendererKey {
  return (
    typeof key === "string" &&
    ((STARLOG_DYNAMIC_RENDERER_KEYS as readonly string[]).includes(key) ||
      (STARLOG_COMPATIBILITY_RENDERER_KEYS as readonly string[]).includes(key))
  );
}
