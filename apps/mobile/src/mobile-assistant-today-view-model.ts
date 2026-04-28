export type MobileAssistantTodayOpenLoop = {
  key: string;
  label: string;
  count: number;
  href?: string | null;
};

export type MobileAssistantTodayRecommendedMove = {
  key: string;
  title: string;
  body: string;
  surface: string;
  href?: string | null;
  action_label?: string | null;
  prompt?: string | null;
  priority: number;
  urgency: string;
};

export type MobileAssistantTodayQuickAction = {
  key: string;
  title: string;
  surface: string;
  href?: string | null;
  action_label?: string | null;
  prompt?: string | null;
  enabled: boolean;
  count: number;
  reason?: string | null;
  priority: number;
};

export type MobileAssistantTodaySummary = {
  date: string;
  thread_id?: string | null;
  active_run_count: number;
  open_interrupt_count: number;
  recent_surface_event_count: number;
  open_loops: MobileAssistantTodayOpenLoop[];
  recommended_next_move?: MobileAssistantTodayRecommendedMove | null;
  reason_stack?: string[] | null;
  at_a_glance?: MobileAssistantTodayOpenLoop[] | null;
  quick_actions?: MobileAssistantTodayQuickAction[] | null;
  generated_at: string;
};

export type MobileAssistantWeeklySignalCounts = Record<string, number | null | undefined>;

export type MobileAssistantWeeklyAdaptationOption = {
  key?: string | null;
  title?: string | null;
  label?: string | null;
  body?: string | null;
  summary?: string | null;
  detail?: string | null;
  surface?: string | null;
  href?: string | null;
  prompt?: string | null;
  action_label?: string | null;
  enabled?: boolean | null;
  reason?: string | null;
  status?: string | null;
  priority?: number | null;
};

export type MobileAssistantWeeklyAttentionItem = {
  key?: string | null;
  kind?: string | null;
  title?: string | null;
  label?: string | null;
  body?: string | null;
  summary?: string | null;
  detail?: string | null;
  surface?: string | null;
  href?: string | null;
  prompt?: string | null;
  action_label?: string | null;
  priority?: number | null;
  count?: number | null;
};

export type MobileAssistantWeeklySummary = {
  week_start?: string | null;
  week_end?: string | null;
  generated_at?: string | null;
  progress?: MobileAssistantWeeklySignalCounts | Array<string | MobileAssistantWeeklyAttentionItem> | null;
  slippage?: MobileAssistantWeeklySignalCounts | Array<string | MobileAssistantWeeklyAttentionItem> | null;
  adaptation_options?: MobileAssistantWeeklyAdaptationOption[] | null;
  attention_items?: MobileAssistantWeeklyAttentionItem[] | null;
  system_health?: {
    progress_signal_count?: number | null;
    slippage_signal_count?: number | null;
  } | null;
};

export type MobileAssistantTodayAction = {
  key: string;
  label: string;
  prompt?: string;
  href?: string;
  surface?: string;
  disabledReason?: string;
};

export type MobileAssistantTodayActionRoute =
  | { kind: "disabled"; reason: string }
  | { kind: "navigate"; href: string; surface?: string }
  | { kind: "prompt"; prompt: string }
  | { kind: "unavailable"; reason: string };

export type MobileAssistantTodayViewModel = {
  dateLabel: string;
  title: string;
  body: string;
  urgency: string;
  primaryAction: MobileAssistantTodayAction;
  promptChips: MobileAssistantTodayAction[];
  reasonStack: string[];
  openLoops: MobileAssistantTodayOpenLoop[];
};

export type MobileAssistantWeeklyMicroSignal = {
  title: string;
  reason: string;
  action: MobileAssistantTodayAction;
};

