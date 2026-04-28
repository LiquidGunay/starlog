export type PlannerCountBucket = {
  key: string;
  label: string;
  count: number;
};

export type MobilePlannerSummary = {
  date: string;
  task_buckets: PlannerCountBucket[];
  block_buckets: PlannerCountBucket[];
  calendar_event_count: number;
  conflict_count: number;
  focus_minutes: number;
  buffer_minutes: number;
  generated_at: string;
};

export type MobilePlannerMetric = {
  label: string;
  value: string;
  caption: string;
  tone: "focus" | "meeting" | "task" | "buffer";
};

export type MobilePlannerTimelineBlock = {
  id: string;
  timeLabel: string;
  durationLabel: string;
  title: string;
  detail: string;
  type: "focus" | "meeting" | "away" | "conflict" | "buffer" | "task";
};

export type MobilePlannerPlanItem = {
  id: string;
  title: string;
  detail: string;
  metaLabel: string;
  tone: "focus" | "meeting" | "task" | "buffer" | "done" | "conflict";
  completed?: boolean;
};

export type MobilePlannerPlanGroup = {
  title: string;
  summaryLabel: string;
  items: MobilePlannerPlanItem[];
  emptyLabel: string;
};

export type MobilePlannerDay = {
  key: string;
  weekday: string;
  day: string;
  active: boolean;
};

export type MobilePlannerDateControls = {
  selectedDate: string;
  todayDate: string;
  previousDate: string;
  nextDate: string;
  isToday: boolean;
};

export type MobilePlannerViewModel = {
  dateLabel: string;
  dateControls: MobilePlannerDateControls;
  statusLabel: string;
  decisionLabel: string;
  decisionDetail: string;
  dayStrip: MobilePlannerDay[];
  metrics: MobilePlannerMetric[];
  timelineBlocks: MobilePlannerTimelineBlock[];
  planGroups: MobilePlannerPlanGroup[];
  conflict: {
    title: string;
    body: string;
    severityLabel: string;
  } | null;
  nextFocus: {
    title: string;
    body: string;
    timeLabel: string;
    metaLabel: string;
  };
  upcoming: {
    title: string;
    body: string;
    timeLabel: string;
    metaLabel: string;
  };
  promptChips: string[];
};

