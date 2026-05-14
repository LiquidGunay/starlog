import {
  dateOnlyUtcMillis,
  normalizeCurrentBriefingDate,
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

console.log("mobile briefing date tests passed");
