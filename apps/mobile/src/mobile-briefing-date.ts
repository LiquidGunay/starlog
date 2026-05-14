import { localDateStringForAssistantToday } from "./mobile-assistant-today-view-model";

export type NormalizedBriefingDate = {
  date: string;
  reset: boolean;
};

export function todayBriefingDate(now: Date = new Date()): string {
  return localDateStringForAssistantToday(now);
}

export function dateOnlyUtcMillis(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const millis = Date.UTC(year, month - 1, day);
  const parsed = new Date(millis);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return millis;
}

export function normalizeCurrentBriefingDate(
  value: string,
  today = todayBriefingDate(),
): NormalizedBriefingDate {
  const selectedMillis = dateOnlyUtcMillis(value);
  const todayMillis = dateOnlyUtcMillis(today);
  if (selectedMillis === null || todayMillis === null) {
    return { date: today, reset: true };
  }
  const daysFromToday = Math.round((selectedMillis - todayMillis) / 86_400_000);
  if (daysFromToday < 0 || daysFromToday > 7) {
    return { date: today, reset: true };
  }
  return { date: value, reset: false };
}