export function deriveMobilePlannerViewModel(input: {
  summary?: MobilePlannerSummary | null;
  selectedDate?: string;
  now?: Date;
  nextActionPreview?: string;
  alarmScheduled?: boolean;
  nextBriefingCountdown?: string;
}): MobilePlannerViewModel {
  const now = input.now ?? new Date();
  const selectedDate = parsePlannerDate(input.selectedDate ?? input.summary?.date, now);
  const selectedDateKey = formatPlannerDateKey(selectedDate);
  const hasSummary = Boolean(input.summary);
  const focusMinutes = Math.max(0, input.summary?.focus_minutes ?? 0);
  const bufferMinutes = Math.max(0, input.summary?.buffer_minutes ?? 0);
  const meetingCount = Math.max(0, input.summary?.calendar_event_count ?? 0);
  const openTasks = bucketCount(input.summary?.task_buckets, "open_tasks", 0);
  const dueToday = bucketCount(input.summary?.task_buckets, "due_today_tasks", 0);
  const conflictCount = Math.max(0, input.summary?.conflict_count ?? 0);
  const fixedBlocks = bucketCount(input.summary?.block_buckets, "fixed_blocks", 0);
  const focusBlocks = bucketCount(input.summary?.block_buckets, "focus_blocks", 0);
  const bufferBlocks = bucketCount(input.summary?.block_buckets, "buffer_blocks", 0);
  const nextAction = compactSentence(input.nextActionPreview) || "No Planner next action loaded yet.";
  const statusLabel = input.summary
    ? `Synced ${formatPlannerTime(input.summary.generated_at, now)}`
    : "No Planner summary loaded";
  const decisionLabel = conflictCount > 0
    ? "Resolve the overlap before adding new work."
    : focusMinutes > 0
      ? "Protect the focus capacity already visible for this day."
      : openTasks > 0
        ? "Choose one open loop before adding new commitments."
        : "Keep the day open until Planner has more state.";
  const decisionDetail = hasSummary
    ? "Built from the Planner summary counts available on device. Named blocks appear once the API returns them."
    : "Refresh Planner to load task, calendar, conflict, and block counts for this date.";
  const scheduledCommitments = buildScheduledCommitments({
    focusMinutes,
    focusBlocks,
    meetingCount,
    fixedBlocks,
    bufferMinutes,
    bufferBlocks,
    alarmScheduled: Boolean(input.alarmScheduled),
    nextBriefingCountdown: input.nextBriefingCountdown,
  });
  const flexibleTasks = buildFlexibleTasks({ openTasks, dueToday, nextAction });

  return {
    dateLabel: selectedDate.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }),
    dateControls: {
      selectedDate: selectedDateKey,
      todayDate: formatPlannerDateKey(now),
      previousDate: shiftPlannerDate(selectedDateKey, -1),
      nextDate: shiftPlannerDate(selectedDateKey, 1),
      isToday: isSameDay(selectedDate, now),
    },
    statusLabel,
    decisionLabel,
    decisionDetail,
    dayStrip: buildDayStrip(selectedDate),
    metrics: hasSummary
      ? [
          { label: "Focus", value: formatMinutes(focusMinutes), caption: focusBlocks > 0 ? `${focusBlocks} block${focusBlocks === 1 ? "" : "s"}` : "No block", tone: "focus" },
          { label: "Meetings", value: String(meetingCount), caption: `${fixedBlocks} fixed`, tone: "meeting" },
          { label: "Tasks", value: String(openTasks), caption: dueToday > 0 ? `${dueToday} due today` : "Open loops", tone: "task" },
          { label: "Buffer", value: formatMinutes(bufferMinutes), caption: bufferBlocks > 0 ? `${bufferBlocks} block${bufferBlocks === 1 ? "" : "s"}` : "Flexible", tone: "buffer" },
        ]
      : [
          { label: "Focus", value: "Unknown", caption: "Refresh Planner", tone: "focus" },
          { label: "Meetings", value: "Unknown", caption: "Refresh Planner", tone: "meeting" },
          { label: "Tasks", value: "Unknown", caption: "Refresh Planner", tone: "task" },
          { label: "Buffer", value: "Unknown", caption: "Refresh Planner", tone: "buffer" },
        ],
    timelineBlocks: buildTimelineBlocks({
      hasSummary,
      nextAction,
      focusMinutes,
      focusBlocks,
      bufferMinutes,
      bufferBlocks,
      meetingCount,
      conflictCount,
      alarmScheduled: Boolean(input.alarmScheduled),
    }),
    planGroups: [
      {
        title: "Scheduled commitments",
        summaryLabel: scheduledCommitments.length > 0 ? `${scheduledCommitments.length} visible` : hasSummary ? "Empty" : "Unknown",
        items: scheduledCommitments,
        emptyLabel: hasSummary
          ? "Planner has no scheduled commitments for this date yet."
          : "Refresh Planner to load scheduled commitments for this date.",
      },
      {
        title: "Flexible tasks",
        summaryLabel: openTasks > 0 ? `${openTasks} open` : hasSummary ? "None" : "Unknown",
        items: flexibleTasks,
        emptyLabel: hasSummary
          ? "No open task pressure is visible in the Planner summary."
          : "Refresh Planner to load task pressure for this date.",
      },
      {
        title: "Done",
        summaryLabel: hasSummary ? "Checked" : "Waiting",
        items: hasSummary
          ? [{
              id: "planner-summary-loaded",
              title: "Planner summary loaded",
              detail: "Counts are available for this date.",
              metaLabel: statusLabel,
              tone: "done",
              completed: true,
            }]
          : [],
        emptyLabel: "Completed Planner items will appear after the day has tracked activity.",
      },
    ],
    conflict: conflictCount > 0
      ? {
          title: "Conflict detected",
          body: `${conflictCount} planner conflict${conflictCount === 1 ? "" : "s"} need assistant repair before the day is reliable.`,
          severityLabel: "Repair in Assistant",
        }
      : null,
    nextFocus: hasSummary
      ? {
          title: focusBlocks > 0 ? "Focus capacity" : "Set next focus",
          body: focusBlocks > 0 ? nextAction : "No named focus block is available yet. Ask Assistant to shape one before committing new work.",
          timeLabel: focusBlocks > 0 ? formatMinutes(focusMinutes) : "Unscheduled",
          metaLabel: focusBlocks > 0 ? `${focusBlocks} focus block${focusBlocks === 1 ? "" : "s"}` : "Needs planning",
        }
      : {
          title: "Focus unknown",
          body: "Refresh Planner to load focus capacity and named blocks for this date.",
          timeLabel: "Unknown",
          metaLabel: "Refresh Planner",
        },
    upcoming: {
      title: meetingCount > 0 ? "Fixed commitments" : hasSummary ? "Open calendar" : "Refresh calendar",
      body: meetingCount > 0
        ? `${meetingCount} calendar event${meetingCount === 1 ? "" : "s"} visible for this date.`
        : hasSummary
          ? "No calendar events are visible in the Planner summary."
          : "Refresh Planner to load calendar events and fixed blocks for this date.",
      timeLabel: meetingCount > 0 ? `${meetingCount} event${meetingCount === 1 ? "" : "s"}` : hasSummary ? "None" : "Unknown",
      metaLabel: fixedBlocks > 0 ? `${fixedBlocks} fixed block${fixedBlocks === 1 ? "" : "s"}` : hasSummary ? "No fixed blocks" : "Refresh Planner",
    },
    promptChips: conflictCount > 0
      ? ["Protect focus", "Repair conflict", "What can move?"]
      : ["Protect focus", "What can move?", "Plan buffer"],
  };
}

