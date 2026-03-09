const SNAPSHOT_PREFIX = "starlog-web-snapshot-v1:";

export function readEntitySnapshot<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(`${SNAPSHOT_PREFIX}${key}`);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeEntitySnapshot(key: string, value: unknown): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(`${SNAPSHOT_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Best-effort cache only.
  }
}
