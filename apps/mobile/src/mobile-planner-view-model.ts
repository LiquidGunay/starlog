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
  tone: "focus" | "meeting" | "task" | "buffer";
};

export type MobilePlannerTimelineBlock = {
  id: string;
  time: string;
  duration: string;
  title: string;
  detail: string;
  type: "focus" | "meeting" | "away" | "conflict" | "buffer" | "task";
};

export type MobilePlannerPlanGroup = {
  title: string;
  items: string[];
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
  };
  upcoming: {
    title: string;
    body: string;
    timeLabel: string;
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
  const focusMinutes = Math.max(0, input.summary?.focus_minutes ?? 90);
  const bufferMinutes = Math.max(0, input.summary?.buffer_minutes ?? 30);
  const meetingCount = Math.max(0, input.summary?.calendar_event_count ?? 2);
  const openTasks = bucketCount(input.summary?.task_buckets, "open_tasks", 6);
  const dueToday = bucketCount(input.summary?.task_buckets, "due_today_tasks", 3);
  const conflictCount = Math.max(0, input.summary?.conflict_count ?? 0);
  const fixedBlocks = bucketCount(input.summary?.block_buckets, "fixed_blocks", meetingCount);
  const focusBlocks = bucketCount(input.summary?.block_buckets, "focus_blocks", focusMinutes > 0 ? 1 : 0);
  const bufferBlocks = bucketCount(input.summary?.block_buckets, "buffer_blocks", bufferMinutes > 0 ? 1 : 0);
  const nextAction = compactSentence(input.nextActionPreview) || "Move the highest-value open loop before new intake.";
  const statusLabel = input.summary
    ? `Synced ${formatPlannerTime(input.summary.generated_at, now)}`
    : "Local preview";

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
    decisionLabel: conflictCount > 0 ? "Resolve the overlap before adding new work." : nextAction,
    dayStrip: buildDayStrip(selectedDate),
    metrics: [
      { label: "Focus", value: formatMinutes(focusMinutes), tone: "focus" },
      { label: "Meetings", value: String(meetingCount), tone: "meeting" },
      { label: "Tasks", value: String(openTasks), tone: "task" },
      { label: "Buffer", value: formatMinutes(bufferMinutes), tone: "buffer" },
    ],
    timelineBlocks: buildTimelineBlocks({
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
        items: [
          focusBlocks > 0 ? `${formatMinutes(focusMinutes)} protected focus` : "Choose a focus block",
          meetingCount > 0 ? `${meetingCount} fixed commitment${meetingCount === 1 ? "" : "s"}` : "No fixed meetings",
          input.alarmScheduled ? `Morning briefing ${input.nextBriefingCountdown || "scheduled"}` : "Morning briefing not scheduled",
        ],
      },
      {
        title: "Flexible tasks",
        items: [
          dueToday > 0 ? `${dueToday} due today` : "No task due pressure",
          `${Math.max(0, openTasks - dueToday)} open task${openTasks - dueToday === 1 ? "" : "s"} can move`,
          nextAction,
        ],
      },
      {
        title: "Done",
        items: ["Briefing plan checked"],
      },
    ],
    conflict: conflictCount > 0
      ? {
          title: "Conflict detected",
          body: `${conflictCount} planner conflict${conflictCount === 1 ? "" : "s"} need assistant repair before the day is reliable.`,
          severityLabel: "Repair in Assistant",
        }
      : null,
    nextFocus: {
      title: focusBlocks > 0 ? "Next focus block" : "Set next focus",
      body: nextAction,
      timeLabel: focusBlocks > 0 ? "09:30" : "Unscheduled",
    },
    upcoming: {
      title: meetingCount > 0 ? "Upcoming fixed time" : "Upcoming buffer",
      body: meetingCount > 0 ? `${meetingCount} fixed commitment${meetingCount === 1 ? "" : "s"} on the day.` : "Use buffer before adding meetings.",
      timeLabel: meetingCount > 0 ? "11:00" : "13:30",
    },
    promptChips: conflictCount > 0
      ? ["Protect focus", "Repair conflict", "What can move?"]
      : ["Protect focus", "What can move?", "Plan buffer"],
  };
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
      time: "07:30",
      duration: input.alarmScheduled ? "Spoken briefing" : "Briefing slot",
      title: "Morning briefing",
      detail: input.alarmScheduled ? "Offline playback is ready for the first check-in." : "Schedule the morning briefing before relying on playback.",
      type: "away",
    },
    {
      id: "focus",
      time: "09:30",
      duration: formatMinutes(input.focusMinutes || 90),
      title: input.focusBlocks > 0 ? "Protected focus" : "Candidate focus",
      detail: input.nextAction,
      type: "focus",
    },
    {
      id: "fixed",
      time: "11:00",
      duration: `${Math.max(1, input.meetingCount)} fixed`,
      title: input.meetingCount > 0 ? "Fixed commitments" : "Open work window",
      detail: input.meetingCount > 0 ? "Keep prep and transitions compact." : "No meetings are blocking this part of the day.",
      type: input.meetingCount > 0 ? "meeting" : "task",
    },
  ];

  if (input.conflictCount > 0) {
    blocks.push({
      id: "conflict",
      time: "14:00",
      duration: `${input.conflictCount} conflict${input.conflictCount === 1 ? "" : "s"}`,
      title: "Repair before execution",
      detail: "Conflict repair should happen before new blocks are added.",
      type: "conflict",
    });
  }

  blocks.push({
    id: "buffer",
    time: "16:00",
    duration: input.bufferBlocks > 0 ? formatMinutes(input.bufferMinutes || 30) : "Flexible",
    title: "Buffer and handoff",
    detail: "Close loops, move flexible tasks, and leave tomorrow cleaner.",
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