function buildScheduledCommitments(input: {
  focusMinutes: number;
  focusBlocks: number;
  meetingCount: number;
  fixedBlocks: number;
  bufferMinutes: number;
  bufferBlocks: number;
  alarmScheduled: boolean;
  nextBriefingCountdown?: string;
}): MobilePlannerPlanItem[] {
  const items: MobilePlannerPlanItem[] = [];
  if (input.focusMinutes > 0 || input.focusBlocks > 0) {
    items.push({
      id: "focus-capacity",
      title: input.focusBlocks > 0 ? "Protected focus capacity" : "Candidate focus capacity",
      detail: input.focusBlocks > 0 ? "Planner has focus time available for the day." : "Focus minutes are visible, but no focus block count was returned.",
      metaLabel: formatMinutes(input.focusMinutes),
      tone: "focus",
    });
  }
  if (input.meetingCount > 0 || input.fixedBlocks > 0) {
    items.push({
      id: "fixed-commitments",
      title: input.meetingCount > 0 ? "Calendar commitments" : "Fixed Planner blocks",
      detail: input.meetingCount > 0 ? "Calendar events are present on this date." : "Planner reports fixed blocks without event detail.",
      metaLabel: input.meetingCount > 0 ? `${input.meetingCount} event${input.meetingCount === 1 ? "" : "s"}` : `${input.fixedBlocks} fixed`,
      tone: "meeting",
    });
  }
  if (input.bufferMinutes > 0 || input.bufferBlocks > 0) {
    items.push({
      id: "buffer-capacity",
      title: "Buffer capacity",
      detail: "Use this for transitions, cleanup, or moving flexible work.",
      metaLabel: formatMinutes(input.bufferMinutes),
      tone: "buffer",
    });
  }
  if (input.alarmScheduled) {
    items.push({
      id: "morning-briefing",
      title: "Morning briefing",
      detail: "Phone playback is scheduled for the day.",
      metaLabel: input.nextBriefingCountdown || "Scheduled",
      tone: "meeting",
    });
  }
  return items;
}

function buildFlexibleTasks(input: {
  openTasks: number;
  dueToday: number;
  nextAction: string;
}): MobilePlannerPlanItem[] {
  const items: MobilePlannerPlanItem[] = [];
  if (input.dueToday > 0) {
    items.push({
      id: "due-today",
      title: "Due today",
      detail: "These open loops should be checked before lower-pressure work.",
      metaLabel: `${input.dueToday} task${input.dueToday === 1 ? "" : "s"}`,
      tone: "task",
    });
  }
  const movableTasks = Math.max(0, input.openTasks - input.dueToday);
  if (movableTasks > 0) {
    items.push({
      id: "movable-open-loops",
      title: "Movable open loops",
      detail: "These can be sequenced around focus and fixed commitments.",
      metaLabel: `${movableTasks} open`,
      tone: "task",
    });
  }
  if (input.openTasks > 0) {
    items.push({
      id: "next-action",
      title: "Current next action",
      detail: input.nextAction,
      metaLabel: "Assistant context",
      tone: "focus",
    });
  }
  return items;
}

