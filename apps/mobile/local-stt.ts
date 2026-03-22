import { NativeModules, Platform } from "react-native";

export type LocalSttResult = {
  provider: string;
  transcript: string;
  locale: string | null;
  confidence: number | null;
  alternatives: string[];
};

type LocalSttOptions = {
  locale?: string;
  partialResults?: boolean;
  prompt?: string;
};

type NativeLocalSttModule = {
  clearCurrentIntentUrl?(): Promise<boolean>;
  getCurrentIntentUrl?(): Promise<string | null>;
  isAvailable(): Promise<boolean>;
  recognizeOnce(options?: LocalSttOptions): Promise<LocalSttResult>;
};

const localSttModule = NativeModules.StarlogLocalStt as NativeLocalSttModule | undefined;

export async function probeLocalSttAvailability(): Promise<boolean> {
  if (Platform.OS !== "android" || !localSttModule?.isAvailable) {
    return false;
  }
  try {
    return Boolean(await localSttModule.isAvailable());
  } catch {
    return false;
  }
}

export async function recognizeSpeechOnce(options: LocalSttOptions = {}): Promise<LocalSttResult> {
  if (Platform.OS !== "android" || !localSttModule?.recognizeOnce) {
    throw new Error("On-device STT is only available in the Android dev build.");
  }
  return localSttModule.recognizeOnce(options);
}

export async function getCurrentIntentUrl(): Promise<string | null> {
  if (Platform.OS !== "android" || !localSttModule?.getCurrentIntentUrl) {
    return null;
  }
  try {
    return (await localSttModule.getCurrentIntentUrl()) ?? null;
  } catch {
    return null;
  }
}

export async function clearCurrentIntentUrl(): Promise<void> {
  if (Platform.OS !== "android" || !localSttModule?.clearCurrentIntentUrl) {
    return;
  }
  try {
    await localSttModule.clearCurrentIntentUrl();
  } catch {
    // Best-effort cleanup; ignore native failures here.
  }
}
