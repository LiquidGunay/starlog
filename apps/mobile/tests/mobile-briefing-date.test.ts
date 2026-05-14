import {
  dateOnlyUtcMillis,
  normalizeCurrentBriefingDate,
  normalizePersistedBriefingState,
  todayBriefingDate,
} from "../src/mobile-briefing-date";

declare const require: (moduleName: string) => {
  equal: (...args: unknown[]) => void;
  deepEqual: (...args: unknown[]) => void;
};

const assert = require("node:assert/strict");

assert.equal(todayBriefingDate(new Date("2026-05-13T15:30:00Z")), "2026-05-13");

assert.equal(dateOnlyUtcMillis("2026-05-13"), Date.UTC(2026, 4, 13));
assert.equal(dateOnlyUtcMillis("2026-02-30"), null);
assert.equal(dateOnlyUtcMillis("not-a-date"), null);

assert.deepEqual(normalizeCurrentBriefingDate("2026-04-29", "2026-05-13"), {
  date: "2026-05-13",
  reset: true,
});

assert.deepEqual(normalizeCurrentBriefingDate("2026-05-13", "2026-05-13"), {
  date: "2026-05-13",
  reset: false,
});

assert.deepEqual(normalizeCurrentBriefingDate("2026-05-20", "2026-05-13"), {
  date: "2026-05-20",
  reset: false,
});

assert.deepEqual(normalizeCurrentBriefingDate("2026-05-21", "2026-05-13"), {
  date: "2026-05-13",
  reset: true,
});

assert.deepEqual(normalizeCurrentBriefingDate("2026-02-30", "2026-05-13"), {
  date: "2026-05-13",
  reset: true,
});

assert.deepEqual(normalizeCurrentBriefingDate("not-a-date", "2026-05-13"), {
  date: "2026-05-13",
  reset: true,
});

assert.deepEqual(
  normalizePersistedBriefingState(
    {
      briefingDate: "2026-05-12",
      cachedPath: "file:///old/briefing-2026-05-12.json",
      alarmNotificationId: "alarm-old",
    },
    "2026-05-13",
  ),
  {
    briefingDate: "2026-05-13",
    cachedPath: null,
    alarmNotificationId: null,
    canceledAlarmNotificationId: "alarm-old",
    reset: true,
  },
);

assert.deepEqual(
  normalizePersistedBriefingState(
    {
      briefingDate: "2026-05-16",
      cachedPath: "file:///new/briefing-2026-05-16.json",
      alarmNotificationId: "alarm-new",
    },
    "2026-05-13",
  ),
  {
    briefingDate: "2026-05-16",
    cachedPath: "file:///new/briefing-2026-05-16.json",
    alarmNotificationId: "alarm-new",
    canceledAlarmNotificationId: null,
    reset: false,
  },
);

console.log("mobile briefing date tests passed");