const FALLBACK_ASSISTANT_TODAY_SUMMARY: MobileAssistantTodaySummary = {
  date: "",
  thread_id: null,
  active_run_count: 0,
  open_interrupt_count: 0,
  recent_surface_event_count: 0,
  open_loops: [
    { key: "planner", label: "Planner", count: 0, href: "/planner" },
    { key: "library", label: "Library", count: 0, href: "/library" },
    { key: "review", label: "Review", count: 0, href: "/review" },
  ],
  recommended_next_move: {
    key: "plan_today_fallback",
    title: "Plan today",
    body: "Start with a short plan before adding more to the thread.",
    surface: "assistant",
    href: null,
    action_label: "Plan with Assistant",
    prompt: "Help me plan today around my schedule, tasks, and open loops.",
    priority: 10,
    urgency: "normal",
  },
  reason_stack: [
    "Current thread is ready for a fresh plan.",
    "A short plan gives the day a clean starting point.",
    "Major writes still need confirmation.",
  ],
  at_a_glance: [
    { key: "planner", label: "Planner", count: 0, href: "/planner" },
    { key: "library", label: "Library", count: 0, href: "/library" },
    { key: "review", label: "Review", count: 0, href: "/review" },
  ],
  quick_actions: [
    {
      key: "open_planner_fallback",
      title: "Open Planner",
      surface: "planner",
      href: "/planner",
      action_label: "Open Planner",
      prompt: null,
      enabled: true,
      count: 0,
      reason: null,
      priority: 10,
    },
    {
      key: "open_library_fallback",
      title: "Open Library",
      surface: "library",
      href: "/library",
      action_label: "Open Library",
      prompt: null,
      enabled: true,
      count: 0,
      reason: null,
      priority: 20,
    },
    {
      key: "start_review_fallback",
      title: "Open Review",
      surface: "review",
      href: "/review",
      action_label: "Open Review",
      prompt: null,
      enabled: true,
      count: 0,
      reason: null,
      priority: 30,
    },
  ],
  generated_at: "",
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasUsableAction(action: { prompt?: string | null; href?: string | null }): boolean {
  return Boolean(cleanString(action.prompt) || cleanString(action.href));
}

function normalizeAction(action: {
  key: string;
  title?: string | null;
  action_label?: string | null;
  prompt?: string | null;
  href?: string | null;
  surface?: string | null;
  enabled?: boolean;
  reason?: string | null;
}): MobileAssistantTodayAction | null {
  const label = cleanString(action.action_label) || cleanString(action.title);
  if (!label) {
    return null;
  }
  if (action.enabled === false) {
    return {
      key: action.key,
      label,
      surface: cleanString(action.surface) || undefined,
      disabledReason: cleanString(action.reason) || "Not available right now.",
    };
  }
  const prompt = cleanString(action.prompt);
  const href = cleanString(action.href);
  if (!prompt && !href) {
    return null;
  }
  const normalized: MobileAssistantTodayAction = {
    key: action.key,
    label,
    surface: cleanString(action.surface) || undefined,
  };
  if (prompt) {
    normalized.prompt = prompt;
  }
  if (href) {
    normalized.href = href;
  }
  return normalized;
}

export function localDateStringForAssistantToday(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildAssistantTodayQueryDate(date: Date = new Date()): string {
  return localDateStringForAssistantToday(date);
}

export function buildAssistantWeeklyQueryWeekStart(date: Date = new Date()): string {
  const start = new Date(date);
  const day = start.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - daysSinceMonday);
  return localDateStringForAssistantToday(start);
}

export function resolveMobileAssistantTodayActionRoute(action: MobileAssistantTodayAction): MobileAssistantTodayActionRoute {
  if (action.disabledReason) {
    return { kind: "disabled", reason: action.disabledReason };
  }
  const href = cleanString(action.href);
  const prompt = cleanString(action.prompt);
  const surface = cleanString(action.surface);
  if (href && surface !== "assistant") {
    return { kind: "navigate", href, surface: surface || undefined };
  }
  if (prompt) {
    return { kind: "prompt", prompt };
  }
  if (href) {
    return { kind: "navigate", href, surface: surface || undefined };
  }
  return { kind: "unavailable", reason: `${action.label} is not available yet` };
}

function fallbackAssistantTodaySummary(date = localDateStringForAssistantToday()): MobileAssistantTodaySummary {
  return {
    ...FALLBACK_ASSISTANT_TODAY_SUMMARY,
    date,
    open_loops: [...FALLBACK_ASSISTANT_TODAY_SUMMARY.open_loops],
    recommended_next_move: { ...FALLBACK_ASSISTANT_TODAY_SUMMARY.recommended_next_move! },
    reason_stack: [...(FALLBACK_ASSISTANT_TODAY_SUMMARY.reason_stack || [])],
    at_a_glance: [...(FALLBACK_ASSISTANT_TODAY_SUMMARY.at_a_glance || [])],
    quick_actions: [...(FALLBACK_ASSISTANT_TODAY_SUMMARY.quick_actions || [])],
  };
}

function compactOpenLoopContext(items: MobileAssistantTodayOpenLoop[]): MobileAssistantTodayOpenLoop[] {
  const positive = items.filter((item) => Number(item.count) > 0);
  const filler = items.filter((item) => Number(item.count) <= 0);
  return [...positive, ...filler].slice(0, 3);
}

function weeklyHasPositiveCounts(items: MobileAssistantWeeklySummary["progress"] | MobileAssistantWeeklySummary["slippage"]): boolean {
  if (!items) {
    return false;
  }
  if (Array.isArray(items)) {
    return items.some((item) => {
      if (typeof item === "string") {
        return Boolean(cleanString(item));
      }
      return Number(item.count) > 0 || Boolean(cleanString(item.title) || cleanString(item.label));
    });
  }
  return Object.values(items).some((value) => Number(value) > 0);
}

function weeklyHasMeaningfulContent(summary: MobileAssistantWeeklySummary): boolean {
  const health = summary.system_health;
  const healthSignals = Number(health?.progress_signal_count || 0) + Number(health?.slippage_signal_count || 0);
  return (
    healthSignals > 0 ||
    weeklyHasPositiveCounts(summary.progress) ||
    weeklyHasPositiveCounts(summary.slippage) ||
    (summary.adaptation_options || []).some((option) => option.enabled !== false && hasUsableAction(option)) ||
    (summary.attention_items || []).some((item) => Number(item.count) > 0 || hasUsableAction(item))
  );
}

function weeklyReason(item: {
  body?: string | null;
  summary?: string | null;
  detail?: string | null;
  reason?: string | null;
  status?: string | null;
}): string {
  return (
    cleanString(item.body) ||
    cleanString(item.summary) ||
    cleanString(item.detail) ||
    cleanString(item.reason) ||
    cleanString(item.status)
  );
}

function weeklyActionFromOption(
  option: MobileAssistantWeeklyAdaptationOption,
  index: number,
): MobileAssistantWeeklyMicroSignal | null {
  if (option.enabled === false || !hasUsableAction(option)) {
    return null;
  }
  const action = normalizeAction({
    key: cleanString(option.key) || `weekly-adaptation-${index}`,
    title: option.title,
    action_label: option.action_label,
    prompt: option.prompt,
    href: option.href,
    surface: option.surface,
    enabled: true,
  });
  const reason = weeklyReason(option);
  if (!action || !reason) {
    return null;
  }
  return {
    title: action.label,
    reason,
    action,
  };
}

function weeklyActionFromAttentionItem(
  item: MobileAssistantWeeklyAttentionItem,
  index: number,
): MobileAssistantWeeklyMicroSignal | null {
  const action = normalizeAction({
    key: cleanString(item.key) || cleanString(item.kind) || `weekly-attention-${index}`,
    title: item.title || item.label,
    action_label: item.action_label,
    prompt: item.prompt,
    href: item.href,
    surface: item.surface,
    enabled: true,
  });
  const reason = weeklyReason(item);
  if (!action || !reason) {
    return null;
  }
  return {
    title: action.label,
    reason,
    action,
  };
}

export function buildMobileAssistantWeeklyMicroSignal(
  summary: MobileAssistantWeeklySummary | null | undefined,
): MobileAssistantWeeklyMicroSignal | null {
  if (!summary || !weeklyHasMeaningfulContent(summary)) {
    return null;
  }

  for (const [index, option] of (summary.adaptation_options || []).entries()) {
    const signal = weeklyActionFromOption(option, index);
    if (signal) {
      return signal;
    }
  }

  const attentionItem = [...(summary.attention_items || [])]
    .filter((item) => Number(item.count) > 0 || hasUsableAction(item))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0];
  return attentionItem ? weeklyActionFromAttentionItem(attentionItem, 0) : null;
}

