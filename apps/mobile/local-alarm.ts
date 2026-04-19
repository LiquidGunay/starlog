import { NativeModules, Platform } from "react-native";

type ScheduleAlarmResult = {
  alarmId: string;
  scheduledFor: string;
};

type NativeLocalAlarmModule = {
  isAvailable?(): Promise<boolean>;
  scheduleDailyAlarm(options: {
    hour: number;
    minute: number;
    briefingPath: string;
    fallbackText?: string;
  }): Promise<ScheduleAlarmResult>;
  cancelDailyAlarm?(): Promise<boolean>;
  startPreviewAlarm?(options?: {
    hour?: number;
    minute?: number;
    briefingPath?: string;
    fallbackText?: string;
  }): Promise<boolean>;
};

const localAlarmModule = NativeModules.StarlogLocalAlarm as NativeLocalAlarmModule | undefined;

export async function probeLocalAlarmAvailability(): Promise<boolean> {
  if (Platform.OS !== "android" || !localAlarmModule?.isAvailable) {
    return false;
  }
  try {
    return Boolean(await localAlarmModule.isAvailable());
  } catch {
    return false;
  }
}

export async function scheduleLocalMorningAlarm(options: {
  hour: number;
  minute: number;
  briefingPath: string;
  fallbackText?: string;
}): Promise<ScheduleAlarmResult> {
  if (Platform.OS !== "android" || !localAlarmModule?.scheduleDailyAlarm) {
    throw new Error("Native Android alarm scheduling is unavailable in this build.");
  }
  return localAlarmModule.scheduleDailyAlarm(options);
}

export async function cancelLocalMorningAlarm(): Promise<boolean> {
  if (Platform.OS !== "android" || !localAlarmModule?.cancelDailyAlarm) {
    return false;
  }
  try {
    return Boolean(await localAlarmModule.cancelDailyAlarm());
  } catch {
    return false;
  }
}

export async function startLocalAlarmPreview(options: {
  hour?: number;
  minute?: number;
  briefingPath?: string;
  fallbackText?: string;
} = {}): Promise<boolean> {
  if (Platform.OS !== "android" || !localAlarmModule?.startPreviewAlarm) {
    return false;
  }
  try {
    return Boolean(await localAlarmModule.startPreviewAlarm(options));
  } catch {
    return false;
  }
}