export function formatPlannerDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftPlannerDate(dateKey: string, days: number): string {
  const parsed = parsePlannerDate(dateKey, new Date());
  parsed.setDate(parsed.getDate() + days);
  return formatPlannerDateKey(parsed);
}

function buildDayStrip(selectedDate: Date): MobilePlannerDay[] {
  const start = new Date(selectedDate);
  start.setDate(selectedDate.getDate() - 3);
  return Array.from({ length: 7 }).map((_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return {
      key: formatPlannerDateKey(day),
      weekday: day.toLocaleDateString([], { weekday: "short" }),
      day: String(day.getDate()),
      active: isSameDay(day, selectedDate),
    };
  });
}

function buildTimelineBlocks(input: {
  hasSummary: boolean;
  nextAction: string;
  focusMinutes: number;
  focusBlocks: number;
  bufferMinutes: number;
  bufferBlocks: number;
  meetingCount: number;
  conflictCount: number;
  alarmScheduled: boolean;
}): MobilePlannerTimelineBlock[] {
  const blocks: MobilePlannerTimelineBlock[] = [
    {
      id: "briefing",
      timeLabel: "Briefing",
      durationLabel: input.alarmScheduled ? "Scheduled" : "Optional",
      title: "Morning briefing",
      detail: input.alarmScheduled ? "Offline playback is scheduled for the first check-in." : "No briefing alarm is scheduled for this date.",
      type: "away",
    },
    {
      id: "focus",
      timeLabel: "Focus",
      durationLabel: input.hasSummary ? formatMinutes(input.focusMinutes) : "Unknown",
      title: input.hasSummary
        ? input.focusBlocks > 0 ? "Protected focus capacity" : "Candidate focus"
        : "Focus unknown",
      detail: input.hasSummary
        ? input.focusBlocks > 0 ? input.nextAction : "Planner has not returned a named focus block yet."
        : "Refresh Planner to load focus capacity for this date.",
      type: "focus",
    },
    {
      id: "fixed",
      timeLabel: "Fixed",
      durationLabel: input.meetingCount > 0 ? `${input.meetingCount} event${input.meetingCount === 1 ? "" : "s"}` : input.hasSummary ? "None" : "Unknown",
      title: input.meetingCount > 0 ? "Fixed commitments" : input.hasSummary ? "Open work window" : "Calendar not loaded",
      detail: input.meetingCount > 0
        ? "Keep prep and transitions compact."
        : input.hasSummary
          ? "No meetings are blocking this part of the day."
          : "Refresh Planner to load fixed commitments for this date.",
      type: input.meetingCount > 0 ? "meeting" : "task",
    },
  ];

  if (input.conflictCount > 0) {
    blocks.push({
      id: "conflict",
      timeLabel: "Conflict",
      durationLabel: `${input.conflictCount} issue${input.conflictCount === 1 ? "" : "s"}`,
      title: "Repair before execution",
      detail: "Conflict repair should happen before new blocks are added.",
      type: "conflict",
    });
  }

  blocks.push({
    id: "buffer",
    timeLabel: "Buffer",
    durationLabel: input.hasSummary
      ? input.bufferBlocks > 0 ? formatMinutes(input.bufferMinutes) : "Flexible"
      : "Unknown",
    title: input.hasSummary ? "Buffer and handoff" : "Buffer unknown",
    detail: input.hasSummary
      ? "Close loops, move flexible tasks, and leave tomorrow cleaner."
      : "Refresh Planner to load buffer capacity for this date.",
    type: "buffer",
  });

  return blocks;
}

function bucketCount(buckets: PlannerCountBucket[] | undefined, key: string, fallback: number): number {
  return Math.max(0, buckets?.find((bucket) => bucket.key === key)?.count ?? fallback);
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) {
    return "0m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatPlannerTime(value: string, now: Date): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "recently";
  }
  if (isSameDay(parsed, now)) {
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

function parsePlannerDate(value: string | undefined, fallback: Date): Date {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function compactSentence(value: string | undefined): string {
  const trimmed = (value || "").trim().replace(/\s+/g, " ");
  if (trimmed.length <= 118) {
    return trimmed;
  }
  return `${trimmed.slice(0, 115).trim()}...`;
}