export function buildMobileAssistantTodayViewModel(
  summary: MobileAssistantTodaySummary | null | undefined,
): MobileAssistantTodayViewModel {
  const usableSummary =
    summary?.recommended_next_move && hasUsableAction(summary.recommended_next_move)
      ? summary
      : fallbackAssistantTodaySummary(summary?.date || undefined);
  const move = usableSummary.recommended_next_move!;

  const primaryAction = normalizeAction({
    key: move.key,
    title: move.title,
    action_label: move.action_label,
    prompt: move.prompt,
    href: move.href,
    surface: move.surface,
    enabled: true,
  })!;

  const reasonStack = [
    ...(usableSummary.reason_stack || []).map(cleanString).filter(Boolean),
    cleanString(move.body),
  ]
    .filter(Boolean)
    .slice(0, 4);

  const quickActions = [...(usableSummary.quick_actions || [])]
    .sort((a, b) => a.priority - b.priority)
    .map(normalizeAction)
    .filter((action): action is MobileAssistantTodayAction => Boolean(action))
    .filter((action) => action.key !== primaryAction.key && action.label !== primaryAction.label)
    .filter((action) => !action.disabledReason && hasUsableAction(action))
    .slice(0, 3);

  const loops = compactOpenLoopContext(usableSummary.at_a_glance?.length ? usableSummary.at_a_glance : usableSummary.open_loops);

  return {
    dateLabel: usableSummary.date,
    title: cleanString(move.title),
    body: cleanString(move.body),
    urgency: cleanString(move.urgency) || "normal",
    primaryAction,
    promptChips: quickActions,
    reasonStack,
    openLoops: loops,
  };
}
